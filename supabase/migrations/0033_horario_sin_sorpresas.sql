-- =============================================================================
-- 0033_horario_sin_sorpresas.sql · Cambiar el horario no cancela clases por error, y lo cancelado se puede reactivar
--
--   Lo que pasó (27/10/2026): al preparar el horario de noviembre se editaron franjas que ya
--   estaban en uso poniéndoles "Vigente desde 1 de noviembre". La app entendió que esas franjas
--   no se imparten antes del 1 de noviembre y canceló sus clases de esta semana avisando a los
--   alumnos (y les dio recuperación). Además:
--     · Canceló también una clase de HOY que ya se había dado (miraba el día, no la hora).
--     · Al deshacer el cambio, la clase cancelada se quedaba cancelada: no había forma de volver atrás.
--
--   Ahora, para todas las franjas y clases:
--     1. Cambiar una franja nunca toca las clases que ya han empezado (tampoco las de hoy ya dadas).
--     2. Si un cambio de franja hace que una clase cancelada por "deja de impartirse" vuelva a
--        tocar (por ejemplo, se deshace el cambio), la clase se reactiva sola con sus alumnos.
--     3. Botón "Reactivar clase" para cualquier clase cancelada (por error o porque al final se da):
--        vuelve a estar programada, sus alumnos vuelven a tener su plaza, se retira la recuperación
--        que se les dio por la cancelación (si no la han usado), se vuelve a gastar lo que se les
--        devolvió (sesión de bono o recuperación usada), desaparece el aviso de "Clase cancelada" y,
--        si la clase es futura, se les avisa de que se mantiene.
--     4. Si un alumno vuelve a tener plaza en una clase, la recuperación que salió de esa misma
--        plaza se retira (amplía la 0032 al caso de reactivar).
--     5. Una vez: se reactivan las clases canceladas por un cambio de horario cuando ya se habían
--        dado, y las futuras cuya franja vuelve a impartirse ese día.
--   Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Volver a tener plaza retira la recuperación que salió de esa clase (también la de la propia plaza)
-- -----------------------------------------------------------------------------
create or replace function public._anular_recuperacion_misma_clase(p_cliente_id uuid, p_clase_id uuid, p_excepto uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with b as (
    delete from public.recuperaciones x
     where x.cliente_id = p_cliente_id and x.estado = 'DISPONIBLE' and x.id is distinct from p_excepto
       and x.reserva_origen_id in (select r.id from public.reservas r where r.clase_id = p_clase_id and r.cliente_id = p_cliente_id)
    returning x.id
  ) select count(*) into v_n from b;
  if v_n > 0 then
    perform public._auditar('ANULAR_RECUPERACION', 'cliente', p_cliente_id::text,
      format('%s · %s: vuelve a tener plaza en la clase; la recuperación que le dio queda anulada', public._nombre_cliente(p_cliente_id), public._desc_clase(p_clase_id)));
  end if;
  return v_n;
end $$;
revoke all on function public._anular_recuperacion_misma_clase(uuid, uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Reactivar una clase cancelada
-- -----------------------------------------------------------------------------
create or replace function public._reactivar_clase(p_clase_id uuid, p_avisar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_clase      public.clases%rowtype;
  v_act        public.actividades%rowtype;
  r            public.reservas%rowtype;
  v_vuelven    integer := 0;
  v_sin_plaza  integer := 0;
  v_clientes   uuid[] := '{}';
  v_aviso_id   uuid;
  v_futura     boolean;
begin
  select * into v_clase from public.clases where id = p_clase_id for update;
  if not found then raise exception 'La clase no existe.'; end if;
  if v_clase.estado <> 'CANCELADA' then raise exception 'La clase no está cancelada.'; end if;
  select * into v_act from public.actividades where id = v_clase.actividad_id;
  v_futura := (v_clase.fecha + v_clase.hora_inicio) > public._ahora_local();

  update public.clases
     set estado = 'PROGRAMADA', motivo_cancelacion = null, clase_alternativa_id = null, cancelado_el = null, cancelado_por = null
   where id = p_clase_id;

  -- Las plazas que quitó la cancelación (mismo instante que la cancelación de la clase).
  for r in
    select * from public.reservas
     where clase_id = p_clase_id and estado = 'CANCELADA_CENTRO'
       and v_clase.cancelado_el is not null and cancelado_el = v_clase.cancelado_el
     order by creado_el
  loop
    -- Lo que se le devolvió al cancelar se vuelve a gastar; si ya no lo tiene, no recupera la plaza.
    if r.origen = 'RECUPERACION' and r.recuperacion_usada_id is not null
       and not exists (select 1 from public.recuperaciones where id = r.recuperacion_usada_id and estado = 'DISPONIBLE') then
      v_sin_plaza := v_sin_plaza + 1; continue;
    end if;
    if r.origen = 'BONO' and r.contrato_id is not null
       and coalesce((select sesiones_restantes from public.contratos where id = r.contrato_id), 0) < 1 then
      v_sin_plaza := v_sin_plaza + 1; continue;
    end if;
    -- (El disparador de 0032 retira la recuperación que le dio la cancelación, si no la ha usado.)
    update public.reservas set estado = 'RESERVADA', cancelado_el = null, cancelado_por = null where id = r.id;
    if r.origen = 'RECUPERACION' and r.recuperacion_usada_id is not null then
      update public.recuperaciones set estado = 'USADA', usada_en_reserva_id = r.id where id = r.recuperacion_usada_id;
    elsif r.origen = 'BONO' and r.contrato_id is not null then
      update public.contratos set sesiones_restantes = sesiones_restantes - 1 where id = r.contrato_id;
    end if;
    v_vuelven := v_vuelven + 1;
    v_clientes := array_append(v_clientes, r.cliente_id);
  end loop;

  -- El aviso de "Clase cancelada" ya no vale.
  delete from public.avisos where destino_tipo = 'CLASE' and destino_clase_id = p_clase_id and titulo like 'Clase cancelada:%';

  if coalesce(p_avisar, true) and v_futura and v_vuelven > 0 then
    insert into public.avisos (titulo, cuerpo, destino_tipo, destino_clase_id, importante, publicado_por)
    values (format('Clase de nuevo programada: %s %s %s', v_act.nombre, to_char(v_clase.fecha, 'DD/MM'), to_char(v_clase.hora_inicio, 'HH24:MI')),
            'Al final la clase se mantiene: sigues apuntado/a. Si por la cancelación te dimos una recuperación, se ha retirado. Perdona las molestias.',
            'CLASE', p_clase_id, true, auth.uid())
    returning id into v_aviso_id;
    insert into public.aviso_destinatarios (aviso_id, cliente_id)
    select v_aviso_id, c from unnest(v_clientes) c group by c;
  end if;

  perform public._auditar('REACTIVAR_CLASE', 'clase', p_clase_id::text,
    format('%s · %s alumnos vuelven a tener plaza%s', public._desc_clase(p_clase_id), v_vuelven,
           case when v_sin_plaza > 0 then format(' (%s no: ya habían gastado lo que se les devolvió)', v_sin_plaza) else '' end));
  return jsonb_build_object('vuelven', v_vuelven, 'sin_plaza', v_sin_plaza, 'aviso', v_aviso_id);
end $$;
revoke all on function public._reactivar_clase(uuid, boolean) from public, anon, authenticated;

create or replace function public.reactivar_clase(p_clase_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_res jsonb;
begin
  perform public._exigir('CLASES_CREAR_CANCELAR');
  perform public._exigir_clase_mia(p_clase_id);
  v_res := public._reactivar_clase(p_clase_id, true);
  -- Los alumnos de horario fijo que no tenían plaza (p. ej. la cancelación les pilló sin ella) se apuntan si hay sitio.
  perform public._generar_reservas_automaticas(k.contrato_id)
     from (select distinct f.contrato_id from public.contrato_franjas f join public.clases c on c.plantilla_id = f.plantilla_id where c.id = p_clase_id) k;
  return v_res;
end $$;
comment on function public.reactivar_clase(uuid) is
  'Vuelve a programar una clase cancelada: sus alumnos recuperan la plaza, se retira la recuperación dada por la cancelación y se les avisa si la clase es futura.';
revoke all on function public.reactivar_clase(uuid) from public, anon;
grant execute on function public.reactivar_clase(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. plantilla_aplicar_cambios: no toca lo que ya ha empezado y reactiva lo que vuelve a tocar
-- -----------------------------------------------------------------------------
create or replace function public.plantilla_aplicar_cambios(p_plantilla_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hoy         date := public._hoy();
  v_ahora       timestamp := public._ahora_local();
  v_cfg         public.config_centro%rowtype;
  v_pl          public.plantillas_clase%rowtype;
  v_conservadas integer := 0;
  v_canceladas  integer := 0;
  v_reactivadas integer := 0;
  v_afectados   integer := 0;
  v_avisos      uuid[] := '{}';
  v_res         jsonb;
  k             record;
begin
  perform public._exigir('HORARIOS_GESTIONAR');
  if public.auth_ambito() = 'SUS_CLASES' then
    raise exception 'Con ámbito "Solo sus clases" no se puede modificar el horario.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_cfg from public.config_centro limit 1;
  select * into v_pl from public.plantillas_clase where id = p_plantilla_id;
  if not found then raise exception 'La franja no existe.'; end if;

  -- Clases que aún no han empezado sin reservas, o solo con automáticas: se eliminan para recrearlas.
  perform set_config('app.sin_promocion', '1', true);
  with borrables as (
    select c.id from public.clases c
     where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) > v_ahora
       and not exists (select 1 from public.reservas r where r.clase_id = c.id and not (r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA'))
  ), reservas_fuera as (
    delete from public.reservas r where r.clase_id in (select id from borrables) returning r.id
  )
  delete from public.clases c where c.id in (select id from borrables);
  perform set_config('app.sin_promocion', '', true);

  -- Las que tienen alumnos y la franja ya no se imparte ese día: se cancelan avisando.
  for k in
    select c.id from public.clases c
     where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) > v_ahora
       and (not v_pl.activa
            or (v_pl.vigencia_desde is not null and c.fecha < v_pl.vigencia_desde)
            or (v_pl.vigencia_hasta is not null and c.fecha > v_pl.vigencia_hasta))
     order by c.fecha, c.hora_inicio
  loop
    v_res := public._cancelar_clase(k.id, 'Esta clase deja de impartirse', null, true);
    v_canceladas := v_canceladas + 1;
    v_afectados := v_afectados + (v_res ->> 'afectados')::integer;
    if v_res ->> 'aviso' is not null then v_avisos := array_append(v_avisos, (v_res ->> 'aviso')::uuid); end if;
  end loop;

  -- 0033: las que se cancelaron por dejar de impartirse y con este cambio vuelven a tocar, se reactivan.
  if v_pl.activa and v_pl.eliminada_el is null then
    for k in
      select c.id from public.clases c
       where c.plantilla_id = p_plantilla_id and c.estado = 'CANCELADA' and c.motivo_cancelacion = 'Esta clase deja de impartirse'
         and (c.fecha + c.hora_inicio) > v_ahora
         and (v_pl.vigencia_desde is null or c.fecha >= v_pl.vigencia_desde)
         and (v_pl.vigencia_hasta is null or c.fecha <= v_pl.vigencia_hasta)
         and not exists (select 1 from public.dias_cierre dc where dc.fecha = c.fecha)
       order by c.fecha, c.hora_inicio
    loop
      v_res := public._reactivar_clase(k.id, true);
      v_reactivadas := v_reactivadas + 1;
      if v_res ->> 'aviso' is not null then v_avisos := array_append(v_avisos, (v_res ->> 'aviso')::uuid); end if;
    end loop;
  end if;

  -- El resto con alumnos mantiene día y hora y toma la actividad, monitor, duración y plazas nuevas.
  update public.clases c
     set actividad_id = v_pl.actividad_id, monitor_id = v_pl.monitor_id, duracion_min = v_pl.duracion_min,
         plazas = greatest(v_pl.plazas, (select count(*) from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA')::integer)
   where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) > v_ahora;

  perform public._generar_clases(v_hoy, v_hoy + coalesce(v_cfg.dias_generacion_clases, 70));
  for k in select id from public.contratos where estado = 'ACTIVO' and modalidad = 'FIJO' loop
    perform public._generar_reservas_automaticas(k.id);
  end loop;
  select count(*) into v_conservadas from public.clases c
   where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) > v_ahora
     and exists (select 1 from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA' and r.origen <> 'AUTOMATICA');

  perform public._auditar('EDITAR_HORARIO', 'plantilla', p_plantilla_id::text,
    format('clases futuras recreadas; %s conservan día y hora; %s canceladas (%s alumnos avisados); %s reactivadas',
           v_conservadas, v_canceladas, v_afectados, v_reactivadas));
  return jsonb_build_object('conservadas', v_conservadas, 'canceladas', v_canceladas, 'afectados', v_afectados,
                            'reactivadas', v_reactivadas, 'avisos', to_jsonb(v_avisos));
end $$;

-- -----------------------------------------------------------------------------
-- 4. Una vez: lo que se canceló por un cambio de horario y no debía
-- -----------------------------------------------------------------------------
do $$
declare k record; v_res jsonb; v_pasadas integer := 0; v_futuras integer := 0;
begin
  for k in
    select c.id, (c.fecha + c.hora_inicio) < (c.cancelado_el at time zone 'Europe/Madrid') as ya_dada
      from public.clases c
      left join public.plantillas_clase p on p.id = c.plantilla_id
     where c.estado = 'CANCELADA' and c.motivo_cancelacion = 'Esta clase deja de impartirse'
       and (
         -- Se canceló cuando ya se había dado.
         (c.fecha + c.hora_inicio) < (c.cancelado_el at time zone 'Europe/Madrid')
         -- Es futura y su franja vuelve a impartirse ese día.
         or ((c.fecha + c.hora_inicio) > public._ahora_local() and p.activa and p.eliminada_el is null
             and (p.vigencia_desde is null or c.fecha >= p.vigencia_desde)
             and (p.vigencia_hasta is null or c.fecha <= p.vigencia_hasta)
             and not exists (select 1 from public.dias_cierre dc where dc.fecha = c.fecha))
       )
     order by c.fecha, c.hora_inicio
  loop
    v_res := public._reactivar_clase(k.id, not k.ya_dada);
    if k.ya_dada then v_pasadas := v_pasadas + 1; else v_futuras := v_futuras + 1; end if;
    -- Su aviso de "se mantiene" sale por el móvil la próxima vez que alguien del equipo abra la app.
    if v_res ->> 'aviso' is not null then
      insert into public.avisos_push_pendientes (aviso_id) values ((v_res ->> 'aviso')::uuid) on conflict do nothing;
    end if;
  end loop;
  raise notice 'Clases reactivadas: % ya dadas, % futuras', v_pasadas, v_futuras;
end $$;
