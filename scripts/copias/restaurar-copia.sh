#!/usr/bin/env bash
# =============================================================================
# restaurar-copia.sh · Recupera una copia hecha con hacer-copia.sh
#
# ¡ATENCIÓN! Sustituye TODOS los datos del esquema public de la base de datos de destino
# por los de la copia. Lo que se haya hecho después de la copia se pierde.
#
# No borra ni recrea la estructura (tablas, funciones, permisos, fotos, tiempo real): vacía
# las tablas y carga los datos de la copia. Por eso la base de datos de destino tiene que
# tener ya la estructura de la app:
#   · el mismo proyecto de Supabase (lo normal: "volver a como estaba anoche"), o
#   · un proyecto nuevo en el que antes se han ejecutado las migraciones (catástrofe total).
#
# Uso:
#   RESTORE_DB_URL=... BACKUP_PASSPHRASE=... bash scripts/copias/restaurar-copia.sh copia-AAAA-MM-DD_HHMM.tar.gpg [--con-usuarios]
#   --con-usuarios: carga también las cuentas de acceso (solo en un proyecto NUEVO, sin usuarios).
# =============================================================================
set -euo pipefail

# Destino: en el mismo proyecto basta la contraseña (RESTORE_DB_PASSWORD); para un proyecto
# nuevo, su dirección completa (RESTORE_DB_URL), que tiene preferencia.
recortar() { printf '%s' "$1" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
RESTORE_DB_URL="$(recortar "${RESTORE_DB_URL:-}")"
if [[ -z "$RESTORE_DB_URL" && -n "${RESTORE_DB_PASSWORD:-}" ]]; then
  CLAVE_URI="$(jq -rn --arg p "$(recortar "$RESTORE_DB_PASSWORD")" '$p|@uri')"
  RESTORE_DB_URL="postgresql://postgres.${SUPABASE_PROJECT_REF:-mgiekkqbgptxmqcrhxlr}:${CLAVE_URI}@${SUPABASE_DB_HOST:-aws-0-eu-central-1.pooler.supabase.com}:5432/${SUPABASE_DB_NAME:-postgres}"
fi
: "${RESTORE_DB_URL:?Falta el destino: RESTORE_DB_PASSWORD (mismo proyecto) o RESTORE_DB_URL (proyecto nuevo)}"
: "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE (contraseña con la que se cifró la copia)}"
ARCHIVO="${1:?Indica el archivo de la copia (copia-....tar.gpg)}"
CON_USUARIOS=false
[[ "${2:-}" == "--con-usuarios" ]] && CON_USUARIOS=true

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sql() { psql "$RESTORE_DB_URL" -X -v ON_ERROR_STOP=1 -q "$@"; }

echo "== Descifrando la copia"
if ! gpg --batch --quiet --pinentry-mode loopback --passphrase-file <(printf '%s' "$BACKUP_PASSPHRASE") --decrypt "$ARCHIVO" > "$TMP/copia.tar"; then
  echo "No se ha podido descifrar: ¿es la contraseña correcta?" >&2
  exit 1
fi
tar -C "$TMP" -xf "$TMP/copia.tar"
cat "$TMP/LEEME.txt" || true

echo "== Comprobando que el destino tiene la estructura de la app"
if [[ "$(sql -Atc "select to_regclass('public.clientes') is not null and to_regclass('public.reservas') is not null")" != "t" ]]; then
  echo "La base de datos de destino no tiene las tablas de la app. Ejecuta antes las migraciones (supabase/migrations)." >&2
  exit 1
fi

if [[ "$CON_USUARIOS" == true ]]; then
  echo "== Cargando las cuentas de acceso"
  if [[ "$(sql -Atc 'select count(*) from auth.users')" != "0" ]]; then
    echo "El destino ya tiene usuarios: --con-usuarios es solo para un proyecto nuevo." >&2
    exit 1
  fi
  pg_restore --data-only --no-owner --exit-on-error --dbname="$RESTORE_DB_URL" "$TMP/usuarios-auth.dump"
fi

# Tablas de datos del esquema public (las de la copia).
TABLAS=$(pg_restore --list "$TMP/datos-public.dump" | awk '/ TABLE DATA public / {print $(NF-1)}' | sort -u)
LISTA=$(printf 'public.%s,' $TABLAS | sed 's/,$//')

echo "== Sustituyendo los datos (en una sola transacción: si algo falla, no cambia nada)"
pg_restore --data-only --no-owner --file="$TMP/datos.sql" "$TMP/datos-public.dump"
# Relaciones entre tablas (claves ajenas) del esquema public: se quitan durante la carga
# (hay tablas que se apuntan entre sí) y se vuelven a crear al final, lo que comprueba
# que todos los datos cuadran.
CONSULTA_FK="from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
              where k.contype = 'f' and n.nspname = 'public'"
FK_QUITAR=$(sql -Atc "select format('alter table %I.%I drop constraint %I;', n.nspname, c.relname, k.conname) $CONSULTA_FK")
# search_path vacío: pg_get_constraintdef escribe los nombres completos (public.clientes),
# que es como se ejecutarán (pg_restore deja también el search_path vacío).
FK_PONER=$(sql -At -c "set search_path to ''" -c "select format('alter table %I.%I add constraint %I %s;', n.nspname, c.relname, k.conname, pg_get_constraintdef(k.oid)) $CONSULTA_FK")
{
  echo "begin;"
  echo "$FK_QUITAR"
  # Los disparadores propios de la app (auditoría, aforo…) no deben saltar al recargar datos.
  for t in $TABLAS; do echo "alter table public.\"$t\" disable trigger user;"; done
  echo "truncate table $LISTA;"
  cat "$TMP/datos.sql"
  for t in $TABLAS; do echo "alter table public.\"$t\" enable trigger user;"; done
  echo "$FK_PONER"
  echo "commit;"
} > "$TMP/restaurar.sql"
sql -f "$TMP/restaurar.sql"

echo "== Comprobación"
sql -Atc "select 'clientes: ' || count(*) from public.clientes"
sql -Atc "select 'reservas: ' || count(*) from public.reservas"
echo "Restauración terminada."
