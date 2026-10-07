/**
 * "Descargar los datos": un Excel con lo esencial del centro (clientes, notas clínicas,
 * contrataciones, cobros, horario, tarifas, actividades y equipo), para tenerlo a mano.
 * La copia completa (con todo el historial) es la copia de seguridad diaria cifrada.
 */
import type { Db } from './db';
import { DIAS_SEMANA_LABEL } from '@/domain/fechas';
import { METODO_PAGO_LABEL, OFERTA_LABEL } from '@/domain/types';
import { crearXlsx, type Hoja } from '@/lib/xlsx';

const euros = (c: number | null | undefined) => (c == null ? null : c / 100);
const siNo = (b: boolean) => (b ? 'Sí' : 'No');

export function hojasDeDatos(db: Db, opciones: { conClinica: boolean; generadoEl: Date }): Hoja[] {
  const cliente = new Map(db.clientes.map((c) => [c.id, `${c.nombre} ${c.apellidos}`.trim()]));
  const tarifa = new Map(db.tarifas.map((t) => [t.id, t.nombre]));
  const actividad = new Map(db.actividades.map((a) => [a.id, a.nombre]));
  const trabajador = new Map(db.trabajadores.map((t) => [t.id, `${t.nombre} ${t.apellidos}`.trim()]));
  const franja = (id: string) => {
    const p = db.plantillas.find((x) => x.id === id);
    return p ? `${DIAS_SEMANA_LABEL[p.diaSemana]} ${p.horaInicio} ${actividad.get(p.actividadId) ?? ''}`.trim() : '';
  };
  const porNombre = <T extends { nombre: string; apellidos?: string }>(xs: T[]) => [...xs].sort((a, b) => `${a.apellidos ?? ''} ${a.nombre}`.localeCompare(`${b.apellidos ?? ''} ${b.nombre}`, 'es'));

  const hojas: Hoja[] = [
    {
      nombre: 'Léeme', anchos: [110],
      filas: [
        ['Datos de Nuevo Palmar Pilates'],
        [`Descargado el ${opciones.generadoEl.toLocaleString('es-ES')}.`],
        ['CONFIDENCIAL: contiene datos personales' + (opciones.conClinica ? ' y de salud' : '') + '. Guárdalo en un lugar seguro y no lo envíes por WhatsApp ni por correo.'],
        ['Es una foto de lo esencial para tenerlo a mano. La copia completa (con todo el historial de reservas) es la copia de seguridad diaria cifrada.'],
      ],
    },
    {
      nombre: 'Clientes', anchos: [16, 24, 12, 14, 30, 30, 12, 12, 8, 22],
      filas: [
        ['Nombre', 'Apellidos', 'DNI', 'Teléfono', 'Correo', 'Dirección', 'Alta', 'Baja', 'Activo', 'Consentimiento privacidad'],
        ...porNombre(db.clientes).map((c) => [c.nombre, c.apellidos, c.dni, c.telefono, c.email, c.direccion, c.altaEl, c.bajaEl, siNo(c.activo),
          c.consentimientoEl ? `${c.consentimientoEl.slice(0, 10)} (${c.consentimientoVersion ?? ''})` : 'Pendiente']),
      ],
    },
  ];
  if (opciones.conClinica) {
    hojas.push({
      nombre: 'Información clínica', anchos: [30, 40, 40, 50],
      filas: [
        ['Cliente', 'Lesiones', 'Patologías', 'Observaciones'],
        ...porNombre(db.clientes).filter((c) => c.clinica.lesiones || c.clinica.patologias || c.clinica.observaciones)
          .map((c) => [cliente.get(c.id), c.clinica.lesiones, c.clinica.patologias, c.clinica.observaciones]),
      ],
    });
  }
  hojas.push(
    {
      nombre: 'Contrataciones', anchos: [30, 32, 12, 12, 11, 12, 40, 10, 18, 12, 14, 30],
      filas: [
        ['Cliente', 'Tarifa', 'Inicio', 'Fin', 'Estado', 'Modalidad', 'Franjas fijas', 'Sesiones bono', 'Oferta', 'Importe (€)', 'Forma de pago', 'Notas'],
        ...[...db.contratos].sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio)).map((c) => [
          cliente.get(c.clienteId), tarifa.get(c.tarifaId), c.fechaInicio, c.fechaFin, c.estado, c.modalidad === 'FIJO' ? 'Horario fijo' : 'Turno libre',
          c.franjasFijas.map((f) => franja(f.plantillaId)).join(' · '), c.sesionesRestantes, OFERTA_LABEL[c.oferta ?? 'NINGUNA'],
          euros(c.importeCentimos), c.metodoPago ? METODO_PAGO_LABEL[c.metodoPago] : null, c.notas,
        ]),
      ],
    },
    {
      nombre: 'Cobros', anchos: [30, 28, 12, 12, 11, 14, 12],
      filas: [
        ['Cliente', 'Concepto', 'Importe (€)', 'Se cobra el', 'Estado', 'Forma de pago', 'Cobrado el'],
        ...[...db.pagos].sort((a, b) => (a.venceEl ?? '').localeCompare(b.venceEl ?? '')).map((p) => [
          cliente.get(p.clienteId), p.concepto, euros(p.importeCentimos), p.venceEl, p.estado === 'PAGADO' ? 'Cobrado' : p.estado === 'PENDIENTE' ? 'Pendiente' : 'Anulado',
          p.metodo ? METODO_PAGO_LABEL[p.metodo] : null, p.pagadoEl?.slice(0, 10),
        ]),
      ],
    },
    {
      nombre: 'Horario', anchos: [11, 8, 22, 10, 26, 8, 8],
      filas: [
        ['Día', 'Hora', 'Actividad', 'Minutos', 'Monitor/a', 'Plazas', 'Activa'],
        ...[...db.plantillas].sort((a, b) => a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio)).map((p) => [
          DIAS_SEMANA_LABEL[p.diaSemana], p.horaInicio, actividad.get(p.actividadId), p.duracionMin, trabajador.get(p.monitorId), p.plazas, siNo(p.activa),
        ]),
      ],
    },
    {
      nombre: 'Tarifas', anchos: [36, 12, 12, 8, 80],
      filas: [['Tarifa', 'Tipo', 'Precio (€)', 'Activa', 'Descripción'], ...db.tarifas.map((t) => [t.nombre, t.tipo, euros(t.precioCentimos), siNo(t.activa), t.descripcion])],
    },
    {
      nombre: 'Actividades', anchos: [24, 32, 12, 10, 8],
      filas: [['Actividad', 'Nombre en la web', 'Categoría', 'Minutos', 'Activa'], ...db.actividades.map((a) => [a.nombre, a.nombreWeb, a.categoria, a.duracionMin, siNo(a.activa)])],
    },
    {
      nombre: 'Equipo', anchos: [30, 30, 14, 12, 8],
      filas: [['Nombre', 'Correo', 'Teléfono', 'Rol', 'Activo'], ...porNombre(db.trabajadores).map((t) => [`${t.nombre} ${t.apellidos}`.trim(), t.email, t.telefono, t.rol, siNo(t.activo)])],
    },
  );
  return hojas;
}

export function excelDeDatos(db: Db, opciones: { conClinica: boolean; generadoEl: Date }): Blob {
  return new Blob([crearXlsx(hojasDeDatos(db, opciones))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
