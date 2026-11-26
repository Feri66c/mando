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

# Decisiones de la Etapa 2 (app móvil)

Fecha: 26 de noviembre de 2026. Fer confirmó el plan de la Etapa 2 y sus cuatro recomendaciones.

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 13 | Cuentas de Apple y Google | A nombre de la empresa de Fer (con RUC). Apple pide número D-U-N-S para cuentas de empresa. |
| 14 | GRABA AQUÍ | Completo: graba una nota de voz (evidencia), la pasa a texto en el teléfono y Claude propone el cambio, que la persona confirma con la misma vista previa de siempre. Sin clave de Anthropic en el servidor, el botón guarda solo la nota de voz. |
| 15 | Qué funciona sin señal | Marcas Empezó / Terminó, fotos, videos, notas de voz y respuestas de momentos críticos se guardan en el teléfono y se envían al volver la señal. Los cambios a la hoja de ruta necesitan señal, porque la vista previa depende de la hoja de ruta al día. |
| 16 | Primer teléfono de prueba | iPhone de Fer: la primera versión de prueba sale por TestFlight. |

## Supuestos de la Etapa 2

- **Monorepo con npm workspaces:** `apps/web` (Next.js), `apps/mobile` (Expo) y `packages/core` (`@mando/core`). `config/`, `supabase/`, `docs/`, `scripts/` y `tests/db/` quedan en la raíz porque son de las tres partes. En Vercel, la carpeta raíz del proyecto pasa a ser `apps/web`.
- **Expo SDK 58**, con Expo Router y React 19.3 (la misma versión que la web).

# Decisiones de la arquitectura por invitación

Fecha: 26 de noviembre de 2026. Fer confirmó la lógica («Estoy de acuerdo con toda la lógica. Comienza a crear.»). El aspecto visual se trabaja aparte; aquí solo la arquitectura.

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 17 | Quién entra | Solo personas invitadas. Solo el productor general (administrador de la organización, nivel 1 en el evento) crea eventos e invita. Nadie se registra por su cuenta: la cuenta se crea al pedir el primer código, y solo si el correo tiene una invitación pendiente. |
| 18 | Tipos de evento | Seis tipos en `config/tipos-de-evento.json`: sampling, activación en centro comercial, fiesta corporativa, feria, concierto y podcast (ver decisión 24). Tres tamaños: ligero, medio y mayor. Cada tipo trae sus piezas, su hora clave, sus no negociables y sus cargos. Al crear el evento la plantilla se copia al evento y la hoja de ruta nace de sus piezas. |
| 19 | Cargos y jerarquía | Cuatro niveles: 1 productor general, 2 productor de campo, 3 coordinación, 4 técnicos y proveedores. El cliente no tiene nivel y solo mira. El cargo puede llevar un nombre propio (por ejemplo, «Road manager»). |
| 20 | Bienvenida | La primera vez que alguien entra a un evento ve: gracias con su nombre, el evento y su cargo; los mandatorios de MANDO y los no negociables del tipo; su reto; y una cuenta 3-2-1 que termina en «Se inició la acción» con el reloj hacia la hora clave. Recién ahí queda con el mando activo (`event_members.welcomed_at`). |
| 21 | Primer evento real | Un sampling. |

## Supuestos

- **Cómo llega la invitación:** MANDO todavía no manda el correo de invitación por su cuenta (necesita un servicio de correo propio, que se configura junto con Supabase). Por ahora el panel arma el mensaje con el enlace de ingreso y el productor general lo manda por WhatsApp o correo con un toque. El código de 6 dígitos sí lo manda MANDO cuando la persona escribe su correo.
- **Todo pasa por funciones de la base:** `create_event_from_template`, `invite_to_event`, `revoke_invitation`, `claim_invitations` y `mark_welcomed`. La tabla `invitations` solo la lee el productor general del evento y nadie escribe en ella directo. Invitar y unirse quedan en la bitácora.
- **Quien ya tiene cuenta** entra al evento en el momento de la invitación; quien no, al iniciar sesión por primera vez.
- **Eventos anteriores a los tipos:** siguen funcionando; sus miembros quedaron con nivel según su rol y con la bienvenida ya vista.
- **Pruebas:** `tests/db/invitaciones.test.ts` (permisos) y `apps/web/tests/e2e/invitacion.spec.ts` (el recorrido completo en el teléfono, con el código leído del buzón de prueba). Las pruebas del navegador corren una tras otra porque comparten la base.

# Decisiones de méritos, cierre y podcast

Fecha: 26 de noviembre de 2026. Fer aprobó la lógica de méritos y pidió sumar la producción de podcast.

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 22 | Estrellas del evento | De 0 a 5, en medios. Cinco criterios con peso en `config/meritos.json`: puntualidad 30, prometido = entregado 25, respuesta a incidentes 15, momentos wow 15, valoración de técnicos y proveedores 15. Un criterio sin datos no cuenta y su peso se reparte. Si falla un no negociable, el evento queda en 0 estrellas y levanta una Red Flag que el cliente ve. |
| 23 | Citados | Hosts e invitados que no usan MANDO: hora de citación, recordatorio por WhatsApp o correo con el mensaje ya escrito, y marca de llegada. Su puntualidad entra en el criterio de puntualidad. Sirve para cualquier tipo de evento. |
| 24 | Tipo podcast | Ocho piezas: Brief, Imagen, Citación, Set, Prueba técnica, Grabación, Edición y Publicado. La hora clave es el inicio de la grabación. El enlace de YouTube se registra en el cierre y sale en el informe. |

## Supuestos

- **Quién marca:** los no negociables y los hitos estrella los marcan los niveles 1 y 2. Un no negociable fallado exige explicación. Si luego se corrige a cumplido, la Red Flag se resuelve y las estrellas vuelven; la bitácora conserva las dos marcas.
- **Valoración:** la da el equipo de campo (niveles 2 a 4), de 1 a 5, una por persona. Solo el productor general ve cada nota; en la bitácora queda que valoró, no cuánto.
- **Las mismas estrellas para todos:** la base entrega solo números (`event_score_inputs`) y la cuenta se hace con las reglas del archivo. El cliente ve las mismas estrellas que el equipo sin leer nada interno.
- **Puntualidad:** una pieza está a tiempo si empezó hasta 10 minutos después de la hora publicada (el plan original, no el plan movido). Las piezas clave valen doble. Una pieza que ya debía empezar y nadie marcó cuenta como tarde.
- **Cierre:** solo el productor general cierra, y solo con todos los no negociables marcados. Un evento cerrado no acepta marcas ni cambios; el equipo todavía puede valorar.
- **Informe en PDF:** la pantalla «Estrellas y cierre» es el informe. El botón «Guardar como PDF» abre la impresión del teléfono o la computadora, con fondo blanco y sin botones. Un PDF generado en el servidor y enviado por correo queda para cuando haya servicio de correo.
- **Recordatorios a citados:** igual que las invitaciones, MANDO arma el mensaje y la persona lo manda desde su WhatsApp o su correo; MANDO anota que se mandó. El envío automático queda para cuando haya servicio de correo y de WhatsApp.
- **Insignias y rangos por persona:** siguen para la Etapa 5.
