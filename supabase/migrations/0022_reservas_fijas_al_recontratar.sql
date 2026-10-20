-- =============================================================================
-- 0022_reservas_fijas_al_recontratar.sql · Las reservas fijas no se pierden al cambiar la contratación
--
--   Lo que pasó (octubre de 2026): al "Finalizar contrato" de una alumna de horario fijo (con
--   "cancelar sus reservas futuras") y darle después una contratación nueva con las mismas
--   franjas, sus clases fijas NO se volvían a apuntar: el generador de reservas automáticas
--   saltaba cualquier clase en la que la alumna ya tuviera una reserva, aunque estuviera
--   cancelada por el centro. La alumna veía todas sus clases "canceladas por el centro" y el
--   centro tenía que apuntarla a mano semana a semana.
--
--   Ahora:
--   1. Una reserva cancelada por el centro en una clase que sigue programada no bloquea: se
--      vuelve a activar con el contrato nuevo. (Las canceladas por la alumna sí siguen
--      bloqueando: ella decidió no ir ese día.)
--   2. Al crear una contratación nueva de horario fijo, las clases fijas futuras que ya tenía
--      con el contrato anterior, en franjas que siguen, pasan al contrato nuevo.
--      Las reservas fijas de franjas que ya no tiene se quitan (como al editar el contrato): si se
--      quedaban, la alumna seguía apuntada a clases de un horario que ya no era el suyo.
--   3. El "cambio" de clase desde la lista de espera (0021) ya no mueve la reserva antigua:
--      la deja cancelada en su clase y crea una nueva. Si se movía, el mantenimiento nocturno
--      volvía a apuntar a la alumna en su clase fija y acababa en las dos.
--   Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Generador de reservas automáticas: revive las canceladas por el centro.
-- -----------------------------------------------------------------------------
create or replace function public._generar_reservas_automaticas(p_contrato_id uuid, p_incluir_pasadas boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_contrato public.contratos%rowtype;
  v_desde    date;
  c          record;
  v_ocupadas integer;
  v_revivir  uuid;
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
       -- Bloquean: tener ya plaza, o haberla cancelado la propia alumna (decidió no ir ese día).
       -- No bloquea una cancelación "por el centro" (p. ej. al finalizar el contrato anterior): se revive.
       and not exists (select 1 from public.reservas r
                        where r.clase_id = cl.id and r.cliente_id = v_contrato.cliente_id
                          and r.estado in ('RESERVADA', 'CANCELADA_RECUPERABLE', 'CANCELADA_NO_RECUPERABLE'))
     order by cl.fecha, cl.hora_inicio
     for update of cl
  loop
    select count(*) into v_ocupadas from public.reservas where clase_id = c.id and estado = 'RESERVADA';
    if v_ocupadas >= c.plazas then continue; end if;  -- sin plaza: el centro lo verá en el calendario
    select r.id into v_revivir from public.reservas r
     where r.clase_id = c.id and r.cliente_id = v_contrato.cliente_id and r.estado = 'CANCELADA_CENTRO'
     order by r.cancelado_el desc nulls last, r.creado_el desc limit 1;
    if v_revivir is not null then
      update public.reservas
         set estado = 'RESERVADA', contrato_id = v_contrato.id, origen = 'AUTOMATICA', recuperacion_usada_id = null,
             cancelado_el = null, cancelado_por = null, asistencia = 'PENDIENTE'
       where id = v_revivir;
    else
      insert into public.reservas (clase_id, cliente_id, contrato_id, origen, creado_por)
      values (c.id, v_contrato.cliente_id, v_contrato.id, 'AUTOMATICA', null);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
comment on function public._generar_reservas_automaticas(uuid, boolean) is
  'Apunta al alumno de horario fijo a las clases de sus franjas que le falten. Una reserva cancelada por el centro en una clase que sigue programada se vuelve a activar.';
revoke all on function public._generar_reservas_automaticas(uuid, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. crear_contrato: conserva las clases fijas del contrato anterior (misma firma que 0019).
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
  v_previos uuid[];
  v_conservadas integer := 0;
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
    -- Las demás reservas fijas futuras del contrato anterior (franjas que ya no tiene, o nueva
    -- modalidad sin horario fijo) se quitan, como al editar un contrato: el horario fijo va con el
    -- contrato. Las hechas a mano, con bono o con recuperación no se tocan.
    delete from public.reservas r using public.clases c
     where c.id = r.clase_id and r.contrato_id = any (v_previos) and r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA'
       and c.fecha >= greatest(p_fecha_inicio, public._hoy());
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
    format('%s: %s %s→%s (%s reservas automáticas%s%s, %s cobros)', public._nombre_cliente(p_cliente_id), v_tarifa.nombre, p_fecha_inicio, v_fin, v_n, case when coalesce(p_incluir_pasadas, false) then ', con las pasadas' else '' end,
           case when v_conservadas > 0 then format(', %s conservadas del contrato anterior', v_conservadas) else '' end, v_cobros));
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Lista de espera: el "cambio" cancela la reserva antigua y crea una nueva (misma firma que 0021).
-- -----------------------------------------------------------------------------
create or replace function public._promover_lista_espera(p_clase_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_clase    public.clases%rowtype;
  v_act      public.actividades%rowtype;
  v_libres   integer;
  v_n        integer := 0;
  e          record;
  v_reserva  public.reservas%rowtype;
  v_origen   public.clases%rowtype;
  v_contrato public.contratos%rowtype;
  v_ev       jsonb;
  v_via      text;
  v_motivo   text;
  v_reserva_id uuid;
  v_cuerpo   text;
  v_aviso_id uuid;
begin
  if coalesce(current_setting('app.sin_promocion', true), '') = '1' then return 0; end if;
  if pg_trigger_depth() > 6 then return 0; end if;  -- cadenas de cambios: nunca sin fin
  select * into v_clase from public.clases where id = p_clase_id for update;
  if not found or v_clase.estado <> 'PROGRAMADA' then return 0; end if;
  if (v_clase.fecha + v_clase.hora_inicio) < public._ahora_local() + make_interval(hours => public._horas_cierre_lista_espera()) then return 0; end if;
  if not exists (select 1 from public.lista_espera where clase_id = p_clase_id) then return 0; end if;
  select * into v_act from public.actividades where id = v_clase.actividad_id;

  for e in select * from public.lista_espera where clase_id = p_clase_id order by creado_el, id loop
    select v_clase.plazas - count(*) into v_libres from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA';
    exit when v_libres <= 0;
    -- Cada entrada por separado: si una falla, se quita de la lista y se sigue con la siguiente.
    begin
      -- Se quita antes de reservar: así ni se procesa dos veces ni la ven los disparadores anidados.
      delete from public.lista_espera where id = e.id;
      v_motivo := null;
      v_cuerpo := null;
      if e.reserva_cambio_id is not null then
        select * into v_reserva from public.reservas where id = e.reserva_cambio_id and cliente_id = e.cliente_id for update;
        v_motivo := public._motivo_no_cambio(v_reserva, v_clase);
        if v_motivo is null then
          select * into v_origen from public.clases where id = v_reserva.clase_id;
          -- 0022: la reserva antigua queda cancelada (sin recuperación: la clase se cambia, no se pierde) y se
          -- crea una nueva en esta clase con los mismos derechos. Así la antigua sigue constando en su clase
          -- fija y el mantenimiento nocturno no vuelve a apuntarle allí.
          update public.reservas
             set estado = 'CANCELADA_RECUPERABLE', cancelado_el = now(), cancelado_por = null, recuperacion_usada_id = null
           where id = v_reserva.id;
          insert into public.reservas (clase_id, cliente_id, contrato_id, origen, recuperacion_usada_id, creado_por)
          values (p_clase_id, e.cliente_id, v_reserva.contrato_id,
                  case v_reserva.origen when 'AUTOMATICA' then 'CLIENTE'::public.origen_reserva when 'MANUAL' then 'CLIENTE'::public.origen_reserva else v_reserva.origen end,
                  v_reserva.recuperacion_usada_id, null)
          returning id into v_reserva_id;  -- el disparador de aforo vigila la plaza
          if v_reserva.recuperacion_usada_id is not null then
            update public.recuperaciones set usada_en_reserva_id = v_reserva_id where id = v_reserva.recuperacion_usada_id;
          end if;
          v_via := 'CAMBIO';
          v_cuerpo := format('Se ha liberado una plaza y te hemos apuntado desde la lista de espera. Tu clase del %s a las %s queda cambiada por esta.',
                             to_char(v_origen.fecha, 'DD/MM'), to_char(v_origen.hora_inicio, 'HH24:MI'));
        end if;
      else
        v_ev := public._evaluar_reserva(p_clase_id, e.cliente_id, false);
        if (v_ev->>'ok')::boolean then
          v_via := v_ev->>'via';
          v_contrato := public._contrato_activo(e.cliente_id, v_clase.fecha);
          insert into public.reservas (clase_id, cliente_id, contrato_id, origen, recuperacion_usada_id, creado_por)
          values (p_clase_id, e.cliente_id, v_contrato.id,
                  case v_via when 'RECUPERACION' then 'RECUPERACION'::public.origen_reserva when 'BONO' then 'BONO'::public.origen_reserva else 'CLIENTE'::public.origen_reserva end,
                  (v_ev->>'recuperacion_id')::uuid, null)
          returning id into v_reserva_id;
          if v_via = 'RECUPERACION' then
            update public.recuperaciones set estado = 'USADA', usada_en_reserva_id = v_reserva_id where id = (v_ev->>'recuperacion_id')::uuid;
          elsif v_via = 'BONO' and v_contrato.id is not null then
            update public.contratos set sesiones_restantes = coalesce(sesiones_restantes, 1) - 1 where id = v_contrato.id;
          end if;
          v_cuerpo := 'Se ha liberado una plaza y te hemos apuntado desde la lista de espera. ' || coalesce(v_ev->>'mensaje', '');
        elsif v_ev->>'codigo' = 'YA_RESERVADA' then
          -- Ya tenía plaza (p. ej. se la dio el personal): sin aviso.
          continue;
        else
          v_motivo := v_ev->>'motivo';
        end if;
      end if;

      if v_motivo is not null then
        -- No ha podido entrar: se le avisa y pasa el turno al siguiente.
        insert into public.avisos (titulo, cuerpo, destino_tipo, importante, publicado_por)
        values (format('Lista de espera: %s %s %s', v_act.nombre, to_char(v_clase.fecha, 'DD/MM'), to_char(v_clase.hora_inicio, 'HH24:MI')),
                'Se ha liberado una plaza pero no hemos podido reservártela: ' || v_motivo || ' Te hemos quitado de la lista de espera.',
                'CLIENTES', false, null)
        returning id into v_aviso_id;
        insert into public.aviso_destinatarios (aviso_id, cliente_id) values (v_aviso_id, e.cliente_id);
        insert into public.avisos_push_pendientes (aviso_id) values (v_aviso_id) on conflict do nothing;
        perform public._auditar('LISTA_ESPERA', 'clase', p_clase_id::text,
          format('%s no entra desde la lista (%s) · %s', public._nombre_cliente(e.cliente_id), v_motivo, public._desc_clase(p_clase_id)));
        continue;
      end if;

      v_n := v_n + 1;
      insert into public.avisos (titulo, cuerpo, destino_tipo, importante, publicado_por)
      values (format('¡Tienes plaza! %s %s %s', v_act.nombre, to_char(v_clase.fecha, 'DD/MM'), to_char(v_clase.hora_inicio, 'HH24:MI')),
              v_cuerpo, 'CLIENTES', true, null)
      returning id into v_aviso_id;
      insert into public.aviso_destinatarios (aviso_id, cliente_id) values (v_aviso_id, e.cliente_id);
      insert into public.avisos_push_pendientes (aviso_id) values (v_aviso_id) on conflict do nothing;
      perform public._auditar('LISTA_ESPERA', 'reserva', v_reserva_id::text,
        format('%s entra desde la lista de espera (%s) · %s', public._nombre_cliente(e.cliente_id), v_via, public._desc_clase(p_clase_id)));
    exception when others then
      -- La entrada ya se ha borrado dentro del bloque (se deshace con él); se borra fuera y se sigue.
      delete from public.lista_espera where id = e.id;
      perform public._auditar('LISTA_ESPERA', 'clase', p_clase_id::text,
        format('%s no entra desde la lista (error: %s) · %s', public._nombre_cliente(e.cliente_id), sqlerrm, public._desc_clase(p_clase_id)));
    end;
  end loop;
  return v_n;
end $$;
revoke all on function public._promover_lista_espera(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Reparación de los datos de octubre (una sola vez; no hace nada si no hay qué reparar).
-- -----------------------------------------------------------------------------
-- a) Filas "cancelada por el centro" que sobran: el alumno ya tiene plaza en esa misma clase
--    (el centro se la volvió a dar a mano). Solo confundían ("tienes las clases canceladas").
delete from public.reservas r
 using public.clases c
 where c.id = r.clase_id and r.estado = 'CANCELADA_CENTRO' and c.estado = 'PROGRAMADA' and c.fecha >= public._hoy()
   and exists (select 1 from public.reservas r2 where r2.clase_id = r.clase_id and r2.cliente_id = r.cliente_id and r2.estado = 'RESERVADA');

-- b) Volver a apuntar ya a los alumnos de horario fijo que se quedaron sin sus clases
--    (lo haría el mantenimiento nocturno, pero así no hay que esperar a mañana).
do $$
declare k record; v_n integer; v_total integer := 0;
begin
  for k in select id from public.contratos where estado = 'ACTIVO' and modalidad = 'FIJO' loop
    v_n := public._generar_reservas_automaticas(k.id);
    v_total := v_total + v_n;
  end loop;
  raise notice '0022: % reservas fijas recuperadas.', v_total;
end $$;
