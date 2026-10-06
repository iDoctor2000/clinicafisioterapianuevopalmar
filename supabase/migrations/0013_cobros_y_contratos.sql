-- =============================================================================
-- 0013_cobros_y_contratos.sql · Cobros, edición de contratos y cambios de horario completos
--
--   1. Contratos: oferta (ninguna / trimestral / familiar), importe acordado y forma de pago.
--   2. Pagos: la tabla (preparada para Stripe en 0001) pasa a usarse como registro de cobros:
--      concepto ("Mes 1 · octubre 2026") y fecha en la que toca cobrar (vence_el). La forma
--      de pago va en `proveedor` (EFECTIVO, TARJETA, BIZUM, TRANSFERENCIA, DOMICILIACION).
--      Escriben quienes pueden editar clientes (CLIENTES_EDITAR), dentro de su ámbito.
--   3. crear_contrato admite los datos de pago y el plan de cobros (p_cobros, jsonb).
--   4. editar_contrato: cambia fecha de fin, franjas, notas, sesiones de bono y datos de pago
--      de un contrato activo, y rehace sus reservas automáticas futuras.
--   5. plantilla_aplicar_cambios: las clases futuras que se conservan por tener alumnos
--      mantienen día y hora, pero toman la actividad, el monitor, las plazas y la duración
--      nuevos de la franja (antes se quedaban como estaban).
--   Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Contratos: datos de pago
-- -----------------------------------------------------------------------------
alter table public.contratos
  add column if not exists oferta           text not null default 'NINGUNA',
  add column if not exists importe_centimos integer,
  add column if not exists metodo_pago      text;

do $$ begin
  alter table public.contratos add constraint contratos_oferta_valida check (oferta in ('NINGUNA', 'TRIMESTRAL', 'FAMILIAR'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.contratos add constraint contratos_importe_valido check (importe_centimos is null or importe_centimos >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.contratos add constraint contratos_metodo_pago_valido
    check (metodo_pago is null or metodo_pago in ('EFECTIVO', 'TARJETA', 'BIZUM', 'TRANSFERENCIA', 'DOMICILIACION'));
exception when duplicate_object then null; end $$;

comment on column public.contratos.oferta is 'Oferta aplicada al contratar: NINGUNA, TRIMESTRAL o FAMILIAR.';
comment on column public.contratos.importe_centimos is 'Importe acordado: por mes (tarifa mensual) o total (bono / clase suelta). NULL = sin indicar.';
comment on column public.contratos.metodo_pago is 'Forma de pago habitual: EFECTIVO, TARJETA, BIZUM, TRANSFERENCIA o DOMICILIACION.';

-- -----------------------------------------------------------------------------
-- 2. Pagos: registro de cobros
-- -----------------------------------------------------------------------------
alter table public.pagos
  add column if not exists concepto text not null default '',
  add column if not exists vence_el date;
comment on column public.pagos.concepto is 'Qué se cobra: "Mes 1 · octubre 2026", "Bono 10R"…';
comment on column public.pagos.vence_el is 'Fecha en la que toca cobrarlo. Si llega sin cobrar, la app avisa de "Pago pendiente".';
create index if not exists pagos_vence_idx on public.pagos (estado, vence_el);

drop policy if exists pagos_leer on public.pagos;
create policy pagos_leer on public.pagos for select to authenticated
  using (cliente_id = public.auth_cliente_id() or (public.tiene_permiso('CLIENTES_VER') and public.alcance_cliente(cliente_id)));
drop policy if exists pagos_escribir on public.pagos;
create policy pagos_escribir on public.pagos for all to authenticated
  using (public.tiene_permiso('CLIENTES_EDITAR') and public.alcance_cliente(cliente_id))
  with check (
    public.tiene_permiso('CLIENTES_EDITAR') and public.alcance_cliente(cliente_id)
    -- El cobro de un contrato tiene que ser del mismo cliente.
    and (contrato_id is null or exists (select 1 from public.contratos c where c.id = contrato_id and c.cliente_id = pagos.cliente_id))
  );
grant select, insert, update, delete on public.pagos to authenticated;

-- Tiempo real: que la ficha de un cliente se actualice en todos los dispositivos.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pagos') then
    execute 'alter publication supabase_realtime add table public.pagos';
  end if;
exception when others then
  raise notice '0013: no se ha podido ampliar supabase_realtime (%). Se continúa.', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- 3. crear_contrato con datos de pago y plan de cobros
--    (se sustituye la versión de 0003; los parámetros nuevos tienen valor por defecto,
--    así que una app antigua que no los envíe sigue funcionando).
-- -----------------------------------------------------------------------------
drop function if exists public.crear_contrato(uuid, uuid, date, date, public.modalidad, uuid[], uuid[], text, integer);

create or replace function public.crear_contrato(
  p_cliente_id uuid, p_tarifa_id uuid, p_fecha_inicio date, p_fecha_fin date default null,
  p_modalidad public.modalidad default 'LIBRE', p_franjas uuid[] default '{}',
  p_actividades_permitidas uuid[] default '{}', p_notas text default '', p_sesiones_restantes integer default null,
  p_oferta text default 'NINGUNA', p_importe_centimos integer default null, p_metodo_pago text default null,
  p_cobros jsonb default '[]'
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
  v_n := public._generar_reservas_automaticas(v_id);

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
    format('%s: %s %s→%s (%s reservas automáticas, %s cobros)', public._nombre_cliente(p_cliente_id), v_tarifa.nombre, p_fecha_inicio, v_fin, v_n, v_cobros));
  return v_id;
end $$;
comment on function public.crear_contrato(uuid, uuid, date, date, public.modalidad, uuid[], uuid[], text, integer, text, integer, text, jsonb) is
  'Da de alta un contrato (finaliza el anterior activo), genera sus reservas automáticas si es horario fijo y crea su plan de cobros.';
revoke all on function public.crear_contrato(uuid, uuid, date, date, public.modalidad, uuid[], uuid[], text, integer, text, integer, text, jsonb) from public, anon;
grant execute on function public.crear_contrato(uuid, uuid, date, date, public.modalidad, uuid[], uuid[], text, integer, text, integer, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. editar_contrato
-- -----------------------------------------------------------------------------
create or replace function public.editar_contrato(
  p_contrato_id uuid, p_fecha_fin date, p_franjas uuid[] default '{}', p_notas text default '',
  p_oferta text default 'NINGUNA', p_importe_centimos integer default null, p_metodo_pago text default null,
  p_sesiones_restantes integer default null
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
  v_n := public._generar_reservas_automaticas(p_contrato_id);

  perform public._auditar('EDITAR_CONTRATO', 'contrato', p_contrato_id::text,
    format('%s: fin %s (%s reservas quitadas, %s nuevas)', public._nombre_cliente(v_c.cliente_id), p_fecha_fin, v_quit, v_n));
end $$;
comment on function public.editar_contrato(uuid, date, uuid[], text, text, integer, text, integer) is
  'Modifica un contrato activo (fin, franjas, notas, sesiones de bono, datos de pago) y rehace sus reservas automáticas futuras.';
revoke all on function public.editar_contrato(uuid, date, uuid[], text, text, integer, text, integer) from public, anon;
grant execute on function public.editar_contrato(uuid, date, uuid[], text, text, integer, text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. plantilla_aplicar_cambios: las clases conservadas también se actualizan
-- -----------------------------------------------------------------------------
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

  -- Las conservadas mantienen día y hora (sus alumnos cuentan con ellas) pero toman la actividad,
  -- el monitor, la duración y las plazas nuevas (nunca menos plazas que alumnos apuntados).
  update public.clases c
     set actividad_id = p.actividad_id, monitor_id = p.monitor_id, duracion_min = p.duracion_min,
         plazas = greatest(p.plazas, (select count(*) from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA')::integer)
    from public.plantillas_clase p
   where p.id = p_plantilla_id and c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy;

  perform public._generar_clases(v_hoy, v_hoy + coalesce(v_cfg.dias_generacion_clases, 70));
  for k in select id from public.contratos where estado = 'ACTIVO' and modalidad = 'FIJO' loop
    perform public._generar_reservas_automaticas(k.id);
  end loop;

  perform public._auditar('EDITAR_HORARIO', 'plantilla', p_plantilla_id::text, format('clases futuras recreadas; %s con alumnos conservan día y hora', v_conservadas));
  return v_conservadas;
end $$;
comment on function public.plantilla_aplicar_cambios(uuid) is 'Aplica los cambios de una franja a sus clases futuras; devuelve cuántas conservan día y hora por tener alumnos.';
revoke all on function public.plantilla_aplicar_cambios(uuid) from public, anon;
grant execute on function public.plantilla_aplicar_cambios(uuid) to authenticated;
