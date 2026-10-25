-- =============================================================================
-- 0027_contratos_y_notificaciones.sql · Dos arreglos:
--
--   A. PERMISOS DE LA FUNCIÓN DE NOTIFICACIONES. La función enviar-push trabaja con el rol
--      service_role, y en este proyecto ese rol no tenía permiso sobre ninguna tabla (Supabase
--      ya no lo concede por defecto en los proyectos nuevos): las notificaciones al móvil
--      fallaban todas con "permission denied". Se le dan los permisos habituales, también
--      para las tablas que se creen en el futuro. Es el rol de la clave secreta del servidor;
--      ya se salta las reglas de acceso (RLS), así que no abre nada nuevo a la app.
--
--   B. LOS DATOS DE PAGO DE LOS CONTRATOS, EN SU PROPIA TABLA (lo que sigue).
--
--   En 0024 las columnas de dinero de `contratos` (oferta, importe_centimos, metodo_pago)
--   se dejaron sin permiso de lectura. Las versiones antiguas de la app (las instaladas
--   antes de hoy, incluida la de la dirección vieja, que ya no se actualiza) leen la tabla
--   entera y se quedaban SIN NINGÚN CONTRATO: el alumno veía "sin tarifa activa".
--
--   Ahora:
--     1. Los datos de pago viven en `contratos_pago` (una fila por contrato), sin acceso
--        desde la app: solo se leen por la vista `contratos_finanzas` (quien ve las finanzas).
--     2. `contratos` vuelve a poder leerse entera; sus columnas de dinero quedan siempre
--        vacías (NINGUNA / NULL). Un disparador pasa a `contratos_pago` lo que se escriba
--        en ellas (al crear un contrato siempre; al modificarlo, solo quien ve las finanzas)
--        y las deja vacías.
--     3. `editar_contrato` guarda los datos de pago directamente en `contratos_pago`, y
--        solo si quien edita ve las finanzas.
--   Se mueven los datos que ya había. Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Permisos del rol service_role (función enviar-push)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    grant execute on all functions in schema public to service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
    alter default privileges in schema public grant execute on functions to service_role;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. La tabla aparte (sin acceso desde la app)
-- -----------------------------------------------------------------------------
create table if not exists public.contratos_pago (
  contrato_id      uuid primary key references public.contratos(id) on delete cascade deferrable initially deferred,
  oferta           text not null default 'NINGUNA' check (oferta in ('NINGUNA', 'TRIMESTRAL', 'FAMILIAR')),
  importe_centimos integer check (importe_centimos is null or importe_centimos >= 0),
  metodo_pago      text check (metodo_pago is null or metodo_pago in ('EFECTIVO', 'TARJETA', 'BIZUM', 'TRANSFERENCIA', 'DOMICILIACION')),
  actualizado_el   timestamptz not null default now()
);
comment on table public.contratos_pago is 'Oferta, importe y forma de pago de cada contrato (0027). Sin acceso desde la app: se lee por la vista contratos_finanzas.';
alter table public.contratos_pago enable row level security;
revoke all on public.contratos_pago from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Mover lo que ya había y dejar vacías las columnas de contratos
-- -----------------------------------------------------------------------------
insert into public.contratos_pago (contrato_id, oferta, importe_centimos, metodo_pago)
select c.id, coalesce(nullif(c.oferta, ''), 'NINGUNA'), c.importe_centimos, nullif(c.metodo_pago, '')
  from public.contratos c
 where coalesce(c.oferta, 'NINGUNA') <> 'NINGUNA' or c.importe_centimos is not null or c.metodo_pago is not null
on conflict (contrato_id) do update
  set oferta = excluded.oferta, importe_centimos = excluded.importe_centimos, metodo_pago = excluded.metodo_pago, actualizado_el = now();

-- (Antes de crear el disparador, para que esta limpieza no se pase a contratos_pago.)
drop trigger if exists contratos_pago_aparte on public.contratos;
update public.contratos set oferta = 'NINGUNA', importe_centimos = null, metodo_pago = null
 where coalesce(oferta, 'NINGUNA') <> 'NINGUNA' or importe_centimos is not null or metodo_pago is not null;

-- -----------------------------------------------------------------------------
-- 3. Disparador: lo escrito en las columnas de dinero pasa a contratos_pago
-- -----------------------------------------------------------------------------
create or replace function public.trg_contratos_pago_aparte()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_guardar boolean;
begin
  if tg_op = 'INSERT' then
    -- Al crear un contrato (crear_contrato) siempre se guarda: si quien contrata no ve las
    -- finanzas, la app manda el importe propuesto por la tarifa.
    v_guardar := coalesce(new.oferta, 'NINGUNA') <> 'NINGUNA' or new.importe_centimos is not null or new.metodo_pago is not null;
  else
    v_guardar := (new.oferta is distinct from old.oferta or new.importe_centimos is distinct from old.importe_centimos or new.metodo_pago is distinct from old.metodo_pago)
                 and (auth.uid() is null or public.ve_finanzas());
  end if;
  if v_guardar then
    insert into public.contratos_pago (contrato_id, oferta, importe_centimos, metodo_pago)
    values (new.id, coalesce(nullif(new.oferta, ''), 'NINGUNA'), new.importe_centimos, nullif(new.metodo_pago, ''))
    on conflict (contrato_id) do update
      set oferta = excluded.oferta, importe_centimos = excluded.importe_centimos, metodo_pago = excluded.metodo_pago, actualizado_el = now();
  end if;
  new.oferta := 'NINGUNA';
  new.importe_centimos := null;
  new.metodo_pago := null;
  return new;
end $$;
create trigger contratos_pago_aparte before insert or update of oferta, importe_centimos, metodo_pago on public.contratos
  for each row execute function public.trg_contratos_pago_aparte();

-- -----------------------------------------------------------------------------
-- 4. contratos se vuelve a poder leer entera (las columnas de dinero van vacías)
-- -----------------------------------------------------------------------------
grant select on public.contratos to authenticated;

-- La vista de 0024, ahora desde contratos_pago.
create or replace view public.contratos_finanzas as
  select c.id, coalesce(p.oferta, 'NINGUNA') as oferta, p.importe_centimos, p.metodo_pago
    from public.contratos c
    left join public.contratos_pago p on p.contrato_id = c.id
   where public.ve_finanzas() and public.alcance_cliente(c.cliente_id);
comment on view public.contratos_finanzas is 'Oferta, importe y forma de pago de cada contrato. Solo devuelve filas a quien ve las finanzas, dentro de su ámbito.';
revoke all on public.contratos_finanzas from public, anon;
grant select on public.contratos_finanzas to authenticated;

-- -----------------------------------------------------------------------------
-- 5. editar_contrato: los datos de pago, directamente a contratos_pago (solo con ve_finanzas)
-- -----------------------------------------------------------------------------
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
         sesiones_restantes = case when v_tipo = 'BONO' then greatest(0, coalesce(p_sesiones_restantes, sesiones_restantes, 0)) else sesiones_restantes end
   where id = p_contrato_id;

  if public.ve_finanzas() then
    insert into public.contratos_pago (contrato_id, oferta, importe_centimos, metodo_pago)
    values (p_contrato_id, coalesce(nullif(p_oferta, ''), 'NINGUNA'), p_importe_centimos, nullif(p_metodo_pago, ''))
    on conflict (contrato_id) do update
      set oferta = excluded.oferta, importe_centimos = excluded.importe_centimos, metodo_pago = excluded.metodo_pago, actualizado_el = now();
  end if;

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
  'Modifica un contrato activo (fin, franjas, notas, sesiones de bono y, solo con ve_finanzas, datos de pago en contratos_pago) y rehace sus reservas automáticas futuras (y las pasadas si se pide).';
revoke all on function public.editar_contrato(uuid, date, uuid[], text, text, integer, text, integer, boolean) from public, anon;
grant execute on function public.editar_contrato(uuid, date, uuid[], text, text, integer, text, integer, boolean) to authenticated;
