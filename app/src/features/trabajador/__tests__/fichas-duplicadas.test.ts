/** 0051: al crear una ficha, se detectan las que tienen el mismo nombre (sin tildes, mayúsculas ni espacios de más). */
import { describe, expect, it } from 'vitest';
import type { Db } from '@/data/db';
import { crearSeed } from '@/data/seed';
import { fichasConMismoNombre } from '../consultas';

describe('fichas con el mismo nombre', () => {
  it('encuentra la misma persona escrita de otra forma, y no a otras', () => {
    const db0 = crearSeed();
    const c = db0.clientes[0];
    const db: Db = { ...db0, clientes: [...db0.clientes, { ...c, id: 'otra', activo: false }] };
    const conTildes = `${c.nombre.toUpperCase()}`;
    expect(fichasConMismoNombre(db, conTildes, `  ${c.apellidos}  `).map((x) => x.id).sort()).toEqual([c.id, 'otra'].sort());
    expect(fichasConMismoNombre(db, c.nombre, c.apellidos, c.id).map((x) => x.id)).toEqual(['otra']);
    expect(fichasConMismoNombre(db, 'Nadie', 'Inventado')).toEqual([]);
    expect(fichasConMismoNombre(db, 'Álvaro', 'Pérez')).toEqual(fichasConMismoNombre(db, 'alvaro', 'perez'));
  });
});
