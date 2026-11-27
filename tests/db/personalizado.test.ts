// Evento personalizado (decisión 83): la misma función de siempre crea el evento con la plantilla armada
// a partir de los componentes marcados. Cada prueba corre en una transacción que se deshace al final.
//
// Se corre con `npm run test:db`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { CUSTOM_BLOCKS, composeCustomTemplate } from "@mando/core/custom-event";

const ORG = "00000000-0000-0000-0000-000000000001";
const USERS = {
  producer: "00000000-0000-0000-0000-0000000000a1", // productor de campo, nivel 2
  backend: "00000000-0000-0000-0000-0000000000a2", // productor general, nivel 1
} as const;

const ALL = CUSTOM_BLOCKS.flatMap((b) => b.modulos.map((m) => m.clave));

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

const CREATE =
  "select public.create_event_from_template($1, 'Megaproyecto', 'Cliente', 'Lima', 'America/Lima', '2027-03-20T20:00:00Z', $2::jsonb, '{}'::jsonb) as id";

describe("evento personalizado", () => {
  it("con todo marcado, el evento nace con cada documento, ítem técnico, aprobación, pieza y no negociable", async () => {
    await scenario(async ({ admin, asUser }) => {
      const template = composeCustomTemplate("Lanzamiento con talento internacional", ALL);
      const id = (await asUser(USERS.backend)(CREATE, [ORG, JSON.stringify(template)])).rows[0].id;

      const ev = (await admin("select event_type, kind, tier, planning_gate, approval_groups from events where id = $1", [id])).rows[0];
      expect(ev).toMatchObject({ event_type: "Lanzamiento con talento internacional", kind: "personalizado", tier: "mayor", planning_gate: true });
      expect([...ev.approval_groups].sort()).toEqual(["casting", "referencias", "uniforme", "utileria"]);

      const reqs = (await admin("select key, category, mandatory from event_requirements where event_id = $1", [id])).rows;
      expect(reqs).toHaveLength(template.documentos.length);
      expect(reqs.find((r) => r.key === "garantia-sunat")).toMatchObject({ category: "administracion", mandatory: true });
      expect(reqs.map((r) => r.key)).toEqual(expect.arrayContaining(["sctr", "epp", "calidad-migratoria", "dam-importacion", "guias-remision"]));

      const tech = (await admin("select title from event_tech_items where event_id = $1", [id])).rows;
      expect(tech).toHaveLength(template.tecnica.length);

      const route = (await admin("select title from route_items where event_id = $1", [id])).rows;
      expect(route).toHaveLength(template.piezas.length);

      const flags = (await admin("select title from event_criteria where event_id = $1 and kind = 'no_negociable'", [id])).rows;
      expect(flags.map((f) => f.title)).toEqual(expect.arrayContaining(["Activos internados con garantía vigente", "Estructuras certificadas antes de abrir"]));
    });
  });

  it("un documento del armado nunca vence después del tope de 48 horas, y lo posterior queda después", async () => {
    await scenario(async ({ admin, asUser }) => {
      const template = composeCustomTemplate("Gira con activos", ["internamiento"]);
      const id = (await asUser(USERS.backend)(CREATE, [ORG, JSON.stringify(template)])).rows[0].id;
      const due = async (key: string) =>
        new Date((await admin("select due_at from event_requirements where event_id = $1 and key = $2", [id, key])).rows[0].due_at).toISOString();
      expect(await due("admision-temporal")).toBe("2027-03-05T20:00:00.000Z"); // 15 días antes
      expect(await due("dam-reexportacion")).toBe("2027-04-04T20:00:00.000Z"); // 15 días después
    });
  });

  it("solo el productor general lo crea", async () => {
    await scenario(async ({ asUser }) => {
      const template = composeCustomTemplate("Intento", ["interior"]);
      expect(await errorOf(asUser(USERS.producer), CREATE, [ORG, JSON.stringify(template)])).not.toBeNull();
    });
  });
});
