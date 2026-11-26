// Banco de talentos (decisiones 55 a 58): guardar por documento, pasar al casting, importar una lista
// y quién puede leer los datos personales. Cada prueba corre en una transacción que se deshace al final.
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

const SAVE = "select public.save_talent($1, null, $2, $3, $4, $5, $6::jsonb, $7, $8, $9) as id";
const PHOTO = `personas/${ORG}/foto/mayra.jpg`;
const bank = async (q: Q) => (await q("select * from public.talent_bank($1)", [EVENT])).rows;

describe("Banco de talentos", () => {
  it("la persona se reconoce por su documento y vuelve con sus datos", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      // Sin la autorización de la persona no se guarda a nadie nuevo.
      expect(await errorOf(producer, SAVE, [EVENT, "Mayra Quispe", "dni", "70123456", ["Modelo"], "{}", null, null, false])).toMatch(/autorizó guardar sus datos/);
      const id = (await producer(SAVE, [EVENT, "Mayra  Quispe", "dni", "70123456", ["Modelo", " ANFITRIONA ", "modelo"], JSON.stringify({ edad: 24, talla: "M" }), "999111222", PHOTO, true])).rows[0].id;
      // Otro día, otra productora escribe el mismo DNI: es la misma ficha, y lo nuevo se suma.
      const again = (await asUser(USERS.backend)(SAVE, [EVENT, "Mayra Quispe Rojas", "dni", "7012 3456", null, JSON.stringify({ talla: "S", habilidad: "Canto" }), null, null, false])).rows[0].id;
      expect(again).toBe(id);
      expect((await asUser(USERS.producer)("select public.find_talent($1, 'dni', '70123456') as id", [EVENT])).rows[0].id).toBe(id);
      expect((await asUser(USERS.producer)("select public.find_talent($1, 'dni', '70999999') as id", [EVENT])).rows[0].id).toBeNull();

      const row = (await bank(producer)).find((r) => r.person_id === id);
      expect(row).toMatchObject({
        full_name: "Mayra Quispe Rojas", doc_type: "dni", doc_number: "70123456", phone: "999111222", photo_path: PHOTO,
        categories: ["anfitriona", "modelo"], profile: { edad: "24", talla: "S", habilidad: "Canto" }, consent: true, in_casting: false,
      });
      expect((await admin("select consent_by from people where id = $1", [id])).rows[0].consent_by).toBe(USERS.producer);
      // La foto debe ser de esta organización.
      expect(await errorOf(producer, SAVE, [EVENT, "Otra", "dni", "70000001", null, "{}", null, "personas/00000000-0000-0000-0000-000000009901/foto/x.jpg", true])).toMatch(/no pertenece/);
    });
  });

  it("del banco al casting: entra con su foto y su ficha, una sola vez", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const id = (await producer(SAVE, [EVENT, "Gabriela Torres", "pasaporte", "xy123456", ["host"], JSON.stringify({ estatura: 172 }), null, PHOTO, true])).rows[0].id;
      const item = (await producer("select public.add_casting_from_talent($1, $2, null) as id", [EVENT, id])).rows[0].id;
      const row = (await asUser(USERS.viewer)("select group_key, name, detail, file_path, profile, status, person_id from event_approvals where id = $1", [item])).rows[0];
      expect(row).toEqual({ group_key: "casting", name: "Gabriela Torres", detail: "Host", file_path: PHOTO, profile: { estatura: "172" }, status: "pending", person_id: id });
      expect(await errorOf(producer, "select public.add_casting_from_talent($1, $2, null)", [EVENT, id])).toMatch(/ya está en el casting/);
      expect((await bank(producer)).find((r) => r.person_id === id)).toMatchObject({ in_casting: true, events: 1 });

      // El cliente del evento ve la foto de quien está en su casting, pero no las demás ni la copia del documento.
      const canRead = async (user: string, path: string) => (await asUser(user)("select public.can_read_person_file($1) as ok", [path])).rows[0].ok;
      expect(await canRead(USERS.viewer, PHOTO)).toBe(true);
      expect(await canRead(USERS.viewer, `personas/${ORG}/foto/otra.jpg`)).toBe(false);
      expect(await canRead(USERS.viewer, `personas/${ORG}/dni/mayra.jpg`)).toBe(false);
      expect(await canRead(USERS.outsider, PHOTO)).toBe(false);
      // El veredicto del cliente funciona igual sobre alguien que vino del banco.
      await asUser(USERS.viewer)("select public.decide_casting($1, 'approved', null)", [item]);
      expect((await admin("select status from event_approvals where id = $1", [item])).rows[0].status).toBe("approved");
    });
  });

  it("importar una lista: crea, actualiza y dice qué filas no entraron", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const before = (await admin("select count(*)::int as n from people where organization_id = $1", [ORG])).rows[0].n;
      const rows = [
        { nombre: "Ana Uno", tipo: "dni", documento: "70123456", categorias: ["modelo"], ficha: { edad: "24", talla: "M" } },
        { nombre: "Luis Dos", tipo: "dni", documento: "1234" },
        { nombre: " ", documento: "70000000" },
        { nombre: "Eva Tres", ficha: { talla: "S" } },
      ];
      const IMPORT = "select public.import_talents($1, $2::jsonb, $3) as r";
      expect(await errorOf(producer, IMPORT, [EVENT, JSON.stringify(rows), false])).toMatch(/autorizaron/);
      expect(await errorOf(producer, IMPORT, [EVENT, "[]", true])).toMatch(/vacía/);
      expect(await errorOf(producer, IMPORT, [EVENT, JSON.stringify(Array.from({ length: 501 }, () => ({ nombre: "x" }))), true])).toMatch(/más de 500/);

      const first = (await producer(IMPORT, [EVENT, JSON.stringify(rows), true])).rows[0].r;
      expect(first.created).toBe(2);
      expect(first.updated).toBe(0);
      expect(first.skipped.map((s: { fila: number }) => s.fila)).toEqual([2, 3]);
      expect(first.skipped[0].motivo).toMatch(/Luis Dos: El DNI tiene exactamente 8 números/);

      // La misma lista otra vez no duplica a nadie.
      const second = (await producer(IMPORT, [EVENT, JSON.stringify([{ ...rows[0], categorias: ["host"] }, rows[3]]), true])).rows[0].r;
      expect(second).toMatchObject({ created: 0, updated: 2 });
      expect((await admin("select count(*)::int as n from people where organization_id = $1", [ORG])).rows[0].n).toBe(before + 2);
      const ana = (await admin("select categories, profile, source, consent_at is not null as consent from people where organization_id = $1 and doc_number = '70123456'", [ORG])).rows[0];
      expect(ana).toEqual({ categories: ["host", "modelo"], profile: { edad: "24", talla: "M" }, source: "csv", consent: true });
      const log = (await admin("select summary from log_entries where event_id = $1 order by id desc limit 1", [EVENT])).rows[0].summary;
      expect(log).toMatch(/importó una lista al banco de talentos: 0 nuevas, 2 actualizadas/);
    });
  });

  it("seguridad: el banco solo lo leen y escriben los niveles 1 y 2 de la organización", async () => {
    await scenario(async ({ admin, asUser }) => {
      await asUser(USERS.producer)(SAVE, [EVENT, "Mayra Quispe", "dni", "70123456", ["modelo"], "{}", "999111222", null, true]);
      for (const user of [USERS.viewer, USERS.outsider]) {
        const q = asUser(user);
        expect(await errorOf(q, "select * from public.talent_bank($1)", [EVENT])).toMatch(/No tienes permiso|productor/);
        expect(await errorOf(q, "select public.find_talent($1, 'dni', '70123456')", [EVENT])).toMatch(/No tienes permiso|productor/);
        expect(await errorOf(q, SAVE, [EVENT, "X Y", "dni", "70000002", null, "{}", null, null, true])).toMatch(/No tienes permiso|productor/);
        expect(await errorOf(q, "select public.import_talents($1, $2::jsonb, true)", [EVENT, JSON.stringify([{ nombre: "X" }])])).toMatch(/No tienes permiso|productor/);
        // Ni siquiera leyendo la tabla directo: la seguridad por fila no devuelve ninguna persona.
        expect((await q("select count(*)::int as n from people")).rows[0].n).toBe(0);
        expect((await q("update people set phone = '1'")).rowCount).toBe(0);
      }
      // Un técnico (nivel 4) del mismo evento tampoco ve documentos ni teléfonos.
      await admin("update event_members set level = 4 where event_id = $1 and profile_id = $2", [EVENT, USERS.producer]);
      expect(await errorOf(asUser(USERS.producer), "select * from public.talent_bank($1)", [EVENT])).toMatch(/productor general o el productor de campo/);
      expect((await asUser(USERS.producer)("select count(*)::int as n from people")).rows[0].n).toBe(0);
    });
  });
});
