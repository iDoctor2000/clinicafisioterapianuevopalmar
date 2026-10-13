-- =============================================================================
-- 0020_horario_y_festivos.sql · Quitar franjas cancela sus clases; los festivos no se recuperan
--
--   Decisiones del centro (octubre de 2026):
--   1. Al desactivar una franja del horario o ponerle fecha de fin, sus clases futuras que
--      tengan alumnos se CANCELAN solas (antes se quedaban en el calendario y se podían seguir
--      reservando). Cada alumno recibe aviso y una recuperación, como en cualquier
--      cancelación del centro.
--   2. Los FESTIVOS (días de cierre) NO dan recuperación, se cancele la clase como se cancele:
--      marcando el día de cierre en Ajustes o cancelándola a mano. Sí se devuelve lo que el
--      alumno hubiera gastado en esa clase (sesión de bono o recuperación usada) y se le avisa.
--      Al guardar un día de cierre, sus clases se cancelan en ese momento (no hay que esperar
--      a la noche). Antes, cancelar a mano daba recuperación y el día de cierre no: por eso
--      a una alumna le dejó recuperar el festivo y a otra no.
--   Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Cancelación interna (sin comprobar permisos): la usan cancelar_clase, los días de
--    cierre y los cambios de horario. Devuelve {afectados, aviso}.
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
  select * into v_act from public.actividades where id = v_clase.actividad_id;
  -- Festivo / día de cierre: no se da recuperación nueva.
  v_festivo := exists (select 1 from public.dias_cierre where fecha = v_clase.fecha);

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

-- cancelar_clase (la del botón "Cancelar clase"): permisos + la interna. Misma firma y resultado.
create or replace function public.cancelar_clase(p_clase_id uuid, p_motivo text, p_clase_alternativa_id uuid default null, p_avisar boolean default true)
returns integer language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir('CLASES_CREAR_CANCELAR');
  perform public._exigir_clase_mia(p_clase_id);  -- 0005: ámbito
  return (public._cancelar_clase(p_clase_id, p_motivo, p_clase_alternativa_id, p_avisar) ->> 'afectados')::integer;
end $$;
comment on function public.cancelar_clase(uuid, text, uuid, boolean) is
  'Cancela una clase por el centro: devuelve lo gastado, da recuperación (salvo en día de cierre) y avisa.';

-- -----------------------------------------------------------------------------
-- 2. Días de cierre: cancelar ya las clases programadas de esos días.
-- -----------------------------------------------------------------------------
create or replace function public._cancelar_clases_cierre()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k          record;
  v_res      jsonb;
  v_n        integer := 0;
  v_af       integer := 0;
  v_avisos   uuid[] := '{}';
begin
  for k in
    select c.id, dc.motivo from public.clases c join public.dias_cierre dc on dc.fecha = c.fecha
     where c.estado = 'PROGRAMADA' and c.fecha >= public._hoy()
     order by c.fecha, c.hora_inicio
  loop
    v_res := public._cancelar_clase(k.id, 'Día de cierre' || coalesce(': ' || nullif(trim(k.motivo), ''), ''), null, true);
    v_n := v_n + 1;
    v_af := v_af + (v_res ->> 'afectados')::integer;
    if v_res ->> 'aviso' is not null then v_avisos := array_append(v_avisos, (v_res ->> 'aviso')::uuid); end if;
  end loop;
  return jsonb_build_object('canceladas', v_n, 'afectados', v_af, 'avisos', to_jsonb(v_avisos));
end $$;

create or replace function public.cancelar_clases_cierre()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo el administrador puede cambiar los días de cierre.' using errcode = 'insufficient_privilege';
  end if;
  return public._cancelar_clases_cierre();
end $$;
comment on function public.cancelar_clases_cierre() is 'Cancela ya las clases programadas en días de cierre (sin recuperación) y avisa a sus alumnos.';

-- La tarea nocturna usa lo mismo (por si se añadió un cierre por otra vía).
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

  -- 0020: igual que al guardar los cierres en Ajustes (avisa, devuelve bonos y recuperaciones usadas, sin recuperación nueva).
  v_cierres := (public._cancelar_clases_cierre() ->> 'canceladas')::integer;

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

-- -----------------------------------------------------------------------------
-- 3. Cambios del horario: las clases futuras de una franja desactivada (o fuera de su
--    vigencia) se cancelan con aviso y recuperación. Devuelve jsonb (antes, un número).
-- -----------------------------------------------------------------------------
drop function if exists public.plantilla_aplicar_cambios(uuid);
create or replace function public.plantilla_aplicar_cambios(p_plantilla_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hoy         date := public._hoy();
  v_cfg         public.config_centro%rowtype;
  v_pl          public.plantillas_clase%rowtype;
  v_conservadas integer := 0;
  v_canceladas  integer := 0;
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

  -- Clases futuras sin reservas, o solo con automáticas: se eliminan para recrearlas.
  with borrables as (
    select c.id from public.clases c
     where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy
       and not exists (select 1 from public.reservas r where r.clase_id = c.id and not (r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA'))
  ), reservas_fuera as (
    delete from public.reservas r where r.clase_id in (select id from borrables) returning r.id
  )
  delete from public.clases c where c.id in (select id from borrables);

  -- Las que tienen alumnos y la franja ya no se imparte ese día: se cancelan avisando.
  for k in
    select c.id from public.clases c
     where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy
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

  -- El resto con alumnos mantiene día y hora y toma la actividad, monitor, duración y plazas nuevas.
  update public.clases c
     set actividad_id = v_pl.actividad_id, monitor_id = v_pl.monitor_id, duracion_min = v_pl.duracion_min,
         plazas = greatest(v_pl.plazas, (select count(*) from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA')::integer)
   where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy;
  get diagnostics v_conservadas = row_count;

  perform public._generar_clases(v_hoy, v_hoy + coalesce(v_cfg.dias_generacion_clases, 70));
  for k in select id from public.contratos where estado = 'ACTIVO' and modalidad = 'FIJO' loop
    perform public._generar_reservas_automaticas(k.id);
  end loop;
  -- Las conservadas son las que siguen con alumnos de antes (no las recién generadas).
  select count(*) into v_conservadas from public.clases c
   where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy
     and exists (select 1 from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA' and r.origen <> 'AUTOMATICA');

  perform public._auditar('EDITAR_HORARIO', 'plantilla', p_plantilla_id::text,
    format('clases futuras recreadas; %s conservan día y hora; %s canceladas (%s alumnos avisados)', v_conservadas, v_canceladas, v_afectados));
  return jsonb_build_object('conservadas', v_conservadas, 'canceladas', v_canceladas, 'afectados', v_afectados, 'avisos', to_jsonb(v_avisos));
end $$;
comment on function public.plantilla_aplicar_cambios(uuid) is
  'Aplica los cambios de una franja a sus clases futuras. Si la franja se desactiva o termina su vigencia, cancela sus clases con alumnos (aviso y recuperación).';

-- -----------------------------------------------------------------------------
-- Permisos
-- -----------------------------------------------------------------------------
revoke all on function public._cancelar_clase(uuid, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public._cancelar_clases_cierre() from public, anon, authenticated;
revoke all on function public.cancelar_clases_cierre() from public, anon;
grant execute on function public.cancelar_clases_cierre() to authenticated;
revoke all on function public.plantilla_aplicar_cambios(uuid) from public, anon;
grant execute on function public.plantilla_aplicar_cambios(uuid) to authenticated;
