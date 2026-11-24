-- Filas extra SOLO para las pruebas de permisos (no van al seed).
-- Ids con prefijo 99 para distinguirlas.

-- Filas ocultas al cliente dentro del evento de ejemplo.
insert into route_items (id, event_id, title, planned_start, planned_end, current_start, current_end, visible_to_viewer, sort_order) values
  ('00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-0000000000e1', 'Reunión interna de seguridad',
   '2026-12-12 07:00-05', '2026-12-12 07:30-05', '2026-12-12 07:00-05', '2026-12-12 07:30-05', false, 0);

insert into log_entries (event_id, actor_id, kind, summary, visible_to_viewer) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'note', 'Nota interna: renegociar con el proveedor', false),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'note', 'Montaje iniciado', true);

insert into alerts (event_id, level, title, visible_to_viewer) values
  ('00000000-0000-0000-0000-0000000000e1', 3, 'Consola con menos canales', false),
  ('00000000-0000-0000-0000-0000000000e1', 4, 'Apertura de puertas en riesgo', true);

insert into evidences (event_id, kind, note, captured_at, captured_by, visible_to_viewer) values
  ('00000000-0000-0000-0000-0000000000e1', 'note', 'Foto interna del rack', now(), '00000000-0000-0000-0000-0000000000a1', false),
  ('00000000-0000-0000-0000-0000000000e1', 'note', 'Escenario listo', now(), '00000000-0000-0000-0000-0000000000a1', true);

insert into documents (event_id, kind, title, file_path, visible_to_viewer) values
  ('00000000-0000-0000-0000-0000000000e1', 'quote', 'Cotización de sonido', 'docs/cotizacion.pdf', false);

insert into permits (event_id, title) values
  ('00000000-0000-0000-0000-0000000000e1', 'Licencia municipal de evento');

-- Otro cliente invitado al mismo evento: el primer cliente no debe verlo.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000009902', 'otro-cliente@mando.test', '{"full_name":"Otro cliente"}');
insert into event_members (event_id, profile_id, role, title) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000009902', 'viewer', 'Cliente 2');

-- Un evento ajeno, de otra organización, sin ninguno de los tres usuarios de prueba.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000009903', 'ajeno@mando.test', '{"full_name":"Usuario ajeno"}');
insert into organizations (id, name) values ('00000000-0000-0000-0000-000000009904', 'Otra productora');
insert into events (id, organization_id, name) values
  ('00000000-0000-0000-0000-000000009905', '00000000-0000-0000-0000-000000009904', 'Evento ajeno');
insert into event_members (event_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000009905', '00000000-0000-0000-0000-000000009903', 'backend');
insert into route_items (event_id, title, planned_start, planned_end, current_start, current_end) values
  ('00000000-0000-0000-0000-000000009905', 'Actividad ajena', now(), now(), now(), now());
insert into log_entries (event_id, kind, summary) values
  ('00000000-0000-0000-0000-000000009905', 'event_created', 'Se creó el evento ajeno');
