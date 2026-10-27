#!/usr/bin/env bash
# =============================================================================
# uso.sh · Informe de uso de la app y de los errores que ha visto la gente, SIN datos personales
# (los nombres se cambian por iniciales antes de imprimir nada; los correos, por [correo]).
#
# Responde a "¿cómo va la app?" sin tener que preguntar: quién la usa (alumnos y equipo),
# cuánto, qué hacen, si se pasa lista, si llegan y se leen los avisos, y qué errores han salido.
# Solo lee (todo dentro de una transacción que se deshace). El resultado va al registro público
# de la tarea: por eso se anonimiza.
#
# Uso:  SUPABASE_DB_PASSWORD=... bash scripts/diagnostico/uso.sh [días hacia atrás, por defecto 14]
# =============================================================================
set -euo pipefail
DIAS="${1:-14}"
[[ "$DIAS" =~ ^[0-9]+$ ]] || DIAS=14

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

# 1) Diccionario nombre → iniciales (alumnos y equipo). No se imprime.
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q -At -F $'\t' > "$TMP/nombres.tsv" <<'SQL'
select trim(nombre || ' ' || apellidos), upper(left(trim(nombre), 1)) || '.' || upper(left(trim(apellidos), 1)) || '.' from public.clientes
union all select trim(nombre), upper(left(trim(nombre), 1)) || '.' from public.clientes where length(trim(nombre)) > 2
union all select trim(nombre || ' ' || apellidos), upper(left(trim(nombre), 1)) || '.' || upper(left(trim(apellidos), 1)) || '. (equipo)' from public.trabajadores
union all select trim(nombre), upper(left(trim(nombre), 1)) || '. (equipo)' from public.trabajadores where length(trim(nombre)) > 2
union all select email, '[correo]' from public.clientes where coalesce(email, '') <> ''
union all select email, '[correo]' from public.trabajadores where coalesce(email, '') <> '';
SQL

# 2) Informe en crudo (se imprime solo tras anonimizar).
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q -P pager=off -v dias="$DIAS" > "$TMP/informe.txt" <<'SQL'
begin;
\set desde 'now() - make_interval(days => :dias)'
select exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'sessions') as hay_sesiones \gset
select to_regclass('public.errores_app') is not null as hay_errores \gset
create temporary table actores on commit drop as
  select u.id as user_id, 'ALUMNO'::text as tipo, trim(c.nombre || ' ' || c.apellidos) as nombre from public.clientes c join auth.users u on u.id = c.user_id
  union all
  select u.id, 'EQUIPO', trim(t.nombre || ' ' || t.apellidos) from public.trabajadores t join auth.users u on u.id = t.user_id;
\if :hay_sesiones
create temporary table ultimo_uso on commit drop as
  select s.user_id, max(greatest(s.created_at, coalesce(s.updated_at, s.created_at), coalesce(s.refreshed_at::timestamptz, s.created_at))) as cuando
    from auth.sessions s group by s.user_id;
\else
create temporary table ultimo_uso (user_id uuid, cuando timestamptz) on commit drop;
\endif

\echo '== Informe de uso'
select now() at time zone 'Europe/Madrid' as generado_madrid, :dias as dias_analizados;

\echo
\echo '== 1. Alumnos'
select
  (select count(*) from public.clientes where activo) as alumnos_activos,
  (select count(*) from public.clientes where activo and user_id is not null) as con_cuenta_en_la_app,
  (select count(*) from public.clientes c join ultimo_uso u on u.user_id = c.user_id where c.activo and u.cuando > now() - interval '1 day') as usaron_app_ultimo_dia,
  (select count(*) from public.clientes c join ultimo_uso u on u.user_id = c.user_id where c.activo and u.cuando > now() - interval '7 days') as usaron_app_7_dias,
  (select count(*) from public.clientes c join ultimo_uso u on u.user_id = c.user_id where c.activo and u.cuando > now() - interval '30 days') as usaron_app_30_dias,
  (select count(distinct s.cliente_id) from public.suscripciones_push s join public.clientes c on c.id = s.cliente_id where c.activo) as con_notificaciones_activadas;

\echo
\echo '== 2. Lo que han hecho los alumnos ellos mismos en la app (periodo)'
select a.accion as que, count(*) as veces, count(distinct a.actor_id) as alumnos_distintos
  from public.auditoria a join actores x on x.user_id = a.actor_id and x.tipo = 'ALUMNO'
 where a.instante > :desde
 group by 1 order by 2 desc;

\echo
\echo '== 3. Avisos del centro (periodo): enviados, a cuántos y cuántos se han leído'
select count(distinct v.id) as avisos, count(d.cliente_id) as entregas,
       count(l.cliente_id) as leidos,
       case when count(d.cliente_id) > 0 then round(100.0 * count(l.cliente_id) / count(d.cliente_id)) end as porcentaje_leido
  from public.avisos v
  join public.aviso_destinatarios d on d.aviso_id = v.id
  left join public.aviso_lecturas l on l.aviso_id = v.id and l.cliente_id = d.cliente_id
 where v.publicado_el > :desde;

\echo
\echo '== 4. Equipo: uso de cada persona (periodo)'
select x.nombre as quien, t.rol,
       (select count(*) from public.auditoria a where a.actor_id = x.user_id and a.instante > :desde) as acciones,
       (select count(distinct (a.instante at time zone 'Europe/Madrid')::date) from public.auditoria a where a.actor_id = x.user_id and a.instante > :desde) as dias_con_actividad,
       (select max(a.instante) from public.auditoria a where a.actor_id = x.user_id) at time zone 'Europe/Madrid' as ultima_accion,
       (u.cuando at time zone 'Europe/Madrid') as ultimo_uso_app
  from actores x
  join public.trabajadores t on t.user_id = x.user_id
  left join ultimo_uso u on u.user_id = x.user_id
 where x.tipo = 'EQUIPO' and t.activo
 order by acciones desc, quien;

\echo
\echo '== 5. Equipo: qué ha hecho (periodo)'
select a.accion as que, count(*) as veces, count(distinct a.actor_id) as personas
  from public.auditoria a join actores x on x.user_id = a.actor_id and x.tipo = 'EQUIPO'
 where a.instante > :desde
 group by 1 order by 2 desc;

\echo
\echo '== 6. Pasar lista: clases ya dadas con alumnos (periodo) y cuántas tienen la asistencia marcada'
select count(*) as clases_dadas_con_alumnos,
       count(*) filter (where marcada) as con_lista_pasada,
       case when count(*) > 0 then round(100.0 * count(*) filter (where marcada) / count(*)) end as porcentaje
  from (select c.id, bool_or(r.asistencia <> 'PENDIENTE') as marcada
          from public.clases c join public.reservas r on r.clase_id = c.id and r.estado = 'RESERVADA'
         where c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) < public._ahora_local()
           and c.fecha > (now() at time zone 'Europe/Madrid')::date - :dias
         group by c.id) x;

\echo
\echo '== 7. Día a día (periodo): acciones del equipo, de los alumnos y personas distintas'
select (a.instante at time zone 'Europe/Madrid')::date as dia,
       count(*) filter (where x.tipo = 'EQUIPO') as acciones_equipo,
       count(*) filter (where x.tipo = 'ALUMNO') as acciones_alumnos,
       count(*) filter (where a.actor_id is null) as automaticas,
       count(distinct a.actor_id) filter (where x.tipo = 'EQUIPO') as personas_equipo,
       count(distinct a.actor_id) filter (where x.tipo = 'ALUMNO') as alumnos
  from public.auditoria a left join actores x on x.user_id = a.actor_id
 where a.instante > :desde
 group by 1 order by 1 desc;

\echo
\echo '== 8. Errores que ha visto la gente en la app (periodo)'
\if :hay_errores
select tipo_usuario as quien, tipo, count(*) as veces, count(distinct user_id) as personas
  from public.errores_app where instante > :desde group by 1, 2 order by 3 desc;
\echo '-- Los mensajes más repetidos'
select left(mensaje, 160) as mensaje, tipo, count(*) as veces, count(distinct coalesce(user_id::text, navegador)) as personas,
       string_agg(distinct tipo_usuario, ', ') as quien, max(instante) at time zone 'Europe/Madrid' as ultima_vez
  from public.errores_app where instante > :desde
 group by 1, 2 order by 3 desc limit 25;
\else
select 'Todavía no se registran (falta ejecutar la migración 0035).' as nota;
\endif

\echo
\echo '== 9. Otras señales de que algo falla'
select
  (select count(*) from public.avisos_push_pendientes where creado_el < now() - interval '1 day') as avisos_movil_atascados,
  (select count(*) from public.auditoria where accion = 'MANTENIMIENTO' and instante > now() - interval '7 days') as mantenimientos_ultimos_7_dias,
  (select max(hecha_el) at time zone 'Europe/Madrid' from public.copias_seguridad) as ultima_copia,
  (select count(*) from public.auditoria where accion = 'LISTA_ESPERA' and detalle like '%no entra%' and instante > :desde) as lista_espera_no_entra,
  (select count(*) from public.auditoria where accion = 'CANCELAR_CLASE' and instante > :desde) as clases_canceladas,
  (select count(*) from public.auditoria where accion = 'REACTIVAR_CLASE' and instante > :desde) as clases_reactivadas;
rollback;
SQL

# 3) Anonimizar (los nombres más largos primero) e imprimir.
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
