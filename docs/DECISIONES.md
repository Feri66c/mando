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
