-- =============================================================================
-- 0030_nombres_de_cobros.sql · Los cobros se llaman por su mes
--
--   Los cobros creados antes de la 0029 se llamaban "Mes 1 · octubre 2026" o
--   "Renovación · noviembre 2026". Como ahora cada cobro lleva su mes (pagos.mes), el nombre
--   pasa a ser el mes a secas: "Octubre 2026", "Noviembre 2026". Los cobros con otro nombre
--   (un bono, un material…) no se tocan. Idempotente: se puede ejecutar varias veces.
-- =============================================================================
update public.pagos
   set concepto = initcap((array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from mes)::int]) || ' ' || extract(year from mes)::int
 where lower(concepto) ~ '^(mes \d+|renovación) · [a-záéíóú]+ \d{4}$';
