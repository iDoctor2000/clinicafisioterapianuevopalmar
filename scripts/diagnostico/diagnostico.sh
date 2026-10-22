#!/usr/bin/env bash
# =============================================================================
# diagnostico.sh · Estado de reservas, contratos y recuperaciones de los últimos días,
# SIN datos personales (los nombres se sustituyen por iniciales antes de imprimir nada).
#
# Sirve para investigar incidencias ("a una alumna no le deja reservar") sin entrar en
# Supabase. Solo lee. Lo lanza el workflow "Diagnóstico" (botón Run workflow) y el
# resultado queda en el registro de la tarea, que es público: por eso se anonimiza.
#
# Uso:  SUPABASE_DB_PASSWORD=... bash scripts/diagnostico/diagnostico.sh [días hacia atrás]
# =============================================================================
set -euo pipefail
DIAS="${1:-8}"

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

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1) Diccionario nombre → iniciales (no se imprime; solo lo usa el anonimizador).
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q -At -F $'\t' > "$TMP/nombres.tsv" <<'SQL'
select trim(nombre || ' ' || apellidos), upper(left(trim(nombre), 1)) || '.' || upper(left(trim(apellidos), 1)) || '.' from public.clientes
union all select trim(nombre), upper(left(trim(nombre), 1)) || '.' from public.clientes where length(trim(nombre)) > 2
union all select trim(nombre || ' ' || apellidos), 'personal' from public.trabajadores
union all select trim(nombre), 'personal' from public.trabajadores where length(trim(nombre)) > 2
union all select email, '[correo]' from public.clientes where coalesce(email, '') <> ''
union all select email, '[correo]' from public.trabajadores where coalesce(email, '') <> '';
SQL

# 2) Informe (en crudo, a un archivo temporal; se imprime solo tras anonimizar).
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q -P pager=off -v dias="$DIAS" > "$TMP/informe.txt" <<'SQL'
begin;  -- solo lecturas; al final se deshace todo (rollback), por si acaso
\set desde 'now() - make_interval(days => :dias)'
\echo '== Hora del servidor:' 
select now() at time zone 'Europe/Madrid' as ahora_madrid, public._hoy() as hoy;

\echo '== Configuración'
select minutos_antelacion_cancelacion, dias_ventana_reserva, recuperacion_caduca_con_contrato, dias_caducidad_recuperacion, dias_generacion_clases from public.config_centro;
select fecha, motivo from public.dias_cierre where fecha between public._hoy() - 7 and public._hoy() + 60 order by fecha;

\echo '== Tarifas (reglas de recuperación)'
select left(id::text, 8) as id, nombre, tipo, recuperacion_permitida, recuperacion_max_pendientes, activa from public.tarifas order by orden, nombre;

\echo '== Franjas del horario (todas, incluidas eliminadas)'
select left(p.id::text, 8) as id, p.dia_semana as dia, p.hora_inicio as hora, a.nombre as actividad, p.plazas, p.activa, p.vigencia_desde, p.vigencia_hasta,
       p.eliminada_el at time zone 'Europe/Madrid' as eliminada, p.actualizado_el at time zone 'Europe/Madrid' as actualizada,
       (select count(*) from public.contrato_franjas f join public.contratos k on k.id = f.contrato_id where f.plantilla_id = p.id and k.estado = 'ACTIVO') as fijos_activos
  from public.plantillas_clase p join public.actividades a on a.id = p.actividad_id
 order by p.dia_semana, p.hora_inicio;

\echo '== Registro de cambios de los últimos días (sin asistencias ni mantenimiento)'
select a.instante at time zone 'Europe/Madrid' as cuando, a.accion, a.entidad, left(a.entidad_id, 8) as id, left(a.detalle, 160) as detalle
  from public.auditoria a
 where a.instante > :desde and a.accion not in ('ASISTENCIA', 'MANTENIMIENTO', 'GENERAR_CLASES', 'CONSENTIMIENTO', 'FOTO_CLIENTE')
 order by a.instante;

\echo '== Clases canceladas en los últimos días'
select c.fecha, c.hora_inicio as hora, a.nombre as actividad, left(c.plantilla_id::text, 8) as franja, c.motivo_cancelacion as motivo,
       c.cancelado_el at time zone 'Europe/Madrid' as cancelada,
       (select count(*) from public.reservas r where r.clase_id = c.id and r.estado = 'CANCELADA_CENTRO') as afectados,
       exists (select 1 from public.dias_cierre d where d.fecha = c.fecha) as festivo
  from public.clases c join public.actividades a on a.id = c.actividad_id
 where c.estado = 'CANCELADA' and c.cancelado_el > :desde
 order by c.cancelado_el;

\echo '== Alumnos con movimientos de contrato o reservas en los últimos días (iniciales + id corto)'
create temp table afectados on commit drop as
  select distinct cl.id, upper(left(cl.nombre, 1)) || '.' || upper(left(cl.apellidos, 1)) || '. ' || left(cl.id::text, 8) as quien
    from public.clientes cl
   where exists (select 1 from public.contratos k where k.cliente_id = cl.id and (k.creado_el > :desde or k.actualizado_el > :desde))
      or exists (select 1 from public.reservas r where r.cliente_id = cl.id and (r.cancelado_el > :desde or (r.creado_el > :desde and r.origen <> 'AUTOMATICA')))
      or exists (select 1 from public.lista_espera e where e.cliente_id = cl.id);
select quien from afectados order by quien;

\echo '== Sus contratos'
select x.quien, left(k.id::text, 8) as contrato, t.nombre as tarifa, k.modalidad, k.fecha_inicio, k.fecha_fin, k.estado, k.sesiones_restantes as sesiones,
       k.creado_el at time zone 'Europe/Madrid' as creado, k.actualizado_el at time zone 'Europe/Madrid' as actualizado,
       (select string_agg(left(f.plantilla_id::text, 8), ',') from public.contrato_franjas f where f.contrato_id = k.id) as franjas
  from public.contratos k join afectados x on x.id = k.cliente_id join public.tarifas t on t.id = k.tarifa_id
 order by x.quien, k.creado_el;

\echo '== Sus recuperaciones'
select x.quien, r.estado, r.motivo, r.categorias_permitidas as categorias, r.caduca_el, r.creado_el at time zone 'Europe/Madrid' as creada,
       left(r.contrato_id::text, 8) as contrato, r.usada_en_reserva_id is not null as usada
  from public.recuperaciones r join afectados x on x.id = r.cliente_id
 order by x.quien, r.creado_el;

\echo '== Sus reservas (de hace 14 días a dentro de 28)'
select x.quien, c.fecha, c.hora_inicio as hora, a.nombre as actividad, left(c.plantilla_id::text, 8) as franja, c.estado as clase, r.origen, r.estado,
       left(r.contrato_id::text, 8) as contrato, r.creado_el at time zone 'Europe/Madrid' as creada, r.cancelado_el at time zone 'Europe/Madrid' as cancelada
  from public.reservas r join afectados x on x.id = r.cliente_id join public.clases c on c.id = r.clase_id join public.actividades a on a.id = c.actividad_id
 where c.fecha between public._hoy() - 14 and public._hoy() + 28
 order by x.quien, c.fecha, c.hora_inicio, r.creado_el;

\echo '== Clases de sus franjas fijas (próximos 28 días) en las que NO tienen plaza, y por qué'
select x.quien, left(k.id::text, 8) as contrato, c.fecha, c.hora_inicio as hora, left(c.plantilla_id::text, 8) as franja,
       (select count(*) from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA') || '/' || c.plazas as ocupacion,
       (select string_agg(r.estado::text || ' (' || left(r.contrato_id::text, 8) || ')', '; ') from public.reservas r where r.clase_id = c.id and r.cliente_id = k.cliente_id) as filas_existentes
  from public.contratos k join afectados x on x.id = k.cliente_id
  join public.contrato_franjas f on f.contrato_id = k.id
  join public.clases c on c.plantilla_id = f.plantilla_id and c.estado = 'PROGRAMADA' and c.fecha between public._hoy() and least(k.fecha_fin, public._hoy() + 28)
 where k.estado = 'ACTIVO' and k.modalidad = 'FIJO'
   and not exists (select 1 from public.reservas r where r.clase_id = c.id and r.cliente_id = k.cliente_id and r.estado = 'RESERVADA')
 order by x.quien, c.fecha, c.hora_inicio;

\echo '== Contratos de horario fijo activos sin ninguna clase futura apuntada a su nombre (el aviso del resumen diario)'
select upper(left(cl.nombre, 1)) || '.' || upper(left(cl.apellidos, 1)) || '. ' || left(cl.id::text, 8) as quien, left(k.id::text, 8) as contrato, k.fecha_inicio, k.fecha_fin,
       (select string_agg(left(f.plantilla_id::text, 8), ',') from public.contrato_franjas f where f.contrato_id = k.id) as franjas,
       (select count(*) from public.reservas r join public.clases c on c.id = r.clase_id join public.contrato_franjas f on f.contrato_id = k.id and f.plantilla_id = c.plantilla_id
         where r.cliente_id = k.cliente_id and r.estado = 'RESERVADA' and c.fecha >= public._hoy() and c.fecha <= k.fecha_fin) as reservas_en_sus_franjas_con_otro_contrato,
       (select count(*) from public.clases c join public.contrato_franjas f on f.contrato_id = k.id and f.plantilla_id = c.plantilla_id
         where c.estado = 'PROGRAMADA' and c.fecha between public._hoy() and k.fecha_fin) as clases_futuras_de_sus_franjas
  from public.contratos k join public.clientes cl on cl.id = k.cliente_id
 where k.estado = 'ACTIVO' and k.modalidad = 'FIJO' and k.fecha_fin >= public._hoy()
   and not exists (select 1 from public.reservas r join public.clases c on c.id = r.clase_id where r.contrato_id = k.id and r.estado = 'RESERVADA' and c.fecha >= public._hoy());

\echo '== Lista de espera y avisos push pendientes'
select left(e.clase_id::text, 8) as clase, c.fecha, c.hora_inicio as hora, upper(left(cl.nombre, 1)) || '.' || upper(left(cl.apellidos, 1)) || '.' as quien, e.reserva_cambio_id is not null as cambio, e.creado_el at time zone 'Europe/Madrid' as creada
  from public.lista_espera e join public.clases c on c.id = e.clase_id join public.clientes cl on cl.id = e.cliente_id order by c.fecha, c.hora_inicio, e.creado_el;
select count(*) as push_pendientes from public.avisos_push_pendientes;

-- Cuentas de acceso (esquema auth de Supabase): para investigar "me ha salido permission denied" o
-- "me ha echado de la app". Solo recuentos y acciones por alumno (iniciales + id), nunca correos ni IPs.
select exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'audit_log_entries') as hay_auth \gset
\if :hay_auth
\echo '== Cuentas: sesiones y tokens de acceso por alumno (últimos días)'
select upper(left(cl.nombre, 1)) || '.' || upper(left(cl.apellidos, 1)) || '. ' || left(cl.id::text, 8) as quien,
       u.last_sign_in_at at time zone 'Europe/Madrid' as ultima_entrada,
       (select count(*) from auth.sessions s where s.user_id = u.id) as sesiones_abiertas,
       (select count(*) from auth.sessions s where s.user_id = u.id and s.created_at > :desde) as sesiones_nuevas,
       (select count(*) from auth.refresh_tokens t where t.user_id = u.id::text and t.updated_at > :desde) as tokens_usados,
       (select count(*) from auth.refresh_tokens t where t.user_id = u.id::text and t.revoked and t.updated_at > :desde) as tokens_revocados,
       (select max(s.refreshed_at) from auth.sessions s where s.user_id = u.id) at time zone 'Europe/Madrid' as ultimo_refresco
  from public.clientes cl join auth.users u on u.id = cl.user_id
 where exists (select 1 from auth.refresh_tokens t where t.user_id = u.id::text and t.updated_at > :desde)
 order by tokens_revocados desc, quien;

\echo '== Cuentas: acciones de autenticación por alumno (últimos días; token_refreshed solo como recuento)'
select upper(left(cl.nombre, 1)) || '.' || upper(left(cl.apellidos, 1)) || '. ' || left(cl.id::text, 8) as quien,
       e.payload->>'action' as accion, count(*) as veces,
       min(e.created_at) at time zone 'Europe/Madrid' as primera, max(e.created_at) at time zone 'Europe/Madrid' as ultima
  from auth.audit_log_entries e join public.clientes cl on cl.user_id::text = e.payload->>'actor_id'
 where e.created_at > :desde
 group by 1, 2
 order by 1, 5;

\echo '== Cuentas: acciones raras (revocaciones, salidas, cambios de contraseña) con su momento exacto'
select e.created_at at time zone 'Europe/Madrid' as cuando,
       upper(left(cl.nombre, 1)) || '.' || upper(left(cl.apellidos, 1)) || '. ' || left(cl.id::text, 8) as quien,
       e.payload->>'action' as accion, e.payload->>'log_type' as tipo
  from auth.audit_log_entries e join public.clientes cl on cl.user_id::text = e.payload->>'actor_id'
 where e.created_at > :desde and e.payload->>'action' not in ('token_refreshed', 'login')
 order by e.created_at;
\endif
rollback;
SQL

# 3) Anonimizar: nombres completos y de pila → iniciales; correos → [correo]. Primero los más largos.
python3 - "$TMP/nombres.tsv" "$TMP/informe.txt" <<'PY'
import re, sys
pares = []
for linea in open(sys.argv[1], encoding='utf-8'):
    linea = linea.rstrip('\n')
    if '\t' not in linea: continue
    nombre, ini = linea.split('\t', 1)
    if len(nombre.strip()) >= 3: pares.append((nombre.strip(), ini))
pares.sort(key=lambda p: -len(p[0]))
texto = open(sys.argv[2], encoding='utf-8').read()
for nombre, ini in pares:
    texto = re.sub(r'(?<!\w)' + re.escape(nombre) + r'(?!\w)', ini, texto, flags=re.IGNORECASE)
texto = re.sub(r'[\w.+-]+@[\w-]+\.[\w.]+', '[correo]', texto)
print(texto)
PY
