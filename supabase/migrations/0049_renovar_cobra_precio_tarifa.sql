-- =============================================================================
-- 0049_renovar_cobra_precio_tarifa.sql · Renovar crea siempre el cobro de cada mes nuevo
--
--   Lo que pasó (26/10): «Renovar» alargó 5 contratos mensuales hasta el 30/11 pero no creó el cobro de
--   noviembre («0 cobros»), porque esos contratos no tenían importe acordado. Por eso salen en Cobros →
--   «Sin cobro» de noviembre. Ahora, sin importe acordado, se usa el precio de la tarifa, igual que al
--   crear un contrato. Si la tarifa tampoco tiene precio, no se crea (no hay importe que poner).
--   No toca los cobros que ya hay: los de noviembre que faltan se apuntan desde «Sin cobro». Idempotente.
-- =============================================================================

create or replace function public.renovar_contratos(p_contratos uuid[], p_hasta date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k           record;
  v_desde     date;
  v_mes       date;
  v_importe   integer;
  v_renovados integer := 0;
  v_saltados  integer := 0;
  v_reservas  integer := 0;
  v_cobros    integer := 0;
  v_n         integer;
  v_c         integer;
  v_meses     text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  perform public._exigir('CLIENTES_EDITAR');
  if p_hasta is null then raise exception 'Indica hasta qué fecha se renuevan.'; end if;
  if p_hasta <= public._hoy() then raise exception 'La fecha de renovación tiene que ser futura.'; end if;

  for k in
    select c.*, t.tipo as tipo_tarifa
      from public.contratos c join public.tarifas t on t.id = c.tarifa_id
     where c.id = any (coalesce(p_contratos, '{}'))
     order by c.id
     for update of c
  loop
    if k.estado <> 'ACTIVO' or k.tipo_tarifa <> 'RECURRENTE' or k.fecha_fin >= p_hasta or not public.alcance_cliente(k.cliente_id) then
      v_saltados := v_saltados + 1;
      continue;
    end if;
    v_desde := k.fecha_fin + 1;

    update public.contratos set fecha_fin = p_hasta where id = k.id;
    v_n := public._generar_reservas_automaticas(k.id, false);
    v_reservas := v_reservas + coalesce(v_n, 0);

    -- 0049: sin importe acordado, el precio de la tarifa (como al crear el contrato). Antes no se creaba ningún cobro.
    v_importe := coalesce((select p.importe_centimos from public.contratos_pago p where p.contrato_id = k.id),
                          (select t.precio_centimos from public.tarifas t where t.id = k.tarifa_id));
    v_c := 0;
    if v_importe is not null then
      v_mes := v_desde;
      while v_mes <= p_hasta loop
        if not exists (select 1 from public.pagos g where g.cliente_id = k.cliente_id and g.estado <> 'CANCELADO' and g.mes = date_trunc('month', v_mes)::date) then
          insert into public.pagos (contrato_id, cliente_id, concepto, importe_centimos, vence_el, mes, estado, proveedor)
          values (k.id, k.cliente_id,
                  format('%s %s', initcap(v_meses[extract(month from v_mes)::int]), extract(year from v_mes)::int),
                  v_importe, v_mes, date_trunc('month', v_mes)::date, 'PENDIENTE', 'SIN_INDICAR');
          v_c := v_c + 1;
        end if;
        v_mes := (date_trunc('month', v_mes) + interval '1 month')::date;
      end loop;
    end if;
    v_cobros := v_cobros + v_c;
    v_renovados := v_renovados + 1;

    perform public._auditar('RENOVAR_CONTRATO', 'contrato', k.id::text,
      format('%s: fin %s → %s (%s reservas nuevas, %s cobros)', public._nombre_cliente(k.cliente_id), k.fecha_fin, p_hasta, coalesce(v_n, 0), v_c));
  end loop;

  return jsonb_build_object('renovados', v_renovados, 'saltados', v_saltados, 'reservas', v_reservas, 'cobros', v_cobros);
end $$;
revoke all on function public.renovar_contratos(uuid[], date) from public, anon;
grant execute on function public.renovar_contratos(uuid[], date) to authenticated;
