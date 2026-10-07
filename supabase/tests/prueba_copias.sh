#!/usr/bin/env bash
# =============================================================================
# prueba_copias.sh · Prueba completa de copia de seguridad y recuperación en local
#
#   1. Prepara la base de pruebas (prueba_local.sh: migraciones + seed + pruebas).
#   2. Saca una "huella" de todos los datos del esquema public.
#   3. Hace una copia cifrada con scripts/copias/hacer-copia.sh.
#   4. Estropea datos a propósito y restaura con restaurar-copia.sh → misma huella.
#   5. Catástrofe total: base nueva solo con las migraciones + restauración con
#      usuarios → misma huella.
#   6. Con una contraseña equivocada, la restauración se niega y no toca nada.
#
# Uso: bash supabase/tests/prueba_copias.sh   (como root, igual que prueba_local.sh)
# =============================================================================
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
TMP="$(mktemp -d)"; chmod 777 "$TMP"
trap 'rm -rf "$TMP"; pg_ctlcluster 16 main stop || true' EXIT

bash "$AQUI/prueba_local.sh" --mantener > "$TMP/preparar.log" 2>&1 || { tail -30 "$TMP/preparar.log"; exit 1; }
echo "== Base de pruebas preparada"

como_pg() { su postgres -c "$*"; }
URL="postgresql:///pilates_test?host=/var/run/postgresql"
URL_NUEVA="postgresql:///pilates_nueva?host=/var/run/postgresql"
CLAVE="una-clave-de-prueba-larga"

# Huella: md5 de cada fila, por tabla, en orden (sin la tabla de registro de copias).
huella() {
  como_pg "psql -XAtq -d $1" <<'SQL'
select string_agg(t || ':' || h, ' ' order by t) from (
  select c.relname as t,
         (xpath('/row/h/text()', query_to_xml(format(
           'select coalesce(md5(string_agg(md5(x::text), '''' order by md5(x::text))), ''vacía'') as h from public.%I x', c.relname), false, true, '')))[1]::text as h
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'copias_seguridad'
) s;
SQL
}

ANTES="$(huella pilates_test)"
echo "   tablas en la huella: $(echo "$ANTES" | wc -w)"

echo "== Copia"
como_pg "cd $TMP && SUPABASE_DB_URL='$URL' BACKUP_PASSPHRASE='$CLAVE' bash $RAIZ/scripts/copias/hacer-copia.sh $TMP/copias"
ARCHIVO="$(ls "$TMP"/copias/copia-*.tar.gpg)"
como_pg "psql -XAtq -d pilates_test -c 'select count(*) from public.copias_seguridad'" | grep -qx 1 || { echo "FALLO: la copia no se ha anotado"; exit 1; }
if tar -tf "$ARCHIVO" >/dev/null 2>&1; then echo "FALLO: la copia no está cifrada"; exit 1; fi
echo "   copia cifrada y anotada"

echo "== Estropeo datos y restauro en la misma base"
como_pg "psql -XAtq -d pilates_test -v ON_ERROR_STOP=1" <<'SQL'
alter table public.clientes disable trigger user;
update public.clientes set nombre = 'BORRADO', telefono = '';
alter table public.clientes enable trigger user;
delete from public.pagos;
delete from public.aviso_lecturas;
delete from public.aviso_destinatarios;
delete from public.avisos;
SQL
[[ "$(huella pilates_test)" != "$ANTES" ]] || { echo "FALLO: el estropicio no ha cambiado nada"; exit 1; }
como_pg "cd $TMP && RESTORE_DB_URL='$URL' BACKUP_PASSPHRASE='$CLAVE' bash $RAIZ/scripts/copias/restaurar-copia.sh $ARCHIVO"
[[ "$(huella pilates_test)" == "$ANTES" ]] || { echo "FALLO: los datos restaurados no coinciden"; diff <(echo "$ANTES" | tr ' ' '\n') <(huella pilates_test | tr ' ' '\n') || true; exit 1; }
echo "   OK: datos idénticos a los de la copia"

echo "== Catástrofe total: base nueva con solo las migraciones"
como_pg "psql -X -q -d postgres -c 'drop database if exists pilates_nueva' -c 'create database pilates_nueva'"
como_pg "psql -X -q -v ON_ERROR_STOP=1 -d pilates_nueva -f $AQUI/stub_auth.sql" >/dev/null
for f in "$RAIZ"/supabase/migrations/*.sql; do como_pg "psql -X -q -v ON_ERROR_STOP=1 -d pilates_nueva -f $f" >/dev/null 2>&1; done
como_pg "cd $TMP && RESTORE_DB_URL='$URL_NUEVA' BACKUP_PASSPHRASE='$CLAVE' bash $RAIZ/scripts/copias/restaurar-copia.sh $ARCHIVO --con-usuarios"
[[ "$(huella pilates_nueva)" == "$ANTES" ]] || { echo "FALLO: la base nueva no coincide"; diff <(echo "$ANTES" | tr ' ' '\n') <(huella pilates_nueva | tr ' ' '\n') || true; exit 1; }
[[ "$(como_pg "psql -XAtq -d pilates_nueva -c 'select count(*) from auth.users'")" == "$(como_pg "psql -XAtq -d pilates_test -c 'select count(*) from auth.users'")" ]] \
  || { echo "FALLO: faltan cuentas de acceso"; exit 1; }
echo "   OK: base nueva idéntica, con sus cuentas de acceso"

echo "== Contraseña equivocada"
if como_pg "cd $TMP && RESTORE_DB_URL='$URL' BACKUP_PASSPHRASE='otra-clave-que-no-es' bash $RAIZ/scripts/copias/restaurar-copia.sh $ARCHIVO" > "$TMP/mal.log" 2>&1; then
  echo "FALLO: ha restaurado con una contraseña equivocada"; exit 1
fi
grep -q "contraseña" "$TMP/mal.log" && [[ "$(huella pilates_test)" == "$ANTES" ]] || { echo "FALLO: con contraseña equivocada"; cat "$TMP/mal.log"; exit 1; }
echo "   OK: se niega y no toca nada"

como_pg "psql -X -q -d postgres -c 'drop database if exists pilates_nueva'"
echo
echo "TODAS LAS PRUEBAS DE COPIA Y RECUPERACIÓN HAN PASADO"
