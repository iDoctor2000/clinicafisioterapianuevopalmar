/** Bot de Telegram (supabase/functions/telegram): seguridad, órdenes y texto del informe. */
import { describe, expect, it } from 'vitest';
import { atender, formatearInforme, type Informe } from '../../../../supabase/functions/telegram/index';

const informe: Informe = {
  generado: '27/10/2026 18:00', dias: 7,
  alumnos: { activos: 84, con_cuenta: 55, uso_dia: 19, uso_7: 48, uso_30: 53, notificaciones: 13 },
  acciones_alumnos: [{ accion: 'CANCELAR_RESERVA', veces: 54, personas: 27 }, { accion: 'RESERVAR', veces: 35, personas: 17 }],
  avisos: { avisos: 20, entregas: 348, leidos: 98 },
  equipo: [{ quien: 'I.C.', rol: 'ADMIN', acciones: 322, dias: 13, ultimo_uso: '27/10 17:11' }, { quien: 'J.F.', rol: 'ADMIN', acciones: 0, dias: 0, ultimo_uso: null }],
  equipo_sin_cuenta: 3,
  acciones_equipo: [{ accion: 'ASISTENCIA', veces: 278 }],
  lista: { clases: 46, marcadas: 36 },
  senales: { push_atascados: 0, mantenimientos_7: 7, ultima_copia: '27/10 17:38', clases_canceladas: 17, cobros_vencidos: 3 },
  errores: { total: 3, personas: 2, por_quien: { ALUMNO: 2, EQUIPO: 1 }, top: [{ mensaje: 'No quedan plazas libres.', tipo: 'pantalla', veces: 2, personas: 1, quien: 'ALUMNO', ultima: '27/10 12:00' }] },
};

const peticion = (texto: string, chat = 111, secreto = 'S3creto') => new Request('https://x/functions/v1/telegram', {
  method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secreto, 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: { chat: { id: chat }, text: texto } }),
});
const deps = (pedidos: number[] = []) => ({ secreto: 'S3creto', chats: ['111'], pedirInforme: async (d: number) => { pedidos.push(d); return informe; } });

describe('bot de Telegram', () => {
  it('sin el secreto de Telegram no contesta nada', async () => {
    const r = await atender(peticion('/informe', 111, 'otro'), deps());
    expect(r.status).toBe(401);
  });

  it('a un chat no autorizado no le da datos, solo su número', async () => {
    const pedidos: number[] = [];
    const r = await atender(peticion('/informe', 999), deps(pedidos));
    const j = await r.json();
    expect(j.text).toContain('privado');
    expect(j.text).toContain('999');
    expect(pedidos).toEqual([]);
  });

  it('/informe, /informe 30, /hoy y /errores piden los días correctos y contestan al chat', async () => {
    const pedidos: number[] = [];
    const j1 = await (await atender(peticion('/informe'), deps(pedidos))).json();
    await atender(peticion('/informe@NuevoPalmarBot 30'), deps(pedidos));
    await atender(peticion('/hoy'), deps(pedidos));
    await atender(peticion('/informe 500'), deps(pedidos));
    const je = await (await atender(peticion('/errores'), deps(pedidos))).json();
    expect(pedidos).toEqual([7, 30, 1, 90, 7]);
    expect(j1).toMatchObject({ method: 'sendMessage', chat_id: 111 });
    expect(j1.text).toContain('55 de 84 tienen la app');
    expect(je.text).toContain('ERRORES');
    expect(je.text).not.toContain('ALUMNOS');
  });

  it('el texto se entiende: porcentajes, acciones en castellano, errores y señales', () => {
    const t = formatearInforme(informe);
    expect(t).toContain('leídos 28 %');
    expect(t).toContain('54 cancelaciones (27)');
    expect(t).toContain('Pasar lista: 36 de 46 clases dadas (78 %)');
    expect(t).toContain('3 personas del equipo no tienen cuenta');
    expect(t).toContain('No quedan plazas libres. — 2 veces, 1 persona (alumnos; mensaje en pantalla; última 27/10 12:00)');
    expect(t).toContain('mantenimiento nocturno, bien');
    expect(formatearInforme({ ...informe, errores: { total: 0, personas: 0, por_quien: {}, top: [] } })).toContain('Ninguno en los últimos 7 días.');
    expect(formatearInforme({ ...informe, errores: undefined })).toContain('falta la migración 0035');
  });

  it('órdenes desconocidas y textos que no son órdenes', async () => {
    expect((await (await atender(peticion('/hola'), deps())).json()).text).toContain('No conozco');
    expect(await (await atender(peticion('hola'), deps())).text()).toBe('ok');
  });

  it('si la base de datos falla, lo dice', async () => {
    const r = await atender(peticion('/informe'), { secreto: 'S3creto', chats: ['111'], pedirInforme: async () => { throw new Error('caída'); } });
    expect((await r.json()).text).toContain('No he podido sacar el informe: caída');
  });
});
