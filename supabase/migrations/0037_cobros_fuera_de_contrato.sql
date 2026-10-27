-- =============================================================================
-- 0037_cobros_fuera_de_contrato.sql · Un cobro pendiente no puede ser de un mes sin contrato
--
--   Lo que pasaba (27/10/2026): al dar de baja a una alumna (0031) su contrato se cerró, pero
--   sus cobros PENDIENTES de meses futuros (noviembre, de su oferta trimestral) se quedaron. No
--   son deuda: ya no tenía contrato. Al volver y hacerle otra contratación, el plan nuevo vio
--   "noviembre ya apuntado" con ese resto y no lo podía sustituir (solo sustituía los del contrato
--   activo).
--
--   Ahora, para todos los alumnos y contratos:
--     1. Cuando un contrato se acorta o se cierra (baja, "Finalizar contrato", editar la fecha de
--        fin), sus cobros pendientes de los meses posteriores a su fin se quitan solos. Los de
--        meses ya empezados (deudas) se quedan, y lo cobrado no se toca nunca.
--     2. Una contratación nueva sustituye los cobros pendientes de CUALQUIER contrato anterior del
--        alumno desde su primer mes (antes, solo los del contrato activo).
--     3. Una vez: se quitan los pendientes que ya había de meses posteriores al fin de su contrato.
--   Queda en el registro de cambios. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Al acortar o cerrar un contrato
-- -----------------------------------------------------------------------------
create or replace function public.trg_contratos_cobros_fuera()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if new.fecha_fin < old.fecha_fin or (old.estado = 'ACTIVO' and new.estado <> 'ACTIVO') then
    with b as (
      delete from public.pagos
       where contrato_id = new.id and estado = 'PENDIENTE' and mes > date_trunc('month', new.fecha_fin)::date
      returning id
    ) select count(*) into v_n from b;
    if v_n > 0 then
      perform public._auditar('COBROS_FUERA_DE_CONTRATO', 'contrato', new.id::text,
        format('%s: %s cobros pendientes de después del fin del contrato (%s) quitados', public._nombre_cliente(new.cliente_id), v_n, new.fecha_fin));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists contratos_cobros_fuera on public.contratos;
create trigger contratos_cobros_fuera after update of fecha_fin, estado on public.contratos
  for each row execute function public.trg_contratos_cobros_fuera();

-- -----------------------------------------------------------------------------
-- 2. crear_contrato (misma firma; solo cambia qué pendientes sustituye el plan nuevo)
-- -----------------------------------------------------------------------------
create or replace function public.crear_contrato(
  p_cliente_id uuid, p_tarifa_id uuid, p_fecha_inicio date, p_fecha_fin date default null,
  p_modalidad public.modalidad default 'LIBRE', p_franjas uuid[] default '{}',
  p_actividades_permitidas uuid[] default '{}', p_notas text default '', p_sesiones_restantes integer default null,
  p_oferta text default 'NINGUNA', p_importe_centimos integer default null, p_metodo_pago text default null,
  p_cobros jsonb default '[]', p_incluir_pasadas boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tarifa public.tarifas%rowtype;
  v_fin    date;
  v_id     uuid;
  v_n      integer;
  v_cobros integer;
  v_saltados integer := 0;
  v_quitados integer := 0;
  v_previos uuid[];
  v_conservadas integer := 0;
  v_primer_mes date;
  v_plan   jsonb;
begin
  perform public._exigir('CLIENTES_EDITAR');
  select * into v_tarifa from public.tarifas where id = p_tarifa_id;
  if not found then raise exception 'Tarifa no válida.'; end if;
  -- fechaFinPorDefecto: bono → validez; clase suelta → mismo día; recurrente → 3 meses.
  v_fin := coalesce(p_fecha_fin, case v_tarifa.tipo
    when 'BONO' then (p_fecha_inicio + make_interval(months => v_tarifa.bono_validez_meses))::date
    when 'CLASE_SUELTA' then p_fecha_inicio
    else (p_fecha_inicio + interval '3 months')::date end);
  if p_modalidad = 'FIJO' and cardinality(coalesce(p_franjas, '{}')) = 0 then
    raise exception 'Un contrato de horario fijo necesita al menos una franja.';
  end if;

  -- Un cliente solo tiene un contrato activo: los anteriores se finalizan.
  select array_agg(id) into v_previos from public.contratos where cliente_id = p_cliente_id and estado = 'ACTIVO';
  update public.contratos set estado = 'FINALIZADO' where cliente_id = p_cliente_id and estado = 'ACTIVO';

  insert into public.contratos (cliente_id, tarifa_id, fecha_inicio, fecha_fin, modalidad, sesiones_restantes, actividades_permitidas_ids, notas, creado_por,
                                oferta, importe_centimos, metodo_pago)
  values (p_cliente_id, p_tarifa_id, p_fecha_inicio, v_fin, p_modalidad,
          case when v_tarifa.tipo = 'BONO' then coalesce(p_sesiones_restantes, v_tarifa.bono_sesiones, 0) end,
          coalesce(p_actividades_permitidas, '{}'), coalesce(p_notas, ''), auth.uid(),
          coalesce(nullif(p_oferta, ''), 'NINGUNA'), p_importe_centimos, nullif(p_metodo_pago, ''))
  returning id into v_id;

  if p_modalidad = 'FIJO' then
    insert into public.contrato_franjas (contrato_id, plantilla_id) select v_id, f from unnest(p_franjas) f group by f;
  end if;
  -- 0022: las clases fijas futuras que ya tenía con el contrato anterior, en franjas que siguen en
  -- el nuevo, pasan al nuevo contrato (así cuentan para su cupo y no se pierden ni se duplican).
  if v_previos is not null then
    if p_modalidad = 'FIJO' then
      update public.reservas r set contrato_id = v_id
        from public.clases c
       where c.id = r.clase_id and r.contrato_id = any (v_previos) and r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA'
         and c.fecha between greatest(p_fecha_inicio, public._hoy()) and v_fin
         and c.plantilla_id = any (p_franjas);
      get diagnostics v_conservadas = row_count;
    end if;
    delete from public.reservas r using public.clases c
     where c.id = r.clase_id and r.contrato_id = any (v_previos) and r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA'
       and c.fecha >= greatest(p_fecha_inicio, public._hoy());
  end if;
  v_n := public._generar_reservas_automaticas(v_id, coalesce(p_incluir_pasadas, false));

  -- Plan de cobros: [{concepto, importe_centimos, vence_el, mes, estado, metodo, pagado_el}, …]
  -- 0029: los cobros PENDIENTES del contrato anterior desde el primer mes del plan nuevo se quitan
  -- (el plan nuevo los sustituye; los cobrados y las deudas anteriores se quedan), y el plan nuevo
  -- no repite un mes que el alumno ya tenga apuntado.
  select coalesce(jsonb_agg(jsonb_build_object(
           'concepto', coalesce(x->>'concepto', ''),
           'importe', greatest(0, coalesce((x->>'importe_centimos')::integer, 0)),
           'vence', nullif(x->>'vence_el', '')::date,
           'mes', date_trunc('month', coalesce(nullif(x->>'mes', '')::date, nullif(x->>'vence_el', '')::date, p_fecha_inicio))::date,
           'estado', case when x->>'estado' = 'PAGADO' then 'PAGADO' else 'PENDIENTE' end,
           'metodo', case when x->>'metodo' in ('EFECTIVO', 'TARJETA', 'BIZUM', 'TRANSFERENCIA', 'DOMICILIACION') then x->>'metodo' else 'SIN_INDICAR' end,
           'pagado', case when x->>'estado' = 'PAGADO' then coalesce(nullif(x->>'pagado_el', '')::timestamptz, now()) end)), '[]'::jsonb)
    into v_plan
    from jsonb_array_elements(case when jsonb_typeof(p_cobros) = 'array' then p_cobros else '[]'::jsonb end) x;
  select min((t->>'mes')::date) into v_primer_mes from jsonb_array_elements(v_plan) t;
  -- 0037: de CUALQUIER contrato anterior del alumno (también los cerrados por una baja), no solo del activo.
  if v_primer_mes is not null then
    with b as (
      delete from public.pagos p
       where p.cliente_id = p_cliente_id and p.contrato_id is not null and p.contrato_id <> v_id
         and p.estado = 'PENDIENTE' and p.mes >= v_primer_mes
      returning p.id
    ) select count(*) into v_quitados from b;
  end if;
  select count(*) into v_saltados from jsonb_array_elements(v_plan) t
   where exists (select 1 from public.pagos q where q.cliente_id = p_cliente_id and q.mes = (t->>'mes')::date and q.estado <> 'CANCELADO');
  insert into public.pagos (contrato_id, cliente_id, concepto, importe_centimos, vence_el, mes, estado, proveedor, pagado_el)
  select v_id, p_cliente_id, t->>'concepto', (t->>'importe')::integer, (t->>'vence')::date, (t->>'mes')::date,
         (t->>'estado')::public.estado_pago, t->>'metodo', (t->>'pagado')::timestamptz
    from jsonb_array_elements(v_plan) t
   where not exists (select 1 from public.pagos q where q.cliente_id = p_cliente_id and q.mes = (t->>'mes')::date and q.estado <> 'CANCELADO');
  get diagnostics v_cobros = row_count;

  perform public._auditar('CREAR_CONTRATO', 'contrato', v_id::text,
    format('%s: %s %s→%s (%s reservas automáticas%s%s, %s cobros%s%s)', public._nombre_cliente(p_cliente_id), v_tarifa.nombre, p_fecha_inicio, v_fin, v_n,
           case when coalesce(p_incluir_pasadas, false) then ', con las pasadas' else '' end,
           case when v_conservadas > 0 then format(', %s conservadas del contrato anterior', v_conservadas) else '' end,
           v_cobros,
           case when v_saltados > 0 then format(', %s meses ya apuntados', v_saltados) else '' end,
           case when v_quitados > 0 then format(', %s pendientes del anterior sustituidos', v_quitados) else '' end));
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Una vez: pendientes de meses posteriores al fin de su contrato
-- -----------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  with b as (
    delete from public.pagos p using public.contratos c
     where c.id = p.contrato_id and p.estado = 'PENDIENTE' and p.mes > date_trunc('month', c.fecha_fin)::date
    returning p.id
  ) select count(*) into v_n from b;
  if v_n > 0 then
    perform public._auditar('COBROS_FUERA_DE_CONTRATO', 'sistema', '0037', format('%s cobros pendientes de meses posteriores al fin de su contrato quitados', v_n));
  end if;
  raise notice 'Cobros pendientes fuera de contrato quitados: %', v_n;
end $$;
