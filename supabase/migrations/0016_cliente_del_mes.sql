-- =============================================================================
-- 0016_cliente_del_mes.sql · Premio "Cliente del mes"
--
--   · Cada mes el administrador elige a un alumno (la app le propone los más constantes
--     del mes anterior) y lo anuncia: el alumno recibe un aviso con notificación en el
--     móvil y una celebración al abrir la app; el personal lo ve en el calendario y al
--     pasar lista.
--   · El ganador decide si los demás alumnos lo ven en la app (publico = true). Mientras
--     no conteste (null) o si dice que no (false), solo lo ven él y el personal.
--   · Se escribe solo con funciones (anunciar, quitar, responder); la tabla es de lectura.
--   Idempotente.
-- =============================================================================

alter table public.config_centro
  add column if not exists cliente_del_mes_activo boolean not null default true;
comment on column public.config_centro.cliente_del_mes_activo is 'Si la app propone y muestra el premio "Cliente del mes".';

create table if not exists public.premios_mes (
  mes            date primary key check (extract(day from mes) = 1),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  clases         integer not null default 0 check (clases >= 0),
  motivo         text not null default '',
  anunciado_el   timestamptz not null default now(),
  anunciado_por  uuid,
  publico        boolean,
  nombre_publico text not null default '',
  respondido_el  timestamptz
);
comment on table public.premios_mes is 'Premio "Cliente del mes": un ganador por mes (mes = día 1). publico: null sin responder, true se puede mostrar a todos, false no.';
create index if not exists premios_mes_cliente_idx on public.premios_mes (cliente_id);

alter table public.premios_mes enable row level security;
drop policy if exists premios_leer on public.premios_mes;
create policy premios_leer on public.premios_mes for select to authenticated
  using (public.auth_trabajador_id() is not null or cliente_id = public.auth_cliente_id() or publico is true);
revoke all on public.premios_mes from anon, authenticated;
grant select on public.premios_mes to authenticated;

-- -----------------------------------------------------------------------------
-- Actividad de cada alumno en un mes (para proponer al ganador)
-- -----------------------------------------------------------------------------
create or replace function public.actividad_del_mes(p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_desde date := date_trunc('month', p_mes)::date;
  v_hasta date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
begin
  if not (public.es_admin() or public.tiene_permiso('ESTADISTICAS_VER')) then
    raise exception 'No tienes permiso para ver la actividad del mes.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('c', x.cliente_id, 'n', x.n, 'min', x.minutos, 'sem', x.semanas) order by x.n desc)
      from (
        select r.cliente_id, count(*) as n, coalesce(sum(c.duracion_min), 0) as minutos,
               count(distinct date_trunc('week', c.fecha)) as semanas
          from public.reservas r join public.clases c on c.id = r.clase_id
         where r.estado = 'RESERVADA' and r.asistencia <> 'NO_ASISTE' and c.estado <> 'CANCELADA'
           and c.fecha between v_desde and v_hasta
           and (c.fecha + c.hora_inicio) <= public._ahora_local()
         group by r.cliente_id
      ) x
  ), '[]'::jsonb);
end $$;
comment on function public.actividad_del_mes(date) is 'Clases, minutos y semanas con clase de cada alumno en un mes. Administración o ESTADISTICAS_VER.';

-- -----------------------------------------------------------------------------
-- Anunciar (o cambiar) el ganador de un mes. Con título, le envía un aviso personal.
-- Devuelve el id del aviso (para la notificación al móvil) o null.
-- -----------------------------------------------------------------------------
create or replace function public.anunciar_cliente_del_mes(
  p_mes date, p_cliente_id uuid, p_clases integer default 0, p_motivo text default '',
  p_titulo text default null, p_cuerpo text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_mes date := date_trunc('month', p_mes)::date;
  v_aviso uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede elegir al cliente del mes.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'El cliente no existe.';
  end if;
  insert into public.premios_mes (mes, cliente_id, clases, motivo, anunciado_por)
  values (v_mes, p_cliente_id, greatest(coalesce(p_clases, 0), 0), coalesce(p_motivo, ''), auth.uid())
  on conflict (mes) do update
    set cliente_id = excluded.cliente_id, clases = excluded.clases, motivo = excluded.motivo,
        anunciado_el = now(), anunciado_por = excluded.anunciado_por,
        publico = case when premios_mes.cliente_id = excluded.cliente_id then premios_mes.publico end,
        nombre_publico = case when premios_mes.cliente_id = excluded.cliente_id then premios_mes.nombre_publico else '' end,
        respondido_el = case when premios_mes.cliente_id = excluded.cliente_id then premios_mes.respondido_el end;
  if coalesce(trim(p_titulo), '') <> '' then
    v_aviso := public.publicar_aviso(p_titulo, coalesce(p_cuerpo, ''), 'CLIENTES', null, array[p_cliente_id], true);
  end if;
  perform public._auditar('CLIENTE_DEL_MES', 'cliente', p_cliente_id::text, format('Cliente del mes de %s', to_char(v_mes, 'MM/YYYY')));
  return v_aviso;
end $$;

create or replace function public.quitar_cliente_del_mes(p_mes date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede quitar el premio.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.premios_mes where mes = date_trunc('month', p_mes)::date;
  perform public._auditar('QUITAR_CLIENTE_DEL_MES', 'premio', to_char(p_mes, 'YYYY-MM'), '');
end $$;

-- El ganador decide si los demás alumnos lo ven ("Ana G.").
create or replace function public.responder_cliente_del_mes(p_mes date, p_publico boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_cliente uuid := public.auth_cliente_id();
begin
  if v_cliente is null then raise exception 'Solo para alumnos.' using errcode = 'insufficient_privilege'; end if;
  update public.premios_mes p
     set publico = coalesce(p_publico, false),
         respondido_el = now(),
         nombre_publico = case when coalesce(p_publico, false)
           then trim(c.nombre || coalesce(' ' || nullif(left(trim(c.apellidos), 1), '') || '.', ''))
           else '' end
    from public.clientes c
   where p.mes = date_trunc('month', p_mes)::date and p.cliente_id = v_cliente and c.id = v_cliente;
  if not found then raise exception 'Ese premio no es tuyo.' using errcode = 'insufficient_privilege'; end if;
end $$;

revoke all on function public.actividad_del_mes(date) from public, anon;
revoke all on function public.anunciar_cliente_del_mes(date, uuid, integer, text, text, text) from public, anon;
revoke all on function public.quitar_cliente_del_mes(date) from public, anon;
revoke all on function public.responder_cliente_del_mes(date, boolean) from public, anon;
grant execute on function public.actividad_del_mes(date) to authenticated;
grant execute on function public.anunciar_cliente_del_mes(date, uuid, integer, text, text, text) to authenticated;
grant execute on function public.quitar_cliente_del_mes(date) to authenticated;
grant execute on function public.responder_cliente_del_mes(date, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Tiempo real (solo en Supabase)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice '0016: publicación supabase_realtime no existe (fuera de Supabase): se omite.';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'premios_mes'
  ) then
    execute 'alter publication supabase_realtime add table public.premios_mes';
  end if;
end $$;
