-- =============================================================================
-- 0040_cobro_pagado_sustituye_pendiente.sql · Un cobro pagado de un mes sustituye al pendiente de ese mes
--
--   Caso real: el plan de la contratación deja "Noviembre · por cobrar"; al cobrar noviembre
--   con otra forma de pago se apunta un cobro nuevo ("Añadir cobro") y el pendiente se queda,
--   así que el alumno aparece con dos cobros de noviembre (uno cobrado y otro por cobrar).
--
--   Regla general: cuando se apunta (o se marca) como PAGADO un cobro de un mes, los cobros
--   PENDIENTES del mismo alumno y mes cuyo importe no supere el pagado sobran y se quitan
--   (si el pagado es menor, el pendiente se queda: es un pago parcial). Lo cobrado nunca se toca.
--   Limpieza de los que ya haya. Idempotente.
-- =============================================================================

create or replace function public.trg_pagos_pagado_sustituye()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if new.estado <> 'PAGADO' then return null; end if;
  if tg_op = 'UPDATE' and old.estado = 'PAGADO' and old.mes = new.mes and old.importe_centimos = new.importe_centimos then return null; end if;
  with b as (
    delete from public.pagos p
     where p.cliente_id = new.cliente_id and p.mes = new.mes and p.id <> new.id
       and p.estado = 'PENDIENTE' and p.importe_centimos <= new.importe_centimos
    returning p.id
  ) select count(*) into v_n from b;
  if v_n > 0 then
    perform public._auditar('COBRO_PENDIENTE_SUSTITUIDO', 'pago', new.id::text,
      format('%s: %s cobro(s) pendiente(s) de %s quitado(s) al apuntar el cobrado (%s)', public._nombre_cliente(new.cliente_id), v_n, to_char(new.mes, 'MM/YYYY'), new.concepto));
  end if;
  return null;
end $$;
comment on function public.trg_pagos_pagado_sustituye() is 'Un cobro pagado de un mes quita los pendientes de ese mes del mismo alumno que no superen su importe (0040).';
drop trigger if exists pagos_pagado_sustituye on public.pagos;
create trigger pagos_pagado_sustituye after insert or update of estado, mes, importe_centimos on public.pagos
  for each row execute function public.trg_pagos_pagado_sustituye();

-- Limpieza de lo que ya hay: pendientes de un mes que el alumno ya tiene cobrado (por un importe igual o mayor).
do $$
declare r record; v_total integer := 0;
begin
  for r in
    select p.id, p.cliente_id, p.mes, p.concepto
      from public.pagos p
     where p.estado = 'PENDIENTE'
       and exists (select 1 from public.pagos q where q.cliente_id = p.cliente_id and q.mes = p.mes and q.estado = 'PAGADO' and q.importe_centimos >= p.importe_centimos)
  loop
    delete from public.pagos where id = r.id;
    perform public._auditar('COBRO_PENDIENTE_SUSTITUIDO', 'pago', r.id::text,
      format('%s: pendiente de %s (%s) quitado: ese mes ya estaba cobrado · 0040', public._nombre_cliente(r.cliente_id), to_char(r.mes, 'MM/YYYY'), r.concepto));
    v_total := v_total + 1;
  end loop;
  raise notice '0040: % cobros pendientes de meses ya cobrados quitados.', v_total;
end $$;
