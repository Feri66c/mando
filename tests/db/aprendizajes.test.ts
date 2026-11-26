// Encuesta de cierre: quién escribe, quién lee y qué queda en la bitácora.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const EVENT = "00000000-0000-0000-0000-0000000000e1";
const USERS = {
  producer: "00000000-0000-0000-0000-0000000000a1", // productor de campo, nivel 2
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
    await db.query("reset role");
    return (e as Error).message;
  }
}

describe("encuesta de cierre", () => {
  it("el equipo deja hasta 6 aprendizajes y la bitácora no dice qué escribió", () =>
    scenario(async ({ admin, asUser }) => {
      await asUser(USERS.producer)("select save_learnings($1, $2, $3)", [EVENT, ["Llegar una hora antes", "  ", "Probar el sonido dos veces"], "Buen equipo."]);
      const row = (await admin("select kind, items, extra from event_feedback where event_id = $1 and profile_id = $2", [EVENT, USERS.producer])).rows[0];
      expect(row.kind).toBe("learnings");
      expect(row.items).toEqual(["Llegar una hora antes", "Probar el sonido dos veces"]);
      expect(row.extra).toBe("Buen equipo.");
      const log = (await admin("select summary, visible_to_viewer from log_entries where event_id = $1 order by id desc limit 1", [EVENT])).rows[0];
      expect(log.summary).toContain("compartió sus aprendizajes");
      expect(log.summary).not.toContain("sonido");
      expect(log.visible_to_viewer).toBe(false);
      expect(await errorOf(asUser(USERS.producer), "select save_learnings($1, $2)", [EVENT, ["1", "2", "3", "4", "5", "6", "7"]])).toMatch(/hasta 6/);
      expect(await errorOf(asUser(USERS.producer), "select save_learnings($1, $2)", [EVENT, [" "]])).toMatch(/al menos un aprendizaje/);
    }));

  it("el cliente llena su ficha y no puede dejar aprendizajes; el equipo no llena la ficha", () =>
    scenario(async ({ admin, asUser }) => {
      expect(await errorOf(asUser(USERS.viewer), "select save_learnings($1, $2)", [EVENT, ["x"]])).toMatch(/equipo del evento/);
      expect(await errorOf(asUser(USERS.producer), "select save_satisfaction($1, 5)", [EVENT])).toMatch(/la llena el cliente/);
      expect(await errorOf(asUser(USERS.outsider), "select save_satisfaction($1, 5)", [EVENT])).toMatch(/la llena el cliente/);
      expect(await errorOf(asUser(USERS.viewer), "select save_satisfaction($1, 9)", [EVENT])).toMatch(/1 a 5/);
      await asUser(USERS.viewer)("select save_satisfaction($1, 4, $2)", [EVENT, "Todo a tiempo."]);
      const log = (await admin("select summary, visible_to_viewer from log_entries where event_id = $1 order by id desc limit 1", [EVENT])).rows[0];
      expect(log.summary).toContain("ficha de satisfacción");
      expect(log.visible_to_viewer).toBe(true);
    }));

  it("cada quien ve lo suyo; los niveles 1 y 2 ven todo; nadie escribe la tabla directo", () =>
    scenario(async ({ admin, asUser }) => {
      await asUser(USERS.producer)("select save_learnings($1, $2)", [EVENT, ["Llegar antes"]]);
      await asUser(USERS.viewer)("select save_satisfaction($1, 4)", [EVENT]);
      expect((await asUser(USERS.viewer)("select * from event_feedback where event_id = $1", [EVENT])).rowCount).toBe(1);
      expect((await asUser(USERS.outsider)("select * from event_feedback where event_id = $1", [EVENT])).rowCount).toBe(0);
      expect((await asUser(USERS.backend)("select * from event_feedback where event_id = $1", [EVENT])).rowCount).toBe(2);
      expect((await asUser(USERS.backend)("select event_feedback_board($1) as b", [EVENT])).rows[0].b).toHaveLength(2);
      expect((await asUser(USERS.viewer)("select event_feedback_board($1) as b", [EVENT])).rows[0].b).toEqual([]);
      await admin("update event_members set level = 3 where event_id = $1 and profile_id = $2", [EVENT, USERS.producer]);
      expect((await asUser(USERS.producer)("select * from event_feedback where event_id = $1", [EVENT])).rowCount).toBe(1);
      expect(await errorOf(asUser(USERS.producer), "insert into event_feedback (event_id, profile_id, kind, items) values ($1, $2, 'learnings', '{x}')", [EVENT, USERS.backend])).toBeTruthy();
      expect((await asUser(USERS.viewer)("update event_feedback set stars = 1 where event_id = $1 returning 1", [EVENT])).rowCount).toBe(0);
    }));
});
