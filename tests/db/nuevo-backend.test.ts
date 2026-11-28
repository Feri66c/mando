// «Crear nuevo backend»: un administrador de la organización suma a otra persona con su mismo poder.
// Cada prueba corre en una transacción que se deshace al final. Se corre con `npm run test:db`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const ORG = "00000000-0000-0000-0000-000000000001";
const USERS = {
  producer: "00000000-0000-0000-0000-0000000000a1", // miembro de la organización, no administra
  backend: "00000000-0000-0000-0000-0000000000a2", // administra la organización
} as const;
const NEW_USER = "00000000-0000-4000-8000-000000000778";
const INVITE = "select public.invite_org_admin($1, $2, $3) as r";

type Q = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;
let db: pg.Client;

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});

async function scenario<T>(fn: (s: { admin: Q; asUser: (userId: string) => Q; anon: Q }) => Promise<T>): Promise<T> {
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
  const anon: Q = async (sql, params) => {
    await db.query("set local role anon");
    await db.query("select set_config('request.jwt.claims', '{}', true)");
    const result = await db.query(sql, params);
    await db.query("reset role");
    return result;
  };
  try {
    return await fn({ admin, asUser, anon });
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

const isAdmin = async (admin: Q, profile: string) =>
  (await admin("select is_admin from organization_members where organization_id = $1 and profile_id = $2", [ORG, profile])).rows[0]
    ?.is_admin === true;

describe("Crear nuevo backend", () => {
  it("una persona nueva: queda invitada, puede pedir código y al entrar es administradora con su nombre", async () => {
    await scenario(async ({ admin, asUser, anon }) => {
      const r = (await asUser(USERS.backend)(INVITE, [ORG, "  Ana@Ejemplo.com ", "Ana Torres"])).rows[0].r;
      expect(r.joined).toBe(false);
      expect((await anon("select public.invitation_pending('ana@ejemplo.com') as ok")).rows[0].ok).toBe(true);

      await admin("insert into auth.users (id, email) values ($1, 'ana@ejemplo.com')", [NEW_USER]);
      expect((await asUser(NEW_USER)("select public.claim_org_invitations() as n")).rows[0].n).toBe(1);
      expect(await isAdmin(admin, NEW_USER)).toBe(true);
      expect((await admin("select full_name from profiles where id = $1", [NEW_USER])).rows[0].full_name).toBe("Ana Torres");
      expect((await anon("select public.invitation_pending('ana@ejemplo.com') as ok")).rows[0].ok).toBe(false);
      // Ahora ve a los backends de su organización.
      const list = (await asUser(NEW_USER)("select email, is_me from public.org_admins($1)", [ORG])).rows;
      expect(list.map((x) => x.email)).toContain("ana@ejemplo.com");
    });
  });

  it("una persona que ya tiene cuenta queda como administradora al instante", async () => {
    await scenario(async ({ admin, asUser }) => {
      const email = (await admin("select email from auth.users where id = $1", [USERS.producer])).rows[0].email;
      const r = (await asUser(USERS.backend)(INVITE, [ORG, email, "Productor de ejemplo"])).rows[0].r;
      expect(r.joined).toBe(true);
      expect(await isAdmin(admin, USERS.producer)).toBe(true);
    });
  });

  it("solo un administrador puede crear backends, ver invitaciones o la lista", async () => {
    await scenario(async ({ asUser, anon }) => {
      expect(await errorOf(asUser(USERS.producer), INVITE, [ORG, "x@ejemplo.com", "X"])).toMatch(/administrador/);
      expect(await errorOf(anon, INVITE, [ORG, "x@ejemplo.com", "X"])).toMatch(/permission denied/);
      await asUser(USERS.backend)(INVITE, [ORG, "x@ejemplo.com", "X"]);
      expect((await asUser(USERS.producer)("select 1 from org_invitations")).rowCount).toBe(0);
      expect((await asUser(USERS.backend)("select 1 from org_invitations")).rowCount).toBe(1);
      expect((await asUser(USERS.producer)("select * from public.org_admins($1)", [ORG])).rowCount).toBe(0);
    });
  });

  it("no duplica, valida el correo y el nombre, y una invitación retirada ya no deja pedir código", async () => {
    await scenario(async ({ asUser, anon }) => {
      const me = asUser(USERS.backend);
      expect(await errorOf(me, INVITE, [ORG, "no-es-correo", "X"])).toMatch(/correo válido/);
      expect(await errorOf(me, INVITE, [ORG, "y@ejemplo.com", " "])).toMatch(/nombre/);
      const id = (await me(INVITE, [ORG, "y@ejemplo.com", "Y"])).rows[0].r.invitation_id;
      expect(await errorOf(me, INVITE, [ORG, "y@ejemplo.com", "Y"])).toMatch(/pendiente/);
      await me("select public.revoke_org_invitation($1)", [id]);
      expect((await anon("select public.invitation_pending('y@ejemplo.com') as ok")).rows[0].ok).toBe(false);
    });
  });

  it("una cuenta bloqueada no puede volver como backend", async () => {
    await scenario(async ({ admin, asUser }) => {
      await admin("update auth.users set banned_until = '2999-01-01' where id = $1", [USERS.producer]);
      const email = (await admin("select email from auth.users where id = $1", [USERS.producer])).rows[0].email;
      expect(await errorOf(asUser(USERS.backend), INVITE, [ORG, email, "Productor"])).toMatch(/bloqueada/);
    });
  });
});
