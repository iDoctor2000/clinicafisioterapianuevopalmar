import { useEffect, useState } from 'react';
import type { Cliente } from '@/domain/types';
import { useModo } from '@/data/store';
import { urlFoto } from '@/data/supabase/fotos';

/**
 * URL lista para `<img>` de la foto de un cliente, o null (sin foto o aún resolviendo).
 * En DEMO `fotoUrl` ya es una data URL. En SUPABASE es la ruta del objeto en el bucket
 * privado: se firma de forma asíncrona (con caché en memoria) y mientras tanto se
 * muestran las iniciales.
 */
export function useFotoCliente(cliente: Pick<Cliente, 'id' | 'fotoUrl'> | null | undefined): string | null {
  const modo = useModo();
  const id = cliente?.id ?? null;
  const fotoUrl = cliente?.fotoUrl ?? null;
  const directa = !fotoUrl || modo === 'DEMO' || /^(data:|blob:|https?:)/i.test(fotoUrl);
  const [firmada, setFirmada] = useState<{ clave: string; url: string | null } | null>(null);

  useEffect(() => {
    if (directa || !id || !fotoUrl) return;
    let vivo = true;
    void urlFoto(id, fotoUrl).then((url) => { if (vivo) setFirmada({ clave: fotoUrl, url }); });
    return () => { vivo = false; };
  }, [directa, id, fotoUrl]);

  if (directa) return fotoUrl;
  return firmada && firmada.clave === fotoUrl ? firmada.url : null;
}
