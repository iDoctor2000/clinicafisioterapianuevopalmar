-- =============================================================================
-- 0026_cumpleanos_personal.sql · Notificación al móvil del personal el día que alguien cumple años
--
--   1. `suscripciones_push` admite suscripciones de trabajadores (`trabajador_id`): cada
--      monitor o administrador activa los avisos en su móvil desde Más → Avisos en el móvil.
--   2. `push_personal_pendientes`: notificaciones para el personal que crea la propia base
--      de datos. La función enviar-push (service_role) las lee, las borra y las manda a las
--      suscripciones de sus destinatarios; no se mandan antes de `enviar_desde`.
--   3. `programar_push_cumpleanos()`: cada mañana (pg_cron, 06:30 UTC = 07:30/08:30 en España)
--      mira si hoy cumple años algún alumno activo y deja preparada UNA notificación para los
--      monitores y administradores activos. Idempotente por día.
--   Tras ejecutarla hay que volver a desplegar la función enviar-push (Edge Functions → Deploy).
--   Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Suscripciones del personal
-- -----------------------------------------------------------------------------
alter table public.suscripciones_push alter column cliente_id drop not null;
alter table public.suscripciones_push add column if not exists trabajador_id uuid references public.trabajadores(id) on delete cascade;
do $$ begin
  alter table public.suscripciones_push add constraint suscripciones_push_un_dueno
    check ((cliente_id is not null and trabajador_id is null) or (cliente_id is null and trabajador_id is not null));
exception when duplicate_object then null; end $$;
create index if not exists suscripciones_push_trabajador_idx on public.suscripciones_push (trabajador_id);
comment on column public.suscripciones_push.trabajador_id is 'Suscripción de un trabajador (0026). Una fila es de un cliente o de un trabajador, nunca de los dos.';

drop policy if exists push_propias on public.suscripciones_push;
create policy push_propias on public.suscripciones_push for all to authenticated
  using (cliente_id = public.auth_cliente_id() or trabajador_id = public.auth_trabajador_id())
  with check (cliente_id = public.auth_cliente_id() or trabajador_id = public.auth_trabajador_id());

-- -----------------------------------------------------------------------------
-- 2. Notificaciones pendientes para el personal
-- -----------------------------------------------------------------------------
create table if not exists public.push_personal_pendientes (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  cuerpo         text not null default '',
  url            text not null default '#/',
  destinatarios  uuid[] not null default '{}', -- trabajadores a los que va
  enviar_desde   timestamptz not null default now(),
  creado_el      timestamptz not null default now()
);
comment on table public.push_personal_pendientes is 'Notificaciones al móvil del personal creadas por la base de datos (cumpleaños). Solo la función enviar-push (service_role) las lee y borra.';
alter table public.push_personal_pendientes enable row level security;
revoke all on public.push_personal_pendientes from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Cumpleaños de hoy → notificación para monitores y administradores
-- -----------------------------------------------------------------------------
create or replace function public.programar_push_cumpleanos()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hoy      date := public._hoy();
  v_nombres  text;
  v_n        integer;
  v_personal uuid[];
begin
  -- Solo el sistema (pg_cron, editor SQL) o un administrador.
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo el sistema puede programar esta notificación.' using errcode = 'insufficient_privilege';
  end if;
  -- Ya preparada hoy (idempotente): nada que hacer.
  if exists (select 1 from public.push_personal_pendientes where url = '#/?cumple=' || v_hoy::text) then return 0; end if;

  -- Los nacidos el 29 de febrero lo celebran el 28 en años no bisiestos (igual que la app).
  select string_agg(c.nombre || ' ' || split_part(c.apellidos, ' ', 1), ', ' order by c.apellidos, c.nombre), count(*)
    into v_nombres, v_n
    from public.clientes c
   where c.activo and c.fecha_nacimiento is not null
     and (
       (extract(month from c.fecha_nacimiento) = extract(month from v_hoy) and extract(day from c.fecha_nacimiento) = extract(day from v_hoy))
       or (extract(month from c.fecha_nacimiento) = 2 and extract(day from c.fecha_nacimiento) = 29
           and extract(month from v_hoy) = 2 and extract(day from v_hoy) = 28
           and not (extract(year from v_hoy)::int % 4 = 0 and (extract(year from v_hoy)::int % 100 <> 0 or extract(year from v_hoy)::int % 400 = 0)))
     );
  if coalesce(v_n, 0) = 0 then return 0; end if;

  select coalesce(array_agg(t.id), '{}') into v_personal
    from public.trabajadores t where t.activo and (t.es_monitor or t.rol = 'ADMIN');
  if cardinality(v_personal) = 0 then return 0; end if;

  insert into public.push_personal_pendientes (titulo, cuerpo, url, destinatarios)
  values (
    case when v_n = 1 then '🎂 Hoy cumple años ' || v_nombres else '🎂 Hoy cumplen años ' || v_n || ' alumnos' end,
    case when v_n = 1 then '¡Felicítale en clase! Lo tienes en el calendario de la app.' else v_nombres || '. ¡Felicitadles en clase!' end,
    '#/?cumple=' || v_hoy::text,
    v_personal
  );
  return v_n;
end $$;
comment on function public.programar_push_cumpleanos() is 'Deja preparada la notificación matinal al personal si hoy cumple años algún alumno activo. Devuelve cuántos cumplen. Idempotente por día.';
revoke all on function public.programar_push_cumpleanos() from public, anon;
grant execute on function public.programar_push_cumpleanos() to authenticated;

-- Limpieza: las notificaciones que nadie recogió en 2 días se descartan (las borra el mantenimiento al programar la siguiente).
create or replace function public._limpiar_push_personal()
returns void language sql security definer set search_path = public as $$
  delete from public.push_personal_pendientes where creado_el < now() - interval '2 days'
$$;

-- -----------------------------------------------------------------------------
-- 4. Tarea diaria a las 06:30 UTC (solo en Supabase, con pg_cron)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'push-cumpleanos';
    perform cron.schedule('push-cumpleanos', '30 6 * * *', 'select public._limpiar_push_personal(); select public.programar_push_cumpleanos()');
  else
    raise notice 'pg_cron no disponible: programar push-cumpleanos manualmente.';
  end if;
end $$;
