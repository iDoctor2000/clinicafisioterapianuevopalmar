/**
 * leerPaginado: la API de Supabase devuelve como mucho 1000 filas por petición y recorta en
 * silencio. La carga debe pedir página a página hasta que no queden más.
 */
import { describe, expect, it, vi } from 'vitest';
import { leerPaginado, PAGINA, type Consulta } from '@/data/supabase/cargar';

/** Simula una tabla de `total` filas que el servidor sirve de 1000 en 1000. */
function servidorCon(total: number, { tope = PAGINA, conTotal = true } = {}) {
  const peticiones: [number, number][] = [];
  const consulta = (desde: number, hasta: number): Consulta<{ n: number }> => {
    peticiones.push([desde, hasta]);
    // Como la API real: nunca más de `tope` filas por petición, aunque se pidan más.
    const data = Array.from({ length: Math.max(0, Math.min(total, hasta + 1, desde + tope) - desde) }, (_, i) => ({ n: desde + i }));
    return Promise.resolve({ data, error: null, count: conTotal ? total : null });
  };
  return { consulta, peticiones };
}

describe('leerPaginado', () => {
  it('una tabla pequeña se lee en una sola petición', async () => {
    const s = servidorCon(42);
    const filas = await leerPaginado('t', s.consulta);
    expect(filas).toHaveLength(42);
    expect(s.peticiones).toEqual([[0, PAGINA - 1]]);
  });

  it('una tabla grande se lee entera, página a página', async () => {
    const s = servidorCon(2500);
    const filas = await leerPaginado('t', s.consulta);
    expect(filas).toHaveLength(2500);
    expect(filas[0].n).toBe(0);
    expect(filas[2499].n).toBe(2499);
    expect(s.peticiones).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('si la tabla tiene justo 1000 filas y se conoce el total, no pide una página de más', async () => {
    const s = servidorCon(PAGINA);
    const filas = await leerPaginado('t', s.consulta);
    expect(filas).toHaveLength(PAGINA);
    expect(s.peticiones).toHaveLength(1);
  });

  it('si el servidor recorta a menos filas de las esperadas, sigue leyendo hasta el total', async () => {
    const s = servidorCon(1200, { tope: 500 });
    const filas = await leerPaginado('t', s.consulta);
    expect(filas).toHaveLength(1200);
    expect(filas.map((f) => f.n)).toEqual(Array.from({ length: 1200 }, (_, i) => i));
  });

  it('sin el total, se para en la primera página corta', async () => {
    const s = servidorCon(2500, { conTotal: false });
    expect(await leerPaginado('t', s.consulta)).toHaveLength(2500);
    expect(s.peticiones).toHaveLength(3);
  });

  it('respeta el tope de páginas (tablas que solo se consultan en parte)', async () => {
    const s = servidorCon(5000);
    const filas = await leerPaginado('t', s.consulta, 2);
    expect(filas).toHaveLength(2000);
  });

  it('si una página falla, devuelve lo leído y avisa, sin tumbar la carga', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let n = 0;
    const consulta = (): Consulta<{ n: number }> => {
      n += 1;
      if (n === 2) return Promise.resolve({ data: null, error: { message: 'se ha roto' } });
      return Promise.resolve({ data: Array.from({ length: PAGINA }, (_, i) => ({ n: i })), error: null });
    };
    const filas = await leerPaginado('t', consulta);
    expect(filas).toHaveLength(PAGINA);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('página 2'));
    aviso.mockRestore();
  });
});
