# Pendiente de verificar con un proyecto Supabase real

El modo SUPABASE se ha escrito sin acceso a red, tipando contra los `.sql` de `supabase/migrations`
y con tests de mapeo. Antes de darlo por bueno hay que comprobar, con un proyecto real:

## Carga (`cargar.ts`)
- [ ] `config_centro`: `.maybeSingle()` devuelve la única fila (id = true) para clientes y trabajadores.
- [ ] Filtro de reservas por fecha de su clase: `select('*, clases!inner(fecha)').gte('clases.fecha', …)`.
      Si PostgREST no acepta el filtro sobre la relación embebida, alternativa: cargar las clases del
      rango y luego `reservas.in('clase_id', ids)` por lotes (o una vista `reservas_con_fecha`).
      Comprobar también que la columna embebida `clases` sobrante no molesta al mapeo (se ignora).
- [ ] Un **cliente** no ve `trabajadores` (RLS) → se usa la vista `monitores`. Confirmar que la vista
      devuelve filas al cliente (`security_invoker = false` + grant) y que `clases.monitor_id` cuadra.
- [ ] Un trabajador **sin** `CLINICA_VER` no recibe `clientes_clinica` (lista vacía, sin error 4xx que
      rompa la carga). Un cliente no recibe `auditoria` ni `trabajadores` (idem).
- [ ] Límite de filas por consulta: `LIMITE_FILAS = 10000` y el `max-rows` de PostgREST (por defecto
      1000 en Supabase). Si el centro supera 1000 reservas en ±3 meses habrá que paginar (`.range`).
- [ ] Formato real de `timestamptz` en JSON (se espera `2026-09-26T10:00:00.123456+00:00`) y de
      `time` (`09:00:00`). Los tests cubren ambos, pero conviene ver una fila real.
- [ ] Rendimiento de la carga completa (19 consultas en paralelo) en móvil con datos reales.

## Comandos (`comandos.ts`)
- [ ] Nombres y tipos de los parámetros de cada RPC (`p_*`): `reservar`, `cancelar_reserva`,
      `anadir_alumno`, `registrar_asistencia`, `autorizar_recuperacion`, `cancelar_clase`,
      `publicar_aviso`, `crear_contrato`, `finalizar_contrato`, `generar_clases`.
      En especial los arrays (`p_categorias_permitidas`, `p_franjas`, `p_actividades_permitidas`,
      `p_cliente_ids`) y los enum (`p_asistencia`, `p_categoria_origen`, `p_destino_tipo`, `p_modalidad`).
- [ ] Los mensajes de `raise exception` llegan en `error.message` tal cual (sin prefijo) y se muestran
      bien en los toasts. Si PostgREST antepone algo, ajustar `mensajeError` en `cliente.ts`.
- [ ] `reservar` desde un cliente: se envía `p_cliente_id: null` (la RPC usa `auth_cliente_id()`).
- [ ] Insert de clase extraordinaria con `id` generado en el cliente (`crypto.randomUUID()`):
      RLS `clases_escribir` con `CLASES_CREAR_CANCELAR`. Ídem upserts de `plantillas_clase`, `tarifas`,
      `actividades`, `trabajadores`, `clientes` (insert + `clientes_clinica` upsert con `CLINICA_VER`).
- [ ] `guardarCliente` por un trabajador con `CLIENTES_EDITAR` pero sin `CLINICA_VER`: no se toca
      `clientes_clinica` (y no debe fallar).
- [ ] `guardarPlantilla` llama después a `generar_clases(hoy, hoy+70)`; la RPC exige
      `HORARIOS_GESTIONAR` o `CLASES_CREAR_CANCELAR`. ¿Debe también generar reservas automáticas de los
      contratos fijos existentes (el demo lo hace)? Hoy eso ocurre en `mantenimiento_diario` nocturno.
- [ ] `actualizarConfig` con `diasCierre`: `delete().not('fecha','is',null)` borra toda la tabla
      (solo ADMIN) y reinserta. Las clases ya programadas en los nuevos cierres se cancelan en el
      siguiente `mantenimiento_diario`; valorar una RPC `aplicar_dias_cierre()` si hace falta al momento.
- [ ] `marcarAvisoLeido`: `upsert(..., { ignoreDuplicates: true })` en `aviso_lecturas` con solo
      política de INSERT (sin UPDATE). Si PostgREST exige más, sustituir por `insert` ignorando 23505.
- [ ] `actualizarPreferenciasCliente`: el trigger `clientes_autoedicion` permite cambiar
      `telefono`, `email`, `direccion`, `notificaciones_push` al propio cliente.
- [ ] `guardarTrabajador` / `guardarCliente` no envían `user_id`: comprobar que un upsert sin la
      columna no la pone a NULL (upsert = INSERT … ON CONFLICT DO UPDATE de las columnas enviadas).
- [ ] `quitarAlumno` = `cancelar_reserva(id, true)`: la RPC solo permite `p_forzar_recuperable` al personal.
- [ ] Tras cada comando se recarga toda la instantánea: medir latencia y, si molesta, recargar solo
      las tablas afectadas.

## Autenticación (`auth.ts`, `PantallaAcceso.tsx`)
- [ ] Mensajes de error reales de `signInWithPassword` (`Invalid login credentials` →
      "Email o contraseña incorrectos.").
- [ ] `resetPasswordForEmail` con `redirectTo = origin + pathname`: añadir esa URL a
      Authentication → URL Configuration → Redirect URLs. Con HashRouter, comprobar que el `?code=`
      (PKCE) o el `#access_token…&type=recovery` se procesa y dispara `PASSWORD_RECOVERY`, que muestra la
      pantalla "Elige una contraseña nueva" (`recuperandoContrasena`).
- [ ] `updateUser({ password })` funciona en la sesión de recuperación.
- [ ] Sesión persistida: al recargar la página entra directamente (getSession + carga).
- [ ] Usuario autenticado sin fila en `clientes`/`trabajadores`: pantalla "Tu usuario aún no está
      dado de alta" con botón Salir.
- [ ] Trabajador o cliente con `activo = false`: RLS le oculta casi todo; decidir si se le muestra
      un mensaje específico (hoy verá la app casi vacía).

## Tiempo real (`tiempoReal.ts`)
- [ ] Añadir las tablas a la publicación: `alter publication supabase_realtime add table
      public.reservas, public.clases, public.avisos, public.recuperaciones, public.contratos;`
- [ ] Realtime respeta RLS (necesita `replica identity` por defecto y usuario autenticado);
      comprobar que el canal se suscribe (`SUBSCRIBED`) y que un cambio de otro usuario recarga.
- [ ] Sin Realtime (plan/limitación), el respaldo (visibilitychange + 5 min) es suficiente.

## Despliegue
- [ ] Variables de repositorio `SUPABASE_URL` y `SUPABASE_ANON_KEY` en GitHub → build en modo SUPABASE.
- [ ] Service worker (PWA): tras cambiar de modo, el SW antiguo puede servir el build anterior hasta
      la siguiente actualización (`registerType: 'autoUpdate'`).
- [ ] CORS/URL del proyecto correctos en GitHub Pages (`https://<usuario>.github.io/<repo>/app/`).

## Push (`lib/push.ts`, `supabase/push.ts`, `sw.ts`, Edge Function `enviar-push`)
- [ ] Desplegar `supabase/functions/enviar-push` y definir los secrets `VAPID_PUBLIC_KEY`,
      `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (ver `supabase/README.md` § 8). La variable de GitHub
      `VAPID_PUBLIC_KEY` debe ser la misma clave pública que el secret.
- [ ] Import de `npm:web-push@3` en Deno (Edge Runtime): `deno check` local pasa, pero comprobar
      que `webpush.sendNotification` funciona en el Edge Runtime de Supabase (usa `https`/`crypto`
      de Node vía `node:`). Si fallara, alternativa: `jsr:@negrel/webpush` (nativo Deno).
- [ ] Upsert en `suscripciones_push` con `onConflict: 'endpoint'` por el cliente (RLS `push_propias`)
      y borrado por endpoint al desactivar. Comprobar que `user_agent` (≤500 chars) no molesta.
- [ ] `supabase.functions.invoke('enviar-push')` envía el `Authorization: Bearer <jwt>` del usuario y
      la función lo acepta con "Verify JWT" activado. Los errores 4xx llegan con `error.context`
      (Response) y `invocarEnvioPush` extrae el `{ error }` JSON para el toast.
- [ ] Permisos en la función: trabajador con `AVISOS_ENVIAR` o `CLASES_CREAR_CANCELAR`
      (`trabajadores` + embebido `trabajador_permisos(permiso)`), ADMIN siempre; un cliente
      recibe 403 con `{ avisoId }` y 200 con `{ prueba: true }`.
- [ ] Tras `cancelarClase` con `avisar = true`, el store busca el aviso más reciente con
      `destino.tipo = 'CLASE'` y `claseId` en la instantánea recargada: verificar que la recarga
      ya incluye el aviso creado por la RPC (mismo request) y que llega el push a los afectados.
- [ ] Suscripciones caducadas: el servicio push devuelve 404/410 y la función las borra
      (`borradas` > 0). El botón de prueba avisa al cliente para volver a activar.
- [ ] SW `injectManifest`: `dist/sw.js` con manifest inyectado (verificado en preview: registrado,
      `index.html` precacheado, navegación offline). Comprobar en GitHub Pages con `VITE_BASE`
      `/<repo>/app/` que `import.meta.env.BASE_URL` del SW coincide con el scope.
- [ ] `notificationclick`: `WindowClient.navigate()` a `#/avisos` en Android/Chrome; en iOS
      (Safari 16.4+, app instalada) al menos enfoca/abre la app. Icono `icons/icon-192.png` visible.
- [ ] Mensajes de la UI: navegador sin soporte, permiso denegado (instrucciones para reactivarlo),
      iPhone sin instalar (abre la hoja "Instalar la app").
