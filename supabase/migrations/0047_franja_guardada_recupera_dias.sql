-- =============================================================================
-- 0047_franja_guardada_recupera_dias.sql · Una franja guardada siempre tiene sus clases
--
--   Lo que pasó (30/10): la 0042 anota los días de una franja cuya clase se quita para que el
--   mantenimiento no la vuelva a crear. Pero si después se vuelve a guardar esa franja (cambiar la
--   actividad, las plazas, la vigencia…), el día seguía «quitado»: la franja salía en Horarios y en
--   el calendario faltaba la clase, sin ninguna explicación. Además la 0042 anotó como quitados los
--   huecos que ya había, aunque fueran de franjas que aún no habían empezado.
--
--   Regla definitiva:
--     1. Guardar una franja (plantilla_aplicar_cambios) borra sus días quitados futuros: la franja
--        vuelve a tener clase todos los días que le tocan. Quitar una clase sigue valiendo hasta que
--        alguien vuelva a guardar la franja.
--     2. restaurar_clase_quitada(franja, fecha): vuelve a poner la clase de un día quitado (botón en
--        el calendario, que ahora enseña los huecos con su motivo).
--     3. Reparación ahora: los días quitados de franjas que se guardaron después de quitarlos vuelven,
--        y se generan sus clases con sus reservas fijas.
--   Idempotente.
-- =============================================================================

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
  v_recuperadas integer := 0;
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

  -- 0047: guardar la franja es decir «esta franja se da estos días»: los días futuros que se hubieran quitado
  -- (0042) vuelven a generarse. Si no, la franja sale en Horarios y en el calendario falta la clase.
  delete from public.clases_quitadas q where q.plantilla_id = p_plantilla_id and q.fecha >= v_hoy;
  get diagnostics v_recuperadas = row_count;

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
    format('clases futuras recreadas; %s conservan día y hora; %s movidas con sus alumnos; %s canceladas (%s alumnos avisados); %s reactivadas; %s días quitados vuelven',
           greatest(0, v_conservadas - v_movidas), v_movidas, v_canceladas, v_afectados, v_reactivadas, v_recuperadas));
  return jsonb_build_object('conservadas', greatest(0, v_conservadas - v_movidas), 'movidas', v_movidas, 'canceladas', v_canceladas, 'afectados', v_afectados,
                            'reactivadas', v_reactivadas, 'recuperadas', v_recuperadas, 'avisos', to_jsonb(v_avisos));
end $$;

-- Vuelve a poner la clase de un día quitado (0042) de una franja activa.
create or replace function public.restaurar_clase_quitada(p_plantilla_id uuid, p_fecha date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pl    public.plantillas_clase%rowtype;
  v_hoy   date := public._hoy();
  v_id    uuid;
  k       record;
begin
  perform public._exigir('CLASES_CREAR_CANCELAR');
  if public.auth_ambito() = 'SUS_CLASES' then
    raise exception 'Con ámbito "Solo sus clases" no se puede modificar el horario.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_pl from public.plantillas_clase where id = p_plantilla_id;
  if not found or not v_pl.activa or v_pl.eliminada_el is not null then raise exception 'Esa franja ya no está en el horario.'; end if;
  if p_fecha < v_hoy then raise exception 'Ese día ya ha pasado.'; end if;
  if extract(isodow from p_fecha) <> v_pl.dia_semana
     or (v_pl.vigencia_desde is not null and p_fecha < v_pl.vigencia_desde)
     or (v_pl.vigencia_hasta is not null and p_fecha > v_pl.vigencia_hasta) then
    raise exception 'A esa franja no le toca clase ese día.';
  end if;
  if exists (select 1 from public.dias_cierre dc where dc.fecha = p_fecha) then raise exception 'Ese día el centro está cerrado.'; end if;
  if exists (select 1 from public.clases c where c.plantilla_id = p_plantilla_id and c.fecha = p_fecha) then raise exception 'Ese día ya tiene clase.'; end if;
  delete from public.clases_quitadas q where q.plantilla_id = p_plantilla_id and q.fecha = p_fecha;
  perform public._generar_clases(p_fecha, p_fecha);
  select c.id into v_id from public.clases c where c.plantilla_id = p_plantilla_id and c.fecha = p_fecha;
  if v_id is null then raise exception 'No se ha podido crear la clase.'; end if;
  for k in
    select distinct f.contrato_id as id from public.contrato_franjas f join public.contratos c on c.id = f.contrato_id
     where f.plantilla_id = p_plantilla_id and c.estado = 'ACTIVO' and c.modalidad = 'FIJO'
  loop
    perform public._generar_reservas_automaticas(k.id);
  end loop;
  perform public._auditar('RESTAURAR_CLASE', 'clase', v_id::text,
    format('%s %s %s · vuelve a ponerse la clase quitada', (select nombre from public.actividades where id = v_pl.actividad_id), p_fecha, to_char(v_pl.hora_inicio, 'HH24:MI')));
  return v_id;
end $$;
revoke all on function public.restaurar_clase_quitada(uuid, date) from public, anon;
grant execute on function public.restaurar_clase_quitada(uuid, date) to authenticated;

-- Reparación: los días quitados de franjas que se volvieron a guardar después vuelven (regla 1 aplicada a lo
-- que ya hay), y se crean sus clases con las reservas de los alumnos fijos.
do $$
declare v_n integer; v_clases integer; v_cfg public.config_centro%rowtype; k record;
begin
  select * into v_cfg from public.config_centro limit 1;
  with b as (
    delete from public.clases_quitadas q
     using public.plantillas_clase p
     where p.id = q.plantilla_id and q.fecha >= public._hoy()
       and p.activa and p.eliminada_el is null and p.actualizado_el > q.quitada_el
    returning q.plantilla_id
  ) select count(*) into v_n from b;
  select public._generar_clases(public._hoy(), public._hoy() + coalesce(v_cfg.dias_generacion_clases, 70)) into v_clases;
  if v_clases > 0 then
    for k in select id from public.contratos where estado = 'ACTIVO' and modalidad = 'FIJO' loop
      perform public._generar_reservas_automaticas(k.id);
    end loop;
  end if;
  if v_n > 0 or v_clases > 0 then
    perform public._auditar('MANTENIMIENTO', 'clase', '-', format('%s días quitados de franjas guardadas después vuelven; %s clases creadas · 0047', v_n, v_clases));
  end if;
  raise notice '0047: % días quitados recuperados, % clases creadas.', v_n, v_clases;
end $$;
