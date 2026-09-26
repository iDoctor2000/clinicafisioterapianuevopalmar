#!/usr/bin/env bash
# =============================================================================
# prueba_local.sh · Prueba de las migraciones + seed + reglas en un PostgreSQL local
#
# Requisitos: PostgreSQL 16 instalado (cluster "main"), acceso como root o sudo.
# Crea (o recrea) la base `pilates_test`, simula el schema `auth` de Supabase,
# aplica las migraciones y el seed y ejecuta tests/pruebas.sql.
# Sale con código distinto de 0 si algo falla.
#
# Uso: bash supabase/tests/prueba_local.sh [--mantener]   (--mantener: no para Postgres al acabar)
# =============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/.." && pwd)"
DB=pilates_test
MANTENER=false
[[ "${1:-}" == "--mantener" ]] && MANTENER=true

# Ejecuta psql como el usuario postgres (con sudo si no somos root)
if [[ "$(id -u)" == "0" ]]; then
  psql_run() { su postgres -c "psql -X -v ON_ERROR_STOP=1 $*"; }
else
  psql_run() { sudo -u postgres psql -X -v ON_ERROR_STOP=1 "$@"; }
fi

echo "== Arrancando PostgreSQL 16 (cluster main)"
ARRANCADO_AQUI=false
if pg_lsclusters | grep -E '^16\s+main' | grep -q online; then
  echo "   ya estaba en marcha"
else
  pg_ctlcluster 16 main start
  ARRANCADO_AQUI=true
  sleep 2
fi
pg_lsclusters

parar() {
  if [[ "$ARRANCADO_AQUI" == true && "$MANTENER" == false ]]; then
    echo "== Parando PostgreSQL"
    pg_ctlcluster 16 main stop || true
  fi
}
trap parar EXIT

echo "== Recreando base de datos $DB"
psql_run "-d postgres -c 'drop database if exists $DB'"
psql_run "-d postgres -c 'create database $DB'"

echo "== Stub del schema auth de Supabase y roles"
psql_run "-d $DB -f $AQUI/stub_auth.sql"

echo "== Migraciones"
for f in "$RAIZ"/migrations/*.sql; do
  echo "   -> $(basename "$f")"
  psql_run "-d $DB -q -f $f"
done

echo "== Seed"
psql_run "-d $DB -q -f $RAIZ/seed.sql"

echo "== Pruebas"
psql_run "-d $DB -f $AQUI/pruebas.sql"

echo
echo "TODAS LAS PRUEBAS HAN PASADO"
