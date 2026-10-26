#!/usr/bin/env bash
# =============================================================================
# resumen-diario.sh · Resumen de actividad de las últimas 24 horas, SIN datos personales
#
# Solo cifras (cuántas reservas, cuántas contrataciones…) y comprobaciones de salud
# (¿se ha ejecutado el mantenimiento nocturno?, ¿hay clases con más alumnos que plazas?).
# Nunca nombres, correos ni datos de salud: el repositorio es público y el resultado
# queda en el registro de la tarea de GitHub, que cualquiera puede ver.
#
# Uso:  SUPABASE_DB_PASSWORD=... bash scripts/copias/resumen-diario.sh
#       (o SUPABASE_DB_URL=postgresql://...). Lo ejecuta cada noche copia-seguridad.yml.
# =============================================================================
set -euo pipefail

# Misma conexión que hacer-copia.sh: basta la contraseña de la base de datos.
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-mgiekkqbgptxmqcrhxlr}"
SUPABASE_DB_HOST="${SUPABASE_DB_HOST:-aws-0-eu-central-1.pooler.supabase.com}"
recortar() { printf '%s' "$1" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
if [[ -z "${SUPABASE_DB_PASSWORD:-}" && -n "${SUPABASE_DB_URL:-}" && ! "$(recortar "$SUPABASE_DB_URL")" =~ ^postgres(ql)?:// ]]; then
  SUPABASE_DB_PASSWORD="$SUPABASE_DB_URL"; SUPABASE_DB_URL=""
fi
if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  CLAVE_URI="$(jq -rn --arg p "$(recortar "$SUPABASE_DB_PASSWORD")" '$p|@uri')"
  SUPABASE_DB_URL="postgresql://postgres.${SUPABASE_PROJECT_REF}:${CLAVE_URI}@${SUPABASE_DB_HOST}:5432/${SUPABASE_DB_NAME:-postgres}"
fi
SUPABASE_DB_URL="$(recortar "${SUPABASE_DB_URL:-}")"
: "${SUPABASE_DB_URL:?Falta la conexión: SUPABASE_DB_PASSWORD o SUPABASE_DB_URL}"

# Una sola consulta de solo lectura: todo son recuentos.
RESUMEN="$(psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q -At <<'SQL'
begin transaction read only;
with
  hoy as (select public._hoy() as d),
  mov as (
    select case accion
             when 'RESERVAR' then 'Reservas hechas'
             when 'ANADIR_ALUMNO' then 'Alumnos apuntados por el equipo'
             when 'CANCELAR_RESERVA' then 'Reservas canceladas o quitadas'
             when 'ASISTENCIA' then 'Asistencias registradas (pasar lista)'
             when 'AUTORIZAR_RECUPERACION' then 'Recuperaciones autorizadas'
             when 'CREAR_CONTRATO' then 'Contrataciones nuevas'
             when 'EDITAR_CONTRATO' then 'Contrataciones editadas'
             when 'FINALIZAR_CONTRATO' then 'Contrataciones finalizadas'
             when 'RESERVAS_AUTOMATICAS' then 'Repasos de reservas fijas'
             when 'CANCELAR_CLASE' then 'Clases canceladas'
             when 'EDITAR_HORARIO' then 'Cambios en el horario'
             when 'PUBLICAR_AVISO' then 'Avisos enviados'
             when 'CONSENTIMIENTO' then 'Consentimientos firmados en la app'
             when 'CONSENTIMIENTO_PAPEL' then 'Consentimientos en papel registrados'
             when 'CLIENTE_DEL_MES' then 'Cliente del mes anunciado'
             when 'QUITAR_CLIENTE_DEL_MES' then 'Cliente del mes quitado'
             else initcap(replace(lower(accion), '_', ' ')) end as accion,
           count(*) as n from public.auditoria
     where instante > now() - interval '24 hours' and accion not in ('MANTENIMIENTO', 'GENERAR_CLASES', 'SEED')
     group by 1
  ),
  ocupacion as (
    select c.id, c.plazas, count(r.id) filter (where r.estado = 'RESERVADA') as n
      from public.clases c left join public.reservas r on r.clase_id = c.id
     where c.estado = 'PROGRAMADA' and c.fecha >= (select d from hoy)
     group by c.id, c.plazas
  ),
  fijos_sin_reservas as (
    select k.id from public.contratos k
     where k.estado = 'ACTIVO' and k.modalidad = 'FIJO' and k.fecha_fin >= (select d from hoy)
       and not exists (select 1 from public.reservas r join public.clases c on c.id = r.clase_id
                        where r.contrato_id = k.id and r.estado = 'RESERVADA' and c.fecha >= (select d from hoy))
  ),
  -- Vigilancia: cada clase de los próximos 14 días de las franjas de cada contrato fijo activo, y qué tiene el alumno en ella.
  huecos_fijos as (
    select k.id as contrato_id, c.id as clase_id,
           exists (select 1 from public.reservas r where r.clase_id = c.id and r.cliente_id = k.cliente_id and r.estado = 'RESERVADA') as tiene_plaza,
           exists (select 1 from public.reservas r where r.clase_id = c.id and r.cliente_id = k.cliente_id and r.estado in ('CANCELADA_RECUPERABLE', 'CANCELADA_NO_RECUPERABLE')) as cancelo_el_alumno,
           (select count(*) from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA') >= c.plazas as completa
      from public.contratos k
      join public.contrato_franjas f on f.contrato_id = k.id
      join public.clases c on c.plantilla_id = f.plantilla_id and c.estado = 'PROGRAMADA'
     where k.estado = 'ACTIVO' and k.modalidad = 'FIJO'
       and c.fecha between (select d from hoy) and least(k.fecha_fin, (select d from hoy) + 14)
  ),
  vig(o, aviso, texto, n, que_hacer) as (
    values
      (1, true, 'Clases fijas sin apuntar aunque hay plaza',
        (select count(*) from huecos_fijos where not tiene_plaza and not cancelo_el_alumno and not completa),
        'Un alumno de horario fijo no está apuntado a una clase de su franja y la clase tiene sitio: el mantenimiento nocturno debería haberlo hecho. Pulsa "Rehacer las reservas fijas de todos" en Ajustes y, si vuelve a salir mañana, avisa a quien mantiene la app.'),
      (2, false, 'Alumnos de horario fijo sin plaza en una clase suya porque está completa',
        (select count(*) from huecos_fijos where not tiene_plaza and not cancelo_el_alumno and completa),
        'Esa clase se llenó mientras el alumno no estaba apuntado. Si quiere ir, que se apunte a la lista de espera o apúntalo a mano cuando se libere plaza.'),
      (3, true, 'Reservas fijas "canceladas por el centro" en clases que siguen programadas',
        (select count(*) from public.reservas r join public.clases c on c.id = r.clase_id
          where r.origen = 'AUTOMATICA' and r.estado = 'CANCELADA_CENTRO' and c.estado = 'PROGRAMADA' and c.fecha >= (select d from hoy)),
        'Son restos de finalizar un contrato: el alumno las ve como "cancelada por el centro" sin serlo. No debería ocurrir desde la 0023; avisa a quien mantiene la app.'),
      (5, true, 'Horarios fijos apuntados a una franja eliminada o desactivada',
        (select count(*) from public.contrato_franjas f join public.contratos k on k.id = f.contrato_id join public.plantillas_clase p on p.id = f.plantilla_id
          where k.estado = 'ACTIVO' and k.modalidad = 'FIJO' and k.fecha_fin >= (select d from hoy) and (not p.activa or p.eliminada_el is not null)),
        'El alumno no tendrá clases de esa franja. Edita su contratación (ficha → Tarifa → Editar contratación) y elige una franja activa.'),
      (6, true, 'Franjas activas sin ninguna clase en los próximos 14 días',
        (select count(*) from public.plantillas_clase p
          where p.activa and p.eliminada_el is null
            and (p.vigencia_desde is null or p.vigencia_desde <= (select d from hoy) + 14)
            and (p.vigencia_hasta is null or p.vigencia_hasta >= (select d from hoy))
            and not exists (select 1 from public.clases c where c.plantilla_id = p.id and c.fecha between (select d from hoy) and (select d from hoy) + 14)),
        'Las clases se crean cada noche a partir de las franjas; si una franja activa no tiene clases, algo falla en la generación. Guarda la franja en Horarios sin cambiar nada y, si no aparecen, avisa a quien mantiene la app.'),
      (7, true, 'Avisos de la lista de espera sin enviar al móvil desde hace más de un día',
        (select count(*) from public.avisos_push_pendientes where creado_el < now() - interval '1 day'),
        'La app los manda al abrirse; si llevan más de un día es que la función de notificaciones (enviar-push) falla. El aviso sí se ve dentro de la app. Avisa a quien mantiene la app.'),
      (8, true, 'Lista de espera con entradas de clases ya pasadas',
        (select count(*) from public.lista_espera e join public.clases c on c.id = e.clase_id where (c.fecha + c.hora_inicio) < public._ahora_local() - interval '1 day'),
        'El mantenimiento nocturno debería haberlas limpiado. Avisa a quien mantiene la app.'),
      (9, false, 'Alumnos con reservas futuras y sin tarifa activa',
        (select count(distinct r.cliente_id) from public.reservas r join public.clases c on c.id = r.clase_id
          where r.estado = 'RESERVADA' and c.estado = 'PROGRAMADA' and c.fecha >= (select d from hoy) and r.origen in ('AUTOMATICA', 'CLIENTE', 'BONO', 'RECUPERACION')
            and not exists (select 1 from public.contratos k where k.cliente_id = r.cliente_id and k.estado = 'ACTIVO')),
        'Tienen clases reservadas pero su contrato ha terminado o se finalizó. Si siguen viniendo, hazles la contratación nueva (no uses "Finalizar"); si no, cancela sus reservas.'),
      (10, false, 'Contratos activos que terminan en los próximos 7 días',
        (select count(*) from public.contratos where estado = 'ACTIVO' and fecha_fin between (select d from hoy) and (select d from hoy) + 7),
        'Para renovarlos todos de golpe, usa el botón "Renovar" del aviso del Calendario (o "Renovar contratos" en Clientes): se alargan un mes con sus mismas clases y se crea el cobro. Los bonos, desde la ficha con "Nueva contratación".'),
      (11, false, 'Clases de ayer sin pasar lista',
        (select count(*) from public.clases c
          where c.estado = 'PROGRAMADA' and c.fecha = (select d from hoy) - 1
            and exists (select 1 from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA')
            and not exists (select 1 from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA' and r.asistencia <> 'PENDIENTE')),
        'Las medallas y el cliente del mes cuentan las clases con asistencia marcada. Se puede marcar a posteriori desde la ficha de la clase.'),
      -- 0029: cada cobro tiene su mes; dos cobrados el mismo mes puede ser correcto (tarifa y bono) o un apunte repetido.
      (12, false, 'Alumnos con el mismo mes cobrado dos veces (este mes o los dos anteriores)',
        (select count(distinct cliente_id) from (select cliente_id from public.pagos
          where estado = 'PAGADO' and mes >= (date_trunc('month', (select d from hoy)) - interval '2 months')::date
          group by cliente_id, mes having count(*) > 1) x),
        'Puede ser correcto (su tarifa y un bono). Si es el mismo pago apuntado dos veces, en la app: Más → Cobros → pestaña Repetidos, y se borra el que sobre desde la ficha del alumno.')
  )
select line from (
  select 1 as o, '## Resumen de las últimas 24 horas (' || to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') || ', hora de Madrid)' as line
  union all select 2, ''
  union all select 3, '### Movimientos'
  union all select 4, '| Qué | Cuántos |'
  union all select 5, '|---|---|'
  union all select 6, '| ' || accion || ' | ' || n || ' |' from mov
  union all select 7, case when not exists (select 1 from mov) then '| (ninguno) | 0 |' end
  union all select 8, '| Personas del equipo que han hecho cambios | ' ||
      (select count(distinct a.actor_id) from public.auditoria a join public.trabajadores t on t.user_id = a.actor_id where a.instante > now() - interval '24 hours') || ' |'
  union all select 9, '| Alumnos que han iniciado sesión | ' ||
      (select count(*) from auth.users u join public.clientes c on c.user_id = u.id where (to_jsonb(u) ->> 'last_sign_in_at')::timestamptz > now() - interval '24 hours') || ' |'
  union all select 10, ''
  union all select 11, '### Estado'
  union all select 12, '| Qué | Valor |'
  union all select 13, '|---|---|'
  union all select 14, '| Mantenimiento nocturno (crea clases y reservas fijas) | ' ||
      case when exists (select 1 from public.auditoria where accion = 'MANTENIMIENTO' and instante > now() - interval '26 hours') then 'hecho' else '⚠️ NO se ha ejecutado' end || ' |'
  union all select 15, '| Alumnos activos | ' || (select count(*) from public.clientes where activo) || ' |'
  union all select 16, '| Alumnos activos con la cuenta de la app enlazada | ' || (select count(*) from public.clientes where activo and user_id is not null) || ' |'
  union all select 17, '| Contrataciones activas | ' || (select count(*) from public.contratos where estado = 'ACTIVO') || ' |'
  union all select 18, '| Clases futuras programadas | ' || (select count(*) from ocupacion) || ' |'
  union all select 19, '| Clases con más alumnos que plazas | ' || (select count(*) from ocupacion where n > plazas) || case when (select count(*) from ocupacion where n > plazas) > 0 then ' ⚠️' else '' end || ' |'
  -- Informativo (ℹ️): si el alumno canceló él sus clases o la franja está completa es normal; los casos que
  -- hay que arreglar los señala la vigilancia con ⚠️ (clase fija sin apuntar con plaza, franja sin clases).
  union all select 20, '| Contratos de horario fijo sin ninguna clase futura apuntada | ' || (select count(*) from fijos_sin_reservas) || case when (select count(*) from fijos_sin_reservas) > 0 then ' ℹ️' else '' end || ' |'
  union all select 21, '| Cobros pendientes ya vencidos | ' || (select count(*) from public.pagos where estado = 'PENDIENTE' and vence_el < (select d from hoy)) || ' |'
  union all select 22, '| Cambios de la base de datos (migraciones) | ' || (
      with m(n, ok) as (values
        ('0014', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clientes' and column_name = 'fecha_nacimiento')),
        ('0015', to_regclass('public.copias_seguridad') is not null),
        ('0016', to_regclass('public.premios_mes') is not null),
        ('0017', exists (select 1 from pg_trigger where tgname = 'clientes_vincular_usuario')),
        ('0018', to_regclass('public.ocupacion_clases') is not null),
        ('0019', to_regprocedure('public._generar_reservas_automaticas(uuid, boolean)') is not null),
        ('0020', to_regprocedure('public._cancelar_clases_cierre()') is not null),
        ('0021', to_regclass('public.lista_espera') is not null),
        ('0022', pg_get_functiondef('public._generar_reservas_automaticas(uuid, boolean)'::regprocedure) like '%CANCELADA_CENTRO%'),
        ('0023', pg_get_functiondef('public.finalizar_contrato(uuid, boolean)'::regprocedure) like '%delete from public.reservas%'),
        ('0024', to_regclass('public.contratos_finanzas') is not null),
        ('0025', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clientes' and column_name = 'consentimiento_adjunto')
                 and (to_regclass('storage.buckets') is null or exists (select 1 from storage.buckets where id = 'consentimientos'))),
        ('0026', to_regclass('public.push_personal_pendientes') is not null),
        ('0027', to_regclass('public.contratos_pago') is not null),
        ('0028', to_regprocedure('public.renovar_contratos(uuid[], date)') is not null),
        ('0029', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pagos' and column_name = 'mes')),
        ('0030', not exists (select 1 from public.pagos where lower(concepto) ~ '^(mes \d+|renovación) · ')))
      select case when bool_and(ok) then 'todas aplicadas, hasta la ' || max(n)
                  else '⚠️ falta ejecutar: ' || string_agg(n, ', ' order by n) filter (where not ok) end
        from m) || ' |'
  -- Tareas programadas en la base de datos (pg_cron): el mantenimiento nocturno y la notificación de cumpleaños (0026).
  union all select 23, '| Tareas automáticas programadas | ' || (
      case when to_regclass('cron.job') is null then 'sin pg_cron'
           else coalesce((select string_agg(jobname || case when active then '' else ' (pausada) ⚠️' end, ', ' order by jobname)
                            from cron.job where jobname in ('mantenimiento-diario', 'push-cumpleanos')), '⚠️ ninguna')
                || case when (select count(*) from cron.job where jobname in ('mantenimiento-diario', 'push-cumpleanos')) < 2 then ' ⚠️ falta alguna' else '' end
      end) || ' |'
  -- La función enviar-push usa el rol service_role: sin permiso de lectura no sale ninguna notificación (0027).
  union all select 25, '| La función de notificaciones puede leer los avisos | ' ||
      case when not exists (select 1 from pg_roles where rolname = 'service_role') then 'sin rol service_role'
           when has_table_privilege('service_role', 'public.avisos', 'SELECT') and has_table_privilege('service_role', 'public.suscripciones_push', 'SELECT') then 'sí'
           else '⚠️ NO: no llega ninguna notificación al móvil (falta la migración 0027)' end || ' |'
  union all select 24, '| Personas con acceso a cobros | ' || (select count(*) from public.trabajadores t where t.activo and coalesce((to_jsonb(t)->>'ve_finanzas')::boolean, false))
      || case when (select count(*) from public.trabajadores t where t.activo and coalesce((to_jsonb(t)->>'ve_finanzas')::boolean, false)) = 0 then ' ⚠️ nadie' else '' end || ' |'
  union all select 30, ''
  union all select 31, '### Vigilancia'
  union all select 32, '| Qué | Cuántos |'
  union all select 33, '|---|---|'
  union all select 33 + vig.o, '| ' || texto || ' | ' || n || case when n > 0 then case when aviso then ' ⚠️' else ' ℹ️' end else '' end || ' |' from vig
  union all select 50, case when exists (select 1 from vig where n > 0) then '' end
  union all select 51, case when exists (select 1 from vig where n > 0) then '### Qué hacer' end
  union all select 51 + vig.o, '- ' || case when aviso then '⚠️' else 'ℹ️' end || ' **' || texto || ' (' || n || ')**: ' || que_hacer from vig where n > 0
) t where line is not null order by o, line;
commit;
SQL
)"

echo "$RESUMEN"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "$RESUMEN" >> "$GITHUB_STEP_SUMMARY"; fi
# El workflow lee este archivo para abrir (o cerrar) el aviso de vigilancia en GitHub.
if [[ -n "${RESUMEN_ARCHIVO:-}" ]]; then echo "$RESUMEN" > "$RESUMEN_ARCHIVO"; fi
