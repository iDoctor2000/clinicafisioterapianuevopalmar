-- =============================================================================
-- 0024_finanzas.sql · Quién ve el dinero
--
--   Hasta ahora, cualquier trabajador que pudiera ver o editar fichas veía también los
--   importes, las ofertas, la forma de pago y los cobros de cada alumno, y el rol ADMIN
--   lo veía todo siempre. A partir de aquí:
--
--     1. `trabajadores.ve_finanzas`: acceso explícito a las finanzas. NO lo da el rol
--        ADMIN: se concede persona a persona. `public.ve_finanzas()` lo comprueba.
--     2. Solo quien lo tiene puede concederlo o quitarlo (si lo intenta otro, el valor
--        se conserva sin más, sin error), y no puede quedarse nadie con él.
--     3. `pagos`: solo se leen y escriben con ve_finanzas (y dentro del ámbito).
--     4. `contratos`: las columnas oferta, importe_centimos y metodo_pago dejan de poder
--        leerse en la tabla (permisos por columna). Se leen en la vista
--        `contratos_finanzas`, que solo devuelve filas a quien tiene ve_finanzas.
--     5. `editar_contrato`: si quien edita no ve las finanzas, los datos de pago del
--        contrato se conservan tal cual (la app no se los manda).
--
--   Tras ejecutarla hay que conceder el acceso a las personas que corresponda:
--     update public.trabajadores set ve_finanzas = true where lower(email) in ('…', '…');
--   Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La columna y la función
-- -----------------------------------------------------------------------------
alter table public.trabajadores add column if not exists ve_finanzas boolean not null default false;
comment on column public.trabajadores.ve_finanzas is 'Ve importes, ofertas, forma de pago y cobros. Explícito: el rol ADMIN no lo incluye.';

create or replace function public.ve_finanzas()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trabajadores t
     where t.user_id = auth.uid() and t.activo and t.ve_finanzas
  )
$$;
comment on function public.ve_finanzas() is 'true si el usuario actual es un trabajador activo con acceso a las finanzas.';
revoke all on function public.ve_finanzas() from public, anon;
grant execute on function public.ve_finanzas() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Solo quien ve las finanzas puede dar o quitar el acceso; nunca se queda nadie
-- -----------------------------------------------------------------------------
create or replace function public.trg_trabajadores_finanzas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- sistema (editor SQL, pg_cron): sin límites
  if tg_op = 'INSERT' then
    if new.ve_finanzas and not public.ve_finanzas() then new.ve_finanzas := false; end if;
    return new;
  end if;
  if new.ve_finanzas is distinct from old.ve_finanzas then
    if not public.ve_finanzas() then
      new.ve_finanzas := old.ve_finanzas; -- se conserva en silencio
    elsif not new.ve_finanzas and not exists (
      select 1 from public.trabajadores t where t.ve_finanzas and t.activo and t.id <> old.id
    ) then
      raise exception 'Tiene que quedar al menos una persona con acceso a las finanzas.' using errcode = 'check_violation';
    end if;
  end if;
  -- Dar de baja al último con acceso lo dejaría sin nadie.
  if old.ve_finanzas and old.activo and not new.activo and new.ve_finanzas and not exists (
    select 1 from public.trabajadores t where t.ve_finanzas and t.activo and t.id <> old.id
  ) then
    raise exception 'Tiene que quedar al menos una persona activa con acceso a las finanzas.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trabajadores_finanzas on public.trabajadores;
create trigger trabajadores_finanzas before insert or update on public.trabajadores
  for each row execute function public.trg_trabajadores_finanzas();

-- -----------------------------------------------------------------------------
-- 3. Cobros: solo con ve_finanzas
-- -----------------------------------------------------------------------------
drop policy if exists pagos_leer on public.pagos;
create policy pagos_leer on public.pagos for select to authenticated
  using (public.ve_finanzas() and public.alcance_cliente(cliente_id));
drop policy if exists pagos_escribir on public.pagos;
create policy pagos_escribir on public.pagos for all to authenticated
  using (public.ve_finanzas() and public.tiene_permiso('CLIENTES_EDITAR') and public.alcance_cliente(cliente_id))
  with check (
    public.ve_finanzas() and public.tiene_permiso('CLIENTES_EDITAR') and public.alcance_cliente(cliente_id)
    and (contrato_id is null or exists (select 1 from public.contratos c where c.id = contrato_id and c.cliente_id = pagos.cliente_id))
  );

-- -----------------------------------------------------------------------------
-- 4. Contratos: los datos de pago solo se leen en la vista contratos_finanzas
-- -----------------------------------------------------------------------------
revoke select on public.contratos from authenticated;
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'contratos'
     and column_name not in ('oferta', 'importe_centimos', 'metodo_pago');
  execute format('grant select (%s) on public.contratos to authenticated', v_cols);
end $$;

create or replace view public.contratos_finanzas as
  select c.id, c.oferta, c.importe_centimos, c.metodo_pago
    from public.contratos c
   where public.ve_finanzas() and public.alcance_cliente(c.cliente_id);
comment on view public.contratos_finanzas is 'Oferta, importe y forma de pago de cada contrato. Solo devuelve filas a quien ve las finanzas, dentro de su ámbito.';
revoke all on public.contratos_finanzas from public, anon;
grant select on public.contratos_finanzas to authenticated;

-- -----------------------------------------------------------------------------
-- 5. editar_contrato: sin ve_finanzas, los datos de pago no se tocan
-- -----------------------------------------------------------------------------
-- Misma firma que en 0019 (con p_incluir_pasadas); por si acaso, fuera la antigua de 0013.
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
  v_fin   boolean := public.ve_finanzas();
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
         oferta           = case when v_fin then coalesce(nullif(p_oferta, ''), 'NINGUNA') else oferta end,
         importe_centimos = case when v_fin then p_importe_centimos else importe_centimos end,
         metodo_pago      = case when v_fin then nullif(p_metodo_pago, '') else metodo_pago end,
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
  'Modifica un contrato activo (fin, franjas, notas, sesiones de bono y, solo con ve_finanzas, datos de pago) y rehace sus reservas automáticas futuras (y las pasadas si se pide).';
revoke all on function public.editar_contrato(uuid, date, uuid[], text, text, integer, text, integer, boolean) from public, anon;
grant execute on function public.editar_contrato(uuid, date, uuid[], text, text, integer, text, integer, boolean) to authenticated;
