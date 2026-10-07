/** El Excel de "Descargar los datos" se genera con todas las hojas y se puede abrir. */
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { crearSeed } from '@/data/seed';
import { hojasDeDatos } from '@/data/exportar';
import { crearXlsx } from '@/lib/xlsx';

describe('exportar datos a Excel', () => {
  it('incluye clientes, contrataciones, cobros y, si se pide, la información clínica', () => {
    const db = crearSeed();
    const con = hojasDeDatos(db, { conClinica: true, generadoEl: new Date() });
    const sin = hojasDeDatos(db, { conClinica: false, generadoEl: new Date() });
    expect(con.map((h) => h.nombre)).toEqual(['Léeme', 'Clientes', 'Información clínica', 'Contrataciones', 'Cobros', 'Horario', 'Tarifas', 'Actividades', 'Equipo']);
    expect(sin.map((h) => h.nombre)).not.toContain('Información clínica');
    expect(con.find((h) => h.nombre === 'Clientes')!.filas.length).toBe(db.clientes.length + 1);
    expect(con.find((h) => h.nombre === 'Cobros')!.filas.length).toBe(db.pagos.length + 1);
  });

  it('genera un .xlsx (zip) válido', () => {
    const bytes = crearXlsx(hojasDeDatos(crearSeed(), { conClinica: true, generadoEl: new Date() }));
    expect(bytes[0]).toBe(0x50); // "PK"
    expect(bytes[1]).toBe(0x4b);
    if (process.env.GUARDAR_XLSX) writeFileSync(process.env.GUARDAR_XLSX, bytes);
  });
});
