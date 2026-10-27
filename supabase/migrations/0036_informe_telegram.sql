-- =============================================================================
-- 0036_informe_telegram.sql · Informe de uso y errores para el bot de Telegram
--
--   `informe_uso(p_dias)` devuelve en un solo JSON lo mismo que el informe de uso de GitHub
--   (scripts/diagnostico/uso.sh): alumnos que usan la app, qué hacen, avisos leídos, uso de
--   cada persona del equipo, pasar lista, errores que ha visto la gente y otras señales.
--   Lo llama la función `telegram` (Edge Function) cuando el administrador escribe /informe.
--     · Sin datos personales: los nombres salen como iniciales y los correos como [correo]
--       (también dentro de los mensajes de error).
--     · Solo la puede ejecutar el servidor (service_role); ni la app ni nadie de fuera.
--   Idempotente.
-- =============================================================================

-- Cambia en un texto los nombres de alumnos y del equipo por sus iniciales y los correos por [correo].
create or replace function public._anonimizar(p_texto text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v text := coalesce(p_texto, '');
  r record;
begin
  if v = '' then return v; end if;
  v := regexp_replace(v, '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[correo]', 'g');
  for r in
    select n, i from (
      select trim(nombre || ' ' || apellidos) as n, upper(left(trim(nombre), 1)) || '.' || upper(left(trim(apellidos), 1)) || '.' as i from public.clientes
      union all select trim(nombre), upper(left(trim(nombre), 1)) || '.' from public.clientes where length(trim(nombre)) > 2
      union all select trim(nombre || ' ' || apellidos), upper(left(trim(nombre), 1)) || '.' || upper(left(trim(apellidos), 1)) || '.' from public.trabajadores
      union all select trim(nombre), upper(left(trim(nombre), 1)) || '.' from public.trabajadores where length(trim(nombre)) > 2
    ) x
    where length(n) >= 3
    order by length(n) desc
  loop
    if position(lower(r.n) in lower(v)) > 0 then
      v := regexp_replace(v, '\m' || regexp_replace(r.n, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M', r.i, 'gi');
    end if;
  end loop;
  return v;
end $$;
revoke all on function public._anonimizar(text) from public, anon, authenticated;

create or replace function public.informe_uso(p_dias integer default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_dias   integer := least(greatest(coalesce(p_dias, 7), 1), 90);
  v_desde  timestamptz := now() - make_interval(days => least(greatest(coalesce(p_dias, 7), 1), 90));
  v_uso    jsonb := '{}';
  r        jsonb;
begin
  -- Último uso de la app por usuario (sesiones de Supabase), si la tabla existe.
  if to_regclass('auth.sessions') is not null then
    execute $q$
      select coalesce(jsonb_object_agg(user_id::text, cuando), '{}'::jsonb) from (
        select s.user_id, max(greatest(s.created_at, coalesce(s.updated_at, s.created_at), coalesce(s.refreshed_at::timestamptz, s.created_at))) as cuando
          from auth.sessions s group by s.user_id) x $q$ into v_uso;
  end if;

  with actores as (
    select c.user_id, 'ALUMNO'::text as tipo from public.clientes c where c.user_id is not null
    union all
    select t.user_id, 'EQUIPO' from public.trabajadores t where t.user_id is not null
  )
  select jsonb_build_object(
    'generado', to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'),
    'dias', v_dias,
    'alumnos', jsonb_build_object(
      'activos', (select count(*) from public.clientes where activo),
      'con_cuenta', (select count(*) from public.clientes where activo and user_id is not null),
      'uso_dia', (select count(*) from public.clientes c where c.activo and (v_uso ->> c.user_id::text)::timestamptz > now() - interval '1 day'),
      'uso_7', (select count(*) from public.clientes c where c.activo and (v_uso ->> c.user_id::text)::timestamptz > now() - interval '7 days'),
      'uso_30', (select count(*) from public.clientes c where c.activo and (v_uso ->> c.user_id::text)::timestamptz > now() - interval '30 days'),
      'notificaciones', (select count(distinct s.cliente_id) from public.suscripciones_push s join public.clientes c on c.id = s.cliente_id where c.activo)
    ),
    'acciones_alumnos', coalesce((
      select jsonb_agg(jsonb_build_object('accion', accion, 'veces', veces, 'personas', personas) order by veces desc)
        from (select a.accion, count(*) as veces, count(distinct a.actor_id) as personas
                from public.auditoria a join actores x on x.user_id = a.actor_id and x.tipo = 'ALUMNO'
               where a.instante > v_desde group by a.accion) y), '[]'),
    'avisos', (
      select jsonb_build_object('avisos', count(distinct v.id), 'entregas', count(d.cliente_id), 'leidos', count(l.cliente_id))
        from public.avisos v
        join public.aviso_destinatarios d on d.aviso_id = v.id
        left join public.aviso_lecturas l on l.aviso_id = v.id and l.cliente_id = d.cliente_id
       where v.publicado_el > v_desde),
    'equipo', coalesce((
      select jsonb_agg(jsonb_build_object(
               'quien', upper(left(trim(t.nombre), 1)) || '.' || upper(left(trim(t.apellidos), 1)) || '.',
               'rol', t.rol,
               'acciones', (select count(*) from public.auditoria a where a.actor_id = t.user_id and a.instante > v_desde),
               'dias', (select count(distinct (a.instante at time zone 'Europe/Madrid')::date) from public.auditoria a where a.actor_id = t.user_id and a.instante > v_desde),
               'ultimo_uso', to_char(((v_uso ->> t.user_id::text)::timestamptz) at time zone 'Europe/Madrid', 'DD/MM HH24:MI'))
             order by (select count(*) from public.auditoria a where a.actor_id = t.user_id and a.instante > v_desde) desc)
        from public.trabajadores t where t.activo and t.user_id is not null), '[]'),
    'equipo_sin_cuenta', (select count(*) from public.trabajadores where activo and user_id is null),
    'acciones_equipo', coalesce((
      select jsonb_agg(jsonb_build_object('accion', accion, 'veces', veces) order by veces desc)
        from (select a.accion, count(*) as veces
                from public.auditoria a join actores x on x.user_id = a.actor_id and x.tipo = 'EQUIPO'
               where a.instante > v_desde group by a.accion order by 2 desc limit 8) y), '[]'),
    'lista', (
      select jsonb_build_object('clases', count(*), 'marcadas', count(*) filter (where marcada))
        from (select c.id, bool_or(r.asistencia <> 'PENDIENTE') as marcada
                from public.clases c join public.reservas r on r.clase_id = c.id and r.estado = 'RESERVADA'
               where c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) < public._ahora_local()
                 and (c.fecha + c.hora_inicio) > (v_desde at time zone 'Europe/Madrid')
               group by c.id) x),
    'senales', jsonb_build_object(
      'push_atascados', (select count(*) from public.avisos_push_pendientes where creado_el < now() - interval '1 day'),
      'mantenimientos_7', (select count(*) from public.auditoria where accion = 'MANTENIMIENTO' and instante > now() - interval '7 days'),
      'ultima_copia', (select to_char(max(hecha_el) at time zone 'Europe/Madrid', 'DD/MM HH24:MI') from public.copias_seguridad),
      'clases_canceladas', (select count(*) from public.auditoria where accion = 'CANCELAR_CLASE' and instante > v_desde),
      'cobros_vencidos', (select count(*) from public.pagos where estado = 'PENDIENTE' and vence_el < public._hoy())
    )
  ) into r;

  -- Errores que ha visto la gente (0035), si la tabla existe.
  if to_regclass('public.errores_app') is not null then
    r := r || jsonb_build_object('errores', jsonb_build_object(
      'total', (select count(*) from public.errores_app where instante > v_desde),
      'personas', (select count(distinct coalesce(user_id::text, navegador)) from public.errores_app where instante > v_desde),
      'por_quien', coalesce((select jsonb_object_agg(tipo_usuario, n) from (select tipo_usuario, count(*) as n from public.errores_app where instante > v_desde group by 1) x), '{}'),
      'top', coalesce((
        select jsonb_agg(jsonb_build_object('mensaje', public._anonimizar(m), 'tipo', tipo, 'veces', veces, 'personas', personas, 'quien', quien, 'ultima', ultima) order by veces desc)
          from (select left(mensaje, 160) as m, tipo, count(*) as veces, count(distinct coalesce(user_id::text, navegador)) as personas,
                       string_agg(distinct tipo_usuario, ', ') as quien,
                       to_char(max(instante) at time zone 'Europe/Madrid', 'DD/MM HH24:MI') as ultima
                  from public.errores_app where instante > v_desde
                 group by 1, 2 order by 3 desc limit 8) y), '[]')));
  end if;
  return r;
end $$;
comment on function public.informe_uso(integer) is 'Informe de uso y errores (sin datos personales) para el bot de Telegram (0036). Solo service_role.';
revoke all on function public.informe_uso(integer) from public, anon, authenticated;
grant execute on function public.informe_uso(integer) to service_role;
