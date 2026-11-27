// Cadena de mando (decisiones 59 a 64): submandos por área, qué ve cada persona, marcas y modalidad,
// cambios de emergencia y lista de ingreso. Cada prueba corre en una transacción que se deshace al final.
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

const COORD = "00000000-0000-0000-0000-0000000099c1"; // coordinadora de sonido, nivel 3
const TECH = "00000000-0000-0000-0000-0000000099c2"; // técnico, nivel 4
const AREA_SONIDO = "00000000-0000-0000-0000-0000000000b2";
const ITEM = { montaje: "00000000-0000-0000-0000-0000000000d1", sonido: "00000000-0000-0000-0000-0000000000d2", puertas: "00000000-0000-0000-0000-0000000000d3" };
const INVITE = "select public.invite_to_event($1, $2, $3, $4, $5::event_role, $6::smallint, $7, $8, $9) as r";
const COMMAND = "select public.set_member_command($1, $2, $3, $4, $5)";
const member = async (q: Q, id: string) =>
  (await q("select area_id, reports_to, visibility, level from event_members where event_id = $1 and profile_id = $2", [EVENT, id])).rows[0];
const count = async (q: Q, table: string) => Number((await q(`select count(*) as n from ${table} where event_id = $1`, [EVENT])).rows[0].n);

/** Crea las dos cuentas y las suma al equipo: la coordinadora ve su área (Sonido) y el técnico solo lo suyo. */
async function withSubmandos(admin: Q, asUser: (id: string) => Q) {
  await admin("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'sonido@mando.test', '{\"full_name\":\"Tatiana Sonido\"}'), ($2, 'tecnico@mando.test', '{\"full_name\":\"Luis Técnico\"}')", [COORD, TECH]);
  const backend = asUser(USERS.backend);
  await backend(INVITE, [EVENT, "sonido@mando.test", "Tatiana Sonido", "Jefa de sonido", "producer", 3, "sonido", USERS.producer, null]);
  await backend(INVITE, [EVENT, "tecnico@mando.test", "Luis Técnico", "Técnico de sonido", "producer", 4, null, COORD, null]);
  return { backend, producer: asUser(USERS.producer), coord: asUser(COORD), tech: asUser(TECH), viewer: asUser(USERS.viewer) };
}

describe("Cadena de mando", () => {
  it("al invitar, cada quien queda con su área, su mando y lo que ve", async () => {
    await scenario(async ({ admin, asUser }) => {
      const { backend, producer } = await withSubmandos(admin, asUser);
      // «sonido» encuentra el área que ya existía: no crea otra.
      expect(await member(backend, COORD)).toMatchObject({ area_id: AREA_SONIDO, reports_to: USERS.producer, visibility: "area", level: 3 });
      expect(await member(backend, TECH)).toMatchObject({ area_id: null, reports_to: COORD, visibility: "propia", level: 4 });
      expect(Number((await admin("select count(*) as n from areas where event_id = $1", [EVENT])).rows[0].n)).toBe(3);

      // El productor de campo suma a su submando: queda bajo su mando. Un área nueva se crea sola.
      await admin("insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000099c3', 'luces@mando.test', '{\"full_name\":\"Ana Luces\"}')");
      await producer(INVITE, [EVENT, "luces@mando.test", "Ana Luces", "Luminotécnica", "producer", 3, "Luces", null, null]);
      const luces = await member(backend, "00000000-0000-0000-0000-0000000099c3");
      expect(luces).toMatchObject({ reports_to: USERS.producer, visibility: "area" });
      expect((await admin("select name from areas where id = $1", [luces.area_id])).rows[0].name).toBe("Luces");

      // Coordinación sin área todavía: ve solo lo suyo hasta que le den una.
      await admin("insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000099c4', 'sinarea@mando.test', '{\"full_name\":\"Sin Área\"}')");
      await backend(INVITE, [EVENT, "sinarea@mando.test", "Sin Área", "Coordinador", "producer", 3, null, null, null]);
      expect((await member(backend, "00000000-0000-0000-0000-0000000099c4")).visibility).toBe("propia");

      // Quien todavía no tiene cuenta: la invitación guarda su mando y lo recibe al entrar.
      await backend(INVITE, [EVENT, "nueva@mando.test", "Nueva Persona", "Asistente", "producer", 4, "Sonido", COORD, "area"]);
      await admin("insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000099c5', 'nueva@mando.test', '{\"full_name\":\"nueva\"}')");
      await asUser("00000000-0000-0000-0000-0000000099c5")("select public.claim_invitations()");
      expect(await member(backend, "00000000-0000-0000-0000-0000000099c5")).toMatchObject({ area_id: AREA_SONIDO, reports_to: COORD, visibility: "area" });
    });
  });

  it("el submando ve su área y nada del resto: ni presupuesto, ni casting, ni citados", async () => {
    await scenario(async ({ admin, asUser }) => {
      const { backend, producer, coord, tech } = await withSubmandos(admin, asUser);
      await backend("select public.set_budget($1, 85000, true)", [EVENT]);
      await backend("select public.add_budget_line($1, 'Sonido', 1, 12000, null)", [EVENT]);
      await producer("select public.add_approval_item($1, 'casting', 'Mayra', null, null, null, '{}'::jsonb)", [EVENT]);
      await producer("select public.add_guest($1, 'Host', 'Host', now() + interval '1 day', '999111222', null)", [EVENT]);
      await backend("select public.send_client_notice($1, 'observation', 'Falta el permiso')", [EVENT]);

      const items = async (q: Q) => (await q("select id from route_items where event_id = $1", [EVENT])).rows.map((r) => r.id);
      // La coordinadora de sonido: su actividad y los dos hitos del evento. No ve montaje ni desmontaje.
      const hers = await items(coord);
      expect(hers).toContain(ITEM.sonido);
      expect(hers).toContain(ITEM.puertas);
      expect(hers).not.toContain(ITEM.montaje);
      expect(hers).toHaveLength(3);
      // El técnico, sin nada a su cargo: solo los hitos.
      expect(await items(tech)).toHaveLength(2);
      // El productor de campo sigue viendo todo.
      expect((await items(producer)).length).toBeGreaterThanOrEqual(5);

      for (const q of [coord, tech]) {
        for (const table of ["event_budgets", "event_budget_lines", "event_approvals", "event_guests", "client_notices", "event_requirements", "change_requests"]) {
          expect(await count(q, table), table).toBe(0);
        }
        expect(await errorOf(q, "select * from public.talent_bank($1)", [EVENT])).toMatch(/productor general o el productor de campo/);
        expect(await errorOf(q, "select * from public.access_list($1)", [EVENT])).toMatch(/lista de ingreso/);
        expect((await q("select public.can_read_evidence_file($1) as ok", [`${EVENT}/expediente/contrato.pdf`])).rows[0].ok).toBe(false);
        expect((await q("select public.can_read_approval_file($1) as ok", [`${EVENT}/aprobaciones/mayra.jpg`])).rows[0].ok).toBe(false);
      }
      expect(await count(producer, "event_budgets")).toBe(1);
      expect(await count(producer, "event_approvals")).toBe(1);
      expect((await producer("select public.can_read_evidence_file($1) as ok", [`${EVENT}/expediente/contrato.pdf`])).rows[0].ok).toBe(true);

      // La bitácora del submando: lo suyo y lo de sus actividades. No lee los montos ni los avisos al cliente.
      const log = (await coord("select summary from log_entries where event_id = $1", [EVENT])).rows.map((r) => r.summary).join(" | ");
      expect(log).not.toMatch(/presupuesto|informó al cliente/i);
      expect(Number((await producer("select count(*) as n from log_entries where event_id = $1", [EVENT])).rows[0].n)).toBeGreaterThan(
        Number((await coord("select count(*) as n from log_entries where event_id = $1", [EVENT])).rows[0].n),
      );

      // Nadie cambia su propio alcance escribiendo directo en la tabla.
      expect((await coord("update event_members set visibility = 'completa' where event_id = $1 and profile_id = $2", [EVENT, COORD])).rowCount).toBe(0);
    });
  });

  it("el submando solo opera las actividades de su mando", async () => {
    await scenario(async ({ admin, asUser }) => {
      const { producer, coord, tech } = await withSubmandos(admin, asUser);
      await admin("update events set status = 'live' where id = $1", [EVENT]);
      await admin("update event_approvals set status = 'approved' where event_id = $1", [EVENT]);
      const START = "select public.mark_item($1, 'start')";
      const blocked = await errorOf(coord, START, [ITEM.montaje]);
      expect(blocked).toMatch(/no es de tu mando/);
      expect(await errorOf(tech, START, [ITEM.sonido])).toMatch(/no es de tu mando/);
      // La de su área sí la opera, y quien ve todo opera cualquiera.
      expect(await errorOf(coord, START, [ITEM.sonido])).toBeNull();
      expect(await errorOf(producer, START, [ITEM.montaje])).toBeNull();
    });
  });

  it("la cadena la arma el backend, o el productor de campo para sus submandos", async () => {
    await scenario(async ({ admin, asUser }) => {
      const { backend, producer, coord, tech, viewer } = await withSubmandos(admin, asUser);
      // Ni el submando ni el cliente mueven la cadena.
      expect(await errorOf(coord, COMMAND, [EVENT, TECH, "Sonido", COORD, "completa"])).toMatch(/la arma el backend/);
      expect(await errorOf(viewer, COMMAND, [EVENT, TECH, "Sonido", COORD, "completa"])).toMatch(/No tienes permiso/);
      // El productor de campo no se cambia a sí mismo ni al backend.
      expect(await errorOf(producer, COMMAND, [EVENT, USERS.producer, null, null, "completa"])).toMatch(/la arma el backend/);
      expect(await errorOf(producer, COMMAND, [EVENT, USERS.backend, null, null, "completa"])).toMatch(/la arma el backend/);
      expect(await errorOf(backend, COMMAND, [EVENT, USERS.backend, null, null, "propia"])).toMatch(/siempre ve todo/);
      expect(await errorOf(backend, COMMAND, [EVENT, USERS.viewer, null, null, "completa"])).toMatch(/no es del equipo/);
      // Un productor (nivel 2) siempre ve todo: lo dice la función y lo sostiene la tabla.
      expect(await errorOf(backend, COMMAND, [EVENT, USERS.producer, "Sonido", null, "area"])).toMatch(/Un productor ve todo el evento/);
      expect(await errorOf(backend, INVITE, [EVENT, "par@mando.test", "Par", "Productor de campo", "producer", 2, "Sonido", null, "propia"])).toMatch(/Un productor ve todo el evento/);
      expect(await errorOf(admin, "update event_members set visibility = 'propia' where event_id = $1 and profile_id = $2", [EVENT, USERS.producer])).toMatch(/event_members_visibility_level/);
      // Reglas de la cadena: el mando tiene más jerarquía, y no se cierra un círculo.
      expect(await errorOf(backend, COMMAND, [EVENT, COORD, "Sonido", TECH, "area"])).toMatch(/igual o mayor jerarquía/);
      expect(await errorOf(backend, COMMAND, [EVENT, COORD, "Sonido", COORD, "area"])).toMatch(/igual o mayor jerarquía/);
      expect(await errorOf(backend, COMMAND, [EVENT, COORD, "Sonido", USERS.viewer, "area"])).toMatch(/igual o mayor jerarquía/);
      expect(await errorOf(backend, COMMAND, [EVENT, TECH, null, COORD, "area"])).toMatch(/primero dile cuál es su área/);
      expect(await errorOf(backend, COMMAND, [EVENT, TECH, "Sonido", COORD, "todo"])).toMatch(/qué ve esta persona/);

      // El productor de campo le da su área al técnico. Desde ese momento ve la prueba de sonido.
      await producer(COMMAND, [EVENT, TECH, "Sonido", COORD, "area"]);
      expect(await member(backend, TECH)).toMatchObject({ area_id: AREA_SONIDO, visibility: "area" });
      expect((await tech("select id from route_items where id = $1", [ITEM.sonido])).rowCount).toBe(1);
      // Y el backend le abre todo el evento a la coordinadora. Sigue sin ver montos: es nivel 3.
      await backend(COMMAND, [EVENT, COORD, "Sonido", USERS.producer, "completa"]);
      expect((await coord("select id from route_items where event_id = $1", [EVENT])).rowCount).toBeGreaterThanOrEqual(5);
      await backend("select public.set_budget($1, 85000, false)", [EVENT]);
      expect(await count(coord, "event_budgets")).toBe(0);
      // Queda en la bitácora.
      expect((await backend("select count(*) as n from log_entries where event_id = $1 and kind = 'command_set'", [EVENT])).rows[0].n).toBe("2");
    });
  });

  it("cada mando sabe a cuántos tiene conectados", async () => {
    await scenario(async ({ admin, asUser }) => {
      const { backend, coord, tech, viewer } = await withSubmandos(admin, asUser);
      const chain = async (q: Q) => (await q("select * from public.command_chain($1)", [EVENT])).rows;
      const all = await chain(backend);
      expect(all).toHaveLength(4);
      expect(all.find((m) => m.profile_id === USERS.producer)).toMatchObject({ subordinates: 1 });
      expect(all.find((m) => m.profile_id === COORD)).toMatchObject({ subordinates: 1, area_name: "Sonido", reports_to_name: "Productor de ejemplo", visibility: "area" });
      // La coordinadora ve su fila, a su mando y a su técnico. El técnico, su fila y a su mando.
      expect((await chain(coord)).map((m) => m.profile_id).sort()).toEqual([USERS.producer, COORD, TECH].sort());
      expect((await chain(tech)).map((m) => m.profile_id).sort()).toEqual([COORD, TECH].sort());
      expect(await chain(viewer)).toHaveLength(0);
      expect(await chain(asUser(USERS.outsider))).toHaveLength(0);
    });
  });
});

describe("Marcas y modalidad del evento", () => {
  const BRAND = "select public.add_event_brand($1, $2, $3, $4) as id";
  it("el backend carga las marcas; todos los del evento las ven", async () => {
    await scenario(async ({ admin, asUser }) => {
      const { backend, producer, coord, viewer } = await withSubmandos(admin, asUser);
      const logo = `${EVENT}/marcas/sodimac.png`;
      expect(await errorOf(producer, BRAND, [EVENT, "cliente", "Sodimac", null])).toMatch(/las carga el backend/);
      expect(await errorOf(viewer, BRAND, [EVENT, "cliente", "Sodimac", null])).toMatch(/No tienes permiso/);
      expect(await errorOf(backend, BRAND, [EVENT, "patrocinador", "Sodimac", null])).toMatch(/cliente, de la agencia o de la productora/);
      expect(await errorOf(backend, BRAND, [EVENT, "cliente", "  ", null])).toMatch(/nombre de la marca/);
      expect(await errorOf(backend, BRAND, [EVENT, "cliente", "Sodimac", "otro-evento/marcas/x.png"])).toMatch(/no pertenece a este evento/);

      const id = (await backend(BRAND, [EVENT, "cliente", "Sodimac", null])).rows[0].id;
      // La misma marca otra vez no se duplica: se le suma el logo.
      expect((await backend(BRAND, [EVENT, "cliente", "  sodimac ", logo])).rows[0].id).toBe(id);
      await backend(BRAND, [EVENT, "agencia", "Circus", null]);
      for (const q of [producer, coord, viewer]) expect(await count(q, "event_brands")).toBe(2);
      expect(await count(asUser(USERS.outsider), "event_brands")).toBe(0);
      expect((await viewer("select file_path from event_brands where id = $1", [id])).rows[0].file_path).toBe(logo);

      // Nadie escribe directo en la tabla.
      expect((await producer("delete from event_brands where event_id = $1", [EVENT])).rowCount).toBe(0);
      expect(await errorOf(producer, "insert into event_brands (event_id, kind, name) values ($1, 'cliente', 'Falsa')", [EVENT])).toMatch(/row-level security/);

      // Los logos: los sube solo el backend, en imagen; los lee todo miembro del evento.
      const can = async (q: Q, fn: string, name: string) => (await q(`select public.${fn}($1) as ok`, [name])).rows[0].ok;
      expect(await can(backend, "can_upload_brand_file", logo)).toBe(true);
      expect(await can(backend, "can_upload_brand_file", `${EVENT}/marcas/logo.svg`)).toBe(false);
      expect(await can(producer, "can_upload_brand_file", logo)).toBe(false);
      expect(await can(producer, "can_upload_evidence_file", logo)).toBe(false);
      expect(await can(viewer, "can_read_brand_file", logo)).toBe(true);
      expect(await can(coord, "can_read_brand_file", logo)).toBe(true);
      expect(await can(asUser(USERS.outsider), "can_read_brand_file", logo)).toBe(false);

      expect(await errorOf(producer, "select public.remove_event_brand($1)", [id])).toMatch(/las carga el backend/);
      await backend("select public.remove_event_brand($1)", [id]);
      expect(await count(viewer, "event_brands")).toBe(1);
    });
  });

  it("el evento se marca como directo, de agencia o tercerizado", async () => {
    await scenario(async ({ asUser }) => {
      const backend = asUser(USERS.backend);
      const SET = "select public.set_event_modality($1, $2, $3)";
      expect(await errorOf(asUser(USERS.producer), SET, [EVENT, "tercerizado", "Circus"])).toMatch(/la define el backend/);
      expect(await errorOf(backend, SET, [EVENT, "subcontrato", null])).toMatch(/modalidad/);
      await backend(SET, [EVENT, "tercerizado", " Circus "]);
      const read = async () => (await asUser(USERS.viewer)("select modality, agency_name from events where id = $1", [EVENT])).rows[0];
      expect(await read()).toEqual({ modality: "tercerizado", agency_name: "Circus" });
      await backend(SET, [EVENT, "directo", "Circus"]);
      expect(await read()).toEqual({ modality: "directo", agency_name: null });
    });
  });
});

describe("Cambios de emergencia", () => {
  const REPORT = "select public.report_emergency_change($1, $2, $3, $4) as r";
  it("el servidor decide la ventana: con tiempo, 48 h, 24 h o último minuto", async () => {
    await scenario(async ({ admin, asUser }) => {
      const { producer, coord, tech, viewer } = await withSubmandos(admin, asUser);
      const at = async (hours: number) => {
        await admin("update events set starts_at = now() + make_interval(mins => $2) where id = $1", [EVENT, Math.round(hours * 60)]);
        return (await producer(REPORT, [EVENT, "persona", `Cambio a ${hours} h`, null])).rows[0].r.window;
      };
      expect(await at(100)).toBe("con_tiempo");
      expect(await at(30)).toBe("48h");
      expect(await at(10)).toBe("24h");
      expect(await at(1)).toBe("ultimo_minuto");
      expect(await at(-3)).toBe("ultimo_minuto"); // con el evento ya en marcha

      // Con tiempo no hay alerta; las otras tres sí, cada vez más alta.
      const alerts = (await producer("select level from alerts where event_id = $1 and entity_type = 'emergency_change' order by raised_at", [EVENT])).rows.map((r) => r.level);
      expect(alerts).toEqual([1, 2, 3, 3]);
      expect((await producer("select count(*) as n from log_entries where event_id = $1 and kind = 'emergency_change'", [EVENT])).rows[0].n).toBe("5");

      // Coordinación reporta; técnicos y cliente, no.
      expect(await errorOf(coord, REPORT, [EVENT, "proveedor", "Se cayó el proveedor de sonido", "Entra el backup"])).toBeNull();
      expect(await errorOf(tech, REPORT, [EVENT, "persona", "x", null])).toMatch(/producción o coordinación/);
      expect(await errorOf(viewer, REPORT, [EVENT, "persona", "x", null])).toMatch(/No tienes permiso/);
      expect(await errorOf(producer, REPORT, [EVENT, "clima", "x", null])).toMatch(/qué cambia/);
      expect(await errorOf(producer, REPORT, [EVENT, "persona", "  ", null])).toMatch(/qué cambia/);

      // Quien ve todo, los ve todos; la coordinadora, el suyo; el cliente, ninguno.
      expect(await count(producer, "emergency_changes")).toBe(6);
      expect(await count(coord, "emergency_changes")).toBe(1);
      expect(await count(viewer, "emergency_changes")).toBe(0);

      // No se editan ni se borran, ni siquiera desde adentro.
      expect((await producer("update emergency_changes set title = 'otro' where event_id = $1", [EVENT])).rowCount).toBe(0);
      expect(await errorOf(admin, "update emergency_changes set title = 'otro' where event_id = $1", [EVENT])).toMatch(/no se editan ni se borran/);
      expect(await errorOf(admin, "delete from emergency_changes where event_id = $1", [EVENT])).toMatch(/no se editan ni se borran/);
    });
  });
});

describe("Lista de ingreso y responsable", () => {
  it("la lista de ingreso sale con documento y cargo, solo para producción", async () => {
    await scenario(async ({ admin, asUser }) => {
      const { producer, backend, viewer } = await withSubmandos(admin, asUser);
      const SAVE = "select public.save_person($1, null, $2, $3, null, null, $4, null, null, $5) as id";
      const a = (await producer(SAVE, [EVENT, "Mayra Quispe", "70123456", "Anfitriona", "dni"])).rows[0].id;
      const b = (await producer(SAVE, [EVENT, "Carlos Ruiz", "X1234567", "Camarógrafo", "pasaporte"])).rows[0].id;
      await producer("select public.assign_person($1, $2, $3)", [EVENT, a, null]);
      await producer("select public.assign_person($1, $2, $3)", [EVENT, b, null]);
      const list = (await backend("select * from public.access_list($1)", [EVENT])).rows;
      expect(list.map((r) => [r.full_name, r.doc_type, r.doc_number, r.role])).toEqual([
        ["Mayra Quispe", "dni", "70123456", "Anfitriona"],
        ["Carlos Ruiz", "pasaporte", "X1234567", "Camarógrafo"],
      ]);
      expect(await errorOf(viewer, "select * from public.access_list($1)", [EVENT])).toMatch(/lista de ingreso/);
      expect(await errorOf(asUser(USERS.outsider), "select * from public.access_list($1)", [EVENT])).toMatch(/lista de ingreso/);
    });
  });

  it("el responsable de un documento es quien lo sube, y el submando ve el que le toca", async () => {
    await scenario(async ({ admin, asUser }) => {
      const { producer, backend, coord } = await withSubmandos(admin, asUser);
      const free = (await backend("select public.add_requirement($1, 'Rider firmado', 'proveedores', null, false) as id", [EVENT])).rows[0].id;
      const hers = (await backend("select public.add_requirement($1, 'Plan de sonido', 'proveedores', null, false) as id", [EVENT])).rows[0].id;
      await backend("select public.plan_requirement($1, $2, null)", [hers, COORD]);
      // A la coordinadora le asignaron uno: ve ese y ningún otro.
      expect((await coord("select id from event_requirements where event_id = $1", [EVENT])).rows.map((r) => r.id)).toEqual([hers]);
      // El que nadie tenía asignado queda a nombre de quien lo sube.
      await producer("select public.complete_requirement($1, null, null, null, 'Entregado en mano', true)", [free]);
      expect((await backend("select owner_id from event_requirements where id = $1", [free])).rows[0].owner_id).toBe(USERS.producer);
      // El asignado solo lo sube su responsable: la línea legal no se quiebra (decisión 76).
      await db.query("savepoint linea");
      await expect(producer("select public.complete_requirement($1, null, null, null, 'Lo subí por ella', true)", [hers])).rejects.toThrow(/Solo esa persona lo sube/);
      await db.query("rollback to savepoint linea");
      await coord("select public.complete_requirement($1, null, null, null, 'Plan entregado', true)", [hers]);
      expect((await backend("select owner_id, status from event_requirements where id = $1", [hers])).rows[0]).toEqual({ owner_id: COORD, status: "done" });
    });
  });
});
