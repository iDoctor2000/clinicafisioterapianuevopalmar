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
  assert (select count(*) from public.tarifas) = 8 and (select count(*) from public.actividades) = 4 and (select count(*) from public.clases) > 0, 'catálogo legible';
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
  assert (select count(*) from public.tarifas) = 8, 've tarifas';
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
\echo '== Todas las comprobaciones han pasado.'
