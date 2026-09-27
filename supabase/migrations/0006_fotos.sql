-- =============================================================================
-- 0006_fotos.sql · Foto del cliente
--
--   · Columna `clientes.foto_url`: ruta del objeto en el bucket privado
--     `fotos-clientes` (`<cliente_id>/avatar.jpg`) más `?v=<marca>` para que la
--     app invalide su caché al cambiarla. NULL = sin foto (se muestran iniciales).
--   · El cliente puede poner/quitar su foto (trigger de autoedición: foto_url es
--     una columna que el cliente puede editar, como el teléfono o el email).
--   · Bucket `fotos-clientes` PRIVADO (500 KB, solo jpeg/png/webp) con políticas
--     sobre storage.objects:
--       - el cliente lee/sube/borra solo su carpeta (`<su id>/…`);
--       - el personal lee con CLIENTES_VER y escribe con CLIENTES_EDITAR; con
--         ámbito SUS_CLASES, solo las fotos de sus alumnos (alcance_cliente).
--     Como el bucket es privado, la app pide URLs firmadas (1 h) al mostrarlas.
--   La parte de Storage solo se aplica si existe el schema `storage` (Supabase);
--   en un PostgreSQL local de pruebas se omite con un aviso.
--
-- Espejo de app/src/data/comandos.ts (actualizarFotoCliente) y app/src/data/supabase/fotos.ts.
-- Idempotente: se puede volver a ejecutar sin efectos secundarios.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columna
-- -----------------------------------------------------------------------------
alter table public.clientes add column if not exists foto_url text;
comment on column public.clientes.foto_url is 'Ruta de la foto en el bucket privado fotos-clientes (<cliente_id>/avatar.jpg?v=<marca>). NULL = sin foto.';

-- -----------------------------------------------------------------------------
-- 2. Autoedición del cliente: puede cambiar contacto, notificaciones y foto_url
--    (misma lista de columnas bloqueadas que en 0002; foto_url queda permitida).
-- -----------------------------------------------------------------------------
create or replace function public.trg_clientes_autoedicion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.tiene_permiso('CLIENTES_EDITAR') then
    return new;
  end if;
  -- Cliente editando su propia ficha: solo direccion, email, telefono, notificaciones_push y foto_url.
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
comment on function public.trg_clientes_autoedicion() is 'Sin CLIENTES_EDITAR solo se pueden cambiar direccion, email, telefono, notificaciones_push y foto_url.';

-- -----------------------------------------------------------------------------
-- 3. Bucket privado y políticas de Storage (solo en Supabase)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('fotos-clientes', 'fotos-clientes', false, 512000, array['image/jpeg', 'image/png', 'image/webp'])
      on conflict (id) do update set public = false, file_size_limit = 512000, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
    $sql$;

    -- El cliente: su carpeta (<cliente_id>/...). Lectura y escritura.
    execute 'drop policy if exists fotos_cliente_propio on storage.objects';
    execute $sql$
      create policy fotos_cliente_propio on storage.objects for all to authenticated
        using (bucket_id = 'fotos-clientes' and (storage.foldername(name))[1] = public.auth_cliente_id()::text)
        with check (bucket_id = 'fotos-clientes' and (storage.foldername(name))[1] = public.auth_cliente_id()::text)
    $sql$;

    -- El personal: ver con CLIENTES_VER, escribir con CLIENTES_EDITAR; con SUS_CLASES solo sus alumnos.
    execute 'drop policy if exists fotos_personal_ver on storage.objects';
    execute $sql$
      create policy fotos_personal_ver on storage.objects for select to authenticated
        using (
          bucket_id = 'fotos-clientes'
          and public.tiene_permiso('CLIENTES_VER')
          and public.alcance_cliente(((storage.foldername(name))[1])::uuid)
        )
    $sql$;
    execute 'drop policy if exists fotos_personal_editar on storage.objects';
    execute $sql$
      create policy fotos_personal_editar on storage.objects for all to authenticated
        using (
          bucket_id = 'fotos-clientes'
          and public.tiene_permiso('CLIENTES_EDITAR')
          and public.alcance_cliente(((storage.foldername(name))[1])::uuid)
        )
        with check (
          bucket_id = 'fotos-clientes'
          and public.tiene_permiso('CLIENTES_EDITAR')
          and public.alcance_cliente(((storage.foldername(name))[1])::uuid)
        )
    $sql$;
    raise notice '0006_fotos: bucket fotos-clientes y políticas de Storage aplicados.';
  else
    raise notice '0006_fotos: no existe el schema storage (PostgreSQL local): se omite el bucket y sus políticas.';
  end if;
end $$;
