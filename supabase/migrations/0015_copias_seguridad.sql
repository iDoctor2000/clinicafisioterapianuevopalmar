-- =============================================================================
-- 0015_copias_seguridad.sql · Registro de las copias de seguridad
--
--   Cada noche .github/workflows/copia-seguridad.yml hace una copia cifrada de la base de
--   datos (scripts/copias/hacer-copia.sh) y la anota aquí. La app lo muestra al
--   administrador en Ajustes → Copias de seguridad, con un aviso si la última es antigua.
--   Solo lectura para el administrador; escribe la tarea de copia (conexión directa).
--   Idempotente.
-- =============================================================================

create table if not exists public.copias_seguridad (
  id       bigint generated always as identity primary key,
  hecha_el timestamptz not null default now(),
  archivo  text not null default '',
  bytes    bigint not null default 0,
  tablas   integer not null default 0
);
comment on table public.copias_seguridad is 'Copias de seguridad hechas (una fila por copia). La app avisa si la última tiene más de dos días.';

alter table public.copias_seguridad enable row level security;
drop policy if exists copias_leer on public.copias_seguridad;
create policy copias_leer on public.copias_seguridad for select to authenticated using (public.es_admin());
revoke all on public.copias_seguridad from anon, authenticated;
grant select on public.copias_seguridad to authenticated;
