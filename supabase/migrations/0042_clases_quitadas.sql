-- =============================================================================
-- 0042_clases_quitadas.sql · Una clase de una franja que se quita no vuelve a aparecer
--
--   Desde la 0038, cancelar una clase sin nadie apuntado (o «Eliminar clase») la borra. Pero si
--   era de una franja activa, el mantenimiento nocturno (y cada cambio de horario) la volvía a
--   crear, porque solo mira si ese día ya tiene clase. Ahora queda anotado en `clases_quitadas`
--   (franja + fecha) y la generación de clases se lo salta.
--
--   Recupera también los días que ya se habían quitado así antes de esta migración (las clases
--   canceladas vacías que limpió la 0038 y las que se hayan eliminado desde entonces): son los
--   huecos que hay ahora en franjas activas dentro de las semanas ya generadas, porque desde
--   la 0038 no se ha vuelto a generar ninguna clase. Hay que ejecutarla antes del mantenimiento
--   nocturno (04:15).
--   Idempotente.
-- =============================================================================

create table if not exists public.clases_quitadas (
  plantilla_id uuid not null references public.plantillas_clase(id) on delete cascade,
  fecha        date not null,
  quitada_el   timestamptz not null default now(),
  quitada_por  uuid,
  primary key (plantilla_id, fecha)
);
comment on table public.clases_quitadas is 'Días de una franja cuya clase se quitó a propósito: no se vuelven a generar (0042).';
alter table public.clases_quitadas enable row level security;
drop policy if exists clases_quitadas_leer on public.clases_quitadas;
create policy clases_quitadas_leer on public.clases_quitadas for select to authenticated using (public.auth_trabajador_id() is not null);
revoke all on public.clases_quitadas from public, anon;
grant select on public.clases_quitadas to authenticated;

-- Los huecos que ya hay (antes de cambiar la generación): días de franjas activas y vigentes, dentro de las
-- semanas ya generadas, sin clase y sin ser día de cierre.
do $$
declare v_n integer; v_hasta date;
begin
  select public._hoy() + greatest(coalesce(dias_generacion_clases, 70) - 1, 0) into v_hasta from public.config_centro limit 1;
  insert into public.clases_quitadas (plantilla_id, fecha)
  select p.id, d::date
    from public.plantillas_clase p
    cross join generate_series(public._hoy(), coalesce(v_hasta, public._hoy() + 69), interval '1 day') d
   where p.activa and p.eliminada_el is null and extract(isodow from d) = p.dia_semana
     and (p.vigencia_desde is null or d::date >= p.vigencia_desde)
     and (p.vigencia_hasta is null or d::date <= p.vigencia_hasta)
     and d::date <= (select max(c.fecha) from public.clases c where c.plantilla_id = p.id)
     and not exists (select 1 from public.dias_cierre dc where dc.fecha = d::date)
     and not exists (select 1 from public.clases c where c.plantilla_id = p.id and c.fecha = d::date)
  on conflict (plantilla_id, fecha) do nothing;
  get diagnostics v_n = row_count;
  raise notice '0042: % días de franjas ya quitados anotados para que no vuelvan.', v_n;
end $$;

create or replace function public._generar_clases(p_desde date, p_hasta date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into public.clases (plantilla_id, actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas, publicada)
  select p.id, p.actividad_id, d::date, p.hora_inicio, p.duracion_min, p.monitor_id, p.plazas, p.publicada
    from generate_series(p_desde, p_hasta, interval '1 day') d
    join public.plantillas_clase p on p.activa and p.dia_semana = extract(isodow from d)
   where not exists (select 1 from public.dias_cierre dc where dc.fecha = d::date)
     -- 0042: un día que alguien quitó a propósito no vuelve.
     and not exists (select 1 from public.clases_quitadas q where q.plantilla_id = p.id and q.fecha = d::date)
     and (p.vigencia_desde is null or d::date >= p.vigencia_desde)
     and (p.vigencia_hasta is null or d::date <= p.vigencia_hasta)
  on conflict (plantilla_id, fecha) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public._cancelar_clase(p_clase_id uuid, p_motivo text, p_clase_alternativa_id uuid default null, p_avisar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_clase     public.clases%rowtype;
  v_alt       public.clases%rowtype;
  v_act       public.actividades%rowtype;
  v_contrato  public.contratos%rowtype;
  r           public.reservas%rowtype;
  v_afectados integer := 0;
  v_clientes  uuid[] := '{}';
  v_aviso_id  uuid;
  v_alt_txt   text;
  v_festivo   boolean;
  v_recupera  boolean := false;
begin
  select * into v_clase from public.clases where id = p_clase_id for update;
  if not found then raise exception 'La clase no existe.'; end if;
  if v_clase.estado = 'CANCELADA' then raise exception 'La clase ya está cancelada.'; end if;
  -- 0038/0041: una clase en la que no hay nadie apuntado no se cancela: se borra. Las reservas que alguien
  -- canceló antes se van con ella (su recuperación se conserva: la referencia queda a null).
  if not exists (select 1 from public.reservas x where x.clase_id = p_clase_id and x.estado = 'RESERVADA') then
    delete from public.lista_espera where clase_id = p_clase_id;
    -- 0042: si es de una franja, ese día queda quitado (si no, el mantenimiento la volvería a crear).
    if v_clase.plantilla_id is not null then
      insert into public.clases_quitadas (plantilla_id, fecha, quitada_por) values (v_clase.plantilla_id, v_clase.fecha, auth.uid())
      on conflict (plantilla_id, fecha) do nothing;
    end if;
    delete from public.clases where id = p_clase_id;
    perform public._auditar('BORRAR_CLASE', 'clase', p_clase_id::text,
      format('%s %s %s · estaba vacía · %s', (select nombre from public.actividades where id = v_clase.actividad_id), v_clase.fecha, to_char(v_clase.hora_inicio, 'HH24:MI'), coalesce(p_motivo, '')));
    return jsonb_build_object('afectados', 0, 'aviso', null, 'borrada', true);
  end if;
  select * into v_act from public.actividades where id = v_clase.actividad_id;
  -- Festivo / día de cierre: no se da recuperación nueva.
  v_festivo := exists (select 1 from public.dias_cierre where fecha = v_clase.fecha);
  -- 0021: una clase cancelada no tiene lista de espera.
  delete from public.lista_espera where clase_id = p_clase_id;

  for r in select * from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA' loop
    v_afectados := v_afectados + 1;
    v_clientes := array_append(v_clientes, r.cliente_id);
    -- Lo gastado en esta clase se devuelve siempre.
    if r.origen = 'RECUPERACION' and r.recuperacion_usada_id is not null then
      update public.recuperaciones set estado = 'DISPONIBLE', usada_en_reserva_id = null where id = r.recuperacion_usada_id;
      continue;
    end if;
    if r.origen = 'BONO' and r.contrato_id is not null then
      update public.contratos set sesiones_restantes = coalesce(sesiones_restantes, 0) + 1 where id = r.contrato_id;
      continue;
    end if;
    if r.origen = 'CLASE_SUELTA' then continue; end if;
    if v_festivo then continue; end if;
    v_recupera := true;
    v_contrato := null;
    if r.contrato_id is not null then select * into v_contrato from public.contratos where id = r.contrato_id; end if;
    insert into public.recuperaciones (cliente_id, contrato_id, reserva_origen_id, categoria_origen, categorias_permitidas, motivo, caduca_el, nota, creado_por)
    values (r.cliente_id, v_contrato.id, r.id, v_act.categoria,
            public._categorias_permitidas_recuperacion(v_act.categoria, v_contrato.tarifa_id),
            'CANCELACION_CENTRO', public._caducidad_recuperacion(v_contrato.fecha_fin, v_clase.fecha),
            'Clase cancelada por el centro: ' || coalesce(p_motivo, ''), auth.uid());
  end loop;

  update public.clases
     set estado = 'CANCELADA', motivo_cancelacion = p_motivo, clase_alternativa_id = p_clase_alternativa_id,
         cancelado_el = now(), cancelado_por = auth.uid()
   where id = p_clase_id;
  update public.reservas
     set estado = 'CANCELADA_CENTRO', cancelado_el = now(), cancelado_por = auth.uid()
   where clase_id = p_clase_id and estado = 'RESERVADA';

  if p_avisar and v_afectados > 0 then
    if p_clase_alternativa_id is not null then select * into v_alt from public.clases where id = p_clase_alternativa_id; end if;
    v_alt_txt := case
      when v_festivo then ' Es día de cierre: esta clase no se recupera.'
      when v_alt.id is not null then format(' Se realizará una clase alternativa el %s a las %s: puedes reservarla con la recuperación que te hemos añadido.', v_alt.fecha, to_char(v_alt.hora_inicio, 'HH24:MI'))
      when v_recupera then ' Te hemos añadido una recuperación para que la uses cuando quieras.'
      else '' end;
    insert into public.avisos (titulo, cuerpo, destino_tipo, destino_clase_id, importante, publicado_por)
    values (format('Clase cancelada: %s %s %s', v_act.nombre, to_char(v_clase.fecha, 'DD/MM'), to_char(v_clase.hora_inicio, 'HH24:MI')),
            (case when coalesce(p_motivo, '') <> '' then p_motivo || '.' else 'La clase queda cancelada.' end) || v_alt_txt,
            'CLASE', p_clase_id, true, auth.uid())
    returning id into v_aviso_id;
    insert into public.aviso_destinatarios (aviso_id, cliente_id)
    select v_aviso_id, c from unnest(v_clientes) c group by c;
  end if;

  perform public._auditar('CANCELAR_CLASE', 'clase', p_clase_id::text,
    format('%s · %s afectados · %s%s', public._desc_clase(p_clase_id), v_afectados, coalesce(p_motivo, ''), case when v_festivo then ' (festivo, sin recuperación)' else '' end));
  return jsonb_build_object('afectados', v_afectados, 'aviso', v_aviso_id);
end $$;

create or replace function public.eliminar_clase(p_clase_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_clase public.clases%rowtype;
begin
  perform public._exigir('CLASES_CREAR_CANCELAR');
  perform public._exigir_clase_mia(p_clase_id);
  select * into v_clase from public.clases where id = p_clase_id for update;
  if not found then raise exception 'La clase no existe.'; end if;
  -- 0041: se puede eliminar cualquier clase sin nadie apuntado (programada o cancelada), aunque alguien se apuntara y lo cancelara.
  if exists (select 1 from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA') then
    raise exception 'Esta clase tiene alumnos apuntados: para quitarla, cancélala (se les avisa y se les da recuperación).';
  end if;
  if v_clase.estado = 'PROGRAMADA' and exists (select 1 from public.reservas r where r.clase_id = p_clase_id and r.asistencia = 'ASISTE') then
    raise exception 'Esta clase ya se dio: se conserva en el historial.';
  end if;
  delete from public.lista_espera where clase_id = p_clase_id;
  -- 0042: si es de una franja, ese día queda quitado (si no, el mantenimiento la volvería a crear).
  if v_clase.plantilla_id is not null then
    insert into public.clases_quitadas (plantilla_id, fecha, quitada_por) values (v_clase.plantilla_id, v_clase.fecha, auth.uid())
    on conflict (plantilla_id, fecha) do nothing;
  end if;
  delete from public.clases where id = p_clase_id;
  perform public._auditar('BORRAR_CLASE', 'clase', p_clase_id::text,
    format('%s %s %s · sin nadie apuntado (%s)', (select nombre from public.actividades where id = v_clase.actividad_id), v_clase.fecha, to_char(v_clase.hora_inicio, 'HH24:MI'), lower(v_clase.estado::text)));
end $$;
