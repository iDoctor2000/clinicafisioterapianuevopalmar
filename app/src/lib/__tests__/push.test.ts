import { describe, expect, it } from 'vitest';
import { base64UrlAUint8Array, bytesABase64Url } from '../push';

describe('base64url ↔ bytes (claves VAPID y de suscripción)', () => {
  it('convierte una clave base64url sin relleno en los bytes originales', () => {
    // "hello" en base64url es "aGVsbG8" (sin "=")
    expect(Array.from(base64UrlAUint8Array('aGVsbG8'))).toEqual([104, 101, 108, 108, 111]);
  });

  it('acepta los caracteres - y _ propios de base64url', () => {
    // 0xfb 0xff → "+/8=" en base64 estándar → "-_8" en base64url
    expect(Array.from(base64UrlAUint8Array('-_8'))).toEqual([0xfb, 0xff]);
    expect(Array.from(base64UrlAUint8Array('  -_8 '))).toEqual([0xfb, 0xff]);
  });

  it('una clave pública VAPID produce 65 bytes que empiezan por 0x04 (punto P-256 sin comprimir)', () => {
    const clave = 'BD4_wVBxwXNmuDeINZ-KDsQm8h1uJSOJP6zxI6XdZMUtIuciiZglUbYknQC7LUmqmNrh3VW1kIjC_SvW0JmPPA0';
    const bytes = base64UrlAUint8Array(clave);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
    expect(bytesABase64Url(bytes)).toBe(clave);
  });

  it('bytesABase64Url es la inversa y no añade relleno', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const texto = bytesABase64Url(bytes);
    expect(texto).not.toMatch(/[+/=]/);
    expect(Array.from(base64UrlAUint8Array(texto))).toEqual(Array.from(bytes));
    expect(bytesABase64Url(null)).toBe('');
  });
});
