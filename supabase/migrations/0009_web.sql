-- =============================================================================
-- 0009_web.sql · Contenido de la web pública en Supabase (sustituye a Firebase)
--
--   · Tabla `web_contenido`: una sola fila (id = 'main') con los textos e imágenes
--     de la web pública en JSON, tal y como los guarda el editor de index.html.
--     Lectura pública (la web la lee sin sesión); escritura solo del administrador
--     (es_admin()), que entra en el editor con su mismo correo y contraseña de la app.
--   · Bucket PÚBLICO `web` en Storage (5 MB, jpeg/png/webp) para las fotos que se
--     suben desde el editor. Lectura pública, escritura solo del administrador.
--   · Tiempo real: la tabla se añade a la publicación supabase_realtime para que la
--     web abierta en otro dispositivo refleje los cambios al instante.
--   La parte de Storage y Realtime solo se aplica si existen en el servidor (Supabase);
--   en un PostgreSQL local de pruebas se omiten con un aviso.
--
-- Espejo de index.html (ContentProvider: cargar/guardar/subirImagenWeb).
-- Idempotente: se puede volver a ejecutar sin efectos secundarios.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabla
-- -----------------------------------------------------------------------------
create table if not exists public.web_contenido (
  id              text primary key default 'main' check (id = 'main'),
  datos           jsonb not null default '{}'::jsonb,
  actualizado_el  timestamptz not null default now(),
  actualizado_por uuid references auth.users (id) on delete set null
);
comment on table public.web_contenido is 'Textos e imágenes de la web pública (una sola fila, id = main). Los edita el administrador desde el editor de la web.';
comment on column public.web_contenido.datos is 'Contenido completo en JSON (schema, secciones…), tal y como lo guarda index.html.';
comment on column public.web_contenido.actualizado_por is 'Usuario que guardó por última vez.';

-- Mantener `actualizado_el` al día (reutiliza el trigger genérico si existe).
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'trg_actualizado_el') then
    execute 'drop trigger if exists web_contenido_actualizado on public.web_contenido';
    execute 'create trigger web_contenido_actualizado before update on public.web_contenido for each row execute function public.trg_actualizado_el()';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Privilegios y RLS: lectura pública; escritura solo del administrador.
-- -----------------------------------------------------------------------------
grant select on public.web_contenido to anon, authenticated;
grant insert, update on public.web_contenido to authenticated;
alter table public.web_contenido enable row level security;
drop policy if exists web_contenido_leer on public.web_contenido;
create policy web_contenido_leer on public.web_contenido for select to anon, authenticated using (true);
drop policy if exists web_contenido_insertar on public.web_contenido;
create policy web_contenido_insertar on public.web_contenido for insert to authenticated with check (public.es_admin());
drop policy if exists web_contenido_actualizar on public.web_contenido;
create policy web_contenido_actualizar on public.web_contenido for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- El editor necesita saber si quien entra es administrador: es_admin() ya es ejecutable
-- por cualquier usuario autenticado (0002_seguridad.sql).

-- -----------------------------------------------------------------------------
-- 3. Bucket público `web` y políticas de Storage (solo en Supabase)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('web', 'web', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
      on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
    $sql$;
    execute 'drop policy if exists web_leer on storage.objects';
    execute $sql$
      create policy web_leer on storage.objects for select to public
        using (bucket_id = 'web')
    $sql$;
    execute 'drop policy if exists web_admin_escribir on storage.objects';
    execute $sql$
      create policy web_admin_escribir on storage.objects for all to authenticated
        using (bucket_id = 'web' and public.es_admin())
        with check (bucket_id = 'web' and public.es_admin())
    $sql$;
    raise notice '0009_web: bucket web y políticas de Storage aplicados.';
  else
    raise notice '0009_web: no existe el schema storage (PostgreSQL local): se omite el bucket y sus políticas.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Tiempo real (solo en Supabase)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice '0009_web: publicación supabase_realtime no existe (fuera de Supabase): se omite.';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'web_contenido'
  ) then
    execute 'alter publication supabase_realtime add table public.web_contenido';
  end if;
end $$;
