import { EmergencyForm, MemberCommandForm, SubmandoInviteForm } from "@/components/operacion/cadena";
import { Card, Empty, PageTitle, SectionTitle, buttonSecondary } from "@/components/operacion/ui";
import {
  accessCargos, areaSummary, commandTree, emergencyKindLabel, emergencyWindowLabel, visibilityLabel,
  type AccessRow, type ChainMember, type EmergencyWindow,
} from "@mando/core/command";
import type { EmergencyChange } from "@mando/core/data";
import { LEVEL_LABEL } from "@mando/core/event-types";
import { formatDate, formatTime } from "@mando/core/time";

const WINDOW_COLOR: Record<EmergencyWindow, string | undefined> = { con_tiempo: undefined, "48h": "ambar", "24h": "ambar", ultimo_minuto: "rojo" };

/**
 * La pantalla de la cadena de mando: el árbol de mandos con su gente conectada, el Staff de mando con la lista
 * de ingreso y los cambios de emergencia. Recibe todo ya filtrado por la base de datos.
 */
export function CommandView({
  eventId: id,
  userId,
  timezone,
  full,
  isBackend,
  canCommand,
  canExport,
  canReport,
  chain,
  areaNames,
  emergencies,
  access,
}: {
  eventId: string;
  userId: string;
  timezone: string;
  /** ¿Ve todo el evento? Si no, es un submando y ve solo su línea. */
  full: boolean;
  isBackend: boolean;
  canCommand: boolean;
  canExport: boolean;
  canReport: boolean;
  chain: ChainMember[];
  areaNames: string[];
  emergencies: EmergencyChange[];
  access: AccessRow[];
}) {
  const user = { id: userId };
  const event = { timezone };
  const tree = commandTree(chain);
  const me = tree.find((n) => n.profileId === user.id) ?? null;
  const summary = areaSummary(chain);
  const cargos = accessCargos(access);
  const exportHref = `/eventos/${id}/mando/lista`;

  return (
    <>
      <PageTitle>Cadena de mando</PageTitle>
      <p className="mb-3 mt-1 text-sm text-ink-muted">
        {full ? "Quién reporta a quién y qué ve cada persona. Lo que cambies aquí se aplica al instante." : "Tu mando, tu gente y lo que te toca ver en este evento."}
      </p>

      <Card className="border border-gold-300/40">
        <div className="flex items-center gap-4">
          <p className="font-mono text-[44px] font-semibold leading-none text-gold-300">{full ? chain.length : (me?.team ?? 0)}</p>
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold leading-tight">
              {full ? (chain.length === 1 ? "mando conectado a este evento" : "mandos conectados a este evento") : (me?.team ?? 0) === 1 ? "persona conectada a tu mando" : "personas conectadas a tu mando"}
            </p>
            <p className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
              <span aria-hidden className="luz" data-on />
              {me ? `Tú ves: ${visibilityLabel(me.visibility).toLowerCase()}${me.areaName ? ` · Área ${me.areaName}` : ""}` : "Mando activo"}
            </p>
          </div>
        </div>
        {full && summary.length > 0 && (
          <ul aria-label="Mandos por área" className="mt-3 flex flex-wrap gap-2">
            {summary.map((s) => (
              <li key={s.area} className="rounded-full bg-surface-200 px-3 py-1 text-xs font-medium">
                {s.area} <span className="font-mono text-gold-300">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SectionTitle>{full ? "Mando central y submandos" : "Tu línea de mando"}</SectionTitle>
      <ul aria-label="Cadena de mando" className="grid gap-2">
        {tree.map((n) => {
          const editable = canCommand && n.profileId !== user.id && (isBackend || (n.level ?? 4) >= 3);
          const bosses = chain.filter((b) => b.profileId !== n.profileId && (b.level ?? 4) <= (n.level ?? 4));
          return (
            <li key={n.profileId} style={{ marginLeft: `${Math.min(n.depth, 3) * 14}px` }}>
              <Card className={n.profileId === user.id ? "border border-gold-300/50" : n.depth > 0 ? "border-l-2 border-ice-300/50" : ""}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-lg font-semibold leading-tight">
                      {n.fullName}
                      {n.profileId === user.id && <span className="ml-2 font-mono text-[11px] uppercase tracking-wider text-gold-300">Tú</span>}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {n.title ?? (n.level ? LEVEL_LABEL[n.level] : "Equipo")}
                      {n.level ? ` · Nivel ${n.level}` : ""}
                    </p>
                  </div>
                  {n.team > 0 && (
                    <p className="shrink-0 text-right">
                      <span className="block font-mono text-2xl font-semibold leading-none text-gold-300">{n.team}</span>
                      <span className="block text-[11px] uppercase tracking-wider text-ink-muted">a su mando</span>
                    </p>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">Área</dt>
                    <dd>{n.areaName ?? "Sin área"}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">Ve</dt>
                    <dd>{visibilityLabel(n.role === "backend" ? "completa" : n.visibility)}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">Reporta a</dt>
                    <dd>{n.reportsToName ?? (n.role === "backend" ? "Nadie: es el mando central" : "Mando central")}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">Estado</dt>
                    <dd className="flex items-center gap-2">
                      <span aria-hidden className="luz" data-on={n.active ? "" : undefined} data-color={n.active ? undefined : "ambar"} />
                      {n.active ? "Activo" : "Aún no entra"}
                    </dd>
                  </div>
                </dl>
                {editable && (
                  <MemberCommandForm
                    eventId={id}
                    member={{ profileId: n.profileId, fullName: n.fullName, areaName: n.areaName, reportsTo: n.reportsTo, visibility: n.visibility, role: n.role, level: n.level }}
                    bosses={bosses.map((b) => ({ profileId: b.profileId, fullName: b.fullName, title: b.title }))}
                    areas={areaNames}
                  />
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      {canCommand && (
        <>
          <SectionTitle>Suma a tu submando</SectionTitle>
          <Card>
            <p className="mb-3 text-sm text-ink-muted">
              Coordinación y técnicos quedan bajo tu mando, con su área. No ven presupuesto, casting ni datos de otras áreas.
            </p>
            <SubmandoInviteForm eventId={id} areas={areaNames} />
          </Card>
        </>
      )}

      {canExport && (
        <>
          <SectionTitle>Staff de mando</SectionTitle>
          <Card>
            <p className="font-display text-lg font-semibold leading-tight">
              <span className="font-mono text-gold-300">{chain.length}</span> {chain.length === 1 ? "mando" : "mandos"} ·{" "}
              <span className="font-mono text-gold-300">{access.length}</span> {access.length === 1 ? "persona en campo" : "personas en campo"}
            </p>
            {access.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">Todavía no sumaste personal al evento. Se suma en Planificación, parte Personal.</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-ink-muted">
                  Lista de ingreso para el local: nombre, documento, cargo y estado del documento. Baja completa o por cargo.
                </p>
                <a href={exportHref} className={`${buttonSecondary} mt-3 w-full`}>
                  Exportar lista de ingreso (Excel)
                </a>
                <ul aria-label="Exportar por cargo" className="mt-3 flex flex-wrap gap-2">
                  {cargos.map((c) => (
                    <li key={c}>
                      <a href={`${exportHref}?cargo=${encodeURIComponent(c)}`} className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm">
                        {c} <span className="ml-1.5 font-mono text-gold-300">{access.filter((r) => r.role === c).length}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      )}

      <SectionTitle>Cambios de emergencia</SectionTitle>
      {canReport && (
        <Card className="mb-2">
          <p className="mb-3 text-sm text-ink-muted">
            Si alguien se cae o algo cambia cerca del evento, regístralo aquí. MANDO lo marca como 48 horas, 24 horas o último minuto.
          </p>
          <EmergencyForm eventId={id} />
        </Card>
      )}
      {emergencies.length === 0 ? (
        <Empty>No hay cambios de emergencia registrados.</Empty>
      ) : (
        <ul aria-label="Cambios de emergencia" className="grid gap-2">
          {emergencies.map((c) => (
            <li key={c.id}>
              <Card>
                <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.12em]">
                  <span aria-hidden className="luz" data-on data-color={WINDOW_COLOR[c.window]} />
                  {emergencyWindowLabel(c.window)} · {emergencyKindLabel(c.kind)}
                </p>
                <p className="mt-1 font-semibold">{c.title}</p>
                {c.detail && <p className="text-sm text-ink-muted">{c.detail}</p>}
                <p className="mt-1 font-mono text-xs text-ink-muted">
                  {c.createdByName ?? "Equipo"} · {formatDate(c.createdAt, event.timezone)} · {formatTime(c.createdAt, event.timezone)}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
