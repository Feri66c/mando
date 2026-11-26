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


describe("Aceptación del cargo", () => {
  it("cada quien acepta solo su propio cargo y queda en la bitácora una sola vez", async () => {
    await scenario(async ({ admin, asUser }) => {
      await admin("update event_members set accepted_at = null, welcomed_at = null where event_id = $1 and profile_id = $2", [EVENT, USERS.producer]);
      const producer = asUser(USERS.producer);
      await producer("select public.accept_role($1)", [EVENT]);
      await producer("select public.accept_role($1)", [EVENT]);
      expect((await admin("select accepted_at is not null as ok from event_members where event_id = $1 and profile_id = $2", [EVENT, USERS.producer])).rows[0].ok).toBe(true);
      expect((await admin("select count(*)::int as n from log_entries where event_id = $1 and kind = 'role_accepted'", [EVENT])).rows[0].n).toBe(1);
      expect(await errorOf(asUser(USERS.outsider), "select public.accept_role($1)", [EVENT])).toMatch(/No eres parte/);
    });
  });
});

describe("Brief del evento", () => {
  it("solo el backend lo carga; el equipo lo lee y el cliente y los ajenos no", async () => {
    await scenario(async ({ asUser }) => {
      const backend = asUser(USERS.backend);
      const producer = asUser(USERS.producer);
      expect(await errorOf(producer, "select public.set_brief($1, $2)", [EVENT, "x"])).toMatch(/lo carga el backend/);
      expect(await errorOf(asUser(USERS.viewer), "select public.set_brief($1, $2)", [EVENT, "x"])).toMatch(/No tienes permiso/);
      expect(await errorOf(backend, "select public.set_brief($1, $2)", [EVENT, "  "])).toMatch(/Escribe el brief/);
      expect((await backend("select public.set_brief($1, $2, $3, $4) as v", [EVENT, "Convención anual.", "Marca impecable", "800"])).rows[0].v).toBe(1);
      expect((await producer("select version, summary from event_briefs where event_id = $1", [EVENT])).rows).toEqual([{ version: 1, summary: "Convención anual." }]);
      expect((await asUser(USERS.viewer)("select version from event_briefs")).rows).toHaveLength(0);
      expect((await asUser(USERS.outsider)("select version from event_briefs")).rows).toHaveLength(0);
    });
  });

  it("con una duda abierta no se avanza hasta que el backend responde", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const producer = asUser(USERS.producer);
      expect(await errorOf(producer, "select public.ack_brief($1)", [EVENT])).toMatch(/todavía no carga el brief/);
      await backend("select public.set_brief($1, $2)", [EVENT, "Es el sábado 12."]);
      expect(await errorOf(producer, "select public.raise_brief_doubt($1, $2)", [EVENT, " "])).toMatch(/Cuenta qué no coincide/);
      const doubt = (await producer("select public.raise_brief_doubt($1, $2) as id", [EVENT, "Me dijeron que era el 17."])).rows[0].id;
      expect(await errorOf(producer, "select public.raise_brief_doubt($1, $2)", [EVENT, "Otra"])).toMatch(/Ya tienes una duda/);
      expect(await errorOf(producer, "select public.ack_brief($1)", [EVENT])).toMatch(/duda sin responder/);
      // La duda llega al backend como alerta, y el cliente no la ve.
      const alert = (await admin("select level, status, visible_to_viewer from alerts where rule_key = 'brief_doubt' and entity_id = $1", [doubt])).rows[0];
      expect(alert).toEqual({ level: 2, status: "open", visible_to_viewer: false });
      expect((await backend("select question from brief_doubts where event_id = $1", [EVENT])).rows).toHaveLength(1);
      expect((await asUser(USERS.viewer)("select id from brief_doubts")).rows).toHaveLength(0);
      expect((await asUser(USERS.outsider)("select id from brief_doubts")).rows).toHaveLength(0);

      // Solo el backend responde. Si antes corrigió el brief, queda marcado.
      expect(await errorOf(producer, "select public.answer_brief_doubt($1, $2)", [doubt, "ok"])).toMatch(/las responde el backend/);
      expect(await errorOf(backend, "select public.answer_brief_doubt($1, $2)", [doubt, ""])).toMatch(/Escribe la respuesta/);
      await backend("select public.set_brief($1, $2)", [EVENT, "Es el sábado 12, confirmado."]);
      await backend("select public.answer_brief_doubt($1, $2)", [doubt, "Es el 12."]);
      expect((await producer("select status, answer, corrected from brief_doubts where id = $1", [doubt])).rows[0]).toEqual({ status: "answered", answer: "Es el 12.", corrected: true });
      expect((await admin("select status from alerts where rule_key = 'brief_doubt' and entity_id = $1", [doubt])).rows[0].status).toBe("resolved");
      expect(await errorOf(backend, "select public.answer_brief_doubt($1, $2)", [doubt, "otra"])).toMatch(/ya fue respondida/);

      await producer("select public.ack_brief($1)", [EVENT]);
      await producer("select public.ack_brief($1)", [EVENT]);
      expect((await producer("select version from brief_acks where event_id = $1", [EVENT])).rows).toEqual([{ version: 2 }]);
      expect((await admin("select count(*)::int as n from log_entries where event_id = $1 and kind = 'brief_acknowledged'", [EVENT])).rows[0].n).toBe(1);
      // Cada quien ve solo su «enterado»; el backend ve todos.
      expect((await backend("select profile_id from brief_acks where event_id = $1", [EVENT])).rows).toHaveLength(1);
    });
  });

  it("sin brief leído no se toma el mando; el cliente entra sin brief", async () => {
    await scenario(async ({ admin, asUser }) => {
      await admin("update event_members set accepted_at = null, welcomed_at = null where event_id = $1", [EVENT]);
      const producer = asUser(USERS.producer);
      await asUser(USERS.backend)("select public.set_brief($1, $2)", [EVENT, "Brief."]);
      expect(await errorOf(producer, "select public.mark_welcomed($1)", [EVENT])).toMatch(/enterado del brief/);
      await producer("select public.ack_brief($1)", [EVENT]);
      await producer("select public.mark_welcomed($1)", [EVENT]);
      await asUser(USERS.viewer)("select public.mark_welcomed($1)", [EVENT]);
      expect((await admin("select count(*)::int as n from event_members where event_id = $1 and welcomed_at is not null and accepted_at is not null", [EVENT])).rows[0].n).toBe(2);
      // La bitácora no se toca: no hay forma de borrar ni editar desde un usuario.
      expect(await errorOf(producer, "delete from brief_doubts")).toBeNull();
      expect(await errorOf(producer, "insert into brief_acks (event_id, profile_id, version) values ($1, $2, 9)", [EVENT, USERS.producer])).toMatch(/row-level security|permission denied/);
    });
  });
});
