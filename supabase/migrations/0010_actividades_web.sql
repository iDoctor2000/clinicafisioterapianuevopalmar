-- =============================================================================
-- 0010_actividades_web.sql · Una sola fuente para la web y la app
--
--   · `actividades` gana los campos que la web pública necesita y que el administrador
--     edita desde la app (Tarifas → Actividades): nombre largo para la web, duración
--     por defecto, frase final (lema), descripción larga, icono y foto.
--   · `config_centro` gana los datos de contacto del centro de Pilates (dirección,
--     teléfono, WhatsApp, Instagram, correo), editables en Ajustes y mostrados en la web.
--   · Lectura PÚBLICA (anon) de actividades activas, tarifas activas y config_centro:
--     la web los muestra sin sesión. La escritura no cambia (solo con permisos).
--   · Datos reales 2026: las nueve actividades del cartel con sus textos e iconos,
--     tarifas con precios y ofertas trimestrales, contacto del centro y fotos de la
--     portada de la app (si aún no hay ninguna).
--
-- Espejo de app/src/domain/types.ts (Actividad, ConfigCentro) y app/src/data/supabase/mapeo.ts.
-- Idempotente: se puede volver a ejecutar sin efectos secundarios.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas nuevas
-- -----------------------------------------------------------------------------
alter table public.actividades
  add column if not exists nombre_web        text not null default '',
  add column if not exists duracion_min      integer not null default 55 check (duracion_min between 10 and 240),
  add column if not exists lema              text not null default '',
  add column if not exists descripcion_larga text not null default '',
  add column if not exists icono             text not null default '',
  add column if not exists foto_url          text not null default '';
comment on column public.actividades.nombre_web is 'Nombre completo para la web pública (p. ej. "Pilates Reformer con Torre"). Vacío = usar nombre.';
comment on column public.actividades.duracion_min is 'Duración por defecto de una clase (minutos). Se usa al crear franjas y se muestra en la web.';
comment on column public.actividades.lema is 'Frase final de la actividad ("Siente el ritmo").';
comment on column public.actividades.descripcion_larga is 'Descripción completa para la web y la ficha de la actividad en la app.';
comment on column public.actividades.icono is 'Clave de un icono incluido (reformer, suelo, funcional, geronto, barre, yoga-flow, hatha-yoga, core-stretch, hipopresivos) o URL de una imagen subida.';
comment on column public.actividades.foto_url is 'URL pública de una foto opcional de la actividad.';

alter table public.config_centro
  add column if not exists direccion  text not null default '',
  add column if not exists telefono   text not null default '',
  add column if not exists whatsapp   text not null default '',
  add column if not exists instagram  text not null default '',
  add column if not exists email      text not null default '';
comment on column public.config_centro.direccion is 'Dirección del centro de Pilates (se muestra en la web).';
comment on column public.config_centro.whatsapp is 'Número de WhatsApp con prefijo y sin espacios (34620600591). Vacío = sin WhatsApp.';

-- -----------------------------------------------------------------------------
-- 2. Lectura pública para la web (anon): actividades y tarifas activas, config.
-- -----------------------------------------------------------------------------
grant select on public.actividades, public.tarifas, public.tarifa_cupos, public.config_centro to anon;
drop policy if exists actividades_leer_web on public.actividades;
create policy actividades_leer_web on public.actividades for select to anon using (activa);
drop policy if exists tarifas_leer_web on public.tarifas;
create policy tarifas_leer_web on public.tarifas for select to anon using (activa);
drop policy if exists tarifa_cupos_leer_web on public.tarifa_cupos;
create policy tarifa_cupos_leer_web on public.tarifa_cupos for select to anon
  using (exists (select 1 from public.tarifas t where t.id = tarifa_id and t.activa));
drop policy if exists config_leer_web on public.config_centro;
create policy config_leer_web on public.config_centro for select to anon using (true);

-- Tiempo real para la web (si existe la publicación)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    for t in select unnest(array['actividades', 'tarifas', 'config_centro']) loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
exception when others then
  raise notice '0010: no se ha podido ampliar supabase_realtime (%). Se continúa.', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Datos reales 2026 (solo si existe el catálogo real; en pruebas locales se omite
--    lo que no encaje). Cada bloque es idempotente: actualiza por nombre.
-- -----------------------------------------------------------------------------
-- Función temporal (solo vive en esta sesión) para crear o actualizar una actividad por nombre.
create or replace function pg_temp.act(p_nombre text, p_nombre_web text, p_categoria public.categoria, p_min integer, p_lema text, p_desc text, p_larga text, p_icono text, p_orden integer, p_color text)
returns void language plpgsql as $f$
begin
  if exists (select 1 from public.actividades where nombre = p_nombre) then
    update public.actividades set nombre_web = p_nombre_web, duracion_min = p_min, lema = p_lema, descripcion = p_desc,
      descripcion_larga = p_larga, icono = p_icono, orden = p_orden, activa = true, categoria = p_categoria
      where nombre = p_nombre;
  else
    insert into public.actividades (nombre, nombre_web, categoria, duracion_min, lema, descripcion, descripcion_larga, icono, orden, color, activa)
    values (p_nombre, p_nombre_web, p_categoria, p_min, p_lema, p_desc, p_larga, p_icono, p_orden, p_color, true);
  end if;
end
$f$;

do $$
begin
  -- Solo donde está cargado el catálogo real (datos_reales.sql); en una base de pruebas se omite.
  if not exists (select 1 from public.tarifas where nombre = 'Clases dirigidas · 2 días/semana') then
    raise notice '0010: catálogo real no encontrado (datos_reales.sql): se omiten los datos 2026.';
    return;
  end if;

  -- Renombrados respecto a datos_reales.sql
  update public.actividades set nombre = 'Barre' where nombre = 'Barré';
  update public.actividades set nombre = 'Suelo' where nombre = 'Pilates suelo' and not exists (select 1 from public.actividades where nombre = 'Suelo');

  perform pg_temp.act('Reformer', 'Pilates Reformer con Torre', 'REFORMER', 55, 'No te pierdas esta experiencia',
    'Pilates en máquina Reformer con torre. Grupos de 6 personas con supervisión individualizada.',
    'En máquina Reformer con torre, en la que se trabaja de forma global la fuerza, la movilidad, la estabilidad, la coordinación y el control corporal. Se utiliza la resistencia de los muelles para combinar el trabajo de fuerza y movilidad, prestando especial atención a la respiración, la alineación y la precisión del movimiento. Una práctica completa.',
    'reformer', 1, '#3A3A3A');
  perform pg_temp.act('Suelo', 'Pilates Suelo', 'DIRIGIDA', 55, 'Conecta con tu cuerpo a través del Pilates suelo',
    'Pilates sobre colchoneta con el propio peso corporal e implementos. Grupos de 8 personas.',
    'Sesión de Pilates realizada sobre colchoneta, utilizando el propio peso corporal y diferentes implementos para trabajar la fuerza, la movilidad, la estabilidad, la coordinación y el control corporal. A través de ejercicios basados en los principios del método Pilates, se presta especial atención a la respiración, la alineación, la precisión del movimiento y el fortalecimiento de la musculatura profunda. Una práctica completa que busca mejorar la postura, el control corporal y la calidad del movimiento.',
    'suelo', 2, '#86735F');
  perform pg_temp.act('Funcional', 'Pilates Funcional', 'DIRIGIDA', 55, 'Potencia tu fuerza',
    'Pilates dinámico e intenso: fuerza, potencia y resistencia con ejercicios funcionales.',
    'Sesión de Pilates de carácter más dinámico e intenso, orientada principalmente al desarrollo de la fuerza, la potencia y la resistencia. Se incorporan ejercicios funcionales, trabajo pliométrico y diferentes métodos de entrenamiento, como el HIIT o el trabajo por estaciones, adaptando la intensidad y los ejercicios a las características de cada grupo. Una propuesta activa y variada que busca mejorar la condición física y la capacidad de respuesta del cuerpo.',
    'funcional', 3, '#B9A795');
  perform pg_temp.act('Gerontopilates', 'Gerontopilates', 'DIRIGIDA', 55, 'Adapta tu práctica',
    'Pilates adaptado a personas con dificultades o limitaciones de movilidad, con silla como apoyo.',
    'Sesión de Pilates adaptada especialmente a personas con dificultades o limitaciones de movilidad, utilizando una silla convencional como elemento de apoyo y diferentes implementos propios del método Pilates. Una práctica orientada a mantener y mejorar la autonomía, la seguridad en el movimiento y el bienestar corporal.',
    'geronto', 4, '#8C4A3A');
  perform pg_temp.act('Barre', 'Pilates Barre', 'DIRIGIDA', 55, 'Siente el ritmo',
    'Pilates con técnicas de danza y ballet, con la barra como apoyo y al ritmo de la música.',
    'Sesión que combina los principios y ejercicios del Pilates con técnicas procedentes de la danza y el ballet, utilizando la barra como elemento de apoyo. Se trabaja principalmente la fuerza, la estabilidad, la movilidad, la coordinación y el control corporal, incorporando ejercicios realizados al ritmo de la música para desarrollar la musicalidad y la fluidez del movimiento. Una propuesta dinámica que combina entrenamiento, precisión y expresión corporal.',
    'barre', 5, '#C9713F');
  perform pg_temp.act('Yoga Flow', 'Yoga Flow', 'DIRIGIDA', 55, 'El respiro que necesitas',
    'Yoga dinámico: posturas enlazadas de forma fluida y consciente, con respiración y vuelta a la calma.',
    'Sesión de yoga de carácter dinámico en la que se enlazan diferentes posturas y movimientos de forma fluida y consciente. La práctica combina pranayamas o técnicas de respiración, asanas, saludos tradicionales, ejercicios de movilidad y estiramientos, adaptando el ritmo y la intensidad a las características de cada sesión. Se finaliza con una vuelta a la calma que puede incluir pequeñas visualizaciones y momentos de meditación, buscando favorecer la conexión entre respiración, movimiento y atención.',
    'yoga-flow', 6, '#CFC0B0');
  perform pg_temp.act('Hatha Yoga', 'Hatha Yoga', 'DIRIGIDA', 75, 'Respira y conecta',
    'Yoga de ritmo pausado y consciente: asanas, respiración y atención plena. 75 minutos.',
    'Sesión de yoga de ritmo pausado y consciente, centrada en la práctica y mantenimiento de las asanas, la respiración y la atención plena. A través de una práctica progresiva se trabajan la movilidad, la fuerza, el equilibrio, la flexibilidad y la conciencia corporal, respetando el ritmo y las posibilidades de cada persona. La sesión finaliza con un espacio de relajación y calma destinado a favorecer la conexión entre cuerpo, respiración y mente.',
    'hatha-yoga', 7, '#A08D79');
  perform pg_temp.act('Core & Stretch', 'Core & Stretch', 'DIRIGIDA', 55, 'Fortalece el centro, mejora la movilidad y libera tensiones',
    'Trabajo del core con movilidad, elongación y stretching. Fuerza, respiración y suelo pélvico.',
    'Sesión que combina el trabajo del core con ejercicios de movilidad, elongación y stretching, entendiendo el core como el conjunto de estructuras y musculatura que participan en la estabilidad del tronco: musculatura abdominal, musculatura profunda de la espalda, el diafragma y el suelo pélvico. Incorpora ejercicios de fuerza y control abdominal, trabajo respiratorio y diafragmático, activación del suelo pélvico e hipopresivos y estiramientos profundos. Una propuesta completa.',
    'core-stretch', 8, '#D95A6A');
  perform pg_temp.act('Hipopresivos', 'Hipopresivos', 'DIRIGIDA', 20, 'Transforma desde el interior',
    'Trabajo postural, respiratorio y de activación de la musculatura profunda del abdomen y el suelo pélvico. 20 minutos.',
    'Combina trabajo postural, respiratorio y de activación de la musculatura profunda del abdomen y del suelo pélvico, a través de la gestión de las presiones internas, adaptando la práctica a las necesidades y posibilidades de cada persona. Puede realizarse como sesión específica o combinarse con otras actividades, como Pilates Reformer o Core & Stretch.',
    'hipopresivos', 9, '#A08D79');

  -- La franja "Reformer + Hipopresivos" del horario conserva su actividad, con el icono del Reformer.
  update public.actividades set nombre_web = 'Reformer con Torre + Hipopresivos', icono = 'reformer', duracion_min = 55,
    lema = 'Transforma desde el interior', descripcion_larga = 'Sesión de Reformer con torre combinada con técnicas hipopresivas: fuerza, movilidad y control corporal en máquina, con trabajo postural, respiratorio y de activación de la musculatura profunda del abdomen y del suelo pélvico.',
    orden = 10
    where nombre = 'Reformer + Hipopresivos';


  -- ---------------------------------------------------------------- tarifas 2026
  update public.tarifas set precio_centimos = 3500, activa = true, orden = 1,
    descripcion = 'Una clase semanal de actividades dirigidas. 35 €/mes. Oferta trimestral: 45 € (mes 1), 45 € (mes 2), 0 € (mes 3).'
    where nombre = 'Clases dirigidas · 1 día/semana';
  update public.tarifas set precio_centimos = 5000, activa = true, orden = 2,
    descripcion = 'Dos clases semanales de actividades dirigidas: suelo e implementos, funcional, barre, yoga, stretching. 50 €/mes. Oferta trimestral: 65 € (mes 1), 65 € (mes 2), 0 € (mes 3).'
    where nombre = 'Clases dirigidas · 2 días/semana';
  update public.tarifas set precio_centimos = 6500, activa = true, orden = 3,
    descripcion = 'Tres clases semanales de actividades dirigidas. 65 €/mes. Oferta trimestral: 90 € (mes 1), 90 € (mes 2), 0 € (mes 3).'
    where nombre = 'Clases dirigidas · 3 días/semana';
  update public.tarifas set precio_centimos = 6500, activa = true, orden = 4,
    descripcion = 'Dos clases semanales de Reformer con torre: clases especializadas con máquina. 65 €/mes. Oferta trimestral: 90 € (mes 1), 90 € (mes 2), 0 € (mes 3).'
    where nombre = 'Reformer + Torre · 2 días/semana';
  update public.tarifas set precio_centimos = 8500, activa = true, orden = 5,
    descripcion = 'Tres clases semanales de Reformer con torre. 85 €/mes. Oferta trimestral: 112 € (mes 1), 112 € (mes 2), 0 € (mes 3).'
    where nombre = 'Reformer + Torre · 3 días/semana';
  update public.tarifas set precio_centimos = 5800, activa = true, orden = 6,
    descripcion = 'Una clase dirigida y una clase de Reformer a la semana. 58 €/mes. Oferta trimestral: 80 € (mes 1), 30 € (mes 2), 0 € (mes 3). Pregunta por la oferta familiar.'
    where nombre = 'Pack mixto · 1 dirigida + 1 Reformer';
  update public.tarifas set precio_centimos = 9500, activa = true, orden = 7, bono_validez_meses = 6,
    descripcion = 'Bono 10D: 10 sesiones de clases dirigidas. 95 €. Validez 6 meses.'
    where nombre = 'Bono 10D · dirigidas';
  update public.tarifas set precio_centimos = 12000, activa = true, orden = 8, bono_validez_meses = 6,
    descripcion = 'Bono 10R: 10 sesiones de Reformer con torre. 120 €. Validez 6 meses.'
    where nombre = 'Bono 10R · Reformer';
  update public.tarifas set precio_centimos = 1200, activa = true, orden = 9,
    descripcion = 'Una clase dirigida suelta, sin compromiso. 12 €. Se abona en el centro.'
    where nombre = 'Clase suelta · dirigida';
  update public.tarifas set precio_centimos = 1500, activa = true, orden = 10,
    descripcion = 'Una clase de Reformer con torre suelta, sin compromiso. 15 €. Se abona en el centro.'
    where nombre = 'Clase suelta · Reformer';

  -- ---------------------------------------------------------------- contacto del centro de Pilates
  update public.config_centro set
    direccion = 'C/ Artemisa 6, Bajo · 30120 El Palmar (Murcia)',
    telefono  = '620 600 591',
    whatsapp  = '34620600591',
    instagram = '@pilatesnuevopalmar',
    email     = case when email = '' then 'info@fisioterapianuevopalmar.com' else email end
    where id = true and direccion = '';

  -- ---------------------------------------------------------------- fotos de la portada de la app
  -- Rutas relativas a la carpeta de la app (../assets/…): valen con y sin dominio propio.
  if to_regclass('public.portada_imagenes') is not null and not exists (select 1 from public.portada_imagenes) then
    insert into public.portada_imagenes (url, pie, orden, activa) values
      ('../assets/pilates-1.jpg', 'Sala de Reformer', 1, true),
      ('../assets/pilates-2.jpg', 'Sala de clases dirigidas', 2, true),
      ('../assets/pilates-3.jpg', 'Barra y colchonetas', 3, true),
      ('../assets/pilates-5.jpg', 'Recepción', 4, true),
      ('../assets/pilates-4.jpg', 'Nuestro centro en C/ Artemisa 6', 5, true);
  end if;
end $$;
