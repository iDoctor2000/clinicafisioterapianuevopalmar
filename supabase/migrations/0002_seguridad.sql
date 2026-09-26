-- =============================================================================
-- 0002_seguridad.sql · Funciones auxiliares de identidad y Row Level Security
--
-- Principios:
--   · Todas las tablas tienen RLS activado. Sin política no se ve nada.
--   · Los clientes solo acceden a lo suyo. Los trabajadores según permisos.
--   · La información clínica (clientes_clinica) solo con CLINICA_VER.
--   · Las mutaciones con reglas de negocio se hacen por RPC (0003), no por
--     insert/update directo del cliente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funciones de identidad (security definer para no depender de las políticas
-- de clientes/trabajadores y evitar recursión en RLS).
-- -----------------------------------------------------------------------------
create or replace function public.auth_cliente_id()
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from public.clientes c where c.user_id = auth.uid() and c.activo limit 1
$$;
comment on function public.auth_cliente_id() is 'Cliente vinculado al usuario autenticado (NULL si no es cliente activo).';

create or replace function public.auth_trabajador_id()
returns uuid language sql stable security definer set search_path = public as $$
  select t.id from public.trabajadores t where t.user_id = auth.uid() and t.activo limit 1
$$;
comment on function public.auth_trabajador_id() is 'Trabajador vinculado al usuario autenticado (NULL si no es trabajador activo).';

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trabajadores t
     where t.user_id = auth.uid() and t.activo and t.rol = 'ADMIN'
  )
$$;
comment on function public.es_admin() is 'true si el usuario actual es un trabajador activo con rol ADMIN.';

create or replace function public.tiene_permiso(p_permiso public.permiso)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.trabajadores t
     where t.user_id = auth.uid()
       and t.activo
       and (
         t.rol = 'ADMIN'
         or exists (select 1 from public.trabajador_permisos p where p.trabajador_id = t.id and p.permiso = p_permiso)
       )
  )
$$;
comment on function public.tiene_permiso(public.permiso) is 'true si el usuario es ADMIN o tiene el permiso; false si no es trabajador.';

-- -----------------------------------------------------------------------------
-- Privilegios base: anon no toca nada; authenticated pasa por RLS.
-- (Supabase concede por defecto privilegios a anon: los retiramos explícitamente.)
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated, anon;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.monitores to authenticated;

revoke all on function public.auth_cliente_id() from public, anon;
revoke all on function public.auth_trabajador_id() from public, anon;
revoke all on function public.es_admin() from public, anon;
revoke all on function public.tiene_permiso(public.permiso) from public, anon;
grant execute on function public.auth_cliente_id() to authenticated;
grant execute on function public.auth_trabajador_id() to authenticated;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.tiene_permiso(public.permiso) to authenticated;

-- -----------------------------------------------------------------------------
-- Un cliente solo puede cambiar sus datos de contacto y notificaciones_push.
-- (Las políticas RLS no restringen columnas; lo hace este trigger.)
-- -----------------------------------------------------------------------------
create or replace function public.trg_clientes_autoedicion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.tiene_permiso('CLIENTES_EDITAR') then
    return new;
  end if;
  -- Cliente editando su propia ficha: solo contacto y preferencias.
  if new.nombre is distinct from old.nombre
     or new.apellidos is distinct from old.apellidos
     or new.dni is distinct from old.dni
     or new.activo is distinct from old.activo
     or new.user_id is distinct from old.user_id
     or new.alta_el is distinct from old.alta_el
     or new.baja_el is distinct from old.baja_el then
    raise exception 'Solo puedes modificar tus datos de contacto y notificaciones.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger clientes_autoedicion before update on public.clientes
  for each row execute function public.trg_clientes_autoedicion();

-- -----------------------------------------------------------------------------
-- Activar RLS en todas las tablas
-- -----------------------------------------------------------------------------
alter table public.config_centro       enable row level security;
alter table public.dias_cierre         enable row level security;
alter table public.actividades         enable row level security;
alter table public.tarifas             enable row level security;
alter table public.tarifa_cupos        enable row level security;
alter table public.trabajadores        enable row level security;
alter table public.trabajador_permisos enable row level security;
alter table public.clientes            enable row level security;
alter table public.clientes_clinica    enable row level security;
alter table public.plantillas_clase    enable row level security;
alter table public.clases              enable row level security;
alter table public.contratos           enable row level security;
alter table public.contrato_franjas    enable row level security;
alter table public.reservas            enable row level security;
alter table public.recuperaciones      enable row level security;
alter table public.avisos              enable row level security;
alter table public.aviso_destinatarios enable row level security;
alter table public.aviso_lecturas      enable row level security;
alter table public.auditoria           enable row level security;
alter table public.suscripciones_push  enable row level security;
alter table public.pagos               enable row level security;

-- -----------------------------------------------------------------------------
-- Configuración y días de cierre: lectura para todos, escritura solo ADMIN
-- -----------------------------------------------------------------------------
create policy config_leer on public.config_centro for select to authenticated using (true);
create policy config_escribir on public.config_centro for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

create policy cierres_leer on public.dias_cierre for select to authenticated using (true);
create policy cierres_escribir on public.dias_cierre for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- -----------------------------------------------------------------------------
-- Actividades y tarifas: lectura para todos (tarifas: solo activas para clientes),
-- escritura con TARIFAS_GESTIONAR
-- -----------------------------------------------------------------------------
create policy actividades_leer on public.actividades for select to authenticated using (true);
create policy actividades_escribir on public.actividades for all to authenticated
  using (public.tiene_permiso('TARIFAS_GESTIONAR')) with check (public.tiene_permiso('TARIFAS_GESTIONAR'));

create policy tarifas_leer on public.tarifas for select to authenticated
  using (activa or public.auth_trabajador_id() is not null);
create policy tarifas_escribir on public.tarifas for all to authenticated
  using (public.tiene_permiso('TARIFAS_GESTIONAR')) with check (public.tiene_permiso('TARIFAS_GESTIONAR'));

create policy tarifa_cupos_leer on public.tarifa_cupos for select to authenticated
  using (exists (select 1 from public.tarifas t where t.id = tarifa_id and (t.activa or public.auth_trabajador_id() is not null)));
create policy tarifa_cupos_escribir on public.tarifa_cupos for all to authenticated
  using (public.tiene_permiso('TARIFAS_GESTIONAR')) with check (public.tiene_permiso('TARIFAS_GESTIONAR'));

-- -----------------------------------------------------------------------------
-- Trabajadores y permisos: cada trabajador ve su ficha y las de sus compañeros;
-- gestión con TRABAJADORES_GESTIONAR. Los clientes usan la vista `monitores`.
-- -----------------------------------------------------------------------------
create policy trabajadores_leer on public.trabajadores for select to authenticated
  using (public.auth_trabajador_id() is not null);
create policy trabajadores_escribir on public.trabajadores for all to authenticated
  using (public.tiene_permiso('TRABAJADORES_GESTIONAR')) with check (public.tiene_permiso('TRABAJADORES_GESTIONAR'));

create policy permisos_leer on public.trabajador_permisos for select to authenticated
  using (trabajador_id = public.auth_trabajador_id() or public.tiene_permiso('TRABAJADORES_GESTIONAR'));
create policy permisos_escribir on public.trabajador_permisos for all to authenticated
  using (public.tiene_permiso('TRABAJADORES_GESTIONAR')) with check (public.tiene_permiso('TRABAJADORES_GESTIONAR'));

-- -----------------------------------------------------------------------------
-- Clientes: su propia fila (lectura y edición limitada por trigger);
-- trabajadores con CLIENTES_VER leen, con CLIENTES_EDITAR escriben.
-- -----------------------------------------------------------------------------
create policy clientes_leer on public.clientes for select to authenticated
  using (id = public.auth_cliente_id() or public.tiene_permiso('CLIENTES_VER'));
create policy clientes_autoeditar on public.clientes for update to authenticated
  using (id = public.auth_cliente_id()) with check (id = public.auth_cliente_id());
create policy clientes_editar on public.clientes for all to authenticated
  using (public.tiene_permiso('CLIENTES_EDITAR')) with check (public.tiene_permiso('CLIENTES_EDITAR'));

-- Información clínica: SOLO con CLINICA_VER (ni siquiera el propio cliente desde la app).
create policy clinica_acceso on public.clientes_clinica for all to authenticated
  using (public.tiene_permiso('CLINICA_VER')) with check (public.tiene_permiso('CLINICA_VER'));

-- -----------------------------------------------------------------------------
-- Horario y clases: lectura para todos; horario con HORARIOS_GESTIONAR,
-- clases con CLASES_CREAR_CANCELAR (la cancelación con reglas va por RPC).
-- -----------------------------------------------------------------------------
create policy plantillas_leer on public.plantillas_clase for select to authenticated using (true);
create policy plantillas_escribir on public.plantillas_clase for all to authenticated
  using (public.tiene_permiso('HORARIOS_GESTIONAR')) with check (public.tiene_permiso('HORARIOS_GESTIONAR'));

create policy clases_leer on public.clases for select to authenticated using (true);
create policy clases_escribir on public.clases for all to authenticated
  using (public.tiene_permiso('CLASES_CREAR_CANCELAR')) with check (public.tiene_permiso('CLASES_CREAR_CANCELAR'));

-- -----------------------------------------------------------------------------
-- Contratos: el cliente ve los suyos; CLIENTES_VER lee, CLIENTES_EDITAR escribe.
-- -----------------------------------------------------------------------------
create policy contratos_leer on public.contratos for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.tiene_permiso('CLIENTES_VER'));
create policy contratos_escribir on public.contratos for all to authenticated
  using (public.tiene_permiso('CLIENTES_EDITAR')) with check (public.tiene_permiso('CLIENTES_EDITAR'));

create policy franjas_leer on public.contrato_franjas for select to authenticated
  using (
    public.tiene_permiso('CLIENTES_VER')
    or exists (select 1 from public.contratos c where c.id = contrato_id and c.cliente_id = public.auth_cliente_id())
  );
create policy franjas_escribir on public.contrato_franjas for all to authenticated
  using (public.tiene_permiso('CLIENTES_EDITAR')) with check (public.tiene_permiso('CLIENTES_EDITAR'));

-- -----------------------------------------------------------------------------
-- Reservas y recuperaciones: el cliente ve las suyas; cualquier trabajador las lee
-- (listas de clase); gestión directa solo con RESERVAS_GESTIONAR.
-- Los clientes reservan/cancelan únicamente mediante las RPC de 0003.
-- -----------------------------------------------------------------------------
create policy reservas_leer on public.reservas for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.auth_trabajador_id() is not null);
create policy reservas_gestionar on public.reservas for all to authenticated
  using (public.tiene_permiso('RESERVAS_GESTIONAR')) with check (public.tiene_permiso('RESERVAS_GESTIONAR'));

create policy recuperaciones_leer on public.recuperaciones for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.auth_trabajador_id() is not null);
create policy recuperaciones_gestionar on public.recuperaciones for all to authenticated
  using (public.tiene_permiso('RESERVAS_GESTIONAR')) with check (public.tiene_permiso('RESERVAS_GESTIONAR'));

-- -----------------------------------------------------------------------------
-- Avisos: el cliente ve aquellos de los que es destinatario y marca sus lecturas;
-- cualquier trabajador los lee; publicación con AVISOS_ENVIAR.
-- -----------------------------------------------------------------------------
create policy avisos_leer on public.avisos for select to authenticated
  using (
    public.auth_trabajador_id() is not null
    or exists (select 1 from public.aviso_destinatarios d where d.aviso_id = avisos.id and d.cliente_id = public.auth_cliente_id())
  );
create policy avisos_escribir on public.avisos for all to authenticated
  using (public.tiene_permiso('AVISOS_ENVIAR')) with check (public.tiene_permiso('AVISOS_ENVIAR'));

create policy destinatarios_leer on public.aviso_destinatarios for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.auth_trabajador_id() is not null);
create policy destinatarios_escribir on public.aviso_destinatarios for all to authenticated
  using (public.tiene_permiso('AVISOS_ENVIAR')) with check (public.tiene_permiso('AVISOS_ENVIAR'));

create policy lecturas_leer on public.aviso_lecturas for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.auth_trabajador_id() is not null);
create policy lecturas_marcar on public.aviso_lecturas for insert to authenticated
  with check (
    aviso_lecturas.cliente_id = public.auth_cliente_id()
    and exists (select 1 from public.aviso_destinatarios d
                 where d.aviso_id = aviso_lecturas.aviso_id and d.cliente_id = aviso_lecturas.cliente_id)
  );

-- -----------------------------------------------------------------------------
-- Auditoría: solo lectura y solo ADMIN (escriben las funciones security definer).
-- -----------------------------------------------------------------------------
create policy auditoria_leer on public.auditoria for select to authenticated using (public.es_admin());

-- -----------------------------------------------------------------------------
-- Suscripciones push: cada cliente gestiona las suyas. Los envíos los hace una
-- Edge Function con la service role key (que no pasa por RLS).
-- -----------------------------------------------------------------------------
create policy push_propias on public.suscripciones_push for all to authenticated
  using (cliente_id = public.auth_cliente_id()) with check (cliente_id = public.auth_cliente_id());
create policy push_leer_personal on public.suscripciones_push for select to authenticated
  using (public.tiene_permiso('AVISOS_ENVIAR'));

-- -----------------------------------------------------------------------------
-- Pagos: el cliente ve los suyos, CLIENTES_VER los lee; escritura solo ADMIN
-- (el webhook de Stripe escribirá con la service role key).
-- -----------------------------------------------------------------------------
create policy pagos_leer on public.pagos for select to authenticated
  using (cliente_id = public.auth_cliente_id() or public.tiene_permiso('CLIENTES_VER'));
create policy pagos_escribir on public.pagos for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
