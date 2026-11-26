# MANDO · Event Control — Prompt maestro (v1)

Fecha: 25 de noviembre de 2026. Autor del encargo: Fer (HUB51 · LIVE/51).

Este documento es el encargo completo para llevar MANDO de la Fase 0 a un producto con
app para iOS y Android, panel web y sitio público. Quien lo ejecute (una persona del
equipo o Claude Code) debe leerlo entero antes de escribir código.

**Cómo usarlo en Claude Code:** abrir este repositorio y escribir:

> Lee `docs/PROMPT-MAESTRO.md`, `README.md` y `docs/DECISIONES.md`. Preséntame el plan
> de la Etapa 1 y espera mi confirmación antes de programar.

---

## 1. La ambición

Ser la primera empresa de **People Experience** con MANDO propio: una operación de eventos
que controla cada minuto, lo demuestra con evidencias y mide lo que vivió la gente.
Primero lo usamos nosotros (La Van | Experience, LIVE/51). Después se vende el formato
a otras productoras, agencias y áreas de eventos, cada una con su propia cuenta.

Promesa de producto: **tener el mando es tener el evento.** El productor opera con un
solo mando desde su teléfono; el cliente ve quién lo tiene, minuto a minuto.

## 2. Las dos referencias

### Yamdu: el benchmark de producto

Software de gestión de producción audiovisual. Lo que tomamos:

- **Un solo oficio, de punta a punta.** No es una herramienta genérica: sigue el flujo real
  de una producción. MANDO hace lo mismo con el evento: brief, hoja de ruta, montaje,
  pruebas, en vivo, desmontaje, cierre.
- **La IA propone y la persona confirma.** Yamdu importa el guion y sugiere el desglose.
  MANDO importa el brief, el rider y las cotizaciones y sugiere la hoja de ruta, los
  momentos críticos y los compromisos de cada proveedor. Nada entra sin confirmación.
- **La hoja de llamado.** El equivalente en eventos: una hoja diaria para staff y
  proveedores con hora de citación, lugar, contacto y lo que cada uno debe traer.
- **Permisos por puesto y registro de actividad.** Ya está en la base (seguridad por fila).
- **Lo que Yamdu no muestra en su página:** una app nativa para el día de rodaje. Ahí
  está la diferencia de MANDO: nace en el teléfono, para el momento en vivo.

### monday.com: el ideal de organización

Su función principal: convertir cualquier trabajo en **tableros**. Cada fila es un ítem
con responsable, estado en color y fecha; los ítems se agrupan, se filtran y se ven como
lista, tabla o tablero. Sobre esa base arma productos (el que revisamos es el CRM, con
Contactos, Leads, Acuerdos y Cuentas) y agrega actividades, notas y grabación de
reuniones con IA.

Patrones de su app móvil que MANDO adopta:

| Patrón de monday | Cómo queda en MANDO |
| --- | --- |
| Ingreso con código de 6 dígitos al correo, Google y Apple | Igual. Sin contraseñas que recordar en pleno montaje |
| Un correo, varias cuentas («elige una cuenta») | Un usuario, varias organizaciones. Es la base para vender el formato |
| Inicio con saludo, acciones rápidas, favoritos y recientes | Inicio con «Ahora / Sigue», acciones rápidas y Mis eventos |
| Acciones rápidas: Nota, Reunión, Resumen de llamada | Evidencia (foto), GRABA AQUÍ (voz), Cambio, Alerta |
| Grupos de filas con barra de color a la izquierda | Áreas del evento: Sonido, Luces, Montaje, Catering, Accesos |
| Chips de estado con el nombre escrito | Estado de la actividad y nivel de criticidad, siempre con texto |
| Alternar lista / tabla y «Personalizar» | Vista tarjeta para operar y vista tabla para la torre de control |
| Barra inferior flotante de 4 pestañas | Hoy · Hoja de ruta · Alertas · Más |
| Botón «+» flotante | Crear según contexto: actividad, evidencia, cambio |
| Globos de ayuda en el primer uso | Igual, una sola vez por función |
| Tarjetas grandes, esquinas muy redondeadas, fondo oscuro | Tema oscuro de operación (ver sección 5) |

Lo que **no** copiamos: en sus listas, los tres botones apilados (llamar, correo, detalle)
hacen que entren solo tres filas por pantalla. En un evento en vivo se necesitan de seis
a ocho actividades visibles. En MANDO las acciones secundarias van al deslizar la fila o
en el detalle.

No se usa ningún logo, nombre, ilustración ni color de marca de monday.com ni de Yamdu.
Son referencias de organización, no de identidad.

## 3. Qué se construye

Tres superficies sobre una sola base de datos (la de este repositorio):

1. **App móvil (iOS y Android)** para productores y staff. Es el mando.
2. **Panel web** para la torre de control (rol backend) y para administrar la organización.
   Es la app Next.js que ya existe, ampliada.
3. **Sitio público** de MANDO: qué es, para quién, casos, precios y pedido de demo. También
   aloja el **enlace del cliente** (viewer), que se abre sin instalar nada.

### Roles (ya definidos en la base)

- **Productor:** opera todo el evento desde el teléfono.
- **Backend (torre de control):** criticidad, eventualidades, citas, cartas, logística,
  transporte y permisos municipales.
- **Viewer (cliente):** solo ve lo marcado como visible. No escribe.
- **Proveedor (nuevo, por definir):** recibe su hoja de llamado y confirma por enlace,
  sin cuenta. Registrar la decisión antes de implementarlo.

## 4. Funciones, por orden de valor

### Núcleo (lo que hace que MANDO sea MANDO)

1. **Hoja de ruta viva.** Actividades por área, con hora, responsable y estado. Los
   cambios entran como solicitudes («dame una hora más») y el sistema recalcula lo que
   arrastra. Ya está modelado (`route_items`, `change_requests`).
2. **Modo En Vivo.** Pantalla única con reloj del evento, la actividad de ahora, la que
   sigue y un botón de un toque para marcar «empezó» y «terminó». Pensada para usarse
   con una mano y con guantes.
3. **Momentos críticos.** En la prueba de sonido, el montaje o la apertura de puertas,
   la app pregunta: qué no funciona, qué prometió el proveedor y pide el documento base.
   Plantillas en `config/plantillas-momentos.json`.
4. **Prometido contra entregado.** Cada compromiso del proveedor se marca como cumplido,
   parcial o incumplido, con evidencia. Al cierre sale la ficha del proveedor.
5. **Bitácora con evidencias.** Foto, audio, video o documento, con hora puesta por el
   servidor. No se edita ni se borra (ya lo impide la base).
6. **Criticidad y alertas.** Cuatro niveles: Informativo, Atención, Crítico, Red Flag.
   Reglas en `config/criticidad.json`. Notificación al teléfono según el nivel.
7. **Vista del cliente.** Enlace con el minuto a minuto y las evidencias visibles.
8. **Acta de cierre.** PDF al terminar: cronología, cambios, incidentes, evidencias y
   cumplimiento por proveedor. Es el entregable que justifica el servicio.

### Lo que lo hace People Experience

9. **Registro de asistentes** con código QR y aforo en tiempo real.
10. **Pulso en vivo.** Una pregunta de un toque a los asistentes en momentos clave
    (llegada, mitad, salida).
11. **Índice PX del evento.** Una sola cifra que combina puntualidad de la hoja de ruta,
    incidentes resueltos y pulso de los asistentes. Definir la fórmula con Fer antes de
    programarla; debe poder explicarse a un cliente en una frase.

### Lo que lo hace vendible

12. **Organizaciones independientes** con sus usuarios, eventos y proveedores (la base ya
    separa por organización).
13. **Plantillas de evento:** convención, concierto, boda, activación en calle, evento
    masivo. Cada plantilla trae áreas, momentos críticos y permisos típicos.
14. **Marca del cliente** en la vista viewer y en el acta: logo y color de la organización.
15. **Planes y cobro.** Dejar preparado el modelo (plan por organización, límite de
    eventos activos). El cobro real se decide después.
16. **Conexiones:** calendario, CRM y mensajería. Empezar por exportar a calendario.

## 5. Cómo debe verse

La identidad ya existe: `src/app/tokens.css`, logos en `public/brand/`, tipografías
Space Grotesk (títulos), Inter (texto) e IBM Plex Mono (horas y cifras).

Se agrega un **tema oscuro de operación**, que es el de la app móvil por defecto:

- Fondo `--navy-950`. Tarjetas un tono más claro, con esquinas de 20 a 24 px.
- Oro `--gold-500` como único acento de marca por pantalla. Los colores de estado y de
  criticidad no cuentan como acento, y siempre llevan su nombre escrito.
- Barra inferior flotante en forma de píldora, con cuatro pestañas.
- Botón «+» flotante abajo a la derecha.
- Cabecera con saludo, nombre del evento activo y hora del evento en mono.
- Objetivo táctil mínimo de 44 px. Texto legible a pleno sol: contraste AA como mínimo.
- El botón de voz dice «GRABA AQUÍ»: texto blanco, marco rojo y punto de micrófono. Es
  la única excepción a la paleta.
- Voz de la interfaz: directa, en imperativo, frases cortas. «Identifica tu evento.»
  «Cuéntame el brief.» «Dame una hora más.»

El tema claro actual se mantiene para el panel web y los documentos.

## 6. Decisiones técnicas

Lo que ya está decidido (ver `docs/DECISIONES.md`) se respeta: Next.js, TypeScript,
Tailwind, Supabase, seguridad por fila en todas las tablas, horas en UTC.

Decisiones nuevas que hay que tomar y registrar en `docs/DECISIONES.md` **antes** de
programar:

| Decisión | Recomendación de partida |
| --- | --- |
| Cómo se hace la app móvil | Expo (React Native) en el mismo repositorio, compartiendo tipos y reglas con la web. Una app que solo envuelve la web puede ser rechazada por Apple por funcionalidad mínima y no resuelve cámara, audio, avisos ni trabajo sin señal |
| Trabajo sin señal | Cola local de evidencias y marcas de hora, que se sincroniza al volver la conexión. La hora que vale es la del servidor; se guarda también la del teléfono |
| Avisos al teléfono | Servicio de notificaciones de Expo, disparado desde la base según el nivel de criticidad |
| Ingreso | Código de 6 dígitos al correo, Google y Apple. Revisar la regla de Apple sobre ofrecer su propio inicio de sesión cuando hay otros proveedores |
| Estructura | Monorepo: `apps/web`, `apps/mobile`, `packages/core` (tipos, criticidad, tiempo, etiquetas) |
| Sitio público | Dentro de `apps/web`, en rutas públicas, sin sesión |

Si al investigar aparece una opción mejor, se propone con sus razones y Fer decide.

## 7. Etapas

Cada etapa termina con `npm run check` en verde, una demo que Fer pueda abrir en su
teléfono y una nota en `docs/DECISIONES.md` con lo que se asumió.

- **Etapa 1 · Operar un evento desde la web.** Función que aplica los cambios de la hoja
  de ruta, Modo En Vivo, carga de evidencias, momentos críticos y alertas. Tema oscuro.
  Todo en la web actual, pensada para teléfono.
- **Etapa 2 · App móvil.** Monorepo, Expo, ingreso con código, Hoy, Hoja de ruta, Alertas,
  cámara, GRABA AQUÍ, avisos y cola sin señal. Versión de prueba en TestFlight y en
  prueba interna de Google Play.
- **Etapa 3 · Cliente y cierre.** Vista viewer con marca de la organización, acta de
  cierre en PDF y ficha de proveedores.
- **Etapa 4 · Torre de control.** Panel web con vista tabla, permisos municipales,
  transporte, citas y cartas. Crear eventos y proveedores. Plantillas de evento.
- **Etapa 5 · People Experience.** Registro con QR, pulso en vivo e Índice PX.
- **Etapa 6 · Producto para terceros.** Alta de organizaciones, planes, sitio público con
  pedido de demo y publicación en App Store y Google Play.

## 8. Reglas de trabajo

- Leer la guía de Next.js incluida en `node_modules/next/dist/docs/` antes de tocar la web
  (ver `AGENTS.md`).
- No debilitar ninguna regla de seguridad por fila. Toda tabla nueva nace con la suya y
  con su prueba en `tests/db/`.
- La bitácora no se edita ni se borra, bajo ningún rol.
- Niveles, reglas y plantillas viven en datos (`config/`), no en el código.
- Texto de la interfaz en español. Código, tablas y columnas en inglés, como hasta ahora.
- Los usuarios de prueba y sus contraseñas son solo para desarrollo.
- Antes de cada etapa: presentar el plan y esperar confirmación. No avanzar de etapa
  por cuenta propia.
- Ante una duda de producto, preguntar a Fer con una recomendación ya formulada.

## 9. Pendientes que no son código

- Registro de marca y dominios de MANDO: sin revisar.
- Logotipo definitivo: los vectores actuales son un trazado del concepto aprobado.
- Cuenta de desarrollador de Apple y de Google Play: definir a nombre de quién.
- Este repositorio es público. Si MANDO se va a vender, conviene pasarlo a privado.
- Fórmula del Índice PX y lista de plantillas de evento: validar con productores.
