-- =============================================================================
-- 0043_mover_fijos_de_franja.sql · Pasar los alumnos fijos de una franja a otra de una vez
--
--   Para reorganizar el horario sin editar contrato por contrato: los contratos de horario fijo
--   elegidos cambian la franja de origen por la de destino, sus reservas automáticas futuras de
--   la franja de origen se quitan (las hechas a mano o con recuperación no se tocan), se les apunta
--   a las clases futuras de la franja de destino (si hay sitio) y, si se pide, cada alumno recibe
--   un aviso con el cambio. Lo que ya ha empezado no se toca.
--   Se salta (con el motivo) un contrato si su tarifa no incluye la actividad de destino, si ya
--   tiene esa franja o si con el cambio se pasaría de las clases semanales de su tarifa.
--   Solo quien gestiona el horario, con ámbito de todo el centro. Idempotente.
-- =============================================================================

create or replace function public.mover_fijos_de_franja(p_origen uuid, p_destino uuid, p_contratos uuid[], p_avisar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_or       public.plantillas_clase%rowtype;
  v_de       public.plantillas_clase%rowtype;
  v_act_or   public.actividades%rowtype;
  v_act_de   public.actividades%rowtype;
  v_ahora    timestamp := public._ahora_local();
  v_dias     text[] := array['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
  k          record;
  v_cupo     integer;
  v_en_cat   integer;
  v_motivo   text;
  v_quitadas integer;
  v_nuevas   integer;
  v_sin      integer;
  v_aviso    uuid;
  v_movidos  integer := 0;
  v_sin_plaza integer := 0;
  v_saltados jsonb := '[]';
  v_avisos   uuid[] := '{}';
begin
  perform public._exigir('HORARIOS_GESTIONAR');
  if public.auth_ambito() = 'SUS_CLASES' then
    raise exception 'Con ámbito "Solo sus clases" no se puede modificar el horario.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_or from public.plantillas_clase where id = p_origen;
  if not found then raise exception 'La franja de origen no existe.'; end if;
  select * into v_de from public.plantillas_clase where id = p_destino;
  if not found then raise exception 'La franja de destino no existe.'; end if;
  if p_origen = p_destino then raise exception 'Elige una franja de destino distinta.'; end if;
  if not v_de.activa or v_de.eliminada_el is not null then raise exception 'La franja de destino no está activa.'; end if;
  select * into v_act_or from public.actividades where id = v_or.actividad_id;
  select * into v_act_de from public.actividades where id = v_de.actividad_id;

  for k in
    select c.*, t.nombre as tarifa_nombre
      from public.contratos c
      join public.contrato_franjas f on f.contrato_id = c.id and f.plantilla_id = p_origen
      join public.tarifas t on t.id = c.tarifa_id
     where c.id = any (coalesce(p_contratos, '{}')) and c.estado = 'ACTIVO' and c.modalidad = 'FIJO'
     order by c.id
     for update of c
  loop
    v_motivo := null;
    select tc.sesiones_semana into v_cupo from public.tarifa_cupos tc where tc.tarifa_id = k.tarifa_id and tc.categoria = v_act_de.categoria;
    if exists (select 1 from public.contrato_franjas f where f.contrato_id = k.id and f.plantilla_id = p_destino) then
      v_motivo := 'ya tiene esa franja';
    elsif v_cupo is null then
      v_motivo := format('su tarifa (%s) no incluye %s', k.tarifa_nombre, v_act_de.nombre);
    elsif cardinality(k.actividades_permitidas_ids) > 0 and not (v_act_de.id = any (k.actividades_permitidas_ids)) then
      v_motivo := format('su contratación no incluye %s', v_act_de.nombre);
    else
      select count(*) into v_en_cat from public.contrato_franjas f join public.plantillas_clase p on p.id = f.plantilla_id
        join public.actividades a on a.id = p.actividad_id
       where f.contrato_id = k.id and f.plantilla_id <> p_origen and a.categoria = v_act_de.categoria;
      if v_en_cat + 1 > v_cupo then v_motivo := format('pasaría de sus %s clases semanales de %s', v_cupo, lower(v_act_de.nombre)); end if;
    end if;
    if v_motivo is not null then
      v_saltados := v_saltados || jsonb_build_object('contrato', k.id, 'cliente', k.cliente_id, 'motivo', v_motivo);
      continue;
    end if;

    update public.contrato_franjas set plantilla_id = p_destino where contrato_id = k.id and plantilla_id = p_origen;
    -- Sus reservas automáticas de la franja de origen que aún no han empezado se quitan.
    with fuera as (
      delete from public.reservas r using public.clases c
       where c.id = r.clase_id and r.contrato_id = k.id and r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA'
         and c.plantilla_id = p_origen and (c.fecha + c.hora_inicio) > v_ahora
      returning r.id
    ) select count(*) into v_quitadas from fuera;
    v_nuevas := public._generar_reservas_automaticas(k.id, false);
    -- Clases futuras de destino (dentro del contrato) en las que se ha quedado sin plaza.
    select count(*) into v_sin from public.clases c
     where c.plantilla_id = p_destino and c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) > v_ahora
       and c.fecha between greatest(k.fecha_inicio, public._hoy()) and k.fecha_fin
       and not exists (select 1 from public.reservas r where r.clase_id = c.id and r.cliente_id = k.cliente_id
                        and r.estado in ('RESERVADA', 'CANCELADA_RECUPERABLE', 'CANCELADA_NO_RECUPERABLE'));
    v_sin_plaza := v_sin_plaza + v_sin;

    if coalesce(p_avisar, true) then
      insert into public.avisos (titulo, cuerpo, destino_tipo, importante, publicado_por)
      values (format('Cambio de horario: %s', v_act_de.nombre),
              format('Tu clase fija de %s de los %s a las %s pasa a %s los %s a las %s. Ya estás apuntado/a en las próximas clases.%s Si no puedes venir a alguna, cancélala desde la app.',
                     v_act_or.nombre, v_dias[v_or.dia_semana], to_char(v_or.hora_inicio, 'HH24:MI'),
                     case when v_act_de.id = v_act_or.id then '' else v_act_de.nombre || ',' end,
                     v_dias[v_de.dia_semana], to_char(v_de.hora_inicio, 'HH24:MI'),
                     case when v_sin > 0 then format(' En %s de ellas no había sitio: el centro lo revisará contigo.', v_sin) else '' end),
              'CLIENTES', true, auth.uid())
      returning id into v_aviso;
      insert into public.aviso_destinatarios (aviso_id, cliente_id) values (v_aviso, k.cliente_id);
      v_avisos := array_append(v_avisos, v_aviso);
    end if;
    perform public._auditar('MOVER_FIJO', 'contrato', k.id::text,
      format('%s: %s %s %s → %s %s %s (%s reservas quitadas, %s nuevas, %s sin plaza)', public._nombre_cliente(k.cliente_id),
             v_act_or.nombre, v_dias[v_or.dia_semana], to_char(v_or.hora_inicio, 'HH24:MI'),
             v_act_de.nombre, v_dias[v_de.dia_semana], to_char(v_de.hora_inicio, 'HH24:MI'), v_quitadas, v_nuevas, v_sin));
    v_movidos := v_movidos + 1;
  end loop;

  return jsonb_build_object('movidos', v_movidos, 'saltados', v_saltados, 'sin_plaza', v_sin_plaza, 'avisos', to_jsonb(v_avisos));
end $$;
comment on function public.mover_fijos_de_franja(uuid, uuid, uuid[], boolean) is 'Pasa los contratos fijos elegidos de una franja a otra, con sus reservas futuras y aviso (0043).';
revoke all on function public.mover_fijos_de_franja(uuid, uuid, uuid[], boolean) from public, anon;
grant execute on function public.mover_fijos_de_franja(uuid, uuid, uuid[], boolean) to authenticated;
