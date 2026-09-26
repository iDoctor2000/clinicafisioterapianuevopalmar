# Nuevo Palmar Pilates · Planteamiento de la aplicación

> Documento de arranque del proyecto. Explica qué vamos a construir, con qué tecnología, por qué, y en qué orden. Está escrito para leerse sin conocimientos técnicos; los detalles técnicos van en cajas aparte.

---

## 1. En una frase

Una aplicación web instalable en el móvil (y usable desde el ordenador de recepción) que automatiza todo el ciclo **cliente → tarifa → actividades permitidas → horario → reservas automáticas → cancelación → recuperación → asistencia → avisos → estadísticas**, para que el centro tenga el mínimo trabajo manual y el sistema controle solo las condiciones de cada cliente.

## 2. Decisiones clave (y por qué)

| Decisión | Qué hemos elegido | Por qué |
|---|---|---|
| Tipo de aplicación | **PWA** (aplicación web progresiva) | Una sola aplicación que se instala en iPhone, Android y ordenador sin pasar por las tiendas. Se actualiza sola. Si más adelante queréis estar en App Store / Google Play, la misma app se empaqueta (Capacitor / TWA) sin reescribirla. |
| Diseño | Móvil primero, textos grandes, una acción principal por pantalla, confirmaciones claras | El público incluye personas poco habituadas al móvil. Cada pantalla responde a una pregunta: "¿Cuándo es mi próxima clase?", "¿Puedo reservar esta?", "¿Qué pasa si cancelo ahora?". |
| Identidad visual | Verde de la clínica (#548C2F), tipografías Inter y Playfair Display, fondo arena, tarjetas blancas | Continuidad con la web actual de la clínica. Moderno, limpio, sanitario. |
| Dónde viven los datos | **Supabase** (base de datos PostgreSQL gestionada, servidores en Fráncfort, UE) | Los datos son relacionales (cliente ↔ tarifa ↔ reservas ↔ recuperaciones), las estadísticas se calculan con SQL, y la seguridad se aplica *en el servidor* fila a fila (un cliente solo ve lo suyo; la información clínica solo la ve quien tiene permiso). Cumple RGPD y tiene plan gratuito suficiente para empezar. |
| Reglas de negocio | Escritas una sola vez, en un módulo independiente y con pruebas automáticas | Las reglas (antelación, cupos, recuperaciones, bonos) son el corazón del sistema. Están probadas con 28 tests que cubren los casos del documento de requisitos. Las mismas reglas se aplican en el servidor para que nadie pueda saltárselas. |
| Notificaciones | Web Push (funciona en Android, ordenador e iPhone desde iOS 16.4 con la app instalada) + campana de avisos dentro de la app | El cliente puede activarlas o desactivarlas; si las desactiva, sigue viendo los avisos en la campana. |
| Pagos | Estructura preparada (precio en cada tarifa, tabla de pagos) pero sin cobrar todavía | Cuando queráis, se conecta Stripe (tarjeta, Bizum, Apple/Google Pay) sin cambiar el resto. |
| Alojamiento | La misma web de la clínica (GitHub Pages), en la ruta `/app/` | Sin coste, con HTTPS, y el cliente accede desde un botón "Área de clientes" en la web. |

## 3. Cómo funciona el sistema de derechos (lo más importante)

Cada cliente tiene **un contrato activo** con una **tarifa**. La tarifa define:

- **Cupos semanales por categoría**: p. ej. "Dirigidas 2 días" = 2 clases/semana de actividades dirigidas; "Mixta" = 1 Reformer + 1 dirigida.
- **Bonos**: 10 sesiones de una categoría, con validez de 6 meses. Cada reserva descuenta una; si se cancela con antelación, se devuelve.
- **Clase suelta (CS)**: la introduce el personal si hay plaza, sin tarifa.

Modalidades:

- **Horario fijo**: el cliente tiene franjas (martes y jueves 18:00). El sistema genera automáticamente sus reservas durante todo el contrato, descontando festivos y cierres. Solo puede ir a otra clase si tiene una recuperación disponible.
- **Turno libre**: elige sus clases desde la app dentro de su cupo semanal, con 14 días de antelación (configurable).

Cancelaciones (límite configurable, por defecto 1 hora):

- Con antelación suficiente → **Cancelada · recuperable**: se genera una **recuperación** para la categoría de origen (dirigidas o Reformer). Caduca con el contrato (o a N días, configurable).
- Con menos antelación → **Cancelada · no recuperable**: el monitor sabe que no viene, pero la clase cuenta como consumida esa semana.
- Cancelada **por el centro** → nunca penaliza: recuperación automática, aviso a los afectados y, si se indica, clase alternativa propuesta.

Excepciones: el personal con permiso puede **autorizar una recuperación excepcional** (por ejemplo, permitir usar una recuperación de dirigidas en Reformer).

La asistencia (asiste / no asiste) es **independiente** del derecho a recuperar: solo sirve para el historial y las estadísticas.

## 4. Qué verá cada uno

**Cliente (móvil):** Inicio (próxima clase, tarifa, recuperaciones, avisos) · Horario (reservar con explicación clara de si puede o no) · Mis clases (calendario con colores por estado, recuperaciones, bono) · Avisos 🔔 · Perfil (datos, notificaciones, tarifa, instalar la app).

**Equipo (móvil y ordenador):** Calendario (todas las clases, alumnos, plazas, asistencia, cancelar clase, clase extraordinaria, añadir CS) · Clientes (ficha con datos, información clínica restringida, contratación, reservas, recuperaciones) · Horarios · Avisos · Tarifas y actividades · Estadísticas · Equipo y permisos · Ajustes (antelación, cierres, registro de cambios).

Los **12 permisos** del documento de requisitos están implementados; el administrador los asigna a cada trabajador. Todo cambio manual queda en un **registro de auditoría** (quién, cuándo, qué).

## 5. Fases

| Fase | Contenido | Estado |
|---|---|---|
| **0. Cimientos** | Modelo de datos, reglas de negocio con pruebas, diseño base, PWA instalable | ✅ Hecho |
| **1. Demo completa** | Todas las pantallas de cliente y equipo funcionando con datos de ejemplo en el propio dispositivo (sin servidor) para que la probéis y ajustemos textos y flujos | 🔨 En marcha |
| **2. Servidor real** | Crear el proyecto en Supabase, aplicar el esquema (ya escrito y probado), acceso con email + contraseña, conectar la app | Siguiente |
| **3. Puesta en marcha** | Alta de trabajadores y clientes reales, horario real, avisos push, formación de 30 minutos al equipo | |
| **4. Pagos online** | Stripe: pago de cuota y bonos desde la app, renovaciones | Cuando decidáis |
| **5. Ampliaciones** | Lista de espera, control de acceso QR, facturación, varios centros/salas, promociones, integración con calendarios, firma de documentos | Futuro |

## 6. Lo que necesito de vosotros (cuando lleguemos a la fase 2)

1. Una cuenta en [supabase.com](https://supabase.com) creada con el email de la clínica (gratis). Yo preparo todo lo demás; las instrucciones paso a paso están en `supabase/README.md`.
2. El horario semanal real (actividad, día, hora, monitor, plazas) y la lista de tarifas definitiva.
3. Confirmar los parámetros: antelación de cancelación (1 h), días de antelación para reservar (14), caducidad de recuperaciones (con el contrato).
4. Texto legal de protección de datos que ya uséis en la clínica (para el consentimiento en la app).

## 7. Costes previstos

- Alojamiento de la app: **0 €** (GitHub Pages).
- Base de datos y autenticación: **0 €** en plan gratuito de Supabase (suficiente para cientos de clientes); ~25 $/mes si en el futuro queréis copias de seguridad diarias automáticas y más capacidad.
- Notificaciones push: **0 €** (estándar Web Push).
- Pagos (fase 4): comisión de Stripe por transacción (≈1,5 % + 0,25 € en tarjetas europeas).

---

### Cajas técnicas

<details>
<summary>Arquitectura</summary>

- `app/` — Vite + React 18 + TypeScript + Tailwind, PWA con `vite-plugin-pwa` (service worker, manifest, iconos). Rutas con HashRouter para funcionar en GitHub Pages sin configuración.
- `app/src/domain/` — tipos y reglas puras (`rules/`), sin dependencias de UI ni de base de datos. Pruebas con Vitest en `__tests__/`.
- `app/src/data/` — `comandos.ts` (todas las mutaciones como funciones puras `(db, sesión, args) → nuevo db`), `selectores.ts` (consultas), `seed.ts` (datos demo), `store.ts` (zustand con persistencia en `localStorage`). En fase 2 el store se sustituye por un adaptador Supabase; los comandos pasan a ejecutarse como funciones RPC en PostgreSQL (`supabase/migrations/0003_funciones.sql`) con la misma semántica.
- `supabase/` — migraciones SQL (esquema, RLS, funciones), seed y pruebas locales.
- `.github/workflows/deploy.yml` — compila la app y publica web + app en GitHub Pages.
</details>

<details>
<summary>Seguridad y RGPD</summary>

- Información clínica en tabla separada (`clientes_clinica`) con política RLS propia: solo trabajadores con el permiso `CLINICA_VER`.
- Cada cliente solo puede leer/escribir sus filas; las reglas de negocio se ejecutan en el servidor (`security definer`) para que no dependan del navegador.
- Datos alojados en la UE (región Fráncfort). Registro de auditoría de cambios manuales.
</details>
