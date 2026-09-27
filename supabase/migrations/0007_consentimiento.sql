-- =============================================================================
-- 0007_consentimiento.sql · Consentimiento de la política de privacidad
--
--   · Columnas `clientes.consentimiento_el` (timestamptz) y
--     `clientes.consentimiento_version` (text): cuándo aceptó el cliente la
--     política de privacidad (docs/PRIVACIDAD.md) y qué versión ('2026-09-27'
--     cuando la acepta en la app; 'papel' cuando el personal registra la hoja
--     firmada en recepción). NULL = pendiente: la app se lo pide antes de dejarle
--     entrar (un CLIENTE sin consentimiento ve la pantalla "Consentimiento").
--   · El cliente puede registrar su propio consentimiento (trigger de
--     autoedición: las dos columnas pasan a ser editables por él, como el
--     teléfono o la foto). El personal con CLIENTES_EDITAR lo registra en papel
--     (la política RLS `clientes_editar` ya lo permite).
--   · Cada registro de consentimiento queda en `auditoria` (trigger).
--
--   CORRECCIÓN IMPORTANTE (registro de usuarios en producción): al crear un
--   usuario (signUp / Google), el trigger `trg_vincular_usuario` (0004) hace
--   `update clientes set user_id = ...` desde un proceso de auth SIN usuario
--   autenticado (auth.uid() es NULL). La versión anterior de
--   `trg_clientes_autoedicion` no distinguía ese caso y lo bloqueaba con
--   "Solo puedes modificar tus datos de contacto..." → GoTrue respondía
--   "Database error saving new user" y NINGÚN cliente podía registrarse.
--   Ahora, si auth.uid() es NULL (triggers de auth, pg_cron, scripts del
--   sistema) el trigger deja pasar la actualización. Es seguro: el rol `anon`
--   no puede escribir en `clientes` (RLS: solo `authenticated`, y solo su fila).
--
-- Espejo de app/src/data/comandos.ts (registrarConsentimiento,
-- registrarConsentimientoPapel) y app/src/data/supabase/comandos.ts.
-- Idempotente: se puede volver a ejecutar sin efectos secundarios.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas
-- -----------------------------------------------------------------------------
alter table public.clientes add column if not exists consentimiento_el timestamptz;
alter table public.clientes add column if not exists consentimiento_version text;
comment on column public.clientes.consentimiento_el is 'Instante en que el cliente aceptó la política de privacidad. NULL = pendiente.';
comment on column public.clientes.consentimiento_version is 'Versión de la política aceptada (fecha, p. ej. 2026-09-27) o ''papel'' si el personal registró la hoja firmada.';

-- -----------------------------------------------------------------------------
-- 2. Autoedición del cliente: contacto, notificaciones, foto y consentimiento.
--    Procesos del sistema (auth.uid() NULL) pasan siempre (ver cabecera).
-- -----------------------------------------------------------------------------
create or replace function public.trg_clientes_autoedicion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Sin usuario autenticado = proceso del sistema (trigger de auth.users que vincula
  -- user_id, pg_cron, scripts): no es un cliente editándose y no se limita.
  if auth.uid() is null or public.tiene_permiso('CLIENTES_EDITAR') then
    return new;
  end if;
  -- Cliente editando su propia ficha: solo direccion, email, telefono, notificaciones_push,
  -- foto_url, consentimiento_el y consentimiento_version.
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
comment on function public.trg_clientes_autoedicion() is
  'Sin CLIENTES_EDITAR solo se pueden cambiar direccion, email, telefono, notificaciones_push, foto_url y el consentimiento. Con auth.uid() NULL (sistema) no limita.';

-- -----------------------------------------------------------------------------
-- 3. Auditoría: cada consentimiento registrado (en la app o en papel) queda anotado.
-- -----------------------------------------------------------------------------
create or replace function public.trg_clientes_auditar_consentimiento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.consentimiento_el is distinct from old.consentimiento_el
     or new.consentimiento_version is distinct from old.consentimiento_version then
    perform public._auditar(
      case when new.consentimiento_version = 'papel' then 'CONSENTIMIENTO_PAPEL' else 'CONSENTIMIENTO' end,
      'cliente', new.id::text,
      format('%s %s: %s (%s)', new.nombre, new.apellidos,
             coalesce(to_char(new.consentimiento_el at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24:MI'), 'retirado'),
             coalesce(new.consentimiento_version, '-'))
    );
  end if;
  return new;
end $$;
drop trigger if exists clientes_auditar_consentimiento on public.clientes;
create trigger clientes_auditar_consentimiento after update on public.clientes
  for each row execute function public.trg_clientes_auditar_consentimiento();
