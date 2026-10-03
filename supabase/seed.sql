-- =============================================================================
-- seed.sql · Datos iniciales del centro (espejo de app/src/data/seed.ts)
-- Sin clientes reales. Idempotente: puede ejecutarse varias veces.
-- Los uuid son fijos para poder referenciarlos desde el horario y las pruebas.
-- =============================================================================

-- Configuración del centro
insert into public.config_centro (id, nombre, minutos_antelacion_cancelacion, dias_ventana_reserva,
  recuperacion_caduca_con_contrato, dias_caducidad_recuperacion, dias_generacion_clases, zona_horaria)
values (true, 'Clínica Nuevo Palmar · Pilates', 60, 14, true, 30, 70, 'Europe/Madrid')
on conflict (id) do nothing;

-- Días de cierre del año en curso (festivos)
insert into public.dias_cierre (fecha, motivo)
select make_date(extract(year from current_date)::int, m, d), motivo
  from (values (10, 12, 'Fiesta Nacional'), (11, 1, 'Todos los Santos'), (12, 6, 'Día de la Constitución'),
               (12, 8, 'Inmaculada'), (12, 25, 'Navidad')) v(m, d, motivo)
on conflict (fecha) do nothing;

-- Actividades
insert into public.actividades (id, nombre, categoria, descripcion, color, orden) values
  ('a0000000-0000-4000-8000-000000000001', 'Pilates suelo', 'DIRIGIDA', 'Trabajo de control postural, core y movilidad en colchoneta. Grupo reducido dirigido por fisioterapeuta.', '#86735F', 1),
  ('a0000000-0000-4000-8000-000000000002', 'Espalda sana',  'DIRIGIDA', 'Sesión terapéutica centrada en columna: movilidad, estabilidad y prevención del dolor.', '#B9A795', 2),
  ('a0000000-0000-4000-8000-000000000003', 'Hipopresivos',  'DIRIGIDA', 'Técnicas hipopresivas para suelo pélvico, postura y respiración.', '#A08D79', 3),
  ('a0000000-0000-4000-8000-000000000004', 'Reformer',      'REFORMER', 'Pilates en máquina Reformer. Máximo 4 personas por sesión, supervisión individualizada.', '#3B82C4', 4)
on conflict (id) do nothing;

-- Tarifas
insert into public.tarifas (id, nombre, descripcion, tipo, bono_sesiones, bono_categoria, bono_validez_meses,
  recuperacion_permitida, recuperacion_categorias_extra, recuperacion_max_pendientes, precio_centimos, orden) values
  ('b0000000-0000-4000-8000-000000000001', 'Dirigidas · 2 días/semana', 'Dos sesiones semanales de actividades dirigidas (suelo, espalda sana, hipopresivos).', 'RECURRENTE', null, null, null, true, '{}', null, null, 1),
  ('b0000000-0000-4000-8000-000000000002', 'Dirigidas · 3 días/semana', 'Tres sesiones semanales de actividades dirigidas.', 'RECURRENTE', null, null, null, true, '{}', null, null, 2),
  ('b0000000-0000-4000-8000-000000000003', 'Reformer · 2 días/semana',  'Dos sesiones semanales de Reformer.', 'RECURRENTE', null, null, null, true, '{}', null, null, 3),
  ('b0000000-0000-4000-8000-000000000004', 'Reformer · 3 días/semana',  'Tres sesiones semanales de Reformer.', 'RECURRENTE', null, null, null, true, '{}', null, null, 4),
  ('b0000000-0000-4000-8000-000000000005', 'Mixta · 1 Reformer + 1 dirigida', 'Una sesión semanal de Reformer y una de actividades dirigidas.', 'RECURRENTE', null, null, null, true, '{}', null, null, 5),
  ('b0000000-0000-4000-8000-000000000006', 'Bono 10 clases dirigidas', '10 sesiones de actividades dirigidas. Validez 6 meses.', 'BONO', 10, 'DIRIGIDA', 6, true, '{}', null, null, 6),
  ('b0000000-0000-4000-8000-000000000007', 'Bono 10 Reformer', '10 sesiones de Reformer. Validez 6 meses.', 'BONO', 10, 'REFORMER', 6, true, '{}', null, null, 7),
  ('b0000000-0000-4000-8000-000000000008', 'Clase suelta (CS)', 'Una sesión individual, sin compromiso. Se gestiona en recepción.', 'CLASE_SUELTA', null, null, null, false, '{}', 0, null, 8)
on conflict (id) do nothing;

insert into public.tarifa_cupos (tarifa_id, categoria, sesiones_semana) values
  ('b0000000-0000-4000-8000-000000000001', 'DIRIGIDA', 2),
  ('b0000000-0000-4000-8000-000000000002', 'DIRIGIDA', 3),
  ('b0000000-0000-4000-8000-000000000003', 'REFORMER', 2),
  ('b0000000-0000-4000-8000-000000000004', 'REFORMER', 3),
  ('b0000000-0000-4000-8000-000000000005', 'REFORMER', 1),
  ('b0000000-0000-4000-8000-000000000005', 'DIRIGIDA', 1)
on conflict do nothing;

-- Trabajadores de ejemplo (sin user_id: se vinculan al invitar a cada uno por email en Auth)
insert into public.trabajadores (id, nombre, apellidos, email, telefono, rol, es_monitor, color) values
  ('c0000000-0000-4000-8000-000000000001', 'José Diego', 'Frutos',   'josediego@fisioterapianuevopalmar.com', '968 885 931', 'ADMIN',     true,  '#3A3A3A'),
  ('c0000000-0000-4000-8000-000000000002', 'Ana',        'Martínez', 'ana@fisioterapianuevopalmar.com',       '',            'MONITOR',   true,  '#3B82C4'),
  ('c0000000-0000-4000-8000-000000000003', 'Laura',      'Pérez',    'recepcion@fisioterapianuevopalmar.com', '',            'RECEPCION', false, '#C9713F')
on conflict (id) do nothing;

insert into public.trabajador_permisos (trabajador_id, permiso)
select 'c0000000-0000-4000-8000-000000000001'::uuid, unnest(enum_range(null::public.permiso))  -- ADMIN: todos (explícitos además de implícitos)
union all
select 'c0000000-0000-4000-8000-000000000002'::uuid, unnest(array['CLIENTES_VER', 'CLINICA_VER', 'RESERVAS_GESTIONAR', 'CLASES_SUELTAS', 'AVISOS_ENVIAR', 'ASISTENCIA_REGISTRAR']::public.permiso[])
union all
select 'c0000000-0000-4000-8000-000000000003'::uuid, unnest(array['CLIENTES_EDITAR', 'CLIENTES_VER', 'RESERVAS_GESTIONAR', 'CLASES_SUELTAS', 'AVISOS_ENVIAR', 'ESTADISTICAS_VER']::public.permiso[])
on conflict do nothing;

-- Horario semanal (duración 55 min). dia_semana: 1 = lunes … 7 = domingo.
insert into public.plantillas_clase (id, actividad_id, dia_semana, hora_inicio, duracion_min, monitor_id, plazas) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 1, '09:00', 55, 'c0000000-0000-4000-8000-000000000002', 10), -- lun 09:00 suelo
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 3, '09:00', 55, 'c0000000-0000-4000-8000-000000000002', 10), -- mié 09:00 suelo
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 5, '09:00', 55, 'c0000000-0000-4000-8000-000000000002', 10), -- vie 09:00 suelo
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004', 1, '10:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- lun 10:00 reformer
  ('d0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000004', 3, '10:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- mié 10:00 reformer
  ('d0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000004', 5, '10:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- vie 10:00 reformer
  ('d0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000002', 2, '11:00', 55, 'c0000000-0000-4000-8000-000000000001', 8),  -- mar 11:00 espalda
  ('d0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000002', 4, '11:00', 55, 'c0000000-0000-4000-8000-000000000001', 8),  -- jue 11:00 espalda
  ('d0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000004', 2, '17:00', 55, 'c0000000-0000-4000-8000-000000000002', 4),  -- mar 17:00 reformer
  ('d0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000004', 4, '17:00', 55, 'c0000000-0000-4000-8000-000000000002', 4),  -- jue 17:00 reformer
  ('d0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 1, '18:00', 55, 'c0000000-0000-4000-8000-000000000002', 10), -- lun 18:00 suelo
  ('d0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 3, '18:00', 55, 'c0000000-0000-4000-8000-000000000002', 10), -- mié 18:00 suelo
  ('d0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', 2, '18:00', 55, 'c0000000-0000-4000-8000-000000000001', 10), -- mar 18:00 suelo
  ('d0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000001', 4, '18:00', 55, 'c0000000-0000-4000-8000-000000000001', 10), -- jue 18:00 suelo
  ('d0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000004', 1, '19:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- lun 19:00 reformer
  ('d0000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000004', 3, '19:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- mié 19:00 reformer
  ('d0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000004', 5, '19:00', 55, 'c0000000-0000-4000-8000-000000000001', 4),  -- vie 19:00 reformer
  ('d0000000-0000-4000-8000-000000000018', 'a0000000-0000-4000-8000-000000000003', 2, '20:00', 55, 'c0000000-0000-4000-8000-000000000002', 8),  -- mar 20:00 hipopresivos
  ('d0000000-0000-4000-8000-000000000019', 'a0000000-0000-4000-8000-000000000003', 4, '20:00', 55, 'c0000000-0000-4000-8000-000000000002', 8),  -- jue 20:00 hipopresivos
  ('d0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000004', 6, '11:00', 55, 'c0000000-0000-4000-8000-000000000001', 4)   -- sáb 11:00 reformer
on conflict (id) do nothing;

insert into public.auditoria (actor_nombre, accion, entidad, entidad_id, detalle)
values ('Sistema', 'SEED', 'db', '-', 'Datos iniciales cargados');
