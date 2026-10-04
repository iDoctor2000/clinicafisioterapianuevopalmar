# Base de datos de la app de reservas (Supabase)

Esta carpeta contiene todo lo necesario para crear la base de datos de producción de la app de
Pilates en [Supabase](https://supabase.com): las tablas, las reglas de seguridad, las funciones con
las reglas de negocio (reservar, cancelar, etc.) y los datos iniciales del centro.

```
supabase/
├── migrations/
│   ├── 0001_esquema.sql     Tablas, tipos, índices y trigger de aforo
│   ├── 0002_seguridad.sql   Funciones de identidad y Row Level Security (RLS)
│   └── 0003_funciones.sql   Reglas de negocio como funciones RPC
├── seed.sql                 Configuración, actividades, tarifas, horario y trabajadores
├── tests/                   Pruebas automáticas sobre un PostgreSQL local
└── README.md                Este documento
```

No hace falta saber programar para seguir estos pasos; solo copiar y pegar en el orden indicado.

---

## 1. Crear el proyecto en Supabase

1. Entra en <https://supabase.com> y crea una cuenta (o inicia sesión).
2. Pulsa **New project**.
3. Rellena:
   - **Name**: por ejemplo `pilates-nuevo-palmar`.
   - **Database password**: una contraseña larga. **Guárdala en un sitio seguro** (gestor de
     contraseñas); no se vuelve a mostrar y hace falta para conectar herramientas externas.
   - **Region**: elige **Europe (Frankfurt)** `eu-central-1`. Es obligatorio que sea una región de
     la Unión Europea para cumplir el RGPD, porque vamos a guardar datos personales y de salud.
4. Pulsa **Create new project** y espera un par de minutos a que termine de prepararse.

## 2. Aplicar las migraciones (crear las tablas)

Hay dos maneras. La primera no requiere instalar nada.

### Opción A · Desde el navegador (SQL Editor)

1. En el menú izquierdo del proyecto pulsa **SQL Editor** → **New query**.
2. Abre el archivo `migrations/0001_esquema.sql`, copia **todo** su contenido, pégalo en el editor y
   pulsa **Run** (o Ctrl+Enter). Debe aparecer "Success. No rows returned".
3. Repite exactamente lo mismo, **en este orden**, con:
   - `migrations/0002_seguridad.sql`
   - `migrations/0003_funciones.sql`
   - `seed.sql` (datos iniciales: configuración, actividades, tarifas, horario semanal y 3
     trabajadores de ejemplo sin cuenta de acceso).
4. Comprueba en **Table Editor** que aparecen las tablas (`clientes`, `clases`, `reservas`…) y que
   `actividades` y `tarifas` tienen filas.

Si un archivo da error a mitad, no se aplica nada de ese archivo (cada uno se ejecuta como una
sola transacción). Corrige la causa y vuelve a ejecutarlo. `seed.sql` puede ejecutarse varias veces
sin duplicar datos.

### Opción B · Con la línea de comandos (Supabase CLI)

Para quien tenga instalada la [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref <ref-del-proyecto>   # el "Reference ID" de Project Settings → General
supabase db push                                  # aplica migrations/*.sql en orden
supabase db query --file supabase/seed.sql        # o pegar seed.sql en el SQL Editor
```

## 3. Programar el mantenimiento nocturno (pg_cron)

Cada noche hay que ejecutar `mantenimiento_diario()`, que genera las clases de los próximos 70 días,
crea las reservas automáticas de los clientes con horario fijo, caduca las recuperaciones vencidas
y cierra los contratos terminados.

1. En el menú izquierdo: **Database → Extensions**. Busca `pg_cron` y actívala (**Enable**).
2. En **SQL Editor** ejecuta (la hora es UTC; 03:15 UTC = 04:15/05:15 en España):

```sql
select cron.schedule(
  'mantenimiento-diario',
  '15 3 * * *',
  $$ select public.mantenimiento_diario() $$
);
```

3. Para comprobar que está programado: `select * from cron.job;`
   Y para ver las últimas ejecuciones: `select * from cron.job_run_details order by start_time desc limit 10;`

También puedes ejecutarlo a mano en cualquier momento desde el SQL Editor con
`select public.mantenimiento_diario();` (devuelve un resumen de lo que ha hecho).

## 4. Crear el primer usuario administrador

Los trabajadores del `seed.sql` existen como fichas pero **no tienen cuenta de acceso**. Para que
el administrador pueda entrar en la app:

1. **Authentication → Users → Invite user** (o **Add user → Send invitation**). Escribe el email del
   administrador (el mismo que figura en la ficha de `trabajadores`, por ejemplo
   `josediego@fisioterapianuevopalmar.com`). Le llegará un correo para fijar su contraseña.
2. En esa misma pantalla, copia el **UUID** del usuario recién creado (columna *UID*).
3. En **SQL Editor** vincula la ficha del trabajador con esa cuenta:

```sql
update public.trabajadores
   set user_id = 'PEGA-AQUI-EL-UUID-DEL-USUARIO'
 where email = 'josediego@fisioterapianuevopalmar.com';
```

   Si prefieres crear la ficha desde cero:

```sql
insert into public.trabajadores (nombre, apellidos, email, rol, es_monitor, user_id)
values ('Nombre', 'Apellidos', 'correo@ejemplo.com', 'ADMIN', true, 'PEGA-AQUI-EL-UUID');
```

El rol `ADMIN` tiene todos los permisos sin necesidad de añadirlos en `trabajador_permisos`.
A partir de aquí, el resto de trabajadores y los clientes se dan de alta igual: se invitan por email
en *Authentication* y se pone su UUID en `trabajadores.user_id` o en `clientes.user_id`
(en el futuro la propia app lo hará).

## 5. Conectar la app: URL y clave anónima

La app necesita dos datos, que se obtienen en **Project Settings → API**:

- **Project URL**: algo como `https://abcdefghij.supabase.co`.
- **anon public key** (clave `anon`): una cadena larga que empieza por `eyJ…`.

La clave `anon` **es pública** (va dentro de la app) y no da acceso a nada por sí sola: toda la
seguridad está en las reglas RLS de la base de datos. La clave **`service_role`** de esa misma
pantalla, en cambio, se salta todas las reglas: **nunca** debe ponerse en la app ni compartirse;
solo la usarán funciones de servidor (envío de notificaciones push, webhook de Stripe).

## 6. Por qué la información clínica está en una tabla aparte

1. Los datos de salud (lesiones, patologías, observaciones) son una **categoría especial** del RGPD
   y de la LOPDGDD: requieren más protección que el nombre o el teléfono.
2. Por eso viven en `clientes_clinica`, separada de `clientes`, y solo pueden leerla o editarla los
   trabajadores con el permiso **CLINICA_VER** (el administrador siempre lo tiene).
3. Las reglas **RLS** (Row Level Security) se aplican dentro de la propia base de datos: aunque
   alguien manipule la app o conozca la clave `anon`, el servidor filtra fila a fila lo que puede ver.
4. Un cliente solo ve su ficha de contacto, sus reservas, recuperaciones, contratos y avisos; nunca
   la de otros clientes ni su propia ficha clínica (que gestiona el fisioterapeuta).
5. Las acciones con reglas (reservar, cancelar, cancelar una clase) no se hacen escribiendo en las
   tablas, sino llamando a funciones que comprueban permisos y dejan rastro en `auditoria`.

## 7. Qué hace cada función (para la app)

| Función RPC | Quién | Qué hace |
|---|---|---|
| `reservar(clase_id, cliente_id?)` | cliente / personal con RESERVAS_GESTIONAR | Aplica cupo semanal, bono o recuperación. Devuelve `{reserva_id, via, mensaje}`. |
| `evaluar_reserva(clase_id, cliente_id?)` | igual | Solo consulta: dice si se podría reservar y por qué vía. |
| `cancelar_reserva(reserva_id, forzar_recuperable?)` | cliente / personal | Recuperable si hay antelación (config); devuelve recuperación o sesión de bono. |
| `anadir_alumno(clase_id, cliente_id, modo)` | personal | Mete a un alumno (TARIFA, CLASE_SUELTA o MANUAL). |
| `registrar_asistencia(reserva_id, asistencia)` | ASISTENCIA_REGISTRAR | Marca ASISTE / NO_ASISTE. |
| `autorizar_recuperacion(...)` | RESERVAS_GESTIONAR | Concede una recuperación manual. |
| `cancelar_clase(clase_id, motivo, alternativa?, avisar?)` | CLASES_CREAR_CANCELAR | Cancela la clase, compensa a los afectados y les avisa. |
| `publicar_aviso(titulo, cuerpo, destino, ...)` | AVISOS_ENVIAR | Publica un aviso resolviendo destinatarios. |
| `crear_contrato(...)` / `finalizar_contrato(...)` | CLIENTES_EDITAR | Alta/baja de tarifa; genera reservas automáticas si es horario fijo. |
| `generar_clases(desde, hasta)` | HORARIOS_GESTIONAR | Crea las clases del horario en un rango. |
| `generar_reservas_automaticas(contrato_id)` | RESERVAS_GESTIONAR | Reservas de horario fijo que falten. |
| `mantenimiento_diario()` | ADMIN / pg_cron | Tarea nocturna. |

Desde la app se llaman con `supabase.rpc('reservar', { p_clase_id: ... })`. Si una regla lo
impide, la llamada falla con un mensaje ya redactado para mostrarlo al usuario
(por ejemplo, "Ya tienes las 2 clases de esta semana.").

## 8. Notificaciones push (avisos en el móvil)

La app avisa en el móvil (Web Push) cuando el centro **publica un aviso** o **cancela una clase**.
El cliente lo activa en **Perfil → "Recibir notificaciones en el móvil"**; en iPhone/iPad solo
funciona con la app instalada en la pantalla de inicio (Compartir → Añadir a pantalla de inicio).

Piezas:

- `suscripciones_push` (tabla): la suscripción de cada móvil del cliente (la gestiona la propia app).
- `supabase/functions/enviar-push/` (Edge Function, Deno + `web-push`): la llama la app tras
  `publicar_aviso` / `cancelar_clase` con `{ avisoId }` y envía a los destinatarios del aviso con
  `notificaciones_push = true`. Con `{ prueba: true }` envía una prueba solo a quien la pide.
  Comprueba con el JWT del usuario que quien envía un aviso es un trabajador con `AVISOS_ENVIAR` o
  `CLASES_CREAR_CANCELAR` (el ADMIN siempre) y borra las suscripciones caducadas (404/410).

### 8.1 Generar las claves VAPID (una sola vez)

En cualquier ordenador con Node:

```bash
npx web-push generate-vapid-keys
```

Imprime una **clave pública** y una **clave privada**. La pública puede ir en la app; la privada
**solo** en Supabase (nunca en el repositorio ni en la app).

### 8.2 Dónde poner cada clave

| Clave | Dónde | Nombre |
|---|---|---|
| Pública | GitHub → Settings → Secrets and variables → Actions → **Variables** → New repository variable | `VAPID_PUBLIC_KEY` |
| Pública | Supabase → Edge Functions → **Secrets** | `VAPID_PUBLIC_KEY` |
| Privada | Supabase → Edge Functions → **Secrets** | `VAPID_PRIVATE_KEY` |
| Contacto | Supabase → Edge Functions → **Secrets** | `VAPID_SUBJECT` = `mailto:correo@delcentro.es` |

El workflow de GitHub Pages pasa la variable a la app como `VITE_VAPID_PUBLIC_KEY` (para
desarrollo local, ponla en `app/.env.local`). `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY` las inyecta Supabase en la función automáticamente.

### 8.3 Desplegar la función `enviar-push`

**Opción A · Desde el panel de Supabase** (sin instalar nada):

1. Edge Functions → **Deploy a new function** → "Via Editor".
2. Nombre: `enviar-push`. Pega el contenido de `supabase/functions/enviar-push/index.ts`.
3. Si el editor lo permite, añade también `deno.json` con el mismo contenido que el del repositorio
   (si no, cambia los dos `import` del principio por `npm:@supabase/supabase-js@2` y `npm:web-push@3`).
4. Deja activada la opción **"Verify JWT"** (la función exige la sesión del usuario).
5. Deploy. Después añade los Secrets del punto 8.2 (Edge Functions → Secrets).

**Opción B · Con la Supabase CLI**:

```bash
supabase login
supabase link --project-ref <ref-del-proyecto>
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:correo@delcentro.es
supabase functions deploy enviar-push
```

### 8.4 Probar

1. Publica la app con `VAPID_PUBLIC_KEY` ya definida en GitHub (el workflow vuelve a compilarla).
2. Entra como cliente en el móvil (en iPhone, con la app instalada), activa
   **Perfil → Recibir notificaciones en el móvil** y acepta el permiso.
3. Pulsa **"Enviar notificación de prueba"**: debe llegar en unos segundos.
4. Desde el personal, publica un aviso: la app llama a la función en segundo plano. Los fallos se ven
   en Supabase → Edge Functions → `enviar-push` → Logs.

## 9. Fotos de clientes

La app permite que cada cliente ponga su foto (Perfil → toca el avatar → "Hacer una foto" o
"Elegir de la galería") y que el personal con `CLIENTES_EDITAR` la ponga o cambie desde la ficha del
cliente. La foto sirve para identificar a los alumnos al pasar asistencia en el detalle de la clase.
La imagen se recorta a cuadrado y se reduce a 256×256 JPEG **en el móvil** antes de subirla
(unos 10-30 KB), así que el espacio de Storage que consume es mínimo.

Qué hace `migrations/0006_fotos.sql`:

- Añade la columna `clientes.foto_url` (ruta del objeto + `?v=<marca>`; `NULL` = sin foto).
- Actualiza el trigger de autoedición para que un cliente pueda cambiar su `foto_url` (y solo la suya).
- Crea el bucket **privado** `fotos-clientes` (límite **500 KB** por archivo; solo `image/jpeg`,
  `image/png`, `image/webp`) y sus políticas sobre `storage.objects`: cada cliente accede solo a su
  carpeta `<cliente_id>/avatar.jpg`; el personal lee con `CLIENTES_VER` y escribe con
  `CLIENTES_EDITAR`, y con ámbito «Solo sus clases» únicamente las fotos de sus alumnos.

Aplicación: pega `migrations/0006_fotos.sql` en **SQL Editor → Run** (o `supabase db push`), igual
que el resto. Se puede ejecutar varias veces. En un PostgreSQL local sin el schema `storage`
(pruebas) la parte del bucket se omite con un aviso y el resto se aplica.

Comprobar: en **Storage** debe aparecer el bucket `fotos-clientes` marcado como *Private*; en
**Storage → Policies** las tres políticas `fotos_cliente_propio`, `fotos_personal_ver` y
`fotos_personal_editar`. Al subir una foto desde la app aparece el objeto `<id del cliente>/avatar.jpg`.
Como el bucket es privado, la app pide URLs firmadas (válidas 1 hora) y las guarda en memoria;
al cambiar o quitar la foto se sustituye o borra el objeto. Si la app muestra «El almacén de fotos
no está configurado en el servidor», falta ejecutar esta migración.

Protección de datos: la foto solo la ve el personal del centro (y el propio cliente), nunca otros
clientes; el cliente puede quitarla cuando quiera desde su perfil.

## 10. Pruebas locales (opcional, para desarrolladores)

`tests/prueba_local.sh` crea una base `pilates_test` en un PostgreSQL 16 local, simula el schema
`auth` de Supabase, aplica migraciones y seed y ejecuta `tests/pruebas.sql` (reglas de reserva,
cupos, aforo, cancelaciones, recuperaciones, bono, cancelación por el centro, RLS por rol y foto del cliente).

```bash
bash supabase/tests/prueba_local.sh
```

Termina con `TODAS LAS PRUEBAS HAN PASADO` o se detiene en la primera comprobación que falle.

## Carrusel de la portada e identidad visual (0008)

Qué hace `migrations/0008_portada.sql`:

- Crea la tabla `portada_imagenes` (url, pie, orden, activa): las fotos del centro que ven los clientes
  en el carrusel de Inicio. RLS: cualquier usuario autenticado las lee; solo el administrador
  (`es_admin()`) las crea, edita, reordena o borra.
- Crea el bucket **público** `portada` (límite 2 MB; `image/jpeg`, `image/png`, `image/webp`) con lectura
  pública y escritura solo del administrador. La app reduce cada foto a 1600 px de ancho (JPEG 82 %)
  antes de subirla, así que pesan unos 150-300 KB.
- Añade la tabla a la publicación `supabase_realtime`.
- Nueva identidad (antracita + beige): cambia el color por defecto de actividades y trabajadores y
  sustituye los verdes de ejemplo (`#548C2F`, `#7FB356`, `#A3CB80`, `#8FBF6A`) por tonos beige/antracita.
  Los colores siguen siendo por actividad y se cambian en Tarifas.

Aplicación: pega `migrations/0008_portada.sql` en **SQL Editor → Run** (o `supabase db push`). Es
idempotente. Comprobar: en **Storage** aparece el bucket `portada` marcado como *Public* con las políticas
`portada_leer` y `portada_admin_escribir`; en la app, Ajustes → «Fotos de la portada» permite subir,
reordenar, ocultar y borrar fotos. Si la app avisa «El almacén de fotos de la portada no está
configurado», falta ejecutar esta migración.

## Web pública: textos y fotos en Supabase (0009)

Qué hace `migrations/0009_web.sql`:

- Crea la tabla `web_contenido` (una sola fila, `id = 'main'`, columna `datos` en JSON): los textos e
  imágenes de la web pública, tal y como los guarda el editor de `index.html`. RLS: lectura pública
  (la web los lee sin sesión); inserción y actualización solo del administrador (`es_admin()`).
- Crea el bucket **público** `web` (límite 5 MB; `image/jpeg`, `image/png`, `image/webp`) para las fotos
  que se suben desde el editor, con lectura pública y escritura solo del administrador. El editor reduce
  cada foto a 1600 px (JPEG 84 %) antes de subirla.
- Añade la tabla a la publicación `supabase_realtime` (la web abierta en otro dispositivo se actualiza sola).

Con esto la web deja de usar Firebase. El editor (rueda dentada del pie de la web) pide el **correo y la
contraseña de un administrador de la app**; quien entra en la app con Google tiene que crearse antes una
contraseña con «Crear mi contraseña». La primera vez que un administrador abre el editor, un aviso le
ofrece **importar los textos de la versión anterior (Firebase)**: es una lectura puntual, sin tocar nada
en Firebase, y los guarda en `web_contenido`.

Aplicación: pega `migrations/0009_web.sql` en **SQL Editor → Run**. Es idempotente. Comprobar: en
**Table Editor** aparece `web_contenido` (vacía hasta el primer guardado) y en **Storage** el bucket `web`
marcado como *Public* con las políticas `web_leer` y `web_admin_escribir`.

## Actividades, tarifas y contacto de Pilates en la web (0010)

Qué hace `migrations/0010_actividades_web.sql`:

- Amplía `actividades` con `nombre_web`, `duracion_min`, `lema`, `descripcion_larga`, `icono` (clave de icono
  incluido o URL subida) y `foto_url`, y `config_centro` con `direccion`, `telefono`, `whatsapp`, `instagram` y
  `email` (contacto del centro de Pilates). El administrador los edita en la app (Tarifas → Actividades y Ajustes).
- Lectura pública (`anon`) de actividades activas, tarifas activas, cupos y `config_centro`: la web pública
  muestra actividades, tarifas y contacto directamente de aquí, en tiempo real. La escritura no cambia.
- Datos 2026 (solo si existe el catálogo real de `datos_reales.sql`): las nueve actividades del cartel con sus
  textos, duraciones e iconos; precios y ofertas trimestrales de las tarifas; contacto del centro
  (C/ Artemisa 6, 620 600 591 con WhatsApp, @pilatesnuevopalmar) y, si no había, cinco fotos del centro en la
  portada de la app (rutas relativas `../assets/pilates-N.jpg`, válidas con y sin dominio propio).

Las imágenes subidas desde la app (icono o foto de una actividad) van al bucket `web` (0009), carpeta
`actividades/`. Aplicación: pega `migrations/0010_actividades_web.sql` en **SQL Editor → Run**. Idempotente.

## Cambios del horario aplicados a las clases futuras (0011)

`migrations/0011_horario_cambios.sql` crea `plantilla_aplicar_cambios(p_plantilla_id)`: al editar una franja desde
la app, las clases futuras de esa franja se recrean con los datos nuevos. Se eliminan las clases PROGRAMADA desde
hoy sin reservas o solo con reservas automáticas (horario fijo, que se regeneran); las que tienen reservas de
clientes o del centro se conservan y la función devuelve cuántas son (la app lo avisa). Requiere
`HORARIOS_GESTIONAR` y ámbito "Todo el centro". Aplicación: pega el archivo en **SQL Editor → Run**.
