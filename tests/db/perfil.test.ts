// Foto, avatar y modo de pantalla (decisión 96). Cada prueba corre en una transacción que se deshace al final.
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

const photo = (id: string, file = "11111111-1111-4111-8111-111111111111.jpg") => `perfil/${id}/${file}`;

describe("foto y avatar", () => {
  it("la foto la pone la persona o su backend; el avatar, solo la persona", async () => {
    await scenario(async ({ admin, asUser }) => {
      // El backend pone la foto del productor; el productor la ve y la cambia.
      await asUser(USERS.backend)("select public.set_profile_photo($1, $2)", [USERS.producer, photo(USERS.producer)]);
      let row = (await admin("select photo_path, photo_by from profiles where id = $1", [USERS.producer])).rows[0];
      expect(row).toEqual({ photo_path: photo(USERS.producer), photo_by: USERS.backend });
      await asUser(USERS.producer)("select public.set_profile_photo($1, $2)", [USERS.producer, photo(USERS.producer, "b.png")]);
      row = (await admin("select photo_path from profiles where id = $1", [USERS.producer])).rows[0];
      expect(row.photo_path).toBe(photo(USERS.producer, "b.png"));

      // El productor no pone la foto del backend, ni nadie de afuera, ni el cliente.
      expect(await errorOf(asUser(USERS.producer), "select public.set_profile_photo($1, $2)", [USERS.backend, photo(USERS.backend)])).toMatch(/productor general/);
      expect(await errorOf(asUser(USERS.outsider), "select public.set_profile_photo($1, $2)", [USERS.producer, photo(USERS.producer)])).toMatch(/productor general/);
      expect(await errorOf(asUser(USERS.backend), "select public.set_profile_photo($1, $2)", [USERS.viewer, photo(USERS.viewer)])).toMatch(/productor general/);
      expect(await errorOf(asUser(USERS.backend), "select public.set_profile_photo($1, $2)", [USERS.producer, photo(USERS.backend)])).toMatch(/PNG/);

      // Avatar: solo la persona, en su carpeta.
      await asUser(USERS.producer)("select public.set_my_avatar($1)", [photo(USERS.producer, "avatar.png")]);
      row = (await admin("select avatar_path, show_avatar from profiles where id = $1", [USERS.producer])).rows[0];
      expect(row).toEqual({ avatar_path: photo(USERS.producer, "avatar.png"), show_avatar: true });
      expect(await errorOf(asUser(USERS.producer), "select public.set_my_avatar($1)", [photo(USERS.backend, "avatar.png")])).toMatch(/PNG/);
    });
  });

  it("los archivos de perfil los suben quienes pueden y los ve el equipo", async () => {
    await scenario(async ({ asUser }) => {
      const up = (u: string, p: string) => asUser(u)("select public.can_upload_profile_file($1) as ok", [p]).then((r) => r.rows[0].ok);
      const read = (u: string, p: string) => asUser(u)("select public.can_read_profile_file($1) as ok", [p]).then((r) => r.rows[0].ok);
      expect(await up(USERS.producer, photo(USERS.producer))).toBe(true);
      expect(await up(USERS.backend, photo(USERS.producer))).toBe(true);
      expect(await up(USERS.producer, photo(USERS.backend))).toBe(false);
      expect(await up(USERS.producer, photo(USERS.producer, "x.exe"))).toBe(false);
      expect(await up(USERS.producer, `perfil/${USERS.producer}/otra/x.png`)).toBe(false);
      expect(await read(USERS.backend, photo(USERS.producer))).toBe(true);
      expect(await read(USERS.outsider, photo(USERS.producer))).toBe(false);
    });
  });
});

describe("modo de pantalla", () => {
  it("cada quien elige el suyo y nadie cambia las columnas a mano", async () => {
    await scenario(async ({ admin, asUser }) => {
      const me = asUser(USERS.producer);
      await me("select public.set_my_look(null, 'sol')");
      expect((await admin("select display_mode from profiles where id = $1", [USERS.producer])).rows[0].display_mode).toBe("sol");
      expect(await errorOf(me, "select public.set_my_look(null, 'galactico')")).toMatch(/Neón/);
      // Sin avatar no se puede mostrar el avatar.
      await me("select public.set_my_look(true, null)");
      expect((await admin("select show_avatar from profiles where id = $1", [USERS.producer])).rows[0].show_avatar).toBe(false);
      expect(await errorOf(me, "update profiles set display_mode = 'neon' where id = $1", [USERS.producer])).toMatch(/Mi perfil/);
      expect(await errorOf(me, "update profiles set photo_path = 'x' where id = $1", [USERS.producer])).toMatch(/Mi perfil/);
      // El nombre sí se sigue editando como antes.
      expect(await errorOf(me, "update profiles set phone = '999' where id = $1", [USERS.producer])).toBeNull();
    });
  });
});
