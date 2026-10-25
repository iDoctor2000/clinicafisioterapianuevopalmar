-- =============================================================================
-- 0028_renovar_contratos.sql · Renovar de golpe los contratos que terminan
--
--   `renovar_contratos(p_contratos, p_hasta)`: para cada contrato indicado que siga activo,
--   sea de una tarifa mensual (no bonos ni clases sueltas) y termine antes de `p_hasta`:
--     1. Alarga su fecha de fin hasta `p_hasta`. Es el MISMO contrato: conserva sus franjas
--        fijas, sus reservas, sus recuperaciones y sus datos de pago. (Crear uno nuevo que
--        empiece el día 1 cerraría ya el actual y dejaría la última semana sin contrato.)
--     2. Apunta al alumno a las clases de sus franjas fijas en el periodo nuevo.
--     3. Crea un cobro pendiente por cada mes nuevo ("Renovación · noviembre 2026") con el
--        importe que tiene el contrato, salvo que no tenga importe o ya haya un cobro de ese
--        alumno en ese mes (así no se duplica si alguien ya lo apuntó a mano).
--   Personal con CLIENTES_EDITAR, dentro de su ámbito. Devuelve los recuentos.
--   Idempotente: se puede ejecutar varias veces.
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

    -- Un cobro por cada mes que empieza en el periodo nuevo, con el importe del contrato.
    select p.importe_centimos into v_importe from public.contratos_pago p where p.contrato_id = k.id;
    v_c := 0;
    if v_importe is not null then
      v_mes := v_desde;
      while v_mes <= p_hasta loop
        if not exists (
          select 1 from public.pagos g
           where g.cliente_id = k.cliente_id and g.estado <> 'CANCELADO'
             and g.vence_el between date_trunc('month', v_mes)::date and (date_trunc('month', v_mes) + interval '1 month - 1 day')::date
        ) then
          insert into public.pagos (contrato_id, cliente_id, concepto, importe_centimos, vence_el, estado, proveedor)
          values (k.id, k.cliente_id,
                  format('Renovación · %s %s', v_meses[extract(month from v_mes)::int], extract(year from v_mes)::int),
                  v_importe, v_mes, 'PENDIENTE', 'SIN_INDICAR');
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
comment on function public.renovar_contratos(uuid[], date) is
  'Alarga hasta p_hasta los contratos mensuales activos indicados, les apunta a sus clases fijas y crea el cobro de cada mes nuevo. CLIENTES_EDITAR, dentro del ámbito.';
revoke all on function public.renovar_contratos(uuid[], date) from public, anon;
grant execute on function public.renovar_contratos(uuid[], date) to authenticated;
