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
  union all select 20, '| Contratos de horario fijo sin ninguna clase futura apuntada | ' || (select count(*) from fijos_sin_reservas) || case when (select count(*) from fijos_sin_reservas) > 0 then ' ⚠️' else '' end || ' |'
  union all select 21, '| Cobros pendientes ya vencidos | ' || (select count(*) from public.pagos where estado = 'PENDIENTE' and vence_el < (select d from hoy)) || ' |'
) t where line is not null order by o, line;
commit;
SQL
)"

echo "$RESUMEN"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "$RESUMEN" >> "$GITHUB_STEP_SUMMARY"; fi
