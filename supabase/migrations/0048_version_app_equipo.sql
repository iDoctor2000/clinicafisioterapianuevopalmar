-- =============================================================================
-- 0048_version_app_equipo.sql · Qué versión de la app lleva cada persona del equipo
--
--   Cada vez que alguien del equipo abre la app (o vuelve a ella tras un rato) se anota qué versión
--   lleva, en qué dispositivo y si la tiene instalada: una fila por persona (la última vez). Lo leen el
--   diagnóstico y el bot (/informehoy); la app no puede leerlo, solo anotar lo suyo.
--   Los alumnos no se anotan. Idempotente.
-- =============================================================================

create table if not exists public.equipo_aperturas (
  trabajador_id uuid primary key references public.trabajadores(id) on delete cascade,
  version       text not null default '',
  navegador     text not null default '',
  instalada     boolean,
  abierta_el    timestamptz not null default now(),
  -- Desde cuándo lleva esta versión (cambia cuando la app se actualiza).
  version_desde timestamptz not null default now()
);
comment on table public.equipo_aperturas is 'Última vez que cada persona del equipo abrió la app: versión, dispositivo y si está instalada (0048).';
alter table public.equipo_aperturas enable row level security;
revoke all on public.equipo_aperturas from public, anon, authenticated;

create or replace function public.registrar_apertura(p_version text, p_navegador text default '', p_instalada boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_tra uuid := public.auth_trabajador_id();
begin
  if v_tra is null then return; end if;  -- alumnos y cuentas sin ficha: nada
  insert into public.equipo_aperturas as a (trabajador_id, version, navegador, instalada)
  values (v_tra, left(coalesce(p_version, ''), 40), left(coalesce(p_navegador, ''), 300), p_instalada)
  on conflict (trabajador_id) do update
    set version_desde = case when a.version is distinct from excluded.version then now() else a.version_desde end,
        version = excluded.version, navegador = excluded.navegador, instalada = excluded.instalada, abierta_el = now();
end $$;
revoke all on function public.registrar_apertura(text, text, boolean) from public, anon;
grant execute on function public.registrar_apertura(text, text, boolean) to authenticated;

-- «iPhone», «Android», «ordenador Windows»… a partir del navegador (sin guardar nada más).
create or replace function public._tipo_dispositivo(p_navegador text)
returns text language sql immutable set search_path = public as $$
  select case when p_navegador is null or p_navegador = '' then null
              when p_navegador ~* 'iphone' then 'iPhone'
              when p_navegador ~* 'ipad' then 'iPad'
              when p_navegador ~* 'android' then 'Android'
              when p_navegador ~* 'windows' then 'ordenador Windows'
              when p_navegador ~* 'macintosh|mac os x' then 'Mac'
              when p_navegador ~* 'linux' then 'ordenador Linux'
              else 'otro' end
$$;

create or replace function public.informe_cambios_hoy()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_desde timestamptz := (date_trunc('day', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';
  v_ahora timestamp := now() at time zone 'Europe/Madrid';
  r jsonb;
begin
  with a as (
    select x.instante, x.accion, x.detalle, x.actor_nombre,
           case when exists (select 1 from public.trabajadores t where t.user_id = x.actor_id) then 'EQUIPO'
                when exists (select 1 from public.clientes c where c.user_id = x.actor_id) then 'ALUMNO'
                else 'AUTOMATICO' end as quien_tipo
      from public.auditoria x
     where x.instante >= v_desde
  ),
  -- Lo que no se lista uno a uno (son muchos y no son "cambios"): se cuenta.
  listables as (
    select * from a where accion not in ('ASISTENCIA', 'MANTENIMIENTO', 'GENERAR_CLASES', 'RESERVAS_AUTOMATICAS', 'FOTO_CLIENTE')
  )
  select jsonb_build_object(
    'generado', to_char(v_ahora, 'DD/MM/YYYY HH24:MI'),
    'equipo', coalesce((select jsonb_agg(jsonb_build_object('quien', public._anonimizar(actor_nombre), 'acciones', n) order by n desc)
                          from (select actor_nombre, count(*) as n from a where quien_tipo = 'EQUIPO' group by actor_nombre) e), '[]'),
    'acciones_equipo', coalesce((select jsonb_agg(jsonb_build_object('accion', accion, 'veces', n) order by n desc)
                                   from (select accion, count(*) as n from a where quien_tipo = 'EQUIPO' group by accion) e), '[]'),
    'acciones_alumnos', coalesce((select jsonb_agg(jsonb_build_object('accion', accion, 'veces', n, 'personas', p) order by n desc)
                                    from (select accion, count(*) as n, count(distinct actor_nombre) as p from a where quien_tipo = 'ALUMNO' group by accion) e), '[]'),
    'automaticas', (select count(*) from a where quien_tipo = 'AUTOMATICO'),
    'cambios_equipo', coalesce((select jsonb_agg(jsonb_build_object('hora', to_char(instante at time zone 'Europe/Madrid', 'HH24:MI'), 'quien', public._anonimizar(actor_nombre),
                                                                    'accion', accion, 'detalle', left(public._anonimizar(detalle), 140)) order by instante desc)
                                  from (select * from listables where quien_tipo = 'EQUIPO' order by instante desc limit 80) e), '[]'),
    'cambios_alumnos', coalesce((select jsonb_agg(jsonb_build_object('hora', to_char(instante at time zone 'Europe/Madrid', 'HH24:MI'), 'quien', public._anonimizar(actor_nombre),
                                                                     'accion', accion, 'detalle', left(public._anonimizar(detalle), 140)) order by instante desc)
                                   from (select * from listables where quien_tipo = 'ALUMNO' order by instante desc limit 40) e), '[]'),
    'cobros', jsonb_build_object(
      'cobrados', (select count(*) from public.pagos where estado = 'PAGADO' and pagado_el >= v_desde),
      'importe_centimos', (select coalesce(sum(importe_centimos), 0) from public.pagos where estado = 'PAGADO' and pagado_el >= v_desde),
      'pendientes_nuevos', (select count(*) from public.pagos where estado = 'PENDIENTE' and creado_el >= v_desde)),
    'sin_publicar', jsonb_build_object(
      'franjas', (select count(*) from public.plantillas_clase p where p.activa and p.eliminada_el is null and not coalesce((to_jsonb(p)->>'publicada')::boolean, true)),
      'clases', (select count(*) from public.clases c where c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) > v_ahora and not coalesce((to_jsonb(c)->>'publicada')::boolean, true)),
      'plazas', (select coalesce(sum(coalesce((to_jsonb(c)->>'plazas_retenidas')::integer, 0)), 0) from public.clases c where c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) > v_ahora)),
    'errores', case when to_regclass('public.errores_app') is null then 0 else (select count(*) from public.errores_app where instante >= v_desde) end
  ) into r;

  -- 0046: qué errores, no solo cuántos (mismo formato que en /errores).
  if to_regclass('public.errores_app') is not null then
    r := r || jsonb_build_object('errores_detalle', coalesce((
      select jsonb_agg(jsonb_build_object('mensaje', public._anonimizar(m), 'tipo', tipo, 'veces', veces, 'personas', personas, 'quien', quien, 'ultima', ultima) order by veces desc, ultima desc)
        from (select left(mensaje, 160) as m, tipo, count(*) as veces, count(distinct coalesce(user_id::text, navegador)) as personas,
                     string_agg(distinct tipo_usuario, ', ') as quien,
                     to_char(max(instante) at time zone 'Europe/Madrid', 'HH24:MI') as ultima
                from public.errores_app where instante >= v_desde
               group by 1, 2 order by 3 desc limit 10) y), '[]'));
  end if;
  -- 0048: qué versión de la app lleva cada persona del equipo y cuándo la abrió por última vez.
  if to_regclass('public.equipo_aperturas') is not null then
    r := r || jsonb_build_object('equipo_app', coalesce((
      select jsonb_agg(jsonb_build_object(
               'quien', upper(left(t.nombre, 1)) || '.' || upper(left(coalesce(nullif(t.apellidos, ''), '-'), 1)) || '.',
               'version', case when a.version ~ '^\d{4}-\d{2}-\d{2}T' then to_char(a.version::timestamptz at time zone 'Europe/Madrid', 'DD/MM HH24:MI') else nullif(a.version, '') end,
               'antigua', a.version is not null and a.version < (select max(x.version) from public.equipo_aperturas x),
               'abierta', to_char(a.abierta_el at time zone 'Europe/Madrid', 'DD/MM HH24:MI'),
               'abierta_hoy', a.abierta_el >= v_desde,
               'movil', public._tipo_dispositivo(a.navegador),
               'instalada', a.instalada)
             order by a.abierta_el desc nulls last, t.nombre)
        from public.trabajadores t left join public.equipo_aperturas a on a.trabajador_id = t.id
       where t.activo and t.user_id is not null), '[]'));
  end if;
  return r;
end $$;
comment on function public.informe_cambios_hoy() is 'Lo que se ha cambiado hoy desde las 00:00, con los errores, sin datos personales, para el bot de Telegram (0045, 0046, 0048).';
revoke all on function public.informe_cambios_hoy() from public, anon, authenticated;
grant execute on function public.informe_cambios_hoy() to service_role;
