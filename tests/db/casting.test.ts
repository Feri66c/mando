// Semáforo de casting, mini ficha, tipo de documento y catálogo de cargos (decisiones 50 a 53).
// Cada prueba corre en una transacción que se deshace al final.
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

const ADD = "select public.add_approval_item($1, $2, $3, $4, null, null, $5::jsonb) as id";
const VERDICT = "select public.decide_casting($1, $2, $3)";
const SAVE = "select public.save_person($1, null, $2, $3, null, null, $4, null, null, $5) as id";
const missing = async (admin: Q) => (await admin("select public._approvals_missing($1) as m", [EVENT])).rows[0].m as string | null;

describe("Semáforo de casting", () => {
  it("cada persona queda Aprobada, Backup o No admitida, y el casting cierra con al menos una aprobada", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const viewer = asUser(USERS.viewer);
      await admin("update event_approvals set removed_at = now() where event_id = $1", [EVENT]);
      await asUser(USERS.backend)("select public.set_approval_groups($1, $2)", [EVENT, ["casting"]]);
      const ids: string[] = [];
      for (const name of ["Mayra", "Gabriela", "Lucía"]) ids.push((await producer(ADD, [EVENT, "casting", name, "Anfitriona", "{}"])).rows[0].id);
      expect(await missing(admin)).toBe("Casting: 3 por aprobar");

      // La productora sube, pero el veredicto no es suyo.
      expect(await errorOf(producer, VERDICT, [ids[0], "approved", null])).toMatch(/lo da el cliente/);
      expect(await errorOf(asUser(USERS.outsider), VERDICT, [ids[0], "approved", null])).toMatch(/No tienes permiso/);
      expect(await errorOf(viewer, VERDICT, [ids[0], "quizás", null])).toMatch(/Aprobado, Backup o No admitido/);

      await viewer(VERDICT, [ids[1], "backup", null]);
      await viewer(VERDICT, [ids[2], "rejected", "No calza con la marca"]);
      expect(await missing(admin)).toBe("Casting: 1 por aprobar");
      await viewer(VERDICT, [ids[0], "rejected", null]);
      expect(await missing(admin)).toBe("Casting: falta al menos una persona aprobada");
      await asUser(USERS.backend)(VERDICT, [ids[0], "approved", null]);
      expect(await missing(admin)).toBeNull();

      const rows = (await viewer("select name, status from event_approvals where event_id = $1 and removed_at is null order by code", [EVENT])).rows;
      expect(rows.map((r) => r.status).sort()).toEqual(["approved", "backup", "rejected"]);
      const log = (await admin("select summary from log_entries where event_id = $1 and kind = 'approval_updated' order by id desc limit 1", [EVENT])).rows[0].summary;
      expect(log).toMatch(/marcó .*«Mayra» como Aprobado/);
    });
  });

  it("nadie se retira del casting y el semáforo no sirve para otros grupos", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const person = (await producer(ADD, [EVENT, "casting", "Mayra", null, "{}"])).rows[0].id;
      const uniform = (await producer(ADD, [EVENT, "uniforme", "Polo azul", null, null])).rows[0].id;
      expect(await errorOf(producer, "select public.update_approval_item($1, 'remove')", [person])).toMatch(/nadie se retira/);
      expect(await errorOf(asUser(USERS.viewer), VERDICT, [uniform, "backup", null])).toMatch(/solo para el casting/);
      expect(await errorOf(producer, "select public.update_approval_item($1, 'remove')", [uniform])).toBeNull();
      // La tabla sigue sin aceptar escrituras directas: la seguridad por fila no deja tocar ninguna.
      for (const user of [USERS.viewer, USERS.producer, USERS.backend]) {
        expect((await asUser(user)("update event_approvals set status = 'approved' where id = $1", [person])).rowCount).toBe(0);
      }
      expect((await admin("select status from event_approvals where id = $1", [person])).rows[0].status).toBe("pending");
    });
  });

  it("la mini ficha viaja limpia, la corrige quien coordina y la ve el cliente del evento", async () => {
    await scenario(async ({ asUser }) => {
      const producer = asUser(USERS.producer);
      const id = (await producer(ADD, [EVENT, "casting", "Gabriela", null, JSON.stringify({ edad: 24, talla: "M", habilidad: " Canto ", vacio: "", lista: ["x"] })])).rows[0].id;
      const read = async (q: Q) => (await q("select profile from event_approvals where id = $1", [id])).rows[0]?.profile;
      expect(await read(asUser(USERS.viewer))).toEqual({ edad: "24", talla: "M", habilidad: "Canto" });
      expect(await errorOf(asUser(USERS.viewer), "select public.set_approval_profile($1, $2::jsonb)", [id, "{}"])).toMatch(/No tienes permiso|coordina/);
      await producer("select public.set_approval_profile($1, $2::jsonb)", [id, JSON.stringify({ estatura: 168 })]);
      expect(await read(producer)).toEqual({ estatura: "168" });
      expect(await read(asUser(USERS.outsider))).toBeUndefined();
    });
  });
});

describe("Tipo de documento", () => {
  it("el DNI tiene 8 números exactos; carnet y pasaporte aceptan letras", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      expect(await errorOf(producer, SAVE, [EVENT, "Ana Uno", "1234567", "Host", "dni"])).toMatch(/8 números/);
      expect(await errorOf(producer, SAVE, [EVENT, "Ana Uno", "123456789", "Host", "dni"])).toMatch(/8 números/);
      expect(await errorOf(producer, SAVE, [EVENT, "Ana Uno", "1234567A", "Host", "dni"])).toMatch(/8 números/);
      expect(await errorOf(producer, SAVE, [EVENT, "Ana Uno", "AB12", "Host", "pasaporte"])).toMatch(/6 a 12/);
      expect(await errorOf(producer, SAVE, [EVENT, "Ana Uno", "12345678", "Host", "cedula"])).toMatch(/tipo de documento/);

      const dni = (await producer(SAVE, [EVENT, "Ana Uno", "7012 3456", "Host", "dni"])).rows[0].id;
      const ce = (await producer(SAVE, [EVENT, "Luis Dos", "70123456a", "Modelo", "ce"])).rows[0].id;
      const pass = (await producer(SAVE, [EVENT, "Eva Tres", "xy-123456", "Modelo", "pasaporte"])).rows[0].id;
      const rows = (await admin("select id, doc_type, doc_number from people where id = any($1) order by full_name", [[dni, ce, pass]])).rows;
      expect(rows.map((r) => [r.doc_type, r.doc_number])).toEqual([["dni", "70123456"], ["pasaporte", "XY123456"], ["ce", "70123456A"]]);

      // El mismo documento devuelve la misma ficha: nadie se registra dos veces.
      const again = (await producer(SAVE, [EVENT, "Ana Uno Pérez", "70123456", "Host", "dni"])).rows[0].id;
      expect(again).toBe(dni);
      // El mismo número con otro tipo de documento es otra persona.
      const other = (await producer(SAVE, [EVENT, "Otra Persona", "70123456", "Host", "pasaporte"])).rows[0].id;
      expect(other).not.toBe(dni);

      const board = (await producer("select person_id, doc_type from public.event_people_board($1)", [EVENT])).rows;
      expect(board.find((r) => r.person_id === ce)?.doc_type).toBe("ce");
    });
  });
});

describe("Catálogo de cargos", () => {
  it("la productora propone, el backend aprueba y nadie más escribe", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const backend = asUser(USERS.backend);
      expect(await errorOf(asUser(USERS.viewer), "select public.propose_role($1, $2)", [EVENT, "Utilero"])).toMatch(/No tienes permiso|productor/);
      expect(await errorOf(producer, "select public.propose_role($1, $2)", [EVENT, " "])).toMatch(/Escribe el cargo/);

      const id = (await producer("select public.propose_role($1, $2) as id", [EVENT, "  Jefe   de piso "])).rows[0].id;
      // Repetido con otras mayúsculas: devuelve el mismo.
      expect((await producer("select public.propose_role($1, $2) as id", [EVENT, "jefe de piso"])).rows[0].id).toBe(id);
      expect((await producer("select name, status from role_catalog where id = $1", [id])).rows[0]).toEqual({ name: "Jefe de piso", status: "pending" });

      expect(await errorOf(producer, "select public.review_role($1, true)", [id])).toMatch(/los aprueba el backend/);
      await backend("select public.review_role($1, true)", [id]);
      expect((await backend("select status, reviewed_by from role_catalog where id = $1", [id])).rows[0]).toEqual({ status: "approved", reviewed_by: USERS.backend });
      const log = (await admin("select summary from log_entries where event_id = $1 and entity_type = 'role' order by id", [EVENT])).rows.map((r) => r.summary);
      expect(log).toHaveLength(2);
      expect(log[1]).toMatch(/aprobó el cargo «Jefe de piso»/);
    });
  });

  it("seguridad por fila: el catálogo no se lee desde afuera ni se escribe directo", async () => {
    await scenario(async ({ admin, asUser }) => {
      await asUser(USERS.producer)("select public.propose_role($1, $2)", [EVENT, "Aguatero de pista"]);
      expect((await admin("select count(*)::int as n from role_catalog where organization_id = $1", [ORG])).rows[0].n).toBe(1);
      expect((await asUser(USERS.outsider)("select count(*)::int as n from role_catalog")).rows[0].n).toBe(0);
      expect((await asUser(USERS.viewer)("select count(*)::int as n from role_catalog")).rows[0].n).toBe(0);
      expect((await asUser(USERS.producer)("select count(*)::int as n from role_catalog")).rows[0].n).toBe(1);
      for (const user of [USERS.producer, USERS.backend, USERS.viewer]) {
        const q = asUser(user);
        expect(await errorOf(q, "insert into role_catalog (organization_id, name, name_key) values ($1, 'X Y', 'x y')", [ORG])).toMatch(/permission denied|row-level/);
        expect((await q("update role_catalog set status = 'approved'")).rowCount).toBe(0);
        expect((await q("delete from role_catalog")).rowCount).toBe(0);
      }
      expect((await admin("select status from role_catalog where organization_id = $1", [ORG])).rows).toEqual([{ status: "pending" }]);
    });
  });
});
