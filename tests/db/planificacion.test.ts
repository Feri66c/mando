// Planificación: base de personas, lista técnica, presupuesto y el candado de los 5 elementos.
// Cada prueba corre en una transacción que se deshace al final. Se corre con `npm run test:db`.
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

const CREATE = "select public.create_event_from_template($1, 'Sampling', null, null, 'America/Lima', '2026-12-06T15:00:00Z', $2::jsonb, '{}'::jsonb) as id";
const SAVE = "select public.save_person($1, $2, $3, $4, $5, $6, $7, $8, $9) as id";
const status = async (q: Q, event: string) => {
  const s = (await q("select public.planning_status($1) as s", [event])).rows[0].s as { gate: boolean; elements: { key: string; ready: boolean; missing: string[] }[] };
  return { gate: s.gate, ...Object.fromEntries(s.elements.map((e) => [e.key, e])) } as { gate: boolean } & Record<string, { ready: boolean; missing: string[] }>;
};

describe("Base de personas", () => {
  it("se registra una vez por DNI, se elige con un check y el resto del equipo no ve datos personales", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const producer = asUser(USERS.producer);
      const photo = `personas/${ORG}/foto/a.jpg`;
      const copy = `personas/${ORG}/dni/a.jpg`;
      const a = (await producer(SAVE, [EVENT, null, " Tatiana Rojas ", "4567 8901", "2030-01-01", "999", "Anfitriona", photo, copy])).rows[0].id;
      // Mismo DNI: se actualiza la ficha, no se duplica.
      const again = (await backend(SAVE, [EVENT, null, "Tatiana Rojas Paz", "45678901", null, null, null, null, null])).rows[0].id;
      expect(again).toBe(a);
      expect((await admin("select full_name, doc_expires_on is not null as kept from people where id = $1", [a])).rows[0]).toEqual({ full_name: "Tatiana Rojas Paz", kept: true });
      expect(await errorOf(producer, SAVE, [EVENT, null, "X", null, null, null, null, `personas/${FOREIGN_EVENT}/foto/x.jpg`, null])).toMatch(/no pertenece/);
      expect(await errorOf(asUser(USERS.viewer), SAVE, [EVENT, null, "X", null, null, null, null, null, null])).toMatch(/No tienes permiso/);

      await producer("select public.assign_person($1, $2, $3)", [EVENT, a, null]); // toma su rol habitual
      const board = (await producer("select * from public.event_people_board($1)", [EVENT])).rows;
      expect(board).toMatchObject([{ full_name: "Tatiana Rojas Paz", role: "Anfitriona", assigned: true, doc_state: "vigente", doc_number: "45678901" }]);

      // Un técnico (nivel 4) ve nombre y rol, no el DNI ni el teléfono; y no lee la tabla.
      await admin("update event_members set level = 4 where event_id = $1 and profile_id = $2", [EVENT, USERS.producer]);
      const limited = (await producer("select * from public.event_people_board($1)", [EVENT])).rows;
      expect(limited).toMatchObject([{ full_name: "Tatiana Rojas Paz", doc_number: null, phone: null, doc_path: null }]);
      expect((await producer("select id from people")).rows).toHaveLength(0);
      expect(await errorOf(producer, "select public.assign_person($1, $2, $3, false)", [EVENT, a, null])).toMatch(/productor general o el productor de campo/);
      expect((await asUser(USERS.outsider)("select id from people")).rows).toHaveLength(0);
      expect(await errorOf(asUser(USERS.viewer), "select * from public.event_people_board($1)", [EVENT])).toMatch(/No tienes permiso/);
    });
  });

  it("las fotos y las copias de DNI tienen su propia regla de acceso", async () => {
    await scenario(async ({ asUser }) => {
      const can = async (q: Q, fn: string, path: string) => (await q(`select public.${fn}($1) as ok`, [path])).rows[0].ok;
      const dni = `personas/${ORG}/dni/a.jpg`;
      const foto = `personas/${ORG}/foto/a.jpg`;
      expect(await can(asUser(USERS.producer), "can_upload_person_file", dni)).toBe(true);
      expect(await can(asUser(USERS.viewer), "can_upload_person_file", foto)).toBe(false);
      expect(await can(asUser(USERS.viewer), "can_read_person_file", foto)).toBe(false);
      expect(await can(asUser(USERS.outsider), "can_read_person_file", dni)).toBe(false);
      expect(await can(asUser(USERS.producer), "can_upload_person_file", `personas/${ORG}/otra/a.jpg`)).toBe(false);
    });
  });
});

describe("Lista técnica", () => {
  it("nace con el evento; coordinación confirma y «No aplica» lo revisa el backend", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const id = (await backend(CREATE, [ORG, SAMPLING])).rows[0].id;
      const rows = (await backend("select id, title, mandatory, due_hours, status from event_tech_items where event_id = $1 order by sort_order", [id])).rows;
      expect(rows.map((r) => r.title)).toContain("Módulo o stand");
      expect(rows.find((r) => r.title === "Parlante portátil")).toMatchObject({ mandatory: false, due_hours: 24 });
      const must = rows.find((r) => r.mandatory)!;
      await backend("select public.set_tech_item($1, 'confirmed', $2)", [must.id, "3 × 2 m"]);
      expect((await admin("select status, detail, confirmed_by from event_tech_items where id = $1", [must.id])).rows[0]).toMatchObject({ status: "confirmed", detail: "3 × 2 m", confirmed_by: USERS.backend });
      expect(await errorOf(backend, "select public.add_tech_item($1, 'sonido', 'Consola', null, 1, false, 12)", [id])).toMatch(/24 o de 2 horas/);
      expect(await errorOf(asUser(USERS.viewer), "select public.set_tech_item($1, 'confirmed')", [must.id])).toMatch(/No tienes permiso/);
      expect((await asUser(USERS.viewer)("select id from event_tech_items")).rows).toHaveLength(0);

      // En el evento de ejemplo: coordinación (nivel 3) agrega y confirma, pero no saca un obligatorio.
      await admin("update event_members set level = 3 where event_id = $1 and profile_id = $2", [EVENT, USERS.producer]);
      const producer = asUser(USERS.producer);
      const item = (await producer("select public.add_tech_item($1, 'sonido', 'Consola de 32 canales', null, 1, true, 24) as id", [EVENT])).rows[0].id;
      expect((await admin("select due_hours from event_tech_items where id = $1", [item])).rows[0].due_hours).toBeNull(); // un obligatorio no tiene plazo de gracia
      expect(await errorOf(producer, "select public.set_tech_item($1, 'not_applicable')", [item])).toMatch(/lo revisa el backend/);
      await producer("select public.set_tech_item($1, 'confirmed')", [item]);
    });
  });
});

describe("Presupuesto", () => {
  it("el cliente aprueba el monto global; el desglose lo ve la productora solo si se le habilita", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const producer = asUser(USERS.producer);
      const viewer = asUser(USERS.viewer);
      expect(await errorOf(producer, "select public.set_budget($1, 1000)", [EVENT])).toMatch(/productor general/);
      expect(await errorOf(viewer, "select public.decide_budget($1, true)", [EVENT])).toMatch(/no hay un presupuesto/);
      await backend("select public.set_budget($1, 18500.50)", [EVENT]);
      await backend("select public.add_budget_line($1, 'Transporte', 15, 10, 'viaje-urbano')", [EVENT]);
      const total = async (q: Q) => (await q("select total, status from event_budgets where event_id = $1", [EVENT])).rows;
      const lines = async (q: Q) => (await q("select title from event_budget_lines where event_id = $1", [EVENT])).rows;
      expect(await total(producer)).toMatchObject([{ total: "18500.50", status: "sent" }]);
      expect(await total(viewer)).toHaveLength(1);
      expect(await lines(backend)).toHaveLength(1);
      expect(await lines(producer)).toHaveLength(0); // productora de agencia: solo el global
      expect(await lines(viewer)).toHaveLength(0);
      await backend("select public.set_budget($1, 18500.50, true)", [EVENT]);
      expect(await lines(producer)).toHaveLength(1); // productora de confianza
      expect(await lines(viewer)).toHaveLength(0);
      // Coordinación y técnicos no ven montos.
      await admin("update event_members set level = 3 where event_id = $1 and profile_id = $2", [EVENT, USERS.producer]);
      expect(await total(producer)).toHaveLength(0);
      expect(await lines(producer)).toHaveLength(0);
      expect(await total(asUser(USERS.outsider))).toHaveLength(0);

      expect(await errorOf(producer, "select public.decide_budget($1, true)", [EVENT])).toMatch(/lo aprueba el cliente/);
      expect(await errorOf(backend, "select public.decide_budget($1, true)", [EVENT])).toMatch(/cómo te dio el cliente/);
      expect(await errorOf(viewer, "select public.decide_budget($1, false, ' ')", [EVENT])).toMatch(/qué hay que cambiar/);
      await viewer("select public.decide_budget($1, true)", [EVENT]);
      expect((await total(viewer))[0].status).toBe("approved");
      // Si el monto cambia, hay que aprobarlo otra vez. La bitácora no muestra montos.
      await backend("select public.set_budget($1, 20000)", [EVENT]);
      expect((await total(viewer))[0].status).toBe("sent");
      const log = (await admin("select summary from log_entries where event_id = $1 and entity_type = 'budget'", [EVENT])).rows.map((r) => r.summary).join(" ");
      expect(log).toContain("aprobó el presupuesto");
      expect(log).not.toMatch(/18500|20000/);
    });
  });
});

describe("Los 5 elementos y el candado", () => {
  it("un evento nuevo nace bloqueado y se desbloquea al completar legal, personal, técnico, presupuesto y aprobaciones", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const id = (await backend(CREATE, [ORG, SAMPLING])).rows[0].id;
      await admin("insert into event_members (event_id, profile_id, role, level) values ($1, $2, 'viewer', null)", [id, USERS.viewer]);
      const viewer = asUser(USERS.viewer);
      let s = await status(viewer, id); // el cliente también ve qué falta
      expect(s.gate).toBe(true);
      expect([s.legal.ready, s.personal.ready, s.tecnico.ready, s.presupuesto.ready, s.aprobaciones.ready]).toEqual([false, false, false, false, false]);
      expect(s.presupuesto.missing).toEqual(["Falta cargar el presupuesto"]);
      expect(await errorOf(asUser(USERS.outsider), "select public.planning_status($1)", [id])).toMatch(/No tienes permiso/);

      const milestone = (await admin("select id from route_items where event_id = $1 and is_milestone order by planned_start limit 1", [id])).rows[0].id;
      const start = "update route_items set actual_start = now() where id = $1";
      expect(await errorOf(admin, start, [milestone])).toMatch(/falta completar la planificación \(Legal: .*Presupuesto: Falta cargar el presupuesto/);

      // Legal: documentos no negociables y equipo con foto y DNI vigente.
      await admin("update event_requirements set status = 'done' where event_id = $1 and mandatory", [id]);
      const expired = (await backend(SAVE, [id, null, "Lucía Paredes", "11112222", "2026-12-01", null, "Anfitriona", `personas/${ORG}/foto/l.jpg`, `personas/${ORG}/dni/l.jpg`])).rows[0].id;
      await backend("select public.assign_person($1, $2, $3)", [id, expired, null]);
      s = await status(backend, id);
      expect(s.personal.ready).toBe(true);
      expect(s.legal.missing).toEqual(["1 persona sin foto o sin DNI vigente"]); // vence antes del evento
      expect((await backend("select doc_state from public.event_people_board($1)", [id])).rows[0].doc_state).toBe("vencido");
      await backend(SAVE, [id, expired, "Lucía Paredes", null, "2031-05-01", null, null, null, null]);
      expect((await status(backend, id)).legal.ready).toBe(true);

      // Técnico, presupuesto y aprobaciones.
      await admin("update event_tech_items set status = 'confirmed' where event_id = $1 and mandatory", [id]);
      await backend("select public.set_budget($1, 9000)", [id]);
      expect((await status(backend, id)).presupuesto.missing).toEqual(["Falta la aprobación del cliente"]);
      await viewer("select public.decide_budget($1, true)", [id]);
      await backend("select public.set_approval_groups($1, $2)", [id, []]);
      s = await status(backend, id);
      expect([s.legal.ready, s.personal.ready, s.tecnico.ready, s.presupuesto.ready, s.aprobaciones.ready]).toEqual([true, true, true, true, true]);
      await admin(start, [milestone]); // desbloqueado
    });
  });

  it("los eventos anteriores no tienen candado: solo cuentan las aprobaciones", async () => {
    await scenario(async ({ admin }) => {
      expect((await admin("select planning_gate from events where id = $1", [EVENT])).rows[0].planning_gate).toBe(false);
      await admin("update route_items set actual_start = now() where id = $1 and actual_start is null", [PUERTAS]);
    });
  });
});
