/**
 * imagen.ts en jsdom: no hay canvas real ni createImageBitmap, así que se prueban la
 * geometría del recorte, la validación de archivos y la conversión a data URL.
 */
import { describe, expect, it } from 'vitest';
import { blobADataUrl, ErrorImagen, esImagen, MAX_ORIGINAL_BYTES, recorteCuadrado, recortarYReducir } from '@/lib/imagen';

describe('recorteCuadrado', () => {
  it('imagen apaisada: recorta los laterales', () => {
    expect(recorteCuadrado(4000, 3000)).toEqual({ x: 500, y: 0, lado: 3000 });
  });
  it('imagen vertical: recorta arriba y abajo', () => {
    expect(recorteCuadrado(1080, 1920)).toEqual({ x: 0, y: 420, lado: 1080 });
  });
  it('cuadrada: sin recorte', () => {
    expect(recorteCuadrado(256, 256)).toEqual({ x: 0, y: 0, lado: 256 });
  });
});

describe('esImagen', () => {
  it('acepta por tipo MIME o por extensión (HEIC de iPhone a veces llega sin tipo)', () => {
    expect(esImagen(new File([''], 'a.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(esImagen(new File([''], 'IMG_0001.HEIC', { type: '' }))).toBe(true);
    expect(esImagen(new File([''], 'doc.pdf', { type: 'application/pdf' }))).toBe(false);
  });
});

describe('recortarYReducir · validación', () => {
  it('rechaza archivos que no son imágenes', async () => {
    await expect(recortarYReducir(new File(['hola'], 'doc.pdf', { type: 'application/pdf' }))).rejects.toThrow(ErrorImagen);
    await expect(recortarYReducir(new File(['hola'], 'doc.pdf', { type: 'application/pdf' }))).rejects.toThrow('no es una imagen');
  });
  it('rechaza archivos vacíos', async () => {
    await expect(recortarYReducir(new File([], 'a.jpg', { type: 'image/jpeg' }))).rejects.toThrow('vacío');
  });
  it('rechaza originales desmesurados', async () => {
    const grande = new File([new Uint8Array(MAX_ORIGINAL_BYTES + 1)], 'a.jpg', { type: 'image/jpeg' });
    await expect(recortarYReducir(grande)).rejects.toThrow('demasiado grande');
  });
});

describe('blobADataUrl', () => {
  it('produce una data URL con el tipo del blob', async () => {
    const url = await blobADataUrl(new Blob(['abc'], { type: 'image/jpeg' }));
    expect(url).toBe('data:image/jpeg;base64,YWJj');
  });
});
