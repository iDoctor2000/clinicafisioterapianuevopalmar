-- =============================================================================
-- 0046_informe_hoy_errores.sql · /informehoy dice también qué errores ha habido hoy
--
--   `informe_cambios_hoy()` (0045) daba solo el número de errores de hoy. Ahora añade
--   `errores_detalle`: los mensajes de hoy desde las 00:00 (sin datos personales), cuántas veces,
--   a cuántas personas, si fue el equipo o un alumno, y la hora del último. Idempotente.
-- =============================================================================

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
  return r;
end $$;
comment on function public.informe_cambios_hoy() is 'Lo que se ha cambiado hoy desde las 00:00, con los errores, sin datos personales, para el bot de Telegram (0045, 0046).';
revoke all on function public.informe_cambios_hoy() from public, anon, authenticated;
grant execute on function public.informe_cambios_hoy() to service_role;
