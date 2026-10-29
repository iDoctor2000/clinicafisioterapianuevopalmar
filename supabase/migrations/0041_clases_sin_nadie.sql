-- =============================================================================
-- 0041_clases_sin_nadie.sql · Una clase sin nadie apuntado se puede quitar, aunque alguien se apuntara y lo cancelara
--
--   Caso real: la franja repetida del jueves 10:30 se eliminó (0038), pero una de sus clases se quedó
--   en el calendario porque tenía una reserva CANCELADA (nadie apuntado, pero "historial"), y la app no
--   dejaba ni borrarla ni cancelarla sin más.
--
--   Regla general: lo que cuenta es si hay alguien APUNTADO (reserva RESERVADA). Sin nadie apuntado:
--   - cancelar la clase la borra (las reservas canceladas se van con ella; las recuperaciones se conservan);
--   - `eliminar_clase` vale para cualquier clase sin nadie apuntado (programada o cancelada);
--   - al cambiar una franja, esas clases se recrean con el horario nuevo en vez de conservarse;
--   - limpieza: clases futuras sin nadie apuntado de franjas eliminadas, desactivadas o fuera de vigencia.
--   Idempotente.
-- =============================================================================

create or replace function public._cancelar_clase(p_clase_id uuid, p_motivo text, p_clase_alternativa_id uuid default null, p_avisar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
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
  v_festivo   boolean;
  v_recupera  boolean := false;
begin
  select * into v_clase from public.clases where id = p_clase_id for update;
  if not found then raise exception 'La clase no existe.'; end if;
  if v_clase.estado = 'CANCELADA' then raise exception 'La clase ya está cancelada.'; end if;
  -- 0038/0041: una clase en la que no hay nadie apuntado no se cancela: se borra. Las reservas que alguien
  -- canceló antes se van con ella (su recuperación se conserva: la referencia queda a null).
  if not exists (select 1 from public.reservas x where x.clase_id = p_clase_id and x.estado = 'RESERVADA') then
    delete from public.lista_espera where clase_id = p_clase_id;
    delete from public.clases where id = p_clase_id;
    perform public._auditar('BORRAR_CLASE', 'clase', p_clase_id::text,
      format('%s %s %s · estaba vacía · %s', (select nombre from public.actividades where id = v_clase.actividad_id), v_clase.fecha, to_char(v_clase.hora_inicio, 'HH24:MI'), coalesce(p_motivo, '')));
    return jsonb_build_object('afectados', 0, 'aviso', null, 'borrada', true);
  end if;
  select * into v_act from public.actividades where id = v_clase.actividad_id;
  -- Festivo / día de cierre: no se da recuperación nueva.
  v_festivo := exists (select 1 from public.dias_cierre where fecha = v_clase.fecha);
  -- 0021: una clase cancelada no tiene lista de espera.
  delete from public.lista_espera where clase_id = p_clase_id;

  for r in select * from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA' loop
    v_afectados := v_afectados + 1;
    v_clientes := array_append(v_clientes, r.cliente_id);
    -- Lo gastado en esta clase se devuelve siempre.
    if r.origen = 'RECUPERACION' and r.recuperacion_usada_id is not null then
      update public.recuperaciones set estado = 'DISPONIBLE', usada_en_reserva_id = null where id = r.recuperacion_usada_id;
      continue;
    end if;
    if r.origen = 'BONO' and r.contrato_id is not null then
      update public.contratos set sesiones_restantes = coalesce(sesiones_restantes, 0) + 1 where id = r.contrato_id;
      continue;
    end if;
    if r.origen = 'CLASE_SUELTA' then continue; end if;
    if v_festivo then continue; end if;
    v_recupera := true;
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
    v_alt_txt := case
      when v_festivo then ' Es día de cierre: esta clase no se recupera.'
      when v_alt.id is not null then format(' Se realizará una clase alternativa el %s a las %s: puedes reservarla con la recuperación que te hemos añadido.', v_alt.fecha, to_char(v_alt.hora_inicio, 'HH24:MI'))
      when v_recupera then ' Te hemos añadido una recuperación para que la uses cuando quieras.'
      else '' end;
    insert into public.avisos (titulo, cuerpo, destino_tipo, destino_clase_id, importante, publicado_por)
    values (format('Clase cancelada: %s %s %s', v_act.nombre, to_char(v_clase.fecha, 'DD/MM'), to_char(v_clase.hora_inicio, 'HH24:MI')),
            (case when coalesce(p_motivo, '') <> '' then p_motivo || '.' else 'La clase queda cancelada.' end) || v_alt_txt,
            'CLASE', p_clase_id, true, auth.uid())
    returning id into v_aviso_id;
    insert into public.aviso_destinatarios (aviso_id, cliente_id)
    select v_aviso_id, c from unnest(v_clientes) c group by c;
  end if;

  perform public._auditar('CANCELAR_CLASE', 'clase', p_clase_id::text,
    format('%s · %s afectados · %s%s', public._desc_clase(p_clase_id), v_afectados, coalesce(p_motivo, ''), case when v_festivo then ' (festivo, sin recuperación)' else '' end));
  return jsonb_build_object('afectados', v_afectados, 'aviso', v_aviso_id);
end $$;

create or replace function public.eliminar_clase(p_clase_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_clase public.clases%rowtype;
begin
  perform public._exigir('CLASES_CREAR_CANCELAR');
  perform public._exigir_clase_mia(p_clase_id);
  select * into v_clase from public.clases where id = p_clase_id for update;
  if not found then raise exception 'La clase no existe.'; end if;
  -- 0041: se puede eliminar cualquier clase sin nadie apuntado (programada o cancelada), aunque alguien se apuntara y lo cancelara.
  if exists (select 1 from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA') then
    raise exception 'Esta clase tiene alumnos apuntados: para quitarla, cancélala (se les avisa y se les da recuperación).';
  end if;
  if v_clase.estado = 'PROGRAMADA' and exists (select 1 from public.reservas r where r.clase_id = p_clase_id and r.asistencia = 'ASISTE') then
    raise exception 'Esta clase ya se dio: se conserva en el historial.';
  end if;
  delete from public.lista_espera where clase_id = p_clase_id;
  delete from public.clases where id = p_clase_id;
  perform public._auditar('BORRAR_CLASE', 'clase', p_clase_id::text,
    format('%s %s %s · sin nadie apuntado (%s)', (select nombre from public.actividades where id = v_clase.actividad_id), v_clase.fecha, to_char(v_clase.hora_inicio, 'HH24:MI'), lower(v_clase.estado::text)));
end $$;

create or replace function public.plantilla_aplicar_cambios(p_plantilla_id uuid, p_mover boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hoy         date := public._hoy();
  v_ahora       timestamp := public._ahora_local();
  v_cfg         public.config_centro%rowtype;
  v_pl          public.plantillas_clase%rowtype;
  v_conservadas integer := 0;
  v_canceladas  integer := 0;
  v_reactivadas integer := 0;
  v_movidas     integer := 0;
  v_aviso       uuid;
  v_nueva_fecha date;
  v_act         public.actividades%rowtype;
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

  -- Clases que aún no han empezado sin nadie apuntado, o solo con reservas automáticas (horario fijo, que se
  -- regeneran): se eliminan para recrearlas. 0041: las reservas que alguien canceló no retienen la clase.
  perform set_config('app.sin_promocion', '1', true);
  with borrables as (
    select c.id from public.clases c
     where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) > v_ahora
       and not exists (select 1 from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA' and r.origen <> 'AUTOMATICA')
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

  -- 0038: si se pide, las clases con alumnos se mueven al día y hora nuevos de la franja (y se les avisa).
  if coalesce(p_mover, false) then
    select * into v_act from public.actividades where id = v_pl.actividad_id;
    for k in
      select c.* from public.clases c
       where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) > v_ahora
         and (c.hora_inicio <> v_pl.hora_inicio or extract(isodow from c.fecha) <> v_pl.dia_semana)
         and exists (select 1 from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA')
       order by c.fecha, c.hora_inicio
    loop
      v_nueva_fecha := k.fecha + (v_pl.dia_semana - extract(isodow from k.fecha)::integer);
      -- Al día nuevo de la misma semana; si ya habría pasado, se queda donde está.
      if (v_nueva_fecha + v_pl.hora_inicio) <= v_ahora then continue; end if;
      if exists (select 1 from public.dias_cierre dc where dc.fecha = v_nueva_fecha) then continue; end if;
      -- Si en el hueco nuevo ya hay una clase vacía de esta franja, se quita (la movida ocupa su sitio).
      delete from public.clases x where x.plantilla_id = p_plantilla_id and x.fecha = v_nueva_fecha and x.id <> k.id
         and not exists (select 1 from public.reservas r where r.clase_id = x.id);
      if exists (select 1 from public.clases x where x.plantilla_id = p_plantilla_id and x.fecha = v_nueva_fecha and x.id <> k.id) then continue; end if;
      update public.clases set fecha = v_nueva_fecha, hora_inicio = v_pl.hora_inicio where id = k.id;
      insert into public.avisos (titulo, cuerpo, destino_tipo, destino_clase_id, importante, publicado_por)
      values (format('Cambio de hora: %s %s', v_act.nombre, to_char(k.fecha, 'DD/MM')),
              format('Tu clase de %s del %s a las %s pasa al %s a las %s. Sigues apuntado/a; si no puedes venir, cancélala desde la app.',
                     v_act.nombre, to_char(k.fecha, 'DD/MM'), to_char(k.hora_inicio, 'HH24:MI'), to_char(v_nueva_fecha, 'DD/MM'), to_char(v_pl.hora_inicio, 'HH24:MI')),
              'CLASE', k.id, true, auth.uid())
      returning id into v_aviso;
      insert into public.aviso_destinatarios (aviso_id, cliente_id)
      select v_aviso, r.cliente_id from public.reservas r where r.clase_id = k.id and r.estado = 'RESERVADA' group by r.cliente_id;
      v_avisos := array_append(v_avisos, v_aviso);
      v_movidas := v_movidas + 1;
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
    format('clases futuras recreadas; %s conservan día y hora; %s movidas con sus alumnos; %s canceladas (%s alumnos avisados); %s reactivadas',
           greatest(0, v_conservadas - v_movidas), v_movidas, v_canceladas, v_afectados, v_reactivadas));
  return jsonb_build_object('conservadas', greatest(0, v_conservadas - v_movidas), 'movidas', v_movidas, 'canceladas', v_canceladas, 'afectados', v_afectados,
                            'reactivadas', v_reactivadas, 'avisos', to_jsonb(v_avisos));
end $$;

-- Limpieza: clases futuras programadas sin nadie apuntado que ya no corresponden a ninguna franja vigente.
do $$
declare v_n integer;
begin
  with b as (
    delete from public.clases c
     where c.estado = 'PROGRAMADA' and c.plantilla_id is not null and (c.fecha + c.hora_inicio) > public._ahora_local()
       and not exists (select 1 from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA')
       and exists (select 1 from public.plantillas_clase p where p.id = c.plantilla_id
                    and (p.eliminada_el is not null or not p.activa
                         or (p.vigencia_desde is not null and c.fecha < p.vigencia_desde)
                         or (p.vigencia_hasta is not null and c.fecha > p.vigencia_hasta)
                         or extract(isodow from c.fecha) <> p.dia_semana or c.hora_inicio <> p.hora_inicio))
    returning c.id
  ) select count(*) into v_n from b;
  if v_n > 0 then
    perform public._auditar('BORRAR_CLASE', 'clase', '-', format('%s clases futuras sin nadie apuntado de franjas eliminadas, desactivadas o cambiadas · 0041', v_n));
  end if;
  raise notice '0041: % clases futuras sin nadie apuntado de franjas que ya no corresponden borradas.', v_n;
end $$;
