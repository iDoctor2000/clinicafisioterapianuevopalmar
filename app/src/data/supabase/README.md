# Modo Supabase (producción)

La app tiene dos modos, decididos en tiempo de build por `app/src/data/supabase/cliente.ts`:

| | DEMO | SUPABASE |
|---|---|---|
| Cuándo | Faltan `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Están las dos variables |
| Acceso | Se elige un usuario sin contraseña | Supabase Auth: email + contraseña |
| Datos | `Db` en memoria persistido en localStorage | `Db` cargado del servidor (no se guarda en el navegador) |
| Mutaciones | Funciones puras de `data/comandos.ts` | RPC / insert / update de `supabase/comandos.ts` |
| Mantenimiento diario | `generarClasesPendientes` al arrancar | `mantenimiento_diario()` con pg_cron |

## Enfoque "instantánea"

La UI nunca habla con Supabase: sigue leyendo un `Db` completo del store y llamando a
`ejecutar('comando', args)`. En modo SUPABASE:

1. `cargar.ts` lee todas las tablas en paralelo (respetando lo que RLS deje ver) y monta un `Db`
   con `mapeo.ts` (snake_case ↔ camelCase, `time` ↔ `HH:mm`, `timestamptz` ↔ ISO). Clases y reservas
   se limitan a ±3 meses. Una tabla no visible se convierte en lista vacía (con `console.warn`).
2. `comandos.ts` implementa cada comando de `data/comandos.ts`: los que tienen reglas de negocio
   llaman a las RPC de `supabase/migrations/0003_funciones.sql`; los CRUD escriben directamente
   (protegidos por RLS). Los ids nuevos se generan en el cliente (`crypto.randomUUID()`), así no
   hace falta un `select` después de escribir.
3. El store (`data/store.ts`) ejecuta el comando remoto, **recarga** la instantánea y solo entonces
   resuelve la promesa, de modo que la UI ya ve los datos frescos. El `valor` del resultado se
   resuelve sobre el `Db` recargado (p. ej. la reserva creada).
4. `tiempoReal.ts` recarga (con debounce de 500 ms) cuando cambian `reservas`, `clases`, `avisos`,
   `recuperaciones` o `contratos`, al volver la pestaña a primer plano y cada 5 minutos.
5. `auth.ts` resuelve la `Sesion` de la app buscando el `user_id` primero en `trabajadores` y luego
   en `clientes`. Si no está en ninguna, la pantalla de acceso lo explica y ofrece "Salir".

`ejecutar` devuelve siempre una `Promise<Resultado>` (en DEMO resuelta al instante); por eso los
manejadores de la UI son `async` y hacen `await`.

## Variables de entorno

Ver `app/.env.example`. En GitHub Pages se inyectan desde las variables de repositorio
`SUPABASE_URL` y `SUPABASE_ANON_KEY` (`.github/workflows/deploy.yml`).

## Alta de usuarios

La app no crea cuentas de acceso. El flujo previsto: crear el usuario en Supabase (Authentication →
Users → Add user) y poner su `id` en `clientes.user_id` o `trabajadores.user_id`. Por eso
`deCliente`/`deTrabajador` no envían `user_id` (no se puede desvincular por error desde la app).

Qué queda por comprobar contra un proyecto real: `PENDIENTE_VERIFICAR.md`.
