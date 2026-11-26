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


const PUERTAS = "00000000-0000-0000-0000-0000000000d3";
const ADD = "select public.add_tech_item($1, 'sonido', $2, null, 1, $3, null) as id";

describe("Técnico: documento y «No aplica» con revisión", () => {
  it("adjuntar confirma; «No aplica» lo pide el productor y lo decide el backend", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const producer = asUser(USERS.producer);
      const sonido = (await producer(ADD, [EVENT, "Sonido", true])).rows[0].id;
      const pantallas = (await producer(ADD, [EVENT, "Pantallas", false])).rows[0].id;

      expect(await errorOf(producer, "select public.attach_tech_doc($1, $2, $3)", [sonido, "otro-evento/expediente/x.pdf", "x.pdf"])).toMatch(/no pertenece/);
      expect(await errorOf(asUser(USERS.viewer), "select public.attach_tech_doc($1, $2, $3)", [sonido, `${EVENT}/expediente/x.pdf`, "x.pdf"])).toMatch(/No tienes permiso/);
      expect(await errorOf(asUser(USERS.outsider), "select public.request_tech_na($1)", [sonido])).toMatch(/No tienes permiso/);

      await producer("select public.request_tech_na($1)", [sonido]);
      await producer("select public.request_tech_na($1)", [pantallas]);
      expect((await admin("select count(*)::int as n from alerts where rule_key = 'tech_na' and status = 'open'")).rows[0].n).toBe(2);
      expect(await errorOf(producer, "select public.review_tech_na($1, true)", [sonido])).toMatch(/lo revisa el backend/);

      // Obligatorio que sí aplica: sigue pendiente y sube a Crítico. El otro se acepta.
      await backend("select public.review_tech_na($1, true)", [sonido]);
      await backend("select public.review_tech_na($1, false)", [pantallas]);
      expect((await producer("select title, status, na_rejected_at is not null as rejected from event_tech_items where id = any($1) order by title", [[sonido, pantallas]])).rows).toEqual([
        { title: "Pantallas", status: "not_applicable", rejected: false },
        { title: "Sonido", status: "pending", rejected: true },
      ]);
      expect((await admin("select level, status from alerts where rule_key = 'tech_na_rejected' and entity_id = $1", [sonido])).rows[0]).toEqual({ level: 3, status: "open" });
      expect((await admin("select count(*)::int as n from alerts where rule_key = 'tech_na' and status = 'open'")).rows[0].n).toBe(0);
      expect(await errorOf(backend, "select public.review_tech_na($1, true)", [sonido])).toMatch(/no tiene un «No aplica»/);

      await producer("select public.attach_tech_doc($1, $2, $3)", [sonido, `${EVENT}/expediente/sonido.pdf`, "sonido.pdf"]);
      expect((await producer("select status, doc_name, na_rejected_at from event_tech_items where id = $1", [sonido])).rows[0]).toEqual({ status: "confirmed", doc_name: "sonido.pdf", na_rejected_at: null });
      expect((await admin("select status from alerts where rule_key = 'tech_na_rejected' and entity_id = $1", [sonido])).rows[0].status).toBe("resolved");
    });
  });
});

describe("Presupuesto: adicionales", () => {
  it("el backend los abre, el productor los solicita y el backend decide; el cliente no los ve", async () => {
    await scenario(async ({ asUser }) => {
      const backend = asUser(USERS.backend);
      const producer = asUser(USERS.producer);
      const REQ = "select public.request_budget_extra($1, $2, $3) as id";
      expect(await errorOf(backend, "select public.open_budget_extras($1)", [EVENT])).toMatch(/Primero carga el presupuesto/);
      await backend("select public.set_budget($1, 85000, false)", [EVENT]);
      expect(await errorOf(producer, REQ, [EVENT, "personal", null])).toMatch(/todavía no abre/);
      expect(await errorOf(producer, "select public.open_budget_extras($1)", [EVENT])).toMatch(/productor general/);
      await backend("select public.open_budget_extras($1)", [EVENT]);
      expect(await errorOf(producer, REQ, [EVENT, "viajes", null])).toMatch(/desconocido/);
      const extra = (await producer(REQ, [EVENT, "personal", "Dos anfitrionas más"])).rows[0].id;
      expect(await errorOf(producer, REQ, [EVENT, "personal", null])).toMatch(/ya está solicitado/);
      expect(await errorOf(asUser(USERS.viewer), REQ, [EVENT, "tecnico", null])).toMatch(/No tienes permiso/);
      expect(await errorOf(producer, "select public.decide_budget_extra($1, true)", [extra])).toMatch(/los decide el backend/);
      expect((await asUser(USERS.viewer)("select id from event_budget_extras")).rows).toHaveLength(0);
      expect((await asUser(USERS.outsider)("select id from event_budget_extras")).rows).toHaveLength(0);
      await backend("select public.decide_budget_extra($1, true)", [extra]);
      expect((await producer("select kind, status from event_budget_extras where event_id = $1", [EVENT])).rows).toEqual([{ kind: "personal", status: "approved" }]);
      expect(await errorOf(backend, "select public.decide_budget_extra($1, false)", [extra])).toMatch(/ya fue decidido/);
    });
  });
});

describe("Plazo de la planificación", () => {
  it("lo fija y lo aplica el backend; si falta algo se levanta una Red Flag", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      expect(await errorOf(asUser(USERS.producer), "select public.apply_planning_deadline($1)", [EVENT])).toMatch(/productor general/);
      expect(await errorOf(backend, "select public.set_planning_deadline($1, 0)", [EVENT])).toMatch(/de 1 a 72/);
      await backend("select public.set_planning_deadline($1, 4)", [EVENT]);
      expect((await backend("select public.apply_planning_deadline($1) as flag", [EVENT])).rows[0].flag).toBe(true);
      const alert = (await admin("select level, detail from alerts where rule_key = 'planning_deadline' and event_id = $1", [EVENT])).rows[0];
      expect(alert.level).toBe(4);
      expect(alert.detail).toMatch(/A 4 h del evento falta/);
    });
  });
});

describe("Backend y MANDO Express", () => {
  it("solo el backend informa al cliente y da instrucciones; los avisos no se editan", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const producer = asUser(USERS.producer);
      const viewer = asUser(USERS.viewer);
      const SEND = "select public.send_client_notice($1, $2, $3) as id";
      expect(await errorOf(producer, SEND, [EVENT, "observation", "Factura no pagada"])).toMatch(/le informa el backend/);
      expect(await errorOf(viewer, SEND, [EVENT, "ok", "x"])).toMatch(/No tienes permiso/);
      expect(await errorOf(backend, SEND, [EVENT, "exito", "x"])).toMatch(/desconocido/);
      expect(await errorOf(backend, SEND, [EVENT, "ok", " "])).toMatch(/Escribe el aviso/);
      await backend(SEND, [EVENT, "observation", "Factura no pagada"]);
      await backend(SEND, [EVENT, "unconfirmed", "Falta la orden de compra"]);
      expect((await viewer("select kind, body, source from client_notices where event_id = $1 order by created_at, kind", [EVENT])).rows).toHaveLength(2);
      expect((await asUser(USERS.outsider)("select id from client_notices")).rows).toHaveLength(0);
      expect(await errorOf(viewer, "insert into client_notices (event_id, kind, body) values ($1, 'ok', 'x')", [EVENT])).toMatch(/row-level security|permission denied/);
      await viewer("update client_notices set body = 'cambiado'");
      await viewer("delete from client_notices");
      expect((await admin("select count(*)::int as n from client_notices where event_id = $1 and body <> 'cambiado'", [EVENT])).rows[0].n).toBe(2);
      // El aviso al cliente queda en la bitácora interna, que el cliente no ve.
      expect((await viewer("select id from log_entries where kind = 'client_notice'")).rows).toHaveLength(0);

      expect(await errorOf(producer, "select public.send_instruction($1, $2)", [EVENT, "x"])).toMatch(/las da el backend/);
      await backend("select public.send_instruction($1, $2)", [EVENT, "Adelanta la prueba de sonido 30 minutos."]);
      expect((await producer("select level, detail from alerts where title = 'Instrucción del backend' and event_id = $1", [EVENT])).rows).toEqual([{ level: 1, detail: "Adelanta la prueba de sonido 30 minutos." }]);
      expect((await viewer("select id from alerts where title = 'Instrucción del backend'")).rows).toHaveLength(0);
    });
  });

  it("el sistema marca «Todo OK» cuando se cumple un hito, una sola vez", async () => {
    await scenario(async ({ admin, asUser }) => {
      await admin("update route_items set status = 'done' where id = $1", [PUERTAS]);
      await admin("update route_items set status = 'in_progress' where id = $1", [PUERTAS]);
      await admin("update route_items set status = 'done' where id = $1", [PUERTAS]);
      const rows = (await asUser(USERS.viewer)("select kind, source, body from client_notices where event_id = $1", [EVENT])).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "ok", source: "system" });
      expect(rows[0].body).toMatch(/^Se cumplió «/);
    });
  });
});
