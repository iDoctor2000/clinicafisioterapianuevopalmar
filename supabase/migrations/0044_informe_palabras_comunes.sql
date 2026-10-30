-- =============================================================================
-- 0044_informe_palabras_comunes.sql · El informe no tapa palabras normales que coinciden con un nombre
--
--   El informe de Telegram tapa los nombres de las personas con sus iniciales. Una ficha de pruebas
--   se llama «Cliente», así que en los mensajes salía «El C. ya tiene plaza» en vez de «El cliente…».
--   Ahora un nombre suelto (sin apellidos) que es además una palabra de la app no se tapa; el nombre
--   completo sí, siempre. Idempotente.
-- =============================================================================

create or replace function public._anonimizar(p_texto text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v text := coalesce(p_texto, '');
  r record;
  -- Palabras de los mensajes de la app que no se tapan aunque alguien se llame así.
  v_comunes text[] := array['cliente', 'clientes', 'alumno', 'alumna', 'alumnos', 'clase', 'clases', 'prueba', 'pruebas',
                            'monitor', 'monitora', 'centro', 'equipo', 'tarifa', 'reserva', 'plaza', 'franja', 'aviso'];
begin
  if v = '' then return v; end if;
  v := regexp_replace(v, '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[correo]', 'g');
  for r in
    select n, i from (
      select trim(nombre || ' ' || apellidos) as n, upper(left(trim(nombre), 1)) || '.' || upper(left(trim(apellidos), 1)) || '.' as i from public.clientes
      union all select trim(nombre), upper(left(trim(nombre), 1)) || '.' from public.clientes where length(trim(nombre)) > 2 and lower(trim(nombre)) <> all (v_comunes)
      union all select trim(nombre || ' ' || apellidos), upper(left(trim(nombre), 1)) || '.' || upper(left(trim(apellidos), 1)) || '.' from public.trabajadores
      union all select trim(nombre), upper(left(trim(nombre), 1)) || '.' from public.trabajadores where length(trim(nombre)) > 2 and lower(trim(nombre)) <> all (v_comunes)
    ) x
    where length(n) >= 3
    order by length(n) desc
  loop
    if position(lower(r.n) in lower(v)) > 0 then
      v := regexp_replace(v, '\m' || regexp_replace(r.n, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M', r.i, 'gi');
    end if;
  end loop;
  return v;
end $$;
revoke all on function public._anonimizar(text) from public, anon, authenticated;
