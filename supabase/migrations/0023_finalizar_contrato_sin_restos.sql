-- =============================================================================
-- 0023_finalizar_contrato_sin_restos.sql · Finalizar un contrato no deja clases "canceladas por el centro"
--
--   Al finalizar un contrato de horario fijo con "cancelar sus reservas futuras", sus clases fijas
--   quedaban como reservas canceladas por el centro hasta el final del contrato (meses). El alumno
--   las veía en Mis clases como "Cancelada por el centro" aunque simplemente ya no tenía esa tarifa,
--   y con el contrato siguiente bloqueaban la generación de sus clases (corregido en 0022).
--
--   Ahora, al finalizar: las reservas fijas futuras (automáticas) se quitan sin más, como al editar
--   un contrato; las hechas a mano, con bono o con recuperación se cancelan por el centro, como antes.
--   Además limpia los restos que dejó octubre de 2026. Idempotente.
-- =============================================================================

create or replace function public.finalizar_contrato(p_contrato_id uuid, p_cancelar_reservas_futuras boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_hoy date := public._hoy();
begin
  perform public._exigir('CLIENTES_EDITAR');
  update public.contratos set estado = 'CANCELADO', fecha_fin = least(fecha_fin, v_hoy) where id = p_contrato_id;
  if not found then raise exception 'El contrato no existe.'; end if;
  if p_cancelar_reservas_futuras then
    -- 0023: las clases fijas futuras se quitan (el horario fijo va con el contrato).
    delete from public.reservas r using public.clases c
     where c.id = r.clase_id and r.contrato_id = p_contrato_id and r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA' and c.fecha >= v_hoy;
    update public.reservas r set estado = 'CANCELADA_CENTRO', cancelado_el = now(), cancelado_por = auth.uid()
      from public.clases c
     where c.id = r.clase_id and r.contrato_id = p_contrato_id and r.estado = 'RESERVADA' and c.fecha >= v_hoy;
  end if;
  perform public._auditar('FINALIZAR_CONTRATO', 'contrato', p_contrato_id::text, '');
end $$;
comment on function public.finalizar_contrato(uuid, boolean) is
  'Finaliza un contrato hoy. Si se pide, quita sus clases fijas futuras y cancela por el centro las demás reservas futuras.';
revoke all on function public.finalizar_contrato(uuid, boolean) from public, anon;
grant execute on function public.finalizar_contrato(uuid, boolean) to authenticated;

-- Restos de contratos ya finalizados: clases fijas futuras que quedaron "canceladas por el centro".
delete from public.reservas r
 using public.clases c
 where c.id = r.clase_id and r.estado = 'CANCELADA_CENTRO' and r.origen = 'AUTOMATICA'
   and c.estado = 'PROGRAMADA' and c.fecha >= public._hoy()
   and not exists (select 1 from public.contratos k where k.id = r.contrato_id and k.estado = 'ACTIVO');
