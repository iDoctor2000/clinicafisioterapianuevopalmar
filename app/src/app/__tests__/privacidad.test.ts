/** La página de privacidad se genera desde docs/PRIVACIDAD.md: comprobamos que el mini-renderizador lo cubre. */
import { describe, expect, it } from 'vitest';
import politicaMd from '../../../../docs/PRIVACIDAD.md?raw';
import { lineasConsentimiento, parsearMarkdown } from '../Privacidad';
import { VERSION_POLITICA_PRIVACIDAD } from '@/domain/privacidad';

describe('docs/PRIVACIDAD.md', () => {
  const bloques = parsearMarkdown(politicaMd);
  it('se parsea en títulos, párrafos, listas, citas, una tabla y separadores', () => {
    const tipos = new Set(bloques.map((b) => b.tipo));
    expect([...tipos].sort()).toEqual(['cita', 'h1', 'h2', 'hr', 'lista', 'p', 'tabla']);
    expect(bloques[0]).toEqual({ tipo: 'h1', lineas: ['Política de privacidad y protección de datos'] });
    const tabla = bloques.find((b) => b.tipo === 'tabla');
    expect(tabla && tabla.tipo === 'tabla' && tabla.cabecera).toEqual(['Tipo de dato', 'Ejemplos', 'Quién lo introduce']);
    expect(tabla && tabla.tipo === 'tabla' && tabla.filas.length).toBe(7);
    expect(bloques.filter((b) => b.tipo === 'h2').length).toBe(13);
    // Ninguna línea del documento se pierde en el parseo (todo el texto queda en algún bloque).
    const texto = bloques.flatMap((b) => (b.tipo === 'hr' ? [] : b.tipo === 'lista' ? b.items : b.tipo === 'tabla' ? [...b.cabecera, ...b.filas.flat()] : b.lineas)).join('\n');
    expect(texto).toContain('www.aepd.es');
    expect(texto).toContain('Firma y fecha');
    expect(texto).toContain('[Razón social de la clínica]');
  });
  it('el texto de consentimiento es la cita de la sección "Texto de consentimiento"', () => {
    const lineas = lineasConsentimiento();
    expect(lineas.length).toBe(1);
    expect(lineas[0]).toMatch(/^He leído la \*\*política de privacidad\*\* y \*\*consiento\*\*/);
  });
  it('la versión de la política coincide con la fecha de "Última actualización" del .md', () => {
    expect(politicaMd).toContain('Última actualización: 27 de septiembre de 2026');
    expect(VERSION_POLITICA_PRIVACIDAD).toBe('2026-09-27');
  });
});
