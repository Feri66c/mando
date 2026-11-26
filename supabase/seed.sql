-- MANDO · datos de ejemplo para DESARROLLO. Todo es ficticio (regla 9: no usar en producción con clientes reales).
-- Basado en db/seed.sql del paquete de diseño, con tres agregados para que la Fase 0 funcione en Supabase:
--   1. Crea los tres usuarios de prueba en auth.users (antes había que crearlos a mano).
--   2. Agrega al productor y a la torre de control como miembros de la organización.
--   3. Copia config/criticidad.json en events.criticality_config (supuesto: esa es la escala vigente).
--
-- Usuarios de prueba (contraseña de los tres: MandoPrueba2026). Cámbiala o borra estos usuarios
-- antes de dar acceso a personas reales.
--   productor@mando.test  → Productor
--   torre@mando.test      → Backend (torre de control)
--   cliente@mando.test    → Viewer (cliente)


insert into organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Productora de ejemplo')
on conflict (id) do nothing;

-- 1 · Usuarios de inicio de sesión. Un trigger crea su fila en profiles con full_name.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated',
   'productor@mando.test', extensions.crypt('MandoPrueba2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Productor de ejemplo"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated',
   'torre@mando.test', extensions.crypt('MandoPrueba2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Torre de control de ejemplo"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a3', 'authenticated', 'authenticated',
   'cliente@mando.test', extensions.crypt('MandoPrueba2026', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Cliente de ejemplo"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1',
   '{"sub":"00000000-0000-0000-0000-0000000000a1","email":"productor@mando.test","email_verified":true}', 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2',
   '{"sub":"00000000-0000-0000-0000-0000000000a2","email":"torre@mando.test","email_verified":true}', 'email', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a3',
   '{"sub":"00000000-0000-0000-0000-0000000000a3","email":"cliente@mando.test","email_verified":true}', 'email', now(), now(), now())
on conflict do nothing;

-- Por si los perfiles ya existían (o el trigger no corrió), se aseguran con su nombre.
insert into profiles (id, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Productor de ejemplo'),
  ('00000000-0000-0000-0000-0000000000a2', 'Torre de control de ejemplo'),
  ('00000000-0000-0000-0000-0000000000a3', 'Cliente de ejemplo')
on conflict (id) do update set full_name = excluded.full_name;

-- 2 · Equipo de la organización (el cliente no es miembro de la organización).
insert into organization_members (organization_id, profile_id, is_admin) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', false),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', true)
on conflict do nothing;

-- ---- Desde aquí, igual que db/seed.sql del paquete ----
insert into events (id, organization_id, name, event_type, client_name, venue_name, timezone, starts_at, ends_at, status, created_by) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001',
   'Convención anual · Lima', 'convención', 'Cliente de ejemplo', 'Centro de convenciones',
   'America/Lima', '2026-12-12 08:00-05', '2026-12-13 01:00-05', 'planned',
   '00000000-0000-0000-0000-0000000000a2');

insert into event_members (event_id, profile_id, role, title) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'producer', 'Productor general'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 'backend',  'Torre de control'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a3', 'viewer',   'Cliente');

insert into areas (id, event_id, name, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'Montaje', 1),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', 'Sonido', 2),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e1', 'Sala', 3);

insert into providers (id, organization_id, name, service, contact_name, phone) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001',
   'Proveedor de sonido de ejemplo', 'Sonido y luces', 'Contacto de ejemplo', '+51 900 000 000');

insert into route_items (id, event_id, title, area_id, provider_id, owner_id, planned_start, planned_end, current_start, current_end, is_milestone, sort_order) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'Montaje de escenario',
   '00000000-0000-0000-0000-0000000000b1', null, '00000000-0000-0000-0000-0000000000a1',
   '2026-12-12 08:00-05', '2026-12-12 13:00-05', '2026-12-12 08:00-05', '2026-12-12 13:00-05', false, 1),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', 'Prueba de sonido',
   '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
   '2026-12-12 14:00-05', '2026-12-12 16:00-05', '2026-12-12 14:00-05', '2026-12-12 16:00-05', false, 2),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000e1', 'Apertura de puertas',
   '00000000-0000-0000-0000-0000000000b3', null, '00000000-0000-0000-0000-0000000000a1',
   '2026-12-12 18:30-05', '2026-12-12 20:00-05', '2026-12-12 18:30-05', '2026-12-12 20:00-05', true, 3),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000e1', 'Show central',
   '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
   '2026-12-12 20:00-05', '2026-12-12 23:00-05', '2026-12-12 20:00-05', '2026-12-12 23:00-05', true, 4),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000e1', 'Desmontaje',
   '00000000-0000-0000-0000-0000000000b1', null, '00000000-0000-0000-0000-0000000000a1',
   '2026-12-12 23:30-05', '2026-12-13 01:00-05', '2026-12-12 23:30-05', '2026-12-13 01:00-05', false, 5);

-- Cadena: sonido depende de montaje; puertas de sonido; show de puertas; desmontaje de show.
insert into route_dependencies (item_id, depends_on_id) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d3'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000d4');

insert into critical_moments (id, event_id, route_item_id, template_key, title) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000d2', 'prueba_de_sonido', 'Prueba de sonido');

insert into moment_checks (moment_id, question, sort_order) values
  ('00000000-0000-0000-0000-0000000000f1', '¿Qué sientes que no funciona bien?', 1),
  ('00000000-0000-0000-0000-0000000000f1', '¿Qué te prometió el proveedor?', 2),
  ('00000000-0000-0000-0000-0000000000f1', 'Ingresa aquí el rider técnico.', 3);

insert into commitments (event_id, moment_id, provider_id, item_label, promised) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000c1', 'Consola', '32 canales'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1',
   '00000000-0000-0000-0000-0000000000c1', 'Monitores de piso', '6 unidades');

insert into log_entries (event_id, actor_id, kind, summary) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2',
   'event_created', 'Se creó el evento Convención anual · Lima');

-- 3 · Escala de criticidad del evento (copia de config/criticidad.json; una prueba verifica que coincidan).
update events set criticality_config = $crit${
  "_nota": "Valores por defecto PROPUESTOS. Los niveles y umbrales deben alinearse con la escala de criticidad que ya usa el desarrollo de medios de HUB51. Se copian a cada evento al crearlo.",
  "niveles": [
    {
      "nivel": 1,
      "clave": "informativo",
      "nombre": "Informativo",
      "descripcion": "Hito cumplido a tiempo. Solo se registra.",
      "color": "#a9cce8",
      "notifica": [],
      "visible_para_cliente": false
    },
    {
      "nivel": 2,
      "clave": "atencion",
      "nombre": "Atención",
      "descripcion": "Retraso o pendiente sin responsable.",
      "color": "#c9a227",
      "notifica": [
        "producer"
      ],
      "visible_para_cliente": false
    },
    {
      "nivel": 3,
      "clave": "critico",
      "nombre": "Crítico",
      "descripcion": "Lo entregado no coincide con lo prometido, o un retraso arrastra otras actividades.",
      "color": "#b3402e",
      "notifica": [
        "producer",
        "backend"
      ],
      "visible_para_cliente": false
    },
    {
      "nivel": 4,
      "clave": "red_flag",
      "nombre": "Red Flag",
      "descripcion": "Compromete el evento. Escala al cliente.",
      "color": "#061428",
      "notifica": [
        "producer",
        "backend",
        "viewer"
      ],
      "visible_para_cliente": true
    }
  ],
  "reglas": [
    {
      "clave": "actividad_sin_responsable",
      "nivel": 2,
      "cuando": "Una actividad está a menos de `minutos_antes` de empezar y no tiene responsable.",
      "parametros": {
        "minutos_antes": 120
      }
    },
    {
      "clave": "actividad_retrasada",
      "nivel": 2,
      "cuando": "Pasó la hora de inicio vigente más `tolerancia_min` y la actividad no ha empezado.",
      "parametros": {
        "tolerancia_min": 10
      }
    },
    {
      "clave": "retraso_con_arrastre",
      "nivel": 3,
      "cuando": "Un retraso o un cambio mueve `min_dependientes` o más actividades, o suma `min_minutos` o más.",
      "parametros": {
        "min_dependientes": 2,
        "min_minutos": 30
      }
    },
    {
      "clave": "compromiso_no_coincide",
      "nivel": 3,
      "cuando": "En un momento crítico, lo encontrado no coincide con lo prometido. Si es parcial, usa `nivel_parcial`.",
      "parametros": {
        "nivel_parcial": 2
      }
    },
    {
      "clave": "hito_comprometido",
      "nivel": 4,
      "cuando": "El plan vigente de un hito (apertura de puertas, inicio de show) se aleja `min_minutos` o más del plan publicado.",
      "parametros": {
        "min_minutos": 30
      }
    },
    {
      "clave": "permiso_sin_aprobar",
      "nivel": 3,
      "cuando": "Un permiso obligatorio no está aprobado y faltan `dias_antes` días o menos para el evento.",
      "parametros": {
        "dias_antes": 3
      }
    },
    {
      "clave": "permiso_sin_aprobar_dia_del_evento",
      "nivel": 4,
      "cuando": "Un permiso obligatorio no está aprobado el día del evento.",
      "parametros": {}
    },
    {
      "clave": "momento_critico_sin_resolver",
      "nivel": 3,
      "cuando": "Un momento crítico lleva abierto más de `minutos` sin resolución.",
      "parametros": {
        "minutos": 30
      }
    }
  ]
}$crit$::jsonb
where id = '00000000-0000-0000-0000-0000000000e1';
