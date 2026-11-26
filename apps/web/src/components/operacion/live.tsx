"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { evaluateClockRulesAction } from "@/app/actions/operacion";
import { getBrowserClient } from "@/lib/supabase/browser";

const TABLES = ["route_items", "log_entries", "alerts", "evidences", "critical_moments", "commitments", "event_criteria", "event_guests", "event_requirements", "event_locations"];

/**
 * Tiempo real: escucha los cambios del evento y vuelve a dibujar la pantalla con los datos del servidor.
 * Qué filas llegan lo decide la seguridad por fila (el cliente solo recibe lo visible).
 */
export function RealtimeRefresh({ eventId }: { eventId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) return;
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250); // junta varios cambios seguidos en un solo redibujo
    };
    let channel = supabase.channel(`evento-${eventId}`);
    for (const table of TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `event_id=eq.${eventId}` }, refresh);
    }
    channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "moment_checks" }, refresh);
    let cancelled = false;
    // El canal tiene que ir con la sesión de la persona: sin ella, la seguridad por fila no le manda nada.
    void supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") setState("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setState("offline");
      });
    });
    const online = () => router.refresh();
    window.addEventListener("online", online);
    return () => {
      cancelled = true;
      window.removeEventListener("online", online);
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [eventId, router]);

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-muted" aria-live="polite">
      <span
        aria-hidden
        className={`size-2 rounded-full ${state === "live" ? "bg-[#4fbf8b]" : state === "offline" ? "bg-[#ff7a5c]" : "bg-ice-500"}`}
      />
      {state === "live" ? "En línea" : state === "offline" ? "Sin conexión" : "Conectando"}
    </span>
  );
}

/** Reglas por reloj: cada minuto mientras la pantalla del equipo está abierta. */
export function ClockRules({ eventId }: { eventId: string }) {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void evaluateClockRulesAction(eventId);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [eventId]);
  return null;
}

/** Reloj del evento, en su zona horaria, con segundos. */
export function LiveClock({ timeZone, className = "", seconds = false }: { timeZone: string; className?: string; seconds?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const text = now
    ? new Intl.DateTimeFormat("es-PE", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: seconds ? "2-digit" : undefined,
        hourCycle: "h23",
      }).format(now)
    : seconds
      ? "--:--:--"
      : "--:--";
  return (
    <time className={`font-mono tabular-nums ${className}`} suppressHydrationWarning>
      {text}
    </time>
  );
}
