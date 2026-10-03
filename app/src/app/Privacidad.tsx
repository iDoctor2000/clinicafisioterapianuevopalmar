/**
 * Política de privacidad (ruta #/privacidad, accesible sin sesión) y texto de consentimiento.
 *
 * LA FUENTE DEL TEXTO ES docs/PRIVACIDAD.md: se importa tal cual (Vite `?raw`) y se maqueta con el
 * mini-renderizador de markdown de este archivo (títulos, listas, negritas, citas, tabla y separadores;
 * es lo único que usa el documento). No hay que copiar el texto legal a mano: al editar el .md cambia
 * la página y el texto de consentimiento. Los corchetes [...] son datos pendientes y se muestran tal cual.
 */
import { Fragment, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ShieldCheck } from 'lucide-react';
import politicaMd from '../../../docs/PRIVACIDAD.md?raw';
import { Boton } from '@/ui';

// ---------------------------------------------------------------------------
// Mini-renderizador de markdown (solo lo que usa docs/PRIVACIDAD.md)
// ---------------------------------------------------------------------------

type Bloque =
  | { tipo: 'h1' | 'h2' | 'p' | 'cita'; lineas: string[] }
  | { tipo: 'lista'; ordenada: boolean; items: string[] }
  | { tipo: 'tabla'; cabecera: string[]; filas: string[][] }
  | { tipo: 'hr' };

function celdas(linea: string): string[] {
  return linea.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function parsearMarkdown(md: string): Bloque[] {
  const lineas = md.replace(/\r\n/g, '\n').split('\n');
  const bloques: Bloque[] = [];
  let i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    const t = l.trim();
    if (!t) { i++; continue; }
    if (t === '---') { bloques.push({ tipo: 'hr' }); i++; continue; }
    if (t.startsWith('# ')) { bloques.push({ tipo: 'h1', lineas: [t.slice(2)] }); i++; continue; }
    if (t.startsWith('## ')) { bloques.push({ tipo: 'h2', lineas: [t.slice(3)] }); i++; continue; }
    if (t.startsWith('>')) {
      const ls: string[] = [];
      while (i < lineas.length && lineas[i].trim().startsWith('>')) { ls.push(lineas[i].trim().replace(/^>\s?/, '')); i++; }
      bloques.push({ tipo: 'cita', lineas: ls });
      continue;
    }
    if (t.startsWith('|')) {
      const cabecera = celdas(t);
      i++;
      if (i < lineas.length && /^\|?\s*:?-{3,}/.test(lineas[i].trim())) i++; // separador |---|
      const filas: string[][] = [];
      while (i < lineas.length && lineas[i].trim().startsWith('|')) { filas.push(celdas(lineas[i])); i++; }
      bloques.push({ tipo: 'tabla', cabecera, filas });
      continue;
    }
    const noOrdenada = /^[-*]\s+/.test(t);
    const ordenada = /^\d+\.\s+/.test(t);
    if (noOrdenada || ordenada) {
      const items: string[] = [];
      const re = noOrdenada ? /^[-*]\s+/ : /^\d+\.\s+/;
      while (i < lineas.length && re.test(lineas[i].trim())) { items.push(lineas[i].trim().replace(re, '')); i++; }
      bloques.push({ tipo: 'lista', ordenada, items });
      continue;
    }
    const ls: string[] = [];
    while (i < lineas.length && lineas[i].trim() && !/^(#|>|\||---|[-*]\s|\d+\.\s)/.test(lineas[i].trim())) { ls.push(lineas[i].trim()); i++; }
    bloques.push({ tipo: 'p', lineas: ls });
  }
  return bloques;
}

/** Negritas (**...**) y enlaces automáticos para correos y direcciones www. */
export function Inline({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {partes.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? <strong key={i} className="font-semibold text-ink">{enlazar(p.slice(2, -2))}</strong> : <Fragment key={i}>{enlazar(p)}</Fragment>,
      )}
    </>
  );
}

function enlazar(texto: string): ReactNode {
  const trozos = texto.split(/([\w.+-]+@[\w-]+\.[\w.-]+|www\.[\w-]+\.[\w./-]+)/g).filter(Boolean);
  return trozos.map((t, i) => {
    if (/^[\w.+-]+@/.test(t)) return <a key={i} href={`mailto:${t}`} className="text-beige-600 underline underline-offset-4 break-all">{t}</a>;
    if (t.startsWith('www.')) return <a key={i} href={`https://${t}`} target="_blank" rel="noreferrer" className="text-beige-600 underline underline-offset-4">{t}</a>;
    return <Fragment key={i}>{t}</Fragment>;
  });
}

function Lineas({ lineas }: { lineas: string[] }) {
  return (
    <>
      {lineas.map((l, i) => (
        <Fragment key={i}>{i > 0 && <br />}<Inline texto={l} /></Fragment>
      ))}
    </>
  );
}

function BloqueVista({ b }: { b: Bloque }) {
  switch (b.tipo) {
    case 'h1': return <h1 className="text-3xl sm:text-4xl leading-tight mb-2"><Inline texto={b.lineas[0]} /></h1>;
    case 'h2': return <h2 className="text-2xl leading-snug mt-10 mb-3"><Inline texto={b.lineas[0]} /></h2>;
    case 'p': return <p className="text-[17px] leading-relaxed text-ink-soft mb-4"><Lineas lineas={b.lineas} /></p>;
    case 'cita': return <blockquote className="border-l-4 border-beige-300 bg-beige-50/60 rounded-r-2xl px-4 py-3 text-[17px] leading-relaxed text-ink mb-4"><Lineas lineas={b.lineas} /></blockquote>;
    case 'hr': return <hr className="my-10 border-ink/10" />;
    case 'lista': {
      const Tag = b.ordenada ? 'ol' : 'ul';
      return (
        <Tag className={`${b.ordenada ? 'list-decimal' : 'list-disc'} pl-6 space-y-2 text-[17px] leading-relaxed text-ink-soft mb-4 marker:text-beige-500`}>
          {b.items.map((it, i) => <li key={i} className="pl-1"><Inline texto={it} /></li>)}
        </Tag>
      );
    }
    case 'tabla': return <Tabla cabecera={b.cabecera} filas={b.filas} />;
  }
}

/** En móvil, una tarjeta por fila (etiqueta: valor); en escritorio, tabla clásica. */
function Tabla({ cabecera, filas }: { cabecera: string[]; filas: string[][] }) {
  return (
    <div className="mb-4">
      <div className="sm:hidden space-y-3">
        {filas.map((f, i) => (
          <div key={i} className="rounded-2xl border border-ink/10 bg-white p-4">
            <p className="font-semibold text-lg mb-2"><Inline texto={f[0] ?? ''} /></p>
            {cabecera.slice(1).map((c, j) => (
              <div key={j} className="mb-2 last:mb-0">
                <p className="text-sm text-ink-muted"><Inline texto={c} /></p>
                <p className="text-[17px] leading-relaxed text-ink-soft"><Inline texto={f[j + 1] ?? ''} /></p>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="hidden sm:block overflow-x-auto rounded-2xl border border-ink/10 bg-white">
        <table className="w-full text-left text-[16px] leading-relaxed">
          <thead className="bg-sand">
            <tr>{cabecera.map((c, i) => <th key={i} className="px-4 py-3 font-semibold text-ink align-top"><Inline texto={c} /></th>)}</tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className="border-t border-ink/5 align-top">
                {f.map((c, j) => <td key={j} className={`px-4 py-3 ${j === 0 ? 'font-semibold text-ink' : 'text-ink-soft'}`}><Inline texto={c} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Texto de consentimiento (sección "Texto de consentimiento" del .md)
// ---------------------------------------------------------------------------

const BLOQUES = parsearMarkdown(politicaMd);

/** Líneas de la cita que sigue al título "Texto de consentimiento..." en docs/PRIVACIDAD.md. */
export function lineasConsentimiento(): string[] {
  const idx = BLOQUES.findIndex((b) => b.tipo === 'h2' && /^Texto de consentimiento/i.test(b.lineas[0]));
  const cita = idx >= 0 ? BLOQUES.slice(idx + 1).find((b) => b.tipo === 'cita') : undefined;
  return cita && cita.tipo === 'cita' ? cita.lineas : ['He leído la política de privacidad y consiento el tratamiento de mis datos.'];
}

/** El texto de consentimiento maquetado (negritas), sin envoltorio: va dentro de la casilla de aceptación. */
export function TextoConsentimiento() {
  return <Lineas lineas={lineasConsentimiento()} />;
}

/** Enlace a la política, para pies de página y casillas. */
export function EnlacePrivacidad({ children = 'Política de privacidad', className = '' }: { children?: ReactNode; className?: string }) {
  return <Link to="/privacidad" className={`text-beige-600 font-semibold underline underline-offset-4 ${className}`}>{children}</Link>;
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function Privacidad() {
  const navegar = useNavigate();
  const volver = () => {
    if (window.history.length > 1) navegar(-1);
    else navegar('/', { replace: true });
  };
  return (
    <div className="min-h-dvh bg-sand">
      <header className="sticky top-0 z-10 bg-sand/95 backdrop-blur border-b border-ink/5 pt-safe">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-2">
          <Boton variante="fantasma" tamano="sm" onClick={volver} className="-ml-3"><ChevronLeft className="h-5 w-5" /> Volver</Boton>
          <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-ink-muted"><ShieldCheck className="h-4 w-4 text-beige-600" /> Nuevo Palmar Pilates</span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 pb-16">
        <article>
          {BLOQUES.map((b, i) => <BloqueVista key={i} b={b} />)}
        </article>
        <div className="mt-10">
          <Boton tamano="lg" ancho variante="secundario" onClick={volver}><ChevronLeft className="h-5 w-5" /> Volver</Boton>
        </div>
      </main>
    </div>
  );
}
