-- =============================================================================
-- 0005_ambito.sql · Ámbito por trabajador y gestión del equipo solo para ADMIN
--
-- Cada trabajador tiene un ámbito:
--   · CENTRO      → ve y gestiona todo el centro (según sus permisos).
--   · SUS_CLASES  → solo las clases que imparte (clases.monitor_id = él/ella):
--       - reservas: solo las de sus clases (lectura y escritura);
--       - clientes, información clínica, contratos y recuperaciones: solo de sus
--         alumnos (clientes con alguna reserva en una clase suya);
--       - avisos: solo los que publicó o los dirigidos a una de sus clases, y
--         solo puede publicar con destino CLASE a una clase suya;
--       - horario (plantillas_clase) y clases: solo lectura;
--       - las RPC (reservar, cancelar_reserva, anadir_alumno,
--         registrar_asistencia, cancelar_clase, publicar_aviso) rechazan con
--         «Esta clase no es tuya.» cuando la clase no es suya.
--   Un ADMIN siempre tiene ámbito CENTRO (trigger + auth_ambito()).
--
-- Además, la gestión del equipo (trabajadores y trabajador_permisos) pasa a ser
-- exclusiva del rol ADMIN: el permiso TRABAJADORES_GESTIONAR se conserva en el
-- enum (para no romper datos) pero ya no da acceso por sí solo.
--
-- Espejo de app/src/domain/ambito.ts y app/src/data/comandos.ts.
-- Idempotente: se puede volver a ejecutar sin efectos secundarios.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipo y columna
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'ambito_trabajador') then
    create type public.ambito_trabajador as enum ('CENTRO', 'SUS_CLASES');
  end if;
end $$;
comment on type public.ambito_trabajador is 'Alcance de los permisos de un trabajador: todo el centro o solo las clases que imparte.';

alter table public.trabajadores
  add column if not exists ambito public.ambito_trabajador not null default 'CENTRO';
comment on column public.trabajadores.ambito is 'CENTRO = todo el centro; SUS_CLASES = solo las clases que imparte. Un ADMIN siempre es CENTRO.';

-- Un administrador siempre tiene ámbito CENTRO.
create or replace function public.trg_trabajadores_ambito_admin()
returns trigger language plpgsql as $$
begin
  if new.rol = 'ADMIN' then new.ambito := 'CENTRO'; end if;
  return new;
end $$;
drop trigger if exists trabajadores_ambito_admin on public.trabajadores;
create trigger trabajadores_ambito_admin before insert or update on public.trabajadores
  for each row execute function public.trg_trabajadores_ambito_admin();
update public.trabajadores set ambito = 'CENTRO' where rol = 'ADMIN' and ambito <> 'CENTRO';

-- -----------------------------------------------------------------------------
-- 2. Funciones de ámbito (security definer: no dependen de las políticas y evitan
--    recursión entre políticas)
-- -----------------------------------------------------------------------------
create or replace function public.auth_ambito()
returns public.ambito_trabajador language sql stable security definer set search_path = public as $$
  select case when t.rol = 'ADMIN' then 'CENTRO'::public.ambito_trabajador else t.ambito end
    from public.trabajadores t where t.user_id = auth.uid() and t.activo limit 1
$$;
comment on function public.auth_ambito() is 'Ámbito del trabajador autenticado (NULL si no es trabajador activo). ADMIN → CENTRO.';

create or replace function public.limitado_a_sus_clases()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_ambito() = 'SUS_CLASES', false)
$$;
comment on function public.limitado_a_sus_clases() is 'true si el usuario actual es un trabajador con ámbito SUS_CLASES.';

create or replace function public.clase_es_mia(p_clase_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clases c where c.id = p_clase_id and c.monitor_id = public.auth_trabajador_id())
$$;
comment on function public.clase_es_mia(uuid) is 'true si la clase la imparte el trabajador autenticado.';

create or replace function public.cliente_es_alumno_mio(p_cliente_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.reservas r join public.clases c on c.id = r.clase_id
     where r.cliente_id = p_cliente_id and c.monitor_id = public.auth_trabajador_id()
  )
$$;
comment on function public.cliente_es_alumno_mio(uuid) is 'true si el cliente tiene alguna reserva (en cualquier estado) en una clase del trabajador autenticado.';

-- «Alcance»: true si el ámbito no limita, o si el objeto es del trabajador.
create or replace function public.alcance_clase(p_clase_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.limitado_a_sus_clases() or public.clase_es_mia(p_clase_id)
$$;
create or replace function public.alcance_cliente(p_cliente_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.limitado_a_sus_clases() or public.cliente_es_alumno_mio(p_cliente_id)
$$;
-- Lectura de un aviso: lo publicó el trabajador o va dirigido a una clase suya.
create or replace function public.alcance_aviso(p_aviso_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.limitado_a_sus_clases() or exists (
    select 1 from public.avisos a
     where a.id = p_aviso_id
       and (a.publicado_por = auth.uid() or (a.destino_tipo = 'CLASE' and public.clase_es_mia(a.destino_clase_id)))
  )
$$;
-- Escritura de un aviso: con SUS_CLASES solo destino CLASE a una clase suya.
create or replace function public.alcance_destino_aviso(p_destino_tipo public.tipo_destino_aviso, p_destino_clase_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.limitado_a_sus_clases() or (p_destino_tipo = 'CLASE' and public.clase_es_mia(p_destino_clase_id))
$$;

create or replace function public._exigir_clase_mia(p_clase_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.alcance_clase(p_clase_id) then
    raise exception 'Esta clase no es tuya.' using errcode = 'insufficient_privilege';
  end if;
end $$;

revoke all on function public.auth_ambito() from public, anon;
revoke all on function public.limitado_a_sus_clases() from public, anon;
revoke all on function public.clase_es_mia(uuid) from public, anon;
revoke all on function public.cliente_es_alumno_mio(uuid) from public, anon;
revoke all on function public.alcance_clase(uuid) from public, anon;
revoke all on function public.alcance_cliente(uuid) from public, anon;
revoke all on function public.alcance_aviso(uuid) from public, anon;
revoke all on function public.alcance_destino_aviso(public.tipo_destino_aviso, uuid) from public, anon;
revoke all on function public._exigir_clase_mia(uuid) from public, anon, authenticated;
grant execute on function public.auth_ambito() to authenticated;
grant execute on function public.limitado_a_sus_clases() to authenticated;  -- se evalúa desde las políticas RLS
grant execute on function public.clase_es_mia(uuid) to authenticated;
grant execute on function public.cliente_es_alumno_mio(uuid) to authenticated;
grant execute on function public.alcance_clase(uuid) to authenticated;
grant execute on function public.alcance_cliente(uuid) to authenticated;
grant execute on function public.alcance_aviso(uuid) to authenticated;
grant execute on function public.alcance_destino_aviso(public.tipo_destino_aviso, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Trabajadores y permisos: gestión exclusiva del rol ADMIN
--    (sustituye las políticas de 0002 basadas en TRABAJADORES_GESTIONAR)
-- -----------------------------------------------------------------------------
drop policy if exists trabajadores_escribir on public.trabajadores;
create policy trabajadores_escribir on public.trabajadores for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists permisos_leer on public.trabajador_permisos;
create policy permisos_leer on public.trabajador_permisos for select to authenticated
  using (trabajador_id = public.auth_trabajador_id() or public.es_admin());
drop policy if exists permisos_escribir on public.trabajador_permisos;
create policy permisos_escribir on public.trabajador_permisos for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- -----------------------------------------------------------------------------
-- 4. Clientes, información clínica, contratos y recuperaciones: con SUS_CLASES
--    solo los alumnos del trabajador
-- -----------------------------------------------------------------------------
drop policy if exists clientes_leer on public.clientes;
create policy clientes_leer on public.clientes for select to authenticated
  using (id = public.auth_cliente_id() or (public.tiene_permiso('CLIENTES_VER') and public.alcance_cliente(id)));
drop policy if exists clientes_editar on public.clientes;
create policy clientes_editar on public.clientes for all to authenticated
  using (public.tiene_permiso('CLIENTES_EDITAR') and public.alcance_cliente(id))
  with check (public.tiene_permiso('CLIENTES_EDITAR') and public.alcance_cliente(id));

drop policy if exists clinica_acceso on public.clientes_clinica;
create policy clinica_acceso on public.clientes_clinica for all to authenticated
  using (public.tiene_permiso('CLINICA_VER') and public.alcance_cliente(cliente_id))
  with check (public.tiene_permiso('CLINICA_VER') and public.alcance_cliente(cliente_id));

drop policy if exists contratos_leer on public.contratos;
create policy contratos_leer on public.contratos for select to authenticated
  using (cliente_id = public.auth_cliente_id() or (public.tiene_permiso('CLIENTES_VER') and public.alcance_cliente(cliente_id)));
drop policy if exists contratos_escribir on public.contratos;
create policy contratos_escribir on public.contratos for all to authenticated
  using (public.tiene_permiso('CLIENTES_EDITAR') and public.alcance_cliente(cliente_id))
  with check (public.tiene_permiso('CLIENTES_EDITAR') and public.alcance_cliente(cliente_id));

drop policy if exists franjas_leer on public.contrato_franjas;
create policy franjas_leer on public.contrato_franjas for select to authenticated
  using (
    exists (select 1 from public.contratos c
             where c.id = contrato_id
               and (c.cliente_id = public.auth_cliente_id() or (public.tiene_permiso('CLIENTES_VER') and public.alcance_cliente(c.cliente_id))))
  );

drop policy if exists recuperaciones_leer on public.recuperaciones;
create policy recuperaciones_leer on public.recuperaciones for select to authenticated
  using (cliente_id = public.auth_cliente_id() or (public.auth_trabajador_id() is not null and public.alcance_cliente(cliente_id)));
drop policy if exists recuperaciones_gestionar on public.recuperaciones;
create policy recuperaciones_gestionar on public.recuperaciones for all to authenticated
  using (public.tiene_permiso('RESERVAS_GESTIONAR') and public.alcance_cliente(cliente_id))
  with check (public.tiene_permiso('RESERVAS_GESTIONAR') and public.alcance_cliente(cliente_id));

-- -----------------------------------------------------------------------------
-- 5. Reservas: con SUS_CLASES solo las de sus clases (lectura y escritura)
-- -----------------------------------------------------------------------------
drop policy if exists reservas_leer on public.reservas;
create policy reservas_leer on public.reservas for select to authenticated
  using (cliente_id = public.auth_cliente_id() or (public.auth_trabajador_id() is not null and public.alcance_clase(clase_id)));
drop policy if exists reservas_gestionar on public.reservas;
create policy reservas_gestionar on public.reservas for all to authenticated
  using (public.tiene_permiso('RESERVAS_GESTIONAR') and public.alcance_clase(clase_id))
  with check (public.tiene_permiso('RESERVAS_GESTIONAR') and public.alcance_clase(clase_id));

-- -----------------------------------------------------------------------------
-- 6. Horario y clases: con SUS_CLASES solo lectura (la cancelación va por RPC)
-- -----------------------------------------------------------------------------
drop policy if exists plantillas_escribir on public.plantillas_clase;
create policy plantillas_escribir on public.plantillas_clase for all to authenticated
  using (public.tiene_permiso('HORARIOS_GESTIONAR') and not public.limitado_a_sus_clases())
  with check (public.tiene_permiso('HORARIOS_GESTIONAR') and not public.limitado_a_sus_clases());

drop policy if exists clases_escribir on public.clases;
create policy clases_escribir on public.clases for all to authenticated
  using (public.tiene_permiso('CLASES_CREAR_CANCELAR') and not public.limitado_a_sus_clases())
  with check (public.tiene_permiso('CLASES_CREAR_CANCELAR') and not public.limitado_a_sus_clases());

-- -----------------------------------------------------------------------------
-- 7. Avisos: con SUS_CLASES solo los propios o dirigidos a sus clases
-- -----------------------------------------------------------------------------
drop policy if exists avisos_leer on public.avisos;
create policy avisos_leer on public.avisos for select to authenticated
  using (
    (public.auth_trabajador_id() is not null and public.alcance_aviso(id))
    or exists (select 1 from public.aviso_destinatarios d where d.aviso_id = avisos.id and d.cliente_id = public.auth_cliente_id())
  );
drop policy if exists avisos_escribir on public.avisos;
create policy avisos_escribir on public.avisos for all to authenticated
  using (public.tiene_permiso('AVISOS_ENVIAR') and public.alcance_destino_aviso(destino_tipo, destino_clase_id))
  with check (public.tiene_permiso('AVISOS_ENVIAR') and public.alcance_destino_aviso(destino_tipo, destino_clase_id));

drop policy if exists destinatarios_leer on public.aviso_destinatarios;
create policy destinatarios_leer on public.aviso_destinatarios for select to authenticated
  using (cliente_id = public.auth_cliente_id() or (public.auth_trabajador_id() is not null and public.alcance_aviso(aviso_id)));
drop policy if exists destinatarios_escribir on public.aviso_destinatarios;
create policy destinatarios_escribir on public.aviso_destinatarios for all to authenticated
  using (public.tiene_permiso('AVISOS_ENVIAR') and public.alcance_aviso(aviso_id))
  with check (public.tiene_permiso('AVISOS_ENVIAR') and public.alcance_aviso(aviso_id));

-- -----------------------------------------------------------------------------
-- 8. RPC: misma firma y cuerpo que en 0003_funciones.sql, añadiendo únicamente
--    la comprobación de ámbito (líneas marcadas «-- 0005: ámbito»).
--    `create or replace` conserva los permisos de ejecución ya concedidos.
-- -----------------------------------------------------------------------------
-- reservar (0003 + ámbito)
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
    perform public._exigir_clase_mia(p_clase_id);  -- 0005: ámbito
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

-- cancelar_reserva (0003 + ámbito)
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
    perform public._exigir_clase_mia(v_reserva.clase_id);  -- 0005: ámbito
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

-- anadir_alumno (0003 + ámbito)
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
  perform public._exigir_clase_mia(p_clase_id);  -- 0005: ámbito
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

-- registrar_asistencia (0003 + ámbito)
create or replace function public.registrar_asistencia(p_reserva_id uuid, p_asistencia public.asistencia)
returns void language plpgsql security definer set search_path = public as $$
declare v_reserva public.reservas%rowtype;
begin
  perform public._exigir('ASISTENCIA_REGISTRAR');
  select * into v_reserva from public.reservas where id = p_reserva_id;
  if not found then raise exception 'La reserva no existe.'; end if;
  perform public._exigir_clase_mia(v_reserva.clase_id);  -- 0005: ámbito
  update public.reservas set asistencia = p_asistencia where id = p_reserva_id;
  perform public._auditar('ASISTENCIA', 'reserva', p_reserva_id::text, format('%s: %s', public._nombre_cliente(v_reserva.cliente_id), p_asistencia));
end $$;

-- cancelar_clase (0003 + ámbito)
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
  perform public._exigir_clase_mia(p_clase_id);  -- 0005: ámbito
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

-- publicar_aviso (0003 + ámbito)
create or replace function public.publicar_aviso(
  p_titulo text, p_cuerpo text, p_destino_tipo public.tipo_destino_aviso,
  p_destino_id uuid default null, p_cliente_ids uuid[] default null, p_importante boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n integer;
begin
  perform public._exigir('AVISOS_ENVIAR');
  -- 0005: ámbito SUS_CLASES → solo a los alumnos de una clase propia.
  if public.limitado_a_sus_clases() then
    if p_destino_tipo <> 'CLASE' then
      raise exception 'Con tu ámbito solo puedes enviar avisos a los alumnos de tus clases.' using errcode = 'insufficient_privilege';
    end if;
    perform public._exigir_clase_mia(p_destino_id);
  end if;
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
-- 9. La vista `monitores` (0001) no cambia: los clientes no ven el ámbito.
-- -----------------------------------------------------------------------------
