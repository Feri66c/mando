// Expediente y locación: documentos por tipo de evento con plazo, recordatorios por reloj, archivos y datos
// del lugar. Cada prueba corre en una transacción que se deshace al final.
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

describe("Expediente del evento", () => {
  it("un sampling nuevo nace con sus documentos pendientes y su plazo contado desde la hora clave", async () => {
    await scenario(async ({ admin, asUser }) => {
      const id = (
        await asUser(USERS.backend)(
          "select public.create_event_from_template($1, 'Sampling', null, null, 'America/Lima', '2026-12-06T15:00:00Z', $2::jsonb, '{}'::jsonb) as id",
          [ORG, SAMPLING],
        )
      ).rows[0].id;
      const rows = await reqs(admin, id);
      expect(rows.map((r) => r.key)).toEqual(expect.arrayContaining(["sctr", "permiso-municipal", "carta-locacion", "contratos", "facturas", "cobranza"]));
      expect(rows.map((r) => r.key)).not.toContain("uso-de-imagen");
      expect(rows.every((r) => r.status === "pending")).toBe(true);
      const permit = rows.find((r) => r.key === "permiso-municipal");
      expect(permit.mandatory).toBe(true);
      expect(new Date(permit.due_at).toISOString()).toBe("2026-12-01T15:00:00.000Z"); // 5 días antes
      expect(new Date(rows.find((r) => r.key === "facturas").due_at).toISOString()).toBe("2026-12-08T15:00:00.000Z"); // 2 días después
    });
  });

  it("solo el equipo lo ve; ni el cliente ni un ajeno; y nadie lo escribe directo", async () => {
    await scenario(async ({ asUser }) => {
      expect(await reqs(asUser(USERS.producer))).toHaveLength(8);
      expect(await reqs(asUser(USERS.backend))).toHaveLength(8);
      expect(await reqs(asUser(USERS.viewer))).toHaveLength(0);
      expect(await reqs(asUser(USERS.outsider))).toHaveLength(0);
      for (const who of [USERS.producer, USERS.backend, USERS.viewer]) {
        expect((await asUser(who)("update event_requirements set status = 'done'")).rowCount).toBe(0);
        expect((await asUser(who)("delete from event_requirements")).rowCount).toBe(0);
        expect(await errorOf(asUser(who), "insert into event_requirements (event_id, title) values ($1, 'x')", [EVENT])).toMatch(/row-level security/);
      }
    });
  });

  it("el equipo sube un documento con su huella; el archivo debe ser del expediente de ese evento", async () => {
    await scenario(async ({ admin, asUser }) => {
      const r = await byKey(admin, "contratos");
      const producer = asUser(USERS.producer);
      expect(await errorOf(producer, COMPLETE, [r.id, null, null, null, " "])).toMatch(/Sube el archivo o escribe el dato/);
      expect(await errorOf(producer, COMPLETE, [r.id, `${FOREIGN_EVENT}/expediente/x.pdf`, "x.pdf", "abc", null])).toMatch(/no pertenece al expediente/);
      expect(await errorOf(producer, COMPLETE, [r.id, `${EVENT}/otra-carpeta/x.pdf`, "x.pdf", "abc", null])).toMatch(/no pertenece al expediente/);
      await producer(COMPLETE, [r.id, `${EVENT}/expediente/abc-contrato.pdf`, "contrato.pdf", "f00d", "Firmado por sonido"]);
      const row = (await admin("select status, file_name, sha256, note, done_by from event_requirements where id = $1", [r.id])).rows[0];
      expect(row).toEqual({ status: "done", file_name: "contrato.pdf", sha256: "f00d", note: "Firmado por sonido", done_by: USERS.producer });
      const log = (await admin("select summary, visible_to_viewer from log_entries where kind = 'requirement_updated' and entity_id = $1", [r.id])).rows;
      expect(log).toHaveLength(1);
      expect(log[0].visible_to_viewer).toBe(false);
      for (const who of [USERS.viewer, USERS.outsider]) {
        expect(await errorOf(asUser(who), COMPLETE, [r.id, null, null, null, "x"])).toMatch(/No tienes permiso/);
      }
    });
  });

  it("«no aplica» lo deciden los niveles 1 y 2, y un no negociable pide explicación", async () => {
    await scenario(async ({ admin, asUser }) => {
      const plano = await byKey(admin, "plano");
      const sctr = await byKey(admin, "sctr");
      await asUser(USERS.producer)(STATUS, [plano.id, "not_applicable", null]);
      expect(await errorOf(asUser(USERS.producer), STATUS, [sctr.id, "not_applicable", null])).toMatch(/explica por qué no aplica/);
      await asUser(USERS.backend)(STATUS, [sctr.id, "not_applicable", "Evento en oficina, sin riesgo"]);
      expect((await byKey(admin, "sctr")).status).toBe("not_applicable");
      await asUser(USERS.backend)(STATUS, [sctr.id, "pending", null]);
      expect((await byKey(admin, "sctr")).status).toBe("pending");
      expect(await errorOf(asUser(USERS.backend), STATUS, [sctr.id, "borrado", null])).toMatch(/Estado desconocido/);

      await admin("update event_members set level = 3 where event_id = $1 and profile_id = $2", [EVENT, USERS.producer]);
      expect(await errorOf(asUser(USERS.producer), STATUS, [plano.id, "pending", null])).toMatch(/productor general o el productor de campo/);
      expect(await errorOf(asUser(USERS.viewer), STATUS, [plano.id, "pending", null])).toMatch(/No tienes permiso/);
    });
  });

  it("se asigna a alguien del equipo con su plazo, y se agregan documentos propios", async () => {
    await scenario(async ({ admin, asUser }) => {
      const r = await byKey(admin, "carta-locacion");
      const backend = asUser(USERS.backend);
      await backend("select public.plan_requirement($1, $2, $3)", [r.id, USERS.producer, "2026-12-08T15:00:00Z"]);
      expect((await byKey(admin, "carta-locacion")).owner_id).toBe(USERS.producer);
      expect(await errorOf(backend, "select public.plan_requirement($1, $2, null)", [r.id, USERS.viewer])).toMatch(/no es del equipo/);
      const id = (await backend("select public.add_requirement($1, 'Permiso de la junta de vecinos', 'permisos', null, true) as id", [EVENT])).rows[0].id;
      expect((await reqs(admin)).find((x) => x.id === id)).toMatchObject({ key: null, mandatory: true, status: "pending" });
      expect(await errorOf(asUser(USERS.viewer), "select public.add_requirement($1, 'x', 'permisos')", [EVENT])).toMatch(/No tienes permiso/);
    });
  });
});

describe("Recordatorios del expediente", () => {
  const RUN = "select public.evaluate_clock_rules($1) as n";

  it("avisa cuando quedan 2 días, sube a Crítico al vencer y se resuelve al subir el documento", async () => {
    await scenario(async ({ admin, asUser }) => {
      const r = await byKey(admin, "contratos");
      const producer = asUser(USERS.producer);
      await admin("update event_requirements set due_at = now() + interval '5 days' where id = $1", [r.id]);
      await producer(RUN, [EVENT]);
      expect(await alertsOf(admin, r.id)).toHaveLength(0);

      await admin("update event_requirements set due_at = now() + interval '36 hours', owner_id = $2 where id = $1", [r.id, USERS.producer]);
      await producer(RUN, [EVENT]);
      let alerts = await alertsOf(admin, r.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ level: 2, status: "open", title: "Falta subir: Contratos con proveedores", visible_to_viewer: false });
      expect(alerts[0].detail).toMatch(/^Quedan 2 días para su plazo\. Responsable: /);

      await admin("update event_requirements set due_at = now() - interval '1 hour' where id = $1", [r.id]);
      await producer(RUN, [EVENT]);
      await producer(RUN, [EVENT]); // repetir no duplica
      alerts = await alertsOf(admin, r.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ level: 3, title: "Documento vencido: Contratos con proveedores" });

      await producer(COMPLETE, [r.id, null, null, null, "Enviados por correo al cliente"]);
      expect((await alertsOf(admin, r.id))[0].status).toBe("resolved");
      await producer(RUN, [EVENT]);
      expect(await alertsOf(admin, r.id)).toHaveLength(1);
    });
  });

  it("un no negociable sin documento cuando el evento ya llegó a su hora es Red Flag y el cliente la ve", async () => {
    await scenario(async ({ admin, asUser }) => {
      const r = await byKey(admin, "sctr");
      await admin("update events set starts_at = now() - interval '1 hour' where id = $1", [EVENT]);
      await admin("update event_requirements set due_at = now() - interval '3 days' where id = $1", [r.id]);
      await asUser(USERS.producer)(RUN, [EVENT]);
      const alerts = await alertsOf(admin, r.id);
      expect(alerts[0]).toMatchObject({ level: 4, visible_to_viewer: true, title: "No negociable sin documento: SCTR o seguro de vida del equipo" });
      await asUser(USERS.backend)(STATUS, [r.id, "not_applicable", "El cliente lo cubre con su póliza"]);
      expect((await alertsOf(admin, r.id))[0].status).toBe("resolved");
    });
  });
});

describe("Archivos del expediente", () => {
  it("el equipo sube a <evento>/expediente/, también con el evento cerrado; el cliente y los ajenos no", async () => {
    await scenario(async ({ admin, asUser }) => {
      const can = async (who: string, name: string) => (await asUser(who)("select public.can_upload_requirement_file($1) as ok", [name])).rows[0].ok;
      expect(await can(USERS.producer, `${EVENT}/expediente/a.pdf`)).toBe(true);
      expect(await can(USERS.producer, `${EVENT}/otra/a.pdf`)).toBe(false);
      expect(await can(USERS.producer, `${EVENT}/expediente/`)).toBe(false);
      expect(await can(USERS.producer, `${FOREIGN_EVENT}/expediente/a.pdf`)).toBe(false);
      expect(await can(USERS.viewer, `${EVENT}/expediente/a.pdf`)).toBe(false);
      expect(await can(USERS.outsider, `${EVENT}/expediente/a.pdf`)).toBe(false);
      await admin("update events set status = 'closed' where id = $1", [EVENT]);
      expect(await can(USERS.producer, `${EVENT}/expediente/factura.xml`)).toBe(true);
      const r = await byKey(admin, "facturas");
      await asUser(USERS.producer)(COMPLETE, [r.id, `${EVENT}/expediente/factura.xml`, "factura.xml", "abc", null]);
      expect((await byKey(admin, "facturas")).status).toBe("done");
    });
  });
});

describe("Locación", () => {
  const SET = "select public.set_location($1, $2::jsonb)";
  const data = {
    meeting_point: " Puerta 3, av. Javier Prado ",
    map_url: "https://maps.app.goo.gl/abc123",
    coordinator: "Tatiana Ríos",
    coordinator_phone: "+51 999 888 777",
    transport_plate: "abc-123",
    transport_detail: "Camión de 2 toneladas",
    antecedents: ["No hay cajas de luz cerca", " ", "El colegio de al lado prohíbe sonido antes de las 3 p. m."],
    killer_zones: "Esquina con la avenida",
    blind_spots: "Detrás del stand",
  };

  it("la guardan los niveles 1 y 2, limpia los datos y solo el equipo la ve", async () => {
    await scenario(async ({ admin, asUser }) => {
      await asUser(USERS.producer)(SET, [EVENT, JSON.stringify(data)]);
      const row = (await admin("select * from event_locations where event_id = $1", [EVENT])).rows[0];
      expect(row).toMatchObject({
        meeting_point: "Puerta 3, av. Javier Prado",
        coordinator_phone: "+51999888777",
        transport_plate: "ABC-123",
        antecedents: ["No hay cajas de luz cerca", "El colegio de al lado prohíbe sonido antes de las 3 p. m."],
      });
      await asUser(USERS.backend)(SET, [EVENT, JSON.stringify({ ...data, killer_zones: "" })]);
      expect((await admin("select killer_zones from event_locations where event_id = $1", [EVENT])).rows[0].killer_zones).toBeNull();

      expect((await asUser(USERS.producer)("select 1 from event_locations")).rows).toHaveLength(1);
      expect((await asUser(USERS.viewer)("select 1 from event_locations")).rows).toHaveLength(0);
      expect((await asUser(USERS.outsider)("select 1 from event_locations")).rows).toHaveLength(0);
      expect((await asUser(USERS.producer)("update event_locations set coordinator = 'x'")).rowCount).toBe(0);
    });
  });

  it("rechaza enlaces que no son https y a quien no decide", async () => {
    await scenario(async ({ admin, asUser }) => {
      expect(await errorOf(asUser(USERS.producer), SET, [EVENT, JSON.stringify({ map_url: "javascript:alert(1)" })])).toMatch(/https/);
      expect(await errorOf(asUser(USERS.viewer), SET, [EVENT, JSON.stringify(data)])).toMatch(/No tienes permiso/);
      expect(await errorOf(asUser(USERS.outsider), SET, [EVENT, JSON.stringify(data)])).toMatch(/No tienes permiso/);
      await admin("update event_members set level = 4 where event_id = $1 and profile_id = $2", [EVENT, USERS.producer]);
      expect(await errorOf(asUser(USERS.producer), SET, [EVENT, JSON.stringify(data)])).toMatch(/productor general o el productor de campo/);
    });
  });
});
