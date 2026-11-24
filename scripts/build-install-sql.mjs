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
