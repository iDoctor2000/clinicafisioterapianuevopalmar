-- =============================================================================
-- 0050_fijos_en_lista_espera.sql · Un alumno fijo sin plaza en su clase entra solo si se libera sitio
--
--   Lo que pasaba (04/11): a un alumno de horario fijo le tocaba una clase completa y se quedaba sin
--   plaza. Si después alguien cancelaba, la plaza iba a la lista de espera (o a nadie) y el alumno fijo
--   no se enteraba. Decidido con el centro:
--     1. Si su clase fija está completa, queda el PRIMERO en la lista de espera de esa clase (por delante
--        de los demás) hasta 2 horas antes. Si se libera sitio, entra solo y le llega un aviso al móvil.
--     2. Si entra así, puede cancelar sin perder la clase (no la ha pedido él): recupera como siempre.
--     3. Si sale de esa lista (o el centro le quita), no se le vuelve a apuntar a ella.
--   Se aplica ya a todos los contratos fijos activos. Idempotente.
-- =============================================================================

alter table public.lista_espera add column if not exists contrato_fijo_id uuid references public.contratos(id) on delete cascade;
comment on column public.lista_espera.contrato_fijo_id is 'Contrato fijo por el que el alumno espera su propia clase (0050): va por delante y entra con su horario fijo.';

alter table public.reservas add column if not exists cancelacion_libre boolean not null default false;
comment on column public.reservas.cancelacion_libre is 'Entró sola desde la lista de espera de su clase fija (0050): cancelar nunca le hace perder la clase.';

create table if not exists public.lista_espera_rechazos (
  clase_id   uuid not null references public.clases(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  creado_el  timestamptz not null default now(),
  primary key (clase_id, cliente_id)
);
comment on table public.lista_espera_rechazos is 'Clases fijas de cuya lista de espera salió el alumno (o le quitó el centro): no se le vuelve a apuntar (0050).';
alter table public.lista_espera_rechazos enable row level security;
revoke all on public.lista_espera_rechazos from public, anon, authenticated;

-- La posición: primero los fijos.
create or replace view public.mi_lista_espera with (security_invoker = false) as
  select e.id, e.clase_id, e.posicion
    from (select l.id, l.clase_id, l.cliente_id,
                 row_number() over (partition by l.clase_id order by (l.contrato_fijo_id is null), l.creado_el, l.id)::integer as posicion
            from public.lista_espera l) e
   where e.cliente_id = public.auth_cliente_id();

create or replace function public._generar_reservas_automaticas(p_contrato_id uuid, p_incluir_pasadas boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_contrato public.contratos%rowtype;
  v_desde    date;
  c          record;
  v_ocupadas integer;
  v_revivir  uuid;
  v_n        integer := 0;
begin
  select * into v_contrato from public.contratos where id = p_contrato_id;
  if not found or v_contrato.modalidad <> 'FIJO' or v_contrato.estado <> 'ACTIVO' then return 0; end if;
  v_desde := case when coalesce(p_incluir_pasadas, false) then v_contrato.fecha_inicio else greatest(v_contrato.fecha_inicio, public._hoy()) end;

  for c in
    select cl.id, cl.plazas, cl.fecha, cl.hora_inicio
      from public.clases cl
      join public.contrato_franjas f on f.contrato_id = v_contrato.id and f.plantilla_id = cl.plantilla_id
     where cl.estado = 'PROGRAMADA'
       and cl.fecha between v_desde and v_contrato.fecha_fin
       -- Bloquean: tener ya plaza, o haberla cancelado la propia alumna (decidió no ir ese día).
       -- No bloquea una cancelación "por el centro" (p. ej. al finalizar el contrato anterior): se revive.
       and not exists (select 1 from public.reservas r
                        where r.clase_id = cl.id and r.cliente_id = v_contrato.cliente_id
                          and r.estado in ('RESERVADA', 'CANCELADA_RECUPERABLE', 'CANCELADA_NO_RECUPERABLE'))
     order by cl.fecha, cl.hora_inicio
     for update of cl
  loop
    select count(*) into v_ocupadas from public.reservas where clase_id = c.id and estado = 'RESERVADA';
    if v_ocupadas >= c.plazas then
      -- 0050: sin plaza → el primero en la lista de espera de su clase fija (hasta 2 horas antes), salvo que
      -- haya salido de ella. Si se libera sitio, entra solo (ver _promover_lista_espera).
      if (c.fecha + c.hora_inicio) >= public._ahora_local() + make_interval(hours => public._horas_cierre_lista_espera())
         and not exists (select 1 from public.lista_espera_rechazos x where x.clase_id = c.id and x.cliente_id = v_contrato.cliente_id) then
        insert into public.lista_espera (clase_id, cliente_id, contrato_fijo_id)
        values (c.id, v_contrato.cliente_id, v_contrato.id)
        on conflict (clase_id, cliente_id) do update set contrato_fijo_id = excluded.contrato_fijo_id, reserva_cambio_id = null;
      end if;
      continue;
    end if;
    select r.id into v_revivir from public.reservas r
     where r.clase_id = c.id and r.cliente_id = v_contrato.cliente_id and r.estado = 'CANCELADA_CENTRO'
     order by r.cancelado_el desc nulls last, r.creado_el desc limit 1;
    if v_revivir is not null then
      update public.reservas
         set estado = 'RESERVADA', contrato_id = v_contrato.id, origen = 'AUTOMATICA', recuperacion_usada_id = null,
             cancelado_el = null, cancelado_por = null, asistencia = 'PENDIENTE'
       where id = v_revivir;
    else
      insert into public.reservas (clase_id, cliente_id, contrato_id, origen, creado_por)
      values (c.id, v_contrato.cliente_id, v_contrato.id, 'AUTOMATICA', null);
    end if;
    -- 0050: ya tiene plaza: fuera de la lista de espera de esa clase.
    delete from public.lista_espera where clase_id = c.id and cliente_id = v_contrato.cliente_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public._generar_reservas_automaticas(uuid, boolean) from public, anon, authenticated;

create or replace function public._promover_lista_espera(p_clase_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_clase    public.clases%rowtype;
  v_act      public.actividades%rowtype;
  v_libres   integer;
  v_n        integer := 0;
  e          record;
  v_reserva  public.reservas%rowtype;
  v_origen   public.clases%rowtype;
  v_contrato public.contratos%rowtype;
  v_ev       jsonb;
  v_via      text;
  v_motivo   text;
  v_reserva_id uuid;
  v_cuerpo   text;
  v_aviso_id uuid;
begin
  if coalesce(current_setting('app.sin_promocion', true), '') = '1' then return 0; end if;
  if pg_trigger_depth() > 6 then return 0; end if;  -- cadenas de cambios: nunca sin fin
  select * into v_clase from public.clases where id = p_clase_id for update;
  if not found or v_clase.estado <> 'PROGRAMADA' then return 0; end if;
  if (v_clase.fecha + v_clase.hora_inicio) < public._ahora_local() + make_interval(hours => public._horas_cierre_lista_espera()) then return 0; end if;
  if not exists (select 1 from public.lista_espera where clase_id = p_clase_id) then return 0; end if;
  select * into v_act from public.actividades where id = v_clase.actividad_id;
  -- 0039: lo que hace la lista de espera no retiene ni consume plazas retenidas (ver trg_reservas_plazas_retenidas).
  perform set_config('app.promoviendo', '1', true);

  -- 0050: primero los alumnos fijos de esa clase; después, por orden de llegada.
  for e in select * from public.lista_espera where clase_id = p_clase_id order by (contrato_fijo_id is null), creado_el, id loop
    -- 0039: las plazas retenidas por el equipo no se dan desde la lista de espera hasta que se publican los cambios.
    select v_clase.plazas - coalesce(v_clase.plazas_retenidas, 0) - count(*) into v_libres from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA';
    exit when v_libres <= 0;
    -- Cada entrada por separado: si una falla, se quita de la lista y se sigue con la siguiente.
    begin
      -- Se quita antes de reservar: así ni se procesa dos veces ni la ven los disparadores anidados.
      delete from public.lista_espera where id = e.id;
      v_motivo := null;
      v_cuerpo := null;
      if e.contrato_fijo_id is not null then
        -- 0050: alumno fijo de esta clase. Entra con su horario fijo (sin mirar cupo: es su clase) y puede
        -- cancelar sin perder la clase (no la ha pedido él). Si ya no le toca, sale de la lista sin aviso.
        select * into v_contrato from public.contratos where id = e.contrato_fijo_id;
        if not found or v_contrato.estado <> 'ACTIVO' or v_clase.fecha not between v_contrato.fecha_inicio and v_contrato.fecha_fin
           or not exists (select 1 from public.contrato_franjas f where f.contrato_id = v_contrato.id and f.plantilla_id = v_clase.plantilla_id)
           or exists (select 1 from public.reservas r where r.clase_id = p_clase_id and r.cliente_id = e.cliente_id and r.estado = 'RESERVADA') then
          continue;
        end if;
        insert into public.reservas (clase_id, cliente_id, contrato_id, origen, cancelacion_libre, creado_por)
        values (p_clase_id, e.cliente_id, v_contrato.id, 'AUTOMATICA', true, null)
        returning id into v_reserva_id;
        v_via := 'FIJO';
        v_cuerpo := 'Se ha liberado sitio en tu clase fija y ya estás apuntado/a. Si no puedes venir, cancélala desde la app: no pierdes la clase.';
      elsif e.reserva_cambio_id is not null then
        select * into v_reserva from public.reservas where id = e.reserva_cambio_id and cliente_id = e.cliente_id for update;
        v_motivo := public._motivo_no_cambio(v_reserva, v_clase);
        if v_motivo is null then
          select * into v_origen from public.clases where id = v_reserva.clase_id;
          -- 0022: la reserva antigua queda cancelada (sin recuperación: la clase se cambia, no se pierde) y se
          -- crea una nueva en esta clase con los mismos derechos. Así la antigua sigue constando en su clase
          -- fija y el mantenimiento nocturno no vuelve a apuntarle allí.
          update public.reservas
             set estado = 'CANCELADA_RECUPERABLE', cancelado_el = now(), cancelado_por = null, recuperacion_usada_id = null
           where id = v_reserva.id;
          insert into public.reservas (clase_id, cliente_id, contrato_id, origen, recuperacion_usada_id, creado_por)
          values (p_clase_id, e.cliente_id, v_reserva.contrato_id,
                  case v_reserva.origen when 'AUTOMATICA' then 'CLIENTE'::public.origen_reserva when 'MANUAL' then 'CLIENTE'::public.origen_reserva else v_reserva.origen end,
                  v_reserva.recuperacion_usada_id, null)
          returning id into v_reserva_id;  -- el disparador de aforo vigila la plaza
          if v_reserva.recuperacion_usada_id is not null then
            update public.recuperaciones set usada_en_reserva_id = v_reserva_id where id = v_reserva.recuperacion_usada_id;
          end if;
          v_via := 'CAMBIO';
          v_cuerpo := format('Se ha liberado una plaza y te hemos apuntado desde la lista de espera. Tu clase del %s a las %s queda cambiada por esta.',
                             to_char(v_origen.fecha, 'DD/MM'), to_char(v_origen.hora_inicio, 'HH24:MI'));
        end if;
      else
        v_ev := public._evaluar_reserva(p_clase_id, e.cliente_id, false);
        if (v_ev->>'ok')::boolean then
          v_via := v_ev->>'via';
          v_contrato := public._contrato_activo(e.cliente_id, v_clase.fecha);
          insert into public.reservas (clase_id, cliente_id, contrato_id, origen, recuperacion_usada_id, creado_por)
          values (p_clase_id, e.cliente_id, v_contrato.id,
                  case v_via when 'RECUPERACION' then 'RECUPERACION'::public.origen_reserva when 'BONO' then 'BONO'::public.origen_reserva else 'CLIENTE'::public.origen_reserva end,
                  (v_ev->>'recuperacion_id')::uuid, null)
          returning id into v_reserva_id;
          if v_via = 'RECUPERACION' then
            update public.recuperaciones set estado = 'USADA', usada_en_reserva_id = v_reserva_id where id = (v_ev->>'recuperacion_id')::uuid;
          elsif v_via = 'BONO' and v_contrato.id is not null then
            update public.contratos set sesiones_restantes = coalesce(sesiones_restantes, 1) - 1 where id = v_contrato.id;
          end if;
          v_cuerpo := 'Se ha liberado una plaza y te hemos apuntado desde la lista de espera. ' || coalesce(v_ev->>'mensaje', '');
        elsif v_ev->>'codigo' = 'YA_RESERVADA' then
          -- Ya tenía plaza (p. ej. se la dio el personal): sin aviso.
          continue;
        else
          v_motivo := v_ev->>'motivo';
        end if;
      end if;

      if v_motivo is not null then
        -- No ha podido entrar: se le avisa y pasa el turno al siguiente.
        insert into public.avisos (titulo, cuerpo, destino_tipo, importante, publicado_por)
        values (format('Lista de espera: %s %s %s', v_act.nombre, to_char(v_clase.fecha, 'DD/MM'), to_char(v_clase.hora_inicio, 'HH24:MI')),
                'Se ha liberado una plaza pero no hemos podido reservártela: ' || v_motivo || ' Te hemos quitado de la lista de espera.',
                'CLIENTES', false, null)
        returning id into v_aviso_id;
        insert into public.aviso_destinatarios (aviso_id, cliente_id) values (v_aviso_id, e.cliente_id);
        insert into public.avisos_push_pendientes (aviso_id) values (v_aviso_id) on conflict do nothing;
        perform public._auditar('LISTA_ESPERA', 'clase', p_clase_id::text,
          format('%s no entra desde la lista (%s) · %s', public._nombre_cliente(e.cliente_id), v_motivo, public._desc_clase(p_clase_id)));
        continue;
      end if;

      v_n := v_n + 1;
      insert into public.avisos (titulo, cuerpo, destino_tipo, importante, publicado_por)
      values (format('¡Tienes plaza! %s %s %s', v_act.nombre, to_char(v_clase.fecha, 'DD/MM'), to_char(v_clase.hora_inicio, 'HH24:MI')),
              v_cuerpo, 'CLIENTES', true, null)
      returning id into v_aviso_id;
      insert into public.aviso_destinatarios (aviso_id, cliente_id) values (v_aviso_id, e.cliente_id);
      insert into public.avisos_push_pendientes (aviso_id) values (v_aviso_id) on conflict do nothing;
      perform public._auditar('LISTA_ESPERA', 'reserva', v_reserva_id::text,
        format('%s entra desde la lista de espera (%s) · %s', public._nombre_cliente(e.cliente_id), v_via, public._desc_clase(p_clase_id)));
    exception when others then
      -- La entrada ya se ha borrado dentro del bloque (se deshace con él); se borra fuera y se sigue.
      delete from public.lista_espera where id = e.id;
      perform public._auditar('LISTA_ESPERA', 'clase', p_clase_id::text,
        format('%s no entra desde la lista (error: %s) · %s', public._nombre_cliente(e.cliente_id), sqlerrm, public._desc_clase(p_clase_id)));
    end;
  end loop;
  perform set_config('app.promoviendo', '', true);
  return v_n;
end $$;

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
  -- 0050: si entró solo desde la lista de espera de su clase fija, cancelar nunca le hace perder la clase.
  v_recuperable := v_forzar or v_reserva.cancelacion_libre or v_min >= v_cfg.minutos_antelacion_cancelacion;
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
revoke all on function public.cancelar_reserva(uuid, boolean) from public, anon;
grant execute on function public.cancelar_reserva(uuid, boolean) to authenticated;

create or replace function public.salir_lista_espera(p_clase_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cliente_id uuid; v_n integer; v_fija boolean;
begin
  v_cliente_id := public.auth_cliente_id();
  if v_cliente_id is null then raise exception 'Solo para alumnos.' using errcode = 'insufficient_privilege'; end if;
  select contrato_fijo_id is not null into v_fija from public.lista_espera where clase_id = p_clase_id and cliente_id = v_cliente_id;
  delete from public.lista_espera where clase_id = p_clase_id and cliente_id = v_cliente_id;
  get diagnostics v_n = row_count;
  -- 0050: si era su clase fija, no se le vuelve a apuntar a esa lista.
  if coalesce(v_fija, false) then
    insert into public.lista_espera_rechazos (clase_id, cliente_id) values (p_clase_id, v_cliente_id) on conflict do nothing;
  end if;
  if v_n > 0 then
    perform public._auditar('LISTA_ESPERA', 'clase', p_clase_id::text, format('%s sale de la lista · %s', public._nombre_cliente(v_cliente_id), public._desc_clase(p_clase_id)));
  end if;
end $$;
revoke all on function public.salir_lista_espera(uuid) from public, anon;
grant execute on function public.salir_lista_espera(uuid) to authenticated;

create or replace function public.quitar_de_lista_espera(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.lista_espera%rowtype;
begin
  if public.auth_trabajador_id() is null then raise exception 'Solo para el personal.' using errcode = 'insufficient_privilege'; end if;
  perform public._exigir('RESERVAS_GESTIONAR');
  select * into e from public.lista_espera where id = p_id;
  if not found then return; end if;
  perform public._exigir_clase_mia(e.clase_id);
  delete from public.lista_espera where id = p_id;
  -- 0050: si era su clase fija, no se le vuelve a apuntar a esa lista.
  if e.contrato_fijo_id is not null then
    insert into public.lista_espera_rechazos (clase_id, cliente_id) values (e.clase_id, e.cliente_id) on conflict do nothing;
  end if;
  perform public._auditar('LISTA_ESPERA', 'clase', e.clase_id::text, format('%s quitado de la lista por el personal · %s', public._nombre_cliente(e.cliente_id), public._desc_clase(e.clase_id)));
end $$;
revoke all on function public.quitar_de_lista_espera(uuid) from public, anon;
grant execute on function public.quitar_de_lista_espera(uuid) to authenticated;

-- Ya: los alumnos fijos activos sin plaza en una clase suya completa pasan a la lista de espera.
do $$
declare k record; v_antes integer; v_despues integer;
begin
  select count(*) into v_antes from public.lista_espera where contrato_fijo_id is not null;
  for k in select id from public.contratos where estado = 'ACTIVO' and modalidad = 'FIJO' loop
    perform public._generar_reservas_automaticas(k.id);
  end loop;
  select count(*) into v_despues from public.lista_espera where contrato_fijo_id is not null;
  if v_despues > v_antes then
    perform public._auditar('MANTENIMIENTO', 'sistema', '0050', format('%s alumnos fijos apuntados a la lista de espera de su clase completa', v_despues - v_antes));
  end if;
  raise notice '0050: % alumnos fijos en la lista de espera de su clase completa.', v_despues;
end $$;
