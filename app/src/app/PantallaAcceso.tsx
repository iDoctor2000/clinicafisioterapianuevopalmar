import { useState, type FormEvent, type ReactNode } from 'react';
import { ChevronRight, Eye, EyeOff, KeyRound, Lock, LogOut, Mail, RotateCcw, ShieldCheck, User, UserPlus, UserX, Users } from 'lucide-react';
import { useStore } from '@/data/store';
import { enviarRecuperacionContrasena, cambiarContrasena, entrarConGoogle } from '@/data/supabase/auth';
import { Boton, Entrada, Tarjeta, toast } from '@/ui';
import { nombreCompleto, tarifaDe, contratoActivoDe } from '@/data/selectores';
import { cn } from '@/lib/cn';

/** Cabecera y pie comunes de las pantallas de acceso. */
function Marco({ children, subtitulo = 'Reserva tus clases en dos toques.' }: { children: ReactNode; subtitulo?: string }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="pt-safe px-6 pt-10 pb-6 text-center">
        <img src={`${import.meta.env.BASE_URL}icons/mark.png`} alt="" className="h-20 w-20 mx-auto mb-4" />
        <h1 className="text-3xl leading-tight">Nuevo Palmar <span className="text-brand-600">Pilates</span></h1>
        <p className="text-ink-muted mt-2">{subtitulo}</p>
      </header>
      <main className="flex-1 px-4 pb-10 max-w-lg w-full mx-auto">
        {children}
        <p className="text-center text-xs text-ink-muted mt-8 flex items-center justify-center gap-1"><Users className="h-3.5 w-3.5" /> Clínica de Fisioterapia Nuevo Palmar · El Palmar, Murcia</p>
      </main>
    </div>
  );
}

/**
 * Pantalla de acceso. En modo SUPABASE: email + contraseña.
 * En modo DEMO: se elige un usuario sin contraseña.
 */
export function PantallaAcceso() {
  const modo = useStore((s) => s.modo);
  return modo === 'SUPABASE' ? <AccesoSupabase /> : <AccesoDemo />;
}

// ---------------------------------------------------------------------------
// Modo producción (Supabase Auth)
// ---------------------------------------------------------------------------

function AccesoSupabase() {
  const usuarioAuth = useStore((s) => s.usuarioAuth);
  const recuperando = useStore((s) => s.recuperandoContrasena);
  if (recuperando) return <NuevaContrasena />;
  if (usuarioAuth) return <SinAlta email={usuarioAuth.email} />;
  return <FormularioEntrada />;
}

function FormularioEntrada() {
  const iniciar = useStore((s) => s.iniciarSesionEmail);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ver, setVer] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [olvido, setOlvido] = useState(false);
  const [primeraVez, setPrimeraVez] = useState(false);
  const [conGoogle, setConGoogle] = useState(false);

  const google = async () => {
    setConGoogle(true);
    setError(null);
    const r = await entrarConGoogle();
    if (!r.ok) {
      setConGoogle(false);
      setError(r.error);
    }
    // Si va bien, el navegador se redirige a Google: no hay nada más que hacer aquí.
  };

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Escribe tu email y tu contraseña.');
    setEnviando(true);
    setError(null);
    const r = await iniciar(email, password);
    setEnviando(false);
    if (!r.ok) setError(r.error);
  };

  if (olvido) return <OlvidoContrasena emailInicial={email} onVolver={() => setOlvido(false)} />;
  if (primeraVez) return <PrimeraVez emailInicial={email} onVolver={() => setPrimeraVez(false)} />;

  return (
    <Marco>
      <Tarjeta className="p-5 sm:p-6">
        <Boton type="button" tamano="lg" ancho variante="secundario" cargando={conGoogle} onClick={google} className="mb-2">
          <LogoGoogle /> Entrar con Google
        </Boton>
        <p className="text-center text-sm text-ink-muted mb-4">Usa el mismo correo de Google que diste en recepción.</p>
        <div className="flex items-center gap-3 mb-4" aria-hidden="true">
          <span className="h-px flex-1 bg-ink/10" /><span className="text-sm text-ink-muted">o con tu contraseña</span><span className="h-px flex-1 bg-ink/10" />
        </div>
        <form onSubmit={entrar} className="space-y-4" noValidate>
          <Entrada
            etiqueta="Email" type="email" inputMode="email" autoComplete="username" placeholder="tu@correo.com"
            value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} className="text-lg h-14"
          />
          <label className="block">
            <span className="block mb-1.5 text-[15px] font-semibold text-ink">Contraseña</span>
            <span className="relative block">
              <input
                type={ver ? 'text' : 'password'} autoComplete="current-password" placeholder="Tu contraseña"
                value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }}
                className="w-full h-14 rounded-2xl border border-ink/10 bg-white pl-4 pr-24 text-lg text-ink placeholder:text-ink-muted focus:border-brand-400 focus:ring-4 focus:ring-brand-100 outline-none"
              />
              <button
                type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-3 rounded-xl text-sm font-semibold text-brand-700 hover:bg-brand-50 flex items-center gap-1 tap"
              >
                {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {ver ? 'Ocultar' : 'Mostrar'}
              </button>
            </span>
          </label>

          {error && (
            <p role="alert" className="rounded-2xl bg-rose/10 text-rose px-4 py-3 text-[15px] font-medium">{error}</p>
          )}

          <Boton type="submit" tamano="lg" ancho cargando={enviando}>Entrar <ChevronRight className="h-5 w-5" /></Boton>
        </form>
        <div className="text-center mt-4">
          <button type="button" onClick={() => setOlvido(true)} className="text-brand-700 font-semibold text-[15px] underline-offset-4 hover:underline tap py-2 px-3">
            He olvidado mi contraseña
          </button>
        </div>
      </Tarjeta>
      <Tarjeta className="mt-4 p-5 sm:p-6 text-center">
        <p className="font-semibold text-lg">¿Es tu primera vez?</p>
        <p className="text-ink-muted text-[15px] mt-1 mb-4">Si ya te han dado de alta en recepción, crea aquí tu contraseña.</p>
        <Boton tamano="lg" ancho variante="suave" onClick={() => setPrimeraVez(true)}>
          <UserPlus className="h-5 w-5" /> Crear mi contraseña
        </Boton>
      </Tarjeta>
      <p className="text-center text-sm text-ink-muted mt-6 flex items-center justify-center gap-1.5">
        <Lock className="h-4 w-4" /> Acceso privado para clientes y personal del centro.
      </p>
    </Marco>
  );
}

function LogoGoogle() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** Primera vez: crear la contraseña con el email que se dio en recepción. */
function PrimeraVez({ emailInicial, onVolver }: { emailInicial: string; onVolver: () => void }) {
  const crear = useStore((s) => s.crearCuentaEmail);
  const [email, setEmail] = useState(emailInicial);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [ver, setVer] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError('Escribe el email que diste en recepción.');
    if (p1.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.');
    if (p1 !== p2) return setError('Las dos contraseñas no coinciden.');
    setEnviando(true);
    setError(null);
    const r = await crear(email, p1);
    setEnviando(false);
    if (!r.ok) return setError(r.error);
    if (r.pendienteConfirmar) setPendiente(true);
  };

  if (pendiente) {
    return (
      <Marco subtitulo="Un último paso">
        <Tarjeta className="p-6 text-center space-y-4">
          <Mail className="h-12 w-12 mx-auto text-brand-600" />
          <p className="text-lg font-semibold">Revisa tu correo</p>
          <p className="text-ink-muted">Hemos enviado un enlace a <strong className="text-ink">{email}</strong> para confirmar tu cuenta. Ábrelo y después entra con tu contraseña.</p>
          <Boton tamano="lg" ancho variante="secundario" onClick={onVolver}>Volver</Boton>
        </Tarjeta>
      </Marco>
    );
  }

  return (
    <Marco subtitulo="Crea tu contraseña">
      <Tarjeta className="p-5 sm:p-6">
        <p className="text-ink-muted text-[15px] mb-4">Usa el <strong className="text-ink">mismo email</strong> que diste en recepción: así reconocemos tu ficha automáticamente. Si tienes cuenta de Google con ese correo, puedes usar "Entrar con Google" directamente, sin crear contraseña.</p>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <Entrada
            etiqueta="Email" type="email" inputMode="email" autoComplete="username" autoFocus placeholder="tu@correo.com"
            value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} className="text-lg h-14"
          />
          <label className="block">
            <span className="block mb-1.5 text-[15px] font-semibold text-ink">Contraseña nueva</span>
            <span className="relative block">
              <input
                type={ver ? 'text' : 'password'} autoComplete="new-password" placeholder="Al menos 6"
                value={p1} onChange={(e) => { setP1(e.target.value); setError(null); }}
                className="w-full h-14 rounded-2xl border border-ink/10 bg-white pl-4 pr-24 text-lg text-ink placeholder:text-ink-muted focus:border-brand-400 focus:ring-4 focus:ring-brand-100 outline-none"
              />
              <button
                type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-3 rounded-xl text-sm font-semibold text-brand-700 hover:bg-brand-50 flex items-center gap-1 tap"
              >
                {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {ver ? 'Ocultar' : 'Mostrar'}
              </button>
            </span>
          </label>
          <Entrada
            etiqueta="Repite la contraseña" type={ver ? 'text' : 'password'} autoComplete="new-password" placeholder="Otra vez"
            value={p2} onChange={(e) => { setP2(e.target.value); setError(null); }} className="text-lg h-14"
          />
          {error && <p role="alert" className="rounded-2xl bg-rose/10 text-rose px-4 py-3 text-[15px] font-medium">{error}</p>}
          <Boton type="submit" tamano="lg" ancho cargando={enviando}>Crear contraseña y entrar <ChevronRight className="h-5 w-5" /></Boton>
        </form>
        <div className="text-center mt-4">
          <button type="button" onClick={onVolver} className="text-ink-soft font-semibold text-[15px] underline-offset-4 hover:underline tap py-2 px-3">
            Volver
          </button>
        </div>
      </Tarjeta>
    </Marco>
  );
}

function OlvidoContrasena({ emailInicial, onVolver }: { emailInicial: string; onVolver: () => void }) {
  const [email, setEmail] = useState(emailInicial);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError('Escribe tu email.');
    setEnviando(true);
    setError(null);
    const r = await enviarRecuperacionContrasena(email);
    setEnviando(false);
    if (r.ok) {
      setEnviado(true);
      toast.ok('Te hemos enviado un correo para cambiar la contraseña.');
    } else {
      setError(r.error);
    }
  };

  return (
    <Marco subtitulo="Recuperar el acceso">
      <Tarjeta className="p-5 sm:p-6">
        {enviado ? (
          <div className="text-center space-y-4">
            <Mail className="h-12 w-12 mx-auto text-brand-600" />
            <p className="text-lg font-semibold">Revisa tu correo</p>
            <p className="text-ink-muted">Hemos enviado un enlace a <strong className="text-ink">{email.trim()}</strong>. Ábrelo desde este dispositivo para elegir una contraseña nueva. Si no lo ves, mira en la carpeta de spam.</p>
            <Boton tamano="lg" ancho variante="secundario" onClick={onVolver}>Volver</Boton>
          </div>
        ) : (
          <form onSubmit={enviar} className="space-y-4" noValidate>
            <p className="text-ink-muted">Escribe el email con el que te dimos de alta y te enviaremos un enlace para crear una contraseña nueva.</p>
            <Entrada etiqueta="Email" type="email" inputMode="email" autoComplete="username" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} className="text-lg h-14" />
            {error && <p role="alert" className="rounded-2xl bg-rose/10 text-rose px-4 py-3 text-[15px] font-medium">{error}</p>}
            <Boton type="submit" tamano="lg" ancho cargando={enviando}><Mail className="h-5 w-5" /> Enviar enlace</Boton>
            <Boton type="button" tamano="lg" ancho variante="fantasma" onClick={onVolver}>Volver</Boton>
          </form>
        )}
      </Tarjeta>
    </Marco>
  );
}

/** Tras abrir el enlace del correo de recuperación: elegir la contraseña nueva. */
function NuevaContrasena() {
  const terminar = useStore((s) => s.terminarRecuperacionContrasena);
  const cerrar = useStore((s) => s.cerrarSesion);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [ver, setVer] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (p1.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.');
    if (p1 !== p2) return setError('Las dos contraseñas no coinciden.');
    setEnviando(true);
    setError(null);
    const r = await cambiarContrasena(p1);
    setEnviando(false);
    if (r.ok) {
      toast.ok('Contraseña cambiada.');
      terminar();
    } else {
      setError(r.error);
    }
  };

  return (
    <Marco subtitulo="Elige una contraseña nueva">
      <Tarjeta className="p-5 sm:p-6">
        <form onSubmit={guardar} className="space-y-4" noValidate>
          <Entrada etiqueta="Nueva contraseña" type={ver ? 'text' : 'password'} autoComplete="new-password" autoFocus value={p1} onChange={(e) => { setP1(e.target.value); setError(null); }} className="text-lg h-14" />
          <Entrada etiqueta="Repite la contraseña" type={ver ? 'text' : 'password'} autoComplete="new-password" value={p2} onChange={(e) => { setP2(e.target.value); setError(null); }} className="text-lg h-14" />
          <button type="button" onClick={() => setVer((v) => !v)} className="text-brand-700 font-semibold text-[15px] flex items-center gap-1 tap py-1">
            {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {ver ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
          </button>
          {error && <p role="alert" className="rounded-2xl bg-rose/10 text-rose px-4 py-3 text-[15px] font-medium">{error}</p>}
          <Boton type="submit" tamano="lg" ancho cargando={enviando}><KeyRound className="h-5 w-5" /> Guardar contraseña</Boton>
          <Boton type="button" tamano="lg" ancho variante="fantasma" onClick={() => void cerrar()}>Cancelar y salir</Boton>
        </form>
      </Tarjeta>
    </Marco>
  );
}

/** Usuario autenticado pero sin ficha de cliente ni de trabajador. */
function SinAlta({ email }: { email: string }) {
  const cerrar = useStore((s) => s.cerrarSesion);
  const [saliendo, setSaliendo] = useState(false);
  return (
    <Marco subtitulo="Casi está">
      <Tarjeta className="p-6 text-center space-y-4">
        <UserX className="h-12 w-12 mx-auto text-cocoa" />
        <p className="text-lg font-semibold">Tu usuario aún no está dado de alta en el centro</p>
        <p className="text-ink-muted">Has entrado como <strong className="text-ink">{email}</strong>, pero ese email no coincide con ninguna ficha del centro. Díselo en recepción: solo tienen que anotar este mismo email en tu ficha y volver a entrar.</p>
        <Boton tamano="lg" ancho variante="secundario" cargando={saliendo} onClick={async () => { setSaliendo(true); await cerrar(); setSaliendo(false); }}>
          <LogOut className="h-5 w-5" /> Salir
        </Boton>
      </Tarjeta>
    </Marco>
  );
}

// ---------------------------------------------------------------------------
// Modo demostración (sin contraseña)
// ---------------------------------------------------------------------------

function AccesoDemo() {
  const db = useStore((s) => s.db);
  const iniciar = useStore((s) => s.iniciarSesion);
  const reiniciar = useStore((s) => s.reiniciarDemo);
  const [pestana, setPestana] = useState<'CLIENTE' | 'TRABAJADOR'>('CLIENTE');

  const clientes = db.clientes.filter((c) => c.activo).slice(0, 6);

  return (
    <Marco>
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
    </Marco>
  );
}
