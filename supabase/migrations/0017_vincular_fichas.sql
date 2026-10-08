-- =============================================================================
-- 0017_vincular_fichas.sql · Enlazar la cuenta con la ficha también al revés
--
--   Hasta ahora (0004) la cuenta de acceso solo se enlazaba con la ficha en el momento
--   de crear la cuenta. Si el alumno se registraba ANTES de que el centro le creara la
--   ficha (o con el correo mal escrito en la ficha y corregido después), se quedaba en
--   "Tu usuario aún no está dado de alta en el centro" aunque el correo coincidiera.
--
--   Ahora:
--     1. Al crear una ficha (cliente o trabajador) o cambiarle el correo, si ya existe
--        una cuenta con ese correo, se enlaza en el momento.
--     2. Al crear una cuenta, se enlaza igual que antes, sin fallar si hubiera dos fichas
--        con el mismo correo (se elige la activa más reciente).
--     3. Se enlazan ya todas las fichas que estaban en este caso.
--   Los correos se comparan sin distinguir mayúsculas y sin espacios sobrantes.
--   Idempotente.
-- =============================================================================

-- 1) Ficha nueva o con correo corregido → buscar su cuenta.
create or replace function public.trg_vincular_ficha_con_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if new.user_id is not null or coalesce(trim(new.email), '') = '' then
    return new;
  end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(trim(new.email)) limit 1;
  if v_uid is null then return new; end if;
  -- Una cuenta solo puede estar enlazada a una ficha de cada tipo.
  if tg_table_name = 'clientes' then
    if exists (select 1 from public.clientes c where c.user_id = v_uid and c.id <> new.id) then return new; end if;
  else
    if exists (select 1 from public.trabajadores t where t.user_id = v_uid and t.id <> new.id) then return new; end if;
  end if;
  new.user_id := v_uid;
  return new;
end $$;
comment on function public.trg_vincular_ficha_con_usuario() is
  'Al crear una ficha o cambiarle el correo, la enlaza con la cuenta de acceso que ya tenga ese correo.';

-- El nombre empieza por "vincular" para que se ejecute después de clientes_autoedicion
-- (los disparadores se ejecutan por orden alfabético).
drop trigger if exists clientes_vincular_usuario on public.clientes;
create trigger clientes_vincular_usuario before insert or update of email, user_id on public.clientes
  for each row execute function public.trg_vincular_ficha_con_usuario();
drop trigger if exists trabajadores_vincular_usuario on public.trabajadores;
create trigger trabajadores_vincular_usuario before insert or update of email, user_id on public.trabajadores
  for each row execute function public.trg_vincular_ficha_con_usuario();

-- 2) Cuenta nueva → buscar su ficha (como en 0004, pero sin fallar con correos repetidos).
create or replace function public.vincular_usuario_por_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is null then return new; end if;
  update public.trabajadores set user_id = new.id
   where id = (select t.id from public.trabajadores t
                where t.user_id is null and lower(trim(t.email)) = lower(new.email)
                order by t.activo desc limit 1)
     and not exists (select 1 from public.trabajadores t2 where t2.user_id = new.id);
  update public.clientes set user_id = new.id
   where id = (select c.id from public.clientes c
                where c.user_id is null and lower(trim(c.email)) = lower(new.email)
                order by c.activo desc, c.alta_el desc nulls last limit 1)
     and not exists (select 1 from public.clientes c2 where c2.user_id = new.id);
  return new;
end $$;
comment on function public.vincular_usuario_por_email() is
  'Al crearse un usuario en auth.users, enlaza su id con la ficha de trabajador o cliente que tenga ese email.';

-- 3) Arreglar ya las fichas que se quedaron sin enlazar.
with cand as (
  select distinct on (u.id) c.id as cid, u.id as uid
    from public.clientes c join auth.users u on lower(trim(c.email)) = lower(u.email)
   where c.user_id is null and coalesce(trim(c.email), '') <> ''
     and not exists (select 1 from public.clientes c2 where c2.user_id = u.id)
   order by u.id, c.activo desc, c.alta_el desc nulls last
)
update public.clientes c set user_id = cand.uid from cand where c.id = cand.cid;

with cand as (
  select distinct on (u.id) t.id as tid, u.id as uid
    from public.trabajadores t join auth.users u on lower(trim(t.email)) = lower(u.email)
   where t.user_id is null and coalesce(trim(t.email), '') <> ''
     and not exists (select 1 from public.trabajadores t2 where t2.user_id = u.id)
   order by u.id, t.activo desc
)
update public.trabajadores t set user_id = cand.uid from cand where t.id = cand.tid;
