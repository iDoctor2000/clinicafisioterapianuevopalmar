-- =============================================================================
-- 0038_horario_entrega_1.sql · Horario: quién lo gestiona, clases vacías y mover clases con sus alumnos
--
--   1. Permiso "Gestiona el horario y las clases" (`trabajadores.gestiona_horario`), explícito como
--      el de finanzas: el rol ADMIN ya NO incluye HORARIOS_GESTIONAR ni CLASES_CREAR_CANCELAR. Solo
--      quien lo tiene puede dárselo a otro, y nunca puede quedarse nadie sin él. Arranca con las
--      mismas personas que ven las finanzas.
--   2. Cancelar una clase en la que no hay nadie la borra (no hay a quién avisar ni nada que
--      guardar). `eliminar_clase()` borra una clase cancelada sin alumnos. Limpieza de las que hay.
--   3. Al cambiar el día o la hora de una franja, `plantilla_aplicar_cambios(..., p_mover => true)`
--      mueve también las clases ya programadas con sus alumnos y les avisa.
--   4. Franjas repetidas (misma actividad, día y hora, sin alumnos fijos y sin clases con alumnos):
--      se eliminan, y sus clases vacías con ellas.
--   Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permiso de horario
-- -----------------------------------------------------------------------------
alter table public.trabajadores add column if not exists gestiona_horario boolean not null default false;
comment on column public.trabajadores.gestiona_horario is 'Gestiona el horario y las clases (franjas, clases extraordinarias, cancelar y reactivar). Explícito: el rol ADMIN no lo incluye.';

create or replace function public.gestiona_horario()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trabajadores t where t.user_id = auth.uid() and t.activo and t.gestiona_horario)
$$;
comment on function public.gestiona_horario() is 'true si el usuario actual es un trabajador activo que gestiona el horario y las clases.';
revoke all on function public.gestiona_horario() from public, anon;
grant execute on function public.gestiona_horario() to authenticated;

-- Los dos permisos del horario ya no los da el rol ADMIN ni la lista de permisos: solo gestiona_horario.
create or replace function public.tiene_permiso(p_permiso public.permiso)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.trabajadores t
     where t.user_id = auth.uid()
       and t.activo
       and case when p_permiso in ('HORARIOS_GESTIONAR', 'CLASES_CREAR_CANCELAR') then t.gestiona_horario
                else t.rol = 'ADMIN' or exists (select 1 from public.trabajador_permisos p where p.trabajador_id = t.id and p.permiso = p_permiso) end
  )
$$;
comment on function public.tiene_permiso(public.permiso) is 'true si el usuario es ADMIN o tiene el permiso; los del horario solo con gestiona_horario (0038). false si no es trabajador.';

create or replace function public.trg_trabajadores_horario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- sistema (editor SQL): sin límites
  if tg_op = 'INSERT' then
    if new.gestiona_horario and not public.gestiona_horario() then new.gestiona_horario := false; end if;
    return new;
  end if;
  if new.gestiona_horario is distinct from old.gestiona_horario then
    if not public.gestiona_horario() then
      new.gestiona_horario := old.gestiona_horario; -- se conserva en silencio
    elsif not new.gestiona_horario and not exists (
      select 1 from public.trabajadores t where t.gestiona_horario and t.activo and t.id <> old.id
    ) then
      raise exception 'Tiene que quedar al menos una persona que gestione el horario.' using errcode = 'check_violation';
    end if;
  end if;
  if old.gestiona_horario and old.activo and not new.activo and new.gestiona_horario and not exists (
    select 1 from public.trabajadores t where t.gestiona_horario and t.activo and t.id <> old.id
  ) then
    raise exception 'Tiene que quedar al menos una persona activa que gestione el horario.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trabajadores_horario on public.trabajadores;
create trigger trabajadores_horario before insert or update on public.trabajadores
  for each row execute function public.trg_trabajadores_horario();

-- Arranque: las mismas personas que ven las finanzas (si aún no lo tiene nadie).
update public.trabajadores set gestiona_horario = true
 where ve_finanzas and activo and not exists (select 1 from public.trabajadores where gestiona_horario);

-- -----------------------------------------------------------------------------
-- 2. Clases vacías: cancelar las borra; eliminar_clase para las ya canceladas
-- -----------------------------------------------------------------------------
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
  -- 0038: una clase en la que no hay nadie (ni reservas, ni lista de espera que valga la pena) no se cancela: se borra.
  if not exists (select 1 from public.reservas x where x.clase_id = p_clase_id) then
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
  if v_clase.estado <> 'CANCELADA' then raise exception 'Solo se puede eliminar una clase cancelada. Si quieres quitarla, cancélala.'; end if;
  if exists (select 1 from public.reservas where clase_id = p_clase_id) then
    raise exception 'Esta clase tuvo alumnos: se conserva en el historial. Si al final se da, usa «Reactivar clase».';
  end if;
  delete from public.lista_espera where clase_id = p_clase_id;
  delete from public.clases where id = p_clase_id;
  perform public._auditar('BORRAR_CLASE', 'clase', p_clase_id::text,
    format('%s %s %s · cancelada y vacía', (select nombre from public.actividades where id = v_clase.actividad_id), v_clase.fecha, to_char(v_clase.hora_inicio, 'HH24:MI')));
end $$;
comment on function public.eliminar_clase(uuid) is 'Borra una clase cancelada en la que no hubo nadie (0038).';
revoke all on function public.eliminar_clase(uuid) from public, anon;
grant execute on function public.eliminar_clase(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. plantilla_aplicar_cambios con p_mover (la firma de un parámetro se quita: serían ambiguas)
-- -----------------------------------------------------------------------------
drop function if exists public.plantilla_aplicar_cambios(uuid);
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
revoke all on function public.plantilla_aplicar_cambios(uuid, boolean) from public, anon;
grant execute on function public.plantilla_aplicar_cambios(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Limpieza: franjas repetidas sin alumnos y clases canceladas vacías
-- -----------------------------------------------------------------------------
do $$
declare r record; v_franjas integer := 0; v_clases integer := 0;
begin
  -- Franjas repetidas: misma actividad, día y hora que otra activa más antigua, sin fijos y sin clases con alumnos.
  for r in
    select p.id from public.plantillas_clase p
     where p.activa and p.eliminada_el is null
       and exists (select 1 from public.plantillas_clase q
                    where q.id <> p.id and q.activa and q.eliminada_el is null
                      and q.dia_semana = p.dia_semana and q.hora_inicio = p.hora_inicio and q.actividad_id = p.actividad_id
                      and q.creado_el < p.creado_el)
       and not exists (select 1 from public.contrato_franjas f join public.contratos k on k.id = f.contrato_id where f.plantilla_id = p.id and k.estado = 'ACTIVO')
       and not exists (select 1 from public.clases c join public.reservas x on x.clase_id = c.id where c.plantilla_id = p.id and x.estado = 'RESERVADA')
  loop
    delete from public.lista_espera e using public.clases c where c.id = e.clase_id and c.plantilla_id = r.id;
    delete from public.clases c where c.plantilla_id = r.id and not exists (select 1 from public.reservas x where x.clase_id = c.id);
    update public.plantillas_clase set activa = false, eliminada_el = now() where id = r.id;
    perform public._auditar('ELIMINAR_FRANJA', 'plantilla', r.id::text, 'franja repetida (misma actividad, día y hora que otra), sin alumnos · 0038');
    v_franjas := v_franjas + 1;
  end loop;
  -- Clases canceladas en las que no hubo nadie.
  with b as (
    delete from public.clases c
     where c.estado = 'CANCELADA' and not exists (select 1 from public.reservas x where x.clase_id = c.id)
    returning c.id
  ) select count(*) into v_clases from b;
  raise notice 'Franjas repetidas eliminadas: %, clases canceladas vacías borradas: %', v_franjas, v_clases;
end $$;
