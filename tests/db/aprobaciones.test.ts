// Aprobaciones del cliente: casting, uniforme, utilería y referencias. La productora sube, el cliente decide,
// y sin todo aprobado las piezas clave no empiezan. Cada prueba corre en una transacción que se deshace al final.
//
// Se corre con `npm run test:db`.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { withDocuments } from "@mando/core/requirements";

const ORG = "00000000-0000-0000-0000-000000000001";
const EVENT = "00000000-0000-0000-0000-0000000000e1";
const FOREIGN_EVENT = "00000000-0000-0000-0000-000000009905";
const SOUND = "00000000-0000-0000-0000-0000000000d2";
const USERS = {
  producer: "00000000-0000-0000-0000-0000000000a1", // productor de campo, nivel 2
  backend: "00000000-0000-0000-0000-0000000000a2", // productor general, nivel 1
  viewer: "00000000-0000-0000-0000-0000000000a3",
  outsider: "00000000-0000-0000-0000-000000009903",
} as const;

const config = JSON.parse(readFileSync(new URL("../../config/tipos-de-evento.json", import.meta.url), "utf8"));
const SAMPLING = JSON.stringify(withDocuments(config.tipos.find((t: { clave: string }) => t.clave === "sampling")));

type Q = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;
let db: pg.Client;

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});

async function scenario<T>(fn: (s: { admin: Q; asUser: (userId: string) => Q }) => Promise<T>): Promise<T> {
  await db.query("begin");
  const admin: Q = async (sql, params) => {
    await db.query("reset role");
    return db.query(sql, params);
  };
  const asUser = (userId: string): Q => async (sql, params) => {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    const result = await db.query(sql, params);
    await db.query("reset role");
    return result;
  };
  try {
    return await fn({ admin, asUser });
  } finally {
    await db.query("rollback");
  }
}

async function errorOf(q: Q, sql: string, params?: unknown[]): Promise<string | null> {
  await db.query("savepoint e");
  try {
    await q(sql, params);
    await db.query("release savepoint e");
    return null;
  } catch (e) {
    await db.query("rollback to savepoint e");
    return (e as Error).message;
  }
}

const PUERTAS = "00000000-0000-0000-0000-0000000000d3"; // hito del evento de ejemplo
const ADD = "select public.add_approval_item($1, $2, $3, $4, $5, $6) as id";
const DECIDE = "select public.decide_approval($1, $2, $3)";
const items = async (q: Q, event = EVENT) =>
  (await q("select id, group_key, code, name, status, version, decision_note from event_approvals where event_id = $1 and removed_at is null order by code", [event])).rows;

describe("Grupos de aprobación", () => {
  it("un sampling nuevo pide casting, uniforme y utilería; la productora los ajusta según el brief", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const id = (
        await backend(
          "select public.create_event_from_template($1, 'Sampling', null, null, 'America/Lima', '2026-12-06T15:00:00Z', $2::jsonb, '{}'::jsonb) as id",
          [ORG, SAMPLING],
        )
      ).rows[0].id;
      const groups = async () => (await admin("select approval_groups from events where id = $1", [id])).rows[0].approval_groups;
      expect(await groups()).toEqual(["casting", "uniforme", "utileria"]);
      await backend("select public.set_approval_groups($1, $2)", [id, ["referencias", "casting", "inventado", "casting"]]);
      expect(await groups()).toEqual(["casting", "referencias"]);
      expect(await errorOf(asUser(USERS.viewer), "select public.set_approval_groups($1, $2)", [id, []])).toMatch(/No tienes permiso/);
    });
  });
});

describe("Subir y decidir", () => {
  it("la productora sube con código corto; el cliente aprueba o pide cambio con motivo; todo queda en la bitácora", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const viewer = asUser(USERS.viewer);
      const a = (await producer(ADD, [EVENT, "casting", " Andrea P. ", "Anfitriona, 1,70 m", `${EVENT}/aprobaciones/a.jpg`, "f00d"])).rows[0].id;
      const b = (await producer(ADD, [EVENT, "casting", "Lucía R.", null, null, null])).rows[0].id;
      const u = (await producer(ADD, [EVENT, "uniforme", "Polo azul con logo", null, null, null])).rows[0].id;
      expect((await items(admin)).map((i) => [i.code, i.name, i.status])).toEqual([
        ["C-01", "Andrea P.", "pending"],
        ["C-02", "Lucía R.", "pending"],
        ["U-01", "Polo azul con logo", "pending"],
      ]);
      expect(await items(viewer)).toHaveLength(3); // el cliente los ve
      expect(await items(asUser(USERS.outsider))).toHaveLength(0);

      await viewer(DECIDE, [a, true, null]);
      expect(await errorOf(viewer, DECIDE, [b, false, " "])).toMatch(/qué hay que cambiar/);
      await viewer(DECIDE, [b, false, "Preferimos alguien con experiencia en retail"]);
      const now = await items(admin);
      expect(now.map((i) => i.status)).toEqual(["approved", "changes_requested", "pending"]);
      expect(now[1].decision_note).toBe("Preferimos alguien con experiencia en retail");

      const log = (await viewer("select summary, level from log_entries where kind = 'approval_updated' order by id")).rows;
      expect(log).toHaveLength(5);
      expect(log[3].summary).toMatch(/aprobó C-01 «Andrea P\.»\.$/);
      expect(log[4]).toMatchObject({ level: 2 });
      expect(u).toBeTruthy();
    });
  });

  it("la productora no se aprueba sola; el productor general solo registra la aprobación diciendo cómo la recibió", async () => {
    await scenario(async ({ admin, asUser }) => {
      const a = (await asUser(USERS.producer)(ADD, [EVENT, "utileria", "Módulo de degustación", null, null, null])).rows[0].id;
      expect(await errorOf(asUser(USERS.producer), DECIDE, [a, true, "ok"])).toMatch(/La aprobación la da el cliente/);
      expect(await errorOf(asUser(USERS.outsider), DECIDE, [a, true, "ok"])).toMatch(/No tienes permiso|La aprobación la da el cliente/);
      expect(await errorOf(asUser(USERS.backend), DECIDE, [a, true, null])).toMatch(/Anota cómo te dio el cliente/);
      await asUser(USERS.backend)(DECIDE, [a, true, "Aprobado por WhatsApp, 10:40"]);
      expect((await items(admin))[0].status).toBe("approved");
      const log = (await admin("select summary, payload from log_entries where kind = 'approval_updated' order by id desc limit 1")).rows[0];
      expect(log.summary).toContain("registró que el cliente aprobó T-01");
      expect(log.payload.on_behalf).toBe(true);
    });
  });

  it("reemplazar vuelve a «por aprobar»; retirar lo saca de la lista; el cliente no sube ni retira; nadie escribe directo", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const a = (await producer(ADD, [EVENT, "referencias", "Moodboard", null, null, null])).rows[0].id;
      await asUser(USERS.viewer)(DECIDE, [a, true, null]);
      expect(await errorOf(producer, "select public.update_approval_item($1, 'replace', null, null, $2, 'abc')", [a, `${FOREIGN_EVENT}/aprobaciones/x.jpg`])).toMatch(
        /no pertenece a las aprobaciones/,
      );
      await producer("select public.update_approval_item($1, 'replace', null, 'Versión 2', $2, 'abc')", [a, `${EVENT}/aprobaciones/v2.jpg`]);
      expect((await items(admin))[0]).toMatchObject({ status: "pending", version: 2 });

      const viewer = asUser(USERS.viewer);
      expect(await errorOf(viewer, ADD, [EVENT, "casting", "X", null, null, null])).toMatch(/No tienes permiso/);
      expect(await errorOf(viewer, "select public.update_approval_item($1, 'remove')", [a])).toMatch(/No tienes permiso/);
      for (const who of [USERS.producer, USERS.backend, USERS.viewer]) {
        expect((await asUser(who)("update event_approvals set status = 'approved'")).rowCount).toBe(0);
        expect(await errorOf(asUser(who), "insert into event_approvals (event_id, group_key, code, name) values ($1, 'casting', 'C-99', 'x')", [EVENT])).toMatch(
          /row-level security/,
        );
      }
      await producer("select public.update_approval_item($1, 'remove')", [a]);
      expect(await items(admin)).toHaveLength(0);
      // El código no se reutiliza.
      await producer(ADD, [EVENT, "referencias", "Render del stand", null, null, null]);
      expect((await items(admin))[0].code).toBe("R-02");
    });
  });
});

describe("Sin todo aprobado no se empieza", () => {
  const START = "select public.mark_item($1, 'start')";
  it("una pieza clave no empieza si falta subir un grupo o queda algo por aprobar; las demás piezas sí", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      await asUser(USERS.backend)("select public.set_approval_groups($1, $2)", [EVENT, ["casting", "uniforme"]]);
      expect(await errorOf(producer, START, [PUERTAS])).toMatch(
        /No se puede empezar «Apertura de puertas»: falta la aprobación del cliente \(Casting: falta subirlo; Uniforme: falta subirlo\)/,
      );
      await producer(START, [SOUND]); // no es pieza clave: la preproducción sigue

      const c = (await producer(ADD, [EVENT, "casting", "Andrea P.", null, null, null])).rows[0].id;
      const u = (await producer(ADD, [EVENT, "uniforme", "Polo azul", null, null, null])).rows[0].id;
      await asUser(USERS.viewer)(DECIDE, [c, true, null]);
      expect(await errorOf(producer, START, [PUERTAS])).toMatch(/Uniforme: 1 por aprobar/);
      await asUser(USERS.viewer)(DECIDE, [u, true, null]);
      await producer(START, [PUERTAS]);
      expect((await admin("select actual_start from route_items where id = $1", [PUERTAS])).rows[0].actual_start).not.toBeNull();
    });
  });

  it("un evento sin grupos de aprobación empieza como siempre", async () => {
    await scenario(async ({ asUser }) => {
      expect(await errorOf(asUser(USERS.producer), START, [PUERTAS])).toBeNull();
    });
  });
});

describe("Fotos de las aprobaciones", () => {
  it("las sube el equipo en <evento>/aprobaciones/; las ve todo miembro, cliente incluido; un ajeno no", async () => {
    await scenario(async ({ admin, asUser }) => {
      const up = async (who: string, name: string) => (await asUser(who)("select public.can_upload_approval_file($1) as ok", [name])).rows[0].ok;
      const read = async (who: string, name: string) => (await asUser(who)("select public.can_read_approval_file($1) as ok", [name])).rows[0].ok;
      const file = `${EVENT}/aprobaciones/a.jpg`;
      expect(await up(USERS.producer, file)).toBe(true);
      expect(await up(USERS.viewer, file)).toBe(false);
      expect(await up(USERS.outsider, file)).toBe(false);
      expect(await up(USERS.producer, `${FOREIGN_EVENT}/aprobaciones/a.jpg`)).toBe(false);
      expect(await read(USERS.viewer, file)).toBe(true);
      expect(await read(USERS.outsider, file)).toBe(false);
      expect(await read(USERS.viewer, `${EVENT}/expediente/contrato.pdf`)).toBe(false); // el expediente sigue siendo interno
      await admin("update events set status = 'closed' where id = $1", [EVENT]);
      expect(await up(USERS.producer, file)).toBe(false);
    });
  });
});
