-- =============================================================================
-- 0029_cobros_por_mes.sql · Cada cobro pertenece a un mes, y no se duplican al recontratar
--
--   Lo que pasaba: cada vez que se creaba una contratación nueva a un alumno (y estos días se
--   han creado varias seguidas al mismo alumno para arreglar sus clases), la app generaba otra
--   vez el plan de cobros entero: "Mes 1 · octubre" ya cobrado + otro "Mes 1 · octubre"
--   pendiente + otro… Y el cobro de un contrato que empieza el 26 de octubre se llamaba
--   "Mes 1 · octubre" aunque el alumno estuviera pagando noviembre.
--
--   Ahora:
--     1. `pagos.mes`: el mes al que corresponde el cobro (día 1). Se rellena solo si no se
--        indica (por la fecha de cobro) y se puede cambiar desde la app.
--     2. Al crear una contratación, el plan de cobros NO repite los meses que el alumno ya
--        tiene apuntados (cobrados o pendientes), y los cobros pendientes del contrato anterior
--        de esos mismos meses en adelante se quitan (el plan nuevo los sustituye).
--     3. Limpieza de lo que ya había: cobros pendientes de contratos finalizados o cancelados
--        (restos de planes sustituidos), pendientes de un mes que ya está cobrado, y contratos
--        finalizados o cancelados vacíos (sin reservas, cobros ni recuperaciones), que solo
--        ensuciaban el historial. Todo queda anotado en el registro de cambios.
--   Los cobros ya cobrados no se tocan nunca: si hay dos cobrados el mismo mes, lo decide una
--   persona (pantalla Cobros → Repetidos).
--   Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La columna `mes` y su valor por defecto
-- -----------------------------------------------------------------------------
alter table public.pagos add column if not exists mes date;
comment on column public.pagos.mes is 'Mes al que corresponde el cobro (día 1). Si no se indica, el de la fecha de cobro.';

create or replace function public.trg_pagos_mes()
returns trigger language plpgsql as $$
begin
  -- Sin _hoy(): el disparador corre con el usuario que escribe (la app), que no puede ejecutarla.
  new.mes := date_trunc('month', coalesce(new.mes, new.vence_el, (new.pagado_el at time zone 'Europe/Madrid')::date, (new.creado_el at time zone 'Europe/Madrid')::date, (now() at time zone 'Europe/Madrid')::date))::date;
  return new;
end $$;
drop trigger if exists pagos_mes on public.pagos;
create trigger pagos_mes before insert or update of mes, vence_el on public.pagos
  for each row execute function public.trg_pagos_mes();

-- Lo que ya había: por el nombre del cobro si lleva mes ("Mes 1 · octubre 2026", "Renovación · noviembre 2026",
-- "Octubre"); si no, por la fecha de cobro.
update public.pagos p
   set mes = coalesce(
     (select make_date(coalesce(nullif(substring(lower(p.concepto) from '(\d{4})'), '')::int, extract(year from coalesce(p.vence_el, p.creado_el::date))::int),
                       array_position(array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'], m.nombre), 1)
        from (select unnest(array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']) as nombre) m
       where lower(p.concepto) ~ ('(^|[^a-záéíóú])' || m.nombre || '([^a-záéíóú]|$)')
       limit 1),
     date_trunc('month', coalesce(p.vence_el, (p.pagado_el at time zone 'Europe/Madrid')::date, (p.creado_el at time zone 'Europe/Madrid')::date))::date)
 where p.mes is null;
alter table public.pagos alter column mes set not null;
create index if not exists pagos_cliente_mes_idx on public.pagos (cliente_id, mes);

-- -----------------------------------------------------------------------------
-- 2. Limpieza (una vez; si no hay nada, no hace nada)
-- -----------------------------------------------------------------------------
do $$
declare v_pend integer; v_dup integer; v_con integer;
begin
  -- a) Pendientes de contratos finalizados o cancelados: el plan de ese contrato ya no vale.
  with b as (
    delete from public.pagos p using public.contratos c
     where c.id = p.contrato_id and c.estado <> 'ACTIVO' and p.estado = 'PENDIENTE'
    returning p.id
  ) select count(*) into v_pend from b;
  -- b) Pendientes de un mes que el alumno ya tiene cobrado.
  with b as (
    delete from public.pagos p
     where p.estado = 'PENDIENTE'
       and exists (select 1 from public.pagos q where q.cliente_id = p.cliente_id and q.mes = p.mes and q.estado = 'PAGADO')
    returning p.id
  ) select count(*) into v_dup from b;
  -- c) Contratos finalizados o cancelados sin nada colgando: fuera del historial.
  with vacios as (
    select c.id from public.contratos c
     where c.estado <> 'ACTIVO'
       and not exists (select 1 from public.reservas r where r.contrato_id = c.id)
       and not exists (select 1 from public.pagos p where p.contrato_id = c.id)
       and not exists (select 1 from public.recuperaciones x where x.contrato_id = c.id)
  ), f as (delete from public.contrato_franjas where contrato_id in (select id from vacios) returning 1),
  p as (delete from public.contratos_pago where contrato_id in (select id from vacios) returning 1),
  b as (delete from public.contratos where id in (select id from vacios) returning id)
  select count(*) into v_con from b;
  if v_pend + v_dup + v_con > 0 then
    perform public._auditar('LIMPIEZA_COBROS', 'sistema', '0029',
      format('%s cobros pendientes de contratos cerrados, %s pendientes de meses ya cobrados y %s contratos vacíos quitados', v_pend, v_dup, v_con));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. crear_contrato: el plan no repite meses ya apuntados y sustituye los pendientes del anterior
--    (misma firma que 0022; el disparador de 0027 sigue pasando el dinero a contratos_pago)
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
  if v_previos is not null and v_primer_mes is not null then
    with b as (
      delete from public.pagos p
       where p.contrato_id = any (v_previos) and p.estado = 'PENDIENTE' and p.mes >= v_primer_mes
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
-- 4. renovar_contratos: el cobro de cada mes nuevo lleva su mes y no se repite (misma firma que 0028)
-- -----------------------------------------------------------------------------
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

    select p.importe_centimos into v_importe from public.contratos_pago p where p.contrato_id = k.id;
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
