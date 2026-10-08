-- =============================================================================
-- 0018_ocupacion_clases.sql · Plazas ocupadas de cada clase, visibles para todos
--
--   Un alumno solo puede leer SUS reservas (RLS de `reservas`). La app calculaba las
--   plazas libres contando las reservas que tenía cargadas, así que a un alumno le salía
--   "6 plazas libres" en una clase completa en la que él no estaba. (Reservar sí fallaba
--   correctamente: el servidor cuenta todas.)
--
--   Esta vista da solo el NÚMERO de plazas ocupadas por clase, sin decir quién está:
--   no expone datos de otros alumnos. Como `monitores` (0001), se ejecuta con los
--   permisos del propietario (security_invoker = false) y así cuenta todas las reservas.
--   Idempotente.
-- =============================================================================

create or replace view public.ocupacion_clases with (security_invoker = false) as
  select c.id as clase_id, c.fecha,
         (select count(*) from public.reservas r where r.clase_id = c.id and r.estado = 'RESERVADA')::integer as ocupadas
    from public.clases c;
comment on view public.ocupacion_clases is 'Plazas ocupadas por clase (solo el número, sin alumnos). Legible por cualquier usuario autenticado.';

revoke all on public.ocupacion_clases from public, anon;
grant select on public.ocupacion_clases to authenticated;
