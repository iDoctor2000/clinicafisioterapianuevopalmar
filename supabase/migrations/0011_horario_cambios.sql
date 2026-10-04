-- =============================================================================
-- 0011_horario_cambios.sql · Los cambios del horario semanal se aplican a las clases futuras
--
--   Hasta ahora, editar una franja (hora, monitor, plazas, día, baja) solo afectaba a las
--   clases que aún no existían: las de las próximas 10 semanas, ya generadas, seguían con el
--   horario antiguo. `plantilla_aplicar_cambios` recrea las clases futuras de esa franja:
--     · se eliminan las clases PROGRAMADA desde hoy cuyas reservas sean todas automáticas
--       (horario fijo) o que no tengan reservas, junto con esas reservas automáticas;
--     · se vuelven a generar con los datos nuevos de la franja y se recrean las reservas
--       automáticas de los contratos de horario fijo;
--     · las clases con reservas hechas por clientes o por el centro se conservan tal cual
--       (se devuelve cuántas son para avisar al administrador).
--
-- Espejo de app/src/data/comandos.ts (guardarPlantilla). Idempotente.
-- =============================================================================

create or replace function public.plantilla_aplicar_cambios(p_plantilla_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hoy         date := public._hoy();
  v_cfg         public.config_centro%rowtype;
  v_conservadas integer := 0;
  k             record;
begin
  perform public._exigir('HORARIOS_GESTIONAR');
  if public.auth_ambito() = 'SUS_CLASES' then
    raise exception 'Con ámbito "Solo sus clases" no se puede modificar el horario.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_cfg from public.config_centro limit 1;

  -- Clases futuras de la franja con alguna reserva que no sea automática: se conservan.
  select count(*) into v_conservadas
    from public.clases c
   where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy
     and exists (select 1 from public.reservas r where r.clase_id = c.id and not (r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA'));

  -- El resto (sin reservas, o solo automáticas activas) se elimina para recrearlo.
  with borrables as (
    select c.id from public.clases c
     where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy
       and not exists (select 1 from public.reservas r where r.clase_id = c.id and not (r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA'))
  ), reservas_fuera as (
    delete from public.reservas r where r.clase_id in (select id from borrables) returning r.id
  )
  delete from public.clases c where c.id in (select id from borrables);

  perform public._generar_clases(v_hoy, v_hoy + coalesce(v_cfg.dias_generacion_clases, 70));
  for k in select id from public.contratos where estado = 'ACTIVO' and modalidad = 'FIJO' loop
    perform public._generar_reservas_automaticas(k.id);
  end loop;

  perform public._auditar('EDITAR_HORARIO', 'plantilla', p_plantilla_id::text, format('clases futuras recreadas; %s conservadas con reservas', v_conservadas));
  return v_conservadas;
end $$;
comment on function public.plantilla_aplicar_cambios(uuid) is 'Recrea las clases futuras de una franja tras editarla; devuelve cuántas se conservan por tener reservas de clientes o del centro.';
revoke all on function public.plantilla_aplicar_cambios(uuid) from public, anon;
grant execute on function public.plantilla_aplicar_cambios(uuid) to authenticated;
