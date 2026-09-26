-- Simulación mínima de lo que Supabase provee: schema auth, auth.users, auth.uid() y roles.
-- Solo para pruebas locales; en Supabase ya existe todo esto.
create schema if not exists auth;
create table if not exists auth.users (
  id    uuid primary key,
  email text
);
-- auth.uid() lee el "sub" del JWT. Supabase lo expone en request.jwt.claims (json)
-- y, en versiones antiguas, en request.jwt.claim.sub. Soportamos ambos.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
