/**
 * Generador mínimo de hojas de cálculo Excel (.xlsx), sin librerías: varias hojas, la
 * primera fila en negrita y textos o números. Suficiente para "Descargar los datos".
 *
 * Un .xlsx es un ZIP con unos XML dentro; aquí se empaqueta sin comprimir (método "store").
 */

export type Celda = string | number | null | undefined;
export interface Hoja {
  nombre: string;
  filas: Celda[][];
  /** Ancho de cada columna (en caracteres). */
  anchos?: number[];
}

const enc = new TextEncoder();

function xml(texto: string): string {
  return texto
    // Caracteres de control no válidos en XML (salvo tabulador y saltos de línea).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function letraColumna(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function nombreHoja(nombre: string, usados: Set<string>): string {
  let base = nombre.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let n = 2;
  while (usados.has(base.toLowerCase())) base = `${base.slice(0, 28)} ${n++}`;
  usados.add(base.toLowerCase());
  return base;
}

function hojaXml(h: Hoja): string {
  const filas = h.filas.map((fila, r) => {
    const celdas = fila.map((v, c) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = `${letraColumna(c)}${r + 1}`;
      const estilo = r === 0 ? ' s="1"' : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${estilo}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${estilo}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${celdas}</row>`;
  }).join('');
  const cols = h.anchos?.length
    ? `<cols>${h.anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const fijar = h.filas.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fijar}${cols}<sheetData>${filas}</sheetData></worksheet>`;
}

// ---------------------------------------------------------------------------
// ZIP sin compresión
// ---------------------------------------------------------------------------

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(archivos: { nombre: string; datos: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let desplazamiento = 0;
  for (const a of archivos) {
    const nombre = enc.encode(a.nombre);
    const crc = crc32(a.datos);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8
    local.setUint16(8, 0, true); local.setUint32(14, crc, true);
    local.setUint32(18, a.datos.length, true); local.setUint32(22, a.datos.length, true); local.setUint16(26, nombre.length, true);
    partes.push(new Uint8Array(local.buffer), nombre, a.datos);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, a.datos.length, true); cd.setUint32(24, a.datos.length, true);
    cd.setUint16(28, nombre.length, true); cd.setUint32(42, desplazamiento, true);
    central.push(new Uint8Array(cd.buffer), nombre);
    desplazamiento += 30 + nombre.length + a.datos.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, desplazamiento, true);
  const todo = [...partes, ...central, new Uint8Array(fin.buffer)];
  const salida = new Uint8Array(todo.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of todo) { salida.set(p, i); i += p.length; }
  return salida;
}

/** Libro de Excel con las hojas indicadas (bytes del .xlsx). */
export function crearXlsx(hojas: Hoja[]): Uint8Array<ArrayBuffer> {
  const usados = new Set<string>();
  const nombres = hojas.map((h) => nombreHoja(h.nombre, usados));
  const archivos = [
    { nombre: '[Content_Types].xml', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { nombre: '_rels/.rels', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nombre: 'xl/workbook.xml', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { nombre: 'xl/_rels/workbook.xml.rels', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nombre: 'xl/styles.xml', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, texto: hojaXml(h) })),
  ];
  return zip(archivos.map((a) => ({ nombre: a.nombre, datos: enc.encode(a.texto) })));
}
