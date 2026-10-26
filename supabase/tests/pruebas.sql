-- =============================================================================
-- pruebas.sql · Pruebas de reglas de negocio y RLS sobre la base pilates_test
-- Se ejecuta con psql como superusuario (postgres). Cualquier `assert` o
-- `raise exception` fallido detiene el script con código de error.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

-- -----------------------------------------------------------------------------
-- 0. Utilidades de prueba (schema aparte, solo en la base de pruebas)
-- -----------------------------------------------------------------------------
create schema pruebas;
-- Guarda/lee valores entre sentencias (psql no interpola variables dentro de do $$ $$).
create function pruebas.guardar(k text, v text) returns text language sql as $$ select set_config('pruebas.' || k, v, false) $$;
create function pruebas.id(k text) returns uuid language sql stable as $$ select current_setting('pruebas.' || k)::uuid $$;
create function pruebas.fecha(k text) returns date language sql stable as $$ select current_setting('pruebas.' || k)::date $$;
-- Simula el usuario autenticado (auth.uid() del stub lee esta variable).
create function pruebas.como(k text) returns text language sql as $$ select set_config('request.jwt.claim.sub', current_setting('pruebas.u_' || k), false) $$;
create function pruebas.sistema() returns text language sql as $$ select set_config('request.jwt.claim.sub', '', false) $$;
-- Clase generada de una plantilla en una fecha.
create function pruebas.clase(p_plantilla uuid, p_fecha date) returns uuid language sql stable as $$
  select id from public.clases where plantilla_id = p_plantilla and fecha = p_fecha
$$;
-- Ejecuta una orden que DEBE fallar con un mensaje que encaje con el patrón (like).
create function pruebas.espera_error(p_sql text, p_patron text) returns text language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_msg is null then
    raise exception 'Se esperaba el error "%" pero la orden tuvo éxito: %', p_patron, p_sql;
  end if;
  if v_msg not like p_patron then
    raise exception 'Error inesperado. Esperado: "%". Obtenido: "%"', p_patron, v_msg;
  end if;
  return 'OK bloqueado → ' || v_msg;
end $$;
-- Ejecuta una orden de escritura que, por RLS, no debe afectar a ninguna fila.
create function pruebas.espera_sin_efecto(p_sql text) returns text language plpgsql as $$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'La orden afectó a % filas y no debía: %', v_n, p_sql; end if;
  return 'OK sin efecto (0 filas) → ' || p_sql;
end $$;
grant usage on schema pruebas to anon, authenticated;
grant execute on all functions in schema pruebas to anon, authenticated;

-- Ids fijos de seed
select pruebas.guardar('act_suelo',    'a0000000-0000-4000-8000-000000000001');
select pruebas.guardar('act_reformer', 'a0000000-0000-4000-8000-000000000004');
select pruebas.guardar('tar_dir2',     'b0000000-0000-4000-8000-000000000001');
select pruebas.guardar('tar_bono_dir', 'b0000000-0000-4000-8000-000000000006');
select pruebas.guardar('tra_admin',    'c0000000-0000-4000-8000-000000000001');
select pruebas.guardar('tra_ana',      'c0000000-0000-4000-8000-000000000002');
select pruebas.guardar('tra_recep',    'c0000000-0000-4000-8000-000000000003');
select pruebas.guardar('pl_lun_0900',  'd0000000-0000-4000-8000-000000000001');
select pruebas.guardar('pl_mie_0900',  'd0000000-0000-4000-8000-000000000002');
select pruebas.guardar('pl_vie_0900',  'd0000000-0000-4000-8000-000000000003');
select pruebas.guardar('pl_lun_1000',  'd0000000-0000-4000-8000-000000000004');
select pruebas.guardar('pl_mar_1100',  'd0000000-0000-4000-8000-000000000007');
select pruebas.guardar('pl_jue_1100',  'd0000000-0000-4000-8000-000000000008');
select pruebas.guardar('pl_lun_1800',  'd0000000-0000-4000-8000-000000000011');
select pruebas.guardar('pl_mar_1800',  'd0000000-0000-4000-8000-000000000013');
select pruebas.guardar('pl_jue_1800',  'd0000000-0000-4000-8000-000000000014');
-- Usuarios (auth) y clientes de prueba
select pruebas.guardar('u_admin', '10000000-0000-4000-8000-000000000001');
select pruebas.guardar('u_recep', '10000000-0000-4000-8000-000000000003');
select pruebas.guardar('u_a', '20000000-0000-4000-8000-00000000000a');
select pruebas.guardar('u_b', '20000000-0000-4000-8000-00000000000b');
select pruebas.guardar('u_c', '20000000-0000-4000-8000-00000000000c');
select pruebas.guardar('cliente_a', 'e0000000-0000-4000-8000-00000000000a');
select pruebas.guardar('cliente_b', 'e0000000-0000-4000-8000-00000000000b');
select pruebas.guardar('cliente_c', 'e0000000-0000-4000-8000-00000000000c');
\set QUIET off

\echo
\echo '== 1. Usuarios, trabajadores y clientes de prueba'
insert into auth.users (id, email) values
  (pruebas.id('u_admin'), 'admin@test.local'), (pruebas.id('u_recep'), 'recepcion@test.local'),
  (pruebas.id('u_a'), 'ana@test.local'), (pruebas.id('u_b'), 'berta@test.local'), (pruebas.id('u_c'), 'carlos@test.local');
update public.trabajadores set user_id = pruebas.id('u_admin') where id = pruebas.id('tra_admin');
update public.trabajadores set user_id = pruebas.id('u_recep') where id = pruebas.id('tra_recep');
-- 0024: el administrador de pruebas ve las finanzas (el rol ADMIN por sí solo ya no las da).
update public.trabajadores set ve_finanzas = true where id = pruebas.id('tra_admin');
insert into public.clientes (id, nombre, apellidos, dni, email, telefono, user_id) values
  (pruebas.id('cliente_a'), 'Ana',    'Libre', '11111111A', 'ana@test.local',    '600 000 001', pruebas.id('u_a')),
  (pruebas.id('cliente_b'), 'Berta',  'Fija',  '22222222B', 'berta@test.local',  '600 000 002', pruebas.id('u_b')),
  (pruebas.id('cliente_c'), 'Carlos', 'Bono',  '33333333C', 'carlos@test.local', '600 000 003', pruebas.id('u_c'));
insert into public.clientes_clinica (cliente_id, lesiones, patologias, observaciones) values
  (pruebas.id('cliente_a'), 'Esguince tobillo', 'Lumbalgia', 'Evitar hiperextensión'),
  (pruebas.id('cliente_b'), 'Hernia L4-L5', '', 'Sin cargas axiales'),
  (pruebas.id('cliente_c'), '', 'Cervicalgia', '');

-- Semana de pruebas: el próximo lunes (estrictamente posterior a hoy, dentro de la ventana de 14 días)
select pruebas.guardar('lunes', (public._hoy() + ((7 - extract(isodow from public._hoy())::int) % 7 + 1))::text);
select pruebas.fecha('lunes') as lunes_de_pruebas, public._hoy() as hoy;
-- Si algún festivo cae en la semana de pruebas lo quitamos para que el escenario sea determinista
delete from public.dias_cierre where fecha between pruebas.fecha('lunes') and pruebas.fecha('lunes') + 6;

\echo
\echo '== 2. mantenimiento_diario (como sistema / pg_cron): genera clases a 70 días'
select pruebas.sistema();
select public.mantenimiento_diario();
do $$
declare v_hoy date := public._hoy();
begin
  assert (select count(*) from public.clases) > 0, 'no se generaron clases';
  assert (select max(fecha) from public.clases) between v_hoy + 64 and v_hoy + 70, 'horizonte de generación incorrecto';
  assert not exists (select 1 from public.clases c join public.dias_cierre d on d.fecha = c.fecha where c.estado = 'PROGRAMADA'), 'hay clases en días de cierre';
  assert (select count(*) from public.clases where fecha = pruebas.fecha('lunes'))
       = (select count(*) from public.plantillas_clase where dia_semana = 1 and activa), 'faltan clases del lunes';
  assert (select (public.mantenimiento_diario()->>'clases_creadas')::int) = 0, 'la segunda pasada no debería crear clases';
  raise notice 'OK clases generadas: %', (select count(*) from public.clases);
end $$;

\echo
\echo '== 3. Contratos (admin): A turno libre 2 dirigidas/semana, B horario fijo mar+jue 18:00, C bono 10 dirigidas'
select pruebas.como('admin');
select pruebas.guardar('con_a', public.crear_contrato(pruebas.id('cliente_a'), pruebas.id('tar_dir2'), public._hoy(), null, 'LIBRE')::text);
select pruebas.guardar('con_b', public.crear_contrato(pruebas.id('cliente_b'), pruebas.id('tar_dir2'), public._hoy(), null, 'FIJO',
                                  array[pruebas.id('pl_mar_1800'), pruebas.id('pl_jue_1800')])::text);
select pruebas.guardar('con_c', public.crear_contrato(pruebas.id('cliente_c'), pruebas.id('tar_bono_dir'), public._hoy())::text);
do $$
declare v_esperadas int; v_reales int;
begin
  assert (select fecha_fin from public.contratos where id = pruebas.id('con_a')) = (public._hoy() + interval '3 months')::date, 'fecha fin por defecto (3 meses)';
  assert (select fecha_fin from public.contratos where id = pruebas.id('con_c')) = (public._hoy() + interval '6 months')::date, 'fecha fin bono (6 meses)';
  assert (select sesiones_restantes from public.contratos where id = pruebas.id('con_c')) = 10, 'bono con 10 sesiones';
  select count(*) into v_esperadas from public.clases c join public.contratos k on k.id = pruebas.id('con_b')
   where c.plantilla_id in (pruebas.id('pl_mar_1800'), pruebas.id('pl_jue_1800')) and c.estado = 'PROGRAMADA'
     and c.fecha between k.fecha_inicio and k.fecha_fin;
  select count(*) into v_reales from public.reservas where contrato_id = pruebas.id('con_b') and origen = 'AUTOMATICA' and estado = 'RESERVADA';
  assert v_reales > 0 and v_reales = v_esperadas, format('reservas automáticas: %s esperadas, %s reales', v_esperadas, v_reales);
  assert (select count(*) from public.reservas where contrato_id = pruebas.id('con_a')) = 0, 'turno libre no genera reservas';
  assert (select public.generar_reservas_automaticas(pruebas.id('con_b'))) = 0, 'segunda generación debe ser idempotente';
  raise notice 'OK reservas automáticas de B: %', v_reales;
end $$;

\echo
\echo '== 4. Turno libre (cliente A): cupo semanal de 2 dirigidas'
select pruebas.como('a');
select pruebas.guardar('cl_lun_0900', pruebas.clase(pruebas.id('pl_lun_0900'), pruebas.fecha('lunes'))::text);
select pruebas.guardar('cl_mar_1100', pruebas.clase(pruebas.id('pl_mar_1100'), pruebas.fecha('lunes') + 1)::text);
select pruebas.guardar('cl_mie_0900', pruebas.clase(pruebas.id('pl_mie_0900'), pruebas.fecha('lunes') + 2)::text);
select pruebas.guardar('cl_vie_0900', pruebas.clase(pruebas.id('pl_vie_0900'), pruebas.fecha('lunes') + 4)::text);
select pruebas.guardar('cl_lun_1000', pruebas.clase(pruebas.id('pl_lun_1000'), pruebas.fecha('lunes'))::text);
select pruebas.guardar('cl_lun_1800', pruebas.clase(pruebas.id('pl_lun_1800'), pruebas.fecha('lunes'))::text);
select pruebas.guardar('cl_mar_1800', pruebas.clase(pruebas.id('pl_mar_1800'), pruebas.fecha('lunes') + 1)::text);
select pruebas.guardar('cl_jue_1800', pruebas.clase(pruebas.id('pl_jue_1800'), pruebas.fecha('lunes') + 3)::text);
do $$
declare r jsonb;
begin
  r := public.reservar(pruebas.id('cl_lun_0900'));
  assert r->>'via' = 'CUPO_SEMANAL' and r->>'mensaje' = 'Clase 1 de 2 de esta semana.', r::text;
  r := public.reservar(pruebas.id('cl_mar_1100'));
  assert r->>'via' = 'CUPO_SEMANAL' and r->>'mensaje' = 'Clase 2 de 2 de esta semana.', r::text;
  assert (select origen from public.reservas where id = (r->>'reserva_id')::uuid) = 'CLIENTE', 'origen CLIENTE';
  assert (select creado_por from public.reservas where id = (r->>'reserva_id')::uuid) = pruebas.id('u_a'), 'creado_por = usuario';
  raise notice 'OK dos reservas dentro del cupo';
end $$;
select pruebas.espera_error(format('select public.reservar(%L)', pruebas.id('cl_mie_0900')), 'Ya tienes las 2 clases de esta semana.');
select pruebas.espera_error(format('select public.reservar(%L)', pruebas.id('cl_lun_1000')), 'Tu tarifa no incluye reformer.');
select pruebas.espera_error(format('select public.reservar(%L)', pruebas.id('cl_mar_1100')), 'Ya tienes plaza en esta clase.');
-- Un cliente no puede reservar en nombre de otro: p_cliente_id se ignora (el mensaje es el del cupo de A, no el de B)
select pruebas.espera_error(format('select public.reservar(%L, %L)', pruebas.id('cl_lun_1800'), pruebas.id('cliente_b')), 'Ya tienes las 2 clases de esta semana.');
-- Fuera de la ventana de reserva
select pruebas.espera_error(format('select public.reservar(%L)', pruebas.clase(pruebas.id('pl_lun_0900'), pruebas.fecha('lunes') + 21)), 'Solo se puede reservar con 14 días de antelación.');

\echo
\echo '== 5. Horario fijo (cliente B): no puede reservar fuera de su franja sin recuperación'
select pruebas.como('b');
select pruebas.espera_error(format('select public.reservar(%L)', pruebas.id('cl_lun_0900')), 'Tienes horario fijo.%');
select pruebas.espera_error(format('select public.reservar(%L)', pruebas.id('cl_mar_1800')), 'Ya tienes plaza en esta clase.');

\echo
\echo '== 6. Aforo: el trigger impide superar las plazas'
select pruebas.sistema();
with x as (
  insert into public.clases (actividad_id, fecha, hora_inicio, plazas, extraordinaria, monitor_id)
  values (pruebas.id('act_suelo'), pruebas.fecha('lunes') + 7, '12:00', 1, true, pruebas.id('tra_ana')) returning id
) select pruebas.guardar('cl_aforo', id::text) from x;
insert into public.reservas (clase_id, cliente_id, origen) values (pruebas.id('cl_aforo'), pruebas.id('cliente_a'), 'MANUAL');
select pruebas.espera_error(format('insert into public.reservas (clase_id, cliente_id, origen) values (%L, %L, %L)', pruebas.id('cl_aforo'), pruebas.id('cliente_b'), 'MANUAL'), 'No quedan plazas libres.');
select pruebas.como('c');
select pruebas.espera_error(format('select public.reservar(%L)', pruebas.id('cl_aforo')), 'No quedan plazas libres.');
select pruebas.sistema();
update public.reservas set estado = 'CANCELADA_CENTRO' where clase_id = pruebas.id('cl_aforo');
insert into public.reservas (clase_id, cliente_id, origen) values (pruebas.id('cl_aforo'), pruebas.id('cliente_b'), 'MANUAL');
select pruebas.espera_error(format('update public.reservas set estado = %L where clase_id = %L and cliente_id = %L', 'RESERVADA', pruebas.id('cl_aforo'), pruebas.id('cliente_a')), 'No quedan plazas libres.');
do $$ begin
  assert (select count(*) from public.reservas where clase_id = pruebas.id('cl_aforo') and estado = 'RESERVADA') = 1, 'aforo';
  raise notice 'OK aforo respetado (insert y update)';
end $$;

\echo
\echo '== 7. Cancelación con antelación → recuperación; la recuperación permite reservar fuera del cupo'
select pruebas.como('a');
select pruebas.guardar('res_lun', (select id::text from public.reservas where clase_id = pruebas.id('cl_lun_0900') and cliente_id = pruebas.id('cliente_a') and estado = 'RESERVADA'));
do $$
declare r jsonb; rec public.recuperaciones%rowtype;
begin
  r := public.cancelar_reserva(pruebas.id('res_lun'));
  assert (r->>'recuperable')::boolean and r->>'estado' = 'CANCELADA_RECUPERABLE' and (r->>'recuperacion_id') is not null, r::text;
  assert (select estado from public.reservas where id = pruebas.id('res_lun')) = 'CANCELADA_RECUPERABLE', 'estado reserva';
  select * into rec from public.recuperaciones where id = (r->>'recuperacion_id')::uuid;
  assert rec.estado = 'DISPONIBLE' and rec.motivo = 'CANCELACION_CLIENTE' and rec.categorias_permitidas = '{DIRIGIDA}'::public.categoria[]
     and rec.reserva_origen_id = pruebas.id('res_lun') and rec.cliente_id = pruebas.id('cliente_a'), 'recuperación creada';
  assert rec.caduca_el = (select fecha_fin from public.contratos where id = pruebas.id('con_a')), 'caduca con el contrato';
  perform pruebas.guardar('rec_a', rec.id::text);

  -- La cancelada recuperable ya no consume cupo: el miércoles entra por cupo (2 de 2)
  r := public.reservar(pruebas.id('cl_mie_0900'));
  assert r->>'via' = 'CUPO_SEMANAL' and r->>'mensaje' = 'Clase 2 de 2 de esta semana.', r::text;
  perform pruebas.guardar('res_mie', r->>'reserva_id');

  -- Semana completa: el viernes se reserva con la recuperación
  r := public.reservar(pruebas.id('cl_vie_0900'));
  assert r->>'via' = 'RECUPERACION' and r->>'mensaje' = 'Semana completa: se utilizará una recuperación.', r::text;
  assert (select origen from public.reservas where id = (r->>'reserva_id')::uuid) = 'RECUPERACION', 'origen RECUPERACION';
  assert (select recuperacion_usada_id from public.reservas where id = (r->>'reserva_id')::uuid) = pruebas.id('rec_a'), 'recuperación enlazada';
  assert (select estado from public.recuperaciones where id = pruebas.id('rec_a')) = 'USADA', 'recuperación USADA';
  perform pruebas.guardar('res_vie', r->>'reserva_id');

  -- Cancelar con antelación la reserva hecha con recuperación la devuelve (no crea otra)
  r := public.cancelar_reserva(pruebas.id('res_vie'));
  assert (r->>'recuperable')::boolean and (r->>'recuperacion_id')::uuid = pruebas.id('rec_a'), r::text;
  assert (select estado from public.recuperaciones where id = pruebas.id('rec_a')) = 'DISPONIBLE', 'recuperación devuelta';
  assert (select usada_en_reserva_id from public.recuperaciones where id = pruebas.id('rec_a')) is null, 'enlace limpiado';
  assert (select count(*) from public.recuperaciones where cliente_id = pruebas.id('cliente_a')) = 1, 'no se crean recuperaciones extra';
  raise notice 'OK recuperación creada, usada fuera del cupo y devuelta';
end $$;
select pruebas.espera_error(format('select public.cancelar_reserva(%L)', pruebas.id('res_vie')), 'La reserva ya está cancelada.');
select pruebas.como('b');
select pruebas.espera_error(format('select public.cancelar_reserva(%L)', pruebas.id('res_mie')), 'Esta reserva no es tuya.');

\echo
\echo '== 8. Cancelación sin antelación → no recuperable y sigue consumiendo cupo; clase pasada no reservable'
select pruebas.sistema();
with x as (
  insert into public.clases (actividad_id, fecha, hora_inicio, plazas, extraordinaria, monitor_id)
  values (pruebas.id('act_suelo'), (public._ahora_local() + interval '30 minutes')::date,
          date_trunc('minute', public._ahora_local() + interval '30 minutes')::time, 5, true, pruebas.id('tra_ana')) returning id
) select pruebas.guardar('cl_pronto', id::text) from x;
with x as (
  insert into public.clases (actividad_id, fecha, hora_inicio, plazas, extraordinaria, monitor_id)
  values (pruebas.id('act_suelo'), (public._ahora_local() - interval '10 minutes')::date,
          date_trunc('minute', public._ahora_local() - interval '10 minutes')::time, 5, true, pruebas.id('tra_ana')) returning id
) select pruebas.guardar('cl_pasada', id::text) from x;
select pruebas.como('a');
do $$
declare r jsonb; v_fecha date; v_esperado int;
begin
  r := public.reservar(pruebas.id('cl_pronto'));
  assert r->>'via' = 'CUPO_SEMANAL', r::text;
  r := public.cancelar_reserva((r->>'reserva_id')::uuid);
  assert not (r->>'recuperable')::boolean and r->>'estado' = 'CANCELADA_NO_RECUPERABLE', r::text;
  assert (r->>'minutos_antelacion')::int between 0 and 59, 'minutos de antelación';
  assert (select count(*) from public.recuperaciones where cliente_id = pruebas.id('cliente_a')) = 1, 'no debe crear recuperación';
  -- Cupo consumido en la semana de esa clase: la no recuperable cuenta (más las de la semana de pruebas si coincide)
  select fecha into v_fecha from public.clases where id = pruebas.id('cl_pronto');
  v_esperado := 1 + case when public._inicio_semana(v_fecha) = pruebas.fecha('lunes') then 2 else 0 end;
  assert public._cupo_consumido_en_semana(pruebas.id('con_a'), 'DIRIGIDA', v_fecha) = v_esperado,
    format('cupo consumido: esperado %s, real %s', v_esperado, public._cupo_consumido_en_semana(pruebas.id('con_a'), 'DIRIGIDA', v_fecha));
  raise notice 'OK cancelación sin antelación (% min): no recuperable y consume cupo', r->>'minutos_antelacion';
end $$;
select pruebas.espera_error(format('select public.reservar(%L)', pruebas.id('cl_pasada')), 'Esta clase ya ha pasado.');

\echo
\echo '== 9. Bono (cliente C): descuenta sesión, no admite Reformer, la devuelve al cancelar con antelación'
select pruebas.como('c');
do $$
declare r jsonb;
begin
  r := public.reservar(pruebas.id('cl_lun_1800'));
  assert r->>'via' = 'BONO' and r->>'mensaje' = 'Se descontará 1 sesión de tu bono (te quedarán 9).', r::text;
  assert (select sesiones_restantes from public.contratos where id = pruebas.id('con_c')) = 9, 'sesión descontada';
  r := public.cancelar_reserva((r->>'reserva_id')::uuid);
  assert (r->>'recuperable')::boolean and (r->>'recuperacion_id') is null, r::text;
  assert (select sesiones_restantes from public.contratos where id = pruebas.id('con_c')) = 10, 'sesión devuelta';
  assert (select count(*) from public.recuperaciones where cliente_id = pruebas.id('cliente_c')) = 0, 'bono no genera recuperación';
  -- Reserva del martes 18:00 para la prueba de cancelación de clase por el centro
  r := public.reservar(pruebas.id('cl_mar_1800'));
  assert r->>'via' = 'BONO', r::text;
  raise notice 'OK bono';
end $$;
select pruebas.espera_error(format('select public.reservar(%L)', pruebas.id('cl_lun_1000')), 'Tu bono es de Actividades dirigidas.');

\echo
\echo '== 10. Cancelación de clase por el centro: recuperaciones, devolución de bono y aviso'
select pruebas.como('recep');
select pruebas.espera_error(format('select public.cancelar_clase(%L, %L)', pruebas.id('cl_mar_1800'), 'Prueba'), 'No tienes permiso para: CLASES_CREAR_CANCELAR');
select pruebas.como('admin');
do $$
declare v_n int; v_aviso public.avisos%rowtype;
begin
  v_n := public.cancelar_clase(pruebas.id('cl_mar_1800'), 'Monitor enfermo', pruebas.id('cl_jue_1800'), true);
  assert v_n = 2, format('afectados: %s', v_n);
  assert (select estado from public.clases where id = pruebas.id('cl_mar_1800')) = 'CANCELADA', 'clase cancelada';
  assert (select motivo_cancelacion from public.clases where id = pruebas.id('cl_mar_1800')) = 'Monitor enfermo', 'motivo';
  assert (select cancelado_por from public.clases where id = pruebas.id('cl_mar_1800')) = pruebas.id('u_admin'), 'cancelado_por';
  assert (select count(*) from public.reservas where clase_id = pruebas.id('cl_mar_1800') and estado = 'CANCELADA_CENTRO') = 2, 'reservas CANCELADA_CENTRO';
  -- B (horario fijo): recuperación por cancelación del centro
  assert (select count(*) from public.recuperaciones where cliente_id = pruebas.id('cliente_b') and motivo = 'CANCELACION_CENTRO' and estado = 'DISPONIBLE') = 1, 'recuperación de B';
  assert (select nota from public.recuperaciones where cliente_id = pruebas.id('cliente_b')) = 'Clase cancelada por el centro: Monitor enfermo', 'nota';
  -- C (bono): sesión devuelta, sin recuperación
  assert (select sesiones_restantes from public.contratos where id = pruebas.id('con_c')) = 10, 'bono devuelto';
  assert (select count(*) from public.recuperaciones where cliente_id = pruebas.id('cliente_c')) = 0, 'bono sin recuperación';
  -- Aviso a los afectados
  select * into v_aviso from public.avisos where destino_tipo = 'CLASE' and destino_clase_id = pruebas.id('cl_mar_1800');
  assert v_aviso.id is not null and v_aviso.importante and v_aviso.titulo like 'Clase cancelada: Pilates suelo %', 'aviso';
  assert v_aviso.cuerpo like 'Monitor enfermo. Se realizará una clase alternativa el % a las 18:00%', v_aviso.cuerpo;
  assert (select array_agg(cliente_id order by cliente_id) from public.aviso_destinatarios where aviso_id = v_aviso.id)
       = array[pruebas.id('cliente_b'), pruebas.id('cliente_c')], 'destinatarios';
  perform pruebas.guardar('aviso', v_aviso.id::text);
  raise notice 'OK clase cancelada: % afectados, aviso "%"', v_n, v_aviso.titulo;
end $$;
select pruebas.espera_error(format('select public.cancelar_clase(%L, %L)', pruebas.id('cl_mar_1800'), 'Otra vez'), 'La clase ya está cancelada.');
select pruebas.como('a');
select pruebas.espera_error(format('select public.reservar(%L)', pruebas.id('cl_mar_1800')), 'Esta clase ha sido cancelada por el centro.');
-- B usa su recuperación para ir a otra clase pese a tener horario fijo
select pruebas.como('b');
do $$
declare r jsonb;
begin
  r := public.reservar(pruebas.id('cl_lun_1800'));
  assert r->>'via' = 'RECUPERACION', r::text;
  assert (select estado from public.recuperaciones where cliente_id = pruebas.id('cliente_b')) = 'USADA', 'recuperación de B usada';
  raise notice 'OK B reserva fuera de su horario con la recuperación';
end $$;
-- El mantenimiento no vuelve a crear la reserva automática de una clase que el cliente canceló
select pruebas.guardar('res_b_jue', (select id::text from public.reservas where clase_id = pruebas.id('cl_jue_1800') and cliente_id = pruebas.id('cliente_b') and estado = 'RESERVADA'));
select public.cancelar_reserva(pruebas.id('res_b_jue'));
select pruebas.sistema();
do $$ begin
  assert (select (public.mantenimiento_diario()->>'reservas_automaticas')::int) = 0, 'mantenimiento no debe regenerar reservas canceladas';
  assert (select count(*) from public.reservas where clase_id = pruebas.id('cl_jue_1800') and cliente_id = pruebas.id('cliente_b')) = 1, 'sin duplicados';
  raise notice 'OK mantenimiento idempotente tras cancelación';
end $$;

\echo
\echo '== 11. Personal: anadir_alumno, asistencia, aviso, permisos'
select pruebas.como('recep');
do $$
declare r jsonb; v_id uuid;
begin
  r := public.anadir_alumno(pruebas.id('cl_jue_1800'), pruebas.id('cliente_a'), 'CLASE_SUELTA');
  assert (select origen from public.reservas where id = (r->>'reserva_id')::uuid) = 'CLASE_SUELTA', 'clase suelta';
  v_id := public.publicar_aviso('Horario de Navidad', 'Cerramos del 24 al 26.', 'TODOS');
  assert (select count(*) from public.aviso_destinatarios where aviso_id = v_id) = 3, 'aviso a todos';
  raise notice 'OK anadir_alumno y publicar_aviso';
end $$;
select pruebas.espera_error(format('select public.registrar_asistencia(%L, %L)', pruebas.id('res_mie'), 'ASISTE'), 'No tienes permiso para: ASISTENCIA_REGISTRAR');
select pruebas.espera_error('select public.mantenimiento_diario()', 'Solo el administrador%');
select pruebas.como('admin');
select public.registrar_asistencia(pruebas.id('res_mie'), 'ASISTE');
do $$ begin
  assert (select asistencia from public.reservas where id = pruebas.id('res_mie')) = 'ASISTE', 'asistencia';
  assert (select count(*) from public.auditoria where accion = 'RESERVAR' and actor_nombre = 'Ana Libre') >= 3, 'auditoría de reservas con nombre resuelto';
  assert (select count(*) from public.auditoria where accion = 'CANCELAR_CLASE' and actor_id = pruebas.id('u_admin')) = 1, 'auditoría cancelar clase';
  assert (select count(*) from public.auditoria where accion = 'MANTENIMIENTO' and actor_nombre = 'Sistema') >= 2, 'auditoría mantenimiento';
  raise notice 'OK asistencia y auditoría (% registros)', (select count(*) from public.auditoria);
end $$;

\echo
\echo '== 12. RLS como cliente A (rol authenticated)'
begin;
set local role authenticated;
select pruebas.como('a');
do $$ begin
  assert (select count(*) from public.clientes) = 1 and (select id from public.clientes) = pruebas.id('cliente_a'), 'un cliente solo ve su ficha';
  assert (select count(*) from public.clientes_clinica) = 0, 'un cliente no ve la información clínica';
  assert (select count(*) from public.contratos) = 1 and (select cliente_id from public.contratos) = pruebas.id('cliente_a'), 'solo sus contratos';
  assert (select count(*) from public.reservas where cliente_id <> pruebas.id('cliente_a')) = 0 and (select count(*) from public.reservas) > 0, 'solo sus reservas';
  assert (select count(*) from public.recuperaciones where cliente_id <> pruebas.id('cliente_a')) = 0, 'solo sus recuperaciones';
  assert (select count(*) from public.trabajadores) = 0, 'no ve la tabla de trabajadores';
  assert (select count(*) from public.monitores) = 3, 'sí ve la vista de monitores';
  assert (select count(*) from public.trabajador_permisos) = 0, 'no ve permisos';
  assert (select count(*) from public.auditoria) = 0, 'no ve auditoría';
  assert (select count(*) from public.avisos) = 1, 'solo el aviso del que es destinatario (el general)';
  assert (select count(*) from public.tarifas) = 9 and (select count(*) from public.actividades) = 4 and (select count(*) from public.clases) > 0, 'catálogo legible';
  assert (select count(*) from public.config_centro) = 1 and (select count(*) from public.plantillas_clase) = 20, 'config y horario legibles';
  assert (select count(*) from public.pagos) = 0 and (select count(*) from public.suscripciones_push) = 0, 'tablas vacías accesibles';
end $$;
update public.clientes set telefono = '699 999 999', notificaciones_push = false where id = pruebas.id('cliente_a');
do $$ begin assert (select telefono from public.clientes where id = pruebas.id('cliente_a')) = '699 999 999', 'puede editar su contacto'; end $$;
select pruebas.espera_error(format('update public.clientes set nombre = %L where id = %L', 'Hacker', pruebas.id('cliente_a')), 'Solo puedes modificar tus datos de contacto%');
select pruebas.espera_sin_efecto(format('update public.clientes set telefono = %L where id = %L', '1', pruebas.id('cliente_b')));  -- fila ajena: RLS la oculta
do $$ begin assert (select telefono from public.clientes where id = pruebas.id('cliente_b')) is null, 'no ve ni toca a otros clientes'; end $$;
select pruebas.espera_error(format('insert into public.reservas (clase_id, cliente_id, origen) values (%L, %L, %L)', pruebas.id('cl_lun_1800'), pruebas.id('cliente_a'), 'CLIENTE'), '%row-level security%');
select pruebas.espera_error(format('insert into public.clientes_clinica (cliente_id) values (%L)', pruebas.id('cliente_a')), '%row-level security%');
select pruebas.espera_sin_efecto('update public.config_centro set dias_ventana_reserva = 99');
select pruebas.espera_sin_efecto(format('delete from public.clases where id = %L', pruebas.id('cl_lun_1800')));
insert into public.suscripciones_push (cliente_id, endpoint, clave_p256dh, clave_auth) values (pruebas.id('cliente_a'), 'https://push.example/abc', 'p256', 'auth');
select pruebas.espera_error(format('insert into public.suscripciones_push (cliente_id, endpoint, clave_p256dh, clave_auth) values (%L, %L, %L, %L)', pruebas.id('cliente_b'), 'https://push.example/xyz', 'p', 'a'), '%row-level security%');
select pruebas.espera_error(format('insert into public.aviso_lecturas (aviso_id, cliente_id) values (%L, %L)', pruebas.id('aviso'), pruebas.id('cliente_a')), '%row-level security%');
select pruebas.espera_error('select public.mantenimiento_diario()', 'Solo el administrador%');
select pruebas.espera_error(format('select public.cancelar_clase(%L, %L)', pruebas.id('cl_jue_1800'), 'x'), 'No tienes permiso para: CLASES_CREAR_CANCELAR');
commit;

\echo
\echo '== 13. RLS como cliente B: ve y marca leído el aviso del que es destinatario'
begin;
set local role authenticated;
select pruebas.como('b');
insert into public.aviso_lecturas (aviso_id, cliente_id) values (pruebas.id('aviso'), pruebas.id('cliente_b'));
do $$ begin
  assert (select count(*) from public.avisos) = 2, 'B ve el aviso de la clase cancelada y el general';
  assert (select count(*) from public.aviso_lecturas) = 1, 'lectura registrada';
  assert (select count(*) from public.clientes) = 1 and (select telefono from public.clientes) = '600 000 002', 'B solo se ve a sí misma';
end $$;
commit;

\echo
\echo '== 14. RLS como trabajadora de recepción (CLIENTES_VER, sin CLINICA_VER)'
begin;
set local role authenticated;
select pruebas.como('recep');
do $$ begin
  assert (select count(*) from public.clientes) = 3, 've todas las fichas';
  assert (select count(*) from public.clientes_clinica) = 0, 'NO ve la información clínica';
  assert (select count(*) from public.reservas) > 5, 've las reservas';
  assert (select count(*) from public.trabajadores) = 3, 've a sus compañeros';
  assert (select count(*) from public.trabajador_permisos) = 6, 'solo sus propios permisos';
  assert (select count(*) from public.auditoria) = 0, 'no ve auditoría';
  assert (select count(*) from public.tarifas) = 9, 've tarifas';
end $$;
update public.clientes set direccion = 'Calle Mayor 1' where id = pruebas.id('cliente_a');
select pruebas.espera_error(format('insert into public.clientes_clinica (cliente_id, lesiones) values (%L, %L)', pruebas.id('cliente_a'), 'x'), '%row-level security%');
select pruebas.espera_sin_efecto(format('update public.clientes_clinica set lesiones = %L', 'x'));
do $$ begin assert (select lesiones from public.clientes_clinica where cliente_id = pruebas.id('cliente_a')) is null, 'sin acceso clínico'; end $$;
select pruebas.espera_error(format('insert into public.trabajadores (nombre) values (%L)', 'Intruso'), '%row-level security%');
select pruebas.espera_sin_efecto(format('update public.config_centro set nombre = %L', 'x'));
commit;

\echo
\echo '== 15. RLS como administrador (CLINICA_VER implícito)'
begin;
set local role authenticated;
select pruebas.como('admin');
do $$ begin
  assert (select count(*) from public.clientes_clinica) = 3, 'admin ve la información clínica';
  assert (select count(*) from public.auditoria) > 0, 'admin ve auditoría';
  assert (select count(*) from public.trabajador_permisos) > 6, 'admin ve todos los permisos';
end $$;
update public.clientes_clinica set observaciones = 'Revisado' where cliente_id = pruebas.id('cliente_a');
update public.config_centro set dias_ventana_reserva = 14;
commit;

\echo
\echo '== 16. Ámbito SUS_CLASES (0005): Ana (monitora) solo ve y gestiona sus clases y sus alumnos'
select pruebas.sistema();
select pruebas.guardar('u_ana', '10000000-0000-4000-8000-000000000002');
select pruebas.guardar('cliente_d', 'e0000000-0000-4000-8000-00000000000d');
insert into auth.users (id, email) values (pruebas.id('u_ana'), 'ana.monitora@test.local');
update public.trabajadores set user_id = pruebas.id('u_ana'), ambito = 'SUS_CLASES' where id = pruebas.id('tra_ana');
-- Para probar el ámbito también en cancelar_clase y horarios, le damos esos permisos (el ámbito debe seguir bloqueando).
insert into public.trabajador_permisos (trabajador_id, permiso) values (pruebas.id('tra_ana'), 'CLASES_CREAR_CANCELAR'), (pruebas.id('tra_ana'), 'HORARIOS_GESTIONAR');
-- Un ADMIN siempre queda en CENTRO (trigger).
update public.trabajadores set ambito = 'SUS_CLASES' where id = pruebas.id('tra_admin');
-- Cliente D: sin ninguna reserva (no es alumno de nadie).
insert into public.clientes (id, nombre, apellidos, dni, email, telefono) values (pruebas.id('cliente_d'), 'Diana', 'Nueva', '44444444D', 'diana@test.local', '600 000 004');
insert into public.clientes_clinica (cliente_id, lesiones) values (pruebas.id('cliente_d'), 'Ninguna');
-- Valores esperados, calculados sin RLS.
select pruebas.guardar('n_res_ana', (select count(*)::text from public.reservas r join public.clases c on c.id = r.clase_id where c.monitor_id = pruebas.id('tra_ana')));
select pruebas.guardar('n_alumnos_ana', (select count(distinct r.cliente_id)::text from public.reservas r join public.clases c on c.id = r.clase_id where c.monitor_id = pruebas.id('tra_ana')));
select pruebas.guardar('n_avisos', (select count(*)::text from public.avisos));
-- Reserva en una clase ajena (jue 18:00 es del administrador): la clase suelta de A del apartado 11.
select pruebas.guardar('res_ajena', (select id::text from public.reservas where clase_id = pruebas.id('cl_jue_1800') and cliente_id = pruebas.id('cliente_a') and estado = 'RESERVADA'));
do $$ begin
  assert (select ambito from public.trabajadores where id = pruebas.id('tra_admin')) = 'CENTRO', 'un ADMIN siempre tiene ámbito CENTRO';
  assert (select ambito from public.trabajadores where id = pruebas.id('tra_ana')) = 'SUS_CLASES', 'ámbito de Ana';
  assert current_setting('pruebas.n_res_ana')::int > 0 and current_setting('pruebas.n_alumnos_ana')::int between 1 and 3, 'escenario con reservas en clases de Ana';
  assert (select count(*) from public.clases where monitor_id <> pruebas.id('tra_ana') and estado = 'PROGRAMADA') > 0, 'hay clases ajenas';
  assert current_setting('pruebas.n_avisos')::int >= 2, 'hay avisos previos (cancelación y general) que Ana no debe ver';
end $$;

begin;
set local role authenticated;
select pruebas.como('ana');
do $$
declare v_res int := current_setting('pruebas.n_res_ana')::int; v_alu int := current_setting('pruebas.n_alumnos_ana')::int;
begin
  assert public.auth_ambito() = 'SUS_CLASES', 'auth_ambito';
  assert public.clase_es_mia(pruebas.id('cl_lun_0900')) and not public.clase_es_mia(pruebas.id('cl_jue_1800')), 'clase_es_mia';
  -- Lectura
  assert (select count(*) from public.reservas) = v_res, format('solo las reservas de sus clases: %s esperadas, %s vistas', v_res, (select count(*) from public.reservas));
  assert not exists (select 1 from public.reservas r join public.clases c on c.id = r.clase_id where c.monitor_id <> pruebas.id('tra_ana')), 'ninguna reserva de una clase ajena';
  assert (select count(*) from public.clientes) = v_alu, format('solo sus alumnos: %s esperados, %s vistos', v_alu, (select count(*) from public.clientes));
  assert not exists (select 1 from public.clientes where id = pruebas.id('cliente_d')), 'no ve a un cliente sin reservas con ella';
  assert (select count(*) from public.clientes_clinica) = v_alu, 'información clínica (tiene CLINICA_VER) solo de sus alumnos';
  assert not exists (select 1 from public.contratos k where not exists (select 1 from public.clientes c where c.id = k.cliente_id)), 'contratos solo de sus alumnos';
  assert (select count(*) from public.clases) > v_res, 've el calendario completo (la app lo filtra por ámbito)';
  assert (select count(*) from public.plantillas_clase) = 20, 've el horario completo (solo lectura)';
  assert (select count(*) from public.trabajadores) = 3, 've a sus compañeros';
  assert (select count(*) from public.trabajador_permisos) = 8, 'solo sus propios permisos';
  assert (select count(*) from public.avisos) = 0, 'no ve avisos ajenos (ni el general ni el de una clase del admin)';
  assert (select count(*) from public.aviso_destinatarios) = 0, 'ni sus destinatarios';
end $$;
-- RPC: asistencia, alumnos, reservas y cancelaciones solo en sus clases
select pruebas.espera_error(format('select public.registrar_asistencia(%L, %L)', pruebas.id('res_ajena'), 'ASISTE'), 'Esta clase no es tuya.');
select public.registrar_asistencia(pruebas.id('res_mie'), 'NO_ASISTE');
select pruebas.espera_error(format('select public.anadir_alumno(%L, %L, %L)', pruebas.id('cl_jue_1800'), pruebas.id('cliente_d'), 'MANUAL'), 'Esta clase no es tuya.');
select pruebas.espera_error(format('select public.anadir_alumno(%L, %L, %L)', pruebas.id('cl_jue_1800'), pruebas.id('cliente_d'), 'TARIFA'), 'Esta clase no es tuya.');
select pruebas.espera_error(format('select public.reservar(%L, %L)', pruebas.id('cl_jue_1800'), pruebas.id('cliente_a')), 'Esta clase no es tuya.');
select pruebas.espera_error(format('select public.cancelar_reserva(%L)', pruebas.id('res_ajena')), 'Esta clase no es tuya.');
select pruebas.espera_error(format('select public.cancelar_clase(%L, %L)', pruebas.id('cl_jue_1800'), 'x'), 'Esta clase no es tuya.');
select pruebas.espera_error(format('select public.publicar_aviso(%L, %L, %L)', 'Hola', 'x', 'TODOS'), 'Con tu ámbito solo puedes enviar avisos%');
select pruebas.espera_error(format('select public.publicar_aviso(%L, %L, %L, %L)', 'Hola', 'x', 'ACTIVIDAD', pruebas.id('act_suelo')), 'Con tu ámbito solo puedes enviar avisos%');
select pruebas.espera_error(format('select public.publicar_aviso(%L, %L, %L, %L)', 'Hola', 'x', 'CLASE', pruebas.id('cl_jue_1800')), 'Esta clase no es tuya.');
-- En sus clases sí: añade a D (que pasa a ser alumna suya) y avisa a los de una clase suya
select pruebas.guardar('res_d', (public.anadir_alumno(pruebas.id('cl_vie_0900'), pruebas.id('cliente_d'), 'MANUAL')->>'reserva_id'));
select pruebas.guardar('aviso_ana', public.publicar_aviso('Traed esterilla', 'Para el viernes.', 'CLASE', pruebas.id('cl_vie_0900'))::text);
do $$ begin
  assert (select asistencia from public.reservas where id = pruebas.id('res_mie')) = 'NO_ASISTE', 'asistencia en clase propia';
  assert exists (select 1 from public.clientes where id = pruebas.id('cliente_d')), 'D ya es alumna suya y la ve';
  assert (select count(*) from public.clientes_clinica where cliente_id = pruebas.id('cliente_d')) = 1, 'y ve su información clínica';
  assert (select count(*) from public.avisos) = 1 and (select id from public.avisos) = pruebas.id('aviso_ana'), 've su propio aviso';
  assert exists (select 1 from public.aviso_destinatarios where aviso_id = pruebas.id('aviso_ana') and cliente_id = pruebas.id('cliente_d')), 'con sus destinatarios (D, recién apuntada)';
end $$;
select public.cancelar_reserva(pruebas.id('res_d'));
-- Escritura directa: sin efecto o bloqueada fuera de su ámbito
select pruebas.espera_sin_efecto(format('update public.reservas set asistencia = %L where id = %L', 'ASISTE', pruebas.id('res_ajena')));
select pruebas.espera_error(format('insert into public.reservas (clase_id, cliente_id, origen) values (%L, %L, %L)', pruebas.id('cl_jue_1800'), pruebas.id('cliente_d'), 'MANUAL'), '%row-level security%');
select pruebas.espera_sin_efecto(format('update public.plantillas_clase set plazas = 99 where id = %L', pruebas.id('pl_lun_0900')));  -- horario: solo lectura aunque tenga HORARIOS_GESTIONAR
select pruebas.espera_error(format('insert into public.plantillas_clase (actividad_id, dia_semana, hora_inicio, monitor_id, plazas) values (%L, 1, %L, %L, 5)', pruebas.id('act_suelo'), '12:00', pruebas.id('tra_ana')), '%row-level security%');
select pruebas.espera_error(format('insert into public.avisos (titulo, destino_tipo, publicado_por) values (%L, %L, %L)', 'Directo', 'TODOS', pruebas.id('u_ana')), '%row-level security%');
select pruebas.espera_sin_efecto(format('update public.clientes set direccion = %L where id = %L', 'x', pruebas.id('cliente_b')));  -- B no es alumna suya
select pruebas.espera_error(format('insert into public.trabajadores (nombre) values (%L)', 'Intruso'), '%row-level security%');
select pruebas.espera_sin_efecto(format('update public.trabajadores set ambito = %L where id = %L', 'CENTRO', pruebas.id('tra_ana')));
commit;
select pruebas.sistema();
do $$ begin
  assert (select ambito from public.trabajadores where id = pruebas.id('tra_ana')) = 'SUS_CLASES', 'Ana no ha podido cambiar su ámbito';
  assert (select plazas from public.plantillas_clase where id = pruebas.id('pl_lun_0900')) = 10, 'horario intacto';
  assert (select estado from public.reservas where id = pruebas.id('res_d')) = 'CANCELADA_RECUPERABLE', 'Ana canceló la reserva de D en su clase';
  raise notice 'OK ámbito SUS_CLASES: % reservas y % alumnos visibles', current_setting('pruebas.n_res_ana'), current_setting('pruebas.n_alumnos_ana');
end $$;

\echo
\echo '== 17. Gestión del equipo solo ADMIN: TRABAJADORES_GESTIONAR ya no basta'
select pruebas.sistema();
insert into public.trabajador_permisos (trabajador_id, permiso) values (pruebas.id('tra_recep'), 'TRABAJADORES_GESTIONAR');
select pruebas.guardar('tra_maria', 'c0000000-0000-4000-8000-000000000009');
begin;
set local role authenticated;
select pruebas.como('recep');
select pruebas.espera_error(format('insert into public.trabajadores (id, nombre, email) values (%L, %L, %L)', pruebas.id('tra_maria'), 'María', 'maria@test.local'), '%row-level security%');
select pruebas.espera_sin_efecto(format('update public.trabajadores set ambito = %L where id = %L', 'CENTRO', pruebas.id('tra_ana')));
select pruebas.espera_sin_efecto(format('delete from public.trabajadores where id = %L', pruebas.id('tra_ana')));
select pruebas.espera_error(format('insert into public.trabajador_permisos (trabajador_id, permiso) values (%L, %L)', pruebas.id('tra_ana'), 'TARIFAS_GESTIONAR'), '%row-level security%');
select pruebas.espera_sin_efecto(format('delete from public.trabajador_permisos where trabajador_id = %L', pruebas.id('tra_ana')));
do $$ begin
  assert (select count(*) from public.trabajador_permisos) = 7, 'con TRABAJADORES_GESTIONAR sigue viendo solo sus permisos';
  assert (select count(*) from public.trabajadores) = 3, 'pero sí ve a sus compañeros';
end $$;
commit;
begin;
set local role authenticated;
select pruebas.como('admin');
insert into public.trabajadores (id, nombre, apellidos, email, rol, ambito, es_monitor) values (pruebas.id('tra_maria'), 'María', 'Yoga', 'maria@test.local', 'MONITOR', 'SUS_CLASES', true);
insert into public.trabajador_permisos (trabajador_id, permiso) values (pruebas.id('tra_maria'), 'ASISTENCIA_REGISTRAR'), (pruebas.id('tra_maria'), 'CLIENTES_VER');
update public.trabajadores set ambito = 'CENTRO' where id = pruebas.id('tra_ana');
do $$ begin
  assert (select ambito from public.trabajadores where id = pruebas.id('tra_maria')) = 'SUS_CLASES', 'el admin crea a María con ámbito SUS_CLASES';
  assert (select count(*) from public.trabajador_permisos where trabajador_id = pruebas.id('tra_maria')) = 2, 'y sus permisos';
  assert (select ambito from public.trabajadores where id = pruebas.id('tra_ana')) = 'CENTRO', 'el admin cambia el ámbito de Ana';
  assert (select count(*) from public.trabajadores) = 4, 'ahora son 4';
end $$;
update public.trabajadores set rol = 'ADMIN', ambito = 'SUS_CLASES' where id = pruebas.id('tra_maria');
do $$ begin assert (select ambito from public.trabajadores where id = pruebas.id('tra_maria')) = 'CENTRO', 'al pasar a ADMIN el ámbito se fuerza a CENTRO'; end $$;
delete from public.trabajadores where id = pruebas.id('tra_maria');
commit;
select pruebas.sistema();
do $$ begin
  assert (select count(*) from public.trabajadores) = 3, 'María eliminada por el admin';
  raise notice 'OK gestión del equipo exclusiva del ADMIN';
end $$;

\echo
\echo '== 18. Rol anon: sin acceso'
begin;
set local role anon;
select pruebas.espera_error('select count(*) from public.clientes', '%permission denied%');
select pruebas.espera_error('select count(*) from public.clases', '%permission denied%');
select pruebas.espera_error(format('select public.reservar(%L)', pruebas.id('cl_lun_1800')), '%permission denied%');
select pruebas.espera_error('select public.mantenimiento_diario()', '%permission denied%');
commit;

\echo
\echo '== 19. Foto del cliente (0006): cada cliente solo la suya; el personal con CLIENTES_EDITAR dentro de su ámbito'
do $$ begin
  assert exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clientes' and column_name = 'foto_url'), 'existe clientes.foto_url';
end $$;
begin;
set local role authenticated;
select pruebas.como('a');
update public.clientes set foto_url = pruebas.id('cliente_a') || '/avatar.jpg?v=1' where id = pruebas.id('cliente_a');
do $$ begin assert (select foto_url from public.clientes where id = pruebas.id('cliente_a')) like '%/avatar.jpg?v=1', 'el cliente pone su propia foto'; end $$;
select pruebas.espera_sin_efecto(format('update public.clientes set foto_url = %L where id = %L', 'hack/avatar.jpg', pruebas.id('cliente_b')));  -- fila ajena: RLS la oculta
update public.clientes set foto_url = null where id = pruebas.id('cliente_a');
do $$ begin assert (select foto_url from public.clientes where id = pruebas.id('cliente_a')) is null, 'y la quita'; end $$;
-- Cambiar la foto no le permite tocar nada más.
select pruebas.espera_error(format('update public.clientes set foto_url = %L, dni = %L where id = %L', 'x/avatar.jpg', '99999999Z', pruebas.id('cliente_a')), 'Solo puedes modificar tus datos de contacto%');
commit;
select pruebas.sistema();
do $$ begin assert (select foto_url from public.clientes where id = pruebas.id('cliente_b')) is null, 'la foto de B sigue intacta'; end $$;
-- Recepción (CLIENTES_EDITAR, ámbito CENTRO) pone y quita la foto de cualquier cliente.
begin;
set local role authenticated;
select pruebas.como('recep');
update public.clientes set foto_url = pruebas.id('cliente_b') || '/avatar.jpg?v=2' where id = pruebas.id('cliente_b');
do $$ begin assert (select foto_url from public.clientes where id = pruebas.id('cliente_b')) like '%?v=2', 'recepción pone la foto a un cliente'; end $$;
commit;
-- Ana (SUS_CLASES): sin CLIENTES_EDITAR no puede; con él, solo a sus alumnos (D lo es desde la sección 16; E, recién creada sin reservas, no).
select pruebas.sistema();
select pruebas.guardar('cliente_e', 'e0000000-0000-4000-8000-00000000000e');
insert into public.clientes (id, nombre, apellidos, dni, email, telefono) values (pruebas.id('cliente_e'), 'Elena', 'Sinclase', '55555555E', 'elena@test.local', '600 000 005');
update public.trabajadores set ambito = 'SUS_CLASES' where id = pruebas.id('tra_ana');
begin;
set local role authenticated;
select pruebas.como('ana');
select pruebas.espera_sin_efecto(format('update public.clientes set foto_url = %L where id = %L', 'x/avatar.jpg', pruebas.id('cliente_d')));  -- sin CLIENTES_EDITAR
commit;
select pruebas.sistema();
insert into public.trabajador_permisos (trabajador_id, permiso) values (pruebas.id('tra_ana'), 'CLIENTES_EDITAR');
begin;
set local role authenticated;
select pruebas.como('ana');
select pruebas.espera_sin_efecto(format('update public.clientes set foto_url = %L where id = %L', 'x/avatar.jpg', pruebas.id('cliente_e')));  -- E no es alumna suya
update public.clientes set foto_url = pruebas.id('cliente_d') || '/avatar.jpg?v=3' where id = pruebas.id('cliente_d');
do $$ begin assert (select foto_url from public.clientes where id = pruebas.id('cliente_d')) like '%?v=3', 'con CLIENTES_EDITAR pone la foto a su alumna'; end $$;
commit;
select pruebas.sistema();
do $$ begin
  assert (select foto_url from public.clientes where id = pruebas.id('cliente_e')) is null, 'la foto de E (no alumna) no la ha tocado Ana';
  assert (select foto_url from public.clientes where id = pruebas.id('cliente_b')) like '%?v=2', 'la de B (puesta por recepción) sigue igual';
  raise notice 'OK foto del cliente';
end $$;

\echo
\echo '== 20. Consentimiento de privacidad (0007): el cliente registra el suyo; el personal lo lee y registra el de papel'
do $$ begin
  assert exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clientes' and column_name = 'consentimiento_el'), 'existe clientes.consentimiento_el';
  assert exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clientes' and column_name = 'consentimiento_version'), 'existe clientes.consentimiento_version';
  assert (select consentimiento_el from public.clientes where id = pruebas.id('cliente_a')) is null, 'A empieza sin consentimiento';
end $$;
select pruebas.guardar('n_aud', (select count(*) from public.auditoria)::text);
begin;
set local role authenticated;
select pruebas.como('a');
update public.clientes set consentimiento_el = now(), consentimiento_version = '2026-09-27' where id = pruebas.id('cliente_a');
do $$ begin
  assert (select consentimiento_el from public.clientes where id = pruebas.id('cliente_a')) is not null, 'el cliente registra su consentimiento';
  assert (select consentimiento_version from public.clientes where id = pruebas.id('cliente_a')) = '2026-09-27', 'con la versión de la política';
end $$;
select pruebas.espera_sin_efecto(format('update public.clientes set consentimiento_el = now(), consentimiento_version = %L where id = %L', '2026-09-27', pruebas.id('cliente_b')));  -- fila ajena: RLS la oculta
-- Registrar el consentimiento no le permite tocar nada más.
select pruebas.espera_error(format('update public.clientes set consentimiento_el = now(), nombre = %L where id = %L', 'Hacker', pruebas.id('cliente_a')), 'Solo puedes modificar tus datos de contacto%');
commit;
select pruebas.sistema();
do $$ begin
  assert (select consentimiento_el from public.clientes where id = pruebas.id('cliente_b')) is null, 'el de B sigue pendiente';
  assert exists (select 1 from public.auditoria where accion = 'CONSENTIMIENTO' and entidad = 'cliente' and entidad_id = pruebas.id('cliente_a')::text and actor_id = pruebas.id('u_a')), 'queda auditado con el cliente como actor';
end $$;
-- Recepción (CLIENTES_VER + CLIENTES_EDITAR): lee el consentimiento de A y registra el de B firmado en papel.
begin;
set local role authenticated;
select pruebas.como('recep');
do $$ begin
  assert (select consentimiento_version from public.clientes where id = pruebas.id('cliente_a')) = '2026-09-27', 'el personal lee el consentimiento de A';
  assert (select consentimiento_el from public.clientes where id = pruebas.id('cliente_b')) is null, 'y ve pendiente el de B';
end $$;
update public.clientes set consentimiento_el = now(), consentimiento_version = 'papel' where id = pruebas.id('cliente_b');
do $$ begin assert (select consentimiento_version from public.clientes where id = pruebas.id('cliente_b')) = 'papel', 'recepción registra el consentimiento en papel'; end $$;
commit;
select pruebas.sistema();
do $$ begin
  assert exists (select 1 from public.auditoria where accion = 'CONSENTIMIENTO_PAPEL' and entidad_id = pruebas.id('cliente_b')::text and actor_id = pruebas.id('u_recep')), 'el consentimiento en papel queda auditado con recepción como actor';
  assert (select count(*) from public.auditoria) = current_setting('pruebas.n_aud')::int + 2, 'exactamente dos apuntes de auditoría nuevos';
end $$;
-- Ana (SUS_CLASES con CLIENTES_EDITAR, desde la sección 19): no puede registrar el de E (no es alumna suya).
begin;
set local role authenticated;
select pruebas.como('ana');
select pruebas.espera_sin_efecto(format('update public.clientes set consentimiento_el = now(), consentimiento_version = %L where id = %L', 'papel', pruebas.id('cliente_e')));
commit;
select pruebas.sistema();
do $$ begin assert (select consentimiento_el from public.clientes where id = pruebas.id('cliente_e')) is null, 'el de E sigue pendiente'; end $$;

\echo
\echo '== 21. Registro de usuario (signUp): trg_vincular_usuario (0004) enlaza la ficha sin usuario autenticado (corrección de 0007)'
-- Reproduce el fallo de producción: ficha creada en recepción (sin user_id) y después el usuario se registra en auth.users.
-- El trigger de auth se ejecuta con auth.uid() NULL; antes de 0007, trg_clientes_autoedicion lo bloqueaba
-- ("Solo puedes modificar tus datos de contacto...") y GoTrue devolvía "Database error saving new user".
select pruebas.sistema();
select pruebas.guardar('cliente_f', 'e0000000-0000-4000-8000-00000000000f');
select pruebas.guardar('u_f', '20000000-0000-4000-8000-00000000000f');
insert into public.clientes (id, nombre, apellidos, dni, email, telefono) values (pruebas.id('cliente_f'), 'Fran', 'Registro', '66666666F', 'Fran@Test.local', '600 000 006');
do $$ begin
  assert auth.uid() is null, 'la inserción en auth.users se hace sin jwt (como GoTrue)';
  assert (select user_id from public.clientes where id = pruebas.id('cliente_f')) is null, 'F empieza sin user_id';
end $$;
insert into auth.users (id, email) values (pruebas.id('u_f'), 'fran@test.local');
do $$ begin
  assert (select user_id from public.clientes where id = pruebas.id('cliente_f')) = pruebas.id('u_f'), 'al registrarse, la ficha queda vinculada al usuario (email sin distinguir mayúsculas)';
  raise notice 'OK consentimiento y vinculación de usuario';
end $$;

\echo
\echo '== 22. Portada (0008): cualquier usuario autenticado lee las fotos; solo el administrador las gestiona'
select pruebas.sistema();
do $$ begin
  assert exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'portada_imagenes'), 'existe portada_imagenes';
  assert (select relrowsecurity from pg_class where oid = 'public.portada_imagenes'::regclass), 'portada_imagenes tiene RLS';
  assert (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'actividades' and column_name = 'color') like '%#86735F%', 'el color por defecto de las actividades ya no es verde';
  assert not exists (select 1 from public.actividades where upper(color) in ('#548C2F', '#7FB356', '#A3CB80', '#8FBF6A')), 'ninguna actividad conserva un verde de ejemplo';
end $$;
select pruebas.guardar('por_1', 'f0000000-0000-4000-8000-000000000001');
select pruebas.guardar('por_2', 'f0000000-0000-4000-8000-000000000002');
-- Administrador: crea, edita, reordena y borra.
begin;
set local role authenticated;
select pruebas.como('admin');
insert into public.portada_imagenes (id, url, pie, orden, activa) values
  (pruebas.id('por_1'), 'https://ejemplo.test/storage/v1/object/public/portada/1.jpg', 'Sala', 1, true),
  (pruebas.id('por_2'), 'https://ejemplo.test/storage/v1/object/public/portada/2.jpg', '', 2, false);
update public.portada_imagenes set pie = 'Sala de Reformer', orden = 2 where id = pruebas.id('por_1');
update public.portada_imagenes set orden = 1, activa = true where id = pruebas.id('por_2');
do $$ begin
  assert (select count(*) from public.portada_imagenes) = 2, 'el admin ve las dos fotos';
  assert (select pie from public.portada_imagenes where id = pruebas.id('por_1')) = 'Sala de Reformer', 'el admin edita el pie';
  assert (select orden from public.portada_imagenes where id = pruebas.id('por_2')) = 1, 'el admin reordena';
end $$;
commit;
-- Cliente A: lee todas (también las ocultas: el filtro de activas lo hace la app), no escribe.
begin;
set local role authenticated;
select pruebas.como('a');
do $$ begin assert (select count(*) from public.portada_imagenes) = 2, 'el cliente lee las fotos de la portada'; end $$;
select pruebas.espera_error(format('insert into public.portada_imagenes (url) values (%L)', 'https://hack.test/x.jpg'), '%row-level security%');
select pruebas.espera_sin_efecto(format('update public.portada_imagenes set pie = %L where id = %L', 'Hackeado', pruebas.id('por_1')));
select pruebas.espera_sin_efecto(format('delete from public.portada_imagenes where id = %L', pruebas.id('por_1')));
commit;
-- Recepción (CLIENTES_EDITAR, ámbito CENTRO) y Ana (monitora): leen, pero tampoco escriben.
begin;
set local role authenticated;
select pruebas.como('recep');
do $$ begin assert (select count(*) from public.portada_imagenes) = 2, 'recepción lee las fotos'; end $$;
select pruebas.espera_error(format('insert into public.portada_imagenes (url) values (%L)', 'https://hack.test/y.jpg'), '%row-level security%');
select pruebas.espera_sin_efecto(format('update public.portada_imagenes set activa = false where id = %L', pruebas.id('por_1')));
select pruebas.espera_sin_efecto(format('delete from public.portada_imagenes where id = %L', pruebas.id('por_2')));
select pruebas.como('ana');
select pruebas.espera_sin_efecto(format('delete from public.portada_imagenes where id = %L', pruebas.id('por_2')));
commit;
-- anon: nada.
begin;
set local role anon;
select pruebas.espera_error('select count(*) from public.portada_imagenes', '%permission denied%');
commit;
select pruebas.sistema();
do $$ begin
  assert (select pie from public.portada_imagenes where id = pruebas.id('por_1')) = 'Sala de Reformer', 'nadie salvo el admin ha tocado el pie';
  assert (select count(*) from public.portada_imagenes) = 2, 'siguen las dos fotos';
end $$;
-- El admin borra una.
begin;
set local role authenticated;
select pruebas.como('admin');
delete from public.portada_imagenes where id = pruebas.id('por_2');
do $$ begin assert (select count(*) from public.portada_imagenes) = 1, 'el admin borra una foto'; end $$;
commit;
select pruebas.sistema();
do $$ begin raise notice 'OK portada'; end $$;

\echo
\echo '== 23. Web pública (0009): cualquiera lee los textos; solo el administrador los guarda'
select pruebas.sistema();
do $$ begin
  assert exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'web_contenido'), 'existe web_contenido';
  assert (select relrowsecurity from pg_class where oid = 'public.web_contenido'::regclass), 'web_contenido tiene RLS';
end $$;
-- Administrador: crea la fila y la actualiza.
begin;
set local role authenticated;
select pruebas.como('admin');
insert into public.web_contenido (id, datos, actualizado_por) values ('main', '{"schema": 2, "hero": {"title": "Hola"}}'::jsonb, pruebas.id('u_admin'))
  on conflict (id) do update set datos = excluded.datos, actualizado_por = excluded.actualizado_por;
update public.web_contenido set datos = '{"schema": 2, "hero": {"title": "Cuidamos tu salud"}}'::jsonb where id = 'main';
do $$ begin
  assert (select datos->'hero'->>'title' from public.web_contenido where id = 'main') = 'Cuidamos tu salud', 'el admin guarda los textos de la web';
end $$;
commit;
-- anon (la web sin sesión): lee, no escribe.
begin;
set local role anon;
do $$ begin assert (select datos->'hero'->>'title' from public.web_contenido where id = 'main') = 'Cuidamos tu salud', 'la web lee los textos sin sesión'; end $$;
select pruebas.espera_error('update public.web_contenido set datos = ''{}''::jsonb where id = ''main''', '%permission denied%');
commit;
-- Cliente y recepción: leen, pero no guardan.
begin;
set local role authenticated;
select pruebas.como('a');
do $$ begin assert (select count(*) from public.web_contenido) = 1, 'el cliente lee los textos'; end $$;
select pruebas.espera_sin_efecto('update public.web_contenido set datos = ''{"schema": 2, "hero": {"title": "Hackeado"}}''::jsonb where id = ''main''');
select pruebas.como('recep');
select pruebas.espera_sin_efecto('update public.web_contenido set datos = ''{"schema": 2, "hero": {"title": "Hackeado"}}''::jsonb where id = ''main''');
select pruebas.espera_error('insert into public.web_contenido (id, datos) values (''otro'', ''{}''::jsonb)', '%');
commit;
select pruebas.sistema();
do $$ begin
  assert (select datos->'hero'->>'title' from public.web_contenido where id = 'main') = 'Cuidamos tu salud', 'nadie salvo el admin ha cambiado los textos';
  raise notice 'OK web pública';
end $$;

\echo
\echo '== 24. Horario (0011): editar una franja recrea sus clases futuras y conserva las que tienen reservas'
select pruebas.sistema();
do $$
declare
  v_pl uuid := pruebas.id('pl_jue_1100');
  v_hoy date := public._hoy();
  v_antes integer; v_despues integer; v_conservadas integer; v_clase uuid;
begin
  select count(*) into v_antes from public.clases where plantilla_id = v_pl and estado = 'PROGRAMADA' and fecha >= v_hoy;
  assert v_antes > 0, 'la franja tiene clases futuras';
  -- Reserva manual del centro en la primera clase futura: esa clase debe conservarse.
  select id into v_clase from public.clases where plantilla_id = v_pl and estado = 'PROGRAMADA' and fecha >= v_hoy order by fecha limit 1;
  insert into public.reservas (clase_id, cliente_id, origen, creado_por) values (v_clase, pruebas.id('cliente_a'), 'MANUAL', null)
    on conflict do nothing;
  update public.plantillas_clase set hora_inicio = '12:15' where id = v_pl;
  perform set_config('request.jwt.claim.sub', current_setting('pruebas.u_admin'), false);
  v_conservadas := (public.plantilla_aplicar_cambios(v_pl) ->> 'conservadas')::integer;
  perform set_config('request.jwt.claim.sub', '', false);
  assert v_conservadas = 1, format('se conserva la clase con reserva manual (conservadas = %s)', v_conservadas);
  select count(*) into v_despues from public.clases where plantilla_id = v_pl and estado = 'PROGRAMADA' and fecha >= v_hoy;
  assert v_despues = v_antes, format('mismo número de clases futuras (%s → %s)', v_antes, v_despues);
  assert (select hora_inicio from public.clases where id = v_clase) = '11:00'::time, 'la clase con reserva conserva la hora antigua';
  assert (select count(*) from public.clases where plantilla_id = v_pl and estado = 'PROGRAMADA' and fecha >= v_hoy and hora_inicio = '12:15'::time) = v_antes - 1, 'el resto tiene la hora nueva';
  -- Un monitor con ámbito SUS_CLASES no puede aplicarlo.
  update public.plantillas_clase set hora_inicio = '11:00' where id = v_pl;
  raise notice 'OK horario cambios';
end $$;
begin;
set local role authenticated;
select pruebas.como('ana');
select pruebas.espera_error(format('select public.plantilla_aplicar_cambios(%L)', pruebas.id('pl_jue_1100')), '%');
commit;
select pruebas.sistema();

\echo
\echo '== 25. Cobros y edición de contratos (0013)'
select pruebas.sistema();
select pruebas.guardar('cliente_z', 'e0000000-0000-4000-8000-0000000000ff');
insert into public.clientes (id, nombre, apellidos, dni, email, telefono) values
  (pruebas.id('cliente_z'), 'Zoe', 'Cobros', '99999999Z', 'zoe@test.local', '600 000 099') on conflict (id) do nothing;
select pruebas.como('admin');
-- Alta con datos de pago y plan de cobros (oferta trimestral: 65 / 65 / 0; el primero cobrado).
select pruebas.guardar('con_z', public.crear_contrato(
  pruebas.id('cliente_z'), pruebas.id('tar_dir2'), public._hoy(), null, 'FIJO', array[pruebas.id('pl_lun_0900')], '{}', 'Prueba', null,
  'TRIMESTRAL', 6500, 'BIZUM',
  jsonb_build_array(
    jsonb_build_object('concepto', 'Mes 1', 'importe_centimos', 6500, 'vence_el', public._hoy(), 'estado', 'PAGADO', 'metodo', 'BIZUM'),
    jsonb_build_object('concepto', 'Mes 2', 'importe_centimos', 6500, 'vence_el', (public._hoy() + interval '1 month')::date, 'estado', 'PENDIENTE'),
    jsonb_build_object('concepto', 'Mes 3', 'importe_centimos', 0, 'vence_el', (public._hoy() + interval '2 months')::date, 'estado', 'PENDIENTE', 'metodo', 'NO_VALE')
  ))::text);
do $$
declare v_con uuid := pruebas.id('con_z');
begin
  -- 0027: los datos de pago viven en contratos_pago; en contratos quedan vacíos.
  assert (select oferta = 'TRIMESTRAL' and importe_centimos = 6500 and metodo_pago = 'BIZUM' from public.contratos_pago where contrato_id = v_con), 'datos de pago guardados (contratos_pago)';
  assert (select oferta = 'NINGUNA' and importe_centimos is null and metodo_pago is null from public.contratos where id = v_con), 'en contratos, vacíos';
  assert (select count(*) from public.pagos where contrato_id = v_con) = 3, 'plan de 3 cobros';
  assert (select count(*) from public.pagos where contrato_id = v_con and estado = 'PAGADO' and pagado_el is not null and proveedor = 'BIZUM') = 1, 'el primero, cobrado por Bizum';
  assert (select proveedor from public.pagos where contrato_id = v_con and concepto = 'Mes 3') = 'SIN_INDICAR', 'un método no válido queda sin indicar';
  assert (select count(*) from public.reservas r join public.clases c on c.id = r.clase_id
           where r.contrato_id = v_con and r.origen = 'AUTOMATICA' and c.plantilla_id = pruebas.id('pl_lun_0900') and c.fecha >= public._hoy()) > 0, 'reservas automáticas del lunes';
end $$;
-- Edición: cambia la franja del lunes por la del miércoles, la forma de pago y la fecha de fin.
select public.editar_contrato(pruebas.id('con_z'), (public._hoy() + interval '2 months')::date, array[pruebas.id('pl_mie_0900')], 'Cambia a miércoles',
                              'TRIMESTRAL', 6500, 'EFECTIVO', null);
do $$
declare v_con uuid := pruebas.id('con_z');
begin
  assert (select notas = 'Cambia a miércoles' and fecha_fin = (public._hoy() + interval '2 months')::date from public.contratos where id = v_con), 'contrato editado';
  assert (select metodo_pago from public.contratos_pago where contrato_id = v_con) = 'EFECTIVO', 'forma de pago editada (contratos_pago)';
  assert (select array_agg(plantilla_id) from public.contrato_franjas where contrato_id = v_con) = array[pruebas.id('pl_mie_0900')], 'franjas cambiadas';
  assert (select count(*) from public.reservas r join public.clases c on c.id = r.clase_id
           where r.contrato_id = v_con and r.estado = 'RESERVADA' and c.plantilla_id = pruebas.id('pl_lun_0900') and c.fecha >= public._hoy()) = 0, 'sin reservas futuras del lunes';
  assert (select count(*) from public.reservas r join public.clases c on c.id = r.clase_id
           where r.contrato_id = v_con and r.estado = 'RESERVADA' and c.plantilla_id = pruebas.id('pl_mie_0900') and c.fecha >= public._hoy()) > 0, 'reservas futuras del miércoles';
  assert (select count(*) from public.reservas r join public.clases c on c.id = r.clase_id
           where r.contrato_id = v_con and c.fecha > (public._hoy() + interval '2 months')::date) = 0, 'nada después del nuevo fin';
end $$;
select pruebas.espera_error(format('select public.editar_contrato(%L, %L, %L::uuid[])', pruebas.id('con_z'), public._hoy(), '{}'), '%necesita al menos una franja%');
select pruebas.espera_error(format('select public.editar_contrato(%L, %L)', pruebas.id('con_z'), public._hoy() - 400), '%posterior al inicio%');
-- El administrador marca el mes 2 como cobrado (escritura directa, RLS).
begin;
set local role authenticated;
select pruebas.como('admin');
update public.pagos set estado = 'PAGADO', proveedor = 'EFECTIVO', pagado_el = now() where contrato_id = pruebas.id('con_z') and concepto = 'Mes 2';
do $$ begin assert (select estado from public.pagos where contrato_id = pruebas.id('con_z') and concepto = 'Mes 2') = 'PAGADO', 'el admin cobra el mes 2'; end $$;
-- No se puede colgar un cobro de un contrato de otro cliente.
select pruebas.espera_error(format('insert into public.pagos (contrato_id, cliente_id, concepto, importe_centimos) values (%L, %L, %L, 100)', pruebas.id('con_z'), pruebas.id('cliente_a'), 'Truco'), '%row-level security%');
commit;
-- Un cliente no ve los cobros de otro ni puede tocarlos.
begin;
set local role authenticated;
select pruebas.como('a');
do $$ begin assert (select count(*) from public.pagos where cliente_id = pruebas.id('cliente_z')) = 0, 'un cliente no ve cobros ajenos'; end $$;
select pruebas.espera_sin_efecto(format('update public.pagos set estado = %L where cliente_id = %L', 'PAGADO', pruebas.id('cliente_z')));
select pruebas.espera_error(format('select public.editar_contrato(%L, %L, %L::uuid[])', pruebas.id('con_z'), current_date + 30, array[pruebas.id('pl_mie_0900')]), '%No tienes permiso%');
commit;
select pruebas.sistema();
do $$ begin raise notice 'OK cobros y contratos'; end $$;

\echo
\echo '== 26. Horario (0013): las clases que se conservan por tener alumnos toman la actividad y las plazas nuevas'
select pruebas.sistema();
do $$
declare
  v_pl uuid := pruebas.id('pl_jue_1100');
  v_hoy date := public._hoy();
  v_act_antes uuid; v_plazas_antes integer; v_clase uuid; v_conservadas integer;
begin
  select actividad_id, plazas into v_act_antes, v_plazas_antes from public.plantillas_clase where id = v_pl;
  select id into v_clase from public.clases where plantilla_id = v_pl and estado = 'PROGRAMADA' and fecha >= v_hoy
     and exists (select 1 from public.reservas r where r.clase_id = clases.id and r.origen = 'MANUAL') order by fecha limit 1;
  assert v_clase is not null, 'hay una clase con reserva manual (bloque 24)';
  update public.plantillas_clase set actividad_id = pruebas.id('act_reformer'), plazas = 1 where id = v_pl;
  perform set_config('request.jwt.claim.sub', current_setting('pruebas.u_admin'), false);
  v_conservadas := (public.plantilla_aplicar_cambios(v_pl) ->> 'conservadas')::integer;
  perform set_config('request.jwt.claim.sub', '', false);
  assert v_conservadas >= 1, 'se conserva la clase con alumnos';
  assert (select actividad_id from public.clases where id = v_clase) = pruebas.id('act_reformer'), 'la clase conservada toma la actividad nueva';
  assert (select hora_inicio from public.clases where id = v_clase) = '11:00'::time, 'y mantiene su hora';
  assert (select plazas from public.clases where id = v_clase) >= (select count(*) from public.reservas where clase_id = v_clase and estado = 'RESERVADA'),
    'nunca menos plazas que alumnos apuntados';
  assert (select count(*) from public.clases where plantilla_id = v_pl and estado = 'PROGRAMADA' and fecha >= v_hoy and actividad_id <> pruebas.id('act_reformer')) = 0,
    'todas las clases futuras de la franja tienen la actividad nueva';
  -- Se deja como estaba.
  update public.plantillas_clase set actividad_id = v_act_antes, plazas = v_plazas_antes where id = v_pl;
  perform set_config('request.jwt.claim.sub', current_setting('pruebas.u_admin'), false);
  perform public.plantilla_aplicar_cambios(v_pl);
  perform set_config('request.jwt.claim.sub', '', false);
  raise notice 'OK horario: clases conservadas actualizadas';
end $$;

\echo
\echo '== 27. Logros (0014): historial, conteo, resumen del centro y fecha de nacimiento'
select pruebas.sistema();
-- Una clase pasada con reserva de A (para que haya algo que contar).
do $$
declare v_clase uuid;
begin
  insert into public.clases (actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas, extraordinaria)
  values (pruebas.id('act_suelo'), public._hoy() - 3, '10:00', 55, pruebas.id('tra_ana'), 8, true) returning id into v_clase;
  insert into public.reservas (clase_id, cliente_id, origen, creado_por) values (v_clase, pruebas.id('cliente_a'), 'MANUAL', null);
  perform pruebas.guardar('cl_pasada_logros', v_clase::text);
end $$;
begin;
set local role authenticated;
select pruebas.como('a');
do $$
declare v jsonb;
begin
  v := public.historial_clases();
  assert jsonb_array_length(v) >= 1, 'el alumno ve sus clases hechas';
  assert exists (select 1 from jsonb_array_elements(v) e where e->>'f' = (current_date - 3)::text and e->>'h' = '10:00'), 'incluye la clase pasada';
end $$;
select pruebas.espera_error(format('select public.historial_clases(%L)', pruebas.id('cliente_b')), '%No tienes permiso%');
select pruebas.espera_error(format('select public.conteo_clases(array[%L]::uuid[])', pruebas.id('cliente_a')), '%Solo para el personal%');
select pruebas.espera_error('select public.resumen_centro(2026)', '%No tienes permiso%');
-- El alumno pone su fecha de nacimiento (permitido por el trigger de autoedición).
update public.clientes set fecha_nacimiento = '1980-03-15' where id = pruebas.id('cliente_a');
do $$ begin assert (select fecha_nacimiento from public.clientes where id = pruebas.id('cliente_a')) = '1980-03-15', 'el alumno guarda su cumpleaños'; end $$;
commit;
-- "No asiste" no cuenta.
select pruebas.sistema();
update public.reservas set asistencia = 'NO_ASISTE' where clase_id = pruebas.id('cl_pasada_logros');
begin;
set local role authenticated;
select pruebas.como('admin');
do $$
declare v jsonb; r jsonb;
begin
  v := public.conteo_clases(array[pruebas.id('cliente_a')]);
  assert not exists (select 1 from jsonb_array_elements(public.historial_clases(pruebas.id('cliente_a'))) e where e->>'f' = (current_date - 3)::text and e->>'h' = '10:00'),
    'una falta no cuenta como clase hecha';
  r := public.resumen_centro(extract(year from current_date)::int);
  assert r ? 'total' and r ? 'alumnos' and r ? 'horas', 'el admin ve el resumen del centro';
end $$;
commit;
select pruebas.sistema();
do $$ begin raise notice 'OK logros'; end $$;

\echo
\echo '== 28. Cliente del mes (0016)'
begin;
set local role authenticated;
select pruebas.como('admin');
do $$
declare v_aviso uuid;
begin
  assert jsonb_typeof(public.actividad_del_mes(current_date)) = 'array', 'el admin ve la actividad del mes';
  v_aviso := public.anunciar_cliente_del_mes(current_date, pruebas.id('cliente_a'), 9, 'Constancia', '🏆 ¡Cliente del mes!', 'Enhorabuena');
  assert v_aviso is not null, 'el anuncio crea un aviso';
  assert exists (select 1 from public.aviso_destinatarios where aviso_id = v_aviso and cliente_id = pruebas.id('cliente_a')), 'el aviso va al ganador';
  assert (select count(*) from public.aviso_destinatarios where aviso_id = v_aviso) = 1, 'y solo al ganador';
  -- Volver a anunciar el mismo mes sustituye (no duplica).
  perform public.anunciar_cliente_del_mes(current_date, pruebas.id('cliente_a'), 10, 'Constancia');
  assert (select count(*) from public.premios_mes where mes = date_trunc('month', current_date)::date) = 1, 'un ganador por mes';
end $$;
commit;
begin;
set local role authenticated;
select pruebas.como('b');
do $$ begin assert (select count(*) from public.premios_mes) = 0, 'los demás no lo ven mientras el ganador no diga que sí'; end $$;
select pruebas.espera_error('select public.anunciar_cliente_del_mes(current_date, auth.uid())', '%Solo el administrador%');
select pruebas.espera_error('select public.actividad_del_mes(current_date)', '%No tienes permiso%');
select pruebas.espera_error('select public.responder_cliente_del_mes(current_date, true)', '%no es tuyo%');
commit;
begin;
set local role authenticated;
select pruebas.como('a');
do $$
begin
  assert (select count(*) from public.premios_mes) = 1, 'el ganador ve su premio';
  perform public.responder_cliente_del_mes(current_date, true);
  assert (select nombre_publico from public.premios_mes where mes = date_trunc('month', current_date)::date) <> '', 'al aceptar se guarda el nombre para mostrar';
end $$;
commit;
begin;
set local role authenticated;
select pruebas.como('b');
do $$ begin assert (select count(*) from public.premios_mes where publico) = 1, 'si acepta, lo ven todos'; end $$;
commit;
begin;
set local role authenticated;
select pruebas.como('admin');
select public.quitar_cliente_del_mes(current_date);
do $$ begin assert (select count(*) from public.premios_mes) = 0, 'el admin puede quitar el premio'; end $$;
commit;
select pruebas.sistema();
do $$ begin raise notice 'OK cliente del mes'; end $$;

\echo
\echo '== 29. Vincular cuenta y ficha en cualquier orden (0017)'
select pruebas.sistema();
-- La alumna se registra ANTES de que el centro le cree la ficha.
insert into auth.users (id, email) values ('20000000-0000-4000-8000-0000000000a1', 'gema@test.local');
insert into public.clientes (id, nombre, apellidos, dni, email, telefono)
values ('e0000000-0000-4000-8000-0000000000a1', 'Gema', 'Antes', '71111111A', ' Gema@Test.local ', '600 000 101');
do $$ begin
  assert (select user_id from public.clientes where id = 'e0000000-0000-4000-8000-0000000000a1') = '20000000-0000-4000-8000-0000000000a1',
    'la ficha creada después de la cuenta queda enlazada';
end $$;
-- Una segunda ficha con el mismo correo no rompe nada (se queda sin enlazar).
insert into public.clientes (id, nombre, apellidos, dni, email, telefono)
values ('e0000000-0000-4000-8000-0000000000a2', 'Gema', 'Duplicada', '72222222A', 'gema@test.local', '600 000 102');
do $$ begin
  assert (select user_id from public.clientes where id = 'e0000000-0000-4000-8000-0000000000a2') is null, 'la ficha repetida no se enlaza ni da error';
end $$;
-- Correo mal escrito en la ficha y corregido después por recepción.
insert into auth.users (id, email) values ('20000000-0000-4000-8000-0000000000a3', 'hugo@test.local');
insert into public.clientes (id, nombre, apellidos, dni, email, telefono)
values ('e0000000-0000-4000-8000-0000000000a3', 'Hugo', 'Corregido', '73333333A', 'hugo-mal@test.local', '600 000 103');
begin;
set local role authenticated;
select pruebas.como('admin');
update public.clientes set email = 'hugo@test.local' where id = 'e0000000-0000-4000-8000-0000000000a3';
commit;
select pruebas.sistema();
do $$ begin
  assert (select user_id from public.clientes where id = 'e0000000-0000-4000-8000-0000000000a3') = '20000000-0000-4000-8000-0000000000a3',
    'al corregir el correo, la ficha queda enlazada';
end $$;
-- Cuenta nueva con dos fichas sin enlazar con su correo: se enlaza una y no falla el registro.
insert into public.clientes (id, nombre, apellidos, dni, email, telefono) values
  ('e0000000-0000-4000-8000-0000000000a4', 'Inés', 'Una', '74444444A', 'ines@test.local', '600 000 104'),
  ('e0000000-0000-4000-8000-0000000000a5', 'Inés', 'Otra', '75555555A', 'ines@test.local', '600 000 105');
insert into auth.users (id, email) values ('20000000-0000-4000-8000-0000000000a4', 'ines@test.local');
do $$ begin
  assert (select count(*) from public.clientes where user_id = '20000000-0000-4000-8000-0000000000a4') = 1, 'una sola ficha enlazada y sin error';
  raise notice 'OK vincular en cualquier orden';
end $$;

\echo
\echo '== 30. Ocupación de las clases visible para los alumnos (0018)'
select pruebas.sistema();
do $$
declare v_clase uuid;
begin
  insert into public.clases (actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas, extraordinaria)
  values (pruebas.id('act_suelo'), public._hoy() + 2, '12:00', 55, pruebas.id('tra_ana'), 6, true) returning id into v_clase;
  insert into public.reservas (clase_id, cliente_id, origen, creado_por) values (v_clase, pruebas.id('cliente_a'), 'MANUAL', null);
  perform pruebas.guardar('cl_ocupacion', v_clase::text);
end $$;
begin;
set local role authenticated;
select pruebas.como('b');
do $$
begin
  assert (select count(*) from public.reservas where clase_id = pruebas.id('cl_ocupacion')) = 0, 'B no ve las reservas de A';
  assert (select ocupadas from public.ocupacion_clases where clase_id = pruebas.id('cl_ocupacion')) = 1, 'pero sí cuántas plazas están ocupadas';
  raise notice 'OK ocupación de las clases';
end $$;
commit;
select pruebas.sistema();

\echo
\echo '== 31. Apuntar también a las clases pasadas (0019)'
select pruebas.sistema();
insert into public.clientes (id, nombre, apellidos, dni, email, telefono) values
  ('e0000000-0000-4000-8000-0000000000c1', 'Paula', 'Pasadas', '77777777P', 'paula@test.local', '600 000 201'),
  ('e0000000-0000-4000-8000-0000000000c2', 'Pedro', 'Futuras', '78888888P', 'pedro@test.local', '600 000 202');
-- Una clase de la franja de los miércoles 09:00, hace una semana.
insert into public.clases (plantilla_id, actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas)
select p.id, p.actividad_id, public._hoy() - 7, p.hora_inicio, p.duracion_min, p.monitor_id, p.plazas
  from public.plantillas_clase p where p.id = pruebas.id('pl_mie_0900')
on conflict (plantilla_id, fecha) do nothing;
begin;
set local role authenticated;
select pruebas.como('admin');
do $$
declare v_con uuid; v_pasada uuid; v_futuras integer;
begin
  select id into v_pasada from public.clases where plantilla_id = pruebas.id('pl_mie_0900') and fecha = current_date - 7;
  -- Sin pedir las pasadas: solo desde hoy.
  v_con := public.crear_contrato('e0000000-0000-4000-8000-0000000000c2', pruebas.id('tar_dir2'), current_date - 10, null, 'FIJO', array[pruebas.id('pl_mie_0900')]);
  assert not exists (select 1 from public.reservas where clase_id = v_pasada and cliente_id = 'e0000000-0000-4000-8000-0000000000c2'), 'por defecto no se apunta a clases pasadas';
  -- Pidiéndolas: también la de hace una semana.
  v_con := public.crear_contrato('e0000000-0000-4000-8000-0000000000c1', pruebas.id('tar_dir2'), current_date - 10, null, 'FIJO', array[pruebas.id('pl_mie_0900')], p_incluir_pasadas => true);
  assert exists (select 1 from public.reservas where clase_id = v_pasada and cliente_id = 'e0000000-0000-4000-8000-0000000000c1' and estado = 'RESERVADA' and origen = 'AUTOMATICA'), 'con p_incluir_pasadas se apunta a la clase pasada';
  select count(*) into v_futuras from public.reservas r join public.clases c on c.id = r.clase_id where r.contrato_id = v_con and c.fecha >= current_date;
  assert v_futuras > 0, 'y a las futuras como siempre';
  -- Editar después pidiendo las pasadas también las recupera (Pedro).
  select id into v_con from public.contratos where cliente_id = 'e0000000-0000-4000-8000-0000000000c2' and estado = 'ACTIVO';
  perform public.editar_contrato(v_con, (current_date + 60)::date, array[pruebas.id('pl_mie_0900')], '', 'NINGUNA', null, null, null, true);
  assert exists (select 1 from public.reservas where clase_id = v_pasada and cliente_id = 'e0000000-0000-4000-8000-0000000000c2'), 'editar con p_incluir_pasadas apunta a la clase pasada';
  raise notice 'OK clases pasadas';
end $$;
commit;
select pruebas.sistema();

\echo
\echo '== 32. Quitar una franja cancela sus clases; los festivos no se recuperan (0020)'
select pruebas.sistema();
insert into public.clientes (id, nombre, apellidos, dni, email, telefono) values
  ('e0000000-0000-4000-8000-0000000000d1', 'Diana', 'Franja', '79999999D', 'diana@test.local', '600 000 301'),
  ('e0000000-0000-4000-8000-0000000000d2', 'Dario', 'Festivo', '70000000D', 'dario@test.local', '600 000 302');
-- Franja nueva (sábados 12:00) con sus clases, y Diana apuntada a mano a la próxima.
insert into public.plantillas_clase (id, actividad_id, dia_semana, hora_inicio, duracion_min, monitor_id, plazas)
values ('d0000000-0000-4000-8000-0000000000d1', pruebas.id('act_suelo'), 6, '12:00', 55, pruebas.id('tra_ana'), 8);
select public._generar_clases(public._hoy(), public._hoy() + 21);
do $$
declare v_clase uuid;
begin
  select id into v_clase from public.clases where plantilla_id = 'd0000000-0000-4000-8000-0000000000d1' and fecha >= public._hoy() order by fecha limit 1;
  insert into public.reservas (clase_id, cliente_id, origen, creado_por) values (v_clase, 'e0000000-0000-4000-8000-0000000000d1', 'MANUAL', null);
  perform pruebas.guardar('cl_franja_quitada', v_clase::text);
end $$;
-- Se desactiva la franja.
update public.plantillas_clase set activa = false where id = 'd0000000-0000-4000-8000-0000000000d1';
begin;
set local role authenticated;
select pruebas.como('admin');
do $$
declare v jsonb;
begin
  v := public.plantilla_aplicar_cambios('d0000000-0000-4000-8000-0000000000d1');
  assert (v ->> 'canceladas')::int = 1 and (v ->> 'afectados')::int = 1, 'se cancela la clase con alumnos: ' || v::text;
  assert jsonb_array_length(v -> 'avisos') = 1, 'y se crea su aviso';
  assert (select estado from public.clases where id = pruebas.id('cl_franja_quitada')) = 'CANCELADA', 'la clase queda cancelada';
  assert not exists (select 1 from public.clases where plantilla_id = 'd0000000-0000-4000-8000-0000000000d1' and estado = 'PROGRAMADA' and fecha >= current_date),
    'no queda ninguna clase de la franja para reservar';
  assert exists (select 1 from public.recuperaciones where cliente_id = 'e0000000-0000-4000-8000-0000000000d1' and motivo = 'CANCELACION_CENTRO'),
    'la alumna recibe su recuperación';
end $$;
commit;

-- Festivo cancelado a mano: sin recuperación (pero con aviso).
select pruebas.sistema();
do $$
declare v_clase uuid;
begin
  insert into public.clases (actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas, extraordinaria)
  values (pruebas.id('act_suelo'), public._hoy() + 30, '13:00', 55, pruebas.id('tra_ana'), 8, true) returning id into v_clase;
  insert into public.reservas (clase_id, cliente_id, origen, creado_por) values (v_clase, 'e0000000-0000-4000-8000-0000000000d2', 'MANUAL', null);
  insert into public.dias_cierre (fecha, motivo) values (public._hoy() + 30, 'Festivo de prueba') on conflict (fecha) do nothing;
  perform pruebas.guardar('cl_festivo', v_clase::text);
end $$;
begin;
set local role authenticated;
select pruebas.como('admin');
select public.cancelar_clase(pruebas.id('cl_festivo'), 'Festivo', null, true);
do $$
begin
  assert not exists (select 1 from public.recuperaciones r join public.reservas x on x.id = r.reserva_origen_id where x.clase_id = pruebas.id('cl_festivo')),
    'un festivo cancelado a mano no da recuperación';
  assert exists (select 1 from public.avisos where destino_clase_id = pruebas.id('cl_festivo') and cuerpo like '%no se recupera%'), 'pero se avisa de que no se recupera';
end $$;
commit;

-- Día de cierre guardado en Ajustes: sus clases se cancelan en el momento, sin recuperación.
select pruebas.sistema();
do $$
declare v_clase uuid;
begin
  insert into public.clases (actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas, extraordinaria)
  values (pruebas.id('act_suelo'), public._hoy() + 31, '13:00', 55, pruebas.id('tra_ana'), 8, true) returning id into v_clase;
  insert into public.reservas (clase_id, cliente_id, origen, creado_por) values (v_clase, 'e0000000-0000-4000-8000-0000000000d2', 'MANUAL', null);
  insert into public.dias_cierre (fecha, motivo) values (public._hoy() + 31, 'Puente') on conflict (fecha) do nothing;
  perform pruebas.guardar('cl_cierre', v_clase::text);
end $$;
begin;
set local role authenticated;
select pruebas.como('b');
select pruebas.espera_error('select public.cancelar_clases_cierre()', '%Solo el administrador%');
commit;
begin;
set local role authenticated;
select pruebas.como('admin');
do $$
declare v jsonb;
begin
  v := public.cancelar_clases_cierre();
  assert (v ->> 'canceladas')::int >= 1, 'cancela las clases de los días de cierre: ' || v::text;
  assert (select estado from public.clases where id = pruebas.id('cl_cierre')) = 'CANCELADA', 'la clase del cierre queda cancelada';
  assert (select estado from public.reservas where clase_id = pruebas.id('cl_cierre')) = 'CANCELADA_CENTRO', 'su reserva pasa a cancelada por el centro';
  assert not exists (select 1 from public.recuperaciones r join public.reservas x on x.id = r.reserva_origen_id where x.clase_id = pruebas.id('cl_cierre')),
    'sin recuperación';
  assert exists (select 1 from public.avisos where destino_clase_id = pruebas.id('cl_cierre')), 'con aviso';
end $$;
commit;
select pruebas.sistema();
-- La tarea nocturna sigue funcionando con el cambio.
do $$ begin assert (public.mantenimiento_diario() ? 'clases_canceladas_por_cierre'), 'mantenimiento nocturno'; raise notice 'OK franjas quitadas y festivos'; end $$;

\echo '== 33. Lista de espera y eliminar franjas (0021)'
select pruebas.sistema();
select pruebas.guardar('u_l1', '20000000-0000-4000-8000-0000000000e1');
select pruebas.guardar('u_l2', '20000000-0000-4000-8000-0000000000e2');
select pruebas.guardar('cliente_l1', 'e0000000-0000-4000-8000-0000000000e1');
select pruebas.guardar('cliente_l2', 'e0000000-0000-4000-8000-0000000000e2');
insert into auth.users (id, email) values (pruebas.id('u_l1'), 'lola@test.local'), (pruebas.id('u_l2'), 'luis@test.local');
insert into public.clientes (id, nombre, apellidos, dni, email, telefono, user_id) values
  (pruebas.id('cliente_l1'), 'Lola', 'Espera', '71111111L', 'lola@test.local', '600 000 401', pruebas.id('u_l1')),
  (pruebas.id('cliente_l2'), 'Luis', 'Espera', '72222222L', 'luis@test.local', '600 000 402', pruebas.id('u_l2'));
select pruebas.como('admin');
select pruebas.guardar('con_l1', public.crear_contrato(pruebas.id('cliente_l1'), pruebas.id('tar_dir2'), public._hoy(), null, 'LIBRE')::text);
select pruebas.guardar('con_l2', public.crear_contrato(pruebas.id('cliente_l2'), pruebas.id('tar_dir2'), public._hoy(), null, 'LIBRE')::text);
select pruebas.sistema();
-- Clase X (miércoles 20:00 de la semana de pruebas, 1 plaza) llena con Carlos; clase Y con plazas libres.
do $$
declare v_x uuid; v_y uuid; v_res uuid;
begin
  insert into public.clases (actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas, extraordinaria)
  values (pruebas.id('act_suelo'), pruebas.fecha('lunes') + 2, '20:00', 55, pruebas.id('tra_ana'), 1, true) returning id into v_x;
  insert into public.reservas (clase_id, cliente_id, origen) values (v_x, pruebas.id('cliente_c'), 'MANUAL') returning id into v_res;
  perform pruebas.guardar('res_c_x', v_res::text);
  insert into public.clases (actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas, extraordinaria)
  values (pruebas.id('act_suelo'), pruebas.fecha('lunes') + 2, '21:00', 55, pruebas.id('tra_ana'), 5, true) returning id into v_y;
  perform pruebas.guardar('cl_x', v_x::text);
  perform pruebas.guardar('cl_y', v_y::text);
end $$;

-- Apuntarse: Lola (1ª), Luis (2º). Reglas de entrada.
begin;
set local role authenticated;
select pruebas.como('l1');
do $$
declare r jsonb;
begin
  r := public.apuntar_lista_espera(pruebas.id('cl_x'));
  assert (r->>'posicion')::int = 1, 'Lola es la primera: ' || r::text;
  r := public.apuntar_lista_espera(pruebas.id('cl_x'));
  assert (r->>'posicion')::int = 1, 'apuntarse dos veces no duplica: ' || r::text;
  assert (select count(*) from public.lista_espera) = 1, 'RLS: Lola solo ve su entrada';
  assert (select posicion from public.mi_lista_espera where clase_id = pruebas.id('cl_x')) = 1, 'vista mi_lista_espera';
  assert (select en_espera from public.ocupacion_clases where clase_id = pruebas.id('cl_x')) = 1, 'ocupacion_clases.en_espera';
end $$;
select pruebas.espera_error(format('select public.apuntar_lista_espera(%L)', pruebas.id('cl_y')), 'Quedan plazas libres%');
select pruebas.espera_error(format('delete from public.lista_espera where clase_id = %L', pruebas.id('cl_x')), 'permission denied%');
commit;
begin;
set local role authenticated;
select pruebas.como('l2');
do $$
declare r jsonb;
begin
  r := public.apuntar_lista_espera(pruebas.id('cl_x'));
  assert (r->>'posicion')::int = 2, 'Luis es el segundo: ' || r::text;
  assert (select count(*) from public.lista_espera) = 1, 'RLS: Luis solo ve su entrada';
end $$;
-- No se puede usar como cambio una reserva ajena.
select pruebas.espera_error(format('select public.apuntar_lista_espera(%L, %L)', pruebas.id('cl_x'), pruebas.id('res_c_x')), 'La reserva que quieres cambiar no es tuya.');
commit;
-- Berta (horario fijo, sin recuperaciones) no puede apuntarse sin cambio; el personal no se apunta.
select pruebas.sistema();
update public.recuperaciones set estado = 'CADUCADA' where cliente_id = pruebas.id('cliente_b') and estado = 'DISPONIBLE';
begin;
set local role authenticated;
select pruebas.como('b');
select pruebas.espera_error(format('select public.apuntar_lista_espera(%L)', pruebas.id('cl_x')), 'Tienes horario fijo.%');
select pruebas.como('admin');
select pruebas.espera_error(format('select public.apuntar_lista_espera(%L)', pruebas.id('cl_x')), 'Solo los alumnos%');
do $$ begin assert (select count(*) from public.lista_espera where clase_id = pruebas.id('cl_x')) = 2, 'el personal ve toda la lista'; end $$;
commit;

-- Se libera la plaza de Carlos (cancelación por el centro) → entra Lola con su cupo; Luis pasa a ser el primero.
begin;
set local role authenticated;
select pruebas.como('admin');
select public.cancelar_reserva(pruebas.id('res_c_x'), true);
do $$
declare v_aviso public.avisos%rowtype;
begin
  assert exists (select 1 from public.reservas where clase_id = pruebas.id('cl_x') and cliente_id = pruebas.id('cliente_l1') and estado = 'RESERVADA' and origen = 'CLIENTE'),
    'Lola entra desde la lista con su cupo semanal';
  assert not exists (select 1 from public.lista_espera where clase_id = pruebas.id('cl_x') and cliente_id = pruebas.id('cliente_l1')), 'Lola ya no está en la lista';
  assert (select count(*) from public.lista_espera where clase_id = pruebas.id('cl_x')) = 1, 'Luis sigue esperando';
  select a.* into v_aviso from public.avisos a join public.aviso_destinatarios d on d.aviso_id = a.id
   where d.cliente_id = pruebas.id('cliente_l1') and a.titulo like '¡Tienes plaza!%';
  assert v_aviso.id is not null and v_aviso.destino_tipo = 'CLIENTES', 'aviso a Lola';
  assert exists (select 1 from public.auditoria where accion = 'LISTA_ESPERA' and detalle like 'Lola Espera entra desde la lista%'), 'auditoría';
end $$;
commit;
begin;
set local role authenticated;
select pruebas.como('l2');
do $$ begin assert (select posicion from public.mi_lista_espera where clase_id = pruebas.id('cl_x')) = 1, 'Luis pasa a ser el primero'; end $$;
commit;
select pruebas.sistema();
do $$ begin
  assert exists (select 1 from public.avisos_push_pendientes pp join public.avisos a on a.id = pp.aviso_id join public.aviso_destinatarios d on d.aviso_id = a.id
                  where d.cliente_id = pruebas.id('cliente_l1') and a.titulo like '¡Tienes plaza!%'), 'el aviso queda pendiente de push (solo lo lee la función enviar-push)';
end $$;

-- Suben las plazas de la clase → entra Luis.
select pruebas.sistema();
update public.clases set plazas = 2 where id = pruebas.id('cl_x');
do $$ begin
  assert exists (select 1 from public.reservas where clase_id = pruebas.id('cl_x') and cliente_id = pruebas.id('cliente_l2') and estado = 'RESERVADA'), 'Luis entra al subir las plazas';
  assert (select count(*) from public.lista_espera where clase_id = pruebas.id('cl_x')) = 0, 'lista vacía';
  raise notice 'OK promoción por cancelación y por subida de plazas';
end $$;

-- Cambio: Berta se apunta a la clase X2 (miércoles de la semana siguiente) a cambio de su jueves fijo de esa semana.
do $$
declare v_x2 uuid;
begin
  insert into public.clases (actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas, extraordinaria)
  values (pruebas.id('act_suelo'), pruebas.fecha('lunes') + 9, '20:00', 55, pruebas.id('tra_ana'), 1, true) returning id into v_x2;
  insert into public.reservas (clase_id, cliente_id, origen) values (v_x2, pruebas.id('cliente_c'), 'MANUAL');
  perform pruebas.guardar('cl_x2', v_x2::text);
  perform pruebas.guardar('res_b_jue2', (select r.id::text from public.reservas r join public.clases c on c.id = r.clase_id
     where r.cliente_id = pruebas.id('cliente_b') and r.estado = 'RESERVADA' and c.plantilla_id = pruebas.id('pl_jue_1800') and c.fecha = pruebas.fecha('lunes') + 10));
  perform pruebas.guardar('res_b_mar2', (select r.id::text from public.reservas r join public.clases c on c.id = r.clase_id
     where r.cliente_id = pruebas.id('cliente_b') and r.estado = 'RESERVADA' and c.plantilla_id = pruebas.id('pl_mar_1800') and c.fecha = pruebas.fecha('lunes') + 15));
end $$;
begin;
set local role authenticated;
select pruebas.como('b');
-- Otra semana: no vale como cambio.
select pruebas.espera_error(format('select public.apuntar_lista_espera(%L, %L)', pruebas.id('cl_x2'), pruebas.id('res_b_mar2')), 'Solo se puede cambiar por una clase de la misma semana.%');
do $$
declare r jsonb;
begin
  r := public.apuntar_lista_espera(pruebas.id('cl_x2'), pruebas.id('res_b_jue2'));
  assert (r->>'posicion')::int = 1, 'Berta se apunta a cambio de su jueves: ' || r::text;
end $$;
commit;
select pruebas.sistema();
do $$
declare v_jue uuid := (select clase_id from public.reservas where id = pruebas.id('res_b_jue2'));
begin
  update public.reservas set estado = 'CANCELADA_CENTRO' where clase_id = pruebas.id('cl_x2') and cliente_id = pruebas.id('cliente_c');
  -- 0022: la reserva antigua se queda en su clase (cancelada) y se crea una nueva en la clase elegida.
  assert (select estado from public.reservas where id = pruebas.id('res_b_jue2')) = 'CANCELADA_RECUPERABLE', 'la reserva del jueves queda cancelada (cambio)';
  assert (select clase_id from public.reservas where id = pruebas.id('res_b_jue2')) = v_jue, 'y sigue constando en su clase fija';
  assert exists (select 1 from public.reservas where clase_id = pruebas.id('cl_x2') and cliente_id = pruebas.id('cliente_b') and estado = 'RESERVADA' and origen = 'CLIENTE'
                    and contrato_id = pruebas.id('con_b')), 'Berta tiene plaza en la clase nueva, con su contrato';
  assert not exists (select 1 from public.reservas where clase_id = v_jue and cliente_id = pruebas.id('cliente_b') and estado = 'RESERVADA'), 'el jueves queda libre';
  assert not exists (select 1 from public.recuperaciones where reserva_origen_id = pruebas.id('res_b_jue2')), 'un cambio no da recuperación';
  -- El mantenimiento no vuelve a apuntarla al jueves que cambió.
  perform public._generar_reservas_automaticas(pruebas.id('con_b'));
  assert not exists (select 1 from public.reservas where clase_id = v_jue and cliente_id = pruebas.id('cliente_b') and estado = 'RESERVADA'), 'el mantenimiento no la devuelve a la clase cambiada';
  assert exists (select 1 from public.avisos a join public.aviso_destinatarios d on d.aviso_id = a.id
                  where d.cliente_id = pruebas.id('cliente_b') and a.cuerpo like '%queda cambiada por esta%'), 'aviso del cambio';
  assert (select count(*) from public.lista_espera where clase_id = pruebas.id('cl_x2')) = 0, 'lista vacía';
  raise notice 'OK cambio de clase desde la lista de espera';
end $$;

-- Menos de 2 horas antes: ni apuntarse ni promover.
do $$
declare v_z uuid; v_t timestamp := public._ahora_local() + interval '1 hour';
begin
  insert into public.clases (actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas, extraordinaria)
  values (pruebas.id('act_suelo'), v_t::date, v_t::time, 55, pruebas.id('tra_ana'), 1, true) returning id into v_z;
  insert into public.reservas (clase_id, cliente_id, origen) values (v_z, pruebas.id('cliente_c'), 'MANUAL');
  perform pruebas.guardar('cl_z', v_z::text);
end $$;
begin;
set local role authenticated;
select pruebas.como('l1');
select pruebas.espera_error(format('select public.apuntar_lista_espera(%L)', pruebas.id('cl_z')), 'La lista de espera se cierra 2 horas antes de la clase.');
commit;
select pruebas.sistema();
insert into public.lista_espera (clase_id, cliente_id) values (pruebas.id('cl_z'), pruebas.id('cliente_l1'));
update public.reservas set estado = 'CANCELADA_CENTRO' where clase_id = pruebas.id('cl_z');
do $$ begin
  assert not exists (select 1 from public.reservas where clase_id = pruebas.id('cl_z') and cliente_id = pruebas.id('cliente_l1')), 'a menos de 2 horas no se promueve';
  assert exists (select 1 from public.lista_espera where clase_id = pruebas.id('cl_z')), 'la entrada se queda (el centro gestiona a mano)';
  raise notice 'OK sin promoción a menos de 2 horas';
end $$;

-- Salir de la lista (alumno) y quitar de la lista (personal). Una clase cancelada vacía su lista.
do $$
declare v_w uuid;
begin
  insert into public.clases (actividad_id, fecha, hora_inicio, duracion_min, monitor_id, plazas, extraordinaria)
  values (pruebas.id('act_suelo'), pruebas.fecha('lunes') + 4, '20:00', 55, pruebas.id('tra_ana'), 1, true) returning id into v_w;
  insert into public.reservas (clase_id, cliente_id, origen) values (v_w, pruebas.id('cliente_c'), 'MANUAL');
  perform pruebas.guardar('cl_w', v_w::text);
end $$;
begin;
set local role authenticated;
select pruebas.como('l1');
select public.apuntar_lista_espera(pruebas.id('cl_w'));
select public.salir_lista_espera(pruebas.id('cl_w'));
do $$ begin assert not exists (select 1 from public.lista_espera where clase_id = pruebas.id('cl_w')), 'Lola sale de la lista'; end $$;
select public.apuntar_lista_espera(pruebas.id('cl_w'));
select pruebas.espera_error(format('select public.quitar_de_lista_espera(%L)', (select id from public.lista_espera where clase_id = pruebas.id('cl_w'))), 'Solo para el personal.');
select pruebas.como('admin');
select public.quitar_de_lista_espera((select id from public.lista_espera where clase_id = pruebas.id('cl_w')));
do $$ begin assert not exists (select 1 from public.lista_espera where clase_id = pruebas.id('cl_w')), 'el personal quita a Lola'; end $$;
select pruebas.como('l1');
select public.apuntar_lista_espera(pruebas.id('cl_w'));
select pruebas.como('admin');
select public.cancelar_clase(pruebas.id('cl_w'), 'Prueba lista', null, true);
do $$ begin
  assert not exists (select 1 from public.lista_espera where clase_id = pruebas.id('cl_w')), 'cancelar la clase vacía su lista';
  assert not exists (select 1 from public.reservas where clase_id = pruebas.id('cl_w') and cliente_id = pruebas.id('cliente_l1')), 'y no mete a nadie';
  raise notice 'OK salir, quitar y cancelar clase';
end $$;
commit;

-- Mantenimiento nocturno: limpia listas de clases pasadas.
select pruebas.sistema();
do $$ begin assert (public.mantenimiento_diario() ? 'lista_espera_limpiada'), 'mantenimiento nocturno'; end $$;

-- Eliminar franja: bloqueada por un contrato fijo; luego cancela con alumnos y borra las vacías.
insert into public.plantillas_clase (id, actividad_id, dia_semana, hora_inicio, duracion_min, monitor_id, plazas)
values ('d0000000-0000-4000-8000-0000000000e1', pruebas.id('act_suelo'), 6, '13:00', 55, pruebas.id('tra_ana'), 8);
select public._generar_clases(public._hoy(), public._hoy() + 21);
select pruebas.como('admin');
select pruebas.guardar('con_l2_fijo', public.crear_contrato(pruebas.id('cliente_l2'), pruebas.id('tar_dir2'), public._hoy() + 60, null, 'FIJO', array['d0000000-0000-4000-8000-0000000000e1'::uuid])::text);
begin;
set local role authenticated;
select pruebas.como('admin');
select pruebas.espera_error('select public.eliminar_plantilla(''d0000000-0000-4000-8000-0000000000e1'')', 'No se puede eliminar: la tienen como clase fija Luis Espera.%');
select pruebas.como('l1');
select pruebas.espera_error('select public.eliminar_plantilla(''d0000000-0000-4000-8000-0000000000e1'')', 'No tienes permiso para: HORARIOS_GESTIONAR');
commit;
select pruebas.sistema();
update public.contratos set estado = 'FINALIZADO' where id = pruebas.id('con_l2_fijo');
do $$
declare v_clase uuid;
begin
  select id into v_clase from public.clases where plantilla_id = 'd0000000-0000-4000-8000-0000000000e1' and fecha >= public._hoy() order by fecha limit 1;
  insert into public.reservas (clase_id, cliente_id, origen) values (v_clase, pruebas.id('cliente_l1'), 'MANUAL');
  perform pruebas.guardar('cl_franja_elim', v_clase::text);
end $$;
begin;
set local role authenticated;
select pruebas.como('admin');
do $$
declare v jsonb;
begin
  v := public.eliminar_plantilla('d0000000-0000-4000-8000-0000000000e1');
  assert (v ->> 'canceladas')::int = 1 and (v ->> 'afectados')::int = 1 and (v ->> 'borradas')::int >= 1, 'resultado: ' || v::text;
  assert (select estado from public.clases where id = pruebas.id('cl_franja_elim')) = 'CANCELADA', 'la clase con alumna queda cancelada';
  assert not exists (select 1 from public.clases where plantilla_id = 'd0000000-0000-4000-8000-0000000000e1' and estado = 'PROGRAMADA' and fecha >= current_date), 'no quedan clases futuras';
  assert (select not activa and eliminada_el is not null from public.plantillas_clase where id = 'd0000000-0000-4000-8000-0000000000e1'), 'franja marcada como eliminada';
  assert exists (select 1 from public.recuperaciones where cliente_id = pruebas.id('cliente_l1') and motivo = 'CANCELACION_CENTRO'), 'la alumna recibe recuperación';
end $$;
select pruebas.espera_error('select public.eliminar_plantilla(''d0000000-0000-4000-8000-0000000000e1'')', 'La franja ya está eliminada.');
commit;
select pruebas.sistema();
do $$ begin
  assert (public.mantenimiento_diario() ->> 'clases_creadas')::int = 0 or not exists (select 1 from public.clases where plantilla_id = 'd0000000-0000-4000-8000-0000000000e1' and fecha > current_date and estado = 'PROGRAMADA'),
    'la franja eliminada no vuelve a generar clases';
  raise notice 'OK eliminar franja';
end $$;

\echo '== 34. Las reservas fijas no se pierden al cambiar la contratación (0022)'
select pruebas.sistema();
select pruebas.guardar('u_r1', '20000000-0000-4000-8000-0000000000f1');
select pruebas.guardar('cliente_r1', 'e0000000-0000-4000-8000-0000000000f1');
insert into auth.users (id, email) values (pruebas.id('u_r1'), 'rita@test.local');
insert into public.clientes (id, nombre, apellidos, dni, email, telefono, user_id) values
  (pruebas.id('cliente_r1'), 'Rita', 'Recontrata', '73333333R', 'rita@test.local', '600 000 501', pruebas.id('u_r1'));
begin;
set local role authenticated;
select pruebas.como('admin');
-- Contrato fijo lunes 09:00 + miércoles 09:00.
select pruebas.guardar('con_r1', public.crear_contrato(pruebas.id('cliente_r1'), pruebas.id('tar_dir2'), current_date, null, 'FIJO', array[pruebas.id('pl_lun_0900'), pruebas.id('pl_mie_0900')])::text);
do $$
declare v_antes integer;
begin
  select count(*) into v_antes from public.reservas where contrato_id = pruebas.id('con_r1') and estado = 'RESERVADA';
  assert v_antes >= 4, 'tiene sus clases fijas: ' || v_antes;
  perform pruebas.guardar('r1_antes', v_antes::text);
end $$;
-- La alumna cancela una de ellas (decisión suya).
select pruebas.como('r1');
select pruebas.guardar('res_r1_cancelada', (select r.id::text from public.reservas r join public.clases c on c.id = r.clase_id
   where r.contrato_id = pruebas.id('con_r1') and r.estado = 'RESERVADA' and c.fecha > current_date + 2 order by c.fecha limit 1));
select public.cancelar_reserva(pruebas.id('res_r1_cancelada'));
commit;
-- Una de sus clases fijas la apuntó el centro a mano (origen MANUAL): al finalizar queda "cancelada por el centro".
select pruebas.sistema();
update public.reservas set origen = 'MANUAL' where id = (select r.id from public.reservas r join public.clases c on c.id = r.clase_id
   where r.contrato_id = pruebas.id('con_r1') and r.estado = 'RESERVADA' and c.fecha > current_date + 4 order by c.fecha limit 1);
-- El centro "finaliza" el contrato cancelando sus reservas futuras (lo que pasó en octubre) y le da uno nuevo con las mismas franjas.
begin;
set local role authenticated;
select pruebas.como('admin');
select public.finalizar_contrato(pruebas.id('con_r1'), true);
do $$ begin
  -- 0023: las fijas se quitan; la manual queda cancelada por el centro.
  assert (select count(*) from public.reservas where contrato_id = pruebas.id('con_r1') and estado = 'CANCELADA_CENTRO') = 1, 'al finalizar, solo la manual queda cancelada por el centro';
  assert not exists (select 1 from public.reservas r join public.clases c on c.id = r.clase_id where r.contrato_id = pruebas.id('con_r1') and r.origen = 'AUTOMATICA' and c.fecha >= current_date and r.id <> pruebas.id('res_r1_cancelada')), 'las fijas futuras se quitan (solo queda la que canceló ella)';
  assert not exists (select 1 from public.reservas where contrato_id = pruebas.id('con_r1') and estado = 'RESERVADA'), 'sin reservas activas';
end $$;
select pruebas.guardar('con_r2', public.crear_contrato(pruebas.id('cliente_r1'), pruebas.id('tar_dir2'), current_date, null, 'FIJO', array[pruebas.id('pl_lun_0900'), pruebas.id('pl_mie_0900')])::text);
do $$
declare v_despues integer;
begin
  select count(*) into v_despues from public.reservas where contrato_id = pruebas.id('con_r2') and estado = 'RESERVADA';
  assert v_despues = current_setting('pruebas.r1_antes')::integer - 1, format('recupera sus clases fijas menos la que canceló ella: antes %s, ahora %s', current_setting('pruebas.r1_antes'), v_despues);
  assert (select estado from public.reservas where id = pruebas.id('res_r1_cancelada')) = 'CANCELADA_RECUPERABLE', 'la que canceló ella sigue cancelada';
  -- Sin duplicados: cada clase tiene una sola fila suya, revivida (no una cancelada y otra nueva).
  assert not exists (select clase_id from public.reservas where cliente_id = pruebas.id('cliente_r1') group by clase_id having count(*) > 1), 'sin filas duplicadas por clase';
  assert not exists (select 1 from public.reservas where cliente_id = pruebas.id('cliente_r1') and estado = 'CANCELADA_CENTRO'
                        and clase_id in (select id from public.clases where estado = 'PROGRAMADA')), 'no queda ninguna "cancelada por el centro" en clases programadas';
  raise notice 'OK recontratar tras finalizar: % reservas fijas recuperadas', v_despues;
end $$;
-- Nueva contratación directa (sin finalizar antes): las reservas pasan al contrato nuevo, sin duplicar.
select pruebas.guardar('con_r3', public.crear_contrato(pruebas.id('cliente_r1'), pruebas.id('tar_dir2'), current_date, null, 'FIJO', array[pruebas.id('pl_lun_0900'), pruebas.id('pl_mie_0900')])::text);
do $$ begin
  assert (select estado from public.contratos where id = pruebas.id('con_r2')) = 'FINALIZADO', 'el anterior se finaliza solo';
  assert not exists (select 1 from public.reservas where contrato_id = pruebas.id('con_r2') and estado = 'RESERVADA'
                        and clase_id in (select id from public.clases where fecha >= current_date)), 'las reservas fijas futuras ya no cuelgan del contrato viejo';
  assert (select count(*) from public.reservas where contrato_id = pruebas.id('con_r3') and estado = 'RESERVADA') = current_setting('pruebas.r1_antes')::integer - 1, 'y cuelgan del nuevo';
  assert not exists (select clase_id from public.reservas where cliente_id = pruebas.id('cliente_r1') group by clase_id having count(*) > 1), 'sin duplicados';
  assert exists (select 1 from public.auditoria where accion = 'CREAR_CONTRATO' and entidad_id = pruebas.id('con_r3')::text and detalle like '%conservadas del contrato anterior%'), 'auditoría';
  raise notice 'OK nueva contratación directa: conserva las clases fijas';
end $$;
-- Cambio de franjas (solo lunes): las reservas fijas del miércoles se quitan; las del lunes siguen.
select pruebas.guardar('con_r4', public.crear_contrato(pruebas.id('cliente_r1'), pruebas.id('tar_dir2'), current_date, null, 'FIJO', array[pruebas.id('pl_lun_0900')])::text);
do $$ begin
  assert not exists (select 1 from public.reservas r join public.clases c on c.id = r.clase_id
                      where r.cliente_id = pruebas.id('cliente_r1') and r.estado = 'RESERVADA' and c.plantilla_id = pruebas.id('pl_mie_0900') and c.fecha >= current_date),
    'las clases fijas de la franja que ya no tiene se quitan';
  assert (select count(*) from public.reservas r join public.clases c on c.id = r.clase_id
           where r.contrato_id = pruebas.id('con_r4') and r.estado = 'RESERVADA' and c.plantilla_id = pruebas.id('pl_lun_0900')) > 0, 'las del lunes pasan al contrato nuevo';
  raise notice 'OK nueva contratación con otras franjas';
end $$;
commit;

\echo '== 35. Finanzas: solo quien tiene ve_finanzas ve importes y cobros (0024)'
select pruebas.sistema();
-- Recepción puede editar fichas (y por tanto contratar) pero no ve las finanzas.
insert into public.trabajador_permisos (trabajador_id, permiso) values (pruebas.id('tra_recep'), 'CLIENTES_EDITAR'), (pruebas.id('tra_recep'), 'CLIENTES_VER')
  on conflict do nothing;
do $$ begin
  assert (select ve_finanzas from public.trabajadores where id = pruebas.id('tra_admin')), 'el admin de pruebas ve las finanzas';
  assert not (select ve_finanzas from public.trabajadores where id = pruebas.id('tra_recep')), 'recepción no';
end $$;
-- Como recepción (rol authenticated): ni cobros, ni columnas de dinero, ni vista; y no puede concedérselo.
begin;
set local role authenticated;
select pruebas.como('recep');
do $$ begin
  assert not public.ve_finanzas(), 've_finanzas() false';
  assert (select count(*) from public.pagos) = 0, 'no lee ningún cobro';
  assert (select count(*) from public.contratos_finanzas) = 0, 'la vista no le devuelve nada';
  assert (select count(*) from public.contratos where id = pruebas.id('con_z')) = 1, 'sigue viendo el contrato (sin dinero)';
  assert (select count(*) from public.contratos_finanzas) = 0, 'vista vacía';
end $$;
-- 0027: la tabla contratos se lee entera (también las apps antiguas), pero sus columnas de dinero van vacías.
do $$ begin assert (select importe_centimos is null and oferta = 'NINGUNA' from public.contratos where id = pruebas.id('con_z')), 'en contratos el dinero va vacío'; end $$;
select pruebas.espera_error('select count(*) from public.contratos_pago', '%permission denied%');
do $$ begin assert (select count(*) from (select * from public.contratos limit 1) x) = 1, 'select * de contratos funciona (apps antiguas)'; end $$;
-- Escribir el dinero directamente en contratos sin ver las finanzas: se ignora y queda vacío.
update public.contratos set importe_centimos = 1, oferta = 'FAMILIAR' where id = pruebas.id('con_z');
select pruebas.espera_error(format('insert into public.pagos (contrato_id, cliente_id, concepto, importe_centimos) values (%L, %L, %L, 100)', pruebas.id('con_z'), pruebas.id('cliente_z'), 'Truco'), '%row-level security%');
select pruebas.espera_sin_efecto(format('update public.pagos set estado = %L where cliente_id = %L', 'PAGADO', pruebas.id('cliente_z')));
-- Edita el contrato sin mandar datos de pago: la fecha cambia, el dinero se conserva.
select public.editar_contrato(pruebas.id('con_z'), (current_date + interval '3 months')::date, array[pruebas.id('pl_mie_0900')], 'Editado por recepción'); -- _hoy() es interna: current_date
commit;
select pruebas.sistema();
do $$ begin
  assert (select fecha_fin = (current_date + interval '3 months')::date and notas = 'Editado por recepción' from public.contratos where id = pruebas.id('con_z')), 'recepción edita fin y notas';
  assert (select oferta = 'TRIMESTRAL' and importe_centimos = 6500 and metodo_pago = 'EFECTIVO' from public.contratos_pago where contrato_id = pruebas.id('con_z')), 'los datos de pago no se han tocado';
  assert (select importe_centimos is null and oferta = 'NINGUNA' from public.contratos where id = pruebas.id('con_z')), 'y en contratos siguen vacíos';
end $$;
-- Un administrador sin acceso a las finanzas (recepción ascendida para la prueba) gestiona trabajadores,
-- pero no puede darse el acceso: se conserva en silencio y el resto del cambio sí se guarda.
update public.trabajadores set rol = 'ADMIN' where id = pruebas.id('tra_recep');
begin;
set local role authenticated;
select pruebas.como('recep');
update public.trabajadores set telefono = '600 000 111', ve_finanzas = true where id = pruebas.id('tra_recep');
commit;
select pruebas.sistema();
do $$ begin
  assert not (select ve_finanzas from public.trabajadores where id = pruebas.id('tra_recep')), 'no se lo ha podido conceder';
  assert (select telefono from public.trabajadores where id = pruebas.id('tra_recep')) = '600 000 111', 'pero el resto del cambio sí se guarda';
end $$;
-- Como administrador con finanzas: ve todo, puede conceder, y no puede dejar a nadie con acceso.
begin;
set local role authenticated;
select pruebas.como('admin');
do $$ begin
  assert public.ve_finanzas(), 've_finanzas() true';
  assert (select count(*) from public.pagos where contrato_id = pruebas.id('con_z')) = 3, 'lee los cobros';
  assert (select importe_centimos from public.contratos_finanzas where id = pruebas.id('con_z')) = 6500, 'lee el importe en la vista';
end $$;
select pruebas.espera_error('select count(*) from public.contratos_pago', '%permission denied%'); -- la tabla aparte, nadie desde la app
select public.editar_contrato(pruebas.id('con_z'), (current_date + interval '3 months')::date, array[pruebas.id('pl_mie_0900')], 'Editado por el admin', 'NINGUNA', 7000, 'BIZUM');
do $$ begin
  assert (select importe_centimos from public.contratos_finanzas where id = pruebas.id('con_z')) = 7000, 'editar_contrato con finanzas guarda el importe';
  assert (select oferta from public.contratos_finanzas where id = pruebas.id('con_z')) = 'NINGUNA', 'y la oferta (también "ninguna")';
  assert (select importe_centimos is null from public.contratos where id = pruebas.id('con_z')), 'contratos sigue vacío';
end $$;
update public.trabajadores set ve_finanzas = true where id = pruebas.id('tra_recep');
do $$ begin assert (select ve_finanzas from public.trabajadores where id = pruebas.id('tra_recep')), 'el admin concede el acceso'; end $$;
update public.trabajadores set ve_finanzas = false where id = pruebas.id('tra_recep');
select pruebas.espera_error(format('update public.trabajadores set ve_finanzas = false where id = %L', pruebas.id('tra_admin')), '%al menos una persona%');
select pruebas.espera_error(format('update public.trabajadores set activo = false where id = %L', pruebas.id('tra_admin')), '%al menos una persona activa%');
commit;
select pruebas.sistema();
update public.trabajadores set rol = 'RECEPCION', ve_finanzas = false where id = pruebas.id('tra_recep');
delete from public.trabajador_permisos where trabajador_id = pruebas.id('tra_recep') and permiso in ('CLIENTES_EDITAR', 'CLIENTES_VER');
do $$ begin raise notice 'OK finanzas: solo con ve_finanzas'; end $$;

\echo '== 36. Foto de la hoja de consentimiento firmada en papel (0025)'
select pruebas.sistema();
insert into public.trabajador_permisos (trabajador_id, permiso) values (pruebas.id('tra_recep'), 'CLIENTES_EDITAR'), (pruebas.id('tra_recep'), 'CLIENTES_VER') on conflict do nothing;
do $$ begin
  assert (select consentimiento_version from public.clientes where id = pruebas.id('cliente_b')) = 'papel', 'B firmó en papel (bloque 18)';
  assert (select consentimiento_adjunto from public.clientes where id = pruebas.id('cliente_b')) is null, 'sin foto todavía';
end $$;
-- Recepción (CLIENTES_EDITAR) guarda la ruta de la foto; queda auditado.
begin;
set local role authenticated;
select pruebas.como('recep');
update public.clientes set consentimiento_adjunto = pruebas.id('cliente_b')::text || '/1.jpg' where id = pruebas.id('cliente_b');
commit;
select pruebas.sistema();
do $$ begin
  assert (select consentimiento_adjunto from public.clientes where id = pruebas.id('cliente_b')) = pruebas.id('cliente_b')::text || '/1.jpg', 'foto guardada';
  assert exists (select 1 from public.auditoria where accion = 'CONSENTIMIENTO_ADJUNTO' and entidad_id = pruebas.id('cliente_b')::text and actor_id = pruebas.id('u_recep') and detalle like '%guardada%'), 'auditado: foto guardada';
end $$;
-- El propio cliente no puede tocar la foto (sí su contacto).
begin;
set local role authenticated;
select pruebas.como('b');
select pruebas.espera_error(format('update public.clientes set consentimiento_adjunto = null where id = %L', pruebas.id('cliente_b')), 'Solo puedes modificar tus datos de contacto%');
update public.clientes set telefono = '600 000 222' where id = pruebas.id('cliente_b');
commit;
select pruebas.sistema();
do $$ begin
  assert (select consentimiento_adjunto from public.clientes where id = pruebas.id('cliente_b')) is not null, 'la foto sigue';
  assert (select telefono from public.clientes where id = pruebas.id('cliente_b')) = '600 000 222', 'y su contacto sí cambia';
end $$;
-- Quitar la foto también se audita.
begin;
set local role authenticated;
select pruebas.como('recep');
update public.clientes set consentimiento_adjunto = null where id = pruebas.id('cliente_b');
commit;
select pruebas.sistema();
do $$ begin
  assert exists (select 1 from public.auditoria where accion = 'CONSENTIMIENTO_ADJUNTO' and entidad_id = pruebas.id('cliente_b')::text and detalle like '%quitada%'), 'auditado: foto quitada';
end $$;
delete from public.trabajador_permisos where trabajador_id = pruebas.id('tra_recep') and permiso in ('CLIENTES_EDITAR', 'CLIENTES_VER');
do $$ begin raise notice 'OK foto del consentimiento en papel'; end $$;

\echo '== 37. Cumpleaños: suscripciones push del personal y notificación matinal (0026)'
select pruebas.sistema();
-- Un trabajador guarda la suscripción de su móvil; no puede colgarla de otro.
begin;
set local role authenticated;
select pruebas.como('recep');
insert into public.suscripciones_push (trabajador_id, endpoint, clave_p256dh, clave_auth) values (pruebas.id('tra_recep'), 'https://push.test/recep', 'p', 'a');
select pruebas.espera_error(format('insert into public.suscripciones_push (trabajador_id, endpoint, clave_p256dh, clave_auth) values (%L, %L, %L, %L)', pruebas.id('tra_admin'), 'https://push.test/otro', 'p', 'a'), '%row-level security%');
select pruebas.espera_error(format('insert into public.suscripciones_push (cliente_id, trabajador_id, endpoint, clave_p256dh, clave_auth) values (%L, %L, %L, %L, %L)', pruebas.id('cliente_a'), pruebas.id('tra_recep'), 'https://push.test/dos', 'p', 'a'), '%suscripciones_push_un_dueno%');
do $$ begin
  assert (select count(*) from public.suscripciones_push where trabajador_id = pruebas.id('tra_recep')) = 1, 've y guarda la suya';
end $$;
commit;
select pruebas.sistema();
-- Hoy cumple años A: la notificación queda preparada para monitores y administradores, una sola vez al día.
update public.clientes set fecha_nacimiento = (public._hoy() - interval '30 years')::date where id = pruebas.id('cliente_a');
do $$
declare v_n integer;
begin
  v_n := public.programar_push_cumpleanos();
  assert v_n = 1, format('cumple 1 (devuelve %s)', v_n);
  assert (select count(*) from public.push_personal_pendientes) = 1, 'una notificación preparada';
  assert (select titulo from public.push_personal_pendientes) like '🎂 Hoy cumple años Ana%', 'título con el nombre';
  assert (select pruebas.id('tra_admin') = any (destinatarios) from public.push_personal_pendientes), 'va al administrador';
  assert public.programar_push_cumpleanos() = 0, 'la segunda llamada del día no repite';
  assert (select count(*) from public.push_personal_pendientes) = 1, 'sigue habiendo una';
end $$;
-- Sin cumpleaños no se prepara nada.
delete from public.push_personal_pendientes;
update public.clientes set fecha_nacimiento = null where id = pruebas.id('cliente_a');
do $$ begin
  assert public.programar_push_cumpleanos() = 0, 'nadie cumple';
  assert (select count(*) from public.push_personal_pendientes) = 0, 'nada preparado';
end $$;
-- La tabla de pendientes no la lee nadie desde la app (solo la función con service_role).
begin;
set local role authenticated;
select pruebas.como('admin');
select pruebas.espera_error('select count(*) from public.push_personal_pendientes', '%permission denied%');
commit;
select pruebas.sistema();
delete from public.suscripciones_push where trabajador_id = pruebas.id('tra_recep');
do $$ begin raise notice 'OK cumpleaños del personal'; end $$;

\echo '== 38. Permisos de la función de notificaciones (rol service_role, 0027)'
do $$ begin
  assert has_table_privilege('service_role', 'public.avisos', 'SELECT'), 'service_role lee avisos';
  assert has_table_privilege('service_role', 'public.avisos_push_pendientes', 'DELETE'), 'service_role borra avisos pendientes';
  assert has_table_privilege('service_role', 'public.push_personal_pendientes', 'DELETE'), 'service_role borra notificaciones del personal';
  assert has_table_privilege('service_role', 'public.suscripciones_push', 'DELETE'), 'service_role borra suscripciones caducadas';
  assert has_table_privilege('service_role', 'public.contratos_pago', 'SELECT'), 'service_role lee la tabla nueva';
  assert not has_table_privilege('authenticated', 'public.contratos_pago', 'SELECT'), 'la app no lee contratos_pago';
  raise notice 'OK permisos de la función de notificaciones';
end $$;

\echo '== 39. Renovar contratos de golpe (0028)'
select pruebas.sistema();
select pruebas.guardar('cliente_rn', 'e0000000-0000-4000-8000-0000000000f1');
insert into public.clientes (id, nombre, apellidos, dni, email, telefono) values
  (pruebas.id('cliente_rn'), 'Rena', 'Novación', '88888888R', 'rena@test.local', '600 000 088') on conflict (id) do nothing;
select pruebas.como('admin');
-- Horario fijo los lunes, termina en 10 días, 50 € al mes por tarjeta, sin cobros todavía.
select pruebas.guardar('con_rn', public.crear_contrato(pruebas.id('cliente_rn'), pruebas.id('tar_dir2'), public._hoy(), public._hoy() + 10, 'FIJO',
  array[pruebas.id('pl_lun_0900')], '{}', '', null, 'NINGUNA', 5000, 'TARJETA')::text);
select pruebas.guardar('rn_reservas_antes', (select count(*) from public.reservas where contrato_id = pruebas.id('con_rn') and estado = 'RESERVADA')::text);
-- Se renueva junto con un bono (que no se toca).
select pruebas.guardar('rn_res', public.renovar_contratos(array[pruebas.id('con_rn'), pruebas.id('con_c')], public._hoy() + 40)::text);
do $$
declare
  v jsonb := current_setting('pruebas.rn_res')::jsonb;
  v_meses integer;
begin
  assert (v->>'renovados')::int = 1 and (v->>'saltados')::int = 1, format('uno renovado y el bono saltado (%s)', v);
  assert (select fecha_fin from public.contratos where id = pruebas.id('con_rn')) = public._hoy() + 40, 'fin alargado';
  assert (select estado from public.contratos where id = pruebas.id('con_rn')) = 'ACTIVO', 'sigue siendo el mismo contrato, activo';
  assert (select count(*) from public.reservas where contrato_id = pruebas.id('con_rn') and estado = 'RESERVADA') > current_setting('pruebas.rn_reservas_antes')::int, 'apuntado a las clases del periodo nuevo';
  assert not exists (select 1 from public.reservas r join public.clases c on c.id = r.clase_id
                      where r.contrato_id = pruebas.id('con_rn') and c.fecha > public._hoy() + 40), 'nada después del fin nuevo';
  -- Un cobro por cada mes que empieza en el periodo nuevo.
  select count(distinct date_trunc('month', d)) into v_meses from generate_series(public._hoy() + 11, public._hoy() + 40, interval '1 day') d
   where d::date = public._hoy() + 11 or extract(day from d) = 1;
  -- 0029: el concepto es el nombre del mes y el cobro lleva su mes.
  assert (select count(*) from public.pagos where contrato_id = pruebas.id('con_rn') and concepto ~ '^[A-Z][a-z]+ \d{4}$' and importe_centimos = 5000 and estado = 'PENDIENTE' and mes = date_trunc('month', vence_el)::date) = v_meses,
    format('un cobro de 50 € por mes nuevo (%s esperados)', v_meses);
end $$;
-- Repetirlo no hace nada (ya llega a esa fecha) ni duplica cobros.
do $$
declare v jsonb := public.renovar_contratos(array[pruebas.id('con_rn')], public._hoy() + 40);
begin
  assert (v->>'renovados')::int = 0 and (v->>'cobros')::int = 0, format('segunda vez sin efecto (%s)', v);
end $$;
-- Sin permiso de editar fichas, no se puede.
begin;
set local role authenticated;
select pruebas.como('a');
select pruebas.espera_error(format('select public.renovar_contratos(array[%L]::uuid[], %L::date)', pruebas.id('con_rn'), current_date + 60), '%No tienes permiso%');
commit;
select pruebas.sistema();
do $$ begin
  assert exists (select 1 from public.auditoria where accion = 'RENOVAR_CONTRATO' and entidad_id = pruebas.id('con_rn')::text), 'queda en el registro de cambios';
  raise notice 'OK renovar contratos';
end $$;

\echo
\echo '== 40. Cobros por mes: recontratar no duplica, los pendientes del anterior se sustituyen y limpieza (0029)'
select pruebas.sistema();
select pruebas.guardar('cliente_cm', 'e0000000-0000-4000-8000-0000000000f2');
insert into public.clientes (id, nombre, apellidos, dni, email, telefono) values
  (pruebas.id('cliente_cm'), 'Cobro', 'Mensual', '77777777C', 'cobro@test.local', '600 000 077') on conflict (id) do nothing;
select pruebas.como('admin');
-- Contrato 1 (como lo hacía la app antes): octubre cobrado, noviembre y diciembre pendientes. Sin 'mes': lo pone el disparador.
select pruebas.guardar('con_cm1', public.crear_contrato(pruebas.id('cliente_cm'), pruebas.id('tar_dir2'), date '2026-10-06', date '2027-01-05', 'LIBRE',
  '{}', '{}', '', null, 'NINGUNA', 5000, 'EFECTIVO',
  jsonb_build_array(
    jsonb_build_object('concepto', 'Octubre 2026', 'importe_centimos', 5000, 'vence_el', '2026-10-06', 'estado', 'PAGADO', 'metodo', 'EFECTIVO'),
    jsonb_build_object('concepto', 'Noviembre 2026', 'importe_centimos', 5000, 'vence_el', '2026-11-06', 'estado', 'PENDIENTE'),
    jsonb_build_object('concepto', 'Diciembre 2026', 'importe_centimos', 5000, 'vence_el', '2026-12-06', 'estado', 'PENDIENTE')))::text);
do $$ begin
  assert (select array_agg(mes order by mes) from public.pagos where contrato_id = pruebas.id('con_cm1')) = array[date '2026-10-01', date '2026-11-01', date '2026-12-01'], 'el mes sale de la fecha de cobro';
end $$;
-- Un cobro con nombre viejo: la migración (idempotente, se repite aquí) le pone el mes por el nombre y lo renombra.
insert into public.pagos (contrato_id, cliente_id, concepto, importe_centimos, vence_el, estado) values (pruebas.id('con_cm1'), pruebas.id('cliente_cm'), 'Mes 1 · julio 2026', 5000, '2026-07-06', 'PAGADO');
update public.pagos p set mes = make_date(2026, 7, 1) where concepto = 'Mes 1 · julio 2026';
update public.pagos set concepto = initcap((array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from mes)::int]) || ' ' || extract(year from mes)::int
 where lower(concepto) ~ '^(mes \d+|renovación) · [a-záéíóú]+ \d{4}$';
do $$ begin assert exists (select 1 from public.pagos where cliente_id = pruebas.id('cliente_cm') and concepto = 'Julio 2026' and mes = '2026-07-01'), 'nombre viejo normalizado'; end $$;
-- Un cobro suelto pendiente de septiembre (deuda vieja) que no se debe perder.
insert into public.pagos (contrato_id, cliente_id, concepto, importe_centimos, vence_el, estado) values (pruebas.id('con_cm1'), pruebas.id('cliente_cm'), 'Septiembre 2026', 1000, '2026-09-15', 'PENDIENTE');
-- Contrato 2 al mismo alumno (como el 26 de octubre: "arreglar las clases"): el plan vuelve a traer octubre y noviembre.
select pruebas.guardar('con_cm2', public.crear_contrato(pruebas.id('cliente_cm'), pruebas.id('tar_dir2'), date '2026-10-26', date '2026-11-30', 'LIBRE',
  '{}', '{}', '', null, 'NINGUNA', 4500, 'EFECTIVO',
  jsonb_build_array(
    jsonb_build_object('concepto', 'Octubre 2026', 'importe_centimos', 4500, 'vence_el', '2026-10-26', 'mes', '2026-10-01', 'estado', 'PAGADO', 'metodo', 'EFECTIVO'),
    jsonb_build_object('concepto', 'Noviembre 2026', 'importe_centimos', 4500, 'vence_el', '2026-11-26', 'mes', '2026-11-01', 'estado', 'PENDIENTE')))::text);
do $$
declare v_cli uuid := pruebas.id('cliente_cm');
begin
  assert (select estado from public.contratos where id = pruebas.id('con_cm1')) = 'FINALIZADO', 'el contrato anterior se cierra';
  -- Octubre: solo el cobrado del contrato 1 (no entra otro "octubre"). Noviembre: solo uno, el del plan nuevo (45 €).
  assert (select count(*) from public.pagos where cliente_id = v_cli and mes = '2026-10-01') = 1, 'octubre no se repite';
  assert (select estado = 'PAGADO' and importe_centimos = 5000 from public.pagos where cliente_id = v_cli and mes = '2026-10-01'), 'el octubre cobrado se queda tal cual';
  assert (select count(*) from public.pagos where cliente_id = v_cli and mes = '2026-11-01') = 1, 'noviembre no se repite';
  assert (select contrato_id = pruebas.id('con_cm2') and importe_centimos = 4500 from public.pagos where cliente_id = v_cli and mes = '2026-11-01'), 'noviembre es el del plan nuevo';
  -- Diciembre pendiente del contrato anterior: sustituido (el plan nuevo no llega a diciembre, así que desaparece).
  assert not exists (select 1 from public.pagos where cliente_id = v_cli and mes = '2026-12-01'), 'el pendiente de diciembre del contrato anterior se quita';
  -- La deuda de septiembre (anterior al plan nuevo) sigue ahí.
  assert exists (select 1 from public.pagos where cliente_id = v_cli and mes = '2026-09-01' and estado = 'PENDIENTE'), 'la deuda anterior no se toca';
  assert exists (select 1 from public.auditoria where accion = 'CREAR_CONTRATO' and entidad_id = pruebas.id('con_cm2')::text and detalle like '%1 meses ya apuntados%' and detalle like '%2 pendientes del anterior sustituidos%'), 'el registro de cambios lo cuenta (octubre ya cobrado; noviembre y diciembre pendientes sustituidos)';
end $$;
-- Cambiar el mes de un cobro desde la app (el 26 de octubre de 45 € era en realidad noviembre): se puede, y el disparador respeta el valor.
begin;
set local role authenticated;
select pruebas.como('admin');
update public.pagos set mes = '2027-02-01' where cliente_id = pruebas.id('cliente_cm') and mes = '2026-09-01';
do $$ begin assert (select count(*) from public.pagos where cliente_id = pruebas.id('cliente_cm') and mes = '2027-02-01') = 1, 'el mes se puede cambiar a mano'; end $$;
update public.pagos set mes = null where cliente_id = pruebas.id('cliente_cm') and mes = '2027-02-01';
do $$ begin assert (select mes from public.pagos where cliente_id = pruebas.id('cliente_cm') and concepto = 'Septiembre 2026') = date '2026-09-01', 'sin mes, vuelve al de la fecha de cobro'; end $$;
commit;
select pruebas.como('admin');
-- Renovar crea el cobro con su mes y su nombre, y no repite un mes ya apuntado.
do $$
declare v jsonb;
begin
  v := public.renovar_contratos(array[pruebas.id('con_cm2')], date '2026-12-31');
  assert (v->>'renovados')::int = 1 and (v->>'cobros')::int = 1, format('un cobro nuevo, diciembre (%s)', v);
  assert (select concepto = 'Diciembre 2026' and estado = 'PENDIENTE' and importe_centimos = 4500 from public.pagos where cliente_id = pruebas.id('cliente_cm') and mes = '2026-12-01'), 'diciembre con su nombre e importe';
  assert (select count(*) from public.pagos where cliente_id = pruebas.id('cliente_cm') and mes = '2026-11-01') = 1, 'noviembre sigue sin repetirse';
end $$;
-- Limpieza (la de la migración, repetida aquí): restos como los que había en producción.
insert into public.pagos (contrato_id, cliente_id, concepto, importe_centimos, vence_el, estado) values
  (pruebas.id('con_cm1'), pruebas.id('cliente_cm'), 'Resto pendiente', 5000, '2026-10-16', 'PENDIENTE'),   -- pendiente de contrato cerrado
  (null, pruebas.id('cliente_cm'), 'Octubre 2026', 5000, '2026-10-16', 'PENDIENTE');                       -- pendiente suelto de un mes ya cobrado
select pruebas.guardar('con_cm3', public.crear_contrato(pruebas.id('cliente_cm'), pruebas.id('tar_dir2'), date '2026-10-14', date '2026-10-14', 'LIBRE')::text);
select public.finalizar_contrato(pruebas.id('con_cm3'), true);
delete from public.reservas where contrato_id = pruebas.id('con_cm3');
do $$
declare v_pend integer; v_dup integer; v_con integer;
begin
  with b as (delete from public.pagos p using public.contratos c where c.id = p.contrato_id and c.estado <> 'ACTIVO' and p.estado = 'PENDIENTE' returning p.id) select count(*) into v_pend from b;
  with b as (delete from public.pagos p where p.estado = 'PENDIENTE' and exists (select 1 from public.pagos q where q.cliente_id = p.cliente_id and q.mes = p.mes and q.estado = 'PAGADO') returning p.id) select count(*) into v_dup from b;
  with vacios as (select c.id from public.contratos c where c.estado <> 'ACTIVO'
       and not exists (select 1 from public.reservas r where r.contrato_id = c.id) and not exists (select 1 from public.pagos p where p.contrato_id = c.id)
       and not exists (select 1 from public.recuperaciones x where x.contrato_id = c.id)),
    f as (delete from public.contrato_franjas where contrato_id in (select id from vacios) returning 1),
    p as (delete from public.contratos_pago where contrato_id in (select id from vacios) returning 1),
    b as (delete from public.contratos where id in (select id from vacios) returning id) select count(*) into v_con from b;
  assert v_pend >= 1 and v_dup >= 1, format('limpieza de pendientes (%s cerrados, %s de meses cobrados)', v_pend, v_dup);
  assert not exists (select 1 from public.contratos where id = pruebas.id('con_cm3')), 'el contrato vacío desaparece del historial';
  assert exists (select 1 from public.contratos where id = pruebas.id('con_cm1')), 'el contrato cerrado con cobros se queda';
  assert (select count(*) from public.pagos where cliente_id = pruebas.id('cliente_cm') and estado = 'PAGADO') = 2, 'lo cobrado no se toca nunca';
  raise notice 'OK cobros por mes';
end $$;

\echo
\echo '== 41. Dar de baja a un alumno cierra su contrato y libera sus plazas (0031)'
select pruebas.sistema();
select pruebas.guardar('cliente_bj', 'e0000000-0000-4000-8000-0000000000f3');
insert into public.clientes (id, nombre, apellidos, dni, email, telefono) values
  (pruebas.id('cliente_bj'), 'Prueba', 'De un día', '66666666B', 'baja@test.local', '600 000 066') on conflict (id) do nothing;
select pruebas.como('admin');
select pruebas.guardar('con_bj', public.crear_contrato(pruebas.id('cliente_bj'), pruebas.id('tar_dir2'), public._hoy(), public._hoy() + 40, 'FIJO',
  array[pruebas.id('pl_mie_0900')], '{}', '', null, 'NINGUNA', 4000, 'EFECTIVO',
  jsonb_build_array(jsonb_build_object('concepto', 'Deuda', 'importe_centimos', 4000, 'vence_el', public._hoy(), 'estado', 'PENDIENTE')))::text);
do $$ begin
  assert (select count(*) from public.reservas r join public.clases c on c.id = r.clase_id
           where r.cliente_id = pruebas.id('cliente_bj') and r.estado = 'RESERVADA' and c.fecha >= public._hoy()) > 0, 'tiene clases fijas futuras';
end $$;
-- Recepción/administración la da de baja desde la app (escritura directa en clientes, como la app).
begin;
set local role authenticated;
select pruebas.como('admin');
update public.clientes set activo = false where id = pruebas.id('cliente_bj');
commit;
select pruebas.sistema();
do $$
declare v_cli uuid := pruebas.id('cliente_bj');
begin
  assert (select estado from public.contratos where id = pruebas.id('con_bj')) = 'FINALIZADO', 'el contrato se finaliza';
  assert (select fecha_fin from public.contratos where id = pruebas.id('con_bj')) <= public._hoy(), 'termina hoy';
  assert not exists (select 1 from public.reservas r join public.clases c on c.id = r.clase_id
                      where r.cliente_id = v_cli and r.estado = 'RESERVADA' and c.fecha >= public._hoy()), 'sin clases futuras';
  assert exists (select 1 from public.pagos where cliente_id = v_cli and estado = 'PENDIENTE'), 'lo que debe sigue apuntado';
  assert exists (select 1 from public.auditoria where accion = 'BAJA_CIERRA_CONTRATO' and entidad_id = v_cli::text), 'queda en el registro de cambios';
  assert public._cerrar_alumno_de_baja(v_cli) = 0, 'segunda vez sin efecto';
end $$;
-- No se renueva (ya no tiene contrato activo).
select pruebas.como('admin');
do $$ begin
  assert (public.renovar_contratos(array[pruebas.id('con_bj')], public._hoy() + 60)->>'renovados')::int = 0, 'no se renueva';
  raise notice 'OK baja cierra contrato';
end $$;

\echo
\echo '== Todas las comprobaciones han pasado.'
