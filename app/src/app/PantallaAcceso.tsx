import { useState } from 'react';
import { ChevronRight, Lock, RotateCcw, ShieldCheck, User, Users } from 'lucide-react';
import { useStore } from '@/data/store';
import { Boton, Tarjeta } from '@/ui';
import { nombreCompleto, tarifaDe, contratoActivoDe } from '@/data/selectores';
import { cn } from '@/lib/cn';

/**
 * Acceso de demostración: se elige un usuario sin contraseña.
 * En producción esta pantalla será email + contraseña (o enlace mágico) con Supabase Auth.
 */
export function PantallaAcceso() {
  const db = useStore((s) => s.db);
  const iniciar = useStore((s) => s.iniciarSesion);
  const reiniciar = useStore((s) => s.reiniciarDemo);
  const [pestana, setPestana] = useState<'CLIENTE' | 'TRABAJADOR'>('CLIENTE');

  const clientes = db.clientes.filter((c) => c.activo).slice(0, 6);

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="pt-safe px-6 pt-10 pb-6 text-center">
        <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-20 w-20 mx-auto mb-4" />
        <h1 className="text-3xl leading-tight">Nuevo Palmar <span className="text-brand-600">Pilates</span></h1>
        <p className="text-ink-muted mt-2">Reserva tus clases en dos toques.</p>
      </header>

      <main className="flex-1 px-4 pb-10 max-w-lg w-full mx-auto">
        <div className="flex rounded-2xl bg-sand-deep p-1 mb-4" role="tablist">
          {(['CLIENTE', 'TRABAJADOR'] as const).map((t) => (
            <button
              key={t} role="tab" aria-selected={pestana === t} onClick={() => setPestana(t)}
              className={cn('flex-1 h-11 rounded-xl font-semibold flex items-center justify-center gap-2 tap', pestana === t ? 'bg-white shadow-card text-ink' : 'text-ink-soft')}
            >
              {t === 'CLIENTE' ? <User className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
              {t === 'CLIENTE' ? 'Soy cliente' : 'Soy del equipo'}
            </button>
          ))}
        </div>

        <Tarjeta className="p-2">
          {(pestana === 'CLIENTE' ? clientes : db.trabajadores).map((p) => {
            const esCliente = pestana === 'CLIENTE';
            const contrato = esCliente ? contratoActivoDe(db, p.id) : null;
            const tarifa = esCliente ? tarifaDe(db, contrato) : null;
            const sub = esCliente
              ? `${tarifa?.nombre ?? 'Sin tarifa'}${contrato ? (contrato.modalidad === 'FIJO' ? ' · horario fijo' : ' · turno libre') : ''}`
              : { ADMIN: 'Administrador', MONITOR: 'Monitor/a', RECEPCION: 'Recepción' }[(p as (typeof db.trabajadores)[number]).rol];
            return (
              <button
                key={p.id} type="button" onClick={() => iniciar(p.userId!)}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-sand tap text-left"
              >
                <span className="h-11 w-11 rounded-full bg-brand-100 text-brand-800 font-bold flex items-center justify-center shrink-0">
                  {p.nombre[0]}{p.apellidos[0]}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold truncate">{nombreCompleto(p)}</span>
                  <span className="block text-sm text-ink-muted truncate">{sub}</span>
                </span>
                <ChevronRight className="h-5 w-5 text-ink-muted" />
              </button>
            );
          })}
        </Tarjeta>

        <p className="text-center text-sm text-ink-muted mt-6 flex items-center justify-center gap-1.5">
          <Lock className="h-4 w-4" /> Versión de demostración: acceso sin contraseña.
        </p>
        <div className="flex justify-center mt-3">
          <Boton variante="fantasma" tamano="sm" onClick={() => { if (confirm('¿Restaurar los datos de demostración?')) reiniciar(); }}>
            <RotateCcw className="h-4 w-4" /> Restaurar datos de demo
          </Boton>
        </div>
        <p className="text-center text-xs text-ink-muted mt-8 flex items-center justify-center gap-1"><Users className="h-3.5 w-3.5" /> Clínica de Fisioterapia Nuevo Palmar · El Palmar, Murcia</p>
      </main>
    </div>
  );
}
