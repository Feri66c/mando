import Link from "next/link";
import { Semaforo } from "@/components/operacion/semaforo";
import { Card, Empty, SectionTitle, buttonPrimary } from "@/components/operacion/ui";
import { NOTICE_LABEL, type ClientNotice } from "@mando/core/data";
import { planningReady, type ElementStatus } from "@mando/core/planning";
import { formatEventRange, formatTime } from "@mando/core/time";

const COLOR = { ok: "text-ok", observation: "text-[var(--naranja)]", unconfirmed: "text-gold-300" } as const;

/**
 * MANDO Express (decisión 47): lo único que ve el cliente. El estado de su evento, lo que le toca aprobar
 * y sus ocurrencias. Las ocurrencias internas se quedan con el equipo.
 */
export function Express({
  eventId,
  status,
  startsAt,
  endsAt,
  timeZone,
  elements,
  approvalsPending,
  notices,
}: {
  eventId: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string;
  elements: ElementStatus[];
  approvalsPending: boolean;
  notices: ClientNotice[];
}) {
  const base = `/eventos/${eventId}`;
  const ready = planningReady(elements);
  return (
    <>
      <h1 className="sr-only">MANDO Express</h1>
      <div className="flex items-baseline justify-between gap-3">
        <span className="etiqueta-mando text-ice-300">MANDO Express</span>
        <span className="font-mono text-[11px] tracking-wide text-ink">{formatEventRange(startsAt, endsAt, timeZone)}</span>
      </div>

      <Card className="mt-3">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-gold-300">Tu evento</p>
        <p className="mt-1 font-display text-[26px] font-bold leading-tight">
          {status === "closed" ? "Cerrado" : status === "live" ? "En vivo" : ready ? "Todo listo para empezar" : "En preparación"}
        </p>
        {status !== "closed" && (
          <div className="mt-4">
            <Semaforo elements={elements} />
          </div>
        )}
        <p className="mt-3 text-sm text-ink-muted">
          No necesitas llamar a nadie: lo que pase con tu evento te llega aquí.
        </p>
      </Card>

      {approvalsPending && status !== "closed" && (
        <Link href={`${base}/aprobaciones`} className={`${buttonPrimary} mt-3 w-full`}>
          Tienes elementos por aprobar
        </Link>
      )}
      {status === "closed" && (
        <Link href={`${base}/aprendizajes`} className={`${buttonPrimary} mt-3 w-full`}>
          Llenar la ficha de satisfacción
        </Link>
      )}

      <SectionTitle>Tus ocurrencias</SectionTitle>
      {notices.length === 0 ? (
        <Empty>Todavía no hay avisos. Aquí verás cada avance y cada observación de tu evento.</Empty>
      ) : (
        <ul aria-label="Tus ocurrencias" className="grid gap-2">
          {notices.map((n) => (
            <li key={n.id} className="rounded-card bg-surface-100 px-4 py-3">
              <p className={`font-mono text-xs font-semibold uppercase tracking-wider ${COLOR[n.kind]}`}>
                {NOTICE_LABEL[n.kind]} · {formatTime(n.createdAt, timeZone)}
              </p>
              <p className="mt-0.5 leading-snug">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
