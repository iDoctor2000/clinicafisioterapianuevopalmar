-- =============================================================================
-- 0039_cambios_sin_publicar.sql · Preparar el horario sin que los alumnos lo vean
--
--   Mientras el equipo reorganiza el horario, lo nuevo no se ve y los huecos que libera no se
--   ofrecen, hasta que alguien que gestiona el horario pulsa «Publicar cambios»:
--   1. Las franjas y las clases extraordinarias nuevas nacen SIN PUBLICAR (`publicada = false`):
--      un alumno no las ve (salvo que ya tenga plaza en una de sus clases), ni se las ofrece la
--      app ni el servidor. Editar una franja que ya existe se aplica al momento, como hasta ahora.
--   2. PLAZAS RETENIDAS: si alguien que gestiona el horario quita a un alumno de una clase futura
--      (o se le quita al cambiarle el horario fijo), esa plaza queda retenida: los alumnos la ven
--      ocupada y la lista de espera no la da. Si el equipo apunta a alguien en esa clase, usa una
--      retenida. Lo que hace el propio alumno (cancelar, reservar, cambiar) no retiene nada.
--   3. `publicar_cambios(p_avisar, p_texto)`: publica franjas y clases, libera las plazas
--      retenidas (y da las que toquen a la lista de espera) y, si se pide, avisa a todos.
--   Idempotente.
-- =============================================================================

alter table public.plantillas_clase add column if not exists publicada boolean not null default true;
comment on column public.plantillas_clase.publicada is 'false = borrador: los alumnos no ven la franja ni sus clases hasta «Publicar cambios» (0039).';
alter table public.clases add column if not exists publicada boolean not null default true;
comment on column public.clases.publicada is 'false = sin publicar: los alumnos no la ven (salvo que tengan plaza) hasta «Publicar cambios» (0039).';
alter table public.clases add column if not exists plazas_retenidas integer not null default 0;
alter table public.clases drop constraint if exists clases_plazas_retenidas_check;
alter table public.clases add constraint clases_plazas_retenidas_check check (plazas_retenidas >= 0);
comment on column public.clases.plazas_retenidas is 'Plazas que liberó el equipo y que los alumnos no ven hasta «Publicar cambios» (0039).';

-- -----------------------------------------------------------------------------
-- 1. Lo que no está publicado no lo ve un alumno (salvo que tenga plaza o sea su franja fija)
-- -----------------------------------------------------------------------------
drop policy if exists clases_leer on public.clases;
create policy clases_leer on public.clases for select to authenticated
  using (publicada or public.auth_cliente_id() is null
         or exists (select 1 from public.reservas r where r.clase_id = clases.id and r.cliente_id = public.auth_cliente_id() and r.estado = 'RESERVADA'));
drop policy if exists plantillas_leer on public.plantillas_clase;
create policy plantillas_leer on public.plantillas_clase for select to authenticated
  using (publicada or public.auth_cliente_id() is null
         or exists (select 1 from public.contrato_franjas f join public.contratos k on k.id = f.contrato_id
                     where f.plantilla_id = plantillas_clase.id and k.cliente_id = public.auth_cliente_id()));

-- Las clases nacen publicadas o no según su franja.
create or replace function public._generar_clases(p_desde date, p_hasta date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into public.clases (plantilla_id, actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas, publicada)
  select p.id, p.actividad_id, d::date, p.hora_inicio, p.duracion_min, p.monitor_id, p.plazas, p.publicada
    from generate_series(p_desde, p_hasta, interval '1 day') d
    join public.plantillas_clase p on p.activa and p.dia_semana = extract(isodow from d)
   where not exists (select 1 from public.dias_cierre dc where dc.fecha = d::date)
     and (p.vigencia_desde is null or d::date >= p.vigencia_desde)
     and (p.vigencia_hasta is null or d::date <= p.vigencia_hasta)
  on conflict (plantilla_id, fecha) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Plazas retenidas
-- -----------------------------------------------------------------------------
-- Para un alumno, las retenidas cuentan como ocupadas (reservar, aforo, lista de espera).
create or replace function public.trg_reservas_aforo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_plazas   integer;
  v_ocupadas integer;
  v_retenidas integer;
begin
  if new.estado <> 'RESERVADA' then
    return new;
  end if;
  -- Si ya estaba RESERVADA en la misma clase, no cambia la ocupación.
  if tg_op = 'UPDATE' and old.estado = 'RESERVADA' and old.clase_id = new.clase_id then
    return new;
  end if;
  select plazas, plazas_retenidas into v_plazas, v_retenidas from public.clases where id = new.clase_id for update;
  if not found then
    raise exception 'La clase no existe.';
  end if;
  select count(*) into v_ocupadas
    from public.reservas
   where clase_id = new.clase_id and estado = 'RESERVADA' and id <> new.id;
  -- 0039: a un alumno (no al personal) tampoco se le da una plaza retenida por el equipo.
  if public.auth_cliente_id() is not null then v_ocupadas := v_ocupadas + coalesce(v_retenidas, 0); end if;
  if v_ocupadas >= v_plazas then
    raise exception 'No quedan plazas libres.' using errcode = 'check_violation', detail = 'SIN_PLAZAS';
  end if;
  return new;
end $$;

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
  -- 0039: lo que no está publicado solo lo puede reservar el personal.
  if not v_clase.publicada and public.auth_trabajador_id() is null then return public._bloqueo('SIN_PUBLICAR', 'Esta clase todavía no está publicada.'); end if;
  if (v_clase.fecha + v_clase.hora_inicio) < public._ahora_local() then
    return public._bloqueo('CLASE_PASADA', 'Esta clase ya ha pasado.');
  end if;
  if exists (select 1 from public.reservas where clase_id = p_clase_id and cliente_id = p_cliente_id and estado = 'RESERVADA') then
    return public._bloqueo('YA_RESERVADA', 'Ya tienes plaza en esta clase.');
  end if;
  select count(*) into v_ocupadas from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA';
  -- 0039: las plazas retenidas por el equipo (cambios sin publicar) no se ofrecen a los alumnos.
  if public.auth_trabajador_id() is null then v_ocupadas := v_ocupadas + coalesce(v_clase.plazas_retenidas, 0); end if;
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

create or replace function public.apuntar_lista_espera(p_clase_id uuid, p_reserva_cambio_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cliente_id uuid;
  v_clase      public.clases%rowtype;
  v_reserva    public.reservas%rowtype;
  v_ocupadas   integer;
  v_ev         jsonb;
  v_motivo     text;
  v_id         uuid;
  v_posicion   integer;
begin
  v_cliente_id := public.auth_cliente_id();
  if v_cliente_id is null then raise exception 'Solo los alumnos pueden apuntarse a la lista de espera.' using errcode = 'insufficient_privilege'; end if;

  select * into v_clase from public.clases where id = p_clase_id for update;
  if not found then raise exception 'La clase no existe.'; end if;
  if v_clase.estado <> 'PROGRAMADA' then raise exception 'Esta clase ha sido cancelada por el centro.'; end if;
  if (v_clase.fecha + v_clase.hora_inicio) < public._ahora_local() + make_interval(hours => public._horas_cierre_lista_espera()) then
    raise exception 'La lista de espera se cierra % horas antes de la clase.', public._horas_cierre_lista_espera();
  end if;
  if exists (select 1 from public.reservas where clase_id = p_clase_id and cliente_id = v_cliente_id and estado = 'RESERVADA') then
    raise exception 'Ya tienes plaza en esta clase.';
  end if;
  if not v_clase.publicada then raise exception 'Esta clase todavía no está publicada.'; end if;  -- 0039
  select count(*) into v_ocupadas from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA';
  if public.auth_trabajador_id() is null then v_ocupadas := v_ocupadas + coalesce(v_clase.plazas_retenidas, 0); end if;  -- 0039
  if v_clase.plazas - v_ocupadas > 0 then raise exception 'Quedan plazas libres: puedes reservar directamente.'; end if;

  if p_reserva_cambio_id is not null then
    select * into v_reserva from public.reservas where id = p_reserva_cambio_id and cliente_id = v_cliente_id;
    if not found then raise exception 'La reserva que quieres cambiar no es tuya.'; end if;
    v_motivo := public._motivo_no_cambio(v_reserva, v_clase);
    if v_motivo is not null then raise exception '%', v_motivo; end if;
  else
    -- Sin cambio: tendría que poder reservar con su tarifa si hubiera plaza.
    v_ev := public._evaluar_reserva(p_clase_id, v_cliente_id, true);
    if not (v_ev->>'ok')::boolean then
      raise exception '%', v_ev->>'motivo' using errcode = 'P0001', detail = v_ev->>'codigo';
    end if;
  end if;

  insert into public.lista_espera (clase_id, cliente_id, reserva_cambio_id)
  values (p_clase_id, v_cliente_id, p_reserva_cambio_id)
  on conflict (clase_id, cliente_id) do update set reserva_cambio_id = excluded.reserva_cambio_id
  returning id into v_id;

  select count(*) + 1 into v_posicion from public.lista_espera l
   where l.clase_id = p_clase_id and (l.creado_el, l.id) < (select creado_el, id from public.lista_espera where id = v_id);

  perform public._auditar('LISTA_ESPERA', 'clase', p_clase_id::text,
    format('%s se apunta (posición %s%s) · %s', public._nombre_cliente(v_cliente_id), v_posicion,
           case when p_reserva_cambio_id is not null then ', a cambio de ' || public._desc_clase(v_reserva.clase_id) else '' end,
           public._desc_clase(p_clase_id)));
  return jsonb_build_object('id', v_id, 'posicion', v_posicion);
end $$;

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
  -- 0039: lo que hace la lista de espera no retiene ni consume plazas retenidas (ver trg_reservas_plazas_retenidas).
  perform set_config('app.promoviendo', '1', true);

  for e in select * from public.lista_espera where clase_id = p_clase_id order by creado_el, id loop
    -- 0039: las plazas retenidas por el equipo no se dan desde la lista de espera hasta que se publican los cambios.
    select v_clase.plazas - coalesce(v_clase.plazas_retenidas, 0) - count(*) into v_libres from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA';
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
  perform set_config('app.promoviendo', '', true);
  return v_n;
end $$;

-- El personal que gestiona el horario retiene las plazas que libera y consume las retenidas al apuntar.
create or replace function public.trg_reservas_plazas_retenidas()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_clase    public.clases%rowtype;
  v_ocupadas integer;
begin
  -- Solo lo que hace a mano alguien que gestiona el horario; ni los alumnos, ni la lista de espera, ni el mantenimiento.
  if auth.uid() is null or public.auth_trabajador_id() is null or not public.gestiona_horario() then return coalesce(new, old); end if;
  if coalesce(current_setting('app.promoviendo', true), '') = '1' then return coalesce(new, old); end if;
  -- Deja de ocupar plaza en una clase futura: la plaza se retiene.
  if (tg_op = 'DELETE' and old.estado = 'RESERVADA')
     or (tg_op = 'UPDATE' and old.estado = 'RESERVADA' and (new.estado <> 'RESERVADA' or new.clase_id <> old.clase_id)) then
    select * into v_clase from public.clases where id = old.clase_id for update;
    if found and v_clase.estado = 'PROGRAMADA' and (v_clase.fecha + v_clase.hora_inicio) > public._ahora_local() then
      select count(*) into v_ocupadas from public.reservas where clase_id = old.clase_id and estado = 'RESERVADA' and id <> old.id;
      update public.clases set plazas_retenidas = least(plazas_retenidas + 1, greatest(0, plazas - v_ocupadas)) where id = old.clase_id;
    end if;
  end if;
  -- Pasa a ocupar plaza por mano del equipo: usa una retenida si la hay.
  if tg_op in ('INSERT', 'UPDATE') and new.estado = 'RESERVADA'
     and (tg_op = 'INSERT' or old.estado <> 'RESERVADA' or old.clase_id <> new.clase_id) then
    update public.clases set plazas_retenidas = plazas_retenidas - 1 where id = new.clase_id and plazas_retenidas > 0;
  end if;
  return coalesce(new, old);
end $$;
comment on function public.trg_reservas_plazas_retenidas() is 'Cambios sin publicar (0039): las plazas que libera el equipo quedan retenidas hasta publicar.';
drop trigger if exists reservas_plazas_retenidas on public.reservas;
create trigger reservas_plazas_retenidas before insert or update of estado, clase_id or delete on public.reservas
  for each row execute function public.trg_reservas_plazas_retenidas();

-- -----------------------------------------------------------------------------
-- 3. Publicar cambios
-- -----------------------------------------------------------------------------
create or replace function public.publicar_cambios(p_avisar boolean default false, p_texto text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_franjas integer := 0;
  v_clases  integer := 0;
  v_plazas  integer := 0;
  v_aviso   uuid;
  k         record;
begin
  perform public._exigir('HORARIOS_GESTIONAR');
  update public.plantillas_clase set publicada = true where not publicada;
  get diagnostics v_franjas = row_count;
  update public.clases set publicada = true where not publicada;
  get diagnostics v_clases = row_count;
  -- Las clases futuras: se cuentan, se liberan y la lista de espera recibe lo que toque. Las pasadas, solo se limpian.
  for k in select id, plazas_retenidas from public.clases
            where plazas_retenidas > 0 and estado = 'PROGRAMADA' and (fecha + hora_inicio) > public._ahora_local() for update loop
    v_plazas := v_plazas + k.plazas_retenidas;
    update public.clases set plazas_retenidas = 0 where id = k.id;
    perform public._promover_lista_espera(k.id);
  end loop;
  update public.clases set plazas_retenidas = 0 where plazas_retenidas > 0;
  if coalesce(p_avisar, false) then
    insert into public.avisos (titulo, cuerpo, destino_tipo, importante, publicado_por)
    values ('Horario actualizado', coalesce(nullif(trim(p_texto), ''), 'Hemos actualizado el horario. Échale un vistazo en la app.'), 'TODOS', true, auth.uid())
    returning id into v_aviso;
  end if;
  perform public._auditar('PUBLICAR_CAMBIOS', 'horario', '-',
    format('%s franjas y %s clases publicadas; %s plazas liberadas%s', v_franjas, v_clases, v_plazas, case when v_aviso is not null then ' · aviso a todos' else '' end));
  return jsonb_build_object('franjas', v_franjas, 'clases', v_clases, 'plazas', v_plazas, 'aviso', v_aviso);
end $$;
comment on function public.publicar_cambios(boolean, text) is 'Publica franjas y clases en borrador, libera las plazas retenidas y, si se pide, avisa a todos (0039).';
revoke all on function public.publicar_cambios(boolean, text) from public, anon;
grant execute on function public.publicar_cambios(boolean, text) to authenticated;
