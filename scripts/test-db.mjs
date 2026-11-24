#!/usr/bin/env node
// Prueba de permisos de la base de datos (criterio de aceptación de la Fase 0).
//
// Crea una base de datos PostgreSQL desechable, aplica en orden:
//   tests/db/supabase-shim.sql  → imita lo que Supabase trae de fábrica (auth.uid(), roles anon/authenticated)
//   supabase/migrations/*.sql   → el esquema y la seguridad por fila reales
//   supabase/seed.sql           → el evento de ejemplo y los tres usuarios
//   tests/db/fixtures.sql       → filas ocultas y un evento ajeno para comprobar el aislamiento
// y luego corre tests/db/*.test.ts con Vitest.
//
// Dónde corre PostgreSQL:
//   * Si existe TEST_DATABASE_ADMIN_URL (p. ej. postgres://postgres:postgres@localhost:5432/postgres),
//     crea ahí una base temporal "mando_rls_<n>" y la borra al final. Así corre en GitHub Actions.
//   * Si no, busca initdb/pg_ctl en el equipo y levanta un servidor temporal en una carpeta temporal.
//
// Nunca apuntes esto a la base de producción.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");

function findPgBin() {
  const which = spawnSync("sh", ["-c", "command -v initdb"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return join(which.stdout.trim(), "..");
  const base = "/usr/lib/postgresql";
  if (existsSync(base)) {
    const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
    for (const v of versions) if (existsSync(join(base, v, "bin", "initdb"))) return join(base, v, "bin");
  }
  for (const p of ["/opt/homebrew/bin", "/usr/local/bin"]) if (existsSync(join(p, "initdb"))) return p;
  return null;
}

async function startTempServer() {
  const bin = findPgBin();
  if (!bin) {
    console.error("No encontré PostgreSQL. Instálalo o define TEST_DATABASE_ADMIN_URL.");
    process.exit(1);
  }
  const dir = mkdtempSync(join(tmpdir(), "mando-pg-"));
  const data = join(dir, "data");
  const port = 55000 + Math.floor(Math.random() * 1000);
  const asPostgres = process.getuid?.() === 0; // initdb no corre como root
  const run = (cmd, args) => {
    const full = asPostgres
      ? spawnSync("su", ["postgres", "-s", "/bin/sh", "-c", [join(bin, cmd), ...args].map((a) => `'${a}'`).join(" ")], { encoding: "utf8" })
      : spawnSync(join(bin, cmd), args, { encoding: "utf8" });
    if (full.status !== 0) throw new Error(`${cmd} falló:\n${full.stdout}\n${full.stderr}`);
  };
  if (asPostgres) spawnSync("chown", ["-R", "postgres", dir]);
  run("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"]);
  run("pg_ctl", ["-D", data, "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1`, "-w", "-l", join(dir, "log"), "start"]);
  return {
    adminUrl: `postgres://postgres@127.0.0.1:${port}/postgres`,
    stop: () => {
      try { run("pg_ctl", ["-D", data, "-m", "fast", "stop"]); } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}

async function main() {
  const server = process.env.TEST_DATABASE_ADMIN_URL
    ? { adminUrl: process.env.TEST_DATABASE_ADMIN_URL, stop: () => {} }
    : await startTempServer();

  const dbName = `mando_rls_${Date.now()}`;
  const admin = new pg.Client({ connectionString: server.adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.query(`alter database ${dbName} set search_path = "$user", public, extensions`);
  const testUrl = new URL(server.adminUrl);
  testUrl.pathname = `/${dbName}`;

  let code = 1;
  try {
    const db = new pg.Client({ connectionString: testUrl.toString() });
    await db.connect();
    const steps = [
      "tests/db/supabase-shim.sql",
      ...readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => `supabase/migrations/${f}`),
      "supabase/seed.sql",
      "tests/db/fixtures.sql",
    ];
    for (const step of steps) {
      try {
        await db.query(read(step));
      } catch (e) {
        console.error(`Error aplicando ${step}: ${e.message}`);
        throw e;
      }
      console.log(`✓ aplicado ${step}`);
    }
    await db.end();

    code = await new Promise((resolve) => {
      const child = spawn("npx", ["vitest", "run", "--config", "vitest.db.config.mts"], {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, TEST_DATABASE_URL: testUrl.toString() },
      });
      child.on("exit", (c) => resolve(c ?? 1));
    });
  } finally {
    await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => {});
    await admin.end();
    server.stop();
  }
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
