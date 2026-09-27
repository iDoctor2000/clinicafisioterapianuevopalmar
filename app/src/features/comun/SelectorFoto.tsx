import { useEffect, useRef, useState } from 'react';
import { Camera, Image as ImagenIcono, ShieldCheck, Trash2 } from 'lucide-react';
import type { Cliente } from '@/domain/types';
import { useModo, useStore } from '@/data/store';
import { subirFoto } from '@/data/supabase/fotos';
import { blobADataUrl, ErrorImagen, recortarYReducir, TAMANO_FOTO } from '@/lib/imagen';
import { Boton, Hoja, toast } from '@/ui';
import { Avatar } from '@/ui/Avatar';
import { useFotoCliente } from './useFotoCliente';

interface Props {
  abierta: boolean;
  onCerrar: () => void;
  cliente: Pick<Cliente, 'id' | 'nombre' | 'apellidos' | 'fotoUrl'>;
  /** true cuando es el propio cliente quien edita su foto (textos en segunda persona). */
  propio?: boolean;
}

/**
 * Hoja para poner, cambiar o quitar la foto de un cliente. La imagen se recorta a
 * cuadrado y se reduce a 256×256 JPEG en el navegador antes de guardarla
 * (data URL en demo; bucket privado `fotos-clientes` en Supabase).
 */
export function SelectorFoto({ abierta, onCerrar, cliente, propio }: Props) {
  const modo = useModo();
  const ejecutar = useStore((s) => s.ejecutar);
  const actual = useFotoCliente(cliente);
  const [nueva, setNueva] = useState<Blob | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [quitar, setQuitar] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  // Al abrir, estado limpio; al cambiar la vista previa, liberar la anterior.
  useEffect(() => {
    if (!abierta) { setNueva(null); setVista(null); setQuitar(false); setError(null); }
  }, [abierta]);
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista); }, [vista]);

  const elegir = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setProcesando(true);
    try {
      const blob = await recortarYReducir(file, TAMANO_FOTO);
      setNueva(blob);
      setVista(URL.createObjectURL(blob));
      setQuitar(false);
    } catch (e) {
      setError(e instanceof ErrorImagen ? e.message : 'No se ha podido procesar la imagen. Prueba con otra.');
    } finally {
      setProcesando(false);
      if (camara.current) camara.current.value = '';
      if (galeria.current) galeria.current.value = '';
    }
  };

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      let fotoUrl: string | null = null;
      if (!quitar && nueva) fotoUrl = modo === 'SUPABASE' ? await subirFoto(cliente.id, nueva) : await blobADataUrl(nueva);
      const r = await ejecutar('actualizarFotoCliente', { clienteId: cliente.id, fotoUrl });
      if (!r.ok) { setError(r.error); return; }
      toast.ok(quitar ? 'Foto eliminada.' : 'Foto guardada.');
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido guardar la foto.');
    } finally {
      setGuardando(false);
    }
  };

  const hayFoto = Boolean(cliente.fotoUrl);
  const mostrar = quitar ? null : vista ?? actual;
  const cambiado = quitar ? hayFoto : nueva !== null;
  const ocupado = procesando || guardando;

  return (
    <Hoja abierta={abierta} onCerrar={ocupado ? () => undefined : onCerrar} titulo={hayFoto ? 'Cambiar foto' : 'Poner foto'}>
      <div className="flex flex-col items-center py-2">
        <Avatar nombre={cliente.nombre} apellidos={cliente.apellidos} fotoUrl={mostrar} tamano="xl" />
        <p className="text-sm text-ink-muted mt-2 min-h-5" aria-live="polite">
          {procesando ? 'Preparando la imagen…' : nueva && !quitar ? `Nueva foto lista (${Math.max(1, Math.round(nueva.size / 1024))} KB)` : quitar ? 'Se quitará la foto' : hayFoto ? 'Foto actual' : 'Sin foto'}
        </p>
      </div>

      {/* En móvil, `capture="user"` abre directamente la cámara frontal; sin `capture`, la galería. */}
      <input ref={camara} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void elegir(e.target.files?.[0])} />
      <input ref={galeria} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void elegir(e.target.files?.[0])} />

      <div className="grid gap-2 mt-2">
        <Boton tamano="lg" ancho variante="secundario" disabled={ocupado} onClick={() => camara.current?.click()}><Camera className="h-6 w-6" /> Hacer una foto</Boton>
        <Boton tamano="lg" ancho variante="secundario" disabled={ocupado} onClick={() => galeria.current?.click()}><ImagenIcono className="h-6 w-6" /> Elegir de la galería</Boton>
        {(hayFoto || nueva) && !quitar && (
          <Boton tamano="lg" ancho variante="peligro" disabled={ocupado} onClick={() => { setQuitar(true); setNueva(null); if (vista) { URL.revokeObjectURL(vista); setVista(null); } }}>
            <Trash2 className="h-6 w-6" /> Quitar foto
          </Boton>
        )}
      </div>

      {error && <p role="alert" className="mt-3 rounded-2xl bg-rose/10 text-rose px-4 py-3 text-[15px]">{error}</p>}

      <p className="mt-4 text-sm text-ink-muted leading-relaxed flex gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{propio ? 'La foto solo la ve el personal del centro para identificarte en clase. Puedes quitarla cuando quieras.' : 'La foto solo la ve el personal del centro para identificar al cliente en clase. El cliente puede quitarla cuando quiera desde su perfil.'}</span>
      </p>

      <div className="mt-5 grid gap-2">
        <Boton tamano="lg" ancho disabled={!cambiado || procesando} cargando={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar'}</Boton>
        <Boton tamano="lg" ancho variante="fantasma" disabled={ocupado} onClick={onCerrar}>Cancelar</Boton>
      </div>
    </Hoja>
  );
}
