/**
 * Buzón (0052): las consultas que los alumnos escriben al centro. Solo lo ve quien atiende el buzón
 * (interruptor en Equipo). Se contesta aquí; al alumno le llega el aviso y la respuesta va firmada
 * como "Nuevo Palmar".
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, ChevronRight, Inbox, UserRound } from 'lucide-react';
import type { Consulta } from '@/domain/types';
import {
  ESTADO_CONSULTA_TEXTO, HORA_BUZON_DESDE, HORA_BUZON_HASTA, MOTIVO_CONSULTA_TEXTO, consultasDelBuzon, consultasPendientes, horaCorta, resumenConsulta,
  type FiltroBuzon,
} from '@/domain/buzon';
import { nombreCompleto } from '@/data/selectores';
import { Boton, Chip, Entrada, Hoja, Interruptor, Tarjeta, Vacio, toast } from '@/ui';
import { cn } from '@/lib/cn';
import { CajaMensaje, Conversacion, cuandoMensaje } from '@/features/comun/Conversacion';
import { useTrabajador } from './useTrabajador';
import { AvatarCliente, Encabezado, Plegable, Segmentado, may } from './comunes';

export function Buzon() {
  const { db, dbCompleta, trabajador, esAdmin, ejecutar } = useTrabajador();
  const pendientes = consultasPendientes(db.consultas);
  const [filtro, setFiltro] = useState<FiltroBuzon>('PENDIENTES');
  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  const lista = consultasDelBuzon(db.consultas, filtro);
  const abierta = abiertaId ? (db.consultas ?? []).find((c) => c.id === abiertaId) ?? null : null;
  // El alumno puede estar fuera del ámbito recortado (no debería, quien atiende el buzón ve todo el centro): se busca en todo.
  const alumno = (c: Consulta) => db.clientes.find((x) => x.id === c.clienteId) ?? dbCompleta.clientes.find((x) => x.id === c.clienteId);
  const desde = db.config.buzonDesde || HORA_BUZON_DESDE;
  const hasta = db.config.buzonHasta || HORA_BUZON_HASTA;

  return (
    <div className="max-w-3xl">
      <Encabezado
        titulo="Buzón"
        subtitulo={pendientes === 0 ? 'No hay consultas pendientes de responder.' : pendientes === 1 ? '1 consulta pendiente de responder.' : `${pendientes} consultas pendientes de responder.`}
        acciones={<Segmentado className="w-full sm:w-auto" tamano="sm" valor={filtro} onCambio={setFiltro} opciones={[{ valor: 'PENDIENTES', texto: pendientes > 0 ? `Pendientes (${pendientes})` : 'Pendientes' }, { valor: 'RESPONDIDAS', texto: 'Respondidas' }, { valor: 'TODAS', texto: 'Todas' }]} />}
      />

      {db.config.buzonActivo !== true && (
        <div className="mb-4 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-ink-soft">El buzón está <strong className="text-ink">desactivado</strong>: los alumnos no pueden escribir. Las consultas anteriores siguen aquí.</div>
      )}

      {lista.length === 0 ? (
        <Tarjeta><Vacio icono={Inbox} titulo={filtro === 'PENDIENTES' ? 'Todo contestado' : 'Sin consultas'} texto={filtro === 'PENDIENTES' ? 'Cuando un alumno escriba al centro desde la app, su consulta aparecerá aquí.' : 'Aquí se guardan las consultas de los alumnos y sus respuestas.'} /></Tarjeta>
      ) : (
        <Tarjeta className="divide-y divide-ink/5">
          {lista.map((c) => {
            const a = alumno(c);
            return (
              <button key={c.id} type="button" onClick={() => setAbiertaId(c.id)} className="w-full text-left flex items-start gap-3 p-4 hover:bg-sand tap">
                <AvatarCliente cliente={a} tamano="md" />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className={cn('truncate', c.estado === 'PENDIENTE' ? 'font-semibold' : 'font-medium text-ink-soft')}>{a ? nombreCompleto(a) : 'Alumno'}</span>
                    <Chip tono={c.estado === 'PENDIENTE' ? 'ambar' : c.estado === 'RESPONDIDA' ? 'azul' : 'gris'}>{ESTADO_CONSULTA_TEXTO[c.estado]}</Chip>
                  </span>
                  <span className="block text-sm text-ink-muted">{MOTIVO_CONSULTA_TEXTO[c.motivo]} · {may(cuandoMensaje(c.actualizadaEl))}</span>
                  <span className="block text-[15px] text-ink-soft mt-0.5 line-clamp-2">{resumenConsulta(c, 120)}</span>
                </span>
                <ChevronRight className="h-5 w-5 text-ink-muted shrink-0 mt-2" />
              </button>
            );
          })}
        </Tarjeta>
      )}

      <div className="mt-6 space-y-3">
        <Tarjeta className="px-4">
          <Interruptor
            activo={trabajador?.buzonPush !== false}
            onCambio={async (v) => {
              const r = await ejecutar('buzonAvisarme', { activo: v });
              if (r.ok) toast.ok(v ? 'Te avisaremos al móvil de las consultas nuevas.' : 'Ya no te sonará el móvil con las consultas. Las sigues viendo aquí.'); else toast.error(r.error);
            }}
            etiqueta="Avisarme al móvil de las consultas"
            descripcion={`Suena de ${horaCorta(desde)} a ${horaCorta(hasta)}. Lo que llegue de noche se junta en un solo aviso a las ${horaCorta(desde)}. Necesita «Avisos en el móvil» activado en Más.`}
          />
        </Tarjeta>
        {esAdmin && <AjustesBuzon key={`${db.config.buzonActivo}-${desde}-${hasta}`} />}
        <p className="text-sm text-ink-muted px-1">Solo ve este buzón quien tiene activado «Atiende el buzón de los alumnos» en Equipo. Al alumno, la respuesta le llega firmada como «Nuevo Palmar».</p>
      </div>

      {abierta && (
        <Hoja abierta onCerrar={() => setAbiertaId(null)} titulo={MOTIVO_CONSULTA_TEXTO[abierta.motivo]}>
          {(() => {
            const a = alumno(abierta);
            return (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <AvatarCliente cliente={a} tamano="md" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{a ? nombreCompleto(a) : 'Alumno'}</div>
                    <div className="text-sm text-ink-muted">{ESTADO_CONSULTA_TEXTO[abierta.estado]} · abierta {cuandoMensaje(abierta.creadaEl)}</div>
                  </div>
                  {a && <Link to={`/clientes/${a.id}`} className="inline-flex items-center gap-1 text-beige-600 font-semibold shrink-0 tap"><UserRound className="h-4 w-4" /> Ficha</Link>}
                </div>
                <Conversacion
                  consulta={abierta} lado="CENTRO" nombreAlumno={a?.nombre}
                  firmaDe={(m) => { const t = m.trabajadorId ? dbCompleta.trabajadores.find((x) => x.id === m.trabajadorId) : null; return t ? t.nombre : null; }}
                />
                <div className="mt-4 pt-4 border-t border-ink/10">
                  <CajaMensaje
                    placeholder="Escribe la respuesta…" etiqueta="Responder"
                    pie={<p>Le llegará un aviso al móvil si lo tiene activado. Verá «Nuevo Palmar», no tu nombre.</p>}
                    onEnviar={async (texto) => {
                      const r = await ejecutar('responderConsulta', { consultaId: abierta.id, texto });
                      if (r.ok) toast.ok('Respuesta enviada.'); else toast.error(r.error);
                      return r.ok;
                    }}
                  />
                  {abierta.estado !== 'CERRADA' && (
                    <Boton variante="fantasma" tamano="sm" className="mt-3" onClick={async () => {
                      const r = await ejecutar('cerrarConsulta', { consultaId: abierta.id });
                      if (r.ok) { toast.ok('Consulta cerrada.'); setAbiertaId(null); } else toast.error(r.error);
                    }}><CheckCheck className="h-4 w-4" /> Cerrar sin responder más</Boton>
                  )}
                </div>
              </>
            );
          })()}
        </Hoja>
      )}
    </div>
  );
}

/** Activar o desactivar el buzón y el horario en el que suena el móvil del equipo. */
function AjustesBuzon() {
  const { db, ejecutar } = useTrabajador();
  const inicial = { buzonActivo: db.config.buzonActivo === true, buzonDesde: db.config.buzonDesde || HORA_BUZON_DESDE, buzonHasta: db.config.buzonHasta || HORA_BUZON_HASTA };
  const [f, setF] = useState(inicial);
  const cambiado = JSON.stringify(f) !== JSON.stringify(inicial);
  const guardar = async () => {
    if (!/^\d{2}:\d{2}$/.test(f.buzonDesde) || !/^\d{2}:\d{2}$/.test(f.buzonHasta) || f.buzonDesde >= f.buzonHasta) return toast.error('La hora «desde» tiene que ser anterior a la hora «hasta».');
    const r = await ejecutar('actualizarConfig', { config: f });
    if (r.ok) toast.ok('Ajustes del buzón guardados.'); else toast.error(r.error);
  };
  return (
    <Plegable titulo="Ajustes del buzón" resumen={f.buzonActivo ? `Activo · se contesta de ${horaCorta(inicial.buzonDesde)} a ${horaCorta(inicial.buzonHasta)}` : 'Desactivado'}>
      <div className="space-y-3">
        <Interruptor activo={f.buzonActivo} onCambio={(v) => setF({ ...f, buzonActivo: v })} etiqueta="Los alumnos pueden escribir al centro"
          descripcion={f.buzonActivo ? 'Ven «Escribir al centro» en Inicio y en Avisos.' : 'No ven el botón. Las consultas ya escritas se conservan.'} />
        <div className="grid grid-cols-2 gap-3">
          <Entrada etiqueta="Se contesta desde" type="time" value={f.buzonDesde} onChange={(e) => setF({ ...f, buzonDesde: e.target.value })} />
          <Entrada etiqueta="Hasta" type="time" value={f.buzonHasta} onChange={(e) => setF({ ...f, buzonHasta: e.target.value })} />
        </div>
        <p className="text-sm text-ink-muted">Los alumnos pueden escribir a cualquier hora. Fuera de ese horario no suena el móvil y se les dice a partir de qué hora se contesta.</p>
        <Boton onClick={() => void guardar()} disabled={!cambiado}>Guardar</Boton>
      </div>
    </Plegable>
  );
}
