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
