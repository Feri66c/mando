// Expediente como fortaleza (decisiones 74 a 77 y 80): tope de 48 horas, declaración jurada, línea legal,
// presión en la bitácora y último minuto. Cada prueba corre en una transacción que se deshace al final.
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

const reqs = async (q: Q, event = EVENT) =>
  (await q("select id, key, title, status, mandatory, due_at, owner_id from event_requirements where event_id = $1 order by sort_order", [event])).rows;
const byKey = async (q: Q, key: string) => (await reqs(q)).find((r) => r.key === key)!;
const COMPLETE = "select public.complete_requirement($1, $2, $3, $4, $5, true)";
const STATUS = "select public.set_requirement_status($1, $2, $3)";
const alertsOf = async (q: Q, id: string) =>
  (await q("select level, status, title, detail, visible_to_viewer from alerts where rule_key = 'documento_pendiente' and entity_id = $1", [id])).rows;

describe("Expediente como fortaleza", () => {
  it("lo que se pide antes del evento vence, como máximo, 48 horas antes; lo de después conserva su plazo", async () => {
    await scenario(async ({ admin, asUser }) => {
      const id = (
        await asUser(USERS.backend)(
          "select public.create_event_from_template($1, 'Sampling', null, null, 'America/Lima', '2026-12-06T15:00:00Z', $2::jsonb, '{}'::jsonb) as id",
          [ORG, SAMPLING],
        )
      ).rows[0].id;
      const rows = await reqs(admin, id);
      const cap = new Date("2026-12-04T15:00:00Z").getTime();
      for (const r of rows.filter((x) => new Date(x.due_at).getTime() <= new Date("2026-12-06T15:00:00Z").getTime())) {
        expect(new Date(r.due_at).getTime()).toBeLessThanOrEqual(cap);
      }
      expect(new Date(rows.find((r) => r.key === "transporte").due_at).toISOString()).toBe("2026-12-04T15:00:00.000Z");
      expect(new Date(rows.find((r) => r.key === "facturas").due_at).toISOString()).toBe("2026-12-08T15:00:00.000Z");

      const backend = asUser(USERS.backend);
      const sctr = rows.find((r) => r.key === "sctr");
      // Un plazo dentro de las últimas 48 horas se rechaza; el mismo día del tope vale la hora del tope.
      expect(await errorOf(backend, "select public.plan_requirement($1, null, $2)", [sctr.id, "2026-12-05T23:00:00Z"])).toMatch(/48 horas antes del evento/);
      await backend("select public.plan_requirement($1, null, $2)", [sctr.id, "2026-12-04T23:00:00Z"]);
      expect(new Date((await admin("select due_at from event_requirements where id = $1", [sctr.id])).rows[0].due_at).toISOString()).toBe("2026-12-04T15:00:00.000Z");
      expect(await errorOf(backend, "select public.add_requirement($1, 'Permiso extra', 'permisos', $2, true)", [id, "2026-12-05T23:00:00Z"])).toMatch(/48 horas antes del evento/);
      // Sin fecha, el documento nuevo nace con el tope.
      const extra = (await backend("select public.add_requirement($1, 'Permiso extra', 'permisos', null, true) as id", [id])).rows[0].id;
      expect(new Date((await admin("select due_at from event_requirements where id = $1", [extra])).rows[0].due_at).toISOString()).toBe("2026-12-04T15:00:00.000Z");
      // Un documento de después del evento sí puede moverse más allá.
      const facturas = rows.find((r) => r.key === "facturas");
      await backend("select public.plan_requirement($1, null, $2)", [facturas.id, "2026-12-10T23:00:00Z"]);
    });
  });

  it("sin declaración jurada no se sube nada, y queda registrado quién visó y cuándo", async () => {
    await scenario(async ({ admin, asUser }) => {
      const r = await byKey(admin, "contratos");
      const producer = asUser(USERS.producer);
      expect(await errorOf(producer, "select public.complete_requirement($1, null, null, null, 'Firmado')", [r.id])).toMatch(/declaración jurada/);
      expect(await errorOf(producer, "select public.complete_requirement($1, null, null, null, 'Firmado', false)", [r.id])).toMatch(/declaración jurada/);
      expect((await byKey(admin, "contratos")).status).toBe("pending");
      await producer(COMPLETE, [r.id, null, null, null, "Firmado"]);
      const row = (await admin("select status, done_by, sworn_at is not null as sworn from event_requirements where id = $1", [r.id])).rows[0];
      expect(row).toEqual({ status: "done", done_by: USERS.producer, sworn: true });
      const log = (await admin("select summary, payload from log_entries where kind = 'requirement_updated' and entity_id = $1", [r.id])).rows;
      expect(log[0].summary).toMatch(/bajo declaración jurada/);
      expect(log[0].payload.sworn).toBe(true);
    });
  });

  it("la línea legal no se quiebra: con responsable, solo esa persona sube y solo el backend la cambia", async () => {
    await scenario(async ({ admin, asUser }) => {
      const r = await byKey(admin, "carta-locacion");
      const producer = asUser(USERS.producer); // productor de campo, nivel 2
      const backend = asUser(USERS.backend);
      // El nivel 2 puede asignar al primer responsable…
      await producer("select public.plan_requirement($1, $2, null)", [r.id, USERS.backend]);
      // …pero ya no puede cambiarlo ni quitarlo.
      expect(await errorOf(producer, "select public.plan_requirement($1, $2, null)", [r.id, USERS.producer])).toMatch(/Solo el backend puede cambiarlo/);
      expect(await errorOf(producer, "select public.plan_requirement($1, null, null)", [r.id])).toMatch(/Solo el backend puede cambiarlo/);
      // Otra persona no sube el documento de un responsable.
      expect(await errorOf(producer, COMPLETE, [r.id, null, null, null, "Lo subo yo"])).toMatch(/Solo esa persona lo sube/);
      // El backend lo reasigna y queda escrito quién era y quién es.
      await backend("select public.plan_requirement($1, $2, null)", [r.id, USERS.producer]);
      const log = (await admin("select summary from log_entries where kind = 'requirement_updated' and entity_id = $1 order by id desc limit 1", [r.id])).rows[0];
      expect(log.summary).toMatch(/cambió al responsable/);
      expect(await errorOf(backend, COMPLETE, [r.id, null, null, null, "Lo subo yo"])).toMatch(/Solo esa persona lo sube/);
      await producer(COMPLETE, [r.id, null, null, null, "Carta firmada"]);
      expect((await byKey(admin, "carta-locacion")).status).toBe("done");
    });
  });

  it("la presión queda en la bitácora una vez por umbral, y otra vez al vencer", async () => {
    await scenario(async ({ admin, asUser }) => {
      const r = await byKey(admin, "contratos");
      const backend = asUser(USERS.backend);
      const pressure = async () =>
        (await admin("select summary, level, actor_id from log_entries where kind = 'requirement_updated' and entity_id = $1 and payload ? 'pressure' order by id", [r.id])).rows;
      await admin("update events set starts_at = now() + interval '40 days', ends_at = now() + interval '41 days', status = 'planned' where id = $1", [EVENT]);
      await admin("update event_requirements set due_at = now() + interval '20 days', pressure_mark = null where id = $1", [r.id]);
      await backend("select public.evaluate_clock_rules($1)", [EVENT]);
      expect(await pressure()).toHaveLength(0); // faltan 20 días: todavía no
      await admin("update event_requirements set due_at = now() + interval '6 days 12 hours' where id = $1", [r.id]);
      await backend("select public.evaluate_clock_rules($1)", [EVENT]);
      await backend("select public.evaluate_clock_rules($1)", [EVENT]);
      let rows = await pressure();
      expect(rows).toHaveLength(1); // una sola vez por umbral
      expect(rows[0].summary).toMatch(/Presión: a «Contratos con proveedores» le quedan 7 días/);
      expect(rows[0].summary).toMatch(/Aún no tiene responsable/);
      expect(rows[0].actor_id).toBeNull();
      await admin("update event_requirements set due_at = now() - interval '1 hour' where id = $1", [r.id]);
      await backend("select public.evaluate_clock_rules($1)", [EVENT]);
      await backend("select public.evaluate_clock_rules($1)", [EVENT]);
      rows = await pressure();
      expect(rows).toHaveLength(2);
      expect(rows[1].summary).toMatch(/pasó su plazo/);
      expect(rows[1].level).toBe(3);
      // La bitácora no se edita ni se borra.
      expect((await backend("update log_entries set summary = 'x' where entity_id = $1", [r.id])).rowCount).toBe(0);
    });
  });

  it("último minuto: lo anota el equipo, queda en la bitácora y el cliente no lo ve", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const LAST = "select public.last_minute($1, $2, $3, $4, $5, $6) as id";
      expect(await errorOf(producer, LAST, [EVENT, "pago", "Pago a cuenta de un proveedor", " ", null, null])).toMatch(/qué llegó de último minuto/);
      expect(await errorOf(producer, LAST, [EVENT, "Pago!!", "Pago", "x", null, null])).toMatch(/Elige qué quieres ingresar/);
      for (const who of [USERS.viewer, USERS.outsider]) {
        expect(await errorOf(asUser(who), LAST, [EVENT, "pago", "Pago a cuenta de un proveedor", "x", null, null])).not.toBeNull();
      }
      const id = (await producer(LAST, [EVENT, "pago", "Pago a cuenta de un proveedor", "Adelanto a sonido", `${EVENT}/abc.jpg`, "a".repeat(64)])).rows[0].id;
      const ev = (await admin("select tag, kind, note, visible_to_viewer from evidences where id = $1", [id])).rows[0];
      expect(ev).toEqual({ tag: "ultimo_minuto", kind: "photo", note: "Pago a cuenta de un proveedor: Adelanto a sonido", visible_to_viewer: false });
      const log = (await admin("select summary, level, visible_to_viewer, payload from log_entries where kind = 'moment_marked' and entity_id = $1", [id])).rows[0];
      expect(log.summary).toMatch(/^Último minuto · Pago a cuenta de un proveedor: Adelanto a sonido/);
      expect(log.summary).toMatch(/con comprobante/);
      expect(log.visible_to_viewer).toBe(false);
      expect(log.payload.kind).toBe("pago");
      expect((await asUser(USERS.viewer)("select id from evidences where id = $1", [id])).rowCount).toBe(0);
    });
  });
});
