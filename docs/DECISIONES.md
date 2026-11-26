# Decisiones y supuestos de la Fase 0

Fecha: 24 de noviembre de 2026. Fer delegó estas decisiones para no bloquear el arranque
(preguntas 1 a 3 de `docs/10-preguntas-abiertas.md` del paquete). Todas se pueden revisar.

| # | Pregunta abierta | Decisión tomada | Cómo cambiarla |
| --- | --- | --- | --- |
| 1 | Stack | Next.js (App Router) + TypeScript + Tailwind + Supabase, el propuesto en el paquete. No se reutiliza el stack de medios ni SEVEN. | El modelo y las reglas viven en SQL; se pueden llevar a otro stack. |
| 2 | Escala de criticidad | La de `config/criticidad.json`: Informativo, Atención, Crítico, Red Flag. Se copia a `events.criticality_config` de cada evento. | Editar el JSON (una prueba exige que el seed coincida) o la columna del evento. Vive en datos, no en el código. |
| 3 | Dónde se aloja | Nube: Vercel (app) + Supabase (base, sesión, archivos). Región sugerida de Supabase: São Paulo (`sa-east-1`), la más cercana a Lima. | Si se exige residencia de datos en Perú o servidores propios, Supabase se puede autoalojar. |

## Otros supuestos

- **Qué ve el cliente** (pregunta 4): lo propuesto en `docs/04`: actividades, bitácora, evidencias y documentos según `visible_to_viewer`; alertas solo si están marcadas visibles. Momentos críticos, compromisos, permisos, briefs, cambios y proveedores son internos del equipo.
- **Permisos por área** (pregunta 5): no; en el MVP todo productor opera todo el evento.
- **Crear eventos y proveedores**: los administradores de la organización (`organization_members.is_admin`). La pantalla llega en la Fase 3.
- **Ajustes al esquema del paquete**: `permits.is_required` (las reglas hablan de «permiso obligatorio»); perfil creado automáticamente al registrarse un usuario; `received_at` de evidencias fijado por el servidor; `event_role_of()` deja de ser pública porque revelaba roles ajenos.
- **Seed**: además del evento de ejemplo del paquete, crea los tres usuarios de prueba en Supabase Auth y carga la escala de criticidad. Es solo para desarrollo (regla 9).
- **Cache Components de Next.js**: apagado; todas las pantallas dependen de la sesión.

# Decisiones del prompt maestro (v1) y supuestos de la Etapa 1

Fecha: 26 de noviembre de 2026. Fer confirmó el plan de la Etapa 1 y las recomendaciones de la
sección 6 de `docs/PROMPT-MAESTRO.md`.

## Sección 6 del prompt maestro

| # | Decisión | Qué se decidió | Cuándo aplica |
| --- | --- | --- | --- |
| 4 | App móvil | Expo (React Native) en este mismo repositorio, compartiendo tipos y reglas con la web. No una app que solo envuelve la web. | Etapa 2 |
| 5 | Trabajo sin señal | Cola local de evidencias y marcas de hora que se sincroniza al volver la señal. Vale la hora del servidor (`received_at`); se guarda también la del teléfono (`captured_at`). La base ya guarda las dos desde la Etapa 1. | Etapa 2 |
| 6 | Avisos al teléfono | Notificaciones de Expo, disparadas desde la base según el nivel de criticidad. En la Etapa 1 los avisos se ven solo dentro de la web abierta. | Etapa 2 |
| 7 | Ingreso | Código de 6 dígitos al correo, Google y Apple, los tres juntos (Apple pide su propio ingreso si se ofrece el de Google). En la Etapa 1 sigue el ingreso con contraseña. | Etapa 2 |
| 8 | Estructura | Monorepo `apps/web`, `apps/mobile`, `packages/core`. La mudanza se hace al empezar la Etapa 2; en la Etapa 1 la lógica común queda en `src/lib/core/` para moverla sin reescribirla. | Etapa 2 |
| 9 | Sitio público | Dentro de `apps/web`, en rutas públicas sin sesión. | Etapa 6 |

## Decisiones nuevas de la Etapa 1

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 10 | Red Flag en el tema oscuro | El color del nivel 4 (`#061428`) es el mismo del fondo oscuro. En el tema oscuro la etiqueta Red Flag es blanca con texto azul noche y la palabra escrita. El tema claro no cambia y el JSON no cambia. |
| 11 | Prometido contra entregado | `commitments.outcome` con tres estados: `met` (cumplido), `partial` (parcial), `unmet` (incumplido). `matches` se mantiene y se calcula (`true` solo si es cumplido). Parcial levanta la regla `compromiso_no_coincide` con nivel `nivel_parcial` (2, Atención); incumplido con su nivel (3, Crítico). |
| 12 | Rol Proveedor | Se deja para la Etapa 3, con la hoja de llamado. En la Etapa 1 el proveedor no entra a MANDO. |

## Supuestos de la Etapa 1

- **Todo cambio de la hoja de ruta pasa por funciones de la base** (`request_change`, `confirm_change`, `mark_item`). La app sigue sin poder hacer `update` directo en `route_items`. Cada función valida el rol, trabaja en una transacción, escribe en la bitácora y evalúa las reglas.
- **Recálculo en cascada** (docs/07): si una actividad dependiente empieza antes de que termine aquella de la que depende (más su `lag_minutes`), se desplaza lo necesario conservando su duración. Las actividades listas o canceladas no se mueven. Adelantar una actividad no adelanta a las que dependen de ella.
- **Tipos de cambio en la Etapa 1:** `extend` (más o menos minutos al final) y `move` (desplazar inicio y fin). Reasignar, agregar o cancelar actividades llega con la torre de control.
- **Reglas por reloj** (`actividad_retrasada`, `actividad_sin_responsable`, `momento_critico_sin_resolver`, permisos): las evalúa `evaluate_clock_rules`, que la pantalla del equipo llama cada minuto mientras está abierta. Un programador en el servidor (pg_cron) queda para cuando haya avisos al teléfono (Etapa 2).
- **Una alerta por situación:** si ya hay una alerta abierta o reconocida con la misma regla y la misma actividad, solo sube su nivel si corresponde.
- **Qué ve el cliente en la bitácora:** cambios y marcas de actividades visibles, evidencias visibles y alertas de nivel 4. Momentos críticos, respuestas y compromisos son internos.
- **Evidencias:** archivo en Supabase Storage, cubo privado `evidences`, ruta `<id del evento>/<archivo>`. Se ven con enlaces firmados de corta duración. La huella SHA-256 se calcula en el teléfono antes de subir. Límite de 50 MB por archivo.
- **Tiempo real:** las pantallas se suscriben a los cambios del evento con Supabase Realtime y se vuelven a dibujar. Qué filas llegan lo decide la seguridad por fila, no la pantalla.
- **Tema oscuro:** es el de las pantallas del evento (Hoy, Hoja de ruta, Alertas, Más, Modo En Vivo). Ingreso y «Mis eventos» siguen en tema claro por ahora.

## Cierre de la Etapa 1

- Las cinco pruebas de aceptación del prompt maestro corren en el navegador del teléfono (`tests/e2e/operacion.spec.ts`) contra Supabase local. El cliente vio el cambio de la prueba de sonido en menos de 1 segundo.
- Con el seed, alargar la prueba de sonido 60 minutos no arrastra nada: hay 2 h 30 de holgura antes de la apertura de puertas. El arrastre se ve al moverla más de 2 h 30 o al mover la apertura.
- El Modo En Vivo solo dice «X min tarde / antes» cuando la diferencia es menor a 12 horas; si la marca es de otro día (por ejemplo, al probar antes de la fecha del evento) no muestra nada.
- Siguiente: la Etapa 2 (app iOS/Android) se presenta como plan y no empieza sin la confirmación de Fer.
