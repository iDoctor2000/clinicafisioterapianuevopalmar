/**
 * Buzón (0052): consultas de los alumnos al centro. Reglas puras, las mismas que aplica el servidor
 * (enviar_consulta, responder_consulta…): textos, límites, horario y qué está pendiente o sin leer.
 */
import type { ConfigCentro, Consulta, EstadoConsulta, HoraHHmm, Id, MotivoConsulta } from './types';

export const MOTIVOS_CONSULTA: { valor: MotivoConsulta; texto: string; ayuda: string }[] = [
  { valor: 'CLASES', texto: 'Mis clases y horario', ayuda: 'Reservas, recuperaciones, cambiar de día, llegar tarde…' },
  { valor: 'LESION', texto: 'Lesión o molestia', ayuda: 'Algo que el centro deba saber antes de tu clase.' },
  { valor: 'TARIFA', texto: 'Cambio de tarifa', ayuda: 'Más o menos días, pausar unas semanas, darte de baja…' },
  { valor: 'OTRO', texto: 'Otra cosa', ayuda: 'Dudas, sugerencias o lo que necesites.' },
];

export const MOTIVO_CONSULTA_TEXTO: Record<MotivoConsulta, string> = {
  CLASES: 'Mis clases y horario', LESION: 'Lesión o molestia', TARIFA: 'Cambio de tarifa', OTRO: 'Otra cosa',
};

/** Cómo lo lee cada parte: para el alumno "Pendiente" es que espera respuesta; para el centro, que tiene que darla. */
export const ESTADO_CONSULTA_TEXTO: Record<EstadoConsulta, string> = { PENDIENTE: 'Pendiente', RESPONDIDA: 'Respondida', CERRADA: 'Cerrada' };

/** Letras máximas de un mensaje. */
export const MAX_LETRAS_MENSAJE = 1500;
/** Mensajes que puede mandar un alumno en 24 horas. */
export const MAX_MENSAJES_DIA = 10;
/** El centro firma siempre así ante el alumno, conteste quien conteste. */
export const FIRMA_CENTRO = 'Nuevo Palmar';

export const HORA_BUZON_DESDE: HoraHHmm = '08:00';
export const HORA_BUZON_HASTA: HoraHHmm = '22:00';

/** Texto listo para guardar, o el motivo por el que no vale. */
export function validarMensaje(texto: string): { ok: true; texto: string } | { ok: false; error: string } {
  const limpio = texto.trim();
  if (!limpio) return { ok: false, error: 'Escribe tu mensaje.' };
  if (limpio.length > MAX_LETRAS_MENSAJE) return { ok: false, error: 'El mensaje es demasiado largo (máximo 1.500 letras).' };
  return { ok: true, texto: limpio };
}

/** ¿Ha mandado ya el alumno todos los mensajes que puede en las últimas 24 horas? */
export function limiteAlcanzado(consultas: Consulta[], clienteId: Id, ahora: Date): boolean {
  const desde = new Date(ahora.getTime() - 24 * 3_600_000).toISOString();
  let n = 0;
  for (const c of consultas) {
    if (c.clienteId !== clienteId) continue;
    for (const m of c.mensajes) if (m.autor === 'CLIENTE' && m.creadoEl > desde) n++;
  }
  return n >= MAX_MENSAJES_DIA;
}

const hhmm = (d: Date): HoraHHmm => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** ¿Está el centro contestando ahora? (dentro del horario del buzón). */
export function enHorarioBuzon(config: Pick<ConfigCentro, 'buzonDesde' | 'buzonHasta'>, ahora: Date): boolean {
  const desde = config.buzonDesde || HORA_BUZON_DESDE;
  const hasta = config.buzonHasta || HORA_BUZON_HASTA;
  const hora = hhmm(ahora);
  return desde < hasta && hora >= desde && hora < hasta;
}

/** "8:00" a partir de "08:00". */
export function horaCorta(hora: HoraHHmm): string {
  return hora.replace(/^0/, '');
}

/** Lo que lee el alumno debajo de la caja de escribir. */
export function textoHorarioBuzon(config: Pick<ConfigCentro, 'buzonDesde' | 'buzonHasta'>, ahora: Date): string {
  const desde = horaCorta(config.buzonDesde || HORA_BUZON_DESDE);
  return enHorarioBuzon(config, ahora)
    ? `Puedes escribir a cualquier hora. Te contestamos en cuanto podamos (de noche, a partir de las ${desde}).`
    : `Puedes escribir a cualquier hora. Te contestamos a partir de las ${desde}.`;
}

/** El centro ha escrito después de la última vez que el alumno abrió la consulta. */
export function respuestaSinLeer(c: Consulta): boolean {
  const ultima = [...c.mensajes].reverse().find((m) => m.autor === 'CENTRO');
  return !!ultima && (!c.leidaClienteEl || ultima.creadoEl > c.leidaClienteEl);
}

/** Consultas de un alumno, de la más reciente a la más antigua. */
export function consultasDeCliente(consultas: Consulta[] | undefined, clienteId: Id): Consulta[] {
  return (consultas ?? []).filter((c) => c.clienteId === clienteId).sort((a, b) => b.actualizadaEl.localeCompare(a.actualizadaEl));
}

/** Cuántas consultas esperan respuesta del centro. */
export function consultasPendientes(consultas: Consulta[] | undefined): number {
  return (consultas ?? []).filter((c) => c.estado === 'PENDIENTE').length;
}

export type FiltroBuzon = 'PENDIENTES' | 'RESPONDIDAS' | 'TODAS';

/** Para el buzón del equipo: las pendientes, de la que más lleva esperando a la más reciente; el resto, lo último primero. */
export function consultasDelBuzon(consultas: Consulta[] | undefined, filtro: FiltroBuzon): Consulta[] {
  const lista = consultas ?? [];
  if (filtro === 'PENDIENTES') return lista.filter((c) => c.estado === 'PENDIENTE').sort((a, b) => a.actualizadaEl.localeCompare(b.actualizadaEl));
  const resto = filtro === 'RESPONDIDAS' ? lista.filter((c) => c.estado !== 'PENDIENTE') : lista;
  return [...resto].sort((a, b) => b.actualizadaEl.localeCompare(a.actualizadaEl));
}

/** Primeras letras del último mensaje, para la lista. */
export function resumenConsulta(c: Consulta, max = 90): string {
  const ultimo = c.mensajes[c.mensajes.length - 1];
  if (!ultimo) return '';
  const limpio = ultimo.texto.replace(/\s+/g, ' ').trim();
  const texto = limpio.length > max ? `${limpio.slice(0, max).trimEnd()}…` : limpio;
  return ultimo.autor === 'CENTRO' ? `${FIRMA_CENTRO}: ${texto}` : texto;
}

/**
 * Qué ve del buzón un trabajador que no lo atiende: nada. El servidor ya no le devuelve consultas ni los avisos
 * de respuesta (0052); en la demo, y por si acaso, la instantánea se limpia también aquí.
 */
export function ocultarBuzon<T extends { consultas?: Consulta[]; avisos: { consultaId?: Id | null }[] }>(db: T): T {
  if (!(db.consultas?.length) && !db.avisos.some((a) => a.consultaId)) return db;
  return { ...db, consultas: [], avisos: db.avisos.filter((a) => !a.consultaId) };
}
