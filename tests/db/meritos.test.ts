// Méritos y cierre: no negociables e hitos estrella por evento, valoración del equipo, números para las
// estrellas y cierre del evento. Cada prueba corre en una transacción que se deshace al final.
//
// Se corre con `npm run test:db`.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { scoreEvent } from "@mando/core/merits";

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
const SAMPLING = JSON.stringify(config.tipos.find((t: { clave: string }) => t.clave === "sampling"));

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

const criteria = async (q: Q, kind: string, event = EVENT) =>
  (await q("select id, title, status, note from event_criteria where event_id = $1 and kind = $2 order by sort_order", [event, kind])).rows;
const MARK = "select public.mark_criterion($1, $2, $3)";
const inputs = async (q: Q, event = EVENT) => (await q("select public.event_score_inputs($1) as r", [event])).rows[0].r;

describe("Criterios del evento", () => {
  it("un evento nuevo nace con los no negociables y los hitos estrella de su tipo", async () => {
    await scenario(async ({ admin, asUser }) => {
      const id = (
        await asUser(USERS.backend)(
          "select public.create_event_from_template($1, 'Sampling', null, null, 'America/Lima', '2026-12-06T15:00:00Z', $2::jsonb, '{}'::jsonb) as id",
          [ORG, SAMPLING],
        )
      ).rows[0].id;
      const rows = (await admin("select kind, title, status from event_criteria where event_id = $1 order by kind desc, sort_order", [id])).rows;
      expect(rows.filter((r) => r.kind === "no_negociable").map((r) => r.title)).toEqual([
        "Permiso del punto (tienda, calle o centro comercial)",
        "Producto en buen estado y con stock suficiente",
        "Hora de inicio prometida al cliente",
      ]);
      expect(rows.filter((r) => r.kind === "hito_estrella")).toHaveLength(3);
      expect(rows.every((r) => r.status === "pending")).toBe(true);
    });
  });

  it("todo miembro los ve; un ajeno no; y nadie los escribe directo", async () => {
    await scenario(async ({ asUser }) => {
      for (const who of [USERS.producer, USERS.backend, USERS.viewer]) {
        expect(await criteria(asUser(who), "no_negociable")).toHaveLength(3);
      }
      expect(await criteria(asUser(USERS.outsider), "no_negociable")).toHaveLength(0);
      const [first] = await criteria(asUser(USERS.backend), "no_negociable");
      for (const who of [USERS.producer, USERS.backend, USERS.viewer]) {
        const q = asUser(who);
        expect((await q("update event_criteria set status = 'ok' where id = $1", [first.id])).rowCount).toBe(0);
        expect((await q("delete from event_criteria where id = $1", [first.id])).rowCount).toBe(0);
        expect(await errorOf(q, "insert into event_criteria (event_id, kind, title) values ($1, 'no_negociable', 'x')", [EVENT])).toMatch(
          /row-level security/,
        );
      }
    });
  });

  it("los marcan los niveles 1 y 2; el cliente, un técnico y un ajeno no", async () => {
    await scenario(async ({ admin, asUser }) => {
      const [a, b] = await criteria(admin, "no_negociable");
      await asUser(USERS.backend)(MARK, [a.id, true, null]);
      await asUser(USERS.producer)(MARK, [b.id, true, "Aforo contado en puerta"]);
      expect((await criteria(admin, "no_negociable")).map((r) => r.status)).toEqual(["ok", "ok", "pending"]);

      expect(await errorOf(asUser(USERS.viewer), MARK, [a.id, false, "x"])).toMatch(/No tienes permiso/);
      expect(await errorOf(asUser(USERS.outsider), MARK, [a.id, false, "x"])).toMatch(/No tienes permiso/);
      await admin("update event_members set level = 4, title = 'Técnico' where event_id = $1 and profile_id = $2", [EVENT, USERS.producer]);
      expect(await errorOf(asUser(USERS.producer), MARK, [a.id, false, "x"])).toMatch(/productor general o el productor de campo/);
    });
  });

  it("un no negociable fallado pide explicación, levanta una Red Flag que el cliente ve y queda en la bitácora", async () => {
    await scenario(async ({ admin, asUser }) => {
      const [a] = await criteria(admin, "no_negociable");
      const producer = asUser(USERS.producer);
      expect(await errorOf(producer, MARK, [a.id, false, "  "])).toMatch(/necesita una explicación/);
      await producer(MARK, [a.id, false, "El grupo electrógeno no llegó"]);

      const alert = (await admin("select level, status, title, detail, visible_to_viewer from alerts where rule_key = 'no_negociable_fallado' and entity_id = $1", [a.id])).rows;
      expect(alert).toHaveLength(1);
      expect(alert[0]).toMatchObject({ level: 4, status: "open", visible_to_viewer: true, detail: "El grupo electrógeno no llegó" });
      const seen = (await asUser(USERS.viewer)("select title from alerts where rule_key = 'no_negociable_fallado'")).rows;
      expect(seen).toHaveLength(1);

      const log = (await admin("select summary, level, visible_to_viewer from log_entries where kind = 'criterion_checked' and entity_id = $1", [a.id])).rows;
      expect(log).toHaveLength(1);
      expect(log[0].summary).toContain("FALLADO");
      expect(log[0]).toMatchObject({ level: 4, visible_to_viewer: true });

      // Marcarlo otra vez igual no duplica nada; corregirlo a cumplido resuelve la alerta.
      await producer(MARK, [a.id, false, "El grupo electrógeno no llegó"]);
      expect((await admin("select count(*)::int as n from log_entries where kind = 'criterion_checked' and entity_id = $1", [a.id])).rows[0].n).toBe(1);
      await asUser(USERS.backend)(MARK, [a.id, true, "Llegó un equipo de reemplazo"]);
      expect((await admin("select status from alerts where rule_key = 'no_negociable_fallado' and entity_id = $1", [a.id])).rows[0].status).toBe("resolved");
    });
  });

  it("un hito estrella no logrado no levanta alerta y el cliente no lo lee en la bitácora", async () => {
    await scenario(async ({ admin, asUser }) => {
      const [a, b] = await criteria(admin, "hito_estrella");
      await asUser(USERS.producer)(MARK, [a.id, false, null]);
      await asUser(USERS.producer)(MARK, [b.id, true, null]);
      expect((await admin("select count(*)::int as n from alerts where entity_type = 'criterion'")).rows[0].n).toBe(0);
      const seen = (await asUser(USERS.viewer)("select summary from log_entries where kind = 'criterion_checked'")).rows;
      expect(seen).toHaveLength(1);
      expect(seen[0].summary).toContain("logrado");
    });
  });
});

describe("Valoración de la producción", () => {
  const RATE = "select public.rate_production($1, $2, $3)";
  it("valora el equipo de campo, una vez por persona; ni el productor general ni el cliente", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      await producer(RATE, [EVENT, 4, "Buen ritmo"]);
      await producer(RATE, [EVENT, 5, null]);
      const rows = (await admin("select stars, comment from event_ratings where event_id = $1", [EVENT])).rows;
      expect(rows).toEqual([{ stars: 5, comment: null }]);
      expect(await errorOf(producer, RATE, [EVENT, 6, null])).toMatch(/de 1 a 5/);
      expect(await errorOf(asUser(USERS.backend), RATE, [EVENT, 5, null])).toMatch(/equipo de campo/);
      expect(await errorOf(asUser(USERS.viewer), RATE, [EVENT, 5, null])).toMatch(/No tienes permiso/);
      expect(await errorOf(producer, RATE, [FOREIGN_EVENT, 5, null])).toMatch(/No tienes permiso/);
    });
  });

  it("cada quien ve la suya, el productor general ve todas y el cliente ninguna; nadie escribe directo", async () => {
    await scenario(async ({ asUser }) => {
      await asUser(USERS.producer)(RATE, [EVENT, 4, "Buen ritmo"]);
      expect((await asUser(USERS.producer)("select stars from event_ratings")).rows).toHaveLength(1);
      expect((await asUser(USERS.backend)("select stars from event_ratings")).rows).toHaveLength(1);
      expect((await asUser(USERS.viewer)("select stars from event_ratings")).rows).toHaveLength(0);
      expect((await asUser(USERS.producer)("update event_ratings set stars = 1")).rowCount).toBe(0);
      expect(await errorOf(asUser(USERS.viewer), "insert into event_ratings (event_id, profile_id, stars) values ($1, $2, 5)", [EVENT, USERS.viewer])).toMatch(
        /row-level security/,
      );
      // En la bitácora queda que valoró, pero no cuánto, y el cliente no lo ve.
      expect((await asUser(USERS.viewer)("select 1 from log_entries where kind = 'production_rated'")).rows).toHaveLength(0);
    });
  });
});

describe("Números para las estrellas", () => {
  it("el cliente y el equipo reciben los mismos números; un ajeno, ninguno", async () => {
    await scenario(async ({ admin, asUser }) => {
      await admin("update route_items set actual_start = planned_start + interval '4 minutes', status = 'in_progress' where id = $1", [SOUND]);
      await asUser(USERS.producer)("select public.rate_production($1, 4, null)", [EVENT]);
      const team = await inputs(asUser(USERS.producer));
      const client = await inputs(asUser(USERS.viewer));
      expect(client).toEqual(team);
      expect(team.started).toBe(true);
      expect(team.mandatories).toEqual({ ok: 0, failed: 0, pending: 3 });
      expect(team.rating).toEqual({ average: 4, count: 1 });
      expect(team.items).toContainEqual({ is_milestone: false, start_delay_min: 4 });
      expect(JSON.stringify(team)).not.toContain("Prueba de sonido"); // solo números, sin títulos
      expect(await errorOf(asUser(USERS.outsider), "select public.event_score_inputs($1)", [EVENT])).toMatch(/No tienes permiso/);
    });
  });

  it("con esos números, un no negociable fallado deja el evento en 0 estrellas", async () => {
    await scenario(async ({ admin, asUser }) => {
      await admin("update route_items set actual_start = planned_start, status = 'in_progress' where id = $1", [SOUND]);
      const before = scoreEvent(await inputs(asUser(USERS.viewer)));
      expect(before.locked).toBe(false);
      const [a] = await criteria(admin, "no_negociable");
      await asUser(USERS.producer)(MARK, [a.id, false, "Sin energía de respaldo"]);
      const after = scoreEvent(await inputs(asUser(USERS.viewer)));
      expect(after.locked).toBe(true);
      expect(after.stars).toBe(0);
      expect(after.redFlags).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("Cierre del evento", () => {
  const CLOSE = "select public.close_event($1)";
  it("solo cierra el productor general, y solo con los no negociables marcados", async () => {
    await scenario(async ({ admin, asUser }) => {
      for (const who of [USERS.producer, USERS.viewer, USERS.outsider]) {
        expect(await errorOf(asUser(who), CLOSE, [EVENT])).toMatch(/Solo el productor general/);
      }
      const backend = asUser(USERS.backend);
      expect(await errorOf(backend, CLOSE, [EVENT])).toMatch(/marca los no negociables que faltan \(3\)/);
      for (const c of await criteria(admin, "no_negociable")) await backend(MARK, [c.id, true, null]);
      await backend(CLOSE, [EVENT]);

      const event = (await admin("select status, closed_at, closed_by from events where id = $1", [EVENT])).rows[0];
      expect(event.status).toBe("closed");
      expect(event.closed_by).toBe(USERS.backend);
      expect(event.closed_at).not.toBeNull();
      expect((await asUser(USERS.viewer)("select summary from log_entries where kind = 'event_closed'")).rows).toHaveLength(1);
      expect(await errorOf(backend, CLOSE, [EVENT])).toMatch(/ya está cerrado/);
    });
  });

  it("un evento cerrado ya no acepta marcas, pero el equipo todavía puede valorar", async () => {
    await scenario(async ({ admin, asUser }) => {
      const backend = asUser(USERS.backend);
      const list = await criteria(admin, "no_negociable");
      for (const c of list) await backend(MARK, [c.id, true, null]);
      await backend(CLOSE, [EVENT]);
      expect(await errorOf(backend, MARK, [list[0].id, false, "tarde"])).toMatch(/está cerrado/);
      expect(await errorOf(asUser(USERS.producer), "select public.mark_item($1, 'start')", [SOUND])).toMatch(/está cerrado/);
      await asUser(USERS.producer)("select public.rate_production($1, 5, 'Gran equipo')", [EVENT]);
      expect((await inputs(asUser(USERS.viewer))).rating).toEqual({ average: 5, count: 1 });
    });
  });
});

describe("Citados (hosts e invitados)", () => {
  const ADD = "select public.add_guest($1, $2, $3, $4, $5, $6) as id";
  const UPDATE = "select public.update_guest($1, $2)";
  const soon = () => new Date(Date.now() - 20 * 60_000).toISOString(); // citado hace 20 minutos

  it("el equipo que coordina cita, recuerda y marca la llegada; todo queda en la bitácora", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      const id = (await producer(ADD, [EVENT, " Carla Vega ", "Host", soon(), "+51 999-888-777", "Carla@Ejemplo.com"])).rows[0].id;
      const guest = (await admin("select full_name, guest_role, phone, email from event_guests where id = $1", [id])).rows[0];
      expect(guest).toEqual({ full_name: "Carla Vega", guest_role: "Host", phone: "+51999888777", email: "carla@ejemplo.com" });

      await producer(UPDATE, [id, "reminded"]);
      await producer(UPDATE, [id, "arrived"]);
      await producer(UPDATE, [id, "arrived"]); // repetir no duplica
      const row = (await admin("select reminders, reminded_at, arrived_at from event_guests where id = $1", [id])).rows[0];
      expect(row.reminders).toBe(1);
      expect(row.arrived_at).not.toBeNull();
      const log = (await admin("select summary from log_entries where entity_type = 'guest' and entity_id = $1 order by id", [id])).rows.map((r) => r.summary);
      expect(log).toHaveLength(3);
      expect(log[2]).toBe("Carla Vega llegó 20 min después de su citación.");
      expect(await errorOf(producer, UPDATE, [id, "bailar"])).toMatch(/Acción desconocida/);
    });
  });

  it("el cliente y los ajenos no ven los datos de los citados ni pueden citarlos; un técnico tampoco los maneja", async () => {
    await scenario(async ({ admin, asUser }) => {
      const id = (await asUser(USERS.backend)(ADD, [EVENT, "Carla Vega", "Host", soon(), null, null])).rows[0].id;
      expect((await asUser(USERS.producer)("select 1 from event_guests")).rows).toHaveLength(1);
      for (const who of [USERS.viewer, USERS.outsider]) {
        const q = asUser(who);
        expect((await q("select 1 from event_guests")).rows).toHaveLength(0);
        expect(await errorOf(q, ADD, [EVENT, "X", "Invitado", soon(), null, null])).toMatch(/No tienes permiso/);
        expect(await errorOf(q, UPDATE, [id, "arrived"])).toMatch(/No tienes permiso/);
      }
      expect((await asUser(USERS.producer)("update event_guests set arrived_at = now()")).rowCount).toBe(0);
      await admin("update event_members set level = 4 where event_id = $1 and profile_id = $2", [EVENT, USERS.producer]);
      expect(await errorOf(asUser(USERS.producer), UPDATE, [id, "arrived"])).toMatch(/quien coordina/);
    });
  });

  it("la puntualidad de los citados cuenta para las estrellas, sin mostrar sus nombres al cliente", async () => {
    await scenario(async ({ asUser }) => {
      const backend = asUser(USERS.backend);
      const late = (await backend(ADD, [EVENT, "Carla Vega", "Host", soon(), null, null])).rows[0].id;
      await backend(ADD, [EVENT, "Luis Paz", "Invitado", new Date(Date.now() + 3_600_000).toISOString(), null, null]); // aún no le toca
      const gone = (await backend(ADD, [EVENT, "Retirado", "Invitado", soon(), null, null])).rows[0].id;
      await backend(UPDATE, [gone, "remove"]);
      await backend(UPDATE, [late, "arrived"]);
      const seen = await inputs(asUser(USERS.viewer));
      expect(seen.items).toContainEqual({ is_milestone: false, start_delay_min: 20 });
      expect(seen.summary).toMatchObject({ guests: 2, guests_on_time: 0 });
      expect(JSON.stringify(seen)).not.toContain("Carla");
    });
  });
});

describe("Enlace de publicación", () => {
  const SET = "select public.set_publish_url($1, $2)";
  it("lo registran los niveles 1 y 2, con un enlace https, y el cliente lo ve en la bitácora", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = asUser(USERS.producer);
      expect(await errorOf(producer, SET, [EVENT, "youtube.com/abc"])).toMatch(/https/);
      expect(await errorOf(producer, SET, [EVENT, "javascript:alert(1)"])).toMatch(/https/);
      await producer(SET, [EVENT, " https://youtu.be/abc123 "]);
      expect((await admin("select publish_url from events where id = $1", [EVENT])).rows[0].publish_url).toBe("https://youtu.be/abc123");
      expect((await asUser(USERS.viewer)("select summary from log_entries where kind = 'published'")).rows).toHaveLength(1);
      expect(await errorOf(asUser(USERS.viewer), SET, [EVENT, "https://youtu.be/x"])).toMatch(/No tienes permiso/);
      expect(await errorOf(asUser(USERS.outsider), SET, [EVENT, "https://youtu.be/x"])).toMatch(/No tienes permiso/);
    });
  });
});
