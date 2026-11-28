// Red flag de documento: reconocer con plazo, resolver solo con el documento y revisión de la IA (decisión 93).
// Cada prueba corre en una transacción que se deshace al final.
//
// Se corre con `npm run test:db`.
import { readFileSync } from "node:fs";
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

const byKey = async (q: Q, key: string) =>
  (await q("select id, title, status from event_requirements where event_id = $1 and key = $2", [EVENT, key])).rows[0];
const flagOf = async (q: Q, id: string) =>
  (await q("select id, level, status from alerts where rule_key = 'documento_pendiente' and entity_id = $1 order by raised_at", [id])).rows;
const RUN = "select public.evaluate_clock_rules($1)";
const COMPLETE = "select public.complete_requirement($1, $2, $3, $4, $5, true)";
const REVIEW = "select public.record_document_review($1, $2, $3, $4)";
const lastLog = async (q: Q) =>
  (await q("select summary as message, payload from log_entries where event_id = $1 order by id desc limit 1", [EVENT])).rows[0];

async function redFlag(admin: Q, producer: Q) {
  const r = await byKey(admin, "sctr");
  await admin("update events set starts_at = now() - interval '1 hour' where id = $1", [EVENT]);
  await admin("update event_requirements set due_at = now() - interval '3 days', owner_id = null where id = $1", [r.id]);
  await producer(RUN, [EVENT]);
  const [flag] = await flagOf(admin, r.id);
  expect(flag).toMatchObject({ level: 4, status: "open" });
  return { r, flag };
}

describe("Red flag de documento", () => {
  it("se reconoce con un plazo que queda en la bitácora, y se puede pedir más tiempo", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const { flag } = await redFlag(admin, producer);
      expect(await errorOf(producer, "select public.ack_alert_with_time($1, 5)", [flag.id])).toMatch(/15 minutos/);
      await producer("select public.ack_alert_with_time($1, 60)", [flag.id]);
      expect((await flagOf(admin, (await byKey(admin, "sctr")).id))[0].status).toBe("acknowledged");
      let log = await lastLog(admin);
      expect(log.message).toMatch(/reconoce el pendiente: .*Se compromete a resolverlo antes de las \d\d:\d\d \(1 h\)\./);
      await producer("select public.ack_alert_with_time($1, 30)", [flag.id]);
      log = await lastLog(admin);
      expect(log.message).toMatch(/pide más tiempo/);
      expect(log.payload).toMatchObject({ minutes: 30, extension: true });
      expect(await errorOf(asUser(USERS.viewer), "select public.ack_alert_with_time($1, 60)", [flag.id])).not.toBeNull();
      expect(await errorOf(asUser(USERS.outsider), "select public.ack_alert_with_time($1, 60)", [flag.id])).not.toBeNull();
    });
  });

  it("no se marca resuelta con una palabra: se resuelve adjuntando el documento", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const { r, flag } = await redFlag(admin, producer);
      expect(await errorOf(producer, "select public.resolve_alert($1, 'ya está')", [flag.id])).toMatch(/adjuntando el documento/);
      await producer(COMPLETE, [r.id, `${EVENT}/expediente/sctr.pdf`, "sctr.pdf", "ab", null]);
      expect((await flagOf(admin, r.id))[0].status).toBe("resolved");
    });
  });

  it("si la IA dice que está vencido, queda en la bitácora y la red flag se vuelve a encender", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const { r } = await redFlag(admin, producer);
      expect(await errorOf(producer, REVIEW, [r.id, "vigente", "", null])).toMatch(/Primero adjunta/);
      await producer(COMPLETE, [r.id, `${EVENT}/expediente/sctr.pdf`, "sctr.pdf", "ab", null]);
      expect(await errorOf(producer, REVIEW, [r.id, "inventado", "", null])).toMatch(/desconocido/);
      expect(await errorOf(asUser(USERS.viewer), REVIEW, [r.id, "vigente", "", null])).not.toBeNull();

      await producer(REVIEW, [r.id, "vencido", "Póliza SCTR con vigencia hasta octubre.", "2026-10-31"]);
      const log = (await admin("select summary as message, payload from log_entries where event_id = $1 and payload ? 'ai_review'", [EVENT])).rows[0];
      expect(log.message).toMatch(/Revisión de la IA de MANDO sobre «.*»: VENCIDO desde el 31\/10\/2026\. .*vuelve a pendiente/);
      expect(log.payload).toMatchObject({ ai_review: "vencido", expires_on: "2026-10-31" });
      expect((await byKey(admin, "sctr")).status).toBe("pending");
      const flags = await flagOf(admin, r.id);
      expect(flags.map((f) => f.status).sort()).toEqual(["open", "resolved"]);
    });
  });

  it("si está vigente, el documento se queda y la bitácora lo dice", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const { r } = await redFlag(admin, producer);
      await producer(COMPLETE, [r.id, `${EVENT}/expediente/sctr.pdf`, "sctr.pdf", "ab", null]);
      await producer(REVIEW, [r.id, "vigente", "", "2027-03-31"]);
      expect((await lastLog(admin)).message).toMatch(/pase concedido, vigente hasta el 31\/03\/2027\.$/);
      expect((await byKey(admin, "sctr")).status).toBe("done");
      await admin("update event_requirements set done_at = now() - interval '2 hours' where id = $1", [r.id]);
      expect(await errorOf(producer, REVIEW, [r.id, "vencido", "", null])).toMatch(/al adjuntar/);
    });
  });

  it("modo diseño: solo el backend lo enciende; pausa las alertas automáticas y el candado, y al apagarlo vuelve a vigilar", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const backend = asUser(USERS.backend);
      const r = await byKey(admin, "sctr");
      expect(await errorOf(producer, "select public.set_design_mode($1, true)", [EVENT])).toMatch(/backend/);
      await backend("select public.set_design_mode($1, true)", [EVENT]);
      expect((await lastLog(admin)).message).toMatch(/encendió el modo diseño/);
      const status = (await producer("select public.planning_status($1) as s", [EVENT])).rows[0].s;
      expect(status).toMatchObject({ gate: false, design_mode: true });

      await admin("update events set starts_at = now() - interval '1 hour' where id = $1", [EVENT]);
      await admin("update event_requirements set due_at = now() - interval '3 days', owner_id = null where id = $1", [r.id]);
      await producer(RUN, [EVENT]);
      expect(await flagOf(admin, r.id)).toHaveLength(0);
      // Una persona sí puede levantar una alerta a mano.
      await producer("select public.raise_alert($1, 3, 'Falta el técnico', null, null, null)", [EVENT]);
      expect((await admin("select count(*)::int as n from alerts where event_id = $1 and rule_key is null", [EVENT])).rows[0].n).toBeGreaterThan(0);

      await backend("select public.set_design_mode($1, false)", [EVENT]);
      expect((await admin("select summary from log_entries where event_id = $1 and payload ? 'design_mode' order by id desc limit 1", [EVENT])).rows[0].summary).toMatch(/Listo, activa/);
      expect((await flagOf(admin, r.id))[0]).toMatchObject({ level: 4, status: "open" });
    });
  });
});
