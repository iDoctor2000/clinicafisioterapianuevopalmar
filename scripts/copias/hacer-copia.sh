#!/usr/bin/env bash
# =============================================================================
# hacer-copia.sh · Copia de seguridad cifrada de la base de datos de Supabase
#
# Qué copia:
#   · datos-public.dump  → todo el esquema public (estructura y datos): clientes, notas
#                          clínicas, contratos, cobros, clases, reservas, avisos, auditoría,
#                          textos de la web… (formato "custom" de pg_dump).
#   · usuarios-auth.dump → las cuentas de acceso (auth.users y auth.identities, solo datos).
#                          Las contraseñas van cifradas por Supabase (nunca en claro).
# Qué NO copia: los archivos de las fotos (están en Storage, no en la base de datos).
#
# Todo se empaqueta y se CIFRA con AES-256 (gpg) usando BACKUP_PASSPHRASE: sin esa
# contraseña el archivo es ilegible. Al terminar anota la copia en public.copias_seguridad
# (la app lo muestra en Ajustes → Copias de seguridad).
#
# Uso:  SUPABASE_DB_URL=... BACKUP_PASSPHRASE=... bash scripts/copias/hacer-copia.sh <carpeta-salida>
# Lo ejecuta cada noche .github/workflows/copia-seguridad.yml.
# =============================================================================
set -euo pipefail

# Conexión: lo más sencillo es dar solo la contraseña de la base de datos (SUPABASE_DB_PASSWORD);
# el resto (usuario y servidor del "Session pooler" del proyecto) no es secreto y va aquí.
# También se admite la dirección completa (SUPABASE_DB_URL).
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-mgiekkqbgptxmqcrhxlr}"
SUPABASE_DB_HOST="${SUPABASE_DB_HOST:-aws-0-eu-central-1.pooler.supabase.com}"
recortar() { printf '%s' "$1" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  CLAVE_BD="$(recortar "$SUPABASE_DB_PASSWORD")"
  # La contraseña va "codificada" para que cualquier símbolo (@ / : # ?…) no rompa la dirección.
  CLAVE_URI="$(jq -rn --arg p "$CLAVE_BD" '$p|@uri')"
  SUPABASE_DB_URL="postgresql://postgres.${SUPABASE_PROJECT_REF}:${CLAVE_URI}@${SUPABASE_DB_HOST}:5432/${SUPABASE_DB_NAME:-postgres}"
fi
SUPABASE_DB_URL="$(recortar "${SUPABASE_DB_URL:-}")"
: "${SUPABASE_DB_URL:?Falta la conexión: SUPABASE_DB_PASSWORD (contraseña de la base de datos) o SUPABASE_DB_URL}"
if [[ "$SUPABASE_DB_URL" == *"[YOUR-PASSWORD]"* ]]; then
  echo "La dirección todavía contiene [YOUR-PASSWORD]: hay que poner la contraseña real." >&2
  exit 1
fi
: "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE (contraseña para cifrar la copia)}"
SALIDA="${1:-.}"
mkdir -p "$SALIDA"

if [[ ${#BACKUP_PASSPHRASE} -lt 12 ]]; then
  echo "La contraseña de cifrado es demasiado corta (mínimo 12 caracteres)." >&2
  exit 1
fi

FECHA="$(date -u +%Y-%m-%d_%H%M)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== Copiando el esquema public (estructura y datos)"
pg_dump "$SUPABASE_DB_URL" --format=custom --schema=public --no-owner --file="$TMP/datos-public.dump"

echo "== Copiando las cuentas de acceso"
TABLAS_AUTH=(--table=auth.users)
if [[ "$(psql "$SUPABASE_DB_URL" -XAtqc "select to_regclass('auth.identities') is not null")" == "t" ]]; then
  TABLAS_AUTH+=(--table=auth.identities)
fi
pg_dump "$SUPABASE_DB_URL" --format=custom --data-only "${TABLAS_AUTH[@]}" --file="$TMP/usuarios-auth.dump"

echo "== Comprobando que las copias se pueden leer"
pg_restore --list "$TMP/datos-public.dump" > "$TMP/indice-public.txt"
pg_restore --list "$TMP/usuarios-auth.dump" > /dev/null
TABLAS=$(grep -c " TABLE DATA public " "$TMP/indice-public.txt" || true)
if [[ "$TABLAS" -lt 10 ]]; then
  echo "La copia parece incompleta: solo $TABLAS tablas con datos." >&2
  exit 1
fi
SERVIDOR="$(psql "$SUPABASE_DB_URL" -XAtqc 'show server_version')"

cat > "$TMP/LEEME.txt" <<EOF
Copia de seguridad · Nuevo Palmar Pilates
Fecha (UTC): $FECHA
Servidor PostgreSQL: $SERVIDOR
Tablas con datos: $TABLAS

datos-public.dump   Esquema public completo (pg_dump --format=custom).
usuarios-auth.dump  Cuentas de acceso (auth.users / auth.identities, solo datos).

Para restaurar: ver docs/RECUPERACION.md en el repositorio, o el capítulo
"Copias de seguridad y recuperación" del manual del administrador.
EOF
rm -f "$TMP/indice-public.txt"

ARCHIVO="$SALIDA/copia-$FECHA.tar.gpg"
echo "== Cifrando (AES-256)"
tar -C "$TMP" -cf - . | gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
  --passphrase-file <(printf '%s' "$BACKUP_PASSPHRASE") --output "$ARCHIVO"
BYTES=$(stat -c %s "$ARCHIVO")

echo "== Comprobando que la copia cifrada se descifra bien"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file <(printf '%s' "$BACKUP_PASSPHRASE") --decrypt "$ARCHIVO" | tar -tf - > "$TMP/contenido.txt"
grep -q "datos-public.dump" "$TMP/contenido.txt"

echo "== Anotando la copia en la base de datos"
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q \
  -c "insert into public.copias_seguridad (archivo, bytes, tablas) values ('copia-$FECHA.tar.gpg', $BYTES, $TABLAS)" \
  || echo "Aviso: no se ha podido anotar la copia (¿falta ejecutar la migración 0015?). La copia está hecha igualmente."

echo "Copia terminada: $(basename "$ARCHIVO") ($BYTES bytes, $TABLAS tablas)."
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "archivo=$ARCHIVO" >> "$GITHUB_OUTPUT"
  echo "dia=${FECHA%%_*}" >> "$GITHUB_OUTPUT"
fi
exit 0
