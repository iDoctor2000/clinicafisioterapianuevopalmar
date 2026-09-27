/** fotos.ts: URLs firmadas con caché en memoria y rutas del bucket. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSignedUrl = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
vi.mock('../cliente', () => ({
  servidor: () => ({ storage: { from: () => ({ createSignedUrl, upload, remove }) } }),
  mensajeError: (e: unknown) => String((e as { message?: string })?.message ?? e),
}));

import { _vaciarCacheFotos, borrarFoto, olvidar, rutaFoto, subirFoto, urlFoto } from '../fotos';

const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  _vaciarCacheFotos();
  createSignedUrl.mockReset();
  upload.mockReset();
  remove.mockReset();
});

describe('urlFoto', () => {
  it('sin foto → null; data URL y http → tal cual, sin llamar al servidor', async () => {
    await expect(urlFoto(ID, null)).resolves.toBeNull();
    await expect(urlFoto(ID, 'data:image/jpeg;base64,xx')).resolves.toBe('data:image/jpeg;base64,xx');
    await expect(urlFoto(ID, 'https://cdn/x.jpg')).resolves.toBe('https://cdn/x.jpg');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
  it('firma la ruta (sin ?v=), cachea y reutiliza; una marca nueva vuelve a firmar', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://s/firmada?token=1' }, error: null });
    const ruta = `${ID}/avatar.jpg?v=100`;
    const [a, b] = await Promise.all([urlFoto(ID, ruta), urlFoto(ID, ruta)]);
    expect(a).toBe('https://s/firmada?token=1');
    expect(b).toBe(a);
    expect(await urlFoto(ID, ruta)).toBe(a);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith(`${ID}/avatar.jpg`, 3600);
    await urlFoto(ID, `${ID}/avatar.jpg?v=200`);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });
  it('si el servidor falla devuelve null (se muestran las iniciales) y no cachea', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    const ruta = `${ID}/avatar.jpg?v=1`;
    expect(await urlFoto(ID, ruta)).toBeNull();
    expect(await urlFoto(ID, ruta)).toBeNull();
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });
  it('olvidar(clienteId) invalida el caché de ese cliente', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'u' }, error: null });
    const ruta = `${ID}/avatar.jpg?v=1`;
    await urlFoto(ID, ruta);
    olvidar(ID);
    await urlFoto(ID, ruta);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });
});

describe('subirFoto / borrarFoto', () => {
  it('sube con upsert como JPEG y devuelve la ruta con marca de versión', async () => {
    upload.mockResolvedValue({ error: null });
    const r = await subirFoto(ID, new Blob(['x'], { type: 'image/jpeg' }));
    expect(r).toMatch(new RegExp(`^${ID}/avatar\\.jpg\\?v=\\d+$`));
    expect(upload).toHaveBeenCalledWith(rutaFoto(ID), expect.any(Blob), expect.objectContaining({ upsert: true, contentType: 'image/jpeg' }));
  });
  it('traduce los errores del bucket a mensajes claros', async () => {
    upload.mockResolvedValue({ error: { message: 'Bucket not found' } });
    await expect(subirFoto(ID, new Blob(['x']))).rejects.toThrow('0006_fotos.sql');
    upload.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } });
    await expect(subirFoto(ID, new Blob(['x']))).rejects.toThrow('No tienes permiso');
  });
  it('borrar no falla si el objeto no existía', async () => {
    remove.mockResolvedValue({ error: { message: 'Object not found' } });
    await expect(borrarFoto(ID)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith([rutaFoto(ID)]);
  });
});
