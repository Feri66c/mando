// Criterio de aceptación de la Fase 0 (docs/09-plan-de-construccion.md):
// tres usuarios de prueba ven solo el evento de ejemplo con su rol, y el viewer
// no puede leer filas ocultas ni escribir nada.
//
// Se corre con `npm run test:db` (levanta un PostgreSQL desechable).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const EVENT = "00000000-0000-0000-0000-0000000000e1";
const FOREIGN_EVENT = "00000000-0000-0000-0000-000000009905";
const USERS = {
  producer: "00000000-0000-0000-0000-0000000000a1",
  backend: "00000000-0000-0000-0000-0000000000a2",
  viewer: "00000000-0000-0000-0000-0000000000a3",
  otherViewer: "00000000-0000-0000-0000-000000009902",
  outsider: "00000000-0000-0000-0000-000000009903",
} as const;

let db: pg.Client;

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});

/** Corre `fn` como si fuera la app con la sesión de `userId` (o sin sesión), y deshace todo al final. */
async function as<T>(userId: string | null, fn: (q: pg.Client["query"]) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
    ]);
    return await fn(db.query.bind(db) as pg.Client["query"]);
  } finally {
    await db.query("rollback");
  }
}

/** Ejecuta una escritura y devuelve "denied" si la base la rechaza, o el número de filas afectadas. */
async function tryWrite(userId: string, sql: string, params: unknown[] = []): Promise<"denied" | number> {
  return as(userId, async (q) => {
    await db.query("savepoint w");
    try {
      const r = await q(sql, params);
      return r.rowCount ?? 0;
    } catch {
      await db.query("rollback to savepoint w");
      return "denied";
    }
  });
}

const count = (userId: string | null, table: string, where = "true") =>
  as(userId, async (q) => Number((await q(`select count(*)::int as n from ${table} where ${where}`)).rows[0].n));

describe("Mis eventos: cada usuario ve solo el evento de ejemplo, con su rol", () => {
  it.each([
    ["producer", USERS.producer],
    ["backend", USERS.backend],
    ["viewer", USERS.viewer],
  ])("%s ve un solo evento y su rol correcto", async (role, id) => {
    const rows = await as(id, async (q) =>
      (await q(`select e.id, public.my_event_role(e.id) as role from events e`)).rows,
    );
    expect(rows).toEqual([{ id: EVENT, role }]);
  });

  it("nadie de los tres ve el evento ajeno ni sus filas", async () => {
    for (const id of [USERS.producer, USERS.backend, USERS.viewer]) {
      expect(await count(id, "events", `id = '${FOREIGN_EVENT}'`)).toBe(0);
      expect(await count(id, "route_items", `event_id = '${FOREIGN_EVENT}'`)).toBe(0);
      expect(await count(id, "log_entries", `event_id = '${FOREIGN_EVENT}'`)).toBe(0);
    }
  });

  it("un usuario ajeno no ve nada del evento de ejemplo", async () => {
    expect(await count(USERS.outsider, "events", `id = '${EVENT}'`)).toBe(0);
    expect(await count(USERS.outsider, "route_items", `event_id = '${EVENT}'`)).toBe(0);
    expect(await count(USERS.outsider, "profiles", `id = '${USERS.producer}'`)).toBe(0);
  });

  it("sin sesión no se lee nada", async () => {
    for (const t of ["events", "route_items", "log_entries", "profiles", "organizations", "event_members"]) {
      expect(await count(null, t)).toBe(0);
    }
  });
});

describe("El viewer no lee filas ocultas", () => {
  it.each([
    ["route_items"],
    ["log_entries"],
    ["alerts"],
    ["evidences"],
    ["documents"],
  ])("%s: el viewer no recibe ninguna fila con visible_to_viewer = false", async (table) => {
    expect(await count(USERS.viewer, table, "visible_to_viewer = false")).toBe(0);
  });

  it("el productor sí ve esas filas ocultas", async () => {
    expect(await count(USERS.producer, "route_items", "visible_to_viewer = false")).toBe(1);
    expect(await count(USERS.producer, "log_entries", "visible_to_viewer = false")).toBe(1);
    expect(await count(USERS.producer, "alerts", "visible_to_viewer = false")).toBe(1);
    expect(await count(USERS.producer, "evidences", "visible_to_viewer = false")).toBe(1);
  });

  it("el viewer sí ve la hoja de ruta visible y la bitácora visible", async () => {
    expect(await count(USERS.viewer, "route_items")).toBe(5);
    expect(await count(USERS.viewer, "log_entries")).toBeGreaterThanOrEqual(2);
    expect(await count(USERS.viewer, "alerts")).toBe(1); // la de nivel 4 marcada visible
  });

  it.each([["critical_moments"], ["moment_checks"], ["commitments"], ["change_requests"], ["permits"], ["briefs"], ["providers"]])(
    "%s: es interno del equipo, el viewer no ve nada",
    async (table) => {
      expect(await count(USERS.viewer, table)).toBe(0);
    },
  );

  it("el viewer no ve a los otros clientes del evento", async () => {
    expect(await count(USERS.viewer, "event_members", "role = 'viewer'")).toBe(1); // solo él
    expect(await count(USERS.viewer, "profiles", `id = '${USERS.otherViewer}'`)).toBe(0);
    expect(await count(USERS.producer, "event_members", "role = 'viewer'")).toBe(2);
  });
});

describe("El viewer no puede escribir nada", () => {
  const writes: [string, string, unknown[]][] = [
    ["pedir un cambio", `insert into change_requests (event_id, kind, channel, delta_minutes, requested_by) values ($1, 'extend', 'tap', 60, $2)`, [EVENT, USERS.viewer]],
    ["crear actividad", `insert into route_items (event_id, title, planned_start, planned_end, current_start, current_end) values ($1, 'x', now(), now(), now(), now())`, [EVENT]],
    ["escribir en la bitácora", `insert into log_entries (event_id, kind, summary) values ($1, 'note', 'x')`, [EVENT]],
    ["subir evidencia", `insert into evidences (event_id, kind, note, captured_at, captured_by) values ($1, 'note', 'x', now(), $2)`, [EVENT, USERS.viewer]],
    ["levantar alerta", `insert into alerts (event_id, level, title) values ($1, 1, 'x')`, [EVENT]],
    ["invitarse como backend", `insert into event_members (event_id, profile_id, role) values ($1, $2, 'backend')`, [EVENT, USERS.outsider]],
    ["agregar brief", `insert into briefs (event_id, body, created_by) values ($1, 'x', $2)`, [EVENT, USERS.viewer]],
    ["crear momento crítico", `insert into critical_moments (event_id, title) values ($1, 'x')`, [EVENT]],
    ["vaciar la bitácora", `truncate log_entries`, []],
    ["vaciar la hoja de ruta", `truncate route_items cascade`, []],
  ];

  it.each(writes)("no puede %s", async (_label, sql, params) => {
    expect(await tryWrite(USERS.viewer, sql, params)).toBe("denied");
  });

  const silentWrites: [string, string, unknown[]][] = [
    ["cambiar el evento", `update events set name = 'hackeado' where id = $1`, [EVENT]],
    ["cambiar su rol", `update event_members set role = 'backend' where profile_id = $1`, [USERS.viewer]],
    ["mover una actividad", `update route_items set current_start = current_start + interval '1 hour' where event_id = $1`, [EVENT]],
    ["borrar actividades", `delete from route_items where event_id = $1`, [EVENT]],
    ["resolver una alerta", `update alerts set status = 'resolved' where event_id = $1`, [EVENT]],
    ["borrar evidencias", `delete from evidences where event_id = $1`, [EVENT]],
  ];

  it.each(silentWrites)("no puede %s (la base no toca ninguna fila)", async (_label, sql, params) => {
    const r = await tryWrite(USERS.viewer, sql, params);
    expect(r === "denied" || r === 0).toBe(true);
  });
});

describe("Reglas del equipo", () => {
  it("el productor puede pedir un cambio a su nombre, no a nombre de otro", async () => {
    const ok = `insert into change_requests (event_id, item_id, kind, channel, delta_minutes, requested_by) values ($1, '00000000-0000-0000-0000-0000000000d2', 'extend', 'tap', 60, $2)`;
    expect(await tryWrite(USERS.producer, ok, [EVENT, USERS.producer])).toBe(1);
    expect(await tryWrite(USERS.producer, ok, [EVENT, USERS.backend])).toBe("denied");
  });

  it("nadie mueve la hoja de ruta directo: los cambios van por change_requests", async () => {
    for (const id of [USERS.producer, USERS.backend]) {
      const r = await tryWrite(id, `update route_items set current_start = current_start + interval '1 hour' where event_id = $1`, [EVENT]);
      expect(r === "denied" || r === 0).toBe(true);
    }
  });

  it("nadie escribe la bitácora desde la app, ni siquiera el backend", async () => {
    expect(await tryWrite(USERS.backend, `insert into log_entries (event_id, kind, summary) values ($1, 'note', 'x')`, [EVENT])).toBe("denied");
  });

  it("la bitácora no se edita ni se borra, tampoco con permisos de administrador", async () => {
    await db.query("begin");
    try {
      await expect(db.query(`update log_entries set summary = 'cambiado' where event_id = $1`, [EVENT])).rejects.toThrow(
        /La bitácora no se edita ni se borra/,
      );
    } finally {
      await db.query("rollback");
    }
    await db.query("begin");
    try {
      await expect(db.query(`delete from log_entries where event_id = $1`, [EVENT])).rejects.toThrow(/no se edita ni se borra/);
    } finally {
      await db.query("rollback");
    }
  });

  it("la evidencia guarda la hora del servidor aunque el dispositivo mande otra", async () => {
    const row = await as(USERS.producer, async (q) => {
      const r = await q(
        `insert into evidences (event_id, kind, note, captured_at, received_at, captured_by)
         values ($1, 'note', 'prueba', now() - interval '2 hours', '2000-01-01', $2)
         returning received_at, now() as server_now`,
        [EVENT, USERS.producer],
      );
      return r.rows[0];
    });
    expect(new Date(row.received_at).getTime()).toBe(new Date(row.server_now).getTime());
  });

  it("solo el backend puede invitar personas al evento", async () => {
    const sql = `insert into event_members (event_id, profile_id, role) values ($1, $2, 'viewer')`;
    expect(await tryWrite(USERS.producer, sql, [EVENT, USERS.outsider])).toBe("denied");
    expect(await tryWrite(USERS.backend, sql, [EVENT, USERS.outsider])).toBe(1);
  });

  it("el evento de ejemplo trae la escala de criticidad de 4 niveles", async () => {
    const levels = await as(USERS.backend, async (q) =>
      (await q(`select jsonb_array_length(criticality_config->'niveles') as n from events where id = $1`, [EVENT])).rows[0].n,
    );
    expect(levels).toBe(4);
  });
});
