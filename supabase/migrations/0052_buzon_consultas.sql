-- =============================================================================
-- 0052_buzon_consultas.sql · Buzón: los alumnos escriben al centro desde la app
--
--   1. Quién atiende el buzón: `trabajadores.atiende_buzon`, explícito persona a persona (como las
--      finanzas y el horario): el rol ADMIN no lo incluye. Solo quien lo tiene lee y contesta las
--      consultas, solo quien lo tiene puede dárselo a otro y nunca puede quedarse nadie sin él.
--      Arranca con los administradores activos que no dan clase. Cada uno decide si le suena el
--      móvil (`buzon_push`).
--   2. `consultas` + `consulta_mensajes`: el alumno escribe con un motivo, el centro contesta y la
--      consulta queda PENDIENTE / RESPONDIDA / CERRADA. El alumno solo lee las suyas; quién contestó
--      (`consulta_respuestas`) solo lo ve quien atiende el buzón: al alumno le firma "Nuevo Palmar".
--      Nadie escribe en las tablas directamente: todo pasa por las funciones.
--   3. Avisos al móvil:
--        · Al equipo, por `push_personal_pendientes` (0026). Dentro del horario del buzón
--          (`config_centro.buzon_desde`–`buzon_hasta`, 08:00–22:00) suena al momento; de noche se
--          guarda UNA sola notificación para la hora de apertura.
--        · Al alumno, cuando el centro contesta: un aviso suyo (`avisos.consulta_id`) que va por el
--          camino de siempre (`avisos_push_pendientes`). Ese aviso no lo ve el resto del equipo.
--   4. Límites: 1.500 letras por mensaje y 10 mensajes de un alumno cada 24 horas.
--   No toca reservas, contratos, cobros ni reglas de las clases. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quién atiende el buzón
-- -----------------------------------------------------------------------------
alter table public.trabajadores add column if not exists atiende_buzon boolean not null default false;
alter table public.trabajadores add column if not exists buzon_push boolean not null default true;
comment on column public.trabajadores.atiende_buzon is 'Lee y contesta las consultas de los alumnos (0052). Explícito: el rol ADMIN no lo incluye.';
comment on column public.trabajadores.buzon_push is 'Si atiende el buzón: quiere que le suene el móvil con las consultas nuevas (0052).';

create or replace function public.atiende_buzon()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trabajadores t where t.user_id = auth.uid() and t.activo and t.atiende_buzon)
$$;
comment on function public.atiende_buzon() is 'true si el usuario actual es un trabajador activo que atiende el buzón de los alumnos.';
revoke all on function public.atiende_buzon() from public, anon;
grant execute on function public.atiende_buzon() to authenticated;

create or replace function public.trg_trabajadores_buzon()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- sistema (editor SQL): sin límites
  if tg_op = 'INSERT' then
    if new.atiende_buzon and not public.atiende_buzon() then new.atiende_buzon := false; end if;
    return new;
  end if;
  if new.atiende_buzon is distinct from old.atiende_buzon then
    if not public.atiende_buzon() then
      new.atiende_buzon := old.atiende_buzon; -- se conserva en silencio
    elsif not new.atiende_buzon and not exists (
      select 1 from public.trabajadores t where t.atiende_buzon and t.activo and t.id <> old.id
    ) then
      raise exception 'Tiene que quedar al menos una persona que atienda el buzón.' using errcode = 'check_violation';
    end if;
  end if;
  if old.atiende_buzon and old.activo and not new.activo and new.atiende_buzon and not exists (
    select 1 from public.trabajadores t where t.atiende_buzon and t.activo and t.id <> old.id
  ) then
    raise exception 'Tiene que quedar al menos una persona activa que atienda el buzón.' using errcode = 'check_violation';
  end if;
  -- El aviso al móvil es de cada uno: solo lo cambia el propio trabajador (o el sistema).
  if new.buzon_push is distinct from old.buzon_push and old.user_id is distinct from auth.uid() then
    new.buzon_push := old.buzon_push;
  end if;
  return new;
end $$;
drop trigger if exists trabajadores_buzon on public.trabajadores;
create trigger trabajadores_buzon before insert or update on public.trabajadores
  for each row execute function public.trg_trabajadores_buzon();

-- Arranque (si aún no lo tiene nadie): los administradores activos que no dan clase; si no hay
-- ninguno, quienes gestionan el horario.
update public.trabajadores set atiende_buzon = true
 where activo and rol = 'ADMIN' and not es_monitor
   and not exists (select 1 from public.trabajadores where atiende_buzon);
update public.trabajadores set atiende_buzon = true
 where activo and gestiona_horario
   and not exists (select 1 from public.trabajadores where atiende_buzon);

-- -----------------------------------------------------------------------------
-- 2. Ajustes del buzón
-- -----------------------------------------------------------------------------
alter table public.config_centro
  add column if not exists buzon_activo boolean not null default true,
  add column if not exists buzon_desde  time not null default '08:00',
  add column if not exists buzon_hasta  time not null default '22:00';
comment on column public.config_centro.buzon_activo is 'Los alumnos pueden escribir al centro desde la app (0052).';
comment on column public.config_centro.buzon_desde is 'Hora desde la que se contestan las consultas: antes no suena el móvil del equipo (0052).';
comment on column public.config_centro.buzon_hasta is 'Hora hasta la que suena el móvil del equipo con las consultas nuevas (0052).';

-- -----------------------------------------------------------------------------
-- 3. Consultas y mensajes
-- -----------------------------------------------------------------------------
create table if not exists public.consultas (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references public.clientes(id) on delete cascade,
  motivo           text not null check (motivo in ('CLASES', 'LESION', 'TARIFA', 'OTRO')),
  estado           text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'RESPONDIDA', 'CERRADA')),
  creada_el        timestamptz not null default now(),
  -- Último mensaje o cambio de estado (ordena el buzón y avisa al tiempo real).
  actualizada_el   timestamptz not null default now(),
  -- Última vez que el alumno la abrió: lo posterior del centro está "sin leer".
  leida_cliente_el timestamptz
);
comment on table public.consultas is 'Consultas de los alumnos al centro (0052). El alumno ve las suyas; el equipo, solo quien atiende el buzón.';
create index if not exists consultas_cliente_idx on public.consultas (cliente_id, actualizada_el desc);
create index if not exists consultas_estado_idx on public.consultas (estado, actualizada_el desc);

create table if not exists public.consulta_mensajes (
  id          uuid primary key default gen_random_uuid(),
  consulta_id uuid not null references public.consultas(id) on delete cascade,
  autor       text not null check (autor in ('CLIENTE', 'CENTRO')),
  texto       text not null check (char_length(texto) between 1 and 1500),
  creado_el   timestamptz not null default now()
);
comment on table public.consulta_mensajes is 'Mensajes de cada consulta (0052): del alumno o del centro.';
create index if not exists consulta_mensajes_consulta_idx on public.consulta_mensajes (consulta_id, creado_el);

create table if not exists public.consulta_respuestas (
  mensaje_id    uuid primary key references public.consulta_mensajes(id) on delete cascade,
  trabajador_id uuid references public.trabajadores(id) on delete set null
);
comment on table public.consulta_respuestas is 'Quién del equipo escribió cada respuesta del centro (0052). Solo lo ve quien atiende el buzón.';

alter table public.consultas enable row level security;
alter table public.consulta_mensajes enable row level security;
alter table public.consulta_respuestas enable row level security;
revoke all on public.consultas, public.consulta_mensajes, public.consulta_respuestas from public, anon, authenticated;
grant select on public.consultas, public.consulta_mensajes, public.consulta_respuestas to authenticated;

drop policy if exists consultas_leer on public.consultas;
create policy consultas_leer on public.consultas for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.atiende_buzon());

drop policy if exists consulta_mensajes_leer on public.consulta_mensajes;
create policy consulta_mensajes_leer on public.consulta_mensajes for select to authenticated
  using (exists (select 1 from public.consultas c
                  where c.id = consulta_mensajes.consulta_id
                    and (c.cliente_id = public.auth_cliente_id() or public.atiende_buzon())));

drop policy if exists consulta_respuestas_leer on public.consulta_respuestas;
create policy consulta_respuestas_leer on public.consulta_respuestas for select to authenticated
  using (public.atiende_buzon());

-- El aviso "el centro ha respondido a tu consulta" es del alumno: del equipo solo lo ve el buzón.
alter table public.avisos add column if not exists consulta_id uuid references public.consultas(id) on delete cascade;
comment on column public.avisos.consulta_id is 'Aviso al alumno de que el centro ha respondido a esta consulta (0052).';
create index if not exists avisos_consulta_idx on public.avisos (consulta_id) where consulta_id is not null;

-- Restrictiva: se suma (con "y") a las políticas de avisos que ya hay, sin tocarlas. Un aviso de consulta
-- solo lo ven su alumno y quien atiende el buzón, aunque otro trabajador tenga AVISOS_ENVIAR.
drop policy if exists avisos_consulta_privada on public.avisos;
create policy avisos_consulta_privada on public.avisos as restrictive for all to authenticated
  using (
    consulta_id is null or public.atiende_buzon()
    or exists (select 1 from public.aviso_destinatarios d where d.aviso_id = avisos.id and d.cliente_id = public.auth_cliente_id())
  )
  with check (consulta_id is null or public.atiende_buzon());

-- Lo mismo con sus destinatarios y sus lecturas: sin esto, el resto del equipo podría saber qué alumno tiene un
-- aviso de consulta (y si lo ha leído) aunque no vea el aviso.
create or replace function public._aviso_de_consulta(p_aviso_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.avisos a where a.id = p_aviso_id and a.consulta_id is not null)
$$;
revoke all on function public._aviso_de_consulta(uuid) from public, anon;
grant execute on function public._aviso_de_consulta(uuid) to authenticated;

drop policy if exists destinatarios_consulta_privada on public.aviso_destinatarios;
create policy destinatarios_consulta_privada on public.aviso_destinatarios as restrictive for all to authenticated
  using (cliente_id = public.auth_cliente_id() or public.atiende_buzon() or not public._aviso_de_consulta(aviso_id))
  with check (public.atiende_buzon() or not public._aviso_de_consulta(aviso_id));

drop policy if exists lecturas_consulta_privada on public.aviso_lecturas;
create policy lecturas_consulta_privada on public.aviso_lecturas as restrictive for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.atiende_buzon() or not public._aviso_de_consulta(aviso_id));

-- Tiempo real: que el buzón y la consulta abierta se actualicen solos (cada mensaje toca `consultas`).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice '0052: publicación supabase_realtime no existe (fuera de Supabase): se omite.';
  elsif not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'consultas'
  ) then
    execute 'alter publication supabase_realtime add table public.consultas';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Avisos al móvil del equipo
-- -----------------------------------------------------------------------------
-- Deja preparada la notificación para quienes atienden el buzón y quieren que les suene.
-- Dentro del horario: una por mensaje, al momento. Fuera: una sola, para la hora de apertura.
create or replace function public._buzon_avisar_equipo(p_cliente_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_zona      text := coalesce((select zona_horaria from public.config_centro limit 1), 'Europe/Madrid');
  v_desde     time := coalesce((select buzon_desde from public.config_centro limit 1), '08:00');
  v_hasta     time := coalesce((select buzon_hasta from public.config_centro limit 1), '22:00');
  v_local     timestamp := now() at time zone v_zona;
  v_hora      time := v_local::time;
  v_dest      uuid[];
  v_apertura  timestamptz;
  v_pend      integer;
  v_nombre    text;
begin
  select coalesce(array_agg(t.id), '{}') into v_dest
    from public.trabajadores t where t.activo and t.atiende_buzon and t.buzon_push;
  if cardinality(v_dest) = 0 then return; end if;

  if v_desde < v_hasta and v_hora >= v_desde and v_hora < v_hasta then
    select c.nombre || ' ' || split_part(c.apellidos, ' ', 1) into v_nombre from public.clientes c where c.id = p_cliente_id;
    insert into public.push_personal_pendientes (titulo, cuerpo, url, destinatarios)
    values ('Consulta de ' || coalesce(v_nombre, 'un alumno'), 'Ábrela en el Buzón de la app.', '#/buzon', v_dest);
    return;
  end if;

  -- Fuera de horario: la próxima apertura (hoy si aún no ha llegado; si no, mañana).
  v_apertura := ((case when v_hora < v_desde then v_local::date else v_local::date + 1 end) + v_desde) at time zone v_zona;
  select count(*) into v_pend from public.consultas where estado = 'PENDIENTE';
  update public.push_personal_pendientes
     set cuerpo = case when v_pend = 1 then 'Hay 1 consulta pendiente de responder.' else 'Hay ' || v_pend || ' consultas pendientes de responder.' end,
         destinatarios = v_dest, enviar_desde = v_apertura
   where url = '#/buzon?noche' and enviar_desde > now();
  if not found then
    insert into public.push_personal_pendientes (titulo, cuerpo, url, destinatarios, enviar_desde)
    values ('Consultas nuevas en el buzón',
            case when v_pend = 1 then 'Hay 1 consulta pendiente de responder.' else 'Hay ' || v_pend || ' consultas pendientes de responder.' end,
            '#/buzon?noche', v_dest, v_apertura);
  end if;
end $$;
revoke all on function public._buzon_avisar_equipo(uuid) from public, anon, authenticated;

-- Texto limpio y dentro del límite, o error con un mensaje para el usuario.
create or replace function public._buzon_texto(p_texto text)
returns text language plpgsql immutable set search_path = public as $$
declare v text := btrim(coalesce(p_texto, ''), E' \n\r\t');
begin
  if v = '' then raise exception 'Escribe tu mensaje.' using errcode = 'check_violation'; end if;
  if char_length(v) > 1500 then raise exception 'El mensaje es demasiado largo (máximo 1.500 letras).' using errcode = 'check_violation'; end if;
  return v;
end $$;

-- Un alumno no puede mandar más de 10 mensajes en 24 horas.
create or replace function public._buzon_limite(p_cliente_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if (select count(*) from public.consulta_mensajes m join public.consultas c on c.id = m.consulta_id
       where c.cliente_id = p_cliente_id and m.autor = 'CLIENTE' and m.creado_el > now() - interval '24 hours') >= 10 then
    raise exception 'Has enviado muchos mensajes hoy. Si es urgente, llama al centro.' using errcode = 'check_violation';
  end if;
end $$;
revoke all on function public._buzon_limite(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Órdenes de la app
-- -----------------------------------------------------------------------------
create or replace function public.enviar_consulta(p_motivo text, p_texto text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cliente uuid := public.auth_cliente_id();
  v_texto   text;
  v_id      uuid;
begin
  if v_cliente is null then
    raise exception 'Solo los alumnos pueden escribir al centro desde aquí.' using errcode = 'insufficient_privilege';
  end if;
  if not coalesce((select buzon_activo from public.config_centro limit 1), true) then
    raise exception 'Ahora mismo no se puede escribir al centro desde la app.' using errcode = 'check_violation';
  end if;
  if p_motivo is null or p_motivo not in ('CLASES', 'LESION', 'TARIFA', 'OTRO') then
    raise exception 'Elige sobre qué es tu consulta.' using errcode = 'check_violation';
  end if;
  v_texto := public._buzon_texto(p_texto);
  perform public._buzon_limite(v_cliente);

  insert into public.consultas (cliente_id, motivo) values (v_cliente, p_motivo) returning id into v_id;
  insert into public.consulta_mensajes (consulta_id, autor, texto) values (v_id, 'CLIENTE', v_texto);
  perform public._auditar('CONSULTA', 'consulta', v_id::text, public._nombre_cliente(v_cliente) || ' escribe al centro');
  perform public._buzon_avisar_equipo(v_cliente);
  return v_id;
end $$;
comment on function public.enviar_consulta(text, text) is 'Un alumno abre una consulta al centro (0052). Devuelve su id.';
revoke all on function public.enviar_consulta(text, text) from public, anon;
grant execute on function public.enviar_consulta(text, text) to authenticated;

-- Escribe en una consulta: el alumno en la suya (vuelve a PENDIENTE) o el centro (pasa a RESPONDIDA y se avisa al alumno).
create or replace function public.responder_consulta(p_consulta_id uuid, p_texto text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_con     public.consultas%rowtype;
  v_cliente uuid := public.auth_cliente_id();
  v_texto   text;
  v_msg     uuid;
  v_aviso   uuid;
begin
  select * into v_con from public.consultas where id = p_consulta_id for update;
  if not found then raise exception 'La consulta no existe.' using errcode = 'no_data_found'; end if;
  v_texto := public._buzon_texto(p_texto);

  if v_cliente is not null and v_cliente = v_con.cliente_id then
    perform public._buzon_limite(v_cliente);
    insert into public.consulta_mensajes (consulta_id, autor, texto) values (v_con.id, 'CLIENTE', v_texto) returning id into v_msg;
    update public.consultas set estado = 'PENDIENTE', actualizada_el = now() where id = v_con.id;
    perform public._auditar('CONSULTA', 'consulta', v_con.id::text, public._nombre_cliente(v_cliente) || ' escribe al centro');
    perform public._buzon_avisar_equipo(v_cliente);
    return v_msg;
  end if;

  if not public.atiende_buzon() then
    raise exception 'No atiendes el buzón de los alumnos.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.consulta_mensajes (consulta_id, autor, texto) values (v_con.id, 'CENTRO', v_texto) returning id into v_msg;
  insert into public.consulta_respuestas (mensaje_id, trabajador_id) values (v_msg, public.auth_trabajador_id());
  update public.consultas set estado = 'RESPONDIDA', actualizada_el = now() where id = v_con.id;

  -- Aviso al alumno (y a su móvil si lo tiene activado). Uno por consulta: el anterior sin leer se sustituye.
  delete from public.avisos a
   where a.consulta_id = v_con.id
     and not exists (select 1 from public.aviso_lecturas l where l.aviso_id = a.id and l.cliente_id = v_con.cliente_id);
  insert into public.avisos (titulo, cuerpo, destino_tipo, importante, publicado_por, consulta_id)
  values ('Nuevo Palmar ha respondido a tu consulta', 'Tienes la respuesta en Avisos, en "Mis consultas".', 'CLIENTES', false, null, v_con.id)
  returning id into v_aviso;
  insert into public.aviso_destinatarios (aviso_id, cliente_id) values (v_aviso, v_con.cliente_id);
  insert into public.avisos_push_pendientes (aviso_id) values (v_aviso) on conflict do nothing;

  perform public._auditar('CONSULTA', 'consulta', v_con.id::text, 'Respuesta a ' || public._nombre_cliente(v_con.cliente_id));
  return v_msg;
end $$;
comment on function public.responder_consulta(uuid, text) is 'Añade un mensaje a una consulta: el alumno en la suya o quien atiende el buzón (0052).';
revoke all on function public.responder_consulta(uuid, text) from public, anon;
grant execute on function public.responder_consulta(uuid, text) to authenticated;

create or replace function public.cerrar_consulta(p_consulta_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cliente uuid;
begin
  if not public.atiende_buzon() then
    raise exception 'No atiendes el buzón de los alumnos.' using errcode = 'insufficient_privilege';
  end if;
  update public.consultas set estado = 'CERRADA', actualizada_el = now()
   where id = p_consulta_id and estado <> 'CERRADA' returning cliente_id into v_cliente;
  if v_cliente is not null then
    perform public._auditar('CONSULTA', 'consulta', p_consulta_id::text, 'Cerrada la consulta de ' || public._nombre_cliente(v_cliente));
  end if;
end $$;
comment on function public.cerrar_consulta(uuid) is 'Quien atiende el buzón cierra una consulta que no necesita (más) respuesta (0052).';
revoke all on function public.cerrar_consulta(uuid) from public, anon;
grant execute on function public.cerrar_consulta(uuid) to authenticated;

-- El alumno abre su consulta: queda leída, y también su aviso de "te han respondido".
create or replace function public.leer_consulta(p_consulta_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cliente uuid := public.auth_cliente_id();
begin
  if v_cliente is null then return; end if;
  update public.consultas set leida_cliente_el = now() where id = p_consulta_id and cliente_id = v_cliente;
  if not found then return; end if;
  insert into public.aviso_lecturas (aviso_id, cliente_id)
  select a.id, v_cliente from public.avisos a where a.consulta_id = p_consulta_id
  on conflict do nothing;
  -- Ya la ha leído: si su aviso aún no había salido hacia el móvil, ya no hace falta.
  delete from public.avisos_push_pendientes p using public.avisos a where a.id = p.aviso_id and a.consulta_id = p_consulta_id;
end $$;
comment on function public.leer_consulta(uuid) is 'El alumno marca como leída su consulta y su aviso de respuesta (0052).';
revoke all on function public.leer_consulta(uuid) from public, anon;
grant execute on function public.leer_consulta(uuid) to authenticated;

-- Cada persona del buzón decide si le suena el móvil con las consultas nuevas.
create or replace function public.buzon_avisarme(p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.atiende_buzon() then
    raise exception 'No atiendes el buzón de los alumnos.' using errcode = 'insufficient_privilege';
  end if;
  update public.trabajadores set buzon_push = coalesce(p_activo, true) where user_id = auth.uid();
end $$;
comment on function public.buzon_avisarme(boolean) is 'Activa o desactiva para uno mismo el aviso al móvil de las consultas nuevas (0052).';
revoke all on function public.buzon_avisarme(boolean) from public, anon;
grant execute on function public.buzon_avisarme(boolean) to authenticated;
