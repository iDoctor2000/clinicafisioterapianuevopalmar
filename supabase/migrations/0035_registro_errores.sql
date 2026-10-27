-- =============================================================================
-- 0035_registro_errores.sql · Los errores que ve la gente en la app quedan registrados
--
--   Hasta ahora, cuando a alguien le salía un error en la app (un mensaje rojo, una acción que
--   no se podía hacer, un fallo de la propia app), solo quedaba en el registro de ese móvil:
--   para saberlo había que pedirle el informe de diagnóstico.
--
--   Ahora la app lo anota también en el servidor (tabla `errores_app`), venga de un alumno, del
--   equipo o de alguien sin sesión (pantalla de entrar). Así el informe de uso dice qué errores
--   han salido, cuántas veces y a cuántas personas, sin tener que preguntar.
--     · Solo se guarda el texto del mensaje (recortado), la pantalla, el tipo de usuario y la
--       versión de la app. Nada de contraseñas ni fotos.
--     · Solo el administrador puede leerlo. Se borra solo a los 90 días.
--     · Límite por persona (200 por hora) para que un fallo en bucle no llene la tabla.
--   Idempotente.
-- =============================================================================

create table if not exists public.errores_app (
  id            uuid primary key default gen_random_uuid(),
  instante      timestamptz not null default now(),
  user_id       uuid,
  tipo_usuario  text not null check (tipo_usuario in ('ALUMNO', 'EQUIPO', 'SIN_SESION')),
  tipo          text not null check (tipo in ('pantalla', 'accion', 'fallo')),
  mensaje       text not null,
  pantalla      text not null default '',
  detalle       text not null default '',
  version       text not null default '',
  navegador     text not null default ''
);
comment on table public.errores_app is 'Errores que han visto los usuarios en la app (mensaje en pantalla, acción fallida, fallo de la app). Solo lo lee el administrador; se borra a los 90 días.';
create index if not exists errores_app_instante_idx on public.errores_app (instante desc);
alter table public.errores_app enable row level security;
revoke all on public.errores_app from public, anon, authenticated;
grant select on public.errores_app to authenticated;
drop policy if exists errores_app_admin on public.errores_app;
create policy errores_app_admin on public.errores_app for select to authenticated using (public.es_admin());
grant select, delete on public.errores_app to service_role;

create or replace function public.registrar_error_app(p_tipo text, p_mensaje text, p_pantalla text default '', p_detalle text default '', p_version text default '', p_navegador text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_tipo_usuario text;
begin
  if coalesce(trim(p_mensaje), '') = '' then return; end if;
  -- Un fallo en bucle no llena la tabla.
  if (select count(*) from public.errores_app
       where instante > now() - interval '1 hour' and user_id is not distinct from v_uid) >= 200 then
    return;
  end if;
  v_tipo_usuario := case when v_uid is null then 'SIN_SESION'
                         when public.auth_trabajador_id() is not null then 'EQUIPO'
                         else 'ALUMNO' end;
  insert into public.errores_app (user_id, tipo_usuario, tipo, mensaje, pantalla, detalle, version, navegador)
  values (v_uid, v_tipo_usuario,
          case when p_tipo in ('pantalla', 'accion', 'fallo') then p_tipo else 'fallo' end,
          left(p_mensaje, 500), left(coalesce(p_pantalla, ''), 120), left(coalesce(p_detalle, ''), 1000),
          left(coalesce(p_version, ''), 40), left(coalesce(p_navegador, ''), 200));
  -- Limpieza de lo antiguo (de vez en cuando).
  if random() < 0.02 then
    delete from public.errores_app where instante < now() - interval '90 days';
  end if;
end $$;
comment on function public.registrar_error_app(text, text, text, text, text, text) is 'La app anota un error que ha visto el usuario (0035).';
revoke all on function public.registrar_error_app(text, text, text, text, text, text) from public;
grant execute on function public.registrar_error_app(text, text, text, text, text, text) to anon, authenticated;
