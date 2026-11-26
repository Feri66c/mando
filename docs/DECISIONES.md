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

# Decisiones del expediente y la locación

Fecha: 26 de noviembre de 2026. Pedido de Fer: toda la documentación del evento en un solo lugar, con pendientes y recordatorios.

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 25 | Expediente | Cada tipo de evento trae su lista de documentos (`config/expediente.json`) en seis grupos: seguridad, permisos, proveedores, logística, administración y cobranza, eventualidades. Al crear el evento todos nacen pendientes, con plazo contado desde la hora clave. La productora marca «no aplica» lo que ese evento no necesita, asigna responsable y sube el archivo o escribe el dato. El EPP (equipos de protección personal, confirmado por Fer) va en seguridad y es no negociable. |
| 26 | Recordatorios del expediente | Una alerta por documento que va subiendo: Atención cuando quedan 2 días, Crítico cuando vence, Red Flag si es no negociable y el evento ya llegó a su hora clave. Se resuelve sola al subir el documento o marcarlo «no aplica». Reglas en `config/criticidad.json`. |
| 27 | Locación | Punto de encuentro con enlace de mapa, quién coordina, placa y datos del transporte, antecedentes del lugar, zonas killer y puntos ciegos. La cargan los niveles 1 y 2 y la ve todo el equipo. |

## Supuestos

- **El cliente no ve el expediente ni la locación:** tienen contratos, facturas, teléfonos y placas. Sí ve la Red Flag de un no negociable sin documento.
- **Quién hace qué:** cualquiera del equipo sube un documento. «No aplica», responsable, plazo y documentos nuevos los deciden los niveles 1 y 2. Un no negociable marcado «no aplica» exige la razón.
- **Archivos:** van al mismo cubo privado, en `<evento>/expediente/`, con su huella SHA-256. Se pueden subir también con el evento cerrado, porque facturas y cobranza llegan después.
- **Recordatorio a la persona:** el botón «Recordar por WhatsApp» arma el mensaje («Tatiana, falta subir… te quedan 2 días. Recuerda que es un requisito no negociable»). El aviso automático al teléfono llega con la app móvil; el reenvío automático de facturas por correo, cuando haya servicio de correo.
- **Eventos anteriores:** no reciben la lista sola; se les agregan documentos a mano desde la pantalla.

# Decisiones de las aprobaciones del cliente

Fecha: 26 de noviembre de 2026. Pedido de Fer: un recuadro para que la productora suba casting, utilería, uniforme y referencias visuales, que el cliente apruebe en tiempo real, y que sin todo aprobado no se marque el inicio.

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 28 | Aprobaciones del cliente | Cuatro grupos (`config/aprobaciones.json`): casting, uniforme, utilería y referencias visuales. Cada tipo de evento trae los suyos y los niveles 1 y 2 los ajustan según el brief. El equipo (niveles 1 a 3) sube cada elemento con foto, nombre y detalle; recibe un código corto (C-01, U-02). El cliente aprueba con un toque o pide un cambio contando qué cambiar. Reemplazar la foto devuelve el elemento a «por aprobar». Cada paso queda en la bitácora. |
| 29 | Sin todo aprobado no se empieza | Mientras un grupo pedido no tenga elementos o quede algo sin aprobar, las piezas clave de la hoja de ruta no se pueden marcar como empezadas. Lo impide la base de datos, no solo la pantalla, y el mensaje dice qué falta. «Hoy» muestra el aviso al equipo y al cliente. |

## Supuestos

- **Quién aprueba:** el cliente. El productor general puede registrar una aprobación que el cliente dio por otro medio, y debe anotar cómo la recibió; la bitácora lo dice así. Los demás del equipo no pueden aprobar.
- **Fotos:** van al cubo privado, en `<evento>/aprobaciones/`, con su huella. Las ve todo miembro del evento, porque el cliente tiene que verlas.
- **Eventos anteriores:** nacen sin grupos pedidos, así que nada se bloquea; se prenden desde la pantalla.
- **Minuto a minuto referencial desde el brief:** hoy cada tipo de evento ya crea su hoja de ruta de referencia desde la plantilla. Que una IA lea el brief y proponga guion y minuto a minuto necesita un servicio de IA conectado en el servidor; queda pendiente hasta conectar los servicios.

# Decisiones de la planificación: los 5 elementos

Fecha: 26 de noviembre de 2026. Fer definió el flujo completo (planificación, apertura, desarrollo, cierre) y lo confirmó.

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 30 | Los 5 elementos y el candado | Legal, Personal, Técnico, Presupuesto y Aprobaciones del cliente (`config/planificacion.json`). Los eventos nuevos nacen con el timeline bloqueado: la hoja de ruta no se abre y la base no deja marcar el inicio de una pieza clave hasta que los cinco estén completos. La pantalla «Planificación» muestra el avance y qué falta. |
| 31 | Base de personas | Cada persona se registra una vez por organización (nombre, rol, DNI, vencimiento, foto y copia del DNI). Si el DNI ya existe, se actualiza esa ficha. En cada evento se elige con un check. Un DNI que vence antes del día del evento, o una ficha sin foto, deja Legal incompleto. |
| 32 | Lista técnica | Cada tipo de evento trae su lista sugerida (`config/tecnica.json`). Los obligatorios se confirman para desbloquear; el resto se completa hasta 24 o 2 horas antes y la pantalla marca el plazo vencido. |
| 33 | Presupuesto | El productor general carga el monto global y el cliente lo aprueba. Si el monto cambia, hay que aprobarlo otra vez. El desglose lo ve el productor de campo solo si se le habilita. MANDO avisa cuando una partida está por debajo del costo de referencia (`config/costos-referencia.json`). |

## Supuestos

- **Qué completa cada elemento:** Legal, los documentos no negociables del expediente subidos o marcados «no aplica», y todo el personal con foto y DNI vigente. Personal, al menos una persona elegida. Técnico, los obligatorios confirmados. Presupuesto, aprobado por el cliente. Aprobaciones, la regla de la decisión 29.
- **Datos personales:** el DNI, su copia y el teléfono solo los ven el administrador de la organización y los niveles 1 y 2. Coordinación y técnicos ven nombre, rol y foto. El cliente no ve al personal (el casting que aprueba va por Aprobaciones). Las copias van al cubo privado, en `personas/<organización>/dni/`.
- **Montos:** los ven el cliente y los niveles 1 y 2. Coordinación y técnicos no. La bitácora registra que hubo presupuesto y aprobación, sin montos.
- **Costos de referencia:** los valores de `config/costos-referencia.json` son iniciales y de ejemplo. El productor general debe ajustarlos a su mercado.
- **Eventos anteriores:** no tienen candado; solo cuenta la regla de aprobaciones. Sí pueden usar personal, técnico y presupuesto.
- **Pendiente:** aviso automático cuando vence el plazo de 24 o 2 horas (hoy lo marca la pantalla), y el código de ingreso por WhatsApp o SMS, que necesita un servicio de mensajería.

# Decisiones del timeline: tiempos, inconsistencias y márgenes

Fecha: 26 de noviembre de 2026.

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 34 | Control de tiempos | En «Tiempos», el productor general o el de campo arrastra un control grande por actividad para decir cuánto toma (de 5 minutos a 8 horas, `config/timeline.json`). Se guarda al soltar. La estimación no mueve la hoja de ruta: el plan solo cambia con una solicitud de cambio, como siempre. |
| 35 | Avisos y márgenes | MANDO compara cada estimación con el plan y avisa: cuando una actividad no entra antes de la hora del evento («Pusiste 4 h para Montaje y el evento empieza en 3 h»), cuando pide más de lo que le da la hoja de ruta, y cuando antes de un hito no queda el margen recomendado (30 min, 50 min o 2 h según lo que dura la actividad). |

## Supuestos

- **Tiempo sugerido:** hoy es la duración que trae la plantilla del tipo de evento. Que una IA lo estime leyendo el brief necesita un servicio de IA conectado; queda pendiente.
- **Quién ve qué:** los niveles 3 y 4 ven los tiempos sin poder cambiarlos. El cliente no ve esta pantalla. Cada estimación queda en la bitácora, sin mostrarse al cliente.
- **Los avisos no bloquean:** orientan a la productora. Lo que sí bloquea es la planificación incompleta (decisión 30).

# Decisiones del cierre: aprendizajes y ficha de satisfacción

Fecha: 26 de noviembre de 2026.

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 36 | Encuesta de cierre | Cada persona del equipo deja hasta 6 aprendizajes y responde «¿Algo más que agregar?» (`config/aprendizajes.json`). El cliente llena su ficha de satisfacción: de 1 a 5 y su impresión. Se puede llenar y corregir también después del cierre. |
| 37 | Closeout y repositorio | El informe de cierre ya lo arma MANDO solo con lo que pasó en el evento y el cliente lo ve y lo guarda en PDF. Desde el informe se entra al repositorio del evento (fotos, voz y video con hora y huella) y a la encuesta. |

## Supuestos

- **Quién lee:** cada persona ve lo suyo. El productor general y el productor de campo leen todos los aprendizajes y la ficha del cliente. El cliente no ve los aprendizajes del equipo.
- **Bitácora:** registra que alguien compartió sus aprendizajes o que el cliente dejó su ficha, nunca el contenido.
- **Pendiente, necesita servicios externos:** cortos de video hechos por IA, publicación directa en YouTube y TikTok, tiempos estimados por IA a partir del brief y el código de ingreso por WhatsApp o SMS.

# Decisiones del look: lenguaje de mando

Fecha: 26 de noviembre de 2026. Fer aprobó el rediseño y pidió aplicarlo a la app.

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 38 | Lenguaje de mando | Toda la app usa el tema navy con un solo oro. Cuatro piezas: corte (dos esquinas cortadas en tarjetas y botones), encastre (Ahora calza en Sigue), tramo (el avance en tramos inclinados) y botón hexagonal (acciones rápidas, «+» y el selector de tiempos). Una forma por nivel de criticidad, siempre con su nombre: hexágono, rombo, octágono y bandera. Tipografías: Chakra Petch en títulos y botones, IBM Plex Sans en texto, IBM Plex Mono en horas y cifras. Iconos propios, rectos. |

## Supuestos

- **Dónde vive:** las reglas de forma están en `apps/web/src/app/globals.css` y las piezas en `components/operacion/ui.tsx` y `nav.tsx`, para que todas las pantallas cambien juntas. La lógica no se tocó.
- **Foco y contraste:** lo que está cortado dibuja el foco hacia adentro. Los estados siguen llevando su palabra escrita.
- **Pendiente del rediseño:** el teclado propio del código de 6 dígitos, «elige tu mando», las insignias y las pantallas de podcast y minuto a minuto del lienzo de diseño.

# Decisiones del repaso con Fer sobre el link de prueba

Fecha: 26 de noviembre de 2026. Fer revisó la demo pantalla por pantalla, dictó los cambios y dijo «Listo confirmado, comienza a programar».

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 39 | Modo oscuro con neón de evento | Reemplaza la regla de «un solo oro» (decisión 38 conserva las formas). Fondo negro, botones de contorno fino con brillo por dentro, del mismo tamaño grande. El amarillo es el acento principal y se suman naranja, rojo y verde. Letras y avisos más grandes para iPhone y iPad. |
| 40 | Botón «Acepto» | En «Mis eventos» la persona ve «Te convocaron como» y su cargo, con un botón hexagonal grande «ACEPTO». Sin aceptar no entra. Queda en la bitácora. El cliente no tiene cargo que aceptar. |
| 41 | Brief con dudas al backend | Después de aceptar, lo primero es el brief que carga el backend. La persona responde «¿Estás enterado del brief?» con «Acepto» o deja una duda. Con una duda abierta no avanza: la duda llega al backend como alerta de Atención y solo el backend la responde, confirmando o corrigiendo el brief. Cada corrección sube la versión y hay que leerlo de nuevo. Sin brief leído no se toma el mando. |
| 42 | Técnico con documento y «No aplica» revisado | Los conceptos son genéricos (Sonido, Luces, Escenario). Cada uno tiene a la derecha «Adjuntar», que abre de inmediato la ventana para subir el documento y deja el concepto confirmado, y «No aplica». El «No aplica» de la productora va al backend: si acepta, deja de contar; si dice que sí aplica, sigue bloqueando y, si es obligatorio, levanta un Red Flag. |
| 43 | Presupuesto asignado y adicionales | La productora ve el presupuesto asignado. Si el backend abre los adicionales, puede solicitar más personal, técnica o locación. El backend aprueba o no, y actualiza el monto. |
| 44 | Avance en porcentaje con semáforo | La planificación muestra el avance en porcentaje con una barra que va de rojo a amarillo y termina en verde total solo cuando todo está completo. El avance lo decide el sistema, no una persona. |
| 45 | Plazo y Red Flag | Lo obligatorio desbloquea el reto. Lo demás se completa hasta el plazo que fija el backend (5 horas antes por defecto). Al aplicar el plazo, lo que siga pendiente levanta un Red Flag y queda en la bitácora. |
| 46 | Dos roles: Productor y Backend | En MANDO trabajan solo el productor y el backend. La «Torre de control» ahora se llama «Backend». |
| 47 | MANDO Express para el cliente | El cliente ya no ve la operación. Ve el estado de su evento, el semáforo, lo que le toca aprobar y «Tus ocurrencias»: avisos «Todo OK» que genera el sistema cuando se cumple un hito, «Observación» (factura no pagada, adelanto no generado) y «Sin confirmación». Las ocurrencias internas se quedan con el equipo para el aprendizaje. |
| 48 | Pantalla del backend | El backend tiene una pantalla con lo que espera su revisión, el plazo, la instrucción al productor (le llega como aviso y queda en la bitácora) y «Informar al cliente» con las observaciones y su propio aviso desplegable. |

## Supuestos

- **Dónde carga el brief el backend:** en el panel del evento, junto con las dudas por responder.
- **Quién lee el brief:** solo el equipo. El cliente no lo ve.
- **Eventos sin brief:** si el backend no cargó brief, la bienvenida sigue como antes.
- **App de teléfono (Expo):** todavía no muestra «Acepto» ni el brief; se hace en la web primero.
- **El plazo no corre solo:** por ahora el backend lo aplica con un botón. El aviso automático necesita un servicio programado.
- **Cliente:** conserva sus aprobaciones, el presupuesto y la ficha de satisfacción. Ya no tiene accesos a la hoja de ruta ni a las alertas; los permisos de la base de datos no se relajaron.
- **Casting con fotos numeradas por cargo:** queda en la demo; en la app sigue el flujo actual de aprobaciones.
- **«Entrevistado»:** sigue apagado fuera de los eventos tipo podcast.
- **App de teléfono (Expo):** todavía no tiene estos cambios.

# Decisión de la puesta en vivo

Fecha: 26 de noviembre de 2026. Al entrar por primera vez a MANDO en vivo, «Mis eventos» falló con «permission denied for table event_members».

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 49 | Permisos explícitos en la base de datos | Los proyectos nuevos de Supabase ya no dan acceso a las tablas por defecto. La instalación ahora otorga el acceso de forma explícita a las personas con sesión iniciada. Las reglas por evento y por rol (RLS) no cambiaron y siguen decidiendo qué ve cada quien. Quien no inició sesión no recibe acceso a ninguna tabla, y las funciones internas siguen cerradas. |

## Supuestos

- **Por qué no se vio antes:** la base de pruebas daba esos permisos por su cuenta, igual que los proyectos antiguos de Supabase.
- **Proyectos ya instalados:** basta con ejecutar una vez `supabase/migrations/20261208000015_permisos_explicitos.sql` en el SQL Editor. No hace falta volver a publicar la app.

# Decisiones del centro de mando · Entrega 1

Fecha: 26 de noviembre de 2026. Fer dictó 23 cambios mirando la app en vivo («Mando es poder»). Se construyen en cuatro entregas. Esta es la primera.

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 50 | Semáforo de casting | Cada persona del casting recibe un veredicto: **Aprobado** (verde), **Backup** (ámbar) o **No admitido** (rojo). La luz prendida late y siempre lleva su nombre escrito. Decide el cliente, o el backend en su nombre; la productora lo ve al instante. Nadie se retira del casting: los botones «Reemplazar» y «Retirar» se cambian por «Actualizar foto» y «Editar ficha», y la persona queda guardada con su veredicto. El casting queda completo cuando nadie espera revisión y hay al menos una persona aprobada. |
| 51 | Mini ficha junto a la foto | Cada persona del casting lleva su mini ficha: edad, talla, estatura, contextura, tono de piel, color de ojos, nacionalidad, disponibilidad, habilidad, hobby, idiomas, experiencia, distrito, calzado, alergias y tatuajes visibles. Se llena al subir y se ve al lado de la foto, también para el cliente que aprueba. Los campos y sus opciones viven en `config/ficha-casting.json`. |
| 52 | Tipo de documento | La ficha de personal pide tipo y número: **DNI** (8 números exactos, no deja escribir más ni letras), **carnet de extranjería** (9 a 12 letras o números) o **pasaporte** (6 a 12). La persona se reconoce por tipo y número: volver a escribir el mismo documento trae su ficha. |
| 53 | Cargos con «Agregar otro» | La lista de cargos es más larga y va en orden alfabético. Su última opción siempre es «Agregar otro cargo». El cargo escrito se usa de inmediato en la ficha y queda **propuesto**: el backend lo aprueba en su pantalla y pasa al catálogo de toda la organización. Toda lista de la mini ficha también termina en «Agregar otro». |
| 54 | Continuidad y MANDO vivo | Después de «Registrar y sumar al evento» la pantalla ya no vuelve a cero: confirma, ofrece «Siguiente persona» y pregunta «¿A dónde quieres ir?» con las partes de la planificación. Lo mismo al subir al casting. Las tarjetas llevan una luz que recorre su filo, el botón principal respira y los semáforos laten. Quien pide menos movimiento en su teléfono ve todo quieto. |

## Supuestos

- **Quién da el veredicto:** el cliente, igual que las demás aprobaciones; el backend puede marcarlo en su nombre. La productora sube y corrige, pero no decide.
- **Datos personales:** el documento y el teléfono siguen visibles solo para los niveles 1 y 2. El cliente ve foto y mini ficha de su propio evento, nunca el documento.
- **Listas largas:** solo las primeras tarjetas de cada lista llevan la luz en movimiento, para no cansar al teléfono.
- **Proyectos ya instalados:** ejecutar una vez `supabase/migrations/20261209000016_casting_ficha_documento_cargos.sql` en el SQL Editor.
- **Pendiente en las siguientes entregas:** banco de talentos con importación de CSV, cadena de mando con visibilidad por jerarquía, logos de marca y agencia, minuto a minuto exportable y cierre con People Experience.

# Decisiones del centro de mando · Entrega 2

Fecha: 26 de noviembre de 2026. «No estamos trabajando para un evento, estamos almacenando.»

| # | Decisión | Qué se decidió |
| --- | --- | --- |
| 55 | Banco de talentos | La base de personas de la organización es ahora un banco de talentos que sirve para todos los eventos. Cada persona se reconoce por tipo y número de documento: al volver a escribirlo, vuelve con su foto y su mini ficha, y lo nuevo se suma a lo que ya había. Se ordena por categorías (anfitriona, promotora, modelo, host, animador, locutor, personaje, actor) y la productora puede agregar otras. Tiene buscador por nombre, documento, talla o habilidad. Las categorías viven en `config/banco-talentos.json`. |
| 56 | Del banco al casting | Cada persona del banco tiene el botón «Sumar al casting»: entra al casting del evento con su foto y su ficha, lista para el semáforo del cliente. Una persona entra una sola vez por evento. |
| 57 | Ingresar e exportar listas | «Ingresar CSV» recibe la lista de una castinera. Lo mínimo es nombre y apellido; edad, talla, documento, celular y categoría entran si la columna se llama así. Antes de ingresar, MANDO muestra cuántas personas entran y qué filas no, con el motivo. Volver a subir la misma lista no duplica a nadie. Límite: 500 personas por lista. «Exportar a Excel (CSV)» baja todo el banco. |
| 58 | Autorización de datos | El banco guarda datos personales (documento, foto, tono de piel). Para registrar a alguien nuevo o ingresar una lista hay que confirmar que la persona autorizó guardar sus datos; queda anotado quién lo confirmó y cuándo. |

## Supuestos

- **Quién ve el banco:** solo el productor general y el productor de campo (niveles 1 y 2). El cliente ve la foto y la mini ficha de quienes están en el casting de su evento, nunca el documento ni el celular. Lo decide la base de datos, no solo la pantalla.
- **Sin documento:** una persona importada sin documento se reconoce por su nombre exacto. Conviene completar el documento después.
- **Exportación segura:** lo que empieza con `=`, `+`, `-` o `@` se exporta como texto, para que Excel no lo ejecute como fórmula.
- **Excel directo:** por ahora la lista entra y sale en CSV, que Excel abre y guarda. Leer archivos `.xlsx` queda para después.
- **Proyectos ya instalados:** ejecutar una vez `supabase/migrations/20261210000017_banco_de_talentos.sql` en el SQL Editor, después de la migración 16.
