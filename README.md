# MANDO · Event Control — app (Etapa 1)

Plataforma web, pensada primero para teléfono, para controlar eventos en vivo. Esta carpeta es el código;
el diseño completo (producto, roles, criticidad, pantallas, plan) está en el paquete `proyecto-mando/`
(`CLAUDE.md` y `docs/`).

## Qué hay en la Fase 0

- Next.js 16 (App Router) + TypeScript + Tailwind 4. PWA básica (instalable, ícono MANDO).
- Marca: `src/app/tokens.css` (copia de `brand/tokens.css`), Space Grotesk, Inter e IBM Plex Mono servidas desde la app.
- Supabase: esquema (`supabase/migrations/…01`), seguridad por fila en **todas** las tablas (`…02`) y evento de ejemplo con tres usuarios (`supabase/seed.sql`).
- Inicio de sesión con correo y contraseña (`/ingresar`), pantalla «Mis eventos» (`/eventos`) y vista de solo lectura del evento (`/eventos/[id]`).
- Pruebas: unidad, permisos de la base de datos (criterio de aceptación) y navegador.

## Qué agrega la Etapa 1 (operar un evento desde la web)

- Tema oscuro en las pantallas del evento, barra inferior (Hoy · Hoja de ruta · Alertas · Más) y botón +.
- Cambios a la hoja de ruta con vista previa y arrastre de dependientes (`request_change` → `confirm_change`).
- Modo En Vivo: «Empezó» / «Terminó» con un toque, reloj grande, Ahora y Sigue.
- Bitácora, hoja de ruta y alertas en tiempo real (Supabase Realtime, respetando la seguridad por fila).
- Momentos críticos con plantillas (`config/plantillas-momentos.json`), compromisos prometido / encontrado.
- Evidencias en Storage privado (bucket `evidences`), con hash SHA-256, hora del teléfono y hora del servidor.
- Reglas de criticidad desde `config/criticidad.json` que levantan alertas solas (también las de reloj, cada minuto).
- Lógica compartida con la futura app móvil en `src/lib/core/`.

Supuestos tomados para arrancar: ver [`docs/DECISIONES.md`](docs/DECISIONES.md).

## Eventos por invitación y por tipo

- `/panel`: el productor general crea un evento eligiendo su tipo (plantillas en `config/tipos-de-evento.json`) e invita a cada persona con su cargo.
- `/ingresar`: solo entran correos invitados, con un código de 6 dígitos.
- `/bienvenida/<evento>`: la primera entrada de cada persona; ahí toma el mando.
- Prueba del recorrido: `apps/web/tests/e2e/invitacion.spec.ts`. Decisiones 17 a 21 en `docs/DECISIONES.md`.

## Estrellas, cierre y citados

- `/eventos/<evento>/cierre`: estrellas del evento (reglas en `config/meritos.json`), no negociables, hitos estrella, valoración del equipo, enlace de publicación y cierre. Es también el informe que se guarda en PDF.
- `/eventos/<evento>/citados`: hosts e invitados con su hora de citación, recordatorio por WhatsApp o correo y marca de llegada.
- `/eventos/<evento>/expediente`: documentos por subir según el tipo de evento (`config/expediente.json`), con plazo, responsable y recordatorio.
- `/eventos/<evento>/locacion`: punto de encuentro, mapa, transporte y antecedentes del lugar.
- Pruebas: `tests/db/meritos.test.ts` y `apps/web/tests/e2e/z-cierre.spec.ts` (corre al final porque cierra el evento de ejemplo). Decisiones 22 a 24.

## Comandos

```
npm install
npm run dev        # desarrollo en http://localhost:3000 (necesita .env.local, ver .env.example)
npm test           # pruebas de unidad (sin credenciales)
npm run test:db    # permisos por evento y rol contra un PostgreSQL desechable (sin credenciales)
npm run e2e        # navegador; con E2E_PASSWORD prueba el ingreso de los tres roles
npm run db:reset   # con la CLI de Supabase en local: aplica migraciones y seed
npm run db:bundle  # regenera supabase/instalar-todo.sql (todo) y supabase/actualizar-etapa-1.sql (solo lo nuevo)
npm run check      # lint + tipos + unidad + permisos + compilación
```

### Pruebas de aceptación de la Etapa 1 (`tests/e2e/operacion.spec.ts`)

Cambian datos, así que van contra un Supabase local recién cargado:

```
npx supabase start               # en entornos sin acceso a ECR: SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io
npx supabase db reset            # antes de cada corrida
# esperar unos segundos a que Realtime vuelva a estar sano después del reset
E2E_PASSWORD=MandoPrueba2026 npm run e2e
```

`.env.local` debe apuntar al Supabase local (`npx supabase status` muestra la URL y la clave publicable).
Con `E2E_SCREENSHOTS=<carpeta>` guarda capturas de cada paso.

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
- `route_items` no acepta `update` ni `delete` desde la app: los cambios entran por `change_requests` y los aplica `confirm_change`, que escribe la bitácora.
- `log_entries`: la app solo lee; update y delete bloqueados para todos por trigger; `truncate` revocado.
- Evidencias: `received_at` siempre lo pone el servidor; el archivo solo se sube a la carpeta del propio evento y solo lo lee quien puede ver esa evidencia.
- Viewer: no ve botones de operación y las direcciones de operación lo devuelven a su vista.
- Horas: en la base en UTC, en pantalla en la zona del evento (`src/lib/core/time.ts`).
