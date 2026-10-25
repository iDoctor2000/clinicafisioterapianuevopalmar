-- =============================================================================
-- 0025_consentimiento_adjunto.sql · Foto de la hoja de consentimiento firmada en papel
--
--   1. `clientes.consentimiento_adjunto`: ruta de la foto del papel firmado en el bucket
--      privado `consentimientos` (`<cliente_id>/<marca>.jpg`). NULL = sin foto.
--   2. Bucket `consentimientos` (privado, 2 MB, imágenes) y sus políticas: el personal
--      la ve con CLIENTES_VER y la sube o quita con CLIENTES_EDITAR, siempre dentro de su
--      ámbito. El alumno no accede a ella (la firmó en recepción; si la quiere, la pide).
--   3. Un cliente editando su propia ficha no puede tocar ese campo (trigger de autoedición).
--   4. Auditoría: poner o quitar la foto queda anotado (CONSENTIMIENTO_ADJUNTO).
--   Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La columna
-- -----------------------------------------------------------------------------
alter table public.clientes add column if not exists consentimiento_adjunto text;
comment on column public.clientes.consentimiento_adjunto is 'Ruta en el bucket consentimientos de la foto de la hoja firmada en papel. NULL = sin foto.';

-- -----------------------------------------------------------------------------
-- 2. Bucket privado y políticas de Storage (solo en Supabase)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('consentimientos', 'consentimientos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
      on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
    $sql$;

    execute 'drop policy if exists consentimientos_personal_ver on storage.objects';
    execute $sql$
      create policy consentimientos_personal_ver on storage.objects for select to authenticated
        using (
          bucket_id = 'consentimientos'
          and public.tiene_permiso('CLIENTES_VER')
          and public.alcance_cliente(((storage.foldername(name))[1])::uuid)
        )
    $sql$;
    execute 'drop policy if exists consentimientos_personal_editar on storage.objects';
    execute $sql$
      create policy consentimientos_personal_editar on storage.objects for all to authenticated
        using (
          bucket_id = 'consentimientos'
          and public.tiene_permiso('CLIENTES_EDITAR')
          and public.alcance_cliente(((storage.foldername(name))[1])::uuid)
        )
        with check (
          bucket_id = 'consentimientos'
          and public.tiene_permiso('CLIENTES_EDITAR')
          and public.alcance_cliente(((storage.foldername(name))[1])::uuid)
        )
    $sql$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Autoedición del cliente: igual que en 0007, y además no toca la foto del papel
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
  -- foto_url, fecha_nacimiento, consentimiento_el y consentimiento_version.
  if new.nombre is distinct from old.nombre
     or new.apellidos is distinct from old.apellidos
     or new.dni is distinct from old.dni
     or new.activo is distinct from old.activo
     or new.user_id is distinct from old.user_id
     or new.alta_el is distinct from old.alta_el
     or new.baja_el is distinct from old.baja_el
     or new.consentimiento_adjunto is distinct from old.consentimiento_adjunto then
    raise exception 'Solo puedes modificar tus datos de contacto y notificaciones.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
comment on function public.trg_clientes_autoedicion() is
  'Sin CLIENTES_EDITAR solo se pueden cambiar direccion, email, telefono, notificaciones_push, foto_url, fecha_nacimiento y el consentimiento (no su foto). Con auth.uid() NULL (sistema) no limita.';

-- -----------------------------------------------------------------------------
-- 4. Auditoría: consentimiento (como en 0007) y, además, la foto del papel
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
  if new.consentimiento_adjunto is distinct from old.consentimiento_adjunto then
    perform public._auditar('CONSENTIMIENTO_ADJUNTO', 'cliente', new.id::text,
      format('%s %s: %s', new.nombre, new.apellidos, case when new.consentimiento_adjunto is null then 'foto del papel quitada' else 'foto del papel firmado guardada' end));
  end if;
  return new;
end $$;
drop trigger if exists clientes_auditar_consentimiento on public.clientes;
create trigger clientes_auditar_consentimiento after update on public.clientes
  for each row execute function public.trg_clientes_auditar_consentimiento();
