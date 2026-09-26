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

## 8. Pruebas locales (opcional, para desarrolladores)

`tests/prueba_local.sh` crea una base `pilates_test` en un PostgreSQL 16 local, simula el schema
`auth` de Supabase, aplica migraciones y seed y ejecuta `tests/pruebas.sql` (reglas de reserva,
cupos, aforo, cancelaciones, recuperaciones, bono, cancelación por el centro y RLS por rol).

```bash
bash supabase/tests/prueba_local.sh
```

Termina con `TODAS LAS PRUEBAS HAN PASADO` o se detiene en la primera comprobación que falle.
