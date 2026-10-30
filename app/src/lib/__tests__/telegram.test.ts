/** Bot de Telegram (supabase/functions/telegram): seguridad, órdenes y texto del informe. */
import { describe, expect, it } from 'vitest';
import { atender, formatearCambiosHoy, formatearInforme, type CambiosHoy, type Informe } from '../../../../supabase/functions/telegram/index';

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
const cambios: CambiosHoy = {
  generado: '30/10/2026 12:00',
  equipo: [{ quien: 'N.L.', acciones: 12 }, { quien: 'I.C.', acciones: 3 }],
  acciones_equipo: [{ accion: 'ASISTENCIA', veces: 9 }, { accion: 'EDITAR_HORARIO', veces: 4 }, { accion: 'MOVER_FIJO', veces: 2 }],
  acciones_alumnos: [{ accion: 'CANCELAR_RESERVA', veces: 3, personas: 2 }],
  automaticas: 1,
  cambios_equipo: [
    { hora: '11:58', quien: 'N.L.', accion: 'MOVER_FIJO', detalle: 'A.G.: Reformer jueves 10:30 → Reformer jueves 09:30 (4 reservas quitadas, 4 nuevas, 0 sin plaza)' },
    { hora: '11:40', quien: 'N.L.', accion: 'EDITAR_HORARIO', detalle: 'clases futuras recreadas; 0 conservan día y hora' },
  ],
  cambios_alumnos: [{ hora: '10:05', quien: 'B.F.', accion: 'CANCELAR_RESERVA', detalle: 'B.F. · Suelo 2026-11-02 09:00 · CANCELADA_RECUPERABLE' }],
  cobros: { cobrados: 2, importe_centimos: 12350, pendientes_nuevos: 1 },
  sin_publicar: { franjas: 1, clases: 11, plazas: 37 },
  errores: 3,
  errores_detalle: [
    { mensaje: 'anadirAlumno: No quedan plazas libres.', tipo: 'accion', veces: 2, personas: 1, quien: 'EQUIPO', ultima: '11:20' },
    { mensaje: 'Elige la forma de pago.', tipo: 'pantalla', veces: 1, personas: 1, quien: 'EQUIPO', ultima: '09:05' },
  ],
};
const deps = (pedidos: number[] = []) => ({ secreto: 'S3creto', chats: ['111'], pedirInforme: async (d: number) => { pedidos.push(d); return informe; }, pedirCambiosHoy: async () => { pedidos.push(-1); return cambios; } });

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
    const caida = { secreto: 'S3creto', chats: ['111'], pedirInforme: async () => { throw new Error('caída'); }, pedirCambiosHoy: async () => { throw new Error('caída'); } };
    const r = await atender(peticion('/informe'), caida);
    expect((await r.json()).text).toContain('No he podido sacar el informe: caída');
    expect((await (await atender(peticion('/informehoy'), caida)).json()).text).toContain('No he podido sacar los cambios de hoy: caída');
  });

  it('/informehoy (y /infromehoy, /cambios) da los cambios de hoy uno a uno, los más recientes primero', async () => {
    const pedidos: number[] = [];
    const j = await (await atender(peticion('/informehoy'), deps(pedidos))).json();
    await atender(peticion('/infromehoy'), deps(pedidos));
    await atender(peticion('/cambios@NuevoPalmarBot'), deps(pedidos));
    expect(pedidos).toEqual([-1, -1, -1]);
    expect(j.text).toContain('cambios de hoy desde las 00:00');
    expect(j.text).toContain('EQUIPO: 15 acciones (N.L. 12, I.C. 3)');
    expect(j.text).toContain('2 alumnos pasados de franja');
    expect(j.text).toContain('11:58 N.L. · Pasa de franja: A.G.: Reformer jueves 10:30 → Reformer jueves 09:30');
    expect(j.text.indexOf('11:58')).toBeLessThan(j.text.indexOf('11:40'));
    expect(j.text).toContain('COBROS: 2 cobrados hoy (123,50 €), 1 pendiente nuevo');
    expect(j.text).toContain('SIN PUBLICAR: 1 franjas y 11 clases nuevas, 37 plazas retenidas');
    expect(j.text).toContain('10:05 B.F. · Cancela');
    expect(j.text).toContain('ERRORES: 3 hoy.');
    expect(j.text).toContain('· anadirAlumno: No quedan plazas libres. — 2 veces, 1 persona (equipo; acción que no se pudo hacer; última 11:20)');
    expect(j.text.indexOf('ERRORES')).toBeLessThan(j.text.indexOf('CAMBIOS DEL EQUIPO'));
    // Un chat no autorizado no recibe nada.
    const p2: number[] = [];
    expect((await (await atender(peticion('/informehoy', 999), deps(p2))).json()).text).toContain('privado');
    expect(p2).toEqual([]);
  });

  it('si los cambios de hoy no caben en un mensaje, se recortan (primero los de los alumnos) y lo dice', () => {
    const muchos: CambiosHoy = {
      ...cambios,
      cambios_equipo: Array.from({ length: 80 }, (_, i) => ({ hora: '10:00', quien: 'N.L.', accion: 'EDITAR_CONTRATO', detalle: `X.Y.: fin 2026-11-30 (${i} reservas quitadas, 0 nuevas)` })),
      cambios_alumnos: Array.from({ length: 40 }, () => ({ hora: '09:00', quien: 'B.F.', accion: 'RESERVAR', detalle: 'B.F. → Suelo 2026-11-02 09:00 (CUPO_SEMANAL)' })),
    };
    const t = formatearCambiosHoy(muchos);
    expect(t.length).toBeLessThanOrEqual(3900);
    expect(t).toMatch(/CAMBIOS DEL EQUIPO \(los más recientes primero; \d+ de 80\)/);
    expect(t).not.toContain('ALUMNOS (los más recientes');
    expect(t).toContain('ALUMNOS (ellos solos)');
  });

  it('un día sin cambios se entiende', () => {
    const t = formatearCambiosHoy({ ...cambios, equipo: [], acciones_equipo: [], acciones_alumnos: [], automaticas: 0, cambios_equipo: [], cambios_alumnos: [], cobros: { cobrados: 0, importe_centimos: 0, pendientes_nuevos: 0 }, sin_publicar: { franjas: 0, clases: 0, plazas: 0 } });
    expect(t).toContain('EQUIPO: nadie ha hecho cambios hoy.');
    expect(t).toContain('ALUMNOS: no han hecho nada ellos solos hoy.');
    expect(t).not.toContain('SIN PUBLICAR');
    expect(formatearCambiosHoy({ ...cambios, errores: 0, errores_detalle: [] })).toContain('ERRORES: ninguno hoy.');
    // Sin la migración 0046: el número y dónde ver el detalle.
    expect(formatearCambiosHoy({ ...cambios, errores_detalle: undefined })).toContain('(El detalle sale con /errores 1.)');
  });
});
