# MANDO · Event Control — app (Fase 0)

Plataforma web, pensada primero para teléfono, para controlar eventos en vivo. Esta carpeta es el código;
el diseño completo (producto, roles, criticidad, pantallas, plan) está en el paquete `proyecto-mando/`
(`CLAUDE.md` y `docs/`).

## Qué hay en la Fase 0

- Next.js 16 (App Router) + TypeScript + Tailwind 4. PWA básica (instalable, ícono MANDO).
- Marca: `src/app/tokens.css` (copia de `brand/tokens.css`), Space Grotesk, Inter e IBM Plex Mono servidas desde la app.
- Supabase: esquema (`supabase/migrations/…01`), seguridad por fila en **todas** las tablas (`…02`) y evento de ejemplo con tres usuarios (`supabase/seed.sql`).
- Inicio de sesión con correo y contraseña (`/ingresar`), pantalla «Mis eventos» (`/eventos`) y vista de solo lectura del evento (`/eventos/[id]`).
- Pruebas: unidad, permisos de la base de datos (criterio de aceptación) y navegador.

Supuestos tomados para arrancar: ver [`docs/DECISIONES.md`](docs/DECISIONES.md).

## Comandos

```
npm install
npm run dev        # desarrollo en http://localhost:3000 (necesita .env.local, ver .env.example)
npm test           # pruebas de unidad (sin credenciales)
npm run test:db    # permisos por evento y rol contra un PostgreSQL desechable (sin credenciales)
npm run e2e        # navegador; con E2E_PASSWORD prueba el ingreso de los tres roles
npm run db:reset   # con la CLI de Supabase en local: aplica migraciones y seed
npm run db:bundle  # regenera supabase/instalar-todo.sql (migraciones + seed en un solo archivo)
npm run check      # lint + tipos + unidad + permisos + compilación
```

`npm run test:db` usa PostgreSQL instalado en el equipo, o el servidor de `TEST_DATABASE_ADMIN_URL`
(así corre en GitHub Actions, `.github/workflows/pruebas.yml`). Crea y borra su propia base temporal.

## Usuarios de prueba (solo desarrollo)

| Correo | Rol en «Convención anual · Lima» |
| --- | --- |
| `productor@mando.test` | Productor |
| `torre@mando.test` | Backend (torre de control) |
| `cliente@mando.test` | Viewer (cliente) |

Contraseña de los tres: `MandoPrueba2026`. Bórralos o cámbiales la contraseña antes de dar acceso a personas reales.

## Instalar la base en Supabase (proyecto nuevo)

Supabase → SQL Editor → New query → pegar `supabase/instalar-todo.sql` → Run.
Luego, en la app, las variables `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
(Supabase → Project Settings → API Keys). Ver `.env.example`.

## Reglas que el código ya hace cumplir

- Viewer: nunca recibe filas con `visible_to_viewer = false`, no ve momentos críticos, compromisos, permisos, cambios ni a otros clientes, y no escribe nada.
- `route_items` no acepta `update` ni `delete` desde la app: los cambios entran por `change_requests` (la función que los aplica llega en la Fase 1).
- `log_entries`: la app solo lee; update y delete bloqueados para todos por trigger; `truncate` revocado.
- Evidencias: `received_at` siempre lo pone el servidor.
- Horas: en la base en UTC, en pantalla en la zona del evento (`src/lib/time.ts`).
