// Mando de marca y pedidos especiales (decisión 95): «MANDO Momentum» con su logo, y lo que cada mando
// pide distinto. Cada prueba corre en una transacción que se deshace al final.
//
// Se corre con `npm run test:db`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const ORG = "00000000-0000-0000-0000-000000000001";
const EVENT = "00000000-0000-0000-0000-0000000000e1";
const USERS = {
  producer: "00000000-0000-0000-0000-0000000000a1", // productor de campo, nivel 2
  backend: "00000000-0000-0000-0000-0000000000a2", // productor general, nivel 1
  viewer: "00000000-0000-0000-0000-0000000000a3",
  outsider: "00000000-0000-0000-0000-000000009903",
} as const;

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

const OTHER_ORG = "00000000-0000-0000-0000-000000009904";
const LOGO = `org/${ORG}/logo/11111111-1111-4111-8111-111111111111.png`;

describe("mando de marca", () => {
  it("solo quien administra la organización firma el mando, y lo ve quien ve la organización", async () => {
    await scenario(async ({ admin, asUser }) => {
      await asUser(USERS.backend)("select public.set_org_brand($1, 'Momentum', 'McCann Erickson', $2)", [ORG, LOGO]);
      const { rows } = await admin("select brand_name, parent_name, logo_path from organizations where id = $1", [ORG]);
      expect(rows[0]).toEqual({ brand_name: "Momentum", parent_name: "McCann Erickson", logo_path: LOGO });

      expect(await errorOf(asUser(USERS.producer), "select public.set_org_brand($1, 'Otro')", [ORG])).toMatch(/administra/);
      expect(await errorOf(asUser(USERS.backend), "select public.set_org_brand($1, 'Circus', null, 'org/x/logo/a.gif')", [ORG])).toMatch(/PNG/);
      expect(await errorOf(asUser(USERS.backend), "select public.set_org_brand($1, 'Circus')", [OTHER_ORG])).toMatch(/administra/);

      // Quitar el logo deja solo el nombre.
      await asUser(USERS.backend)("select public.set_org_brand($1, 'Momentum', null, null, true)", [ORG]);
      const after = await admin("select logo_path, parent_name from organizations where id = $1", [ORG]);
      expect(after.rows[0]).toEqual({ logo_path: null, parent_name: null });
    });
  });

  it("el logo lo sube el administrador y lo lee quien ve la organización", async () => {
    await scenario(async ({ asUser }) => {
      const up = (u: string, p: string) => asUser(u)("select public.can_upload_org_logo($1) as ok", [p]).then((r) => r.rows[0].ok);
      const read = (u: string, p: string) => asUser(u)("select public.can_read_org_logo($1) as ok", [p]).then((r) => r.rows[0].ok);
      expect(await up(USERS.backend, LOGO)).toBe(true);
      expect(await up(USERS.producer, LOGO)).toBe(false);
      expect(await up(USERS.backend, `org/${ORG}/logo/a.exe`)).toBe(false);
      expect(await up(USERS.backend, `org/${OTHER_ORG}/logo/a.png`)).toBe(false);
      expect(await read(USERS.producer, LOGO)).toBe(true);
      expect(await read(USERS.outsider, LOGO)).toBe(false);
    });
  });
});

describe("pedidos especiales", () => {
  it("se piden, se cotizan y se activan; nadie los borra ni los ve de afuera", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const { rows } = await backend("select public.request_customization($1, 'Priorizar las palabras de la marca', 'McCann quiere su vocabulario') as id", [ORG]);
      const id = rows[0].id as string;
      const first = await admin("select status, billable from organization_requests where id = $1", [id]);
      expect(first.rows[0]).toEqual({ status: "pedido", billable: true });

      await backend("select public.set_customization_status($1, 'cotizado', true, 'Una actualización')", [id]);
      await backend("select public.set_customization_status($1, 'activo')", [id]);
      const done = await admin("select status, quote_note from organization_requests where id = $1", [id]);
      expect(done.rows[0]).toEqual({ status: "activo", quote_note: "Una actualización" });

      expect(await errorOf(asUser(USERS.producer), "select public.request_customization($1, 'Algo distinto')", [ORG])).toMatch(/administra/);
      expect(await errorOf(asUser(USERS.producer), "select public.set_customization_status($1, 'activo')", [id])).toMatch(/administra/);
      expect(await errorOf(backend, "select public.set_customization_status($1, 'regalado')", [id])).toMatch(/estado/);
      expect(await errorOf(backend, "select public.request_customization($1, 'no')", [ORG])).toMatch(/línea/);

      expect((await asUser(USERS.producer)("select * from organization_requests")).rowCount).toBe(0);
      expect((await asUser(USERS.outsider)("select * from organization_requests")).rowCount).toBe(0);
      expect((await backend("select * from organization_requests")).rowCount).toBe(1);
      await errorOf(backend, "delete from organization_requests where id = $1", [id]);
      expect((await admin("select 1 from organization_requests where id = $1", [id])).rowCount).toBe(1);
      expect(await errorOf(backend, "insert into organization_requests (organization_id, title) values ($1, 'directo')", [ORG])).toMatch(/permission denied|row-level/);
    });
  });
});
