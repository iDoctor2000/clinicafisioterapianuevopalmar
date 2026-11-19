import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, BellRing, ChevronRight, MessageCircle, PenLine } from 'lucide-react';
import { useStore } from '@/data/store';
import { avisosDeCliente } from '@/data/selectores';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Boton, Chip, Hoja, Tarjeta, Vacio, toast } from '@/ui';
import type { MotivoConsulta } from '@/domain/types';
import { ESTADO_CONSULTA_TEXTO, MOTIVOS_CONSULTA, MOTIVO_CONSULTA_TEXTO, consultasDeCliente, respuestaSinLeer, resumenConsulta, textoHorarioBuzon } from '@/domain/buzon';
import { CajaMensaje, Conversacion, cuandoMensaje } from '@/features/comun/Conversacion';
import { cn } from '@/lib/cn';
import { useCliente } from './useCliente';
import { cap, fechaRelativa } from './consultas';
import { Encabezado, Pestanas } from './comun';

type Pestana = 'AVISOS' | 'CONSULTAS';

export function Avisos() {
  const { db, cliente } = useCliente();
  const ejecutar = useStore((s) => s.ejecutar);
  const [params, setParams] = useSearchParams();
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const ahora = new Date();
  // Los avisos de "te han respondido" no van en la lista: su sitio es la consulta (pestaña Mis consultas).
  const todos = avisosDeCliente(db, cliente.id);
  const avisos = todos.filter((a) => !a.aviso.consultaId);
  const noLeidos = avisos.filter((a) => !a.leido).length;
  const abierto = abiertoId ? avisos.find((a) => a.aviso.id === abiertoId) ?? null : null;

  // Buzón (0052): se enseña si está activo o si el alumno ya tiene consultas.
  const consultas = consultasDeCliente(db.consultas, cliente.id);
  const buzonActivo = db.config.buzonActivo === true;
  const hayBuzon = buzonActivo || consultas.length > 0;
  const conRespuesta = consultas.filter(respuestaSinLeer).length;
  const pedida = params.get('ver');
  const [pestana, setPestanaEstado] = useState<Pestana>(() => (hayBuzon && (pedida === 'consultas' || (conRespuesta > 0 && noLeidos === 0)) ? 'CONSULTAS' : 'AVISOS'));
  const setPestana = setPestanaEstado;
  const [escribir, setEscribir] = useState(() => hayBuzon && buzonActivo && params.get('escribir') === '1');
  const [consultaId, setConsultaId] = useState<string | null>(null);
  const consulta = consultaId ? consultas.find((c) => c.id === consultaId) ?? null : null;

  const abrir = async (id: string) => {
    setAbiertoId(id);
    await ejecutar('marcarAvisoLeido', { avisoId: id });
  };
  // Los parámetros del enlace (Inicio → "¿Necesitas decirnos algo?") solo valen para abrir: luego se quitan.
  const conParametros = !!pedida || params.has('escribir');
  useEffect(() => { if (conParametros) setParams({}, { replace: true }); }, [conParametros, setParams]);
  // Con la consulta abierta, lo que conteste el centro queda leído (también si llega mientras la está mirando).
  const sinLeerAbierta = !!consulta && respuestaSinLeer(consulta);
  const idAbierta = consulta?.id;
  useEffect(() => { if (idAbierta && sinLeerAbierta) void ejecutar('leerConsulta', { consultaId: idAbierta }); }, [idAbierta, sinLeerAbierta, ejecutar]);

  const partes = [
    noLeidos === 1 ? '1 aviso sin leer' : noLeidos > 1 ? `${noLeidos} avisos sin leer` : '',
    conRespuesta === 1 ? '1 consulta con respuesta' : conRespuesta > 1 ? `${conRespuesta} consultas con respuesta` : '',
  ].filter(Boolean);

  return (
    <div>
      <Encabezado titulo="Avisos" subtitulo={partes.length === 0 ? 'Estás al día.' : `Tienes ${partes.join(' y ')}.`} />

      {hayBuzon && (
        <Pestanas valor={pestana} onCambio={setPestana} items={[{ id: 'AVISOS', etiqueta: 'Avisos del centro', contador: noLeidos }, { id: 'CONSULTAS', etiqueta: 'Mis consultas', contador: conRespuesta }]} />
      )}

      {pestana === 'AVISOS' && (avisos.length === 0 ? (
        <Tarjeta><Vacio icono={Bell} titulo="No tienes avisos" texto="Aquí verás los mensajes del centro: cambios de horario, clases canceladas y novedades." /></Tarjeta>
      ) : (
        <ul className="space-y-3">
          {avisos.map(({ aviso, leido }) => (
            <li key={aviso.id}>
              <button
                type="button" onClick={() => abrir(aviso.id)}
                className={cn('w-full text-left bg-white rounded-2xl shadow-card border tap p-4 flex items-start gap-3 hover:border-beige-200', leido ? 'border-ink/5' : 'border-beige-300')}
              >
                <span className={cn('h-11 w-11 rounded-full flex items-center justify-center shrink-0', leido ? 'bg-sand-deep text-ink-muted' : 'bg-beige-100 text-ink')}>
                  {leido ? <Bell className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 text-sm text-ink-muted">
                    {!leido && <span className="h-2.5 w-2.5 rounded-full bg-brand-500 shrink-0" aria-label="No leído" />}
                    <span>{cap(fechaRelativa(aviso.publicadoEl, ahora))}</span>
                    {aviso.importante && <Chip tono="rojo">Importante</Chip>}
                  </span>
                  <span className={cn('block text-lg leading-snug mt-0.5', leido ? 'font-medium text-ink-soft' : 'font-semibold')}>{aviso.titulo}</span>
                  <span className="block text-ink-muted text-[15px] mt-0.5 line-clamp-2">{aviso.cuerpo}</span>
                </span>
                <ChevronRight className="h-5 w-5 text-ink-muted shrink-0 mt-3" />
              </button>
            </li>
          ))}
        </ul>
      ))}

      {pestana === 'CONSULTAS' && (
        <>
          {buzonActivo && <Boton ancho className="mb-4" onClick={() => setEscribir(true)}><PenLine className="h-5 w-5" /> Escribir al centro</Boton>}
          {consultas.length === 0 ? (
            <Tarjeta><Vacio icono={MessageCircle} titulo="¿Necesitas decirnos algo?" texto="Una duda con tus clases, una molestia antes de venir, un cambio de horario o de tarifa… Escríbenos y te contestamos aquí mismo." /></Tarjeta>
          ) : (
            <ul className="space-y-3">
              {consultas.map((c) => {
                const nueva = respuestaSinLeer(c);
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => setConsultaId(c.id)} className={cn('w-full text-left bg-white rounded-2xl shadow-card border tap p-4 flex items-start gap-3 hover:border-beige-200', nueva ? 'border-beige-300' : 'border-ink/5')}>
                      <span className={cn('h-11 w-11 rounded-full flex items-center justify-center shrink-0', nueva ? 'bg-beige-100 text-ink' : 'bg-sand-deep text-ink-muted')}><MessageCircle className="h-5 w-5" /></span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2 text-sm text-ink-muted flex-wrap">
                          {nueva && <span className="h-2.5 w-2.5 rounded-full bg-brand-500 shrink-0" aria-label="Respuesta sin leer" />}
                          <span>{cap(cuandoMensaje(c.actualizadaEl))}</span>
                          <Chip tono={c.estado === 'RESPONDIDA' ? 'azul' : c.estado === 'PENDIENTE' ? 'ambar' : 'gris'}>{c.estado === 'PENDIENTE' ? 'Esperando respuesta' : ESTADO_CONSULTA_TEXTO[c.estado]}</Chip>
                        </span>
                        <span className={cn('block text-lg leading-snug mt-0.5', nueva ? 'font-semibold' : 'font-medium text-ink-soft')}>{MOTIVO_CONSULTA_TEXTO[c.motivo]}</span>
                        <span className="block text-ink-muted text-[15px] mt-0.5 line-clamp-2">{resumenConsulta(c)}</span>
                      </span>
                      <ChevronRight className="h-5 w-5 text-ink-muted shrink-0 mt-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {abierto && (
        <Hoja abierta onCerrar={() => setAbiertoId(null)} titulo="Aviso">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span>{cap(format(parseISO(abierto.aviso.publicadoEl), "EEEE d 'de' MMMM, HH:mm", { locale: es }))}</span>
            {abierto.aviso.importante && <Chip tono="rojo">Importante</Chip>}
          </div>
          <h3 className="text-2xl font-semibold mt-2 leading-tight">{abierto.aviso.titulo}</h3>
          <p className="mt-3 text-[17px] leading-relaxed whitespace-pre-line">{abierto.aviso.cuerpo}</p>
        </Hoja>
      )}

      {escribir && <HojaEscribir onCerrar={() => setEscribir(false)} onEnviada={(id) => { setEscribir(false); setPestanaEstado('CONSULTAS'); setConsultaId(id); }} />}

      {consulta && (
        <Hoja abierta onCerrar={() => setConsultaId(null)} titulo={MOTIVO_CONSULTA_TEXTO[consulta.motivo]}>
          <Conversacion consulta={consulta} lado="CLIENTE" />
          <div className="mt-4 pt-4 border-t border-ink/10">
            {buzonActivo ? (
              <CajaMensaje
                placeholder={consulta.estado === 'CERRADA' ? 'Si necesitas algo más, escríbelo aquí…' : 'Escribe aquí…'}
                pie={<p>{textoHorarioBuzon(db.config, ahora)}</p>}
                onEnviar={async (texto) => {
                  const r = await ejecutar('responderConsulta', { consultaId: consulta.id, texto });
                  if (!r.ok) toast.error(r.error);
                  return r.ok;
                }}
              />
            ) : <p className="text-sm text-ink-muted">Ahora mismo no se puede escribir al centro desde la app.</p>}
          </div>
        </Hoja>
      )}
    </div>
  );
}

/** "Escribir al centro": motivo, mensaje y cuándo se contesta. */
function HojaEscribir({ onCerrar, onEnviada }: { onCerrar: () => void; onEnviada: (consultaId: string) => void }) {
  const { db } = useCliente();
  const ejecutar = useStore((s) => s.ejecutar);
  const [motivo, setMotivo] = useState<MotivoConsulta | null>(null);
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Escribir al centro">
      <fieldset>
        <legend className="block text-[15px] font-semibold mb-2">¿Sobre qué es?</legend>
        <div className="space-y-2">
          {MOTIVOS_CONSULTA.map((m) => (
            <label key={m.valor} className={cn('flex items-start gap-3 rounded-2xl border p-3 tap cursor-pointer', motivo === m.valor ? 'border-brand-500 bg-beige-50' : 'border-ink/10 bg-white')}>
              <input type="radio" name="motivo" className="mt-1 h-5 w-5 accent-[#3A3A3A]" checked={motivo === m.valor} onChange={() => setMotivo(m.valor)} />
              <span><span className="block font-semibold leading-tight">{m.texto}</span><span className="block text-sm text-ink-muted">{m.ayuda}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4">
        <CajaMensaje
          placeholder="Escribe aquí tu mensaje…"
          pie={<><p>{textoHorarioBuzon(db.config, new Date())}</p><p className="mt-1">Tu mensaje solo lo lee la dirección del centro. Si es urgente, mejor llama.</p></>}
          onEnviar={async (texto) => {
            if (!motivo) { toast.error('Elige sobre qué es tu consulta.'); return false; }
            const r = await ejecutar('enviarConsulta', { motivo, texto });
            if (!r.ok) { toast.error(r.error); return false; }
            toast.ok('Mensaje enviado. Te avisaremos cuando te contestemos.');
            onEnviada(r.valor.id);
            return true;
          }}
        />
      </div>
    </Hoja>
  );
}
