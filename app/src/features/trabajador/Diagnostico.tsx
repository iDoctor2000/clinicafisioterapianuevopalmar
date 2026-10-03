import { useMemo, useState } from 'react';
import { Bug, ClipboardCopy, Eye, EyeOff, Share2, Trash2 } from 'lucide-react';
import { useStore } from '@/data/store';
import { borrarRegistro, compartirInforme, copiarInforme, eventosRegistrados, generarInforme, type ContextoInforme } from '@/lib/diagnostico';
import { Boton, Tarjeta, toast } from '@/ui';
import { useTrabajador } from './useTrabajador';
import { Confirmacion, Seccion } from './comunes';

/**
 * Informe de diagnóstico (Ajustes): reúne la cronología de la app, el entorno del dispositivo,
 * la sesión y un resumen de los datos, y lo comparte como archivo de texto.
 */
export function Diagnostico() {
  const { db, sesion, ambito } = useTrabajador();
  const modo = useStore((s) => s.modo);
  const usuarioAuth = useStore((s) => s.usuarioAuth);
  const errorCarga = useStore((s) => s.errorCarga);
  const ultimoError = useStore((s) => s.ultimoError);
  const [ocupado, setOcupado] = useState<'compartir' | 'copiar' | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [tick, setTick] = useState(0);

  const eventos = useMemo(() => eventosRegistrados(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const errores = eventos.filter((e) => e.tipo === 'error' || (e.tipo === 'comando' && e.mensaje.includes('FALLIDO'))).length;

  const contexto = (): ContextoInforme => {
    const hoy = new Date().toISOString().slice(0, 10);
    const porEstado = (lista: { estado: string }[]) => lista.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x.estado]: (acc[x.estado] ?? 0) + 1 }), {});
    const servidor = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || null;
    return {
      modo,
      version: __APP_VERSION__,
      compilado: __BUILD_TIME__,
      servidor: servidor ? new URL(servidor).host : null,
      sesion: { ...sesion, ambito },
      usuarioAuth,
      ultimoError,
      errorCarga,
      datos: {
        'Configuración del centro': db.config,
        'Resumen de datos': {
          actividades: db.actividades.length,
          tarifas: db.tarifas.length,
          clientes: `${db.clientes.length} (activos ${db.clientes.filter((c) => c.activo).length}, con usuario ${db.clientes.filter((c) => c.userId).length}, con consentimiento ${db.clientes.filter((c) => c.consentimientoEl).length})`,
          contratos: porEstado(db.contratos),
          plantillas: `${db.plantillas.length} (activas ${db.plantillas.filter((p) => p.activa).length})`,
          clases: `${db.clases.length} (hoy ${db.clases.filter((c) => c.fecha === hoy).length}, futuras ${db.clases.filter((c) => c.fecha > hoy).length}, canceladas ${db.clases.filter((c) => c.estado === 'CANCELADA').length})`,
          reservas: porEstado(db.reservas),
          recuperaciones: porEstado(db.recuperaciones),
          avisos: db.avisos.length,
          usuarios: db.usuarios.length,
          fotosPortada: db.portada.length,
          versionDatos: db.version,
        },
        'Equipo': db.trabajadores.map((t) => ({ nombre: `${t.nombre} ${t.apellidos}`, rol: t.rol, ambito: t.ambito, activo: t.activo, imparte: t.esMonitor, permisos: t.permisos.length, usuario: !!t.userId })),
        'Clases de hoy': db.clases.filter((c) => c.fecha === hoy).map((c) => ({ id: c.id, hora: c.horaInicio, actividad: db.actividades.find((a) => a.id === c.actividadId)?.nombre, estado: c.estado, plazas: c.plazas, reservas: db.reservas.filter((r) => r.claseId === c.id && r.estado === 'RESERVADA').length })),
        'Últimos 80 registros de cambios': db.auditoria.slice(-80).map((a) => `${a.instante} · ${a.actorNombre} · ${a.accion} · ${a.entidad} ${a.entidadId} · ${a.detalle}`).join('\n') || '(ninguno)',
      },
    };
  };

  const compartir = async () => {
    setOcupado('compartir');
    try {
      const texto = await generarInforme(contexto());
      const r = await compartirInforme(texto);
      if (r === 'compartido') toast.ok('Informe compartido.');
      else if (r === 'descargado') toast.ok('Informe descargado. Adjúntalo al mensaje de la incidencia.');
    } catch (e) {
      toast.error(`No se ha podido generar el informe: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(null);
      setTick((t) => t + 1);
    }
  };

  const copiar = async () => {
    setOcupado('copiar');
    try {
      const texto = await generarInforme(contexto());
      if (await copiarInforme(texto)) toast.ok('Informe copiado al portapapeles.');
      else {
        setVista(texto);
        toast.info('No se ha podido copiar automáticamente: selecciona el texto de abajo.');
      }
    } finally {
      setOcupado(null);
    }
  };

  const ver = async () => {
    if (vista) return setVista(null);
    setVista(await generarInforme(contexto()));
  };

  return (
    <Tarjeta className="p-4 sm:p-6">
      <Seccion
        titulo={<span className="flex items-center gap-2"><Bug className="h-5 w-5 text-ink-muted" /> Diagnóstico</span>}
        acciones={<span className="text-sm text-ink-muted">{eventos.length} eventos · {errores} errores</span>}
      >
        <p className="text-sm text-ink-soft">
          Si algo falla, genera el informe y compártelo con quien mantiene la app. Incluye qué se ha hecho en la app en este dispositivo (pantallas, acciones, errores),
          el estado del navegador y las notificaciones, la sesión y un resumen de los datos. No contiene contraseñas ni fotos.
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Boton onClick={() => void compartir()} cargando={ocupado === 'compartir'}><Share2 className="h-5 w-5" /> Compartir informe</Boton>
          <Boton variante="secundario" onClick={() => void copiar()} cargando={ocupado === 'copiar'}><ClipboardCopy className="h-5 w-5" /> Copiar</Boton>
          <Boton variante="secundario" onClick={() => void ver()}>{vista ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />} {vista ? 'Ocultar' : 'Ver'}</Boton>
          <Boton variante="suave" onClick={() => setConfirmarBorrado(true)}><Trash2 className="h-5 w-5" /> Borrar registro</Boton>
        </div>
        {vista && (
          <pre className="mt-4 max-h-96 overflow-auto rounded-xl bg-sand p-3 text-[11px] leading-snug whitespace-pre-wrap break-words select-all" aria-label="Informe de diagnóstico">{vista}</pre>
        )}
        <Confirmacion abierta={confirmarBorrado} onCerrar={() => setConfirmarBorrado(false)} titulo="Borrar el registro de diagnóstico" textoConfirmar="Borrar" peligro onConfirmar={() => { borrarRegistro(); setConfirmarBorrado(false); setVista(null); setTick((t) => t + 1); toast.ok('Registro borrado.'); }}>
          <p>Se vacía la cronología guardada en este dispositivo. Hazlo solo si ya has enviado el informe o si quieres empezar a registrar desde cero para reproducir un fallo.</p>
        </Confirmacion>
      </Seccion>
    </Tarjeta>
  );
}
