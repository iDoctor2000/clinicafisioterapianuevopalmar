-- =============================================================================
-- 0019_reservas_pasadas.sql · Apuntar también a las clases pasadas (opcional)
--
--   Al dar de alta (o editar) una contratación de horario fijo con fecha de inicio
--   anterior a hoy, el alumno quedaba apuntado solo desde hoy: los días entre el inicio
--   y hoy salían a cero en el calendario aunque hubiera venido. Ahora crear_contrato y
--   editar_contrato admiten p_incluir_pasadas: con true, también se apunta a las clases
--   de sus franjas entre la fecha de inicio y hoy (si tienen plaza). Por defecto, no.
--   Esas reservas cuentan como clases hechas (medallas, reto del mes) y permiten pasar
--   lista de esos días. Idempotente.
-- =============================================================================

-- 1) Generador interno: desde la fecha de inicio si se piden las pasadas; si no, desde hoy.
drop function if exists public._generar_reservas_automaticas(uuid);
create or replace function public._generar_reservas_automaticas(p_contrato_id uuid, p_incluir_pasadas boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_contrato public.contratos%rowtype;
  v_desde    date;
  c          record;
  v_ocupadas integer;
  v_n        integer := 0;
begin
  select * into v_contrato from public.contratos where id = p_contrato_id;
  if not found or v_contrato.modalidad <> 'FIJO' or v_contrato.estado <> 'ACTIVO' then return 0; end if;
  v_desde := case when coalesce(p_incluir_pasadas, false) then v_contrato.fecha_inicio else greatest(v_contrato.fecha_inicio, public._hoy()) end;

  for c in
    select cl.id, cl.plazas
      from public.clases cl
      join public.contrato_franjas f on f.contrato_id = v_contrato.id and f.plantilla_id = cl.plantilla_id
     where cl.estado = 'PROGRAMADA'
       and cl.fecha between v_desde and v_contrato.fecha_fin
       and not exists (select 1 from public.reservas r where r.clase_id = cl.id and r.cliente_id = v_contrato.cliente_id)
     order by cl.fecha, cl.hora_inicio
     for update of cl
  loop
    select count(*) into v_ocupadas from public.reservas where clase_id = c.id and estado = 'RESERVADA';
    if v_ocupadas >= c.plazas then continue; end if;  -- sin plaza: el centro lo verá en el calendario
    insert into public.reservas (clase_id, cliente_id, contrato_id, origen, creado_por)
    values (c.id, v_contrato.cliente_id, v_contrato.id, 'AUTOMATICA', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public._generar_reservas_automaticas(uuid, boolean) from public, anon, authenticated;

-- 2) crear_contrato con p_incluir_pasadas (misma lógica que 0013).
drop function if exists public.crear_contrato(uuid, uuid, date, date, public.modalidad, uuid[], uuid[], text, integer, text, integer, text, jsonb);
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
  v_n := public._generar_reservas_automaticas(v_id, coalesce(p_incluir_pasadas, false));

  -- Plan de cobros: [{concepto, importe_centimos, vence_el, estado, metodo, pagado_el}, …]
  insert into public.pagos (contrato_id, cliente_id, concepto, importe_centimos, vence_el, estado, proveedor, pagado_el)
  select v_id, p_cliente_id,
         coalesce(x->>'concepto', ''),
         greatest(0, coalesce((x->>'importe_centimos')::integer, 0)),
         nullif(x->>'vence_el', '')::date,
         case when x->>'estado' = 'PAGADO' then 'PAGADO'::public.estado_pago else 'PENDIENTE'::public.estado_pago end,
         case when x->>'metodo' in ('EFECTIVO', 'TARJETA', 'BIZUM', 'TRANSFERENCIA', 'DOMICILIACION') then x->>'metodo' else 'SIN_INDICAR' end,
         case when x->>'estado' = 'PAGADO' then coalesce(nullif(x->>'pagado_el', '')::timestamptz, now()) end
    from jsonb_array_elements(case when jsonb_typeof(p_cobros) = 'array' then p_cobros else '[]'::jsonb end) x;
  get diagnostics v_cobros = row_count;

  perform public._auditar('CREAR_CONTRATO', 'contrato', v_id::text,
    format('%s: %s %s→%s (%s reservas automáticas%s, %s cobros)', public._nombre_cliente(p_cliente_id), v_tarifa.nombre, p_fecha_inicio, v_fin, v_n, case when coalesce(p_incluir_pasadas, false) then ', con las pasadas' else '' end, v_cobros));
  return v_id;
end $$;
comment on function public.crear_contrato(uuid, uuid, date, date, public.modalidad, uuid[], uuid[], text, integer, text, integer, text, jsonb, boolean) is
  'Da de alta un contrato (finaliza el anterior activo), genera sus reservas automáticas si es horario fijo (también las pasadas si se pide) y crea su plan de cobros.';
revoke all on function public.crear_contrato(uuid, uuid, date, date, public.modalidad, uuid[], uuid[], text, integer, text, integer, text, jsonb, boolean) from public, anon;
grant execute on function public.crear_contrato(uuid, uuid, date, date, public.modalidad, uuid[], uuid[], text, integer, text, integer, text, jsonb, boolean) to authenticated;

-- 3) editar_contrato con p_incluir_pasadas (misma lógica que 0013).
drop function if exists public.editar_contrato(uuid, date, uuid[], text, text, integer, text, integer);
create or replace function public.editar_contrato(
  p_contrato_id uuid, p_fecha_fin date, p_franjas uuid[] default '{}', p_notas text default '',
  p_oferta text default 'NINGUNA', p_importe_centimos integer default null, p_metodo_pago text default null,
  p_sesiones_restantes integer default null, p_incluir_pasadas boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_c     public.contratos%rowtype;
  v_tipo  public.tipo_tarifa;
  v_hoy   date := public._hoy();
  v_quit  integer;
  v_n     integer;
begin
  perform public._exigir('CLIENTES_EDITAR');
  select * into v_c from public.contratos where id = p_contrato_id for update;
  if not found then raise exception 'El contrato no existe.'; end if;
  if v_c.estado <> 'ACTIVO' then raise exception 'Solo se puede modificar un contrato activo.'; end if;
  if p_fecha_fin is null or p_fecha_fin < v_c.fecha_inicio then raise exception 'La fecha de fin debe ser posterior al inicio.'; end if;
  if v_c.modalidad = 'FIJO' and cardinality(coalesce(p_franjas, '{}')) = 0 then
    raise exception 'Un contrato de horario fijo necesita al menos una franja.';
  end if;
  select tipo into v_tipo from public.tarifas where id = v_c.tarifa_id;

  update public.contratos
     set fecha_fin = p_fecha_fin, notas = coalesce(p_notas, ''),
         oferta = coalesce(nullif(p_oferta, ''), 'NINGUNA'), importe_centimos = p_importe_centimos, metodo_pago = nullif(p_metodo_pago, ''),
         sesiones_restantes = case when v_tipo = 'BONO' then greatest(0, coalesce(p_sesiones_restantes, sesiones_restantes, 0)) else sesiones_restantes end
   where id = p_contrato_id;

  if v_c.modalidad = 'FIJO' then
    delete from public.contrato_franjas where contrato_id = p_contrato_id and not (plantilla_id = any (p_franjas));
    insert into public.contrato_franjas (contrato_id, plantilla_id)
    select p_contrato_id, f from unnest(p_franjas) f group by f
    on conflict (contrato_id, plantilla_id) do nothing;
  end if;

  -- Reservas automáticas futuras que ya no corresponden (franja quitada o fuera del nuevo periodo).
  -- Las pasadas y las hechas a mano no se tocan.
  with fuera as (
    delete from public.reservas r using public.clases c
     where c.id = r.clase_id and r.contrato_id = p_contrato_id and r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA' and c.fecha >= v_hoy
       and (c.plantilla_id is null or c.fecha > p_fecha_fin
            or not exists (select 1 from public.contrato_franjas f where f.contrato_id = p_contrato_id and f.plantilla_id = c.plantilla_id))
    returning r.id
  ) select count(*) into v_quit from fuera;
  v_n := public._generar_reservas_automaticas(p_contrato_id, coalesce(p_incluir_pasadas, false));

  perform public._auditar('EDITAR_CONTRATO', 'contrato', p_contrato_id::text,
    format('%s: fin %s (%s reservas quitadas, %s nuevas)', public._nombre_cliente(v_c.cliente_id), p_fecha_fin, v_quit, v_n));
end $$;
comment on function public.editar_contrato(uuid, date, uuid[], text, text, integer, text, integer, boolean) is
  'Modifica un contrato activo (fin, franjas, notas, sesiones de bono, datos de pago) y rehace sus reservas automáticas futuras (y las pasadas si se pide).';
revoke all on function public.editar_contrato(uuid, date, uuid[], text, text, integer, text, integer, boolean) from public, anon;
grant execute on function public.editar_contrato(uuid, date, uuid[], text, text, integer, text, integer, boolean) to authenticated;
