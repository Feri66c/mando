// Etapa 1 · Operar un evento: funciones del servidor, reglas de criticidad y permisos de lo nuevo.
// Cada prueba corre dentro de una transacción que se deshace al final: el seed queda intacto.
//
// Se corre con `npm run test:db`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const EVENT = "00000000-0000-0000-0000-0000000000e1";
const FOREIGN_EVENT = "00000000-0000-0000-0000-000000009905";
const ITEM = {
  montaje: "00000000-0000-0000-0000-0000000000d1",
  sonido: "00000000-0000-0000-0000-0000000000d2",
  puertas: "00000000-0000-0000-0000-0000000000d3",
  show: "00000000-0000-0000-0000-0000000000d4",
  desmontaje: "00000000-0000-0000-0000-0000000000d5",
};
const MOMENT = "00000000-0000-0000-0000-0000000000f1";
const USERS = {
  producer: "00000000-0000-0000-0000-0000000000a1",
  backend: "00000000-0000-0000-0000-0000000000a2",
  viewer: "00000000-0000-0000-0000-0000000000a3",
  outsider: "00000000-0000-0000-0000-000000009903",
} as const;
const SHA = "a".repeat(64);

type Q = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

let db: pg.Client;

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});

/** Abre una transacción que se deshace al final. `admin` corre sin restricciones (preparar datos). */
async function scenario<T>(fn: (s: { admin: Q; asUser: (userId: string) => Promise<Q> }) => Promise<T>): Promise<T> {
  await db.query("begin");
  const admin: Q = async (sql, params) => {
    await db.query("reset role");
    return db.query(sql, params);
  };
  const asUser = async (userId: string): Promise<Q> => async (sql, params) => {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    // Si falla, la transacción queda abortada: quien llamó deshace hasta su savepoint (y con eso, el rol).
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

/** Ejecuta y devuelve el mensaje de error de la base (o null si funcionó). */
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

const one = async (q: Q, sql: string, params?: unknown[]) => (await q(sql, params)).rows[0];

describe("Hoja de ruta viva: pedir, ver la vista previa y confirmar", () => {
  it("la vista previa no mueve nada; al confirmar se aplica y queda en la bitácora", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      const preview = (await one(producer, `select public.request_change($1, 'extend', 60) as r`, [ITEM.sonido])).r;
      expect(preview.affected).toHaveLength(1); // hay 2 h 30 de holgura antes de la apertura: no arrastra
      expect(preview.affected[0]).toMatchObject({ item_id: ITEM.sonido, is_target: true });

      const before = await one(admin, `select current_end from route_items where id = $1`, [ITEM.sonido]);
      expect(new Date(before.current_end).toISOString()).toBe("2026-12-12T21:00:00.000Z"); // 16:00 Lima

      await producer(`select public.confirm_change($1)`, [preview.request_id]);
      const after = await one(admin, `select current_end, planned_end from route_items where id = $1`, [ITEM.sonido]);
      expect(new Date(after.current_end).toISOString()).toBe("2026-12-12T22:00:00.000Z"); // 17:00 Lima
      expect(new Date(after.planned_end).toISOString()).toBe("2026-12-12T21:00:00.000Z"); // el plan publicado no cambia

      // Aceptación 1: el cliente ve el cambio y su entrada de bitácora.
      const viewer = await asUser(USERS.viewer);
      const seen = await one(viewer, `select current_end from route_items where id = $1`, [ITEM.sonido]);
      expect(new Date(seen.current_end).toISOString()).toBe("2026-12-12T22:00:00.000Z");
      const log = await one(viewer, `select summary from log_entries where kind = 'change_applied' order by id desc limit 1`);
      expect(log.summary).toContain("«Prueba de sonido»: 14:00 – 16:00 → 14:00 – 17:00");
    });
  });

  it("un retraso grande arrastra en cascada, conserva duraciones y levanta las alertas", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      const preview = (await one(producer, `select public.request_change($1, 'move', 180) as r`, [ITEM.sonido])).r;
      // Sonido 17:00–19:00 empuja Puertas a 19:00–20:30, Show a 20:30–23:30 y Desmontaje a 23:30–01:00 (no se mueve: ya empieza 23:30).
      const ids = preview.affected.map((a: { item_id: string }) => a.item_id);
      expect(ids).toEqual([ITEM.sonido, ITEM.puertas, ITEM.show]);
      const unchanged = await one(admin, `select current_start from route_items where id = $1`, [ITEM.puertas]);
      expect(new Date(unchanged.current_start).toISOString()).toBe("2026-12-12T23:30:00.000Z");

      await producer(`select public.confirm_change($1)`, [preview.request_id]);
      const rows = (await admin(`select id, current_start, current_end, status from route_items where id = any($1) order by current_start`, [
        [ITEM.puertas, ITEM.show],
      ])).rows;
      expect(rows.map((r) => [new Date(r.current_start).toISOString(), new Date(r.current_end).toISOString(), r.status])).toEqual([
        ["2026-12-13T00:00:00.000Z", "2026-12-13T01:30:00.000Z", "moved"],
        ["2026-12-13T01:30:00.000Z", "2026-12-13T04:30:00.000Z", "moved"],
      ]);

      const alerts = (await admin(`select rule_key, level, visible_to_viewer from alerts where rule_key is not null order by level, rule_key`)).rows;
      expect(alerts).toEqual([
        { rule_key: "retraso_con_arrastre", level: 3, visible_to_viewer: false },
        { rule_key: "hito_comprometido", level: 4, visible_to_viewer: true },
        { rule_key: "hito_comprometido", level: 4, visible_to_viewer: true },
      ]);
    });
  });

  it("aceptación 4: mover un hito 30 minutos levanta una Red Flag que el cliente ve", async () => {
    await scenario(async ({ asUser }) => {
      const producer = await asUser(USERS.producer);
      const preview = (await one(producer, `select public.request_change($1, 'move', 30) as r`, [ITEM.puertas])).r;
      await producer(`select public.confirm_change($1)`, [preview.request_id]);
      const viewer = await asUser(USERS.viewer);
      const titles = (await viewer(`select title, level from alerts where rule_key = 'hito_comprometido' order by title`)).rows;
      expect(titles).toEqual([
        { title: "El hito «Apertura de puertas» se aleja del plan", level: 4 },
        { title: "El hito «Show central» se aleja del plan", level: 4 },
      ]);
      const log = (await viewer(`select summary from log_entries where kind = 'alert_raised'`)).rows.map((r) => r.summary);
      expect(log).toContain("Red Flag: El hito «Apertura de puertas» se aleja del plan");
    });
  });

  it("la misma situación no repite la alerta", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      for (let i = 0; i < 2; i++) {
        const p = (await one(producer, `select public.request_change($1, 'move', 30) as r`, [ITEM.puertas])).r;
        await producer(`select public.confirm_change($1)`, [p.request_id]);
      }
      const n = await one(admin, `select count(*)::int as n from alerts where rule_key = 'hito_comprometido' and entity_id = $1`, [ITEM.puertas]);
      expect(n.n).toBe(1);
    });
  });

  it("un cambio no se confirma dos veces ni lo confirma otro productor", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      const p = (await one(producer, `select public.request_change($1, 'extend', 15) as r`, [ITEM.sonido])).r;
      await admin(`insert into event_members (event_id, profile_id, role) values ($1, $2, 'producer')`, [EVENT, USERS.outsider]);
      const other = await asUser(USERS.outsider);
      expect(await errorOf(other, `select public.confirm_change($1)`, [p.request_id])).toMatch(/Solo quien pidió el cambio/);
      await producer(`select public.confirm_change($1)`, [p.request_id]);
      expect(await errorOf(producer, `select public.confirm_change($1)`, [p.request_id])).toMatch(/ya se aplicó/);
    });
  });

  it("el cliente y los ajenos no pueden pedir ni confirmar cambios", async () => {
    await scenario(async ({ asUser }) => {
      for (const id of [USERS.viewer, USERS.outsider]) {
        const q = await asUser(id);
        expect(await errorOf(q, `select public.request_change($1, 'extend', 60)`, [ITEM.sonido])).toMatch(/No tienes permiso/);
        expect(await errorOf(q, `select public.mark_item($1, 'start')`, [ITEM.sonido])).toMatch(/No tienes permiso/);
      }
    });
  });

  it("un evento cerrado no acepta cambios", async () => {
    await scenario(async ({ admin, asUser }) => {
      await admin(`update events set status = 'closed' where id = $1`, [EVENT]);
      const producer = await asUser(USERS.producer);
      expect(await errorOf(producer, `select public.request_change($1, 'extend', 60)`, [ITEM.sonido])).toMatch(/cerrado/);
    });
  });
});

describe("Modo En Vivo: Empezó y Terminó", () => {
  it("marca la hora real del servidor, la anota y abre el momento crítico de la actividad", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      await producer(`select public.mark_item($1, 'start')`, [ITEM.sonido]);
      const started = await one(admin, `select status, actual_start, now() as server_now from route_items where id = $1`, [ITEM.sonido]);
      expect(started.status).toBe("in_progress");
      expect(new Date(started.actual_start).getTime()).toBe(new Date(started.server_now).getTime());
      expect((await one(admin, `select status from critical_moments where id = $1`, [MOMENT])).status).toBe("open");

      await producer(`select public.mark_item($1, 'finish')`, [ITEM.sonido]);
      expect((await one(admin, `select status from route_items where id = $1`, [ITEM.sonido])).status).toBe("done");
      expect(await errorOf(producer, `select public.mark_item($1, 'start')`, [ITEM.sonido])).toMatch(/ya empezó/);

      const viewer = await asUser(USERS.viewer);
      const log = (await viewer(`select summary from log_entries where kind = 'status_changed' order by id`)).rows.map((r) => r.summary);
      expect(log[0]).toMatch(/^Empezó «Prueba de sonido» a las \d\d:\d\d/);
      expect(log[1]).toMatch(/^Terminó «Prueba de sonido»/);
      // La apertura del momento crítico es interna: el cliente no la ve.
      expect((await viewer(`select count(*)::int as n from log_entries where kind = 'moment_opened'`)).rows[0].n).toBe(0);
    });
  });

  it("una actividad terminada ya no se mueve ni se arrastra", async () => {
    await scenario(async ({ asUser }) => {
      const producer = await asUser(USERS.producer);
      await producer(`select public.mark_item($1, 'finish')`, [ITEM.puertas]);
      expect(await errorOf(producer, `select public.request_change($1, 'move', 30)`, [ITEM.puertas])).toMatch(/ya terminó/);
      const p = (await one(producer, `select public.request_change($1, 'move', 180) as r`, [ITEM.sonido])).r;
      // Puertas está lista: no se mueve, y la cascada se corta ahí.
      expect(p.affected.map((a: { item_id: string }) => a.item_id)).toEqual([ITEM.sonido]);
    });
  });
});

describe("Momentos críticos: prometido contra entregado", () => {
  it("aceptación 3: 24 canales contra 32 levanta Crítico para el equipo, no para el cliente", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      await producer(`select public.open_moment($1)`, [MOMENT]);
      const check = await one(admin, `select id from moment_checks where moment_id = $1 order by sort_order limit 1`, [MOMENT]);
      await producer(`select public.answer_check($1, 'La consola tiene menos canales')`, [check.id]);
      const consola = await one(admin, `select id from commitments where item_label = 'Consola'`);
      await producer(`select public.check_commitment($1, '24 canales', 'unmet')`, [consola.id]);

      const c = await one(admin, `select found, outcome, matches from commitments where id = $1`, [consola.id]);
      expect(c).toEqual({ found: "24 canales", outcome: "unmet", matches: false });
      const alert = await one(producer, `select level, title, detail, visible_to_viewer from alerts where rule_key = 'compromiso_no_coincide'`);
      expect(alert).toEqual({
        level: 3,
        title: "Consola no coincide con lo prometido",
        detail: "Prometido: 32 canales. Encontrado: 24 canales.",
        visible_to_viewer: false,
      });
      expect((await one(admin, `select level from critical_moments where id = $1`, [MOMENT])).level).toBe(3);

      const viewer = await asUser(USERS.viewer);
      expect((await one(viewer, `select count(*)::int as n from alerts where rule_key = 'compromiso_no_coincide'`)).n).toBe(0);
      const kinds = (await producer(`select kind from log_entries where kind in ('moment_opened','check_answered','commitment_checked','alert_raised') order by id`)).rows.map((r) => r.kind);
      expect(kinds).toEqual(["moment_opened", "check_answered", "commitment_checked", "alert_raised"]);
    });
  });

  it("parcial levanta Atención y cumplido resuelve la alerta", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      const monitores = await one(admin, `select id from commitments where item_label = 'Monitores de piso'`);
      await producer(`select public.check_commitment($1, '4 unidades', 'partial')`, [monitores.id]);
      expect((await one(admin, `select level, status from alerts where entity_id = $1`, [monitores.id]))).toEqual({ level: 2, status: "open" });
      await producer(`select public.check_commitment($1, '6 unidades', 'met')`, [monitores.id]);
      expect((await one(admin, `select status from alerts where entity_id = $1`, [monitores.id])).status).toBe("resolved");
    });
  });

  it("se crea un momento desde plantilla, se agrega un compromiso y se resuelve con nota", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      const id = (await one(producer, `select public.create_moment($1, $2, 'apertura_de_puertas', 'Apertura de puertas', $3) as id`, [
        EVENT, ITEM.puertas, ["¿Hay cola?", "¿Funcionan los lectores?"],
      ])).id;
      expect((await one(admin, `select count(*)::int as n from moment_checks where moment_id = $1`, [id])).n).toBe(2);
      await producer(`select public.add_commitment($1, 'Lectores QR', '4 lectores')`, [id]);
      expect(await errorOf(producer, `select public.resolve_moment($1, '')`, [id])).toMatch(/Cuenta cómo terminó/);
      await producer(`select public.resolve_moment($1, 'Todo en orden')`, [id]);
      expect((await one(admin, `select status, resolution from critical_moments where id = $1`, [id]))).toEqual({
        status: "resolved",
        resolution: "Todo en orden",
      });
    });
  });

  it("el cliente no puede abrir momentos ni marcar compromisos", async () => {
    await scenario(async ({ admin, asUser }) => {
      const viewer = await asUser(USERS.viewer);
      const consola = await one(admin, `select id from commitments where item_label = 'Consola'`);
      expect(await errorOf(viewer, `select public.open_moment($1)`, [MOMENT])).toMatch(/No tienes permiso/);
      expect(await errorOf(viewer, `select public.check_commitment($1, 'x', 'met')`, [consola.id])).toMatch(/No tienes permiso/);
      expect(await errorOf(viewer, `select public.create_moment($1, null, null, 'x', '{}')`, [EVENT])).toMatch(/No tienes permiso/);
    });
  });
});

describe("Evidencias", () => {
  it("se agregan con la hora del servidor y la del teléfono, y quedan en la bitácora", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      const id = (await one(producer,
        `select public.add_evidence($1, 'photo', $2, 'Escenario', $3, now() - interval '5 minutes', $4) as id`,
        [EVENT, `${EVENT}/foto.jpg`, SHA, ITEM.montaje])).id;
      const ev = await one(admin, `select captured_by, received_at, captured_at, now() as server_now, sha256 from evidences where id = $1`, [id]);
      expect(ev.captured_by).toBe(USERS.producer);
      expect(new Date(ev.received_at).getTime()).toBe(new Date(ev.server_now).getTime());
      expect(new Date(ev.server_now).getTime() - new Date(ev.captured_at).getTime()).toBe(5 * 60 * 1000);
      const viewer = await asUser(USERS.viewer);
      const log = await one(viewer, `select summary from log_entries where kind = 'evidence_added' and entity_id = $1`, [id]);
      expect(log.summary).toBe("Evidencia (foto) en «Montaje de escenario»: Escenario");
    });
  });

  it("rechaza archivos de otro evento, sin huella o de alguien sin permiso", async () => {
    await scenario(async ({ asUser }) => {
      const producer = await asUser(USERS.producer);
      expect(await errorOf(producer, `select public.add_evidence($1, 'photo', $2, null, $3)`, [EVENT, `${FOREIGN_EVENT}/x.jpg`, SHA])).toMatch(/no corresponde/);
      expect(await errorOf(producer, `select public.add_evidence($1, 'photo', $2, null, 'abc')`, [EVENT, `${EVENT}/x.jpg`])).toMatch(/huella/);
      expect(await errorOf(producer, `select public.add_evidence($1, 'note', null, '  ')`, [EVENT])).toMatch(/Escribe la nota/);
      const viewer = await asUser(USERS.viewer);
      expect(await errorOf(viewer, `select public.add_evidence($1, 'note', null, 'hola')`, [EVENT])).toMatch(/No tienes permiso/);
    });
  });

  it("una evidencia oculta no aparece al cliente, ni ella ni su entrada de bitácora", async () => {
    await scenario(async ({ asUser }) => {
      const producer = await asUser(USERS.producer);
      const id = (await one(producer, `select public.add_evidence($1, 'note', null, 'Nota interna', null, null, null, null, null, false) as id`, [EVENT])).id;
      const viewer = await asUser(USERS.viewer);
      expect((await one(viewer, `select count(*)::int as n from evidences where id = $1`, [id])).n).toBe(0);
      expect((await one(viewer, `select count(*)::int as n from log_entries where entity_id = $1`, [id])).n).toBe(0);
    });
  });
});

describe("Archivos de evidencia (Storage)", () => {
  const upload = (name: string) => `insert into storage.objects (bucket_id, name) values ('evidences', '${name}')`;

  it("el cubo existe y es privado", async () => {
    await scenario(async ({ admin }) => {
      expect(await one(admin, `select public, file_size_limit from storage.buckets where id = 'evidences'`)).toEqual({
        public: false,
        file_size_limit: "52428800",
      });
    });
  });

  it("solo el equipo sube archivos, y solo a la carpeta de su evento", async () => {
    await scenario(async ({ asUser }) => {
      const producer = await asUser(USERS.producer);
      expect(await errorOf(producer, upload(`${EVENT}/foto.jpg`))).toBeNull();
      expect(await errorOf(producer, upload(`${FOREIGN_EVENT}/foto.jpg`))).toMatch(/row-level security/);
      expect(await errorOf(producer, upload(`foto.jpg`))).toMatch(/row-level security/);
      for (const id of [USERS.viewer, USERS.outsider]) {
        expect(await errorOf(await asUser(id), upload(`${EVENT}/otra.jpg`))).toMatch(/row-level security/);
      }
    });
  });

  it("el cliente solo ve los archivos de evidencias visibles; nadie los cambia ni los borra", async () => {
    await scenario(async ({ admin, asUser }) => {
      await admin(`insert into storage.objects (bucket_id, name) values ('evidences', $1), ('evidences', $2)`, [
        `${EVENT}/visible.jpg`, `${EVENT}/oculta.jpg`,
      ]);
      const producer = await asUser(USERS.producer);
      await producer(`select public.add_evidence($1, 'photo', $2, null, $3, null, null, null, null, true)`, [EVENT, `${EVENT}/visible.jpg`, SHA]);
      await producer(`select public.add_evidence($1, 'photo', $2, null, $3, null, null, null, null, false)`, [EVENT, `${EVENT}/oculta.jpg`, SHA]);

      const viewer = await asUser(USERS.viewer);
      expect((await viewer(`select name from storage.objects where bucket_id = 'evidences'`)).rows).toEqual([{ name: `${EVENT}/visible.jpg` }]);
      expect((await producer(`select count(*)::int as n from storage.objects where bucket_id = 'evidences'`)).rows[0].n).toBe(2);
      const outsider = await asUser(USERS.outsider);
      expect((await outsider(`select count(*)::int as n from storage.objects`)).rows[0].n).toBe(0);

      expect((await producer(`update storage.objects set name = 'x' where bucket_id = 'evidences'`)).rowCount).toBe(0);
      expect((await producer(`delete from storage.objects where bucket_id = 'evidences'`)).rowCount).toBe(0);
    });
  });
});

describe("Alertas", () => {
  it("ciclo abierta → reconocida → resuelta, cada paso en la bitácora", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      const id = (await one(producer, `select public.raise_alert($1, 2, 'Falta un técnico de sala') as id`, [EVENT])).id;
      const backend = await asUser(USERS.backend);
      await backend(`select public.ack_alert($1)`, [id]);
      expect((await one(admin, `select status from alerts where id = $1`, [id])).status).toBe("acknowledged");
      // Sin evidencia no se levanta (decisión 94).
      expect(await errorOf(producer, `select public.resolve_alert($1, 'Llegó a las 15:10')`, [id])).toMatch(/adjunta una evidencia/);
      const note = await one(producer, `select public.add_evidence($1, 'note', null, 'el cliente dijo que sí', null, null, null, null, $2) as id`, [EVENT, id]);
      expect(note.id).toBeTruthy();
      expect(await errorOf(producer, `select public.resolve_alert($1, 'Llegó a las 15:10')`, [id])).toMatch(/adjunta una evidencia/);
      await producer(
        `select public.add_evidence($1, 'photo', $2, 'Captura del WhatsApp del cliente', $3, null, null, null, $4, false)`,
        [EVENT, `${EVENT}/captura-cliente.png`, "a".repeat(64), id],
      );
      await producer(`select public.resolve_alert($1, 'Llegó a las 15:10')`, [id]);
      const a = await one(admin, `select status, resolved_by from alerts where id = $1`, [id]);
      expect(a).toEqual({ status: "resolved", resolved_by: USERS.producer });
      const kinds = (await admin(`select kind from log_entries where entity_id = $1 order by id`, [id])).rows.map((r) => r.kind);
      expect(kinds).toEqual(["alert_raised", "alert_acknowledged", "alert_resolved"]);
      const last = await one(admin, `select summary, payload from log_entries where entity_id = $1 order by id desc limit 1`, [id]);
      expect(last.summary).toMatch(/^Levantada con evidencia: Falta un técnico de sala\. Llegó a las 15:10\. .+ responde por lo que informa\.$/);
      expect(last.payload).toMatchObject({ honor: true });
    });
  });

  it("el cliente no reconoce ni resuelve alertas, ni levanta alertas manuales", async () => {
    await scenario(async ({ admin, asUser }) => {
      const visible = await one(admin, `select id from alerts where visible_to_viewer limit 1`);
      const viewer = await asUser(USERS.viewer);
      expect(await errorOf(viewer, `select public.ack_alert($1)`, [visible.id])).toMatch(/No tienes permiso/);
      expect(await errorOf(viewer, `select public.resolve_alert($1)`, [visible.id])).toMatch(/No tienes permiso/);
      expect(await errorOf(viewer, `select public.raise_alert($1, 4, 'x')`, [EVENT])).toMatch(/No tienes permiso/);
    });
  });

  it("reglas por reloj: actividad retrasada; al empezar, la alerta se resuelve sola", async () => {
    await scenario(async ({ admin, asUser }) => {
      // Simula que el montaje debía empezar hace 20 minutos.
      await admin(`update route_items set current_start = now() - interval '20 minutes', current_end = now() + interval '4 hours' where id = $1`, [ITEM.montaje]);
      const producer = await asUser(USERS.producer);
      expect((await one(producer, `select public.evaluate_clock_rules($1) as n`, [EVENT])).n).toBeGreaterThanOrEqual(1);
      expect((await one(producer, `select public.evaluate_clock_rules($1) as n`, [EVENT])).n).toBe(0); // no repite
      const alert = await one(admin, `select id, level, status from alerts where rule_key = 'actividad_retrasada' and entity_id = $1`, [ITEM.montaje]);
      expect(alert).toMatchObject({ level: 2, status: "open" });
      await producer(`select public.mark_item($1, 'start')`, [ITEM.montaje]);
      expect((await one(admin, `select status from alerts where id = $1`, [alert.id])).status).toBe("resolved");
    });
  });

  it("reglas por reloj: permiso obligatorio sin aprobar cerca del evento", async () => {
    await scenario(async ({ admin, asUser }) => {
      await admin(`update events set starts_at = now() + interval '2 days' where id = $1`, [EVENT]);
      const producer = await asUser(USERS.producer);
      await producer(`select public.evaluate_clock_rules($1)`, [EVENT]);
      const a = await one(admin, `select level, title from alerts where rule_key = 'permiso_sin_aprobar'`);
      expect(a).toEqual({ level: 3, title: "«Licencia municipal de evento» todavía no está aprobado" });
    });
  });
});

describe("Las ayudas internas no se llaman desde la app", () => {
  it.each([
    ["_log", `select public._log($1, 'note', 'x', null, null, null, '{}', true, null)`],
    ["_raise_alert", `select public._raise_alert($1, 4, null, 'x', null, null, null, null)`],
    ["_require_team", `select public._require_team($1)`],
  ])("%s está cerrada para el equipo", async (_name, sql) => {
    await scenario(async ({ asUser }) => {
      expect(await errorOf(await asUser(USERS.backend), sql, [EVENT])).toMatch(/permission denied/);
    });
  });
});
