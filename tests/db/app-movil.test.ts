// Etapa 2 · App móvil: cola sin señal sin duplicados, teléfonos para avisos, avisos por nivel y reglas de reloj
// en el servidor. Cada prueba corre dentro de una transacción que se deshace al final: el seed queda intacto.
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


const PHONE = { producer: "ExponentPushToken[produc-1]", backend: "ExponentPushToken[torre-1]", viewer: "ExponentPushToken[client-1]" };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("Cola sin señal: lo que llega dos veces se guarda una sola vez", () => {
  it("Empezó con hora del teléfono: guarda esa hora y también la del servidor", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      const phone = (await one(admin, `select now() - interval '7 minutes' as t`)).t;
      await producer(`select public.mark_item($1, 'start', $2, $3)`, [ITEM.sonido, phone, uuid(1)]);
      const r = await one(admin, `select actual_start from route_items where id = $1`, [ITEM.sonido]);
      expect(new Date(r.actual_start).getTime()).toBe(new Date(phone).getTime());
      const log = await one(admin, `select payload from log_entries where kind = 'status_changed' and entity_id = $1`, [ITEM.sonido]);
      expect(log.payload.phone_time).toBeTruthy();
      expect(log.payload.server_time).toBeTruthy();
    });
  });

  it("la hora del teléfono no puede estar en el futuro ni ser de hace más de 12 horas", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      await producer(`select public.mark_item($1, 'start', now() + interval '3 hours')`, [ITEM.montaje]);
      await producer(`select public.mark_item($1, 'start', now() - interval '3 days')`, [ITEM.sonido]);
      const rows = await one(admin, `
        select (select actual_start from route_items where id = $1) = now() as future_clamped,
               (select actual_start from route_items where id = $2) = now() - interval '12 hours' as past_clamped`,
        [ITEM.montaje, ITEM.sonido]);
      expect(rows).toEqual({ future_clamped: true, past_clamped: true });
    });
  });

  it("una marca reenviada con la misma referencia no hace nada la segunda vez", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      await producer(`select public.mark_item($1, 'start', null, $2)`, [ITEM.sonido, uuid(2)]);
      await producer(`select public.mark_item($1, 'start', null, $2)`, [ITEM.sonido, uuid(2)]); // reintento: sin error
      const n = await one(admin, `select count(*)::int as n from log_entries where kind = 'status_changed' and entity_id = $1`, [ITEM.sonido]);
      expect(n.n).toBe(1);
      // Sin referencia, la segunda marca sí es un error de verdad.
      expect(await errorOf(producer, `select public.mark_item($1, 'start')`, [ITEM.sonido])).toMatch(/ya empezó/);
    });
  });

  it("si la operación falla, la referencia queda libre para reintentar", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      await producer(`select public.mark_item($1, 'finish')`, [ITEM.puertas]);
      expect(await errorOf(producer, `select public.mark_item($1, 'start', null, $2)`, [ITEM.puertas, uuid(3)])).toMatch(/ya (empezó|terminó)/);
      expect((await one(admin, `select count(*)::int as n from client_operations where client_ref = $1`, [uuid(3)])).n).toBe(0);
    });
  });

  it("nadie puede usar la referencia de otra persona", async () => {
    await scenario(async ({ asUser }) => {
      await (await asUser(USERS.producer))(`select public.mark_item($1, 'start', null, $2)`, [ITEM.sonido, uuid(4)]);
      const backend = await asUser(USERS.backend);
      expect(await errorOf(backend, `select public.mark_item($1, 'finish', null, $2)`, [ITEM.sonido, uuid(4)])).toMatch(/Referencia de operación inválida/);
    });
  });

  it("una evidencia reenviada devuelve la misma y no se duplica", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      const sql = `select public.add_evidence($1, 'photo', $2, null, $3, now() - interval '20 minutes', p_client_ref => $4) as id`;
      const args = [EVENT, `${EVENT}/foto.jpg`, SHA, uuid(5)];
      const first = (await one(producer, sql, args)).id;
      const second = (await one(producer, sql, args)).id;
      expect(second).toBe(first);
      expect((await one(admin, `select count(*)::int as n from evidences where client_ref = $1`, [uuid(5)])).n).toBe(1);
      expect((await one(admin, `select count(*)::int as n from log_entries where kind = 'evidence_added' and entity_id = $1`, [first])).n).toBe(1);
    });
  });

  it("una respuesta de momento crítico reenviada no se repite en la bitácora", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      const check = (await one(admin, `select id from moment_checks where moment_id = $1 order by sort_order limit 1`, [MOMENT])).id;
      await producer(`select public.answer_check($1, 'Falta un monitor', $2)`, [check, uuid(6)]);
      await producer(`select public.answer_check($1, 'Falta un monitor', $2)`, [check, uuid(6)]);
      expect((await one(admin, `select count(*)::int as n from log_entries where kind = 'check_answered'`)).n).toBe(1);
    });
  });

  it("nadie lee la tabla de referencias desde la app", async () => {
    await scenario(async ({ asUser }) => {
      const producer = await asUser(USERS.producer);
      await producer(`select public.mark_item($1, 'start', null, $2)`, [ITEM.sonido, uuid(7)]);
      expect((await one(producer, `select count(*)::int as n from client_operations`)).n).toBe(0);
      expect(await errorOf(producer, `insert into client_operations (client_ref, profile_id, op) values ($1, $2, 'x')`, [uuid(8), USERS.producer])).toMatch(/row-level security|permission denied/);
    });
  });
});

describe("Teléfonos para avisos", () => {
  it("cada persona registra, ve y borra solo sus teléfonos", async () => {
    await scenario(async ({ asUser }) => {
      const producer = await asUser(USERS.producer);
      await producer(`select public.register_push_token($1, 'ios')`, [PHONE.producer]);
      expect((await producer(`select token from push_tokens`)).rows).toEqual([{ token: PHONE.producer }]);
      const viewer = await asUser(USERS.viewer);
      expect((await one(viewer, `select count(*)::int as n from push_tokens`)).n).toBe(0);
      expect((await viewer(`delete from push_tokens where token = $1`, [PHONE.producer])).rowCount).toBe(0);
      await producer(`select public.unregister_push_token($1)`, [PHONE.producer]);
      expect((await one(producer, `select count(*)::int as n from push_tokens`)).n).toBe(0);
    });
  });

  it("no se insertan tokens a mano ni tokens inválidos; un teléfono pasa a quien inicia sesión", async () => {
    await scenario(async ({ admin, asUser }) => {
      const producer = await asUser(USERS.producer);
      expect(await errorOf(producer, `insert into push_tokens (token, profile_id, platform) values ($1, $2, 'ios')`, [PHONE.producer, USERS.backend])).toMatch(/row-level security|permission denied/);
      expect(await errorOf(producer, `select public.register_push_token('hola', 'ios')`)).toMatch(/no es válido/);
      expect(await errorOf(producer, `select public.register_push_token($1, 'windows')`, [PHONE.producer])).toMatch(/Plataforma/);
      await producer(`select public.register_push_token($1, 'ios')`, [PHONE.producer]);
      await (await asUser(USERS.backend))(`select public.register_push_token($1, 'ios')`, [PHONE.producer]);
      expect((await one(admin, `select profile_id from push_tokens where token = $1`, [PHONE.producer])).profile_id).toBe(USERS.backend);
    });
  });

  it("sin sesión no se registra nada", async () => {
    await scenario(async () => {
      const anon: Q = async (sql, params) => {
        await db.query("set local role anon");
        return db.query(sql, params);
      };
      expect(await errorOf(anon, `select public.register_push_token($1, 'ios')`, [PHONE.producer])).toMatch(/permission denied/);
    });
  });
});

describe("Avisos por nivel de criticidad", () => {
  // Las alertas de los datos de prueba ya dejaron avisos (omitidos: no había teléfonos). Se empieza de cero.
  const fresh = (admin: Q) => admin(`delete from push_messages`);
  async function phones(asUser: (u: string) => Promise<Q>) {
    for (const role of ["producer", "backend", "viewer"] as const) {
      await (await asUser(USERS[role]))(`select public.register_push_token($1, 'ios')`, [PHONE[role]]);
    }
  }

  it("una alerta Crítica avisa al productor y a la torre, no al cliente", async () => {
    await scenario(async ({ admin, asUser }) => {
      await fresh(admin);
      await phones(asUser);
      await admin(`select public._raise_alert($1, 3, 'compromiso_no_coincide', 'Consola no coincide', null, 'commitment', $2, null)`, [EVENT, uuid(20)]);
      const m = await one(admin, `select level, title, body, recipients, tokens, status from push_messages`);
      expect(m.level).toBe(3);
      expect(m.title).toBe("Crítico · Convención anual · Lima");
      expect(m.body).toBe("Consola no coincide");
      expect([...m.recipients].sort()).toEqual([USERS.producer, USERS.backend].sort());
      expect(m.tokens).toBe(2);
      expect(m.status).toBe("pending"); // sin pg_net en las pruebas
    });
  });

  it("una Red Flag avisa también al cliente; quien la levantó no se avisa a sí mismo", async () => {
    await scenario(async ({ admin, asUser }) => {
      await fresh(admin);
      await phones(asUser);
      await (await asUser(USERS.producer))(`select public.raise_alert($1, 4, 'Se cayó el escenario')`, [EVENT]);
      const m = await one(admin, `select recipients from push_messages`);
      const viewer2 = "00000000-0000-0000-0000-000000009902"; // segundo cliente de los datos de prueba
      expect([...m.recipients].sort()).toEqual([USERS.backend, USERS.viewer, viewer2].sort());
    });
  });

  it("Informativo no avisa; subir de nivel vuelve a avisar", async () => {
    await scenario(async ({ admin, asUser }) => {
      await fresh(admin);
      await phones(asUser);
      await admin(`select public._raise_alert($1, 1, 'r', 'Hito a tiempo', null, 'route_item', $2, null)`, [EVENT, ITEM.puertas]);
      expect((await one(admin, `select count(*)::int as n from push_messages`)).n).toBe(0);
      await admin(`select public._raise_alert($1, 2, 'r', 'Hito con atraso', null, 'route_item', $2, null)`, [EVENT, ITEM.puertas]);
      const m = await one(admin, `select level, recipients from push_messages`);
      expect(m.level).toBe(2);
      expect(m.recipients).toEqual([USERS.producer]); // Atención: solo productor
    });
  });

  it("sin teléfonos registrados el aviso queda como omitido", async () => {
    await scenario(async ({ admin }) => {
      await fresh(admin);
      await admin(`select public._raise_alert($1, 3, null, 'Algo crítico', null, null, null, null)`, [EVENT]);
      expect((await one(admin, `select status, tokens from push_messages`))).toEqual({ status: "skipped", tokens: 0 });
    });
  });

  it("solo la torre de control del evento revisa los avisos enviados", async () => {
    await scenario(async ({ admin, asUser }) => {
      await fresh(admin);
      await admin(`select public._raise_alert($1, 3, null, 'Algo crítico', null, null, null, null)`, [EVENT]);
      expect((await one(await asUser(USERS.backend), `select count(*)::int as n from push_messages`)).n).toBe(1);
      expect((await one(await asUser(USERS.producer), `select count(*)::int as n from push_messages`)).n).toBe(0);
      expect((await one(await asUser(USERS.viewer), `select count(*)::int as n from push_messages`)).n).toBe(0);
      expect((await one(await asUser(USERS.outsider), `select count(*)::int as n from push_messages`)).n).toBe(0);
    });
  });
});

describe("Reglas de reloj en el servidor", () => {
  it("corren para los eventos en curso sin sesión de nadie", async () => {
    await scenario(async ({ admin }) => {
      await admin(`update events set status = 'live', starts_at = now() - interval '1 hour' where id = $1`, [EVENT]);
      await admin(`update route_items set current_start = now() - interval '20 minutes', current_end = now() + interval '4 hours' where id = $1`, [ITEM.montaje]);
      expect((await one(admin, `select public.run_clock_rules_all() as n`)).n).toBeGreaterThanOrEqual(1);
      expect((await one(admin, `select status from alerts where rule_key = 'actividad_retrasada' and entity_id = $1`, [ITEM.montaje])).status).toBe("open");
    });
  });

  it("no tocan eventos lejanos en el tiempo", async () => {
    await scenario(async ({ admin }) => {
      await admin(`update route_items set current_start = now() - interval '20 minutes' where id = $1`, [ITEM.montaje]);
      expect((await one(admin, `select public.run_clock_rules_all() as n`)).n).toBe(0); // el evento del seed es en diciembre
    });
  });

  it("la app no las dispara para todos; desde la pantalla siguen pidiendo ser del equipo", async () => {
    await scenario(async ({ asUser }) => {
      const backend = await asUser(USERS.backend);
      expect(await errorOf(backend, `select public.run_clock_rules_all()`)).toMatch(/permission denied/);
      expect(await errorOf(backend, `select public._evaluate_clock_rules($1)`, [EVENT])).toMatch(/permission denied/);
      expect(await errorOf(await asUser(USERS.viewer), `select public.evaluate_clock_rules($1)`, [EVENT])).toMatch(/No tienes permiso/);
    });
  });
});
