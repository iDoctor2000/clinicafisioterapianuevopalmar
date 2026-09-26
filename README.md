# Clínica de Fisioterapia Nuevo Palmar

Repositorio de la web pública de la clínica y de la aplicación de reservas del centro de Pilates.

| Carpeta | Contenido |
|---|---|
| `index.html`, `assets/` | Web pública (React + Tailwind, contenido editable vía Firebase) |
| `app/` | **Nuevo Palmar Pilates**: PWA de reservas y gestión del centro (Vite + React + TypeScript) |
| `supabase/` | Esquema de base de datos, seguridad (RLS) y funciones para producción |
| `docs/PLANTEAMIENTO.md` | Planteamiento del proyecto: decisiones, fases, costes |
| `.github/workflows/deploy.yml` | Publicación automática de web + app en GitHub Pages |

## Publicación

La app se publica en la ruta `/app/` de la web. El workflow de GitHub Actions compila la app y sube web y app juntas a GitHub Pages en cada cambio de `main`.

**Configuración necesaria (una sola vez):** en GitHub → *Settings* → *Pages* → *Build and deployment* → *Source*: elegir **GitHub Actions** (en lugar de *Deploy from a branch*).

## Desarrollo de la app

```bash
cd app
npm install
npm run dev        # servidor local en http://localhost:5173/app/
npm test           # pruebas de las reglas de negocio
npm run build      # compilación de producción en app/dist
```
