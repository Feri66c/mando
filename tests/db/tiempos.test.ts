// Tiempos del timeline: quién puede estimar y qué queda en la bitácora.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const EVENT = "00000000-0000-0000-0000-0000000000e1";
const USERS = {
  producer: "00000000-0000-0000-0000-0000000000a1", // productor de campo, nivel 2
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
    await db.query("reset role");
    return (e as Error).message;
  }
}

describe("tiempos del timeline", () => {
  it("el productor de campo estima y la hoja de ruta no se mueve", () =>
    scenario(async ({ admin, asUser }) => {
      const item = (await admin("select id, current_start, current_end from route_items where event_id = $1 order by current_start limit 1", [EVENT])).rows[0];
      const logs = async () => Number((await admin("select count(*) from log_entries where event_id = $1", [EVENT])).rows[0].count);
      const before = await logs();
      await asUser(USERS.producer)("select set_estimate($1, 240)", [item.id]);
      const after = (await admin("select estimated_minutes, estimated_by, current_start, current_end from route_items where id = $1", [item.id])).rows[0];
      expect(after.estimated_minutes).toBe(240);
      expect(after.estimated_by).toBe(USERS.producer);
      expect(after.current_start).toEqual(item.current_start);
      expect(after.current_end).toEqual(item.current_end);
      expect(await logs()).toBe(before + 1);
      const log = (await admin("select summary, visible_to_viewer from log_entries where event_id = $1 order by id desc limit 1", [EVENT])).rows[0];
      expect(log.summary).toContain("estimó 240 min");
      expect(log.visible_to_viewer).toBe(false);
      // Repetir el mismo valor no ensucia la bitácora.
      await asUser(USERS.producer)("select set_estimate($1, 240)", [item.id]);
      expect(await logs()).toBe(before + 1);
    }));

  it("ni el cliente, ni alguien de afuera, ni un nivel 3 pueden estimar", () =>
    scenario(async ({ admin, asUser }) => {
      const item = (await admin("select id from route_items where event_id = $1 limit 1", [EVENT])).rows[0];
      expect(await errorOf(asUser(USERS.viewer), "select set_estimate($1, 60)", [item.id])).toBeTruthy();
      expect(await errorOf(asUser(USERS.outsider), "select set_estimate($1, 60)", [item.id])).toBeTruthy();
      expect(await errorOf(asUser(USERS.viewer), "update route_items set estimated_minutes = 60 where id = $1 returning id", [item.id])).toBeNull();
      expect((await admin("select estimated_minutes from route_items where id = $1", [item.id])).rows[0].estimated_minutes).toBeNull();
      await admin("update event_members set level = 3 where event_id = $1 and profile_id = $2", [EVENT, USERS.producer]);
      expect(await errorOf(asUser(USERS.producer), "select set_estimate($1, 60)", [item.id])).toMatch(/productor general o el productor de campo/);
    }));

  it("el tiempo va de 5 minutos a 24 horas", () =>
    scenario(async ({ admin, asUser }) => {
      const item = (await admin("select id from route_items where event_id = $1 limit 1", [EVENT])).rows[0];
      expect(await errorOf(asUser(USERS.producer), "select set_estimate($1, 2)", [item.id])).toMatch(/5 minutos a 24 horas/);
      expect(await errorOf(asUser(USERS.producer), "select set_estimate($1, 5000)", [item.id])).toMatch(/5 minutos a 24 horas/);
    }));
});
