-- =============================================================================
-- 0008_portada.sql · Carrusel de fotos de la portada del cliente + nueva identidad
--
--   · Tabla `portada_imagenes`: fotos del centro que ven los clientes al entrar
--     (Inicio). url pública, pie opcional, orden y activa. RLS: cualquier usuario
--     autenticado las lee; solo el administrador (es_admin()) las crea, edita o borra.
--   · Bucket PÚBLICO `portada` en Storage (2 MB, jpeg/png/webp): lectura pública,
--     escritura solo del administrador. La app reduce las fotos a 1600 px de ancho
--     (JPEG 82 %) antes de subirlas. No contiene datos personales.
--   · Tiempo real: la tabla se añade a la publicación supabase_realtime.
--   · Identidad visual: los colores verdes de ejemplo de las actividades pasan a la
--     paleta beige/antracita (y el valor por defecto de la columna).
--   La parte de Storage y Realtime solo se aplica si existen en el servidor (Supabase);
--   en un PostgreSQL local de pruebas se omiten con un aviso.
--
-- Espejo de app/src/data/comandos.ts (guardarPortadaImagen, borrarPortadaImagen,
-- ordenarPortada) y app/src/data/supabase/portada.ts.
-- Idempotente: se puede volver a ejecutar sin efectos secundarios.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabla
-- -----------------------------------------------------------------------------
create table if not exists public.portada_imagenes (
  id         uuid primary key default gen_random_uuid(),
  url        text not null check (length(url) between 1 and 2048),
  pie        text not null default '' check (length(pie) <= 200),
  orden      integer not null default 0,
  activa     boolean not null default true,
  creado_el  timestamptz not null default now(),
  actualizado_el timestamptz not null default now()
);
comment on table public.portada_imagenes is 'Fotos del carrusel de la portada del cliente (Inicio). Solo las activas se muestran, por orden.';
comment on column public.portada_imagenes.url is 'URL pública de la imagen (bucket portada).';
comment on column public.portada_imagenes.pie is 'Pie de foto opcional.';
create index if not exists portada_imagenes_orden_idx on public.portada_imagenes (orden);
drop trigger if exists portada_imagenes_actualizado on public.portada_imagenes;
create trigger portada_imagenes_actualizado before update on public.portada_imagenes
  for each row execute function public.trg_actualizado_el();

-- -----------------------------------------------------------------------------
-- 2. Privilegios y RLS: lectura para cualquier usuario autenticado; escritura solo ADMIN.
-- -----------------------------------------------------------------------------
revoke all on public.portada_imagenes from anon;
grant select, insert, update, delete on public.portada_imagenes to authenticated;
alter table public.portada_imagenes enable row level security;
drop policy if exists portada_leer on public.portada_imagenes;
create policy portada_leer on public.portada_imagenes for select to authenticated using (true);
drop policy if exists portada_gestionar on public.portada_imagenes;
create policy portada_gestionar on public.portada_imagenes for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- -----------------------------------------------------------------------------
-- 3. Bucket público `portada` y políticas de Storage (solo en Supabase)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('portada', 'portada', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
      on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
    $sql$;
    -- Lectura pública (el bucket es público; esta política cubre también el listado por API).
    execute 'drop policy if exists portada_leer on storage.objects';
    execute $sql$
      create policy portada_leer on storage.objects for select to public
        using (bucket_id = 'portada')
    $sql$;
    -- Escritura (subir, reemplazar, borrar): solo el administrador.
    execute 'drop policy if exists portada_admin_escribir on storage.objects';
    execute $sql$
      create policy portada_admin_escribir on storage.objects for all to authenticated
        using (bucket_id = 'portada' and public.es_admin())
        with check (bucket_id = 'portada' and public.es_admin())
    $sql$;
    raise notice '0008_portada: bucket portada y políticas de Storage aplicados.';
  else
    raise notice '0008_portada: no existe el schema storage (PostgreSQL local): se omite el bucket y sus políticas.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Tiempo real (solo en Supabase)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice '0008_portada: publicación supabase_realtime no existe (fuera de Supabase): se omite.';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'portada_imagenes'
  ) then
    execute 'alter publication supabase_realtime add table public.portada_imagenes';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Nueva identidad visual: los verdes de ejemplo pasan a beige/antracita.
--    (Los colores son por actividad: el administrador puede cambiarlos en Tarifas.)
-- -----------------------------------------------------------------------------
alter table public.actividades alter column color set default '#86735F';
alter table public.trabajadores alter column color set default '#3A3A3A';
update public.actividades set color = case upper(color)
  when '#548C2F' then '#86735F'
  when '#7FB356' then '#B9A795'
  when '#A3CB80' then '#A08D79'
  when '#8FBF6A' then '#CFC0B0'
  else color end
where upper(color) in ('#548C2F', '#7FB356', '#A3CB80', '#8FBF6A');
update public.trabajadores set color = '#3A3A3A' where upper(color) in ('#548C2F', '#7FB356', '#A3CB80', '#8FBF6A');
