import { describe, expect, it } from 'vitest';
import { mensajeError } from '../cliente';

describe('mensajeError', () => {
  it('traduce la sesión caducada (JWT) y la petición sin sesión (permission denied) al mismo aviso', () => {
    const esperado = 'Tu sesión ha caducado. Vuelve a entrar.';
    expect(mensajeError({ message: 'JWT expired' })).toBe(esperado);
    expect(mensajeError({ message: 'Invalid Refresh Token: Already Used' })).toBe(esperado);
    // Lo que vio una alumna al guardar su perfil: la petición salió con la clave anónima.
    expect(mensajeError({ message: 'permission denied for table clientes', code: '42501' })).toBe(esperado);
  });

  it('traduce los fallos de red y deja pasar el resto de mensajes', () => {
    expect(mensajeError(new TypeError('Failed to fetch'))).toMatch(/conexión/);
    expect(mensajeError({ message: 'No quedan plazas.' })).toBe('No quedan plazas.');
    expect(mensajeError(null)).toBe('Se ha producido un error inesperado.');
  });
});
