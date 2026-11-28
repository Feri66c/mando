import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const EVENT = "00000000-0000-0000-0000-0000000000e1";
const USERS = {
  producer: "00000000-0000-0000-0000-0000000000a1",
  backend: "00000000-0000-0000-0000-0000000000a2",
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

describe("Documentos complementarios del brief", () => {
  it("solo el backend los suma; el equipo los lee y el cliente y los ajenos no", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const producer = asUser(USERS.producer);
      const doc = `${EVENT}/brief/noticia.pdf`;
      expect(await errorOf(producer, "select public.add_brief_document($1, $2, $3)", [EVENT, doc, "Noticia"])).toMatch(/los sube el backend/);
      expect(await errorOf(asUser(USERS.viewer), "select public.add_brief_document($1, $2, $3)", [EVENT, doc, "Noticia"])).toMatch(/No tienes permiso/);
      expect(await errorOf(backend, "select public.add_brief_document($1, $2, $3)", [EVENT, "otro-evento/brief/x.pdf", "X"])).toMatch(/no pertenece/);
      const id = (await backend("select public.add_brief_document($1, $2, $3) as id", [EVENT, doc, "Las Palmas clausurada"])).rows[0].id;
      // Subirlo dos veces no duplica la fila ni la bitácora.
      expect((await backend("select public.add_brief_document($1, $2, $3) as id", [EVENT, doc, "Las Palmas clausurada"])).rows[0].id).toBe(id);
      expect((await producer("select name from brief_documents where event_id = $1", [EVENT])).rows).toEqual([{ name: "Las Palmas clausurada" }]);
      expect((await asUser(USERS.viewer)("select id from brief_documents")).rows).toHaveLength(0);
      expect((await asUser(USERS.outsider)("select id from brief_documents")).rows).toHaveLength(0);
      const can = async (q: Q, name: string) => (await q("select public.can_read_brief_file($1) as ok", [name])).rows[0].ok;
      expect(await can(producer, doc)).toBe(true);
      expect(await can(asUser(USERS.viewer), doc)).toBe(false);
      expect(await can(asUser(USERS.outsider), doc)).toBe(false);
      expect(await can(producer, `${EVENT}/brief/sin-registrar.pdf`)).toBe(false);
      expect((await admin("select count(*)::int as n from log_entries where event_id = $1 and entity_type = 'brief_document'", [EVENT])).rows[0].n).toBe(1);
      // Nadie escribe la tabla directo.
      expect(await errorOf(backend, "insert into brief_documents (event_id, path, name) values ($1, $2, 'x')", [EVENT, `${EVENT}/brief/y.pdf`])).toMatch(/permission denied|row-level/);
      expect(await errorOf(backend, "delete from brief_documents where id = $1", [id])).toBeNull();
      expect((await admin("select count(*)::int as n from brief_documents where id = $1", [id])).rows[0].n).toBe(1);
    });
  });
});

describe("Recomendaciones de la IA", () => {
  it("el backend las acepta y quedan en la bitácora con la lista completa", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const items = [{ titulo: "Cambiar el local", nivel: "alto" }, { titulo: "Reforzar la seguridad", nivel: "medio" }];
      expect(await errorOf(asUser(USERS.producer), "select public.accept_brief_recommendations($1, $2)", [EVENT, JSON.stringify(items)])).toMatch(/las acepta el backend/);
      expect(await errorOf(asUser(USERS.outsider), "select public.accept_brief_recommendations($1, $2)", [EVENT, JSON.stringify(items)])).toMatch(/No tienes permiso/);
      expect(await errorOf(backend, "select public.accept_brief_recommendations($1, $2)", [EVENT, '{"a":1}'])).toMatch(/Faltan/);
      await backend("select public.accept_brief_recommendations($1, $2)", [EVENT, JSON.stringify(items)]);
      const log = (await admin("select summary, payload from log_entries where event_id = $1 and kind = 'brief_recommendations_accepted'", [EVENT])).rows;
      expect(log).toHaveLength(1);
      expect(log[0].summary).toMatch(/leyó 2 recomendaciones/);
      expect(log[0].payload.items).toEqual(items);
    });
  });
});
