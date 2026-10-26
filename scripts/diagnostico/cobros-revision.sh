#!/usr/bin/env bash
# =============================================================================
# cobros-revision.sh · Revisión de los cobros de TODOS los alumnos, sin datos personales
# (iniciales + 8 primeros caracteres del id).
#
#   1. Estado actual: alumnos con un mismo mes cobrado más de una vez, cobros pendientes de
#      contratos cerrados, alumnos con tarifa mensual sin cobro del mes, conceptos raros.
#   2. Si se da una copia de seguridad anterior (archivo .tar.gpg + BACKUP_PASSPHRASE), qué
#      cobros había en la copia y ya no están, separando:
#        · pendientes que se quitaron y cuyo mes el alumno sigue teniendo apuntado (bien quitados),
#        · pendientes de un mes ya pasado que el alumno YA NO tiene apuntado (posible deuda perdida),
#        · cobrados que ya no están (solo se borran a mano desde la app).
#
# Solo lee. El resultado va al registro público de la tarea: por eso se anonimiza.
# Uso:  SUPABASE_DB_PASSWORD=... [BACKUP_PASSPHRASE=...] bash scripts/diagnostico/cobros-revision.sh [copia.tar.gpg]
# =============================================================================
set -euo pipefail
COPIA="${1:-}"

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

# Datos actuales (a ficheros; no se imprimen tal cual).
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q -At -F $'\t' -c \
  "select id, upper(left(trim(nombre),1)) || '.' || upper(left(trim(apellidos),1)) || '.' || left(id::text, 8), activo from public.clientes" > "$TMP/clientes.tsv"
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q -At -F $'\t' -c \
  "select p.id, p.cliente_id, p.contrato_id, p.mes, p.estado, p.importe_centimos, coalesce(p.vence_el::text, ''), p.concepto, coalesce(c.estado::text, '') from public.pagos p left join public.contratos c on c.id = p.contrato_id" > "$TMP/pagos.tsv"
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q -At -F $'\t' -c \
  "select k.cliente_id, k.fecha_inicio, k.fecha_fin from public.contratos k join public.tarifas t on t.id = k.tarifa_id where k.estado = 'ACTIVO' and t.tipo = 'RECURRENTE'" > "$TMP/mensuales.tsv"
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q -At -c "select public._hoy()" > "$TMP/hoy.txt"

if [[ -n "$COPIA" ]]; then
  : "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE para leer la copia}"
  gpg --batch --quiet --pinentry-mode loopback --passphrase-file <(printf '%s' "$BACKUP_PASSPHRASE") --decrypt "$COPIA" > "$TMP/copia.tar"
  mkdir -p "$TMP/copia" && tar -C "$TMP/copia" -xf "$TMP/copia.tar"
  pg_restore --data-only --table=pagos -f "$TMP/copia-pagos.sql" "$TMP/copia/datos-public.dump"
  pg_restore --data-only --table=contratos -f "$TMP/copia-contratos.sql" "$TMP/copia/datos-public.dump"
fi

python3 -I - "$TMP" <<'PY'
import sys, os, re
from collections import defaultdict
T = sys.argv[1]
def tsv(n):
    with open(os.path.join(T, n), encoding='utf-8') as f:
        return [l.rstrip('\n').split('\t') for l in f if l.strip()]
hoy = open(os.path.join(T, 'hoy.txt')).read().strip()
mes_actual = hoy[:7] + '-01'
quien = {c[0]: c[1] + ('' if c[2] == 't' else ' (de baja)') for c in tsv('clientes.tsv')}
pagos = [dict(id=p[0], cli=p[1], con=p[2], mes=p[3], estado=p[4], imp=int(p[5]), vence=p[6], concepto=p[7], estado_con=p[8]) for p in tsv('pagos.tsv')]
eur = lambda c: f"{c/100:.2f} €".replace('.', ',').replace(',00 €', ' €')
NOM = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
nmes = lambda m: f"{NOM[int(m[5:7])-1]} {m[:4]}"

print('== Cobros de todos los alumnos (hoy %s)' % hoy)
print('Cobros en total: %d (cobrados %d, pendientes %d)' % (len(pagos), sum(p['estado']=='PAGADO' for p in pagos), sum(p['estado']=='PENDIENTE' for p in pagos)))

dup = defaultdict(list)
for p in pagos:
    if p['estado'] == 'PAGADO': dup[(p['cli'], p['mes'])].append(p)
dup = {k: v for k, v in dup.items() if len(v) > 1}
print('\n-- Mismo mes cobrado más de una vez: %d casos' % len(dup))
for (cli, mes), v in sorted(dup.items(), key=lambda x: (x[0][1], quien.get(x[0][0], ''))):
    print('   %s · %s · %s' % (quien.get(cli, cli[:8]), nmes(mes), ' + '.join(eur(p['imp']) for p in v)))

dupp = defaultdict(list)
for p in pagos:
    if p['estado'] != 'CANCELADO': dupp[(p['cli'], p['mes'])].append(p)
dupp = {k: v for k, v in dupp.items() if len(v) > 1 and k not in dup}
print('\n-- Mismo mes apuntado más de una vez (alguno pendiente): %d casos' % len(dupp))
for (cli, mes), v in sorted(dupp.items(), key=lambda x: (x[0][1], quien.get(x[0][0], ''))):
    print('   %s · %s · %s' % (quien.get(cli, cli[:8]), nmes(mes), ' + '.join(eur(p['imp']) + ' ' + p['estado'].lower() for p in v)))

cerr = [p for p in pagos if p['estado'] == 'PENDIENTE' and p['estado_con'] not in ('', 'ACTIVO')]
print('\n-- Pendientes de contratos ya cerrados: %d' % len(cerr))
for p in cerr: print('   %s · %s · %s' % (quien.get(p['cli'], p['cli'][:8]), nmes(p['mes']), eur(p['imp'])))

con_mes = {(p['cli'], p['mes']) for p in pagos if p['estado'] != 'CANCELADO'}
sin = sorted({m[0] for m in tsv('mensuales.tsv') if m[1] <= hoy and (m[0], mes_actual) not in con_mes}, key=lambda c: quien.get(c, ''))
print('\n-- Con tarifa mensual activa y sin cobro de %s: %d' % (nmes(mes_actual), len(sin)))
for c in sin: print('   %s' % quien.get(c, c[:8]))

raros = [p for p in pagos if re.match(r'(?i)^(mes \d+|renovación) · ', p['concepto'])]
print('\n-- Cobros con nombre antiguo ("Mes 1 · …"): %d' % len(raros))

copia = os.path.join(T, 'copia-pagos.sql')
if os.path.exists(copia):
    def leer_copy(fichero):
        filas, cols, dentro = [], None, False
        for l in open(fichero, encoding='utf-8'):
            l = l.rstrip('\n')
            if l.startswith('COPY '):
                cols = re.search(r'\((.*)\)', l).group(1).split(', '); dentro = True; continue
            if dentro:
                if l == '\\.': dentro = False; continue
                filas.append(dict(zip(cols, [None if v == '\\N' else v for v in l.split('\t')])))
        return filas
    antes = leer_copy(copia)
    estado_con = {k['id']: k['estado'] for k in leer_copy(os.path.join(T, 'copia-contratos.sql'))}
    ahora_ids = {p['id'] for p in pagos}
    def mes_de(f):
        c = (f.get('concepto') or '').lower()
        for i, n in enumerate(NOM):
            if re.search(r'(^|[^a-záéíóú])' + n + r'([^a-záéíóú]|$)', c):
                a = re.search(r'(\d{4})', c)
                anio = a.group(1) if a else (f.get('vence_el') or f.get('creado_el') or hoy)[:4]
                return f'{anio}-{i+1:02d}-01'
        d = f.get('vence_el') or (f.get('pagado_el') or '')[:10] or (f.get('creado_el') or '')[:10]
        return d[:7] + '-01'
    quitados = [f for f in antes if f['id'] not in ahora_ids]
    pend = [f for f in quitados if f['estado'] == 'PENDIENTE']
    cobr = [f for f in quitados if f['estado'] == 'PAGADO']
    bien = [f for f in pend if (f['cliente_id'], mes_de(f)) in con_mes]
    futuros = [f for f in pend if f not in bien and mes_de(f) > mes_actual]
    deuda = [f for f in pend if f not in bien and f not in futuros]
    print('\n== Comparación con la copia anterior')
    print('Cobros en la copia: %d · ahora: %d · ya no están: %d (pendientes %d, cobrados %d)' % (len(antes), len(pagos), len(quitados), len(pend), len(cobr)))
    print('\n-- Pendientes quitados cuyo mes el alumno sigue teniendo apuntado (duplicados bien quitados): %d' % len(bien))
    print('-- Pendientes quitados de meses que aún no han llegado y sin otro cobro ese mes: %d' % len(futuros))
    for f in sorted(futuros, key=lambda f: (mes_de(f), quien.get(f['cliente_id'], ''))):
        print('   %s · %s · %s · contrato %s' % (quien.get(f['cliente_id'], f['cliente_id'][:8]), nmes(mes_de(f)), eur(int(f['importe_centimos'])), (estado_con.get(f['contrato_id']) or '-').lower()))
    print('-- Pendientes quitados de este mes o anteriores, sin otro cobro ese mes (POSIBLE DEUDA PERDIDA): %d' % len(deuda))
    for f in sorted(deuda, key=lambda f: (mes_de(f), quien.get(f['cliente_id'], ''))):
        print('   %s · %s · %s · contrato %s' % (quien.get(f['cliente_id'], f['cliente_id'][:8]), nmes(mes_de(f)), eur(int(f['importe_centimos'])), (estado_con.get(f['contrato_id']) or '-').lower()))
    print('-- Cobrados que ya no están (solo se borran a mano desde la app): %d' % len(cobr))
    for f in sorted(cobr, key=lambda f: (mes_de(f), quien.get(f['cliente_id'], ''))):
        print('   %s · %s · %s' % (quien.get(f['cliente_id'], f['cliente_id'][:8]), nmes(mes_de(f)), eur(int(f['importe_centimos']))))
PY
