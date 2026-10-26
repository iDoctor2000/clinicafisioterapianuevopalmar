-- =============================================================================
-- 0031_baja_cierra_contrato.sql · Un alumno de baja no tiene contrato en vigor
--
--   Lo que pasaba: al poner a un alumno "de baja" (ficha → Editar → Cliente activo), su
--   contrato seguía activo: le seguían apuntando a sus clases fijas (ocupando plaza), salía en
--   "Renovar contratos", en Cobros como "sin cobro", etc. Por ejemplo, alumnas que vinieron a
--   probar un día y se quedaron con una ficha y un contrato que ya no usan.
--
--   Ahora, para TODOS los alumnos:
--     1. Al dar de baja a un alumno, su contrato activo se finaliza ese día, sus clases fijas
--        futuras se quitan, las demás reservas futuras se cancelan por el centro (como en
--        "Finalizar contrato") y sale de las listas de espera. Así deja libres sus plazas.
--        Los cobros no se tocan (si debe algo, sigue apuntado).
--     2. Lo mismo, una vez, con los alumnos que ya están de baja y tienen contrato activo.
--   Si el alumno vuelve, se le vuelve a poner "activo" y se le hace una contratación nueva.
--   Idempotente: se puede ejecutar varias veces.
-- =============================================================================

create or replace function public._cerrar_alumno_de_baja(p_cliente_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hoy date := public._hoy();
  v_n integer;
begin
  with c as (
    update public.contratos set estado = 'FINALIZADO', fecha_fin = least(fecha_fin, v_hoy)
     where cliente_id = p_cliente_id and estado = 'ACTIVO'
    returning id
  ) select count(*) into v_n from c;
  -- Clases fijas futuras: fuera. Las demás reservas futuras: canceladas por el centro.
  delete from public.reservas r using public.clases c
   where c.id = r.clase_id and r.cliente_id = p_cliente_id and r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA' and c.fecha >= v_hoy;
  update public.reservas r set estado = 'CANCELADA_CENTRO', cancelado_el = now(), cancelado_por = auth.uid()
    from public.clases c
   where c.id = r.clase_id and r.cliente_id = p_cliente_id and r.estado = 'RESERVADA' and c.fecha >= v_hoy;
  delete from public.lista_espera where cliente_id = p_cliente_id;
  if v_n > 0 then
    perform public._auditar('BAJA_CIERRA_CONTRATO', 'cliente', p_cliente_id::text,
      format('%s: de baja, %s contrato(s) finalizado(s) y clases futuras quitadas', public._nombre_cliente(p_cliente_id), v_n));
  end if;
  return v_n;
end $$;
revoke all on function public._cerrar_alumno_de_baja(uuid) from public, anon, authenticated;

create or replace function public.trg_clientes_baja()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.activo, true) and not coalesce(new.activo, true) then
    perform public._cerrar_alumno_de_baja(new.id);
  end if;
  return null;
end $$;
drop trigger if exists clientes_baja on public.clientes;
create trigger clientes_baja after update of activo on public.clientes
  for each row execute function public.trg_clientes_baja();

-- Los que ya están de baja con contrato activo (o con clases futuras).
do $$
declare r record; v_total integer := 0;
begin
  for r in
    select c.id from public.clientes c
     where not c.activo
       and (exists (select 1 from public.contratos k where k.cliente_id = c.id and k.estado = 'ACTIVO')
            or exists (select 1 from public.reservas x join public.clases l on l.id = x.clase_id
                        where x.cliente_id = c.id and x.estado = 'RESERVADA' and l.fecha >= public._hoy()))
  loop
    v_total := v_total + public._cerrar_alumno_de_baja(r.id);
  end loop;
  raise notice 'Alumnos de baja: % contratos finalizados', v_total;
end $$;
