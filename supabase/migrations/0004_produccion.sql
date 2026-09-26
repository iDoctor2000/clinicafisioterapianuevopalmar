-- =============================================================================
-- 0004_produccion.sql · Ajustes de puesta en marcha
--   1. Tarea nocturna (pg_cron): genera clases, reservas automáticas, caduca
--      recuperaciones y finaliza contratos vencidos.
--   2. Tiempo real: las tablas cuyos cambios se envían a la app al instante.
--   3. Vinculación automática de usuarios: cuando alguien crea su contraseña
--      con un email que ya existe en clientes o trabajadores, queda enlazado.
-- =============================================================================

-- 1) Mantenimiento nocturno a las 03:15 (hora del servidor, UTC).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'mantenimiento-diario';
    perform cron.schedule('mantenimiento-diario', '15 3 * * *', 'select public.mantenimiento_diario()');
  else
    raise notice 'pg_cron no disponible: programar el mantenimiento manualmente.';
  end if;
end $$;

-- 2) Tiempo real.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publicación supabase_realtime no existe (fuera de Supabase): se omite.';
    return;
  end if;
  foreach t in array array['reservas', 'clases', 'avisos', 'recuperaciones', 'contratos'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 3) Vincular automáticamente el usuario de acceso con su ficha por email.
create or replace function public.vincular_usuario_por_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null then return new; end if;
  update public.trabajadores set user_id = new.id
   where user_id is null and lower(email) = lower(new.email);
  update public.clientes set user_id = new.id
   where user_id is null and lower(email) = lower(new.email);
  return new;
end $$;
comment on function public.vincular_usuario_por_email() is
  'Al crearse un usuario en auth.users, enlaza su id con la ficha de trabajador o cliente que tenga ese email.';

drop trigger if exists trg_vincular_usuario on auth.users;
create trigger trg_vincular_usuario
  after insert on auth.users
  for each row execute function public.vincular_usuario_por_email();

-- Enlazar también a los usuarios que ya existan.
update public.trabajadores t set user_id = u.id
  from auth.users u where t.user_id is null and lower(t.email) = lower(u.email);
update public.clientes c set user_id = u.id
  from auth.users u where c.user_id is null and lower(c.email) = lower(u.email);

-- Las fichas deben poder consultarse por email antes de vincular: índice.
create index if not exists clientes_email_lower_idx on public.clientes (lower(email));
create index if not exists trabajadores_email_lower_idx on public.trabajadores (lower(email));

-- 4) Generar ya las clases de las próximas semanas.
select public.mantenimiento_diario();
