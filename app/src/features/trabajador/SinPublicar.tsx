import { useState } from 'react';
import { EyeOff } from 'lucide-react';
import { AreaTexto, Boton, Chip, Hoja, Interruptor, toast } from '@/ui';
import { useTrabajador } from './useTrabajador';
import { cambiosSinPublicar } from './consultas';

/**
 * Cambios del horario sin publicar (0039): franjas y clases en borrador y plazas retenidas. Lo ve todo el
 * equipo; solo quien gestiona el horario puede publicar.
 */
export function BannerSinPublicar() {
  const { db, gestionaHorario } = useTrabajador();
  const [abierta, setAbierta] = useState(false);
  const cambios = cambiosSinPublicar(db, new Date());
  if (!cambios.hay) return null;
  const partes = [
    cambios.franjas.length > 0 ? `${cambios.franjas.length === 1 ? '1 franja nueva' : `${cambios.franjas.length} franjas nuevas`}` : '',
    cambios.clases.length > 0 ? `${cambios.clases.length === 1 ? '1 clase' : `${cambios.clases.length} clases`} sin publicar` : '',
    cambios.plazas > 0 ? `${cambios.plazas === 1 ? '1 plaza retenida' : `${cambios.plazas} plazas retenidas`}` : '',
  ].filter(Boolean);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-sky/10 border border-sky/30 px-4 py-3">
        <EyeOff className="h-5 w-5 text-sky shrink-0" />
        <span className="flex-1 min-w-[12rem] text-ink-soft">
          <strong className="text-ink">Cambios sin publicar:</strong> {partes.join(' · ')}. Los alumnos todavía no lo ven.
          {!gestionaHorario && ' Lo publica quien gestiona el horario.'}
        </span>
        {gestionaHorario && <Boton tamano="sm" onClick={() => setAbierta(true)}>Publicar cambios</Boton>}
      </div>
      {abierta && <HojaPublicar onCerrar={() => setAbierta(false)} />}
    </>
  );
}

function HojaPublicar({ onCerrar }: { onCerrar: () => void }) {
  const { db, ejecutar } = useTrabajador();
  const cambios = cambiosSinPublicar(db, new Date());
  const [avisar, setAvisar] = useState(cambios.franjas.length > 0 || cambios.clases.length > 0);
  const [texto, setTexto] = useState('Hemos actualizado el horario. Échale un vistazo en la app.');
  const [enviando, setEnviando] = useState(false);
  const publicar = async () => {
    if (enviando) return;
    setEnviando(true);
    const r = await ejecutar('publicarCambios', { avisar, texto });
    setEnviando(false);
    if (!r.ok) return toast.error(r.error);
    const v = r.valor;
    toast.ok(`Cambios publicados: ${v.franjas} franjas y ${v.clases} clases visibles, ${v.plazas} plazas liberadas${v.avisoId ? '. Se ha avisado a todos los alumnos' : ''}.`);
    onCerrar();
  };
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Publicar cambios">
      <div className="space-y-4 text-ink-soft">
        <p>A partir de ahora los alumnos verán:</p>
        <ul className="space-y-1.5">
          <li className="flex items-center gap-2"><Chip tono="azul">{cambios.franjas.length}</Chip> franjas nuevas del horario y todas sus clases</li>
          <li className="flex items-center gap-2"><Chip tono="azul">{cambios.clases.length}</Chip> clases sin publicar (de esas franjas o extraordinarias)</li>
          <li className="flex items-center gap-2"><Chip tono="azul">{cambios.plazas}</Chip> plazas retenidas, que vuelven a poder reservarse (si alguien espera plaza en ellas, entra)</li>
        </ul>
        <div className="rounded-2xl border border-ink/10 px-4">
          <Interruptor activo={avisar} onCambio={setAvisar} etiqueta="Avisar a todos los alumnos" descripcion="Un aviso importante con notificación al móvil." />
        </div>
        {avisar && <AreaTexto etiqueta="Texto del aviso" value={texto} onChange={(e) => setTexto(e.target.value)} />}
        <Boton ancho onClick={() => void publicar()} cargando={enviando}>Publicar ahora</Boton>
        <p className="text-sm text-ink-muted">Mientras no publiques, puedes seguir moviendo alumnos y cambiando franjas con calma: nadie ve los huecos que vas dejando.</p>
      </div>
    </Hoja>
  );
}
