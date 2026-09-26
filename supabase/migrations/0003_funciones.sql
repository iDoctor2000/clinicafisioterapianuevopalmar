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
