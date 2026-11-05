-- =============================================================================
-- 0051_cambio_cualquier_semana_y_sin_cobro.sql
--
--   1. Lista de espera «a cambio de otra clase mía» (05/11, a petición de un alumno y del centro): antes solo
--      valía una clase de la misma semana; para otra semana había que cancelar antes la propia y, si luego no
--      se entraba, se perdían las dos. Ahora vale cualquier clase futura suya dentro de su contratación (mismas
--      reglas de tipo de clase y de antelación). Si se libera sitio, su clase se cancela y entra en la nueva a la
--      vez; si no, la conserva.
--   2. Importe acordado 0 € = no se cobra (familia, cortesía): renovar no crea cobros, y al poner 0 € se quitan
--      los cobros pendientes de ese contrato.
--   3. Fichas duplicadas (05/11, Alison): se le dio de alta dos veces; el pago de noviembre se apuntó en la buena
--      y la otra (dada de baja) seguía saliendo con noviembre «vencido». Se quitan los cobros pendientes de una
--      ficha de baja cuando otra ficha activa con el mismo nombre ya tiene ese mes apuntado. La app avisa ahora al
--      crear una ficha con un nombre que ya existe.
--   Idempotente.
-- =============================================================================

create or replace function public._motivo_no_cambio(p_reserva public.reservas, p_clase public.clases)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg      public.config_centro%rowtype;
  v_origen   public.clases%rowtype;
  v_act_dest public.actividades%rowtype;
  v_act_orig public.actividades%rowtype;
  v_contrato public.contratos%rowtype;
  v_tarifa   public.tarifas%rowtype;
begin
  if p_reserva.id is null then return 'La reserva que quieres cambiar no existe.'; end if;
  if p_reserva.estado <> 'RESERVADA' then return 'La reserva que quieres cambiar ya está cancelada.'; end if;
  if p_reserva.clase_id = p_clase.id then return 'Es la misma clase.'; end if;
  select * into v_origen from public.clases where id = p_reserva.clase_id;
  if v_origen.estado <> 'PROGRAMADA' then return 'La clase que quieres cambiar está cancelada.'; end if;
  select * into v_cfg from public.config_centro limit 1;
  if public._minutos_hasta(v_origen.fecha, v_origen.hora_inicio) < v_cfg.minutos_antelacion_cancelacion then
    return format('Tu clase del %s a las %s ya no se puede cambiar (hay que hacerlo con %s horas de antelación).',
                  to_char(v_origen.fecha, 'DD/MM'), to_char(v_origen.hora_inicio, 'HH24:MI'), v_cfg.minutos_antelacion_cancelacion / 60);
  end if;
  select * into v_act_dest from public.actividades where id = p_clase.actividad_id;
  select * into v_act_orig from public.actividades where id = v_origen.actividad_id;
  if p_reserva.contrato_id is not null then
    select * into v_contrato from public.contratos where id = p_reserva.contrato_id;
    select * into v_tarifa from public.tarifas where id = v_contrato.tarifa_id;
  end if;
  -- Vale si es la misma categoría, una de la tarifa (volver a su Reformer) o una en la que sus clases también valen.
  if v_act_dest.categoria <> v_act_orig.categoria
     and not (v_act_dest.categoria = any (coalesce(v_tarifa.cupo_categorias_extra, '{}')))
     and v_act_dest.categoria is distinct from v_tarifa.bono_categoria
     and not exists (select 1 from public.tarifa_cupos tc where tc.tarifa_id = v_tarifa.id and tc.categoria = v_act_dest.categoria) then
    return format('No se puede cambiar una clase de %s por una de %s.', lower(v_act_orig.nombre), lower(v_act_dest.nombre));
  end if;
  if v_contrato.id is not null then
    -- 0051: vale cualquier semana, pero dentro de su contratación.
    if p_clase.fecha not between v_contrato.fecha_inicio and v_contrato.fecha_fin then
      return 'Esa clase es fuera de las fechas de tu contratación.';
    end if;
    if cardinality(v_contrato.actividades_permitidas_ids) > 0 and not (v_act_dest.id = any (v_contrato.actividades_permitidas_ids)) then
      return format('Tu tarifa no incluye %s.', v_act_dest.nombre);
    end if;
  end if;
  return null;
end $$;
revoke all on function public._motivo_no_cambio(public.reservas, public.clases) from public, anon, authenticated;

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
    -- 0051: importe acordado 0 € = no se cobra (familia, cortesía): ningún cobro.
    if v_importe is not null and v_importe > 0 then
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

-- Poner 0 € a un contrato: sus cobros pendientes dejan de deberse.
create or replace function public.trg_contratos_pago_sin_cobro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n integer; v_cliente uuid;
begin
  if new.importe_centimos = 0 and old.importe_centimos is distinct from 0 then
    select cliente_id into v_cliente from public.contratos where id = new.contrato_id;
    with b as (delete from public.pagos where contrato_id = new.contrato_id and estado = 'PENDIENTE' returning id)
    select count(*) into v_n from b;
    if v_n > 0 then
      perform public._auditar('COBROS_FUERA_DE_CONTRATO', 'contrato', new.contrato_id::text,
        format('%s: importe 0 € (no se cobra): %s cobros pendientes quitados', public._nombre_cliente(v_cliente), v_n));
    end if;
  end if;
  return new;
end $$;
comment on function public.trg_contratos_pago_sin_cobro() is 'Importe acordado 0 € = no se cobra: se quitan los cobros pendientes del contrato (0051).';
drop trigger if exists contratos_pago_sin_cobro on public.contratos_pago;
create trigger contratos_pago_sin_cobro after update of importe_centimos on public.contratos_pago
  for each row execute function public.trg_contratos_pago_sin_cobro();

-- Fichas duplicadas: el pendiente de la ficha de baja sobra si la ficha activa con el mismo nombre ya tiene ese mes.
do $$
declare v_n integer;
begin
  with dup as (
    select p.id
      from public.pagos p
      join public.clientes b on b.id = p.cliente_id and not b.activo
      join public.clientes a on a.id <> b.id and a.activo
       and lower(regexp_replace(trim(a.nombre || ' ' || a.apellidos), '\s+', ' ', 'g')) = lower(regexp_replace(trim(b.nombre || ' ' || b.apellidos), '\s+', ' ', 'g'))
     where p.estado = 'PENDIENTE'
       and exists (select 1 from public.pagos q where q.cliente_id = a.id and q.mes = p.mes and q.estado <> 'CANCELADO')
  ), b as (delete from public.pagos where id in (select id from dup) returning id)
  select count(*) into v_n from b;
  if v_n > 0 then
    perform public._auditar('LIMPIEZA_COBROS', 'sistema', '0051', format('%s cobros pendientes de fichas duplicadas (de baja) quitados: el mes ya está en la ficha activa', v_n));
  end if;
  raise notice '0051: % cobros pendientes de fichas duplicadas quitados.', v_n;
end $$;
