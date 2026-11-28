// La cara de cada persona en MANDO (decisión 96): su avatar o su foto dentro de un hexágono.
// Sin foto, sus iniciales. Sirve en el servidor y en el navegador.

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

export function Cara({ url, name, size = 44, className = "" }: { url?: string | null; name: string; size?: number; className?: string }) {
  return (
    <span className={`cara ${className}`} style={{ width: size, height: size }} title={name}>
      {url ? (
        // Enlace firmado del cubo privado: cambia cada hora.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} width={size} height={size} />
      ) : (
        <span aria-label={name} style={{ fontSize: Math.round(size * 0.38) }}>
          {initials(name)}
        </span>
      )}
    </span>
  );
}
