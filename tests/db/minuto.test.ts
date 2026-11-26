// Minuto a minuto, origen de los cambios, momentos wow, People Experience y brief largo (decisiones 65 a 69).
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


const ITEM = { sonido: "00000000-0000-0000-0000-0000000000d2", puertas: "00000000-0000-0000-0000-0000000000d3" };
const SHA = "a".repeat(64);
const TECH = "00000000-0000-0000-0000-0000000099c2"; // técnico, nivel 4, ve solo lo suyo
const one = async (q: Q, sql: string, params?: unknown[]) => (await q(sql, params)).rows[0];

/** Pide un cambio y lo confirma. Devuelve el id del pedido. */
async function applyChange(q: Q, item: string, minutes: number): Promise<string> {
  const preview = (await one(q, "select public.request_change($1, 'extend', $2) as r", [item, minutes])).r;
  await q("select public.confirm_change($1)", [preview.request_id]);
  return preview.request_id as string;
}

async function withTech(admin: Q, asUser: (id: string) => Q) {
  await admin("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'tecnico@mando.test', '{\"full_name\":\"Luis Técnico\"}')", [TECH]);
  await asUser(USERS.backend)(
    "select public.invite_to_event($1, $2, $3, $4, $5::event_role, $6::smallint, $7, $8, $9)",
    [EVENT, "tecnico@mando.test", "Luis Técnico", "Técnico de sonido", "producer", 4, null, USERS.producer, null],
  );
  return asUser(TECH);
}

describe("Origen de los cambios y versiones del minuto a minuto", () => {
  it("cada cambio aplicado guarda una versión nueva con su origen y lo anota en la bitácora", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const preview = (await one(producer, "select public.request_change($1, 'extend', 15) as r", [ITEM.sonido])).r;
      await producer("select public.set_change_origin($1, $2)", [preview.request_id, "cliente"]);
      // Pedir no crea versión: solo aplicar.
      expect((await admin("select count(*)::int as n from route_versions where event_id = $1", [EVENT])).rows[0].n).toBe(0);
      await producer("select public.confirm_change($1)", [preview.request_id]);

      const v = (await producer("select version, origin, change_request_id, jsonb_array_length(snapshot) as n from route_versions where event_id = $1", [EVENT])).rows;
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ version: 2, origin: "cliente", change_request_id: preview.request_id });
      expect(v[0].n).toBeGreaterThan(3);
      const log = await one(admin, "select summary, visible_to_viewer from log_entries where event_id = $1 and kind = 'route_version'", [EVENT]);
      expect(log.summary).toBe("Nuevo minuto a minuto: versión 2. Origen: pedido del cliente.");
      expect(log.visible_to_viewer).toBe(false);

      // El segundo cambio es la versión 3. Se puede clasificar después y la versión toma el origen.
      const second = await applyChange(producer, ITEM.sonido, 10);
      expect((await one(producer, "select origin from route_versions where version = 3 and event_id = $1", [EVENT])).origin).toBeNull();
      await asUser(USERS.backend)("select public.set_change_origin($1, $2)", [second, "eventualidad"]);
      expect((await one(producer, "select origin from route_versions where version = 3 and event_id = $1", [EVENT])).origin).toBe("eventualidad");
      expect((await one(producer, "select origin from change_requests where id = $1", [second])).origin).toBe("eventualidad");
    });
  });

  it("el origen lo marca quien pidió el cambio o producción, y solo con un valor válido", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const tech = await withTech(admin, asUser);
      const request = await applyChange(producer, ITEM.sonido, 15);
      expect(await errorOf(producer, "select public.set_change_origin($1, $2)", [request, "clima"])).toMatch(/Elige de dónde viene/);
      expect(await errorOf(producer, "select public.set_change_origin($1, $2)", [request, null])).toMatch(/Elige de dónde viene/);
      expect(await errorOf(tech, "select public.set_change_origin($1, $2)", [request, "cliente"])).toMatch(/quien pidió el cambio o producción/);
      expect(await errorOf(asUser(USERS.viewer), "select public.set_change_origin($1, $2)", [request, "cliente"])).toMatch(/No tienes permiso/);
      expect(await errorOf(asUser(USERS.outsider), "select public.set_change_origin($1, $2)", [request, "cliente"])).toMatch(/No tienes permiso/);
      expect((await one(admin, "select origin from change_requests where id = $1", [request])).origin).toBeNull();
    });
  });

  it("las versiones las lee quien ve todo el evento; nadie las escribe, edita ni borra", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const tech = await withTech(admin, asUser);
      await applyChange(producer, ITEM.sonido, 15);
      expect((await producer("select id from route_versions")).rows).toHaveLength(1);
      expect((await asUser(USERS.backend)("select id from route_versions")).rows).toHaveLength(1);
      for (const who of [tech, asUser(USERS.viewer), asUser(USERS.outsider)]) {
        expect((await who("select id from route_versions")).rows).toHaveLength(0);
      }
      // Sin política de escritura: la base rechaza la inserción y no toca ninguna fila al editar o borrar.
      expect(await errorOf(producer, "insert into route_versions (event_id, version, snapshot) values ($1, 9, '[]')", [EVENT])).toMatch(/row-level security/);
      expect((await producer("update route_versions set snapshot = '[]'")).rowCount).toBe(0);
      expect((await producer("delete from route_versions")).rowCount).toBe(0);
      // Ni siquiera con permisos totales se reescribe una versión.
      expect(await errorOf(admin, "update route_versions set snapshot = '[]' where event_id = $1", [EVENT])).toMatch(/no se editan ni se borran/);
      expect(await errorOf(admin, "delete from route_versions where event_id = $1", [EVENT])).toMatch(/no se editan ni se borran/);
    });
  });
});

describe("Momento wow y eventualidad", () => {
  it("el momento wow lo ve el cliente; la eventualidad se queda con el equipo", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const viewer = asUser(USERS.viewer);
      const wow = (await one(producer, "select public.mark_moment($1, 'wow', $2, $3, $4) as id", [EVENT, "Entrada del artista", `${EVENT}/wow.jpg`, SHA])).id;
      const bad = (await one(producer, "select public.mark_moment($1, 'eventualidad', $2) as id", [EVENT, "Se fue la luz dos minutos"])).id;

      const rows = (await admin("select id, tag, kind, visible_to_viewer from evidences where id = any($1) order by tag desc", [[wow, bad]])).rows;
      expect(rows).toEqual([
        { id: wow, tag: "wow", kind: "photo", visible_to_viewer: true },
        { id: bad, tag: "eventualidad", kind: "note", visible_to_viewer: false },
      ]);
      expect((await viewer("select id from evidences where tag is not null")).rows.map((r) => r.id)).toEqual([wow]);
      expect((await asUser(USERS.outsider)("select id from evidences where tag is not null")).rows).toHaveLength(0);

      const logs = (await admin("select summary, level, visible_to_viewer from log_entries where event_id = $1 and kind = 'moment_marked' order by id", [EVENT])).rows;
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({ level: null, visible_to_viewer: true });
      expect(logs[0].summary).toContain("un momento wow: Entrada del artista");
      expect(logs[1]).toMatchObject({ level: 2, visible_to_viewer: false });
      expect(logs[1].summary).toContain("una eventualidad: Se fue la luz dos minutos");
    });
  });

  it("pide lo mínimo y solo lo marca el equipo", async () => {
    await scenario(async ({ asUser }) => {
      const producer = asUser(USERS.producer);
      expect(await errorOf(producer, "select public.mark_moment($1, 'otro', 'x')", [EVENT])).toMatch(/Elige momento wow o eventualidad/);
      expect(await errorOf(producer, "select public.mark_moment($1, 'eventualidad', '  ')", [EVENT])).toMatch(/qué pasó/);
      expect(await errorOf(producer, "select public.mark_moment($1, 'wow')", [EVENT])).toMatch(/Toma la foto/);
      expect(await errorOf(producer, "select public.mark_moment($1, 'wow', $2)", [EVENT, "x".repeat(501)])).toMatch(/muy larga/);
      expect(await errorOf(asUser(USERS.viewer), "select public.mark_moment($1, 'wow', 'hola')", [EVENT])).toMatch(/No tienes permiso/);
      expect(await errorOf(asUser(USERS.outsider), "select public.mark_moment($1, 'wow', 'hola')", [EVENT])).toMatch(/No tienes permiso/);
    });
  });
});

describe("People Experience", () => {
  it("cuenta lo que pasó en el evento, sin nombres", async () => {
    await scenario(async ({ asUser }) => {
      const producer = asUser(USERS.producer);
      const first = await applyChange(producer, ITEM.sonido, 15);
      await producer("select public.set_change_origin($1, 'cliente')", [first]);
      await applyChange(producer, ITEM.sonido, 10);
      await producer("select public.mark_moment($1, 'wow', 'Entrada del artista')", [EVENT]);
      await producer("select public.mark_moment($1, 'eventualidad', 'Se fue la luz')", [EVENT]);

      const x = (await one(producer, "select public.people_experience($1) as r", [EVENT])).r;
      expect(x.changes).toEqual({ cliente: 1, sin_clasificar: 1 });
      expect(x).toMatchObject({ versions: 3, wow: 1, eventualidades: 1 });
      expect(x.items_total).toBeGreaterThan(3);
      expect(x.mandos).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(x)).not.toMatch(/mando\.test|Técnico/);
      // El productor general lo ve igual.
      expect((await one(asUser(USERS.backend), "select public.people_experience($1) as r", [EVENT])).r.versions).toBe(3);
    });
  });

  it("no lo ven los submandos, el cliente ni los ajenos", async () => {
    await scenario(async ({ admin, asUser }) => {
      const tech = await withTech(admin, asUser);
      for (const who of [tech, asUser(USERS.viewer), asUser(USERS.outsider)]) {
        expect(await errorOf(who, "select public.people_experience($1)", [EVENT])).toMatch(/productor general o el productor de campo/);
      }
    });
  });
});

describe("Brief largo, con sinopsis y documento", () => {
  it("acepta hasta 10 000 letras, guarda la sinopsis y conserva el documento al corregir", async () => {
    await scenario(async ({ asUser }) => {
      const backend = asUser(USERS.backend);
      const doc = `${EVENT}/brief/brief.pdf`;
      expect(await errorOf(backend, "select public.set_brief($1, $2)", [EVENT, "x".repeat(10001)])).toMatch(/10 000 letras/);
      expect(await errorOf(backend, "select public.set_brief($1, $2, null, null, $3)", [EVENT, "Brief.", "s".repeat(601)])).toMatch(/sinopsis pasa de 600/);
      expect(await errorOf(backend, "select public.set_brief($1, $2, null, null, null, $3, 'x.pdf')", [EVENT, "Brief.", `${ORG}/brief/x.pdf`])).toMatch(/no pertenece a este evento/);
      expect(await errorOf(asUser(USERS.producer), "select public.set_brief($1, $2, null, null, 'Sinopsis')", [EVENT, "Brief."])).toMatch(/lo carga el backend/);

      await backend("select public.set_brief($1, $2, null, null, $3, $4, $5)", [EVENT, "x".repeat(10000), "Convención anual de ventas.", doc, "Brief del cliente.pdf"]);
      await backend("select public.set_brief($1, $2, null, null, $3)", [EVENT, "Brief corregido.", "Convención anual."]);
      const row = await one(asUser(USERS.producer), "select version, synopsis, document_path, document_name from event_briefs where event_id = $1", [EVENT]);
      expect(row).toEqual({ version: 2, synopsis: "Convención anual.", document_path: doc, document_name: "Brief del cliente.pdf" });
    });
  });

  it("el documento del brief lo lee el equipo; el cliente y los ajenos no", async () => {
    await scenario(async ({ admin, asUser }) => {
      const doc = `${EVENT}/brief/brief.pdf`;
      const tech = await withTech(admin, asUser);
      await asUser(USERS.backend)("select public.set_brief($1, $2, null, null, null, $3, 'brief.pdf')", [EVENT, "Brief.", doc]);
      const can = async (q: Q, name: string) => (await one(q, "select public.can_read_brief_file($1) as ok", [name])).ok;
      expect(await can(asUser(USERS.producer), doc)).toBe(true);
      expect(await can(tech, doc)).toBe(true);
      expect(await can(asUser(USERS.viewer), doc)).toBe(false);
      expect(await can(asUser(USERS.outsider), doc)).toBe(false);
      // Solo el documento vigente del brief, no cualquier archivo de esa carpeta ni de otra.
      expect(await can(asUser(USERS.producer), `${EVENT}/brief/otro.pdf`)).toBe(false);
      expect(await can(asUser(USERS.producer), `${EVENT}/presupuesto/brief.pdf`)).toBe(false);
      expect(await can(asUser(USERS.producer), "brief/brief.pdf")).toBe(false);
    });
  });
});
