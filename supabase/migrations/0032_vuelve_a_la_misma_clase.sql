-- =============================================================================
-- 0032_vuelve_a_la_misma_clase.sql · Volver a una clase anula su cancelación
--
--   Lo que pasaba: si a un alumno se le quitaba de una clase (o la cancelaba él) y después
--   volvía a esa MISMA clase (por ejemplo, se le apuntó con el modo equivocado, se le quitó y se
--   le volvió a apuntar bien), la cancelación seguía saliendo en la ficha de la clase y, si le
--   había dado una recuperación, la conservaba aunque al final iba a la clase: una clase de más.
--
--   Ahora, para TODOS los alumnos y venga de donde venga la reserva (la app del alumno, el
--   personal, la lista de espera): cuando un alumno queda apuntado a una clase, la recuperación
--   que le dio cancelar esa misma clase se anula si no la ha usado (si ya la usó, se queda).
--   La app deja de enseñar en "Cancelaciones" a quien está apuntado otra vez.
--   Además corrige, una vez, los casos que ya hubiera. Idempotente.
-- =============================================================================

-- p_excepto: la recuperación con la que vuelve a esa clase (si vuelve usándola, se gasta, no se anula).
create or replace function public._anular_recuperacion_misma_clase(p_cliente_id uuid, p_clase_id uuid, p_excepto uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with b as (
    delete from public.recuperaciones x
     where x.cliente_id = p_cliente_id and x.estado = 'DISPONIBLE' and x.id is distinct from p_excepto
       and x.reserva_origen_id in (select r.id from public.reservas r
                                    where r.clase_id = p_clase_id and r.cliente_id = p_cliente_id and r.estado <> 'RESERVADA')
    returning x.id
  ) select count(*) into v_n from b;
  if v_n > 0 then
    perform public._auditar('ANULAR_RECUPERACION', 'cliente', p_cliente_id::text,
      format('%s · %s: vuelve a la clase que canceló; la recuperación que le dio queda anulada', public._nombre_cliente(p_cliente_id), public._desc_clase(p_clase_id)));
  end if;
  return v_n;
end $$;
revoke all on function public._anular_recuperacion_misma_clase(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.trg_reservas_vuelve()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'RESERVADA' and (tg_op = 'INSERT' or old.estado is distinct from 'RESERVADA') then
    perform public._anular_recuperacion_misma_clase(new.cliente_id, new.clase_id, new.recuperacion_usada_id);
  end if;
  return null;
end $$;
drop trigger if exists reservas_vuelve on public.reservas;
create trigger reservas_vuelve after insert or update of estado on public.reservas
  for each row execute function public.trg_reservas_vuelve();

-- Los casos que ya hubiera: alumno apuntado a una clase con una recuperación sin usar que salió de cancelar esa misma clase.
do $$
declare r record; v_total integer := 0;
begin
  for r in
    select distinct a.cliente_id, a.clase_id
      from public.reservas a
      join public.reservas c on c.clase_id = a.clase_id and c.cliente_id = a.cliente_id and c.estado <> 'RESERVADA'
      join public.recuperaciones x on x.reserva_origen_id = c.id and x.estado = 'DISPONIBLE'
     where a.estado = 'RESERVADA'
  loop
    v_total := v_total + public._anular_recuperacion_misma_clase(r.cliente_id, r.clase_id);
  end loop;
  raise notice 'Recuperaciones anuladas por volver a la misma clase: %', v_total;
end $$;
