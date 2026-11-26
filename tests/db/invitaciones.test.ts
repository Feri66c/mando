// Eventos por invitación y tipo: crear un evento desde su plantilla, invitar con cargo y nivel,
// unirse con el código y ver la bienvenida. Cada prueba corre en una transacción que se deshace al final.
//
// Se corre con `npm run test:db`.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const ORG = "00000000-0000-0000-0000-000000000001";
const EVENT = "00000000-0000-0000-0000-0000000000e1";
const FOREIGN_EVENT = "00000000-0000-0000-0000-000000009905";
const USERS = {
  producer: "00000000-0000-0000-0000-0000000000a1", // productor de campo, no administra la organización
  backend: "00000000-0000-0000-0000-0000000000a2", // productor general, administra la organización
  viewer: "00000000-0000-0000-0000-0000000000a3",
  outsider: "00000000-0000-0000-0000-000000009903",
} as const;
const NEW_USER = "00000000-0000-4000-8000-000000000777";

const config = JSON.parse(readFileSync(new URL("../../config/tipos-de-evento.json", import.meta.url), "utf8"));
const SAMPLING = JSON.stringify(config.tipos.find((t: { clave: string }) => t.clave === "sampling"));
const KEY_TIME = "2026-12-06T15:00:00Z";

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

const CREATE = "select public.create_event_from_template($1, $2, $3, $4, $5, $6, $7::jsonb, '{}'::jsonb, $8) as id";
const createArgs = (name = "Sampling Sodimac") => [ORG, name, "Sodimac", "Mall del Sur", "America/Lima", KEY_TIME, SAMPLING, "Entregar 2000 muestras."];
const INVITE = "select public.invite_to_event($1, $2, $3, $4, $5::event_role, $6::smallint) as r";

describe("Crear un evento desde su plantilla", () => {
  it("el productor general crea un sampling: 5 piezas a su hora, él queda con el mando y la bitácora lo anota", async () => {
    await scenario(async ({ admin, asUser }) => {
      const id = (await asUser(USERS.backend)(CREATE, createArgs())).rows[0].id;
      const event = (await admin("select kind, tier, status, starts_at, ends_at, template ->> 'nombre' as tname from events where id = $1", [id])).rows[0];
      expect(event).toMatchObject({ kind: "sampling", tier: "ligero", status: "planned", tname: "Sampling" });
      expect(new Date(event.starts_at).toISOString()).toBe("2026-12-06T15:00:00.000Z");
      expect(new Date(event.ends_at).toISOString()).toBe("2026-12-06T20:30:00.000Z");

      const items = (await admin("select title, current_start, is_milestone, visible_to_viewer from route_items where event_id = $1 order by sort_order", [id])).rows;
      expect(items.map((i) => i.title)).toEqual(["Convocatoria", "Brief", "Distribución", "Experiencia", "Cierre"]);
      expect(new Date(items[2].current_start).toISOString()).toBe("2026-12-06T15:00:00.000Z");
      expect(items.map((i) => i.is_milestone)).toEqual([false, false, true, false, true]);
      expect(items[0].visible_to_viewer).toBe(false);

      const me = (await admin("select role, title, level, welcomed_at from event_members where event_id = $1", [id])).rows;
      expect(me).toHaveLength(1);
      expect(me[0]).toMatchObject({ role: "backend", title: "Productor general", level: 1 });
      expect(me[0].welcomed_at).not.toBeNull();

      expect((await admin("select body from briefs where event_id = $1", [id])).rows[0].body).toBe("Entregar 2000 muestras.");
      const log = (await admin("select kind, summary from log_entries where event_id = $1", [id])).rows;
      expect(log).toHaveLength(1);
      expect(log[0].kind).toBe("event_created");
      expect(log[0].summary).toContain("5 piezas");
    });
  });

  it("quien no administra la organización no puede crear eventos", async () => {
    await scenario(async ({ asUser }) => {
      for (const who of [USERS.producer, USERS.viewer, USERS.outsider]) {
        expect(await errorOf(asUser(who), CREATE, createArgs())).toMatch(/Solo un productor general/);
      }
    });
  });

  it("rechaza una plantilla sin piezas, sin nombre o con zona horaria inventada", async () => {
    await scenario(async ({ asUser }) => {
      const q = asUser(USERS.backend);
      const noPieces = JSON.stringify({ clave: "x", nombre: "X", tamano: "ligero", piezas: [] });
      expect(await errorOf(q, CREATE, [ORG, "X", "", "", "America/Lima", KEY_TIME, noPieces, null])).toMatch(/no tiene piezas/);
      expect(await errorOf(q, CREATE, [ORG, "  ", "", "", "America/Lima", KEY_TIME, SAMPLING, null])).toMatch(/nombre del evento/);
      expect(await errorOf(q, CREATE, [ORG, "X", "", "", "Marte/Olimpo", KEY_TIME, SAMPLING, null])).toMatch(/Zona horaria/);
    });
  });
});

describe("Invitar: solo el productor general reparte el mando", () => {
  it("invita a alguien sin cuenta: queda pendiente y no es miembro todavía", async () => {
    await scenario(async ({ admin, asUser }) => {
      const r = (await asUser(USERS.backend)(INVITE, [EVENT, " Tati@Ejemplo.com ", "Tatiana Ríos", "Productora de campo", "producer", 2])).rows[0].r;
      expect(r.joined).toBe(false);
      const inv = (await admin("select email, full_name, title, level, accepted_at from invitations where id = $1", [r.invitation_id])).rows[0];
      expect(inv).toMatchObject({ email: "tati@ejemplo.com", full_name: "Tatiana Ríos", title: "Productora de campo", level: 2, accepted_at: null });
      const log = (await admin("select summary, visible_to_viewer from log_entries where event_id = $1 and kind = 'member_invited'", [EVENT])).rows;
      expect(log).toHaveLength(1);
      expect(log[0].summary).toContain("invitó a Tatiana Ríos como Productora de campo");
      expect(log[0].visible_to_viewer).toBe(false);
    });
  });

  it("invita a alguien que ya tiene cuenta: entra al equipo de inmediato, sin bienvenida vista", async () => {
    await scenario(async ({ admin, asUser }) => {
      const r = (await asUser(USERS.backend)(INVITE, [EVENT, "ajeno@mando.test", "Usuario ajeno", "Road manager", "producer", 3])).rows[0].r;
      expect(r.joined).toBe(true);
      const m = (await admin("select role, title, level, welcomed_at from event_members where event_id = $1 and profile_id = $2", [EVENT, USERS.outsider])).rows[0];
      expect(m).toMatchObject({ role: "producer", title: "Road manager", level: 3, welcomed_at: null });
    });
  });

  it("el productor de campo, el cliente y un ajeno no pueden invitar", async () => {
    await scenario(async ({ asUser }) => {
      for (const who of [USERS.producer, USERS.viewer, USERS.outsider]) {
        expect(await errorOf(asUser(who), INVITE, [EVENT, "x@ejemplo.com", "X", "Promotor", "producer", 4])).toMatch(/Solo el productor general/);
      }
      expect(await errorOf(asUser(USERS.backend), INVITE, [FOREIGN_EVENT, "x@ejemplo.com", "X", "Promotor", "producer", 4])).toMatch(/Solo el productor general/);
    });
  });

  it("rechaza correo inválido, cargo vacío, nivel que no corresponde y duplicados", async () => {
    await scenario(async ({ asUser }) => {
      const q = asUser(USERS.backend);
      expect(await errorOf(q, INVITE, [EVENT, "no-es-correo", "X", "Promotor", "producer", 4])).toMatch(/correo válido/);
      expect(await errorOf(q, INVITE, [EVENT, "x@ejemplo.com", "X", " ", "producer", 4])).toMatch(/cargo/);
      expect(await errorOf(q, INVITE, [EVENT, "x@ejemplo.com", "X", "Cliente", "viewer", 2])).toMatch(/no coincide con su nivel/);
      expect(await errorOf(q, INVITE, [EVENT, "x@ejemplo.com", "X", "Promotor", "producer", 1])).toMatch(/no coincide con su nivel/);
      expect(await errorOf(q, INVITE, [EVENT, "cliente@mando.test", "Cliente", "Cliente", "viewer", null])).toMatch(/ya es parte del equipo/);
      await q(INVITE, [EVENT, "x@ejemplo.com", "X", "Promotor", "producer", 4]);
      expect(await errorOf(q, INVITE, [EVENT, "X@ejemplo.com", "X", "Promotor", "producer", 4])).toMatch(/ya tiene una invitación/);
    });
  });

  it("las invitaciones solo las ve el productor general, y nadie las escribe a mano", async () => {
    await scenario(async ({ asUser, anon }) => {
      await asUser(USERS.backend)(INVITE, [EVENT, "x@ejemplo.com", "X", "Promotor", "producer", 4]);
      expect((await asUser(USERS.backend)("select 1 from invitations where event_id = $1", [EVENT])).rowCount).toBe(1);
      for (const who of [USERS.producer, USERS.viewer, USERS.outsider]) {
        expect((await asUser(who)("select 1 from invitations")).rowCount).toBe(0);
      }
      expect((await anon("select 1 from invitations")).rowCount).toBe(0);
      expect(
        await errorOf(asUser(USERS.backend), "insert into invitations (event_id, email, full_name, role, title, level) values ($1, 'z@ejemplo.com', 'Z', 'backend', 'Jefe', 1)", [EVENT]),
      ).toMatch(/row-level security/);
      expect((await asUser(USERS.backend)("update invitations set role = 'backend', level = 1")).rowCount).toBe(0);
      expect((await asUser(USERS.backend)("delete from invitations")).rowCount).toBe(0);
    });
  });

  it("retirar una invitación pendiente la anula; una aceptada ya no se puede retirar", async () => {
    await scenario(async ({ asUser }) => {
      const q = asUser(USERS.backend);
      const pending = (await q(INVITE, [EVENT, "x@ejemplo.com", "X", "Promotor", "producer", 4])).rows[0].r.invitation_id;
      expect(await errorOf(asUser(USERS.producer), "select public.revoke_invitation($1)", [pending])).toMatch(/Solo el productor general/);
      await q("select public.revoke_invitation($1)", [pending]);
      expect((await q("select public.invitation_pending('x@ejemplo.com') as p")).rows[0].p).toBe(false);
      await q(INVITE, [EVENT, "x@ejemplo.com", "X", "Promotor", "producer", 4]); // se puede volver a invitar
      const joined = (await q(INVITE, [EVENT, "ajeno@mando.test", "Ajeno", "Promotor", "producer", 4])).rows[0].r.invitation_id;
      expect(await errorOf(q, "select public.revoke_invitation($1)", [joined])).toMatch(/ya fue aceptada/);
    });
  });
});

describe("Activar el mando con el código", () => {
  it("sin sesión solo se puede preguntar si un correo tiene invitación pendiente", async () => {
    await scenario(async ({ asUser, anon }) => {
      await asUser(USERS.backend)(INVITE, [EVENT, "tati@ejemplo.com", "Tatiana Ríos", "Productora de campo", "producer", 2]);
      expect((await anon("select public.invitation_pending(' TATI@ejemplo.com ') as p")).rows[0].p).toBe(true);
      expect((await anon("select public.invitation_pending('nadie@ejemplo.com') as p")).rows[0].p).toBe(false);
      expect(await errorOf(anon, "select public.claim_invitations()")).toMatch(/permission denied/);
    });
  });

  it("al entrar, la persona se une con su cargo, toma su nombre de la invitación y la bitácora lo anota", async () => {
    await scenario(async ({ admin, asUser }) => {
      await asUser(USERS.backend)(INVITE, [EVENT, "tati@ejemplo.com", "Tatiana Ríos", "Productora de campo", "producer", 2]);
      await admin("insert into auth.users (id, email) values ($1, 'tati@ejemplo.com')", [NEW_USER]); // crea el perfil «tati»
      expect((await admin("select full_name from profiles where id = $1", [NEW_USER])).rows[0].full_name).toBe("tati");

      expect((await asUser(NEW_USER)("select public.claim_invitations() as n")).rows[0].n).toBe(1);
      const m = (await admin("select role, title, level, welcomed_at, invited_by from event_members where event_id = $1 and profile_id = $2", [EVENT, NEW_USER])).rows[0];
      expect(m).toMatchObject({ role: "producer", title: "Productora de campo", level: 2, welcomed_at: null, invited_by: USERS.backend });
      expect((await admin("select full_name from profiles where id = $1", [NEW_USER])).rows[0].full_name).toBe("Tatiana Ríos");
      expect((await admin("select summary from log_entries where event_id = $1 and kind = 'member_joined'", [EVENT])).rows[0].summary).toBe(
        "Tatiana Ríos activó su mando como Productora de campo.",
      );
      // Ya ve el evento, y repetir no duplica nada.
      expect((await asUser(NEW_USER)("select 1 from events where id = $1", [EVENT])).rowCount).toBe(1);
      expect((await asUser(NEW_USER)("select public.claim_invitations() as n")).rows[0].n).toBe(0);
      expect((await admin("select public.invitation_pending('tati@ejemplo.com') as p")).rows[0].p).toBe(false);
    });
  });

  it("nadie se une con la invitación de otro correo, ni con una retirada", async () => {
    await scenario(async ({ admin, asUser }) => {
      const q = asUser(USERS.backend);
      await q(INVITE, [EVENT, "tati@ejemplo.com", "Tatiana Ríos", "Productora de campo", "producer", 2]);
      expect((await asUser(USERS.outsider)("select public.claim_invitations() as n")).rows[0].n).toBe(0);
      expect((await admin("select 1 from event_members where event_id = $1 and profile_id = $2", [EVENT, USERS.outsider])).rowCount).toBe(0);

      const inv = (await admin("select id from invitations where email = 'tati@ejemplo.com'")).rows[0].id;
      await q("select public.revoke_invitation($1)", [inv]);
      await admin("insert into auth.users (id, email) values ($1, 'tati@ejemplo.com')", [NEW_USER]);
      expect((await asUser(NEW_USER)("select public.claim_invitations() as n")).rows[0].n).toBe(0);
      expect((await asUser(NEW_USER)("select 1 from events where id = $1", [EVENT])).rowCount).toBe(0);
    });
  });

  it("la bienvenida se marca una sola vez y solo la propia", async () => {
    await scenario(async ({ admin, asUser }) => {
      await asUser(USERS.backend)(INVITE, [EVENT, "ajeno@mando.test", "Usuario ajeno", "Road manager", "producer", 3]);
      await asUser(USERS.outsider)("select public.mark_welcomed($1)", [EVENT]);
      const first = (await admin("select welcomed_at from event_members where event_id = $1 and profile_id = $2", [EVENT, USERS.outsider])).rows[0].welcomed_at;
      expect(first).not.toBeNull();
      await asUser(USERS.outsider)("select public.mark_welcomed($1)", [EVENT]);
      const again = (await admin("select welcomed_at from event_members where event_id = $1 and profile_id = $2", [EVENT, USERS.outsider])).rows[0].welcomed_at;
      expect(again).toEqual(first);
      expect(await errorOf(asUser(USERS.viewer), "select public.mark_welcomed($1)", [FOREIGN_EVENT])).toMatch(/No eres parte/);
    });
  });
});
