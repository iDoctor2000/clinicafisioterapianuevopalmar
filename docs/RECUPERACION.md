# Copias de seguridad y recuperación

Este documento explica cómo se protegen los datos de la app de Pilates y cómo se recuperan si pasa algo. Está pensado para que lo pueda seguir cualquiera con acceso a GitHub y a Supabase, sin depender de una persona concreta.

## Qué se copia y dónde

| | |
|---|---|
| **Cuándo** | Cada noche, sobre las 03:17 (invierno) o 04:17 (verano), hora de Madrid. También a mano: GitHub → **Actions** → **Copia de seguridad diaria** → **Run workflow**. |
| **Qué** | Todo el esquema `public` de Supabase (clientes, notas clínicas, contrataciones, cobros, clases, reservas, recuperaciones, avisos, auditoría, textos de la web…) y las cuentas de acceso (`auth.users`, `auth.identities`; las contraseñas van cifradas por Supabase). |
| **Qué no** | Los archivos de las fotos (Storage). Se pueden volver a subir; las fotos de la web también están en `assets/` del repositorio. |
| **Dónde** | En GitHub, como *artifact* de cada ejecución de la tarea, durante **90 días**. |
| **Cómo** | Cifrada con AES-256 (gpg) con la contraseña del secreto `BACKUP_PASSPHRASE`. Sin esa contraseña el archivo es ilegible, aunque el repositorio sea público. |
| **Control** | La app muestra la fecha de la última copia en **Ajustes → Copias de seguridad** y avisa en rojo si tiene más de un día y medio. Si una copia falla, GitHub abre un aviso (*issue*) "⚠️ La copia de seguridad ha fallado" que llega por correo al dueño del repositorio. |

Piezas:

- `scripts/copias/hacer-copia.sh` y `scripts/copias/restaurar-copia.sh`: hacen y recuperan la copia.
- `.github/workflows/copia-seguridad.yml` (cada noche) y `.github/workflows/restaurar-copia.yml` (solo a mano).
- `supabase/migrations/0015_copias_seguridad.sql`: tabla donde se anota cada copia.
- `supabase/tests/prueba_copias.sh`: prueba completa en local (copiar → estropear → restaurar → comparar; y catástrofe total en una base nueva).

## Puesta en marcha (una sola vez)

1. **Supabase → SQL Editor**: ejecutar `supabase/migrations/0015_copias_seguridad.sql`.
2. **Supabase → Database → Settings → Database password → Reset database password** → *Generate a password* → copiarla (no afecta a la app ni a los usuarios). Enlace directo: `https://supabase.com/dashboard/project/mgiekkqbgptxmqcrhxlr/database/settings`.
3. **GitHub → Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_DB_PASSWORD` = **solo la contraseña** del paso 2 (sin nada más). La dirección del servidor ya la pone la tarea (proyecto `mgiekkqbgptxmqcrhxlr`, *Session pooler* `aws-0-eu-central-1.pooler.supabase.com:5432`), y los símbolos raros de la contraseña se adaptan solos.
   - `BACKUP_PASSPHRASE` = una contraseña larga inventada (mínimo 12 caracteres; mejor una frase). **Apuntarla también fuera de GitHub** (en papel en la clínica y en el gestor de contraseñas de la administración). Si se pierde, las copias no se pueden abrir.
   - (Alternativa avanzada: `SUPABASE_DB_URL` con la dirección completa del *Session pooler*. Si existen las dos, manda `SUPABASE_DB_PASSWORD`.)
4. **GitHub → Actions → Copia de seguridad diaria → Run workflow**. Al cabo de un par de minutos debe salir en verde, y la app mostrará la copia en Ajustes.

## Recuperar

> ⚠️ Restaurar **sustituye todos los datos** por los de la copia. Lo que se hiciera después de la copia se pierde. Antes de nada, si la app todavía funciona, haz una copia del estado actual (Run workflow) por si hubiera que volver atrás.

### Caso 1 · "Se ha borrado o estropeado algo" (mismo proyecto de Supabase)

1. Elegir la copia: GitHub → **Actions → Copia de seguridad diaria**. Cada ejecución en verde es una copia; su fecha es la del día (`copia-seguridad-AAAA-MM-DD`).
2. GitHub → **Settings → Secrets and variables → Actions → New repository secret**: `RESTORE_DB_PASSWORD` = la contraseña de la base de datos (la misma que `SUPABASE_DB_PASSWORD`). Este secreto se crea solo para recuperar y es una protección: sin él, la tarea de restaurar no hace nada.
3. GitHub → **Actions → Restaurar una copia de seguridad → Run workflow**:
   - *Día de la copia*: `AAAA-MM-DD` (vacío = la más reciente).
   - *Confirmar*: escribir `RESTAURAR`.
   - *Proyecto nuevo*: **sin marcar**.
4. Cuando termine en verde: **borrar el secreto `RESTORE_DB_PASSWORD`**, abrir la app y comprobar.

La restauración se hace en una sola transacción: si algo falla, la base de datos se queda exactamente como estaba.

### Caso 2 · Catástrofe total (proyecto de Supabase perdido o inutilizable)

1. Crear un proyecto nuevo en Supabase (región de la UE, Fráncfort).
2. En el SQL Editor del proyecto nuevo, ejecutar **en orden** todos los scripts de `supabase/migrations/` (0001, 0002, …). Así queda la estructura, los permisos, las carpetas de fotos y el tiempo real.
3. Restaurar como en el caso 1, pero con el secreto `RESTORE_DB_URL` = dirección completa del **proyecto nuevo** (Supabase → Connect → Direct → *Session pooler*, sustituyendo `[YOUR-PASSWORD]`) y marcando **Proyecto nuevo** (carga también las cuentas de acceso, para que todos sigan entrando con su correo y contraseña).
4. Conectar la app al proyecto nuevo: GitHub → **Settings → Secrets and variables → Actions → Variables**: actualizar `SUPABASE_URL` y `SUPABASE_ANON_KEY` con los del proyecto nuevo (Supabase → Connect → App frameworks). Actualizar también el secreto `SUPABASE_DB_PASSWORD` (y, si el servidor del *pooler* es otro, la variable `SUPABASE_DB_HOST` y `SUPABASE_PROJECT_REF` en el workflow) para que las copias sigan. Volver a publicar: Actions → Publicar web y app → Run workflow.
5. En el proyecto nuevo, revisar lo que vive fuera de la base de datos, según `app/src/data/supabase/README.md`: inicio de sesión con Google y direcciones permitidas (Authentication → URL Configuration), la función de notificaciones y sus claves VAPID, y la tarea nocturna (`pg_cron`).
6. Las fotos de los clientes no están en la copia: cada cliente puede volver a ponerse la suya desde su perfil.

### Sin GitHub (a mano)

Con un ordenador con PostgreSQL 17 (cliente) y gpg:

```bash
# Descargar el .zip de la copia desde GitHub (Actions → la ejecución → Artifacts) y descomprimirlo.
RESTORE_DB_PASSWORD='...' BACKUP_PASSPHRASE='...' bash scripts/copias/restaurar-copia.sh copia-AAAA-MM-DD_HHMM.tar.gpg
# Proyecto nuevo: añadir --con-usuarios al final.
```

Para solo mirar el contenido de una copia (sin restaurar): `gpg -d copia-....tar.gpg | tar -x` y abrir `datos-public.dump` con `pg_restore -f datos.sql datos-public.dump`.

## Cosas a tener en cuenta

- **GitHub desactiva las tareas programadas de un repositorio público tras 60 días sin cambios.** La tarea intenta mantenerse activa sola, pero la señal fiable es la de la app: si en Ajustes sale en rojo, entrar en GitHub → Actions → Copia de seguridad diaria y, si pone que está desactivada, pulsar **Enable workflow**.
- Si se cambia la contraseña de la base de datos en Supabase, hay que actualizar `SUPABASE_DB_PASSWORD` en GitHub (si no, las copias fallarán y llegará el aviso).
- Si se cambia `BACKUP_PASSPHRASE`, las copias antiguas siguen necesitando la contraseña antigua: guardarlas las dos mientras existan copias con la anterior (90 días).
- El Excel de **Ajustes → Descargar los datos en Excel** es una foto de lo esencial para tenerlo a mano; no sirve para restaurar la app. Es confidencial (datos personales y de salud).
