-- =============================================================================
-- 0034_clases_tambien_en.sql · Una tarifa de Reformer puede cambiar una clase por una dirigida (no al revés)
--
--   Lo que pasaba: una alumna con "Reformer + Torre · 1 día/semana" quiso cambiar su Reformer por
--   una clase Funcional y la app lo bloqueaba ("Tu tarifa no incluye actividades dirigidas"), también
--   al personal al apuntarla con su tarifa (solo quedaba "manual"). El centro quiere que quien tiene
--   Reformer SÍ pueda ir a una dirigida a cambio de su clase; quien tiene dirigidas, a Reformer no.
--
--   Ahora, por tarifa (Tarifas → "Sus clases también valen para"): `tarifas.cupo_categorias_extra`.
--   Si una categoría está ahí, para TODOS los alumnos con esa tarifa:
--     · Una clase de esa categoría cuenta como una de sus clases de la semana (contra el total
--       semanal de la tarifa), o como una sesión del bono.
--     · Las recuperaciones de la tarifa también se pueden usar en esa categoría.
--     · "A cambio de otra clase mía" (lista de espera) admite ese cambio de categoría.
--     · Con horario fijo: fuera de su franja, si esa semana no tiene su clase (p. ej. no había plaza),
--       puede usarla en otra clase. Si la tiene, o la canceló (con recuperación o sin ella), o se la
--       canceló el centro, necesita recuperación, como hasta ahora: así nunca tiene la clase dos veces.
--   Se activa para las tarifas que solo tienen Reformer (recurrentes y bonos). Las de dirigidas, no.
--   Idempotente.
-- =============================================================================

alter table public.tarifas add column if not exists cupo_categorias_extra public.categoria[] not null default '{}';
comment on column public.tarifas.cupo_categorias_extra is 'Categorías en las que también se pueden usar las clases de la tarifa (a cambio de las suyas). Ej.: Reformer → DIRIGIDA.';

-- -----------------------------------------------------------------------------
-- 1. Recuperaciones: valen también en esas categorías
-- -----------------------------------------------------------------------------
create or replace function public._categorias_permitidas_recuperacion(p_origen public.categoria, p_tarifa_id uuid)
returns public.categoria[] language sql stable security definer set search_path = public as $$
  select array_agg(distinct x order by x)
    from unnest(array[p_origen]
                || coalesce((select t.recuperacion_categorias_extra || t.cupo_categorias_extra from public.tarifas t where t.id = p_tarifa_id), '{}')) x
$$;

-- -----------------------------------------------------------------------------
-- 2. Cupo consumido: igual que siempre; categoría null = total de la semana; p_estricto (horario fijo):
--    una cancelación que dio recuperación también cuenta (el derecho está en la recuperación).
-- -----------------------------------------------------------------------------
-- La firma antigua (3 parámetros) se quita: con el parámetro opcional serían ambiguas.
drop function if exists public._cupo_consumido_en_semana(uuid, public.categoria, date);
create or replace function public._cupo_consumido_en_semana(p_contrato_id uuid, p_categoria public.categoria, p_fecha date, p_estricto boolean default false)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.reservas r
    join public.clases c on c.id = r.clase_id
    join public.actividades a on a.id = c.actividad_id
   where r.contrato_id = p_contrato_id
     and (public._consume_cupo(r.estado, r.origen)
          or (p_estricto and r.origen <> 'RECUPERACION' and exists (select 1 from public.recuperaciones x where x.reserva_origen_id = r.id)))
     and public._inicio_semana(c.fecha) = public._inicio_semana(p_fecha)
     and (p_categoria is null or a.categoria = p_categoria)
$$;
comment on function public._cupo_consumido_en_semana(uuid, public.categoria, date, boolean) is
  'Clases del contrato que gastan cupo en la semana de la fecha (reservadas o canceladas sin recuperación; con p_estricto, también las canceladas con recuperación). Categoría null = todas.';

-- -----------------------------------------------------------------------------
-- 3. _evaluar_reserva: categorías "también" y horario fijo con la clase de la semana libre
-- -----------------------------------------------------------------------------
create or replace function public._evaluar_reserva(p_clase_id uuid, p_cliente_id uuid, p_ignorar_plazas boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg      public.config_centro%rowtype;
  v_clase    public.clases%rowtype;
  v_act      public.actividades%rowtype;
  v_contrato public.contratos%rowtype;
  v_tarifa   public.tarifas%rowtype;
  v_rec      jsonb;
  v_ocupadas integer;
  v_cupo     integer;
  v_usadas   integer;
  v_cat_label text;
  v_tambien  boolean := false;  -- la categoría de la clase no es de la tarifa, pero vale "a cambio"
  v_cat_cupo public.categoria;  -- categoría con la que se cuenta el cupo (null = total de la tarifa)
begin
  select * into v_cfg from public.config_centro limit 1;
  select * into v_clase from public.clases where id = p_clase_id;
  if not found then return public._bloqueo('CLASE_NO_EXISTE', 'La clase no existe.'); end if;
  select * into v_act from public.actividades where id = v_clase.actividad_id;
  v_cat_label := case v_act.categoria when 'REFORMER' then 'Reformer' else 'Actividades dirigidas' end;

  if v_clase.estado = 'CANCELADA' then return public._bloqueo('CLASE_CANCELADA', 'Esta clase ha sido cancelada por el centro.'); end if;
  if (v_clase.fecha + v_clase.hora_inicio) < public._ahora_local() then
    return public._bloqueo('CLASE_PASADA', 'Esta clase ya ha pasado.');
  end if;
  if exists (select 1 from public.reservas where clase_id = p_clase_id and cliente_id = p_cliente_id and estado = 'RESERVADA') then
    return public._bloqueo('YA_RESERVADA', 'Ya tienes plaza en esta clase.');
  end if;
  select count(*) into v_ocupadas from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA';
  if not coalesce(p_ignorar_plazas, false) and v_clase.plazas - v_ocupadas <= 0 then
    return public._bloqueo('SIN_PLAZAS', 'No quedan plazas libres.');
  end if;
  if v_clase.fecha > public._hoy() + v_cfg.dias_ventana_reserva then
    return public._bloqueo('FUERA_VENTANA', format('Solo se puede reservar con %s días de antelación.', v_cfg.dias_ventana_reserva));
  end if;

  -- 1) Recuperación disponible que cubra esta categoría (la que antes caduque).
  select jsonb_build_object('ok', true, 'via', 'RECUPERACION', 'recuperacion_id', r.id, 'mensaje', 'Se utilizará una recuperación.')
    into v_rec
    from public.recuperaciones r
   where r.cliente_id = p_cliente_id and r.estado = 'DISPONIBLE' and r.caduca_el >= v_clase.fecha
     and v_act.categoria = any (r.categorias_permitidas)
   order by r.caduca_el, r.creado_el
   limit 1;

  -- 2) Derechos de la tarifa.
  v_contrato := public._contrato_activo(p_cliente_id, v_clase.fecha);
  if v_contrato.id is not null then
    select * into v_tarifa from public.tarifas where id = v_contrato.tarifa_id;
  end if;

  if v_contrato.id is null or v_tarifa.id is null then
    return coalesce(v_rec, public._bloqueo('SIN_CONTRATO', 'No tienes una tarifa activa. Consulta en recepción.'));
  end if;
  if v_clase.fecha < v_contrato.fecha_inicio or v_clase.fecha > v_contrato.fecha_fin then
    return coalesce(v_rec, public._bloqueo('FUERA_PERIODO', 'La clase está fuera del periodo de tu tarifa.'));
  end if;
  if cardinality(v_contrato.actividades_permitidas_ids) > 0 and not (v_act.id = any (v_contrato.actividades_permitidas_ids)) then
    return coalesce(v_rec, public._bloqueo('ACTIVIDAD_NO_PERMITIDA', format('Tu tarifa no incluye %s.', v_act.nombre)));
  end if;
  v_tambien := v_act.categoria = any (v_tarifa.cupo_categorias_extra);

  if v_tarifa.tipo = 'BONO' then
    if v_tarifa.bono_categoria <> v_act.categoria and not v_tambien then
      return coalesce(v_rec, public._bloqueo('ACTIVIDAD_NO_PERMITIDA',
        format('Tu bono es de %s.', case v_tarifa.bono_categoria when 'REFORMER' then 'Reformer' else 'Actividades dirigidas' end)));
    end if;
    if coalesce(v_contrato.sesiones_restantes, 0) > 0 then
      return jsonb_build_object('ok', true, 'via', 'BONO',
        'mensaje', format('Se descontará 1 sesión de tu bono (te quedarán %s).', coalesce(v_contrato.sesiones_restantes, 1) - 1));
    end if;
    return coalesce(v_rec, public._bloqueo('BONO_AGOTADO', 'Tu bono no tiene sesiones disponibles.'));
  end if;

  if v_tarifa.tipo = 'RECURRENTE' then
    select tc.sesiones_semana into v_cupo from public.tarifa_cupos tc where tc.tarifa_id = v_tarifa.id and tc.categoria = v_act.categoria;
    if v_cupo is not null then
      v_cat_cupo := v_act.categoria;
    elsif v_tambien then
      -- 0034: cuenta contra el total de clases semanales de la tarifa (a cambio de una de las suyas).
      select sum(tc.sesiones_semana) into v_cupo from public.tarifa_cupos tc where tc.tarifa_id = v_tarifa.id;
      v_cat_cupo := null;
    else
      return coalesce(v_rec, public._bloqueo('ACTIVIDAD_NO_PERMITIDA', format('Tu tarifa no incluye %s.', lower(v_cat_label))));
    end if;
    if v_contrato.modalidad = 'FIJO' and v_clase.plantilla_id is not null
       and exists (select 1 from public.contrato_franjas f where f.contrato_id = v_contrato.id and f.plantilla_id = v_clase.plantilla_id) then
      return jsonb_build_object('ok', true, 'via', 'CUPO_SEMANAL', 'mensaje', 'Es tu clase habitual.');
    end if;
    -- 0034: con horario fijo, fuera de su franja solo si esa semana no tiene su clase ni recuperación por ella.
    v_usadas := public._cupo_consumido_en_semana(v_contrato.id, v_cat_cupo, v_clase.fecha, v_contrato.modalidad = 'FIJO');
    if v_usadas < coalesce(v_cupo, 0) then
      return jsonb_build_object('ok', true, 'via', 'CUPO_SEMANAL', 'mensaje',
        case when v_contrato.modalidad = 'FIJO' then 'A cambio de tu clase habitual de esta semana.'
             when v_tambien then format('Clase %s de %s de esta semana (a cambio de una de las tuyas).', v_usadas + 1, v_cupo)
             else format('Clase %s de %s de esta semana.', v_usadas + 1, v_cupo) end);
    end if;
    if v_rec is not null then
      return v_rec || jsonb_build_object('mensaje', 'Semana completa: se utilizará una recuperación.');
    end if;
    if v_contrato.modalidad = 'FIJO' then
      return public._bloqueo('HORARIO_FIJO', 'Tienes horario fijo y esta semana ya tienes tu clase. Para asistir a otra necesitas una recuperación disponible.');
    end if;
    return public._bloqueo('CUPO_AGOTADO', format('Ya tienes las %s clases de esta semana.', v_cupo));
  end if;

  -- CLASE_SUELTA: solo la introduce el personal.
  return coalesce(v_rec, public._bloqueo('SIN_CONTRATO', 'Las clases sueltas se reservan en recepción.'));
end $$;
revoke all on function public._cupo_consumido_en_semana(uuid, public.categoria, date, boolean) from public, anon, authenticated;
revoke all on function public._evaluar_reserva(uuid, uuid, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. "A cambio de otra clase mía": admite el cambio de categoría si la tarifa lo permite
-- -----------------------------------------------------------------------------
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
  if public._inicio_semana(v_origen.fecha) <> public._inicio_semana(p_clase.fecha) then
    return 'Solo se puede cambiar por una clase de la misma semana. Para otra semana, cancela tu clase y apúntate a la lista normalmente.';
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
    if cardinality(v_contrato.actividades_permitidas_ids) > 0 and not (v_act_dest.id = any (v_contrato.actividades_permitidas_ids)) then
      return format('Tu tarifa no incluye %s.', v_act_dest.nombre);
    end if;
  end if;
  return null;
end $$;
revoke all on function public._motivo_no_cambio(public.reservas, public.clases) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Las tarifas que solo tienen Reformer: sus clases también valen para dirigidas
-- -----------------------------------------------------------------------------
update public.tarifas t
   set cupo_categorias_extra = array['DIRIGIDA']::public.categoria[]
 where not ('DIRIGIDA' = any (t.cupo_categorias_extra))
   and ((t.tipo = 'RECURRENTE'
         and exists (select 1 from public.tarifa_cupos c where c.tarifa_id = t.id and c.categoria = 'REFORMER')
         and not exists (select 1 from public.tarifa_cupos c where c.tarifa_id = t.id and c.categoria = 'DIRIGIDA'))
        or (t.tipo = 'BONO' and t.bono_categoria = 'REFORMER'));
