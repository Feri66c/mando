#!/usr/bin/env node
// Junta las migraciones y el seed en un solo archivo, supabase/instalar-todo.sql,
// para pegarlo de una vez en el SQL Editor de Supabase (proyecto nuevo y vacío).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dir = join(root, "supabase/migrations");
const parts = [
  "-- MANDO · instalación completa para un proyecto de Supabase NUEVO y vacío.",
  "-- Archivo generado con `npm run db:bundle`. No lo edites a mano: edita las migraciones o el seed.",
  "-- Pégalo entero en Supabase → SQL Editor → New query → Run.",
  "",
];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  parts.push(`-- ===================== ${f} =====================`, readFileSync(join(dir, f), "utf8"), "");
}
parts.push("-- ===================== seed.sql (datos de ejemplo) =====================", readFileSync(join(root, "supabase/seed.sql"), "utf8"));
writeFileSync(join(root, "supabase/instalar-todo.sql"), parts.join("\n"));
console.log("✓ supabase/instalar-todo.sql actualizado");

// Para un Supabase que ya tiene la Fase 0 instalada: solo lo nuevo de la Etapa 1.
const seed = readFileSync(join(root, "supabase/seed.sql"), "utf8");
const crit = seed.slice(seed.indexOf("update events set criticality_config"));
writeFileSync(
  join(root, "supabase/actualizar-etapa-1.sql"),
  [
    "-- MANDO · actualización de la Fase 0 a la Etapa 1, para un Supabase que YA tiene instalar-todo.sql de la Fase 0.",
    "-- Archivo generado con `npm run db:bundle`. Pégalo entero en Supabase → SQL Editor → New query → Run.",
    "",
    readFileSync(join(root, "supabase/migrations/20261126000003_operacion_etapa_1.sql"), "utf8"),
    "",
    "-- Escala de criticidad del evento de ejemplo, con el parámetro nuevo de compromisos.",
    crit,
  ].join("\n"),
);
console.log("✓ supabase/actualizar-etapa-1.sql actualizado");

// Para un Supabase que ya tiene la Etapa 1: solo lo nuevo de la Etapa 2.
writeFileSync(
  join(root, "supabase/actualizar-etapa-2.sql"),
  [
    "-- MANDO · actualización de la Etapa 1 a la Etapa 2, para un Supabase que YA tiene la Etapa 1.",
    "-- Archivo generado con `npm run db:bundle`. Pégalo entero en Supabase → SQL Editor → New query → Run.",
    "",
    readFileSync(join(root, "supabase/migrations/20261127000004_app_movil.sql"), "utf8"),
    "",
    "-- Eventos por invitación y tipos de evento.",
    readFileSync(join(root, "supabase/migrations/20261128000005_invitaciones_y_tipos.sql"), "utf8"),
    "",
    "-- Méritos y cierre del evento.",
    readFileSync(join(root, "supabase/migrations/20261129000006_meritos_y_cierre.sql"), "utf8"),
    "",
    "-- Expediente y locación.",
    readFileSync(join(root, "supabase/migrations/20261130000007_expediente_y_locacion.sql"), "utf8"),
    "",
    "-- Aprobaciones del cliente.",
    readFileSync(join(root, "supabase/migrations/20261201000008_aprobaciones_del_cliente.sql"), "utf8"),
    "",
    "-- Planificación: los 5 elementos.",
    readFileSync(join(root, "supabase/migrations/20261202000009_planificacion.sql"), "utf8"),
    "",
    "-- Tiempos del timeline.",
    readFileSync(join(root, "supabase/migrations/20261203000010_tiempos_del_timeline.sql"), "utf8"),
    "",
    "-- Aprendizajes y ficha de satisfacción.",
    readFileSync(join(root, "supabase/migrations/20261204000011_aprendizajes_y_satisfaccion.sql"), "utf8"),
  ].join("\n"),
);
console.log("✓ supabase/actualizar-etapa-2.sql actualizado");
