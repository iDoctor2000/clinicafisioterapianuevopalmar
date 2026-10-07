-- =============================================================================
-- 0014_logros.sql · Medallas, cumpleaños y "Tu año en Pilates"
--
--   1. clientes.fecha_nacimiento (opcional): para felicitar al alumno el día de su
--      cumpleaños. El propio cliente puede ponerla desde su perfil (el trigger de
--      autoedición de 0007 no la bloquea).
--   2. config_centro: texto de la felicitación y ventana de "Tu año en Pilates".
--   3. Consultas de solo lectura (security definer, con sus permisos):
--      · historial_clases(cliente): clases hechas de un alumno (medallas y resumen anual).
--      · conteo_clases(clientes, hasta): cuántas lleva cada uno (aviso de "clase 100" al pasar lista).
--      · resumen_centro(año): "El año del centro" para administración.
--   Una clase cuenta como hecha si la reserva sigue en pie, la clase no se canceló, no se
--   marcó "No asiste" y ya ha empezado (espejo de app/src/domain/logros.ts).
--   Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fecha de nacimiento
-- -----------------------------------------------------------------------------
alter table public.clientes add column if not exists fecha_nacimiento date;
do $$ begin
  alter table public.clientes add constraint clientes_fecha_nacimiento_valida
    check (fecha_nacimiento is null or fecha_nacimiento between date '1900-01-01' and date '2100-01-01');
exception when duplicate_object then null; end $$;
comment on column public.clientes.fecha_nacimiento is 'Opcional. Solo para felicitar al alumno el día de su cumpleaños.';

-- -----------------------------------------------------------------------------
-- 2. Configuración de las sorpresas
-- -----------------------------------------------------------------------------
alter table public.config_centro
  add column if not exists mensaje_cumpleanos   text not null default '',
  add column if not exists resumen_anual_activo boolean not null default true,
  add column if not exists resumen_anual_desde  text not null default '12-15',
  add column if not exists resumen_anual_hasta  text not null default '01-15';
do $$ begin
  alter table public.config_centro add constraint config_resumen_fechas_validas
    check (resumen_anual_desde ~ '^\d{2}-\d{2}$' and resumen_anual_hasta ~ '^\d{2}-\d{2}$');
exception when duplicate_object then null; end $$;
comment on column public.config_centro.mensaje_cumpleanos is 'Texto de la felicitación de cumpleaños. Vacío = el de por defecto de la app.';
comment on column public.config_centro.resumen_anual_desde is '"Tu año en Pilates" se muestra desde este día (MM-DD)…';
comment on column public.config_centro.resumen_anual_hasta is '…hasta este (MM-DD). Si hasta < desde, la ventana cruza el fin de año.';

-- -----------------------------------------------------------------------------
-- 3a. Clases hechas de un alumno
-- -----------------------------------------------------------------------------
create or replace function public._clases_hechas(p_cliente_id uuid, p_hasta timestamp)
returns table (fecha date, hora_inicio time, duracion_min integer, actividad_id uuid, monitor_id uuid)
language sql stable security definer set search_path = public as $$
  select c.fecha, c.hora_inicio, c.duracion_min, c.actividad_id, c.monitor_id
    from public.reservas r
    join public.clases c on c.id = r.clase_id
   where r.cliente_id = p_cliente_id
     and r.estado = 'RESERVADA' and r.asistencia <> 'NO_ASISTE'
     and c.estado <> 'CANCELADA'
     and (c.fecha + c.hora_inicio) <= p_hasta
   order by c.fecha, c.hora_inicio
$$;

-- El alumno ve el suyo; el personal con CLIENTES_VER, el de sus clientes (según ámbito).
-- Devuelve jsonb (una sola fila) para no chocar con el límite de filas de la API.
create or replace function public.historial_clases(p_cliente_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cliente uuid := coalesce(p_cliente_id, public.auth_cliente_id());
begin
  if v_cliente is null then raise exception 'Falta el cliente.'; end if;
  if not (v_cliente = public.auth_cliente_id() or (public.tiene_permiso('CLIENTES_VER') and public.alcance_cliente(v_cliente))) then
    raise exception 'No tienes permiso para ver estas clases.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('f', h.fecha, 'h', to_char(h.hora_inicio, 'HH24:MI'), 'd', h.duracion_min, 'a', h.actividad_id, 'm', h.monitor_id))
      from public._clases_hechas(v_cliente, public._ahora_local()) h
  ), '[]'::jsonb);
end $$;
comment on function public.historial_clases(uuid) is 'Clases hechas de un alumno (medallas y "Tu año en Pilates"). El propio alumno o personal con CLIENTES_VER.';

-- -----------------------------------------------------------------------------
-- 3b. Cuántas clases lleva cada alumno hasta un día (incluido): aviso de cifras redondas
-- -----------------------------------------------------------------------------
create or replace function public.conteo_clases(p_clientes uuid[], p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_hasta date := coalesce(p_hasta, public._hoy());
begin
  if public.auth_trabajador_id() is null then
    raise exception 'Solo para el personal.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_object_agg(x.cliente_id, x.n) from (
      select r.cliente_id, count(*) as n
        from public.reservas r join public.clases c on c.id = r.clase_id
       where r.cliente_id = any (coalesce(p_clientes, '{}'))
         and r.estado = 'RESERVADA' and r.asistencia <> 'NO_ASISTE' and c.estado <> 'CANCELADA'
         and c.fecha <= v_hasta
       group by r.cliente_id
    ) x
  ), '{}'::jsonb);
end $$;
comment on function public.conteo_clases(uuid[], date) is 'Clases hechas por cada alumno hasta un día incluido. Solo personal.';

-- -----------------------------------------------------------------------------
-- 3c. "El año del centro" (administración y quien vea estadísticas)
-- -----------------------------------------------------------------------------
create or replace function public.resumen_centro(p_anio integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (public.es_admin() or public.tiene_permiso('ESTADISTICAS_VER')) then
    raise exception 'No tienes permiso para ver el resumen del centro.' using errcode = 'insufficient_privilege';
  end if;
  with hechas as (
    select r.cliente_id, c.id as clase_id, c.fecha, c.hora_inicio, c.duracion_min, c.actividad_id
      from public.reservas r join public.clases c on c.id = r.clase_id
     where r.estado = 'RESERVADA' and r.asistencia <> 'NO_ASISTE' and c.estado <> 'CANCELADA'
       and extract(year from c.fecha) = p_anio and (c.fecha + c.hora_inicio) <= public._ahora_local()
  )
  select jsonb_build_object(
    'total', (select count(*) from hechas),
    'alumnos', (select count(distinct cliente_id) from hechas),
    'horas', (select coalesce(round(sum(duracion_min) / 60.0), 0) from hechas),
    'clases', (select count(distinct clase_id) from hechas),
    'actividad', (select jsonb_build_object('id', actividad_id, 'n', n) from (select actividad_id, count(*) n from hechas group by 1 order by 2 desc limit 1) t),
    'mes', (select jsonb_build_object('mes', m, 'n', n) from (select extract(month from fecha)::int m, count(*) n from hechas group by 1 order by 2 desc limit 1) t),
    'dia', (select jsonb_build_object('dia', d, 'n', n) from (select extract(isodow from fecha)::int d, count(*) n from hechas group by 1 order by 2 desc limit 1) t),
    'hora', (select jsonb_build_object('hora', to_char(hora_inicio, 'HH24:MI'), 'n', n) from (select hora_inicio, count(*) n from hechas group by 1 order by 2 desc limit 1) t)
  ) into v;
  return v;
end $$;
comment on function public.resumen_centro(integer) is '"El año del centro": totales del año. Administración o ESTADISTICAS_VER.';

revoke all on function public._clases_hechas(uuid, timestamp) from public, anon, authenticated;
revoke all on function public.historial_clases(uuid) from public, anon;
revoke all on function public.conteo_clases(uuid[], date) from public, anon;
revoke all on function public.resumen_centro(integer) from public, anon;
grant execute on function public.historial_clases(uuid) to authenticated;
grant execute on function public.conteo_clases(uuid[], date) to authenticated;
grant execute on function public.resumen_centro(integer) to authenticated;
