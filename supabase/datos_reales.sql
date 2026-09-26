-- =============================================================================
-- Datos reales de Nuevo Palmar Pilates: actividades, horario semanal y tarifas 2026.
-- Sustituye el horario y las tarifas de ejemplo. Seguro de ejecutar antes de
-- tener clientes: solo borra clases sin reservas.
--
-- ANTES DE EJECUTAR: cambia el email de María en la línea v_email_maria.
-- =============================================================================
do $$
declare
  v_email_maria text := 'PON-AQUI-EL-EMAIL-DE-MARIA';
  v_irene  uuid;
  v_maria  uuid;
  -- actividades
  a_reformer uuid; a_reformer_hipo uuid; a_suelo uuid; a_funcional uuid; a_barre uuid;
  a_hatha uuid; a_yogaflow uuid; a_core uuid; a_geronto uuid;
  -- tarifas
  t_dir1 uuid; t_dir2 uuid; t_dir3 uuid; t_ref2 uuid; t_ref3 uuid; t_mixta uuid;
  t_bono_d uuid; t_bono_r uuid; t_cs_d uuid; t_cs_r uuid;
  r record;
begin
  if position('@' in v_email_maria) = 0 then
    raise exception 'Escribe el email de María en la línea v_email_maria antes de ejecutar.';
  end if;

  -- ---------------------------------------------------------------- monitores
  select id into v_irene from public.trabajadores where lower(email) = 'danzarte8@gmail.com';
  if v_irene is null then raise exception 'No se encuentra a Irene (danzarte8@gmail.com) en trabajadores.'; end if;
  update public.trabajadores set es_monitor = true where id = v_irene;

  select id into v_maria from public.trabajadores where lower(email) = lower(v_email_maria);
  if v_maria is null then
    insert into public.trabajadores (nombre, apellidos, email, rol, es_monitor, color, activo)
    values ('María', '', v_email_maria, 'MONITOR', true, '#3B82C4', true)
    returning id into v_maria;
    insert into public.trabajador_permisos (trabajador_id, permiso)
    select v_maria, unnest(array['CLIENTES_VER', 'CLINICA_VER', 'RESERVAS_GESTIONAR', 'CLASES_SUELTAS', 'AVISOS_ENVIAR', 'ASISTENCIA_REGISTRAR']::public.permiso[])
    on conflict do nothing;
    -- Si ya tenía usuario de acceso creado con ese email, vincularlo.
    update public.trabajadores t set user_id = u.id from auth.users u
     where t.id = v_maria and t.user_id is null and lower(u.email) = lower(v_email_maria);
  end if;

  -- ---------------------------------------------------------------- horario anterior (solo si no hay reservas)
  if exists (select 1 from public.reservas) then
    raise exception 'Ya hay reservas: no se puede sustituir el horario automáticamente. Edítalo desde la app.';
  end if;
  delete from public.clases;
  delete from public.plantillas_clase;

  -- ---------------------------------------------------------------- actividades
  update public.actividades set activa = false where nombre in ('Espalda sana', 'Hipopresivos');
  update public.actividades set nombre = 'Suelo', descripcion = 'Pilates suelo e implementos: control postural, core y movilidad. Grupos de 8 personas.', orden = 1
   where nombre = 'Pilates suelo';
  update public.actividades set descripcion = 'Pilates en máquina Reformer y torre. Grupos de 6 personas con supervisión individualizada.', orden = 10
   where nombre = 'Reformer';

  select id into a_suelo from public.actividades where nombre = 'Suelo';
  select id into a_reformer from public.actividades where nombre = 'Reformer';

  insert into public.actividades (nombre, categoria, descripcion, color, orden) values
    ('Reformer + Hipopresivos', 'REFORMER', 'Sesión de Reformer combinada con técnicas hipopresivas.', '#5B9BD5', 11),
    ('Funcional', 'DIRIGIDA', 'Entrenamiento funcional dirigido: fuerza, movilidad y coordinación.', '#7FB356', 2),
    ('Barré', 'DIRIGIDA', 'Trabajo de barra inspirado en la danza: tono, postura y equilibrio.', '#C9713F', 3),
    ('Hatha Yoga', 'DIRIGIDA', 'Yoga suave centrado en posturas, respiración y relajación.', '#A3CB80', 4),
    ('Yoga Flow', 'DIRIGIDA', 'Yoga dinámico encadenando posturas con la respiración.', '#8FBF6A', 5),
    ('Core & Stretch', 'DIRIGIDA', 'Fortalecimiento del centro y estiramientos guiados.', '#D95A6A', 6),
    ('Gerontopilates', 'DIRIGIDA', 'Pilates adaptado a personas mayores: movilidad, equilibrio y fuerza segura.', '#8C4A3A', 7)
  on conflict do nothing;

  select id into a_reformer_hipo from public.actividades where nombre = 'Reformer + Hipopresivos';
  select id into a_funcional from public.actividades where nombre = 'Funcional';
  select id into a_barre from public.actividades where nombre = 'Barré';
  select id into a_hatha from public.actividades where nombre = 'Hatha Yoga';
  select id into a_yogaflow from public.actividades where nombre = 'Yoga Flow';
  select id into a_core from public.actividades where nombre = 'Core & Stretch';
  select id into a_geronto from public.actividades where nombre = 'Gerontopilates';

  -- ---------------------------------------------------------------- horario semanal (1 = lunes … 6 = sábado)
  -- Reformer: 6 plazas. Resto: 8 plazas. Duración 55 min.
  -- Monitora: María en las clases de yoga; Irene en el resto (se cambia desde la app en Horarios).
  for r in
    select * from (values
      -- Mañanas
      (1, '09:30', a_reformer),      (2, '09:30', a_suelo),      (3, '09:30', a_reformer_hipo), (4, '09:30', a_suelo),    (5, '09:30', a_hatha),
      (1, '10:30', a_suelo),         (2, '10:30', a_reformer),   (3, '10:30', a_funcional),     (4, '10:30', a_reformer), (6, '10:30', a_reformer),
      (1, '11:30', a_geronto),                                   (3, '11:30', a_geronto),                                 (5, '11:30', a_reformer),
      -- Tardes
      (1, '17:00', a_suelo),         (2, '17:00', a_barre),      (3, '17:00', a_suelo),         (4, '17:00', a_yogaflow), (5, '17:00', a_core),
      (1, '18:00', a_reformer),      (2, '18:00', a_suelo),      (3, '18:00', a_reformer),      (4, '18:00', a_funcional),(5, '18:00', a_reformer),
      (1, '19:00', a_reformer_hipo), (2, '19:00', a_reformer),   (3, '19:00', a_reformer),      (4, '19:00', a_reformer),
      (1, '20:00', a_funcional),     (2, '20:00', a_reformer),   (3, '20:00', a_suelo),         (4, '20:00', a_reformer)
    ) as h(dia, hora, actividad_id)
  loop
    insert into public.plantillas_clase (actividad_id, dia_semana, hora_inicio, duracion_min, monitor_id, plazas)
    select r.actividad_id, r.dia, r.hora::time, 55,
           case when r.actividad_id in (a_hatha, a_yogaflow) then v_maria else v_irene end,
           case when a.categoria = 'REFORMER' then 6 else 8 end
    from public.actividades a where a.id = r.actividad_id;
  end loop;

  -- ---------------------------------------------------------------- tarifas 2026 (precios en céntimos)
  update public.tarifas set activa = false;  -- se reactivan/crean las reales a continuación

  select id into t_dir2 from public.tarifas where nombre like 'Dirigidas · 2%';
  select id into t_dir3 from public.tarifas where nombre like 'Dirigidas · 3%';
  select id into t_ref2 from public.tarifas where nombre like 'Reformer · 2%';
  select id into t_ref3 from public.tarifas where nombre like 'Reformer · 3%';
  select id into t_mixta from public.tarifas where nombre like 'Mixta%';
  select id into t_bono_d from public.tarifas where nombre like 'Bono 10 clases dirigidas%';
  select id into t_bono_r from public.tarifas where nombre like 'Bono 10 Reformer%';
  select id into t_cs_d from public.tarifas where nombre like 'Clase suelta%' limit 1;

  update public.tarifas set nombre = 'Clases dirigidas · 2 días/semana', activa = true, orden = 2, precio_centimos = 5000,
    descripcion = 'Dos clases semanales de actividades dirigidas (suelo e implementos, funcional, barré, yoga, stretching). 50 €/mes. Oferta trimestral: 65 € + 65 € + mes 3 gratis.'
    where id = t_dir2;
  update public.tarifas set nombre = 'Clases dirigidas · 3 días/semana', activa = true, orden = 3, precio_centimos = 6500,
    descripcion = 'Tres clases semanales de actividades dirigidas. 65 €/mes. Oferta trimestral: 90 € + 90 € + mes 3 gratis.'
    where id = t_dir3;
  update public.tarifas set nombre = 'Reformer + Torre · 2 días/semana', activa = true, orden = 4, precio_centimos = 6500,
    descripcion = 'Dos clases semanales en máquina Reformer y torre. 65 €/mes. Oferta trimestral: 90 € + 90 € + mes 3 gratis.'
    where id = t_ref2;
  update public.tarifas set nombre = 'Reformer + Torre · 3 días/semana', activa = true, orden = 5, precio_centimos = 8500,
    descripcion = 'Tres clases semanales en máquina Reformer y torre. 85 €/mes. Oferta trimestral: 112 € + 112 € + mes 3 gratis.'
    where id = t_ref3;
  update public.tarifas set nombre = 'Pack mixto · 1 dirigida + 1 Reformer', activa = true, orden = 6, precio_centimos = 5800,
    descripcion = 'Una clase dirigida y una clase de Reformer a la semana. 58 €/mes. Oferta trimestral: 80 € + 80 € + mes 3 gratis.'
    where id = t_mixta;
  update public.tarifas set nombre = 'Bono 10D · dirigidas', activa = true, orden = 7, precio_centimos = 9500,
    descripcion = '10 clases dirigidas. 95 €. Validez 6 meses.'
    where id = t_bono_d;
  update public.tarifas set nombre = 'Bono 10R · Reformer', activa = true, orden = 8, precio_centimos = 12000,
    descripcion = '10 clases de Reformer + Torre. 120 €. Validez 6 meses.'
    where id = t_bono_r;
  update public.tarifas set nombre = 'Clase suelta · dirigida', activa = true, orden = 9, precio_centimos = 1200,
    descripcion = 'Una clase dirigida suelta, sin compromiso. 12 €. Se gestiona en recepción.'
    where id = t_cs_d;

  -- 1 día/semana (dirigidas) y clase suelta de Reformer: nuevas
  select id into t_dir1 from public.tarifas where nombre = 'Clases dirigidas · 1 día/semana';
  if t_dir1 is null then
    insert into public.tarifas (nombre, descripcion, tipo, recuperacion_permitida, precio_centimos, activa, orden)
    values ('Clases dirigidas · 1 día/semana', 'Una clase semanal de actividades dirigidas. 35 €/mes. Oferta trimestral: 45 € + 45 € + mes 3 gratis.', 'RECURRENTE', true, 3500, true, 1)
    returning id into t_dir1;
    insert into public.tarifa_cupos (tarifa_id, categoria, sesiones_semana) values (t_dir1, 'DIRIGIDA', 1);
  end if;
  select id into t_cs_r from public.tarifas where nombre = 'Clase suelta · Reformer';
  if t_cs_r is null then
    insert into public.tarifas (nombre, descripcion, tipo, recuperacion_permitida, recuperacion_max_pendientes, precio_centimos, activa, orden)
    values ('Clase suelta · Reformer', 'Una clase de Reformer + Torre suelta, sin compromiso. 15 €. Se gestiona en recepción.', 'CLASE_SUELTA', false, 0, 1500, true, 10);
  end if;

  -- ---------------------------------------------------------------- clases de las próximas semanas
  perform public.mantenimiento_diario();
  raise notice 'Horario, actividades y tarifas reales cargados. María imparte las clases de yoga; Irene el resto.';
end $$;
