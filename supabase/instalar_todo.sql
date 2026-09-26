-- INSTALACIÓN COMPLETA · Nuevo Palmar Pilates
-- Pega este archivo entero en Supabase → SQL Editor → New query → Run.
-- Contiene, en orden: esquema, seguridad (RLS), funciones de negocio y datos iniciales.


-- ====================================================================
-- migrations/0001_esquema.sql
-- ====================================================================
-- =============================================================================
-- 0001_esquema.sql · Esquema de la app de reservas de Pilates (Nuevo Palmar)
-- Supabase / PostgreSQL 15+. Todo en el schema `public`, nombres en español.
--
-- Convenciones:
--   · Claves primarias uuid generadas con gen_random_uuid().
--   · Fechas de calendario en `date`, horas en `time`, instantes en `timestamptz`.
--   · Todas las tablas llevan creado_el / actualizado_el (trigger automático).
--   · Las columnas *_por guardan el auth.users.id del actor; NULL = sistema.
-- =============================================================================

-- gen_random_uuid() es nativa en PostgreSQL 13+ (no hace falta pgcrypto).

-- -----------------------------------------------------------------------------
-- Tipos enumerados (espejo de app/src/domain/types.ts)
-- -----------------------------------------------------------------------------
create type public.categoria as enum ('DIRIGIDA', 'REFORMER');
create type public.tipo_tarifa as enum ('RECURRENTE', 'BONO', 'CLASE_SUELTA');
create type public.modalidad as enum ('FIJO', 'LIBRE');
create type public.estado_contrato as enum ('ACTIVO', 'FINALIZADO', 'CANCELADO');
create type public.estado_clase as enum ('PROGRAMADA', 'CANCELADA');
create type public.origen_reserva as enum ('AUTOMATICA', 'CLIENTE', 'MANUAL', 'RECUPERACION', 'BONO', 'CLASE_SUELTA');
create type public.estado_reserva as enum ('RESERVADA', 'CANCELADA_RECUPERABLE', 'CANCELADA_NO_RECUPERABLE', 'CANCELADA_CENTRO');
create type public.asistencia as enum ('PENDIENTE', 'ASISTE', 'NO_ASISTE');
create type public.estado_recuperacion as enum ('DISPONIBLE', 'USADA', 'CADUCADA');
create type public.motivo_recuperacion as enum ('CANCELACION_CLIENTE', 'CANCELACION_CENTRO', 'AUTORIZACION_MANUAL');
create type public.rol_trabajador as enum ('ADMIN', 'MONITOR', 'RECEPCION');
create type public.permiso as enum (
  'CLIENTES_EDITAR', 'CLIENTES_VER', 'CLINICA_VER', 'RESERVAS_GESTIONAR', 'HORARIOS_GESTIONAR',
  'CLASES_CREAR_CANCELAR', 'CLASES_SUELTAS', 'AVISOS_ENVIAR', 'TARIFAS_GESTIONAR', 'ESTADISTICAS_VER',
  'TRABAJADORES_GESTIONAR', 'ASISTENCIA_REGISTRAR'
);
create type public.tipo_destino_aviso as enum ('TODOS', 'CLASE', 'ACTIVIDAD', 'CLIENTES');
create type public.estado_pago as enum ('PENDIENTE', 'PAGADO', 'FALLIDO', 'REEMBOLSADO', 'CANCELADO');

-- -----------------------------------------------------------------------------
-- Trigger genérico: mantiene actualizado_el
-- -----------------------------------------------------------------------------
create or replace function public.trg_actualizado_el()
returns trigger language plpgsql as $$
begin
  new.actualizado_el := now();
  return new;
end $$;
comment on function public.trg_actualizado_el() is 'Pone actualizado_el = now() en cada update.';

-- -----------------------------------------------------------------------------
-- Configuración del centro (una sola fila)
-- -----------------------------------------------------------------------------
create table public.config_centro (
  id                              boolean primary key default true check (id), -- fuerza una única fila
  nombre                          text not null,
  minutos_antelacion_cancelacion  integer not null default 60 check (minutos_antelacion_cancelacion >= 0),
  dias_ventana_reserva            integer not null default 14 check (dias_ventana_reserva >= 0),
  recuperacion_caduca_con_contrato boolean not null default true,
  dias_caducidad_recuperacion     integer not null default 30 check (dias_caducidad_recuperacion >= 0),
  dias_generacion_clases          integer not null default 70 check (dias_generacion_clases between 1 and 365),
  zona_horaria                    text not null default 'Europe/Madrid',
  creado_el                       timestamptz not null default now(),
  actualizado_el                  timestamptz not null default now()
);
comment on table public.config_centro is 'Parámetros globales del centro. Solo existe una fila (id = true).';
comment on column public.config_centro.minutos_antelacion_cancelacion is 'Antelación mínima (min) para que una cancelación del cliente sea recuperable.';
comment on column public.config_centro.dias_ventana_reserva is 'Con cuántos días de antelación puede reservar un cliente de turno libre.';
comment on column public.config_centro.recuperacion_caduca_con_contrato is 'true: la recuperación caduca al fin del contrato; false: a los N días.';
comment on column public.config_centro.dias_generacion_clases is 'Horizonte (días) hasta el que el mantenimiento diario genera clases.';
create trigger config_centro_actualizado before update on public.config_centro
  for each row execute function public.trg_actualizado_el();

create table public.dias_cierre (
  fecha   date primary key,
  motivo  text not null default ''
);
comment on table public.dias_cierre is 'Festivos y cierres: no se generan clases ni reservas en esas fechas.';

-- -----------------------------------------------------------------------------
-- Catálogo: actividades y tarifas
-- -----------------------------------------------------------------------------
create table public.actividades (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  categoria     public.categoria not null,
  descripcion   text not null default '',
  color         text not null default '#548C2F',
  activa        boolean not null default true,
  orden         integer not null default 0,
  creado_el     timestamptz not null default now(),
  actualizado_el timestamptz not null default now()
);
comment on table public.actividades is 'Actividades que se imparten (Pilates suelo, Reformer…). La categoría define los derechos de tarifa.';
create trigger actividades_actualizado before update on public.actividades
  for each row execute function public.trg_actualizado_el();

create table public.tarifas (
  id                            uuid primary key default gen_random_uuid(),
  nombre                        text not null,
  descripcion                   text not null default '',
  tipo                          public.tipo_tarifa not null,
  -- Solo BONO
  bono_sesiones                 integer check (bono_sesiones is null or bono_sesiones > 0),
  bono_categoria                public.categoria,
  bono_validez_meses            integer check (bono_validez_meses is null or bono_validez_meses > 0),
  -- Reglas de recuperación
  recuperacion_permitida        boolean not null default true,
  recuperacion_categorias_extra public.categoria[] not null default '{}',
  recuperacion_max_pendientes   integer check (recuperacion_max_pendientes is null or recuperacion_max_pendientes >= 0),
  precio_centimos               integer check (precio_centimos is null or precio_centimos >= 0),
  activa                        boolean not null default true,
  orden                         integer not null default 0,
  creado_el                     timestamptz not null default now(),
  actualizado_el                timestamptz not null default now(),
  constraint tarifas_bono_completo check (
    tipo <> 'BONO' or (bono_sesiones is not null and bono_categoria is not null and bono_validez_meses is not null)
  )
);
comment on table public.tarifas is 'Tarifas contratables. Los cupos semanales de las RECURRENTE están en tarifa_cupos.';
comment on column public.tarifas.recuperacion_categorias_extra is 'Categorías en las que puede usarse una recuperación además de la de origen.';
comment on column public.tarifas.recuperacion_max_pendientes is 'Máximo de recuperaciones pendientes simultáneas (NULL = sin límite).';
comment on column public.tarifas.precio_centimos is 'Precio en céntimos de euro (preparado para pagos). NULL = consultar.';
create trigger tarifas_actualizado before update on public.tarifas
  for each row execute function public.trg_actualizado_el();

create table public.tarifa_cupos (
  tarifa_id        uuid not null references public.tarifas(id) on delete cascade,
  categoria        public.categoria not null,
  sesiones_semana  integer not null check (sesiones_semana > 0),
  primary key (tarifa_id, categoria)
);
comment on table public.tarifa_cupos is 'Cupo semanal por categoría de una tarifa RECURRENTE. Ej. Mixta = REFORMER 1 + DIRIGIDA 1.';

-- -----------------------------------------------------------------------------
-- Trabajadores y permisos
-- -----------------------------------------------------------------------------
create table public.trabajadores (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  apellidos   text not null default '',
  email       text not null default '',
  telefono    text not null default '',
  rol         public.rol_trabajador not null default 'RECEPCION',
  es_monitor  boolean not null default false,
  color       text not null default '#548C2F',
  activo      boolean not null default true,
  user_id     uuid unique references auth.users(id) on delete set null,
  creado_el   timestamptz not null default now(),
  actualizado_el timestamptz not null default now()
);
comment on table public.trabajadores is 'Personal del centro. user_id enlaza con la cuenta de acceso (Supabase Auth).';
comment on column public.trabajadores.es_monitor is 'Puede impartir clases (aparece como monitor en horarios).';
create trigger trabajadores_actualizado before update on public.trabajadores
  for each row execute function public.trg_actualizado_el();

create table public.trabajador_permisos (
  trabajador_id uuid not null references public.trabajadores(id) on delete cascade,
  permiso       public.permiso not null,
  primary key (trabajador_id, permiso)
);
comment on table public.trabajador_permisos is 'Permisos concedidos a cada trabajador. El rol ADMIN los tiene todos implícitamente.';

-- -----------------------------------------------------------------------------
-- Clientes (datos personales) e información clínica (tabla aparte, acceso restringido)
-- -----------------------------------------------------------------------------
create table public.clientes (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  apellidos           text not null default '',
  dni                 text not null default '',
  direccion           text not null default '',
  email               text not null default '',
  telefono            text not null default '',
  notificaciones_push boolean not null default true,
  activo              boolean not null default true,
  user_id             uuid unique references auth.users(id) on delete set null,
  alta_el             date not null default current_date,
  baja_el             date,
  creado_el           timestamptz not null default now(),
  actualizado_el      timestamptz not null default now()
);
comment on table public.clientes is 'Datos personales y de contacto de los clientes. La información clínica va en clientes_clinica.';
create unique index clientes_dni_unico on public.clientes (upper(dni)) where dni <> '';
create index clientes_apellidos_idx on public.clientes (apellidos, nombre);
create trigger clientes_actualizado before update on public.clientes
  for each row execute function public.trg_actualizado_el();

create table public.clientes_clinica (
  cliente_id      uuid primary key references public.clientes(id) on delete cascade,
  lesiones        text not null default '',
  patologias      text not null default '',
  observaciones   text not null default '',
  actualizada_por uuid references auth.users(id) on delete set null,
  creado_el       timestamptz not null default now(),
  actualizado_el  timestamptz not null default now()
);
comment on table public.clientes_clinica is 'Información clínica (datos de salud, categoría especial RGPD). Solo accesible con el permiso CLINICA_VER.';
create trigger clientes_clinica_actualizado before update on public.clientes_clinica
  for each row execute function public.trg_actualizado_el();

-- -----------------------------------------------------------------------------
-- Horario semanal (plantillas) y clases concretas
-- -----------------------------------------------------------------------------
create table public.plantillas_clase (
  id             uuid primary key default gen_random_uuid(),
  actividad_id   uuid not null references public.actividades(id) on delete restrict,
  dia_semana     smallint not null check (dia_semana between 1 and 7), -- 1 = lunes … 7 = domingo (ISO)
  hora_inicio    time not null,
  duracion_min   integer not null default 55 check (duracion_min > 0),
  monitor_id     uuid references public.trabajadores(id) on delete set null,
  plazas         integer not null check (plazas > 0),
  activa         boolean not null default true,
  vigencia_desde date,
  vigencia_hasta date,
  creado_el      timestamptz not null default now(),
  actualizado_el timestamptz not null default now(),
  constraint plantillas_vigencia_coherente check (vigencia_desde is null or vigencia_hasta is null or vigencia_desde <= vigencia_hasta)
);
comment on table public.plantillas_clase is 'Horario semanal: cada fila es una franja recurrente (día de la semana + hora) de la que se generan las clases.';
create index plantillas_clase_dia_idx on public.plantillas_clase (dia_semana, hora_inicio) where activa;
create trigger plantillas_clase_actualizado before update on public.plantillas_clase
  for each row execute function public.trg_actualizado_el();

create table public.clases (
  id                   uuid primary key default gen_random_uuid(),
  plantilla_id         uuid references public.plantillas_clase(id) on delete set null,
  actividad_id         uuid not null references public.actividades(id) on delete restrict,
  fecha                date not null,
  hora_inicio          time not null,
  duracion_min         integer not null default 55 check (duracion_min > 0),
  monitor_id           uuid references public.trabajadores(id) on delete set null,
  plazas               integer not null check (plazas > 0),
  estado               public.estado_clase not null default 'PROGRAMADA',
  extraordinaria       boolean not null default false,
  clase_alternativa_id uuid references public.clases(id) on delete set null,
  motivo_cancelacion   text,
  cancelado_el         timestamptz,
  cancelado_por        uuid,
  creado_el            timestamptz not null default now(),
  actualizado_el       timestamptz not null default now(),
  constraint clases_plantilla_fecha_unica unique (plantilla_id, fecha)
);
comment on table public.clases is 'Clases concretas del calendario (generadas del horario o extraordinarias).';
comment on column public.clases.clase_alternativa_id is 'Si el centro la cancela, clase que propone en su lugar.';
comment on column public.clases.cancelado_por is 'auth.users.id de quien la canceló; NULL = sistema (p. ej. día de cierre).';
create index clases_fecha_idx on public.clases (fecha, hora_inicio);
create index clases_actividad_fecha_idx on public.clases (actividad_id, fecha);
create index clases_monitor_fecha_idx on public.clases (monitor_id, fecha);
create trigger clases_actualizado before update on public.clases
  for each row execute function public.trg_actualizado_el();

-- -----------------------------------------------------------------------------
-- Contratos (tarifa contratada por un cliente) y sus franjas fijas
-- -----------------------------------------------------------------------------
create table public.contratos (
  id                         uuid primary key default gen_random_uuid(),
  cliente_id                 uuid not null references public.clientes(id) on delete cascade,
  tarifa_id                  uuid not null references public.tarifas(id) on delete restrict,
  fecha_inicio               date not null,
  fecha_fin                  date not null,
  modalidad                  public.modalidad not null default 'LIBRE',
  sesiones_restantes         integer check (sesiones_restantes is null or sesiones_restantes >= 0),
  estado                     public.estado_contrato not null default 'ACTIVO',
  actividades_permitidas_ids uuid[] not null default '{}',
  notas                      text not null default '',
  creado_por                 uuid,
  creado_el                  timestamptz not null default now(),
  actualizado_el             timestamptz not null default now(),
  constraint contratos_fechas_coherentes check (fecha_inicio <= fecha_fin)
);
comment on table public.contratos is 'Tarifa contratada por un cliente en un periodo. Un cliente solo tiene un contrato ACTIVO.';
comment on column public.contratos.sesiones_restantes is 'Solo BONO: sesiones que quedan.';
comment on column public.contratos.actividades_permitidas_ids is 'Actividades concretas permitidas (vacío = todas las de las categorías de la tarifa).';
create index contratos_cliente_idx on public.contratos (cliente_id, estado);
create index contratos_periodo_idx on public.contratos (fecha_inicio, fecha_fin) where estado = 'ACTIVO';
create trigger contratos_actualizado before update on public.contratos
  for each row execute function public.trg_actualizado_el();

create table public.contrato_franjas (
  contrato_id  uuid not null references public.contratos(id) on delete cascade,
  plantilla_id uuid not null references public.plantillas_clase(id) on delete cascade,
  primary key (contrato_id, plantilla_id)
);
comment on table public.contrato_franjas is 'Franjas semanales fijas de un contrato en modalidad FIJO (apuntan al horario semanal).';
create index contrato_franjas_plantilla_idx on public.contrato_franjas (plantilla_id);

-- -----------------------------------------------------------------------------
-- Reservas y recuperaciones (referencia circular: se añade la FK al final)
-- -----------------------------------------------------------------------------
create table public.reservas (
  id                    uuid primary key default gen_random_uuid(),
  clase_id              uuid not null references public.clases(id) on delete cascade,
  cliente_id            uuid not null references public.clientes(id) on delete cascade,
  contrato_id           uuid references public.contratos(id) on delete set null,
  origen                public.origen_reserva not null,
  estado                public.estado_reserva not null default 'RESERVADA',
  asistencia            public.asistencia not null default 'PENDIENTE',
  recuperacion_usada_id uuid,
  creado_por            uuid,
  creado_el             timestamptz not null default now(),
  cancelado_el          timestamptz,
  cancelado_por         uuid,
  actualizado_el        timestamptz not null default now()
);
comment on table public.reservas is 'Plaza de un cliente en una clase. Las cancelaciones se guardan cambiando el estado (no se borran).';
comment on column public.reservas.recuperacion_usada_id is 'Recuperación consumida para hacer esta reserva (origen RECUPERACION).';
comment on column public.reservas.creado_por is 'auth.users.id del cliente o trabajador; NULL = sistema (reserva automática).';
create index reservas_clase_idx on public.reservas (clase_id, estado);
create index reservas_cliente_idx on public.reservas (cliente_id, estado);
create index reservas_contrato_idx on public.reservas (contrato_id) where contrato_id is not null;
create unique index reservas_una_activa_por_cliente_clase on public.reservas (clase_id, cliente_id) where estado = 'RESERVADA';
create trigger reservas_actualizado before update on public.reservas
  for each row execute function public.trg_actualizado_el();

create table public.recuperaciones (
  id                    uuid primary key default gen_random_uuid(),
  cliente_id            uuid not null references public.clientes(id) on delete cascade,
  contrato_id           uuid references public.contratos(id) on delete set null,
  reserva_origen_id     uuid references public.reservas(id) on delete set null,
  categoria_origen      public.categoria not null,
  categorias_permitidas public.categoria[] not null,
  motivo                public.motivo_recuperacion not null,
  estado                public.estado_recuperacion not null default 'DISPONIBLE',
  caduca_el             date not null,
  usada_en_reserva_id   uuid references public.reservas(id) on delete set null,
  nota                  text not null default '',
  creado_por            uuid,
  creado_el             timestamptz not null default now(),
  actualizado_el        timestamptz not null default now()
);
comment on table public.recuperaciones is 'Clases pendientes de recuperar por el cliente (cancelación con antelación, cancelación del centro o autorización manual).';
comment on column public.recuperaciones.categorias_permitidas is 'Categorías en las que puede utilizarse (incluye la de origen; ampliable por excepción).';
create index recuperaciones_cliente_idx on public.recuperaciones (cliente_id, estado, caduca_el);
create trigger recuperaciones_actualizado before update on public.recuperaciones
  for each row execute function public.trg_actualizado_el();

alter table public.reservas
  add constraint reservas_recuperacion_usada_fk
  foreign key (recuperacion_usada_id) references public.recuperaciones(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Avisos
-- -----------------------------------------------------------------------------
create table public.avisos (
  id                   uuid primary key default gen_random_uuid(),
  titulo               text not null,
  cuerpo               text not null default '',
  destino_tipo         public.tipo_destino_aviso not null,
  destino_clase_id     uuid references public.clases(id) on delete set null,
  destino_actividad_id uuid references public.actividades(id) on delete set null,
  importante           boolean not null default false,
  publicado_el         timestamptz not null default now(),
  publicado_por        uuid,
  creado_el            timestamptz not null default now(),
  actualizado_el       timestamptz not null default now()
);
comment on table public.avisos is 'Avisos del centro a los clientes. Los destinatarios concretos se resuelven al publicar (aviso_destinatarios).';
create index avisos_publicado_idx on public.avisos (publicado_el desc);
create trigger avisos_actualizado before update on public.avisos
  for each row execute function public.trg_actualizado_el();

create table public.aviso_destinatarios (
  aviso_id   uuid not null references public.avisos(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  primary key (aviso_id, cliente_id)
);
comment on table public.aviso_destinatarios is 'Clientes a los que va dirigido cada aviso.';
create index aviso_destinatarios_cliente_idx on public.aviso_destinatarios (cliente_id);

create table public.aviso_lecturas (
  aviso_id   uuid not null references public.avisos(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  leido_el   timestamptz not null default now(),
  primary key (aviso_id, cliente_id)
);
comment on table public.aviso_lecturas is 'Marca de lectura de un aviso por un cliente.';

-- -----------------------------------------------------------------------------
-- Auditoría
-- -----------------------------------------------------------------------------
create table public.auditoria (
  id           uuid primary key default gen_random_uuid(),
  instante     timestamptz not null default now(),
  actor_id     uuid,
  actor_nombre text not null default 'Sistema',
  accion       text not null,
  entidad      text not null,
  entidad_id   text not null default '-',
  detalle      text not null default ''
);
comment on table public.auditoria is 'Registro de acciones relevantes (quién hizo qué y cuándo). Solo lo lee el administrador.';
create index auditoria_instante_idx on public.auditoria (instante desc);
create index auditoria_entidad_idx on public.auditoria (entidad, entidad_id);

-- -----------------------------------------------------------------------------
-- Notificaciones Web Push y pagos (preparado para Stripe)
-- -----------------------------------------------------------------------------
create table public.suscripciones_push (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  endpoint       text not null unique,
  clave_p256dh   text not null,
  clave_auth     text not null,
  user_agent     text not null default '',
  creado_el      timestamptz not null default now(),
  actualizado_el timestamptz not null default now()
);
comment on table public.suscripciones_push is 'Suscripciones Web Push (PushSubscription) de cada cliente; un cliente puede tener varias (varios dispositivos).';
create index suscripciones_push_cliente_idx on public.suscripciones_push (cliente_id);
create trigger suscripciones_push_actualizado before update on public.suscripciones_push
  for each row execute function public.trg_actualizado_el();

create table public.pagos (
  id                  uuid primary key default gen_random_uuid(),
  contrato_id         uuid references public.contratos(id) on delete set null,
  cliente_id          uuid not null references public.clientes(id) on delete cascade,
  importe_centimos    integer not null check (importe_centimos >= 0),
  moneda              text not null default 'EUR',
  estado              public.estado_pago not null default 'PENDIENTE',
  proveedor           text not null default 'STRIPE', -- STRIPE, EFECTIVO, TARJETA, TRANSFERENCIA, BIZUM…
  referencia_externa  text,                          -- p. ej. Stripe payment_intent / checkout session
  metadatos           jsonb not null default '{}',
  pagado_el           timestamptz,
  creado_el           timestamptz not null default now(),
  actualizado_el      timestamptz not null default now()
);
comment on table public.pagos is 'Pagos de contratos. Preparada para Stripe (referencia_externa = id del proveedor). Sin lógica todavía.';
create index pagos_contrato_idx on public.pagos (contrato_id);
create index pagos_cliente_idx on public.pagos (cliente_id, estado);
create unique index pagos_referencia_externa_unica on public.pagos (proveedor, referencia_externa) where referencia_externa is not null;
create trigger pagos_actualizado before update on public.pagos
  for each row execute function public.trg_actualizado_el();

-- -----------------------------------------------------------------------------
-- Aforo: una clase no puede tener más reservas RESERVADA que plazas.
-- Se bloquea la fila de la clase (FOR UPDATE) para serializar reservas concurrentes.
-- security definer: el bloqueo necesita privilegio de update sobre clases aunque
-- quien inserte la reserva sea un trabajador sin ese permiso.
-- -----------------------------------------------------------------------------
create or replace function public.trg_reservas_aforo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plazas   integer;
  v_ocupadas integer;
begin
  if new.estado <> 'RESERVADA' then
    return new;
  end if;
  -- Si ya estaba RESERVADA en la misma clase, no cambia la ocupación.
  if tg_op = 'UPDATE' and old.estado = 'RESERVADA' and old.clase_id = new.clase_id then
    return new;
  end if;
  select plazas into v_plazas from public.clases where id = new.clase_id for update;
  if not found then
    raise exception 'La clase no existe.';
  end if;
  select count(*) into v_ocupadas
    from public.reservas
   where clase_id = new.clase_id and estado = 'RESERVADA' and id <> new.id;
  if v_ocupadas >= v_plazas then
    raise exception 'No quedan plazas libres.' using errcode = 'check_violation', detail = 'SIN_PLAZAS';
  end if;
  return new;
end $$;
comment on function public.trg_reservas_aforo() is 'Impide superar las plazas de una clase (bloquea la clase para evitar carreras).';

create trigger reservas_aforo before insert or update of estado, clase_id on public.reservas
  for each row execute function public.trg_reservas_aforo();

-- -----------------------------------------------------------------------------
-- Vista pública de monitores (sin email ni teléfono) para que los clientes
-- vean quién imparte cada clase. Se crea con privilegios del propietario.
-- -----------------------------------------------------------------------------
create view public.monitores with (security_invoker = false) as
  select id, nombre, apellidos, color, es_monitor, activo
    from public.trabajadores;
comment on view public.monitores is 'Nombre y color de los trabajadores, sin datos de contacto. Legible por cualquier usuario autenticado.';

-- ====================================================================
-- migrations/0002_seguridad.sql
-- ====================================================================
-- =============================================================================
-- 0002_seguridad.sql · Funciones auxiliares de identidad y Row Level Security
--
-- Principios:
--   · Todas las tablas tienen RLS activado. Sin política no se ve nada.
--   · Los clientes solo acceden a lo suyo. Los trabajadores según permisos.
--   · La información clínica (clientes_clinica) solo con CLINICA_VER.
--   · Las mutaciones con reglas de negocio se hacen por RPC (0003), no por
--     insert/update directo del cliente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funciones de identidad (security definer para no depender de las políticas
-- de clientes/trabajadores y evitar recursión en RLS).
-- -----------------------------------------------------------------------------
create or replace function public.auth_cliente_id()
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clientes c where c.user_id = auth.uid() and c.activo limit 1
$$;
comment on function public.auth_cliente_id() is 'Cliente vinculado al usuario autenticado (NULL si no es cliente activo).';

create or replace function public.auth_trabajador_id()
returns uuid language sql stable security definer set search_path = public as $$
  select t.id from public.trabajadores t where t.user_id = auth.uid() and t.activo limit 1
$$;
comment on function public.auth_trabajador_id() is 'Trabajador vinculado al usuario autenticado (NULL si no es trabajador activo).';

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trabajadores t
     where t.user_id = auth.uid() and t.activo and t.rol = 'ADMIN'
  )
$$;
comment on function public.es_admin() is 'true si el usuario actual es un trabajador activo con rol ADMIN.';

create or replace function public.tiene_permiso(p_permiso public.permiso)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.trabajadores t
     where t.user_id = auth.uid()
       and t.activo
       and (
         t.rol = 'ADMIN'
         or exists (select 1 from public.trabajador_permisos p where p.trabajador_id = t.id and p.permiso = p_permiso)
       )
  )
$$;
comment on function public.tiene_permiso(public.permiso) is 'true si el usuario es ADMIN o tiene el permiso; false si no es trabajador.';

-- -----------------------------------------------------------------------------
-- Privilegios base: anon no toca nada; authenticated pasa por RLS.
-- (Supabase concede por defecto privilegios a anon: los retiramos explícitamente.)
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated, anon;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.monitores to authenticated;

revoke all on function public.auth_cliente_id() from public, anon;
revoke all on function public.auth_trabajador_id() from public, anon;
revoke all on function public.es_admin() from public, anon;
revoke all on function public.tiene_permiso(public.permiso) from public, anon;
grant execute on function public.auth_cliente_id() to authenticated;
grant execute on function public.auth_trabajador_id() to authenticated;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.tiene_permiso(public.permiso) to authenticated;

-- -----------------------------------------------------------------------------
-- Un cliente solo puede cambiar sus datos de contacto y notificaciones_push.
-- (Las políticas RLS no restringen columnas; lo hace este trigger.)
-- -----------------------------------------------------------------------------
create or replace function public.trg_clientes_autoedicion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.tiene_permiso('CLIENTES_EDITAR') then
    return new;
  end if;
  -- Cliente editando su propia ficha: solo contacto y preferencias.
  if new.nombre is distinct from old.nombre
     or new.apellidos is distinct from old.apellidos
     or new.dni is distinct from old.dni
     or new.activo is distinct from old.activo
     or new.user_id is distinct from old.user_id
     or new.alta_el is distinct from old.alta_el
     or new.baja_el is distinct from old.baja_el then
    raise exception 'Solo puedes modificar tus datos de contacto y notificaciones.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger clientes_autoedicion before update on public.clientes
  for each row execute function public.trg_clientes_autoedicion();

-- -----------------------------------------------------------------------------
-- Activar RLS en todas las tablas
-- -----------------------------------------------------------------------------
alter table public.config_centro       enable row level security;
alter table public.dias_cierre         enable row level security;
alter table public.actividades         enable row level security;
alter table public.tarifas             enable row level security;
alter table public.tarifa_cupos        enable row level security;
alter table public.trabajadores        enable row level security;
alter table public.trabajador_permisos enable row level security;
alter table public.clientes            enable row level security;
alter table public.clientes_clinica    enable row level security;
alter table public.plantillas_clase    enable row level security;
alter table public.clases              enable row level security;
alter table public.contratos           enable row level security;
alter table public.contrato_franjas    enable row level security;
alter table public.reservas            enable row level security;
alter table public.recuperaciones      enable row level security;
alter table public.avisos              enable row level security;
alter table public.aviso_destinatarios enable row level security;
alter table public.aviso_lecturas      enable row level security;
alter table public.auditoria           enable row level security;
alter table public.suscripciones_push  enable row level security;
alter table public.pagos               enable row level security;

-- -----------------------------------------------------------------------------
-- Configuración y días de cierre: lectura para todos, escritura solo ADMIN
-- -----------------------------------------------------------------------------
create policy config_leer on public.config_centro for select to authenticated using (true);
create policy config_escribir on public.config_centro for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

create policy cierres_leer on public.dias_cierre for select to authenticated using (true);
create policy cierres_escribir on public.dias_cierre for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- -----------------------------------------------------------------------------
-- Actividades y tarifas: lectura para todos (tarifas: solo activas para clientes),
-- escritura con TARIFAS_GESTIONAR
-- -----------------------------------------------------------------------------
create policy actividades_leer on public.actividades for select to authenticated using (true);
create policy actividades_escribir on public.actividades for all to authenticated
  using (public.tiene_permiso('TARIFAS_GESTIONAR')) with check (public.tiene_permiso('TARIFAS_GESTIONAR'));

create policy tarifas_leer on public.tarifas for select to authenticated
  using (activa or public.auth_trabajador_id() is not null);
create policy tarifas_escribir on public.tarifas for all to authenticated
  using (public.tiene_permiso('TARIFAS_GESTIONAR')) with check (public.tiene_permiso('TARIFAS_GESTIONAR'));

create policy tarifa_cupos_leer on public.tarifa_cupos for select to authenticated
  using (exists (select 1 from public.tarifas t where t.id = tarifa_id and (t.activa or public.auth_trabajador_id() is not null)));
create policy tarifa_cupos_escribir on public.tarifa_cupos for all to authenticated
  using (public.tiene_permiso('TARIFAS_GESTIONAR')) with check (public.tiene_permiso('TARIFAS_GESTIONAR'));

-- -----------------------------------------------------------------------------
-- Trabajadores y permisos: cada trabajador ve su ficha y las de sus compañeros;
-- gestión con TRABAJADORES_GESTIONAR. Los clientes usan la vista `monitores`.
-- -----------------------------------------------------------------------------
create policy trabajadores_leer on public.trabajadores for select to authenticated
  using (public.auth_trabajador_id() is not null);
create policy trabajadores_escribir on public.trabajadores for all to authenticated
  using (public.tiene_permiso('TRABAJADORES_GESTIONAR')) with check (public.tiene_permiso('TRABAJADORES_GESTIONAR'));

create policy permisos_leer on public.trabajador_permisos for select to authenticated
  using (trabajador_id = public.auth_trabajador_id() or public.tiene_permiso('TRABAJADORES_GESTIONAR'));
create policy permisos_escribir on public.trabajador_permisos for all to authenticated
  using (public.tiene_permiso('TRABAJADORES_GESTIONAR')) with check (public.tiene_permiso('TRABAJADORES_GESTIONAR'));

-- -----------------------------------------------------------------------------
-- Clientes: su propia fila (lectura y edición limitada por trigger);
-- trabajadores con CLIENTES_VER leen, con CLIENTES_EDITAR escriben.
-- -----------------------------------------------------------------------------
create policy clientes_leer on public.clientes for select to authenticated
  using (id = public.auth_cliente_id() or public.tiene_permiso('CLIENTES_VER'));
create policy clientes_autoeditar on public.clientes for update to authenticated
  using (id = public.auth_cliente_id()) with check (id = public.auth_cliente_id());
create policy clientes_editar on public.clientes for all to authenticated
  using (public.tiene_permiso('CLIENTES_EDITAR')) with check (public.tiene_permiso('CLIENTES_EDITAR'));

-- Información clínica: SOLO con CLINICA_VER (ni siquiera el propio cliente desde la app).
create policy clinica_acceso on public.clientes_clinica for all to authenticated
  using (public.tiene_permiso('CLINICA_VER')) with check (public.tiene_permiso('CLINICA_VER'));

-- -----------------------------------------------------------------------------
-- Horario y clases: lectura para todos; horario con HORARIOS_GESTIONAR,
-- clases con CLASES_CREAR_CANCELAR (la cancelación con reglas va por RPC).
-- -----------------------------------------------------------------------------
create policy plantillas_leer on public.plantillas_clase for select to authenticated using (true);
create policy plantillas_escribir on public.plantillas_clase for all to authenticated
  using (public.tiene_permiso('HORARIOS_GESTIONAR')) with check (public.tiene_permiso('HORARIOS_GESTIONAR'));

create policy clases_leer on public.clases for select to authenticated using (true);
create policy clases_escribir on public.clases for all to authenticated
  using (public.tiene_permiso('CLASES_CREAR_CANCELAR')) with check (public.tiene_permiso('CLASES_CREAR_CANCELAR'));

-- -----------------------------------------------------------------------------
-- Contratos: el cliente ve los suyos; CLIENTES_VER lee, CLIENTES_EDITAR escribe.
-- -----------------------------------------------------------------------------
create policy contratos_leer on public.contratos for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.tiene_permiso('CLIENTES_VER'));
create policy contratos_escribir on public.contratos for all to authenticated
  using (public.tiene_permiso('CLIENTES_EDITAR')) with check (public.tiene_permiso('CLIENTES_EDITAR'));

create policy franjas_leer on public.contrato_franjas for select to authenticated
  using (
    public.tiene_permiso('CLIENTES_VER')
    or exists (select 1 from public.contratos c where c.id = contrato_id and c.cliente_id = public.auth_cliente_id())
  );
create policy franjas_escribir on public.contrato_franjas for all to authenticated
  using (public.tiene_permiso('CLIENTES_EDITAR')) with check (public.tiene_permiso('CLIENTES_EDITAR'));

-- -----------------------------------------------------------------------------
-- Reservas y recuperaciones: el cliente ve las suyas; cualquier trabajador las lee
-- (listas de clase); gestión directa solo con RESERVAS_GESTIONAR.
-- Los clientes reservan/cancelan únicamente mediante las RPC de 0003.
-- -----------------------------------------------------------------------------
create policy reservas_leer on public.reservas for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.auth_trabajador_id() is not null);
create policy reservas_gestionar on public.reservas for all to authenticated
  using (public.tiene_permiso('RESERVAS_GESTIONAR')) with check (public.tiene_permiso('RESERVAS_GESTIONAR'));

create policy recuperaciones_leer on public.recuperaciones for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.auth_trabajador_id() is not null);
create policy recuperaciones_gestionar on public.recuperaciones for all to authenticated
  using (public.tiene_permiso('RESERVAS_GESTIONAR')) with check (public.tiene_permiso('RESERVAS_GESTIONAR'));

-- -----------------------------------------------------------------------------
-- Avisos: el cliente ve aquellos de los que es destinatario y marca sus lecturas;
-- cualquier trabajador los lee; publicación con AVISOS_ENVIAR.
-- -----------------------------------------------------------------------------
create policy avisos_leer on public.avisos for select to authenticated
  using (
    public.auth_trabajador_id() is not null
    or exists (select 1 from public.aviso_destinatarios d where d.aviso_id = avisos.id and d.cliente_id = public.auth_cliente_id())
  );
create policy avisos_escribir on public.avisos for all to authenticated
  using (public.tiene_permiso('AVISOS_ENVIAR')) with check (public.tiene_permiso('AVISOS_ENVIAR'));

create policy destinatarios_leer on public.aviso_destinatarios for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.auth_trabajador_id() is not null);
create policy destinatarios_escribir on public.aviso_destinatarios for all to authenticated
  using (public.tiene_permiso('AVISOS_ENVIAR')) with check (public.tiene_permiso('AVISOS_ENVIAR'));

create policy lecturas_leer on public.aviso_lecturas for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.auth_trabajador_id() is not null);
create policy lecturas_marcar on public.aviso_lecturas for insert to authenticated
  with check (
    aviso_lecturas.cliente_id = public.auth_cliente_id()
    and exists (select 1 from public.aviso_destinatarios d
                 where d.aviso_id = aviso_lecturas.aviso_id and d.cliente_id = aviso_lecturas.cliente_id)
  );

-- -----------------------------------------------------------------------------
-- Auditoría: solo lectura y solo ADMIN (escriben las funciones security definer).
-- -----------------------------------------------------------------------------
create policy auditoria_leer on public.auditoria for select to authenticated using (public.es_admin());

-- -----------------------------------------------------------------------------
-- Suscripciones push: cada cliente gestiona las suyas. Los envíos los hace una
-- Edge Function con la service role key (que no pasa por RLS).
-- -----------------------------------------------------------------------------
create policy push_propias on public.suscripciones_push for all to authenticated
  using (cliente_id = public.auth_cliente_id()) with check (cliente_id = public.auth_cliente_id());
create policy push_leer_personal on public.suscripciones_push for select to authenticated
  using (public.tiene_permiso('AVISOS_ENVIAR'));

-- -----------------------------------------------------------------------------
-- Pagos: el cliente ve los suyos, CLIENTES_VER los lee; escritura solo ADMIN
-- (el webhook de Stripe escribirá con la service role key).
-- -----------------------------------------------------------------------------
create policy pagos_leer on public.pagos for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.tiene_permiso('CLIENTES_VER'));
create policy pagos_escribir on public.pagos for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ====================================================================
-- migrations/0003_funciones.sql
-- ====================================================================
-- =============================================================================
-- 0003_funciones.sql · Reglas de negocio como funciones RPC (security definer)
--
-- Traducción fiel de app/src/domain/rules/*.ts y app/src/data/comandos.ts.
-- Las funciones con prefijo `_` son internas (sin permiso de ejecución para
-- los usuarios); las públicas comprueban la identidad con auth.uid().
-- Todas las mutaciones registran en `auditoria`.
-- Los errores se lanzan con `raise exception` y un mensaje pensado para
-- mostrarse tal cual al usuario (PostgREST lo devuelve en `message`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Utilidades de fecha/hora en la zona horaria del centro
-- -----------------------------------------------------------------------------
create or replace function public._ahora_local()
returns timestamp language sql stable security definer set search_path = public as $$
  select now() at time zone coalesce((select zona_horaria from public.config_centro limit 1), 'Europe/Madrid')
$$;
comment on function public._ahora_local() is 'Instante actual como hora local del centro (sin zona).';

create or replace function public._hoy()
returns date language sql stable security definer set search_path = public as $$
  select public._ahora_local()::date
$$;

create or replace function public._minutos_hasta(p_fecha date, p_hora time)
returns integer language sql stable security definer set search_path = public as $$
  select trunc(extract(epoch from ((p_fecha + p_hora) - public._ahora_local())) / 60)::integer
$$;
comment on function public._minutos_hasta(date, time) is 'Minutos que faltan hasta el inicio de una clase (negativo si ya empezó).';

create or replace function public._inicio_semana(p_fecha date)
returns date language sql immutable as $$
  select date_trunc('week', p_fecha::timestamp)::date  -- semana ISO: empieza en lunes
$$;

-- -----------------------------------------------------------------------------
-- Auditoría
-- -----------------------------------------------------------------------------
create or replace function public._actor_nombre()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.nombre || ' ' || t.apellidos from public.trabajadores t where t.user_id = auth.uid()),
    (select c.nombre || ' ' || c.apellidos from public.clientes c where c.user_id = auth.uid()),
    case when auth.uid() is null then 'Sistema' else auth.uid()::text end
  )
$$;

create or replace function public._auditar(p_accion text, p_entidad text, p_entidad_id text, p_detalle text)
returns void language sql security definer set search_path = public as $$
  insert into public.auditoria (actor_id, actor_nombre, accion, entidad, entidad_id, detalle)
  values (auth.uid(), public._actor_nombre(), p_accion, p_entidad, coalesce(p_entidad_id, '-'), coalesce(p_detalle, ''))
$$;

create or replace function public._nombre_cliente(p_cliente_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select c.nombre || ' ' || c.apellidos from public.clientes c where c.id = p_cliente_id), p_cliente_id::text)
$$;

create or replace function public._desc_clase(p_clase_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(a.nombre, 'Clase') || ' ' || c.fecha || ' ' || to_char(c.hora_inicio, 'HH24:MI')
    from public.clases c left join public.actividades a on a.id = c.actividad_id
   where c.id = p_clase_id
$$;

create or replace function public._exigir(p_permiso public.permiso)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tiene_permiso(p_permiso) then
    raise exception 'No tienes permiso para: %', p_permiso using errcode = 'insufficient_privilege';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Reglas auxiliares (rules/recuperaciones.ts, rules/reservas.ts)
-- -----------------------------------------------------------------------------
create or replace function public._contrato_activo(p_cliente_id uuid, p_fecha date)
returns public.contratos language sql stable security definer set search_path = public as $$
  -- Preferimos el contrato activo que cubre la fecha; si no hay, cualquier activo.
  select c.* from public.contratos c
   where c.cliente_id = p_cliente_id and c.estado = 'ACTIVO'
   order by (c.fecha_inicio <= p_fecha and c.fecha_fin >= p_fecha) desc, c.creado_el desc
   limit 1
$$;

create or replace function public._categorias_permitidas_recuperacion(p_origen public.categoria, p_tarifa_id uuid)
returns public.categoria[] language sql stable security definer set search_path = public as $$
  select array_agg(distinct x order by x)
    from unnest(array[p_origen] || coalesce((select t.recuperacion_categorias_extra from public.tarifas t where t.id = p_tarifa_id), '{}')) x
$$;

create or replace function public._caducidad_recuperacion(p_contrato_fecha_fin date, p_fecha_origen date)
returns date language sql stable security definer set search_path = public as $$
  select case
    when cfg.recuperacion_caduca_con_contrato and p_contrato_fecha_fin is not null then p_contrato_fecha_fin
    else p_fecha_origen + cfg.dias_caducidad_recuperacion
  end
  from public.config_centro cfg limit 1
$$;

create or replace function public._puede_generar_recuperacion(p_tarifa_id uuid, p_pendientes integer)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_tarifa_id is null then true  -- sin tarifa: siempre se compensa
    else coalesce((
      select t.recuperacion_permitida and (t.recuperacion_max_pendientes is null or p_pendientes < t.recuperacion_max_pendientes)
        from public.tarifas t where t.id = p_tarifa_id), true)
  end
$$;

create or replace function public._consume_cupo(p_estado public.estado_reserva, p_origen public.origen_reserva)
returns boolean language sql immutable as $$
  -- Las recuperaciones no cuentan contra el cupo; una cancelación no recuperable sí.
  select p_origen <> 'RECUPERACION' and p_estado in ('RESERVADA', 'CANCELADA_NO_RECUPERABLE')
$$;

create or replace function public._cupo_consumido_en_semana(p_contrato_id uuid, p_categoria public.categoria, p_fecha date)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.reservas r
    join public.clases c on c.id = r.clase_id
    join public.actividades a on a.id = c.actividad_id
   where r.contrato_id = p_contrato_id
     and public._consume_cupo(r.estado, r.origen)
     and public._inicio_semana(c.fecha) = public._inicio_semana(p_fecha)
     and a.categoria = p_categoria
$$;

create or replace function public._bloqueo(p_codigo text, p_motivo text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', false, 'codigo', p_codigo, 'motivo', p_motivo)
$$;

-- -----------------------------------------------------------------------------
-- Regla central: ¿puede el cliente reservar esta clase y por qué vía?
-- Devuelve {ok, via: CUPO_SEMANAL|BONO|RECUPERACION, recuperacion_id, mensaje} o {ok:false, codigo, motivo}
-- -----------------------------------------------------------------------------
create or replace function public._evaluar_reserva(p_clase_id uuid, p_cliente_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg      public.config_centro%rowtype;
  v_clase    public.clases%rowtype;
  v_act      public.actividades%rowtype;
  v_contrato public.contratos%rowtype;
  v_tarifa   public.tarifas%rowtype;
  v_rec      jsonb;      -- resultado listo si hay recuperación aplicable
  v_ocupadas integer;
  v_cupo     integer;
  v_usadas   integer;
  v_cat_label text;
begin
  select * into v_cfg from public.config_centro limit 1;
  select * into v_clase from public.clases where id = p_clase_id;
  if not found then return public._bloqueo('CLASE_NO_EXISTE', 'La clase no existe.'); end if;
  select * into v_act from public.actividades where id = v_clase.actividad_id;
  v_cat_label := case v_act.categoria when 'REFORMER' then 'Reformer' else 'Actividades dirigidas' end;

  if v_clase.estado = 'CANCELADA' then return public._bloqueo('CLASE_CANCELADA', 'Esta clase ha sido cancelada por el centro.'); end if;
  if (v_clase.fecha + v_clase.hora_inicio) < public._ahora_local() then
    return public._bloqueo('CLASE_PASADA', 'Esta clase ya ha pasado.');
  end if;
  if exists (select 1 from public.reservas where clase_id = p_clase_id and cliente_id = p_cliente_id and estado = 'RESERVADA') then
    return public._bloqueo('YA_RESERVADA', 'Ya tienes plaza en esta clase.');
  end if;
  select count(*) into v_ocupadas from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA';
  if v_clase.plazas - v_ocupadas <= 0 then return public._bloqueo('SIN_PLAZAS', 'No quedan plazas libres.'); end if;
  if v_clase.fecha > public._hoy() + v_cfg.dias_ventana_reserva then
    return public._bloqueo('FUERA_VENTANA', format('Solo se puede reservar con %s días de antelación.', v_cfg.dias_ventana_reserva));
  end if;

  -- 1) Recuperación disponible que cubra esta categoría (la que antes caduque).
  select jsonb_build_object('ok', true, 'via', 'RECUPERACION', 'recuperacion_id', r.id, 'mensaje', 'Se utilizará una recuperación.')
    into v_rec
    from public.recuperaciones r
   where r.cliente_id = p_cliente_id and r.estado = 'DISPONIBLE' and r.caduca_el >= v_clase.fecha
     and v_act.categoria = any (r.categorias_permitidas)
   order by r.caduca_el, r.creado_el
   limit 1;

  -- 2) Derechos de la tarifa.
  v_contrato := public._contrato_activo(p_cliente_id, v_clase.fecha);
  if v_contrato.id is not null then
    select * into v_tarifa from public.tarifas where id = v_contrato.tarifa_id;
  end if;

  if v_contrato.id is null or v_tarifa.id is null then
    return coalesce(v_rec, public._bloqueo('SIN_CONTRATO', 'No tienes una tarifa activa. Consulta en recepción.'));
  end if;
  if v_clase.fecha < v_contrato.fecha_inicio or v_clase.fecha > v_contrato.fecha_fin then
    return coalesce(v_rec, public._bloqueo('FUERA_PERIODO', 'La clase está fuera del periodo de tu tarifa.'));
  end if;
  if cardinality(v_contrato.actividades_permitidas_ids) > 0 and not (v_act.id = any (v_contrato.actividades_permitidas_ids)) then
    return coalesce(v_rec, public._bloqueo('ACTIVIDAD_NO_PERMITIDA', format('Tu tarifa no incluye %s.', v_act.nombre)));
  end if;

  if v_tarifa.tipo = 'BONO' then
    if v_tarifa.bono_categoria <> v_act.categoria then
      return coalesce(v_rec, public._bloqueo('ACTIVIDAD_NO_PERMITIDA',
        format('Tu bono es de %s.', case v_tarifa.bono_categoria when 'REFORMER' then 'Reformer' else 'Actividades dirigidas' end)));
    end if;
    if coalesce(v_contrato.sesiones_restantes, 0) > 0 then
      return jsonb_build_object('ok', true, 'via', 'BONO',
        'mensaje', format('Se descontará 1 sesión de tu bono (te quedarán %s).', coalesce(v_contrato.sesiones_restantes, 1) - 1));
    end if;
    return coalesce(v_rec, public._bloqueo('BONO_AGOTADO', 'Tu bono no tiene sesiones disponibles.'));
  end if;

  if v_tarifa.tipo = 'RECURRENTE' then
    select tc.sesiones_semana into v_cupo from public.tarifa_cupos tc where tc.tarifa_id = v_tarifa.id and tc.categoria = v_act.categoria;
    if v_cupo is null then
      return coalesce(v_rec, public._bloqueo('ACTIVIDAD_NO_PERMITIDA', format('Tu tarifa no incluye %s.', lower(v_cat_label))));
    end if;
    if v_contrato.modalidad = 'FIJO' then
      -- Con horario fijo las reservas se generan solas; fuera de él solo con recuperación.
      if v_clase.plantilla_id is not null
         and exists (select 1 from public.contrato_franjas f where f.contrato_id = v_contrato.id and f.plantilla_id = v_clase.plantilla_id) then
        return jsonb_build_object('ok', true, 'via', 'CUPO_SEMANAL', 'mensaje', 'Es tu clase habitual.');
      end if;
      return coalesce(v_rec, public._bloqueo('HORARIO_FIJO', 'Tienes horario fijo. Para asistir a otra clase necesitas una recuperación disponible.'));
    end if;
    v_usadas := public._cupo_consumido_en_semana(v_contrato.id, v_act.categoria, v_clase.fecha);
    if v_usadas < v_cupo then
      return jsonb_build_object('ok', true, 'via', 'CUPO_SEMANAL', 'mensaje', format('Clase %s de %s de esta semana.', v_usadas + 1, v_cupo));
    end if;
    if v_rec is not null then
      return v_rec || jsonb_build_object('mensaje', 'Semana completa: se utilizará una recuperación.');
    end if;
    return public._bloqueo('CUPO_AGOTADO', format('Ya tienes las %s clases de esta semana.', v_cupo));
  end if;

  -- CLASE_SUELTA: solo la introduce el personal.
  return coalesce(v_rec, public._bloqueo('SIN_CONTRATO', 'Las clases sueltas se reservan en recepción.'));
end $$;
comment on function public._evaluar_reserva(uuid, uuid) is 'Regla 18: decide si un cliente puede reservar una clase y por qué vía (cupo, bono o recuperación).';

-- Versión pública (solo lectura) para que la app muestre el motivo antes de reservar.
create or replace function public.evaluar_reserva(p_clase_id uuid, p_cliente_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cliente_id uuid;
begin
  v_cliente_id := public.auth_cliente_id();
  if v_cliente_id is null then
    if public.auth_trabajador_id() is null then raise exception 'No autenticado.' using errcode = 'insufficient_privilege'; end if;
    if p_cliente_id is null then raise exception 'Falta el cliente.'; end if;
    v_cliente_id := p_cliente_id;
  end if;
  return public._evaluar_reserva(p_clase_id, v_cliente_id);
end $$;

-- -----------------------------------------------------------------------------
-- reservar: crea la reserva aplicando las reglas. Cliente → para sí mismo;
-- trabajador con RESERVAS_GESTIONAR → para p_cliente_id.
-- Devuelve {reserva_id, via, mensaje}.
-- -----------------------------------------------------------------------------
create or replace function public.reservar(p_clase_id uuid, p_cliente_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cliente_id uuid;
  v_es_cliente boolean;
  v_clase      public.clases%rowtype;
  v_contrato   public.contratos%rowtype;
  v_ev         jsonb;
  v_via        text;
  v_origen     public.origen_reserva;
  v_reserva_id uuid;
begin
  v_cliente_id := public.auth_cliente_id();
  if v_cliente_id is not null then
    v_es_cliente := true;  -- un cliente solo reserva para sí mismo (se ignora p_cliente_id)
  elsif public.auth_trabajador_id() is not null then
    perform public._exigir('RESERVAS_GESTIONAR');
    if p_cliente_id is null then raise exception 'Falta el cliente.'; end if;
    v_cliente_id := p_cliente_id;
    v_es_cliente := false;
  else
    raise exception 'No autenticado.' using errcode = 'insufficient_privilege';
  end if;

  -- Bloqueamos la clase para serializar reservas concurrentes.
  select * into v_clase from public.clases where id = p_clase_id for update;
  if not found then raise exception 'La clase no existe.'; end if;

  v_ev := public._evaluar_reserva(p_clase_id, v_cliente_id);
  if not (v_ev->>'ok')::boolean then
    raise exception '%', v_ev->>'motivo' using errcode = 'P0001', detail = v_ev->>'codigo';
  end if;
  v_via := v_ev->>'via';
  v_contrato := public._contrato_activo(v_cliente_id, v_clase.fecha);
  v_origen := case v_via
    when 'RECUPERACION' then 'RECUPERACION'::public.origen_reserva
    when 'BONO' then 'BONO'::public.origen_reserva
    else case when v_es_cliente then 'CLIENTE'::public.origen_reserva else 'MANUAL'::public.origen_reserva end
  end;

  insert into public.reservas (clase_id, cliente_id, contrato_id, origen, recuperacion_usada_id, creado_por)
  values (p_clase_id, v_cliente_id, v_contrato.id, v_origen, (v_ev->>'recuperacion_id')::uuid, auth.uid())
  returning id into v_reserva_id;

  if v_via = 'RECUPERACION' then
    update public.recuperaciones set estado = 'USADA', usada_en_reserva_id = v_reserva_id
     where id = (v_ev->>'recuperacion_id')::uuid;
  elsif v_via = 'BONO' and v_contrato.id is not null then
    update public.contratos set sesiones_restantes = coalesce(sesiones_restantes, 1) - 1 where id = v_contrato.id;
  end if;

  perform public._auditar('RESERVAR', 'reserva', v_reserva_id::text,
    format('%s → %s (%s)', public._nombre_cliente(v_cliente_id), public._desc_clase(p_clase_id), v_via));
  return jsonb_build_object('reserva_id', v_reserva_id, 'via', v_via, 'mensaje', v_ev->>'mensaje');
end $$;
comment on function public.reservar(uuid, uuid) is 'Reserva una plaza aplicando todas las reglas de la tarifa del cliente.';

-- -----------------------------------------------------------------------------
-- cancelar_reserva: cancelación por el cliente (o trabajador en su nombre).
-- Clasifica recuperable / no recuperable y devuelve la recuperación, la sesión
-- del bono, o genera una recuperación nueva. p_forzar_recuperable solo personal.
-- Devuelve {recuperable, estado, minutos_antelacion, recuperacion_id}.
-- -----------------------------------------------------------------------------
create or replace function public.cancelar_reserva(p_reserva_id uuid, p_forzar_recuperable boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg        public.config_centro%rowtype;
  v_reserva    public.reservas%rowtype;
  v_clase      public.clases%rowtype;
  v_act        public.actividades%rowtype;
  v_contrato   public.contratos%rowtype;
  v_cliente_id uuid;
  v_min        integer;
  v_recuperable boolean;
  v_estado     public.estado_reserva;
  v_pendientes integer;
  v_rec_id     uuid;
  v_forzar     boolean := false;
begin
  select * into v_cfg from public.config_centro limit 1;
  select * into v_reserva from public.reservas where id = p_reserva_id for update;
  if not found then raise exception 'La reserva no existe.'; end if;

  v_cliente_id := public.auth_cliente_id();
  if v_cliente_id is not null then
    if v_reserva.cliente_id <> v_cliente_id then raise exception 'Esta reserva no es tuya.' using errcode = 'insufficient_privilege'; end if;
  elsif public.auth_trabajador_id() is not null then
    perform public._exigir('RESERVAS_GESTIONAR');
    v_forzar := coalesce(p_forzar_recuperable, false);
  else
    raise exception 'No autenticado.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_clase from public.clases where id = v_reserva.clase_id for update;

  -- puedeCancelarCliente
  if v_reserva.estado <> 'RESERVADA' then raise exception 'La reserva ya está cancelada.'; end if;
  if v_clase.estado = 'CANCELADA' then raise exception 'La clase ha sido cancelada por el centro.'; end if;
  v_min := public._minutos_hasta(v_clase.fecha, v_clase.hora_inicio);
  if v_min < 0 then raise exception 'La clase ya ha comenzado.'; end if;

  -- clasificarCancelacion (regla 6)
  v_recuperable := v_forzar or v_min >= v_cfg.minutos_antelacion_cancelacion;
  v_estado := case when v_recuperable then 'CANCELADA_RECUPERABLE' else 'CANCELADA_NO_RECUPERABLE' end;

  update public.reservas set estado = v_estado, cancelado_el = now(), cancelado_por = auth.uid() where id = p_reserva_id;

  select * into v_act from public.actividades where id = v_clase.actividad_id;
  if v_reserva.contrato_id is not null then
    select * into v_contrato from public.contratos where id = v_reserva.contrato_id;
  end if;

  if v_recuperable then
    if v_reserva.origen = 'RECUPERACION' and v_reserva.recuperacion_usada_id is not null then
      -- Devolver la recuperación que se había consumido.
      update public.recuperaciones set estado = 'DISPONIBLE', usada_en_reserva_id = null where id = v_reserva.recuperacion_usada_id;
      v_rec_id := v_reserva.recuperacion_usada_id;
    elsif v_reserva.origen = 'BONO' and v_contrato.id is not null then
      -- Devolver la sesión al bono.
      update public.contratos set sesiones_restantes = coalesce(sesiones_restantes, 0) + 1 where id = v_contrato.id;
    elsif v_reserva.origen <> 'CLASE_SUELTA' then
      select count(*) into v_pendientes from public.recuperaciones where cliente_id = v_reserva.cliente_id and estado = 'DISPONIBLE';
      if public._puede_generar_recuperacion(v_contrato.tarifa_id, v_pendientes) then
        insert into public.recuperaciones (cliente_id, contrato_id, reserva_origen_id, categoria_origen, categorias_permitidas, motivo, caduca_el, creado_por)
        values (v_reserva.cliente_id, v_contrato.id, v_reserva.id, v_act.categoria,
                public._categorias_permitidas_recuperacion(v_act.categoria, v_contrato.tarifa_id),
                'CANCELACION_CLIENTE', public._caducidad_recuperacion(v_contrato.fecha_fin, v_clase.fecha), auth.uid())
        returning id into v_rec_id;
      end if;
    end if;
  end if;

  perform public._auditar('CANCELAR_RESERVA', 'reserva', p_reserva_id::text,
    format('%s · %s · %s (%s min antelación)', public._nombre_cliente(v_reserva.cliente_id), public._desc_clase(v_clase.id), v_estado, v_min));
  return jsonb_build_object('recuperable', v_recuperable, 'estado', v_estado, 'minutos_antelacion', v_min, 'recuperacion_id', v_rec_id);
end $$;
comment on function public.cancelar_reserva(uuid, boolean) is 'Cancela una reserva: recuperable si hay antelación suficiente (o si el personal lo fuerza).';

-- -----------------------------------------------------------------------------
-- anadir_alumno: un trabajador mete a un cliente en una clase.
-- modo TARIFA → reglas normales; CLASE_SUELTA / MANUAL → sin reglas de tarifa.
-- -----------------------------------------------------------------------------
create or replace function public.anadir_alumno(p_clase_id uuid, p_cliente_id uuid, p_modo text default 'TARIFA')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_clase      public.clases%rowtype;
  v_contrato   public.contratos%rowtype;
  v_reserva_id uuid;
  v_ocupadas   integer;
begin
  if public.auth_trabajador_id() is null then raise exception 'Solo para el personal.' using errcode = 'insufficient_privilege'; end if;
  if p_modo not in ('TARIFA', 'CLASE_SUELTA', 'MANUAL') then raise exception 'Modo no válido: %', p_modo; end if;
  perform public._exigir(case when p_modo = 'CLASE_SUELTA' then 'CLASES_SUELTAS'::public.permiso else 'RESERVAS_GESTIONAR'::public.permiso end);
  if p_modo = 'TARIFA' then return public.reservar(p_clase_id, p_cliente_id); end if;

  select * into v_clase from public.clases where id = p_clase_id for update;
  if not found then raise exception 'La clase no existe.'; end if;
  if v_clase.estado = 'CANCELADA' then raise exception 'La clase está cancelada.'; end if;
  select count(*) into v_ocupadas from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA';
  if v_clase.plazas - v_ocupadas <= 0 then raise exception 'No quedan plazas libres.'; end if;
  if exists (select 1 from public.reservas where clase_id = p_clase_id and cliente_id = p_cliente_id and estado = 'RESERVADA') then
    raise exception 'El cliente ya tiene plaza en esta clase.';
  end if;
  v_contrato := public._contrato_activo(p_cliente_id, v_clase.fecha);
  insert into public.reservas (clase_id, cliente_id, contrato_id, origen, creado_por)
  values (p_clase_id, p_cliente_id, v_contrato.id, p_modo::public.origen_reserva, auth.uid())
  returning id into v_reserva_id;
  perform public._auditar('ANADIR_ALUMNO', 'reserva', v_reserva_id::text,
    format('%s → %s (%s)', public._nombre_cliente(p_cliente_id), public._desc_clase(p_clase_id), p_modo));
  return jsonb_build_object('reserva_id', v_reserva_id, 'via', p_modo, 'mensaje', 'Alumno añadido.');
end $$;

-- -----------------------------------------------------------------------------
-- registrar_asistencia
-- -----------------------------------------------------------------------------
create or replace function public.registrar_asistencia(p_reserva_id uuid, p_asistencia public.asistencia)
returns void language plpgsql security definer set search_path = public as $$
declare v_reserva public.reservas%rowtype;
begin
  perform public._exigir('ASISTENCIA_REGISTRAR');
  select * into v_reserva from public.reservas where id = p_reserva_id;
  if not found then raise exception 'La reserva no existe.'; end if;
  update public.reservas set asistencia = p_asistencia where id = p_reserva_id;
  perform public._auditar('ASISTENCIA', 'reserva', p_reserva_id::text, format('%s: %s', public._nombre_cliente(v_reserva.cliente_id), p_asistencia));
end $$;

-- -----------------------------------------------------------------------------
-- autorizar_recuperacion: el personal concede una recuperación manual.
-- -----------------------------------------------------------------------------
create or replace function public.autorizar_recuperacion(
  p_cliente_id uuid, p_categoria_origen public.categoria, p_categorias_permitidas public.categoria[],
  p_caduca_el date, p_nota text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_contrato public.contratos%rowtype;
  v_cats     public.categoria[];
  v_id       uuid;
begin
  perform public._exigir('RESERVAS_GESTIONAR');
  v_contrato := public._contrato_activo(p_cliente_id, public._hoy());
  select array_agg(distinct x order by x) into v_cats from unnest(array[p_categoria_origen] || coalesce(p_categorias_permitidas, '{}')) x;
  insert into public.recuperaciones (cliente_id, contrato_id, categoria_origen, categorias_permitidas, motivo, caduca_el, nota, creado_por)
  values (p_cliente_id, v_contrato.id, p_categoria_origen, v_cats, 'AUTORIZACION_MANUAL', p_caduca_el, coalesce(p_nota, ''), auth.uid())
  returning id into v_id;
  perform public._auditar('AUTORIZAR_RECUPERACION', 'recuperacion', v_id::text,
    format('%s: %s hasta %s', public._nombre_cliente(p_cliente_id), array_to_string(v_cats, '/'), p_caduca_el));
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- cancelar_clase: el centro cancela una clase. Devuelve recuperaciones/sesiones
-- a los afectados, genera recuperaciones nuevas y (opcional) un aviso.
-- Devuelve el número de afectados.
-- -----------------------------------------------------------------------------
create or replace function public.cancelar_clase(p_clase_id uuid, p_motivo text, p_clase_alternativa_id uuid default null, p_avisar boolean default true)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_clase     public.clases%rowtype;
  v_alt       public.clases%rowtype;
  v_act       public.actividades%rowtype;
  v_contrato  public.contratos%rowtype;
  r           public.reservas%rowtype;
  v_afectados integer := 0;
  v_clientes  uuid[] := '{}';
  v_aviso_id  uuid;
  v_alt_txt   text;
begin
  perform public._exigir('CLASES_CREAR_CANCELAR');
  select * into v_clase from public.clases where id = p_clase_id for update;
  if not found then raise exception 'La clase no existe.'; end if;
  if v_clase.estado = 'CANCELADA' then raise exception 'La clase ya está cancelada.'; end if;
  select * into v_act from public.actividades where id = v_clase.actividad_id;

  for r in select * from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA' loop
    v_afectados := v_afectados + 1;
    v_clientes := array_append(v_clientes, r.cliente_id);
    if r.origen = 'RECUPERACION' and r.recuperacion_usada_id is not null then
      update public.recuperaciones set estado = 'DISPONIBLE', usada_en_reserva_id = null where id = r.recuperacion_usada_id;
      continue;
    end if;
    if r.origen = 'BONO' and r.contrato_id is not null then
      update public.contratos set sesiones_restantes = coalesce(sesiones_restantes, 0) + 1 where id = r.contrato_id;
      continue;
    end if;
    if r.origen = 'CLASE_SUELTA' then continue; end if;
    v_contrato := null;
    if r.contrato_id is not null then select * into v_contrato from public.contratos where id = r.contrato_id; end if;
    insert into public.recuperaciones (cliente_id, contrato_id, reserva_origen_id, categoria_origen, categorias_permitidas, motivo, caduca_el, nota, creado_por)
    values (r.cliente_id, v_contrato.id, r.id, v_act.categoria,
            public._categorias_permitidas_recuperacion(v_act.categoria, v_contrato.tarifa_id),
            'CANCELACION_CENTRO', public._caducidad_recuperacion(v_contrato.fecha_fin, v_clase.fecha),
            'Clase cancelada por el centro: ' || coalesce(p_motivo, ''), auth.uid());
  end loop;

  update public.clases
     set estado = 'CANCELADA', motivo_cancelacion = p_motivo, clase_alternativa_id = p_clase_alternativa_id,
         cancelado_el = now(), cancelado_por = auth.uid()
   where id = p_clase_id;
  update public.reservas
     set estado = 'CANCELADA_CENTRO', cancelado_el = now(), cancelado_por = auth.uid()
   where clase_id = p_clase_id and estado = 'RESERVADA';

  if p_avisar and v_afectados > 0 then
    if p_clase_alternativa_id is not null then select * into v_alt from public.clases where id = p_clase_alternativa_id; end if;
    v_alt_txt := case when v_alt.id is not null
      then format(' Se realizará una clase alternativa el %s a las %s: puedes reservarla con la recuperación que te hemos añadido.', v_alt.fecha, to_char(v_alt.hora_inicio, 'HH24:MI'))
      else ' Te hemos añadido una recuperación para que la uses cuando quieras.' end;
    insert into public.avisos (titulo, cuerpo, destino_tipo, destino_clase_id, importante, publicado_por)
    values (format('Clase cancelada: %s %s %s', v_act.nombre, v_clase.fecha, to_char(v_clase.hora_inicio, 'HH24:MI')),
            (case when coalesce(p_motivo, '') <> '' then p_motivo || '.' else 'La clase queda cancelada.' end) || v_alt_txt,
            'CLASE', p_clase_id, true, auth.uid())
    returning id into v_aviso_id;
    insert into public.aviso_destinatarios (aviso_id, cliente_id)
    select v_aviso_id, c from unnest(v_clientes) c group by c;
  end if;

  perform public._auditar('CANCELAR_CLASE', 'clase', p_clase_id::text,
    format('%s · %s afectados · %s', public._desc_clase(p_clase_id), v_afectados, coalesce(p_motivo, '')));
  return v_afectados;
end $$;
comment on function public.cancelar_clase(uuid, text, uuid, boolean) is 'Cancela una clase por el centro: compensa a los afectados con recuperaciones y les avisa.';

-- -----------------------------------------------------------------------------
-- publicar_aviso: resuelve los destinatarios según el destino.
-- -----------------------------------------------------------------------------
create or replace function public.publicar_aviso(
  p_titulo text, p_cuerpo text, p_destino_tipo public.tipo_destino_aviso,
  p_destino_id uuid default null, p_cliente_ids uuid[] default null, p_importante boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n integer;
begin
  perform public._exigir('AVISOS_ENVIAR');
  insert into public.avisos (titulo, cuerpo, destino_tipo, destino_clase_id, destino_actividad_id, importante, publicado_por)
  values (p_titulo, coalesce(p_cuerpo, ''), p_destino_tipo,
          case when p_destino_tipo = 'CLASE' then p_destino_id end,
          case when p_destino_tipo = 'ACTIVIDAD' then p_destino_id end,
          coalesce(p_importante, false), auth.uid())
  returning id into v_id;

  insert into public.aviso_destinatarios (aviso_id, cliente_id)
  select v_id, x.cliente_id from (
    select c.id as cliente_id from public.clientes c where p_destino_tipo = 'TODOS' and c.activo
    union
    select unnest(p_cliente_ids) where p_destino_tipo = 'CLIENTES'
    union
    select r.cliente_id from public.reservas r
     where p_destino_tipo = 'CLASE' and r.clase_id = p_destino_id and r.estado in ('RESERVADA', 'CANCELADA_CENTRO')
    union
    select r.cliente_id from public.reservas r join public.clases c on c.id = r.clase_id
     where p_destino_tipo = 'ACTIVIDAD' and c.actividad_id = p_destino_id and r.estado = 'RESERVADA'
  ) x where x.cliente_id is not null;
  get diagnostics v_n = row_count;

  perform public._auditar('PUBLICAR_AVISO', 'aviso', v_id::text, format('%s → %s clientes', p_titulo, v_n));
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Generación de clases a partir del horario (rules/clases.ts)
-- -----------------------------------------------------------------------------
create or replace function public._generar_clases(p_desde date, p_hasta date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into public.clases (plantilla_id, actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas)
  select p.id, p.actividad_id, d::date, p.hora_inicio, p.duracion_min, p.monitor_id, p.plazas
    from generate_series(p_desde, p_hasta, interval '1 day') d
    join public.plantillas_clase p on p.activa and p.dia_semana = extract(isodow from d)
   where not exists (select 1 from public.dias_cierre dc where dc.fecha = d::date)
     and (p.vigencia_desde is null or d::date >= p.vigencia_desde)
     and (p.vigencia_hasta is null or d::date <= p.vigencia_hasta)
  on conflict (plantilla_id, fecha) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.generar_clases(p_desde date, p_hasta date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if auth.uid() is not null and not (public.tiene_permiso('HORARIOS_GESTIONAR') or public.tiene_permiso('CLASES_CREAR_CANCELAR')) then
    raise exception 'No tienes permiso para: HORARIOS_GESTIONAR' using errcode = 'insufficient_privilege';
  end if;
  v_n := public._generar_clases(p_desde, p_hasta);
  perform public._auditar('GENERAR_CLASES', 'clase', '-', format('%s → %s: %s clases nuevas', p_desde, p_hasta, v_n));
  return v_n;
end $$;
comment on function public.generar_clases(date, date) is 'Crea las clases que falten en el rango a partir del horario semanal (sin días de cierre).';

-- -----------------------------------------------------------------------------
-- Reservas automáticas de un contrato con horario fijo (rules/contratos.ts).
-- Solo clases PROGRAMADA de sus franjas, dentro del periodo, desde hoy, con plaza.
-- -----------------------------------------------------------------------------
create or replace function public._generar_reservas_automaticas(p_contrato_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_contrato public.contratos%rowtype;
  c          record;
  v_ocupadas integer;
  v_n        integer := 0;
begin
  select * into v_contrato from public.contratos where id = p_contrato_id;
  if not found or v_contrato.modalidad <> 'FIJO' or v_contrato.estado <> 'ACTIVO' then return 0; end if;

  for c in
    select cl.id, cl.plazas
      from public.clases cl
      join public.contrato_franjas f on f.contrato_id = v_contrato.id and f.plantilla_id = cl.plantilla_id
     where cl.estado = 'PROGRAMADA'
       and cl.fecha between greatest(v_contrato.fecha_inicio, public._hoy()) and v_contrato.fecha_fin
       and not exists (select 1 from public.reservas r where r.clase_id = cl.id and r.cliente_id = v_contrato.cliente_id)
     order by cl.fecha, cl.hora_inicio
     for update of cl
  loop
    select count(*) into v_ocupadas from public.reservas where clase_id = c.id and estado = 'RESERVADA';
    if v_ocupadas >= c.plazas then continue; end if;  -- sin plaza: el centro lo verá en el calendario
    insert into public.reservas (clase_id, cliente_id, contrato_id, origen, creado_por)
    values (c.id, v_contrato.cliente_id, v_contrato.id, 'AUTOMATICA', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.generar_reservas_automaticas(p_contrato_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if auth.uid() is not null and not (public.tiene_permiso('RESERVAS_GESTIONAR') or public.tiene_permiso('CLIENTES_EDITAR')) then
    raise exception 'No tienes permiso para: RESERVAS_GESTIONAR' using errcode = 'insufficient_privilege';
  end if;
  v_n := public._generar_reservas_automaticas(p_contrato_id);
  perform public._auditar('RESERVAS_AUTOMATICAS', 'contrato', p_contrato_id::text, format('%s reservas generadas', v_n));
  return v_n;
end $$;
comment on function public.generar_reservas_automaticas(uuid) is 'Regla 5: genera las reservas de horario fijo que falten para un contrato.';

-- -----------------------------------------------------------------------------
-- Contratos
-- -----------------------------------------------------------------------------
create or replace function public.crear_contrato(
  p_cliente_id uuid, p_tarifa_id uuid, p_fecha_inicio date, p_fecha_fin date default null,
  p_modalidad public.modalidad default 'LIBRE', p_franjas uuid[] default '{}',
  p_actividades_permitidas uuid[] default '{}', p_notas text default '', p_sesiones_restantes integer default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tarifa public.tarifas%rowtype;
  v_fin    date;
  v_id     uuid;
  v_n      integer;
begin
  perform public._exigir('CLIENTES_EDITAR');
  select * into v_tarifa from public.tarifas where id = p_tarifa_id;
  if not found then raise exception 'Tarifa no válida.'; end if;
  -- fechaFinPorDefecto: bono → validez; clase suelta → mismo día; recurrente → 3 meses.
  v_fin := coalesce(p_fecha_fin, case v_tarifa.tipo
    when 'BONO' then (p_fecha_inicio + make_interval(months => v_tarifa.bono_validez_meses))::date
    when 'CLASE_SUELTA' then p_fecha_inicio
    else (p_fecha_inicio + interval '3 months')::date end);
  if p_modalidad = 'FIJO' and cardinality(coalesce(p_franjas, '{}')) = 0 then
    raise exception 'Un contrato de horario fijo necesita al menos una franja.';
  end if;

  -- Un cliente solo tiene un contrato activo: los anteriores se finalizan.
  update public.contratos set estado = 'FINALIZADO' where cliente_id = p_cliente_id and estado = 'ACTIVO';

  insert into public.contratos (cliente_id, tarifa_id, fecha_inicio, fecha_fin, modalidad, sesiones_restantes, actividades_permitidas_ids, notas, creado_por)
  values (p_cliente_id, p_tarifa_id, p_fecha_inicio, v_fin, p_modalidad,
          case when v_tarifa.tipo = 'BONO' then coalesce(p_sesiones_restantes, v_tarifa.bono_sesiones, 0) end,
          coalesce(p_actividades_permitidas, '{}'), coalesce(p_notas, ''), auth.uid())
  returning id into v_id;

  if p_modalidad = 'FIJO' then
    insert into public.contrato_franjas (contrato_id, plantilla_id) select v_id, f from unnest(p_franjas) f group by f;
  end if;
  v_n := public._generar_reservas_automaticas(v_id);

  perform public._auditar('CREAR_CONTRATO', 'contrato', v_id::text,
    format('%s: %s %s→%s (%s reservas automáticas)', public._nombre_cliente(p_cliente_id), v_tarifa.nombre, p_fecha_inicio, v_fin, v_n));
  return v_id;
end $$;
comment on function public.crear_contrato(uuid, uuid, date, date, public.modalidad, uuid[], uuid[], text, integer) is
  'Da de alta un contrato (finaliza el anterior activo) y genera sus reservas automáticas si es horario fijo.';

create or replace function public.finalizar_contrato(p_contrato_id uuid, p_cancelar_reservas_futuras boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_hoy date := public._hoy();
begin
  perform public._exigir('CLIENTES_EDITAR');
  update public.contratos set estado = 'CANCELADO', fecha_fin = least(fecha_fin, v_hoy) where id = p_contrato_id;
  if not found then raise exception 'El contrato no existe.'; end if;
  if p_cancelar_reservas_futuras then
    update public.reservas r set estado = 'CANCELADA_CENTRO', cancelado_el = now(), cancelado_por = auth.uid()
      from public.clases c
     where c.id = r.clase_id and r.contrato_id = p_contrato_id and r.estado = 'RESERVADA' and c.fecha >= v_hoy;
  end if;
  perform public._auditar('FINALIZAR_CONTRATO', 'contrato', p_contrato_id::text, '');
end $$;

-- -----------------------------------------------------------------------------
-- mantenimiento_diario: tarea nocturna (pg_cron). Sin usuario (cron) o ADMIN.
--   1. Genera clases hasta N días vista.
--   2. Cancela clases programadas en días de cierre añadidos después
--      (sus reservas pasan a CANCELADA_CENTRO sin recuperación: el periodo ya descuenta cierres).
--   3. Reservas automáticas de todos los contratos activos de horario fijo.
--   4. Caduca recuperaciones vencidas.
--   5. Finaliza contratos vencidos.
-- -----------------------------------------------------------------------------
create or replace function public.mantenimiento_diario()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg      public.config_centro%rowtype;
  v_hoy      date;
  v_clases   integer;
  v_cierres  integer;
  v_reservas integer := 0;
  v_caducadas integer;
  v_finalizados integer;
  k          record;
  v_res      jsonb;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo el administrador (o la tarea programada) puede ejecutar el mantenimiento.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_cfg from public.config_centro limit 1;
  v_hoy := public._hoy();

  v_clases := public._generar_clases(v_hoy, v_hoy + coalesce(v_cfg.dias_generacion_clases, 70));

  with canceladas as (
    update public.clases c
       set estado = 'CANCELADA', motivo_cancelacion = 'Día de cierre', cancelado_el = now(), cancelado_por = null
      from public.dias_cierre dc
     where dc.fecha = c.fecha and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy
     returning c.id
  ), reservas_canceladas as (
    update public.reservas r set estado = 'CANCELADA_CENTRO', cancelado_el = now(), cancelado_por = null
     where r.estado = 'RESERVADA' and r.clase_id in (select id from canceladas)
     returning r.id
  )
  select count(*) into v_cierres from canceladas;

  for k in select id from public.contratos where estado = 'ACTIVO' and modalidad = 'FIJO' loop
    v_reservas := v_reservas + public._generar_reservas_automaticas(k.id);
  end loop;

  update public.recuperaciones set estado = 'CADUCADA' where estado = 'DISPONIBLE' and caduca_el < v_hoy;
  get diagnostics v_caducadas = row_count;

  update public.contratos set estado = 'FINALIZADO' where estado = 'ACTIVO' and fecha_fin < v_hoy;
  get diagnostics v_finalizados = row_count;

  v_res := jsonb_build_object('fecha', v_hoy, 'clases_creadas', v_clases, 'clases_canceladas_por_cierre', v_cierres,
    'reservas_automaticas', v_reservas, 'recuperaciones_caducadas', v_caducadas, 'contratos_finalizados', v_finalizados);
  perform public._auditar('MANTENIMIENTO', 'sistema', '-', v_res::text);
  return v_res;
end $$;
comment on function public.mantenimiento_diario() is 'Tarea nocturna: genera clases y reservas automáticas, caduca recuperaciones y finaliza contratos.';

-- -----------------------------------------------------------------------------
-- Permisos de ejecución: nada para anon; las públicas para authenticated;
-- las internas (_*) solo para el propietario.
-- -----------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma, p.proname as nombre
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         '_ahora_local', '_hoy', '_minutos_hasta', '_inicio_semana', '_actor_nombre', '_auditar', '_nombre_cliente', '_desc_clase',
         '_exigir', '_contrato_activo', '_categorias_permitidas_recuperacion', '_caducidad_recuperacion', '_puede_generar_recuperacion',
         '_consume_cupo', '_cupo_consumido_en_semana', '_bloqueo', '_evaluar_reserva', '_generar_clases', '_generar_reservas_automaticas',
         'evaluar_reserva', 'reservar', 'cancelar_reserva', 'anadir_alumno', 'registrar_asistencia', 'autorizar_recuperacion',
         'cancelar_clase', 'publicar_aviso', 'generar_clases', 'generar_reservas_automaticas', 'crear_contrato', 'finalizar_contrato',
         'mantenimiento_diario'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    if left(f.nombre, 1) <> '_' then
      execute format('grant execute on function %s to authenticated', f.firma);
    end if;
  end loop;
end $$;

-- ====================================================================
-- seed.sql
-- ====================================================================
-- =============================================================================
-- seed.sql · Datos iniciales del centro (espejo de app/src/data/seed.ts)
-- Sin clientes reales. Idempotente: puede ejecutarse varias veces.
-- Los uuid son fijos para poder referenciarlos desde el horario y las pruebas.
-- =============================================================================

-- Configuración del centro
insert into public.config_centro (id, nombre, minutos_antelacion_cancelacion, dias_ventana_reserva,
  recuperacion_caduca_con_contrato, dias_caducidad_recuperacion, dias_generacion_clases, zona_horaria)
values (true, 'Clínica Nuevo Palmar · Pilates', 60, 14, true, 30, 70, 'Europe/Madrid')
on conflict (id) do nothing;

-- Días de cierre del año en curso (festivos)
insert into public.dias_cierre (fecha, motivo)
select make_date(extract(year from current_date)::int, m, d), motivo
  from (values (10, 12, 'Fiesta Nacional'), (11, 1, 'Todos los Santos'), (12, 6, 'Día de la Constitución'),
               (12, 8, 'Inmaculada'), (12, 25, 'Navidad')) v(m, d, motivo)
on conflict (fecha) do nothing;

-- Actividades
insert into public.actividades (id, nombre, categoria, descripcion, color, orden) values
  ('a0000000-0000-4000-8000-000000000001', 'Pilates suelo', 'DIRIGIDA', 'Trabajo de control postural, core y movilidad en colchoneta. Grupo reducido dirigido por fisioterapeuta.', '#548C2F', 1),
  ('a0000000-0000-4000-8000-000000000002', 'Espalda sana',  'DIRIGIDA', 'Sesión terapéutica centrada en columna: movilidad, estabilidad y prevención del dolor.', '#7FB356', 2),
  ('a0000000-0000-4000-8000-000000000003', 'Hipopresivos',  'DIRIGIDA', 'Técnicas hipopresivas para suelo pélvico, postura y respiración.', '#A3CB80', 3),
  ('a0000000-0000-4000-8000-000000000004', 'Reformer',      'REFORMER', 'Pilates en máquina Reformer. Máximo 4 personas por sesión, supervisión individualizada.', '#3B82C4', 4)
on conflict (id) do nothing;

-- Tarifas
insert into public.tarifas (id, nombre, descripcion, tipo, bono_sesiones, bono_categoria, bono_validez_meses,
  recuperacion_permitida, recuperacion_categorias_extra, recuperacion_max_pendientes, precio_centimos, orden) values
  ('b0000000-0000-4000-8000-000000000001', 'Dirigidas · 2 días/semana', 'Dos sesiones semanales de actividades dirigidas (suelo, espalda sana, hipopresivos).', 'RECURRENTE', null, null, null, true, '{}', null, null, 1),
  ('b0000000-0000-4000-8000-000000000002', 'Dirigidas · 3 días/semana', 'Tres sesiones semanales de actividades dirigidas.', 'RECURRENTE', null, null, null, true, '{}', null, null, 2),
  ('b0000000-0000-4000-8000-000000000003', 'Reformer · 2 días/semana',  'Dos sesiones semanales de Reformer.', 'RECURRENTE', null, null, null, true, '{}', null, null, 3),
  ('b0000000-0000-4000-8000-000000000004', 'Reformer · 3 días/semana',  'Tres sesiones semanales de Reformer.', 'RECURRENTE', null, null, null, true, '{}', null, null, 4),
  ('b0000000-0000-4000-8000-000000000005', 'Mixta · 1 Reformer + 1 dirigida', 'Una sesión semanal de Reformer y una de actividades dirigidas.', 'RECURRENTE', null, null, null, true, '{}', null, null, 5),
  ('b0000000-0000-4000-8000-000000000006', 'Bono 10 clases dirigidas', '10 sesiones de actividades dirigidas. Validez 6 meses.', 'BONO', 10, 'DIRIGIDA', 6, true, '{}', null, null, 6),
  ('b0000000-0000-4000-8000-000000000007', 'Bono 10 Reformer', '10 sesiones de Reformer. Validez 6 meses.', 'BONO', 10, 'REFORMER', 6, true, '{}', null, null, 7),
  ('b0000000-0000-4000-8000-000000000008', 'Clase suelta (CS)', 'Una sesión individual, sin compromiso. Se gestiona en recepción.', 'CLASE_SUELTA', null, null, null, false, '{}', 0, null, 8)
on conflict (id) do nothing;

insert into public.tarifa_cupos (tarifa_id, categoria, sesiones_semana) values
  ('b0000000-0000-4000-8000-000000000001', 'DIRIGIDA', 2),
  ('b0000000-0000-4000-8000-000000000002', 'DIRIGIDA', 3),
  ('b0000000-0000-4000-8000-000000000003', 'REFORMER', 2),
  ('b0000000-0000-4000-8000-000000000004', 'REFORMER', 3),
  ('b0000000-0000-4000-8000-000000000005', 'REFORMER', 1),
  ('b0000000-0000-4000-8000-000000000005', 'DIRIGIDA', 1)
on conflict do nothing;

-- Trabajadores de ejemplo (sin user_id: se vinculan al invitar a cada uno por email en Auth)
insert into public.trabajadores (id, nombre, apellidos, email, telefono, rol, es_monitor, color) values
  ('c0000000-0000-4000-8000-000000000001', 'José Diego', 'Frutos',   'josediego@fisioterapianuevopalmar.com', '968 885 931', 'ADMIN',     true,  '#548C2F'),
  ('c0000000-0000-4000-8000-000000000002', 'Ana',        'Martínez', 'ana@fisioterapianuevopalmar.com',       '',            'MONITOR',   true,  '#3B82C4'),
  ('c0000000-0000-4000-8000-000000000003', 'Laura',      'Pérez',    'recepcion@fisioterapianuevopalmar.com', '',            'RECEPCION', false, '#C9713F')
on conflict (id) do nothing;

insert into public.trabajador_permisos (trabajador_id, permiso)
select 'c0000000-0000-4000-8000-000000000001'::uuid, unnest(enum_range(null::public.permiso))  -- ADMIN: todos (explícitos además de implícitos)
union all
select 'c0000000-0000-4000-8000-000000000002'::uuid, unnest(array['CLIENTES_VER', 'CLINICA_VER', 'RESERVAS_GESTIONAR', 'CLASES_SUELTAS', 'AVISOS_ENVIAR', 'ASISTENCIA_REGISTRAR']::public.permiso[])
union all
select 'c0000000-0000-4000-8000-000000000003'::uuid, unnest(array['CLIENTES_EDITAR', 'CLIENTES_VER', 'RESERVAS_GESTIONAR', 'CLASES_SUELTAS', 'AVISOS_ENVIAR', 'ESTADISTICAS_VER']::public.permiso[])
on conflict do nothing;

-- Horario semanal (duración 55 min). dia_semana: 1 = lunes … 7 = domingo.
insert into public.plantillas_clase (id, actividad_id, dia_semana, hora_inicio, duracion_min, monitor_id, plazas) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 1, '09:00', 55, 'c0000000-0000-4000-8000-000000000002', 10), -- lun 09:00 suelo
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 3, '09:00', 55, 'c0000000-0000-4000-8000-000000000002', 10), -- mié 09:00 suelo
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 5, '09:00', 55, 'c0000000-0000-4000-8000-000000000002', 10), -- vie 09:00 suelo
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004', 1, '10:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- lun 10:00 reformer
  ('d0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000004', 3, '10:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- mié 10:00 reformer
  ('d0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000004', 5, '10:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- vie 10:00 reformer
  ('d0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000002', 2, '11:00', 55, 'c0000000-0000-4000-8000-000000000001', 8),  -- mar 11:00 espalda
  ('d0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000002', 4, '11:00', 55, 'c0000000-0000-4000-8000-000000000001', 8),  -- jue 11:00 espalda
  ('d0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000004', 2, '17:00', 55, 'c0000000-0000-4000-8000-000000000002', 4),  -- mar 17:00 reformer
  ('d0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000004', 4, '17:00', 55, 'c0000000-0000-4000-8000-000000000002', 4),  -- jue 17:00 reformer
  ('d0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 1, '18:00', 55, 'c0000000-0000-4000-8000-000000000002', 10), -- lun 18:00 suelo
  ('d0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 3, '18:00', 55, 'c0000000-0000-4000-8000-000000000002', 10), -- mié 18:00 suelo
  ('d0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', 2, '18:00', 55, 'c0000000-0000-4000-8000-000000000001', 10), -- mar 18:00 suelo
  ('d0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000001', 4, '18:00', 55, 'c0000000-0000-4000-8000-000000000001', 10), -- jue 18:00 suelo
  ('d0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000004', 1, '19:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- lun 19:00 reformer
  ('d0000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000004', 3, '19:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- mié 19:00 reformer
  ('d0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000004', 5, '19:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- vie 19:00 reformer
  ('d0000000-0000-4000-8000-000000000018', 'a0000000-0000-4000-8000-000000000003', 2, '20:00', 55, 'c0000000-0000-4000-8000-000000000002', 8),  -- mar 20:00 hipopresivos
  ('d0000000-0000-4000-8000-000000000019', 'a0000000-0000-4000-8000-000000000003', 4, '20:00', 55, 'c0000000-0000-4000-8000-000000000002', 8),  -- jue 20:00 hipopresivos
  ('d0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000004', 6, '11:00', 55, 'c0000000-0000-4000-8000-000000000001', 4)   -- sáb 11:00 reformer
on conflict (id) do nothing;

insert into public.auditoria (actor_nombre, accion, entidad, entidad_id, detalle)
values ('Sistema', 'SEED', 'db', '-', 'Datos iniciales cargados');


-- ====================================================================
-- migrations/0004_produccion.sql
-- ====================================================================
-- =============================================================================
-- 0004_produccion.sql · Ajustes de puesta en marcha
--   1. Tarea nocturna (pg_cron): genera clases, reservas automáticas, caduca
--      recuperaciones y finaliza contratos vencidos.
--   2. Tiempo real: las tablas cuyos cambios se envían a la app al instante.
--   3. Vinculación automática de usuarios: cuando alguien crea su contraseña
--      con un email que ya existe en clientes o trabajadores, queda enlazado.
-- =============================================================================

-- 1) Mantenimiento nocturno a las 03:15 (hora del servidor, UTC).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'mantenimiento-diario';
    perform cron.schedule('mantenimiento-diario', '15 3 * * *', 'select public.mantenimiento_diario()');
  else
    raise notice 'pg_cron no disponible: programar el mantenimiento manualmente.';
  end if;
end $$;

-- 2) Tiempo real.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publicación supabase_realtime no existe (fuera de Supabase): se omite.';
    return;
  end if;
  foreach t in array array['reservas', 'clases', 'avisos', 'recuperaciones', 'contratos'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 3) Vincular automáticamente el usuario de acceso con su ficha por email.
create or replace function public.vincular_usuario_por_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null then return new; end if;
  update public.trabajadores set user_id = new.id
   where user_id is null and lower(email) = lower(new.email);
  update public.clientes set user_id = new.id
   where user_id is null and lower(email) = lower(new.email);
  return new;
end $$;
comment on function public.vincular_usuario_por_email() is
  'Al crearse un usuario en auth.users, enlaza su id con la ficha de trabajador o cliente que tenga ese email.';

drop trigger if exists trg_vincular_usuario on auth.users;
create trigger trg_vincular_usuario
  after insert on auth.users
  for each row execute function public.vincular_usuario_por_email();

-- Enlazar también a los usuarios que ya existan.
update public.trabajadores t set user_id = u.id
  from auth.users u where t.user_id is null and lower(t.email) = lower(u.email);
update public.clientes c set user_id = u.id
  from auth.users u where c.user_id is null and lower(c.email) = lower(u.email);

-- Las fichas deben poder consultarse por email antes de vincular: índice.
create index if not exists clientes_email_lower_idx on public.clientes (lower(email));
create index if not exists trabajadores_email_lower_idx on public.trabajadores (lower(email));

-- 4) Generar ya las clases de las próximas semanas.
select public.mantenimiento_diario();
