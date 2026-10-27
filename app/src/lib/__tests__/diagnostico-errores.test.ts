/** 0035: qué se manda al servidor y qué no. */
import { afterEach, describe, expect, it } from 'vitest';
import { alRegistrarError, registrar, type ErrorParaServidor } from '@/lib/diagnostico';

describe('errores al servidor', () => {
  afterEach(() => alRegistrarError(null));

  it('manda el mensaje rojo, la acción fallida y los fallos de la app, una sola vez cada uno', () => {
    const enviados: ErrorParaServidor[] = [];
    alRegistrarError((e) => enviados.push(e));
    registrar('comando', 'reservar FALLIDO (120 ms): No quedan plazas libres. (prueba 1)');
    registrar('aviso', 'Mensaje de error en pantalla: No quedan plazas libres. (prueba 1)'); // el mismo texto: no se repite
    registrar('aviso', 'Mensaje de error en pantalla: Otro error distinto (prueba 1)');
    registrar('error', 'Error JS: x is undefined (prueba 1)', { archivo: 'a.js' });
    registrar('comando', 'reservar correcto (80 ms)');
    registrar('info', 'App en primer plano');
    registrar('error', 'console.error: algo de una librería');
    registrar('aviso', 'Mensaje de error en pantalla: Otro error distinto (prueba 1)'); // repetido enseguida: no
    expect(enviados.map((e) => e.tipo)).toEqual(['accion', 'pantalla', 'fallo']);
    expect(enviados[0].mensaje).toBe('reservar: No quedan plazas libres. (prueba 1)');
    expect(enviados[2].detalle).toContain('a.js');
  });

  it('sin servidor no manda nada y un fallo al mandar no rompe nada', () => {
    registrar('aviso', 'Mensaje de error en pantalla: sin servidor (prueba 2)');
    alRegistrarError(() => { throw new Error('sin red'); });
    expect(() => registrar('aviso', 'Mensaje de error en pantalla: con fallo al mandar (prueba 2)')).not.toThrow();
  });
});
