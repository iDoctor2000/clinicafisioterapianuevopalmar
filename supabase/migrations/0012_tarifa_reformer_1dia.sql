-- =============================================================================
-- 0012_tarifa_reformer_1dia.sql · Nueva tarifa "Reformer + Torre · 1 día/semana"
--
--   El centro quiere ofrecer una clase semanal de Reformer. Hasta ahora las tarifas de
--   Reformer empezaban en 2 días/semana, así que al contratar "1 día/semana" (dirigidas)
--   no aparecía ninguna franja de Reformer. Se crea la tarifa (RECURRENTE, cupo REFORMER 1)
--   si no existe. El precio queda "a consultar" (NULL): el administrador lo pone desde
--   Más → Tarifas y la web lo muestra al momento.
--   Se puede ejecutar varias veces sin problema.
-- =============================================================================

do $$
declare
  t_id uuid;
begin
  select id into t_id from public.tarifas where nombre = 'Reformer + Torre · 1 día/semana';
  if t_id is null then
    -- Hueco en el orden: va justo delante de "Reformer + Torre · 2 días/semana".
    update public.tarifas set orden = orden + 1 where orden >= 4;
    insert into public.tarifas (nombre, descripcion, tipo, recuperacion_permitida, precio_centimos, activa, orden)
    values ('Reformer + Torre · 1 día/semana',
            'Una clase semanal de Reformer con torre: clases especializadas con máquina. Precio: consultar en el centro.',
            'RECURRENTE', true, null, true, 4)
    returning id into t_id;
    insert into public.tarifa_cupos (tarifa_id, categoria, sesiones_semana) values (t_id, 'REFORMER', 1);
  end if;
end $$;
