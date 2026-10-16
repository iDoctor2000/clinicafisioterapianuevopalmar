-- =============================================================================
-- 0021_lista_espera_y_franjas.sql · Lista de espera, eliminar franjas y avisos push del sistema
--
--   Peticiones del centro (octubre de 2026):
--   1. LISTA DE ESPERA. Cuando una clase está completa, el alumno puede apuntarse a la lista
--      de espera. Si se libera una plaza, entra el primero de la lista automáticamente y
--      recibe un aviso (y una notificación push). Solo se promueve hasta 2 horas antes de la
--      clase; después la lista deja de funcionar (el centro gestiona a mano).
--      · Apuntarse "a cambio" de una clase propia: si entra, su reserva antigua pasa a la clase
--        nueva (un cambio de clase, sin gastar nada). Solo dentro de la misma semana y mientras
--        la clase antigua aún se pueda cancelar con antelación.
--      · Apuntarse sin cambio: al entrar se reserva con las reglas normales de su tarifa
--        (cupo semanal, bono o recuperación). Al apuntarse ya se comprueba que podría.
--      · El personal ve la lista de cada clase y puede quitar a alguien.
--   2. ELIMINAR FRANJA del horario (no solo desactivarla). Se bloquea si algún alumno la tiene
--      como clase fija en un contrato activo (se dice quiénes). Sus clases futuras con alumnos
--      se cancelan con aviso y recuperación; las vacías se borran. La franja se conserva
--      marcada como eliminada para que el historial siga teniendo sentido.
--   3. AVISOS PUSH DEL SISTEMA. Los avisos que crea la propia base de datos (lista de espera)
--      se apuntan en `avisos_push_pendientes` y la app los manda por push en cuanto puede.
--   4. `ocupacion_clases` incluye cuántos hay en lista de espera (solo el número).
--   Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tablas
-- -----------------------------------------------------------------------------
alter table public.plantillas_clase add column if not exists eliminada_el timestamptz;
comment on column public.plantillas_clase.eliminada_el is 'Franja eliminada del horario (se conserva por el historial de sus clases).';

create table if not exists public.lista_espera (
  id                uuid primary key default gen_random_uuid(),
  clase_id          uuid not null references public.clases(id) on delete cascade,
  cliente_id        uuid not null references public.clientes(id) on delete cascade,
  reserva_cambio_id uuid references public.reservas(id) on delete set null,
  creado_el         timestamptz not null default now(),
  unique (clase_id, cliente_id)
);
comment on table public.lista_espera is 'Alumnos esperando plaza en una clase completa, por orden de llegada. reserva_cambio_id: reserva propia que se cambiaría por esta clase.';
create index if not exists lista_espera_cliente_idx on public.lista_espera (cliente_id);
create index if not exists lista_espera_orden_idx on public.lista_espera (clase_id, creado_el, id);

alter table public.lista_espera enable row level security;
-- Cada alumno ve sus entradas; el personal las de su ámbito. Nadie escribe directamente (RPC).
drop policy if exists lista_espera_leer on public.lista_espera;
create policy lista_espera_leer on public.lista_espera for select to authenticated
  using (cliente_id = public.auth_cliente_id() or (public.auth_trabajador_id() is not null and public.alcance_clase(clase_id)));
revoke all on public.lista_espera from public, anon;
grant select on public.lista_espera to authenticated;

-- Posición de cada alumno en la lista (solo las suyas). Se ejecuta como propietario para contar a todos.
create or replace view public.mi_lista_espera with (security_invoker = false) as
  select e.id, e.clase_id, e.posicion
    from (select l.id, l.clase_id, l.cliente_id,
                 row_number() over (partition by l.clase_id order by l.creado_el, l.id)::integer as posicion
            from public.lista_espera l) e
   where e.cliente_id = public.auth_cliente_id();
comment on view public.mi_lista_espera is 'Posición del alumno autenticado en cada lista de espera en la que está.';
revoke all on public.mi_lista_espera from public, anon;
grant select on public.mi_lista_espera to authenticated;

-- Ocupación: también cuántos esperan (sin decir quién).
create or replace view public.ocupacion_clases with (security_invoker = false) as
  select c.id as clase_id, c.fecha,
         (select count(*) from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA')::integer as ocupadas,
         (select count(*) from public.lista_espera l where l.clase_id = c.id)::integer as en_espera
    from public.clases c;

-- Avisos creados por la base de datos que la app todavía no ha mandado por push.
create table if not exists public.avisos_push_pendientes (
  aviso_id  uuid primary key references public.avisos(id) on delete cascade,
  creado_el timestamptz not null default now()
);
comment on table public.avisos_push_pendientes is 'Avisos generados por el sistema (lista de espera) pendientes de enviar por push. Solo la función enviar-push (service_role) los lee y borra.';
alter table public.avisos_push_pendientes enable row level security;
revoke all on public.avisos_push_pendientes from public, anon, authenticated;

-- Tiempo real: la lista de espera cambia a menudo.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lista_espera') then
    execute 'alter publication supabase_realtime add table public.lista_espera';
  end if;
exception when others then
  raise notice '0021: no se ha podido ampliar supabase_realtime (%). Se continúa.', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- 2. _evaluar_reserva con p_ignorar_plazas (misma regla, sin mirar el aforo).
--    Hay que borrar la firma antigua: con el parámetro opcional serían ambiguas.
-- -----------------------------------------------------------------------------
drop function if exists public._evaluar_reserva(uuid, uuid);
create or replace function public._evaluar_reserva(p_clase_id uuid, p_cliente_id uuid, p_ignorar_plazas boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg      public.config_centro%rowtype;
  v_clase    public.clases%rowtype;
  v_act      public.actividades%rowtype;
  v_contrato public.contratos%rowtype;
  v_tarifa   public.tarifas%rowtype;
  v_rec      jsonb;      -- resultado listo si hay recuperación aplicable
  v_ocupadas integer;
  v_cupo     integer;
  v_usadas   integer;
  v_cat_label text;
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
  -- 0021: la lista de espera comprueba el resto de reglas aunque la clase esté llena.
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

  if v_tarifa.tipo = 'BONO' then
    if v_tarifa.bono_categoria <> v_act.categoria then
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
    if v_cupo is null then
      return coalesce(v_rec, public._bloqueo('ACTIVIDAD_NO_PERMITIDA', format('Tu tarifa no incluye %s.', lower(v_cat_label))));
    end if;
    if v_contrato.modalidad = 'FIJO' then
      -- Con horario fijo las reservas se generan solas; fuera de él solo con recuperación.
      if v_clase.plantilla_id is not null
         and exists (select 1 from public.contrato_franjas f where f.contrato_id = v_contrato.id and f.plantilla_id = v_clase.plantilla_id) then
        return jsonb_build_object('ok', true, 'via', 'CUPO_SEMANAL', 'mensaje', 'Es tu clase habitual.');
      end if;
      return coalesce(v_rec, public._bloqueo('HORARIO_FIJO', 'Tienes horario fijo. Para asistir a otra clase necesitas una recuperación disponible.'));
    end if;
    v_usadas := public._cupo_consumido_en_semana(v_contrato.id, v_act.categoria, v_clase.fecha);
    if v_usadas < v_cupo then
      return jsonb_build_object('ok', true, 'via', 'CUPO_SEMANAL', 'mensaje', format('Clase %s de %s de esta semana.', v_usadas + 1, v_cupo));
    end if;
    if v_rec is not null then
      return v_rec || jsonb_build_object('mensaje', 'Semana completa: se utilizará una recuperación.');
    end if;
    return public._bloqueo('CUPO_AGOTADO', format('Ya tienes las %s clases de esta semana.', v_cupo));
  end if;

  -- CLASE_SUELTA: solo la introduce el personal.
  return coalesce(v_rec, public._bloqueo('SIN_CONTRATO', 'Las clases sueltas se reservan en recepción.'));
end $$;
comment on function public._evaluar_reserva(uuid, uuid, boolean) is 'Regla 18: decide si un cliente puede reservar una clase y por qué vía (cupo, bono o recuperación). p_ignorar_plazas: para la lista de espera.';
revoke all on function public._evaluar_reserva(uuid, uuid, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Lista de espera: reglas comunes
-- -----------------------------------------------------------------------------
-- Horas antes de la clase a partir de las cuales la lista de espera deja de actuar.
create or replace function public._horas_cierre_lista_espera()
returns integer language sql immutable as $$ select 2 $$;

-- ¿Se puede usar la reserva p_reserva como "cambio" para entrar en la clase p_clase?
-- Devuelve null si sí, o el motivo si no.
create or replace function public._motivo_no_cambio(p_reserva public.reservas, p_clase public.clases)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg      public.config_centro%rowtype;
  v_origen   public.clases%rowtype;
  v_act_dest public.actividades%rowtype;
  v_act_orig public.actividades%rowtype;
  v_contrato public.contratos%rowtype;
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
  if v_act_dest.categoria <> v_act_orig.categoria then
    return format('No se puede cambiar una clase de %s por una de %s.', lower(v_act_orig.nombre), lower(v_act_dest.nombre));
  end if;
  if p_reserva.contrato_id is not null then
    select * into v_contrato from public.contratos where id = p_reserva.contrato_id;
    if cardinality(v_contrato.actividades_permitidas_ids) > 0 and not (v_act_dest.id = any (v_contrato.actividades_permitidas_ids)) then
      return format('Tu tarifa no incluye %s.', v_act_dest.nombre);
    end if;
  end if;
  return null;
end $$;
revoke all on function public._motivo_no_cambio(public.reservas, public.clases) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. apuntar_lista_espera / salir_lista_espera (alumno) · quitar_de_lista_espera (personal)
-- -----------------------------------------------------------------------------
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
  select count(*) into v_ocupadas from public.reservas where clase_id = p_clase_id and estado = 'RESERVADA';
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
comment on function public.apuntar_lista_espera(uuid, uuid) is
  'El alumno se apunta a la lista de espera de una clase completa; opcionalmente a cambio de una reserva suya de la misma semana. Devuelve {id, posicion}.';

create or replace function public.salir_lista_espera(p_clase_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cliente_id uuid; v_n integer;
begin
  v_cliente_id := public.auth_cliente_id();
  if v_cliente_id is null then raise exception 'Solo para alumnos.' using errcode = 'insufficient_privilege'; end if;
  delete from public.lista_espera where clase_id = p_clase_id and cliente_id = v_cliente_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public._auditar('LISTA_ESPERA', 'clase', p_clase_id::text, format('%s sale de la lista · %s', public._nombre_cliente(v_cliente_id), public._desc_clase(p_clase_id)));
  end if;
end $$;
comment on function public.salir_lista_espera(uuid) is 'El alumno se quita de la lista de espera de una clase.';

create or replace function public.quitar_de_lista_espera(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.lista_espera%rowtype;
begin
  if public.auth_trabajador_id() is null then raise exception 'Solo para el personal.' using errcode = 'insufficient_privilege'; end if;
  perform public._exigir('RESERVAS_GESTIONAR');
  select * into e from public.lista_espera where id = p_id;
  if not found then return; end if;
  perform public._exigir_clase_mia(e.clase_id);
  delete from public.lista_espera where id = p_id;
  perform public._auditar('LISTA_ESPERA', 'clase', e.clase_id::text, format('%s quitado de la lista por el personal · %s', public._nombre_cliente(e.cliente_id), public._desc_clase(e.clase_id)));
end $$;
comment on function public.quitar_de_lista_espera(uuid) is 'El personal quita a un alumno de la lista de espera de una clase.';

-- -----------------------------------------------------------------------------
-- 5. Promoción: al liberarse plazas, entran los primeros de la lista.
--    Se llama desde los disparadores de reservas y clases (y es segura de llamar a mano).
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
          update public.reservas set clase_id = p_clase_id where id = v_reserva.id;  -- el disparador de aforo vigila la plaza
          v_reserva_id := v_reserva.id;
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
comment on function public._promover_lista_espera(uuid) is 'Da las plazas libres de una clase a los primeros de su lista de espera (hasta 2 horas antes). Devuelve cuántos han entrado.';
revoke all on function public._promover_lista_espera(uuid) from public, anon, authenticated;

-- Disparadores: una reserva que deja de ocupar plaza, o una clase a la que se le suben las plazas.
create or replace function public.trg_reservas_lista_espera()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.estado = 'RESERVADA' and (tg_op = 'DELETE' or new.estado <> 'RESERVADA' or new.clase_id <> old.clase_id) then
    perform public._promover_lista_espera(old.clase_id);
  end if;
  return null;
end $$;
drop trigger if exists reservas_lista_espera on public.reservas;
create trigger reservas_lista_espera after update of estado, clase_id or delete on public.reservas
  for each row execute function public.trg_reservas_lista_espera();

create or replace function public.trg_clases_lista_espera()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.plazas > old.plazas then perform public._promover_lista_espera(new.id); end if;
  return null;
end $$;
drop trigger if exists clases_lista_espera on public.clases;
create trigger clases_lista_espera after update of plazas on public.clases
  for each row execute function public.trg_clases_lista_espera();

-- -----------------------------------------------------------------------------
-- 6. Funciones de 0020 que cambian: cancelar clase vacía su lista; los cambios de horario no
--    promueven a nadie mientras recrean clases; el mantenimiento nocturno limpia listas pasadas.
-- -----------------------------------------------------------------------------
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

create or replace function public.plantilla_aplicar_cambios(p_plantilla_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hoy         date := public._hoy();
  v_cfg         public.config_centro%rowtype;
  v_pl          public.plantillas_clase%rowtype;
  v_conservadas integer := 0;
  v_canceladas  integer := 0;
  v_afectados   integer := 0;
  v_avisos      uuid[] := '{}';
  v_res         jsonb;
  k             record;
begin
  perform public._exigir('HORARIOS_GESTIONAR');
  if public.auth_ambito() = 'SUS_CLASES' then
    raise exception 'Con ámbito "Solo sus clases" no se puede modificar el horario.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_cfg from public.config_centro limit 1;
  select * into v_pl from public.plantillas_clase where id = p_plantilla_id;
  if not found then raise exception 'La franja no existe.'; end if;

  -- Clases futuras sin reservas, o solo con automáticas: se eliminan para recrearlas.
  -- 0021: al borrar esas reservas no se promueve a nadie de la lista de espera (la clase desaparece).
  perform set_config('app.sin_promocion', '1', true);
  with borrables as (
    select c.id from public.clases c
     where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy
       and not exists (select 1 from public.reservas r where r.clase_id = c.id and not (r.origen = 'AUTOMATICA' and r.estado = 'RESERVADA'))
  ), reservas_fuera as (
    delete from public.reservas r where r.clase_id in (select id from borrables) returning r.id
  )
  delete from public.clases c where c.id in (select id from borrables);
  perform set_config('app.sin_promocion', '', true);

  -- Las que tienen alumnos y la franja ya no se imparte ese día: se cancelan avisando.
  for k in
    select c.id from public.clases c
     where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy
       and (not v_pl.activa
            or (v_pl.vigencia_desde is not null and c.fecha < v_pl.vigencia_desde)
            or (v_pl.vigencia_hasta is not null and c.fecha > v_pl.vigencia_hasta))
     order by c.fecha, c.hora_inicio
  loop
    v_res := public._cancelar_clase(k.id, 'Esta clase deja de impartirse', null, true);
    v_canceladas := v_canceladas + 1;
    v_afectados := v_afectados + (v_res ->> 'afectados')::integer;
    if v_res ->> 'aviso' is not null then v_avisos := array_append(v_avisos, (v_res ->> 'aviso')::uuid); end if;
  end loop;

  -- El resto con alumnos mantiene día y hora y toma la actividad, monitor, duración y plazas nuevas.
  update public.clases c
     set actividad_id = v_pl.actividad_id, monitor_id = v_pl.monitor_id, duracion_min = v_pl.duracion_min,
         plazas = greatest(v_pl.plazas, (select count(*) from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA')::integer)
   where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy;
  get diagnostics v_conservadas = row_count;

  perform public._generar_clases(v_hoy, v_hoy + coalesce(v_cfg.dias_generacion_clases, 70));
  for k in select id from public.contratos where estado = 'ACTIVO' and modalidad = 'FIJO' loop
    perform public._generar_reservas_automaticas(k.id);
  end loop;
  -- Las conservadas son las que siguen con alumnos de antes (no las recién generadas).
  select count(*) into v_conservadas from public.clases c
   where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and c.fecha >= v_hoy
     and exists (select 1 from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA' and r.origen <> 'AUTOMATICA');

  perform public._auditar('EDITAR_HORARIO', 'plantilla', p_plantilla_id::text,
    format('clases futuras recreadas; %s conservan día y hora; %s canceladas (%s alumnos avisados)', v_conservadas, v_canceladas, v_afectados));
  return jsonb_build_object('conservadas', v_conservadas, 'canceladas', v_canceladas, 'afectados', v_afectados, 'avisos', to_jsonb(v_avisos));
end $$;

create or replace function public.mantenimiento_diario()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg      public.config_centro%rowtype;
  v_hoy      date;
  v_clases   integer;
  v_cierres  integer;
  v_reservas integer := 0;
  v_caducadas integer;
  v_finalizados integer;
  v_espera   integer;
  k          record;
  v_res      jsonb;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'Solo el administrador (o la tarea programada) puede ejecutar el mantenimiento.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_cfg from public.config_centro limit 1;
  v_hoy := public._hoy();

  v_clases := public._generar_clases(v_hoy, v_hoy + coalesce(v_cfg.dias_generacion_clases, 70));

  -- 0020: igual que al guardar los cierres en Ajustes (avisa, devuelve bonos y recuperaciones usadas, sin recuperación nueva).
  v_cierres := (public._cancelar_clases_cierre() ->> 'canceladas')::integer;

  for k in select id from public.contratos where estado = 'ACTIVO' and modalidad = 'FIJO' loop
    v_reservas := v_reservas + public._generar_reservas_automaticas(k.id);
  end loop;

  update public.recuperaciones set estado = 'CADUCADA' where estado = 'DISPONIBLE' and caduca_el < v_hoy;
  get diagnostics v_caducadas = row_count;

  update public.contratos set estado = 'FINALIZADO' where estado = 'ACTIVO' and fecha_fin < v_hoy;
  get diagnostics v_finalizados = row_count;

  -- 0021: la lista de espera de las clases ya pasadas no sirve de nada.
  delete from public.lista_espera e using public.clases c where c.id = e.clase_id and (c.fecha + c.hora_inicio) < public._ahora_local();
  get diagnostics v_espera = row_count;

  v_res := jsonb_build_object('fecha', v_hoy, 'clases_creadas', v_clases, 'clases_canceladas_por_cierre', v_cierres,
    'reservas_automaticas', v_reservas, 'recuperaciones_caducadas', v_caducadas, 'contratos_finalizados', v_finalizados, 'lista_espera_limpiada', v_espera);
  perform public._auditar('MANTENIMIENTO', 'sistema', '-', v_res::text);
  return v_res;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Eliminar una franja del horario
-- -----------------------------------------------------------------------------
create or replace function public.eliminar_plantilla(p_plantilla_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pl        public.plantillas_clase%rowtype;
  v_fijos     text;
  v_borradas  integer := 0;
  v_canceladas integer := 0;
  v_afectados integer := 0;
  v_avisos    uuid[] := '{}';
  v_res       jsonb;
  k           record;
begin
  perform public._exigir('HORARIOS_GESTIONAR');
  if public.auth_ambito() = 'SUS_CLASES' then
    raise exception 'Con ámbito "Solo sus clases" no se puede modificar el horario.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_pl from public.plantillas_clase where id = p_plantilla_id for update;
  if not found then raise exception 'La franja no existe.'; end if;
  if v_pl.eliminada_el is not null then raise exception 'La franja ya está eliminada.'; end if;

  -- Bloqueo: alumnos que la tienen como clase fija en un contrato activo.
  select string_agg(public._nombre_cliente(kt.cliente_id), ', ' order by public._nombre_cliente(kt.cliente_id)) into v_fijos
    from public.contrato_franjas f join public.contratos kt on kt.id = f.contrato_id
   where f.plantilla_id = p_plantilla_id and kt.estado = 'ACTIVO';
  if v_fijos is not null then
    raise exception 'No se puede eliminar: la tienen como clase fija %. Cambia antes sus horarios fijos.', v_fijos using errcode = 'P0001', detail = 'FRANJA_CON_FIJOS';
  end if;

  -- Clases futuras: con alumnos se cancelan avisando; vacías se borran.
  perform set_config('app.sin_promocion', '1', true);
  for k in
    select c.id, exists (select 1 from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA') as con_alumnos
      from public.clases c
     where c.plantilla_id = p_plantilla_id and c.estado = 'PROGRAMADA' and (c.fecha + c.hora_inicio) >= public._ahora_local()
     order by c.fecha, c.hora_inicio
  loop
    if k.con_alumnos then
      v_res := public._cancelar_clase(k.id, 'Esta clase deja de impartirse', null, true);
      v_canceladas := v_canceladas + 1;
      v_afectados := v_afectados + (v_res ->> 'afectados')::integer;
      if v_res ->> 'aviso' is not null then v_avisos := array_append(v_avisos, (v_res ->> 'aviso')::uuid); end if;
    else
      delete from public.clases where id = k.id;
      v_borradas := v_borradas + 1;
    end if;
  end loop;
  perform set_config('app.sin_promocion', '', true);

  update public.plantillas_clase set activa = false, eliminada_el = now() where id = p_plantilla_id;

  perform public._auditar('ELIMINAR_FRANJA', 'plantilla', p_plantilla_id::text,
    format('%s · %s clases vacías borradas; %s canceladas (%s alumnos avisados)',
           (select a.nombre || ' ' || to_char(v_pl.hora_inicio, 'HH24:MI') from public.actividades a where a.id = v_pl.actividad_id),
           v_borradas, v_canceladas, v_afectados));
  return jsonb_build_object('borradas', v_borradas, 'canceladas', v_canceladas, 'afectados', v_afectados, 'avisos', to_jsonb(v_avisos));
end $$;
comment on function public.eliminar_plantilla(uuid) is
  'Elimina una franja del horario: se bloquea si algún contrato activo la tiene como clase fija; cancela (con aviso) sus clases futuras con alumnos y borra las vacías.';

-- -----------------------------------------------------------------------------
-- Permisos
-- -----------------------------------------------------------------------------
revoke all on function public.apuntar_lista_espera(uuid, uuid) from public, anon;
grant execute on function public.apuntar_lista_espera(uuid, uuid) to authenticated;
revoke all on function public.salir_lista_espera(uuid) from public, anon;
grant execute on function public.salir_lista_espera(uuid) to authenticated;
revoke all on function public.quitar_de_lista_espera(uuid) from public, anon;
grant execute on function public.quitar_de_lista_espera(uuid) to authenticated;
revoke all on function public.eliminar_plantilla(uuid) from public, anon;
grant execute on function public.eliminar_plantilla(uuid) to authenticated;
revoke all on function public._horas_cierre_lista_espera() from public, anon;
grant execute on function public._horas_cierre_lista_espera() to authenticated;
revoke all on function public.trg_reservas_lista_espera() from public, anon, authenticated;
revoke all on function public.trg_clases_lista_espera() from public, anon, authenticated;
revoke all on function public._cancelar_clase(uuid, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.plantilla_aplicar_cambios(uuid) from public, anon;
grant execute on function public.plantilla_aplicar_cambios(uuid) to authenticated;
