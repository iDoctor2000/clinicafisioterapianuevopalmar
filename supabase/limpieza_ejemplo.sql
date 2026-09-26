-- Quita los tres trabajadores de ejemplo de los datos iniciales.
-- Las franjas del horario y las clases que tenían asignadas pasan al primer administrador real.
do $$
declare
  v_admin uuid;
  v_ejemplo uuid[] := array[
    'c0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000002',
    'c0000000-0000-4000-8000-000000000003'
  ]::uuid[];
begin
  select id into v_admin from public.trabajadores
   where user_id is not null and rol = 'ADMIN' and activo and not (id = any(v_ejemplo))
   order by creado_el limit 1;
  if v_admin is null then
    raise exception 'No hay ningún administrador real con usuario vinculado: crea uno antes de limpiar.';
  end if;
  update public.plantillas_clase set monitor_id = v_admin where monitor_id = any(v_ejemplo);
  update public.clases set monitor_id = v_admin where monitor_id = any(v_ejemplo);
  delete from public.trabajadores where id = any(v_ejemplo);
  raise notice 'Horario y clases reasignados al administrador %, trabajadores de ejemplo eliminados.', v_admin;
end $$;
