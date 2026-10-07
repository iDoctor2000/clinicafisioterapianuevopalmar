import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, CalendarPlus, ChevronRight, Clock, RefreshCw, Sparkles, Ticket, User } from 'lucide-react';
import type { ReservaVista } from '@/data/selectores';
import { avisosDeCliente, portadaVisible, recuperacionesDisponiblesDe } from '@/data/selectores';
import { fechaLarga, horaFin, hoyISO } from '@/domain/fechas';
import { Boton, Carrusel, Chip, Tarjeta, Vacio } from '@/ui';
import { useCliente } from './useCliente';
import { cap, diaMes, diasHasta, fechaRelativa, horarioFijoDe, periodoTexto, proximaReserva, textoFranja } from './consultas';
import { chipOrigen } from './estados';
import { BarraProgreso, Encabezado, HojaCancelar, PuntoActividad } from './comun';
import { AvatarCliente } from '@/features/comun/AvatarCliente';
import { IconoActividad } from '@/features/comun/IconoActividad';

export function Inicio() {
  const { db, cliente, contrato, tarifa } = useCliente();
  const navegar = useNavigate();
  const [cancelando, setCancelando] = useState<ReservaVista | null>(null);
  const ahora = new Date();
  const hoy = hoyISO(ahora);

  const proxima = proximaReserva(db, cliente.id, ahora);
  const recuperaciones = recuperacionesDisponiblesDe(db, cliente.id, hoy);
  const noLeidos = avisosDeCliente(db, cliente.id).filter((a) => !a.leido);
  const ultimoAviso = noLeidos[0] ?? null;
  const puedeReservar = (tarifa && contrato && contrato.modalidad === 'LIBRE') || recuperaciones.length > 0;
  const franjas = horarioFijoDe(db, contrato);
  const esBono = tarifa?.tipo === 'BONO' && tarifa.bono && contrato;
  const portada = portadaVisible(db);

  return (
    <div>
      <Encabezado titulo={`Hola, ${cliente.nombre}`} subtitulo={cap(fechaLarga(hoy))}>
        <Link to="/perfil" aria-label="Mi perfil" className="shrink-0 rounded-full tap mb-1"><AvatarCliente cliente={cliente} tamano="lg" /></Link>
      </Encabezado>

      {portada.length > 0 && <Carrusel imagenes={portada} className="mb-5" />}

      {ultimoAviso && (
        <Link to="/avisos" className="block mb-4">
          <Tarjeta className="p-4 border-beige-200 bg-beige-50 flex items-center gap-3 hover:border-beige-300 tap">
            <span className="h-11 w-11 rounded-full bg-white text-beige-600 flex items-center justify-center shrink-0"><Bell className="h-6 w-6" /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-beige-600">
                {noLeidos.length === 1 ? 'Aviso nuevo' : `${noLeidos.length} avisos nuevos`} · {fechaRelativa(ultimoAviso.aviso.publicadoEl, ahora)}
              </span>
              <span className="block font-semibold truncate">{ultimoAviso.aviso.titulo}</span>
            </span>
            <ChevronRight className="h-5 w-5 text-beige-600 shrink-0" />
          </Tarjeta>
        </Link>
      )}

      <section className="mb-5">
        <h2 className="text-xl mb-3">Tu próxima clase</h2>
        {proxima ? (
          <Tarjeta className="overflow-hidden">
            <div className="h-2" style={{ backgroundColor: proxima.actividad.color }} />
            <div className="p-5">
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <Chip tono="beige">Reservada</Chip>
                {chipOrigen(proxima.reserva) && <Chip tono={chipOrigen(proxima.reserva)!.tono}>{chipOrigen(proxima.reserva)!.texto}</Chip>}
                {diasHasta(proxima.clase.fecha, ahora) === 0 && <Chip tono="ambar">Hoy</Chip>}
                {diasHasta(proxima.clase.fecha, ahora) === 1 && <Chip tono="ambar">Mañana</Chip>}
              </div>
              <p className="text-2xl font-semibold flex items-center gap-3"><IconoActividad actividad={proxima.actividad} tamano="md" />{proxima.actividad.nombre}</p>
              <ul className="mt-3 space-y-1.5 text-[17px]">
                <li className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-beige-600 shrink-0" /> {cap(fechaLarga(proxima.clase.fecha))}</li>
                <li className="flex items-center gap-2"><Clock className="h-5 w-5 text-beige-600 shrink-0" /> De {proxima.clase.horaInicio} a {horaFin(proxima.clase.horaInicio, proxima.clase.duracionMin)}</li>
                {proxima.monitor && <li className="flex items-center gap-2"><User className="h-5 w-5 text-beige-600 shrink-0" /> Con {proxima.monitor.nombre} {proxima.monitor.apellidos}</li>}
              </ul>
              <Boton variante="secundario" ancho className="mt-4" onClick={() => setCancelando(proxima)}>Cancelar mi plaza</Boton>
            </div>
          </Tarjeta>
        ) : (
          <Tarjeta>
            <Vacio icono={Ticket} titulo="No tienes ninguna clase reservada" texto={puedeReservar ? 'Elige un día en el horario y reserva tu plaza.' : undefined} />
          </Tarjeta>
        )}
      </section>

      {puedeReservar && (
        <Boton tamano="lg" ancho className="mb-6" onClick={() => navegar('/horario')}>
          <CalendarPlus className="h-6 w-6" /> Reservar clase
        </Boton>
      )}

      <section className="mb-5">
        <h2 className="text-xl mb-3">Tu tarifa</h2>
        {tarifa && contrato ? (
          <Tarjeta className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold leading-snug">{tarifa.nombre}</p>
                <p className="text-ink-soft">Hasta el {diaMes(contrato.fechaFin)}</p>
              </div>
              <Chip tono={contrato.modalidad === 'FIJO' ? 'cocoa' : 'azul'} className="shrink-0 mt-1">{contrato.modalidad === 'FIJO' ? 'Horario fijo' : 'Turno libre'}</Chip>
            </div>
            {esBono && tarifa.bono && (
              <div className="mt-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">Te quedan {contrato.sesionesRestantes ?? 0} de {tarifa.bono.sesiones} sesiones</span>
                  <span className="text-sm text-ink-muted">Caduca el {diaMes(contrato.fechaFin)}</span>
                </div>
                <BarraProgreso valor={contrato.sesionesRestantes ?? 0} total={tarifa.bono.sesiones} className="mt-2" />
              </div>
            )}
            {franjas.length > 0 && (
              <ul className="mt-3 space-y-1 text-ink-soft">
                {franjas.map((f) => <li key={f.plantilla.id} className="flex items-center gap-2"><PuntoActividad color={f.actividad.color} />{textoFranja(f)}</li>)}
              </ul>
            )}
            <Link to="/perfil" className="mt-3 inline-flex items-center gap-1 text-beige-600 font-semibold">Ver detalles <ChevronRight className="h-4 w-4" /></Link>
          </Tarjeta>
        ) : (
          <Tarjeta className="p-5 flex items-start gap-3">
            <Sparkles className="h-6 w-6 text-beige-600 shrink-0 mt-0.5" />
            <p>No tienes una tarifa activa. Pregunta en recepción y te ayudaremos a elegir la que mejor te venga.</p>
          </Tarjeta>
        )}
      </section>

      {recuperaciones.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xl mb-3">Clases para recuperar</h2>
          <Tarjeta className="p-5">
            <div className="flex items-center gap-3">
              <span className="h-12 w-12 rounded-2xl bg-sky/10 text-sky flex items-center justify-center shrink-0"><RefreshCw className="h-6 w-6" /></span>
              <div>
                <p className="text-lg font-semibold">{recuperaciones.length === 1 ? 'Tienes 1 recuperación disponible' : `Tienes ${recuperaciones.length} recuperaciones disponibles`}</p>
                <p className="text-ink-soft text-sm">Úsala antes del {diaMes(recuperaciones.map((r) => r.caducaEl).sort()[0])}.</p>
              </div>
            </div>
            <Boton variante="suave" ancho className="mt-4" onClick={() => navegar('/horario')}>Usar una recuperación</Boton>
          </Tarjeta>
        </section>
      )}

      {tarifa && contrato && (
        <p className="text-sm text-ink-muted text-center mb-4">Periodo de tu tarifa: {periodoTexto(contrato)}.</p>
      )}

      <HojaCancelar vista={cancelando} onCerrar={() => setCancelando(null)} />
    </div>
  );
}
