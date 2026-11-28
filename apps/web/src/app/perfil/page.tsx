import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/brand";
import { Card } from "@/components/operacion/ui";
import { Cara } from "@/components/perfil/cara";
import { AvatarMaker, ModePicker, PhotoUpload } from "@/components/perfil/editar";
import { ModoSync } from "@/components/perfil/modo-sync";
import { getCurrentUser, getMyLook, getMyOrgBrand } from "@/lib/data";
import { avatarReady } from "@/lib/avatar";

export const metadata: Metadata = { title: "Mi perfil" };
// Dibujar el avatar con IA puede tardar hasta un minuto.
export const maxDuration = 180;

/** Mi perfil (decisión 96): foto, avatar con IA y modo de pantalla. */
export default async function ProfilePage() {
  const user = await getCurrentUser();
  const [look, brand] = await Promise.all([getMyLook(user.id), getMyOrgBrand(user.id)]);

  return (
    <>
      <AppHeader userName={user.fullName} brand={brand} face={look.faceUrl} />
      <ModoSync mode={look.mode} />
      <main className="mx-auto max-w-3xl space-y-5 px-4 pb-16 pt-6">
        <div>
          <Link href="/eventos" className="inline-flex min-h-11 items-center text-sm font-medium text-ice-300 underline underline-offset-4">
            ← Mis eventos
          </Link>
          <h1 className="mt-2 font-display text-[32px] font-bold leading-none">Mi perfil</h1>
          <p className="mt-2 text-base text-ink-muted">Así te ve tu equipo en MANDO, y así ves tú la app.</p>
        </div>

        <Card>
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">Tu cara en MANDO</h2>
          <div className="mt-4 flex flex-wrap items-center gap-5">
            <Cara url={look.faceUrl} name={user.fullName} size={132} className="cara-grande" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-display text-2xl font-bold leading-tight">{user.fullName}</p>
              <p className="text-sm text-ink-muted">
                Tu foto aparece en tu tarjeta, en la cadena de mando y arriba de tu tablero. Si el productor general la subió por ti, aquí la puedes cambiar.
              </p>
              <PhotoUpload profileId={user.id} label={look.photoUrl ? "Cambiar mi foto" : "Subir mi foto"} />
            </div>
          </div>
          <div className="mt-5 border-l-2 border-gold-500 bg-surface-000 px-4 py-3">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-muted">Para una buena foto (y un buen avatar)</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
              <li>Ponte frente a una pared lisa de un solo color. Sin espejos, ventanas ni gente detrás.</li>
              <li>Mira a la cámara, con la cara completa y de frente, de los hombros hacia arriba.</li>
              <li>Buena luz de frente, de día o de una lámpara. Que no quede la luz a tu espalda.</li>
              <li>Sin lentes de sol, gorra ni filtros. Solo tú en la foto.</li>
            </ul>
          </div>
        </Card>

        <Card>
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">Tu avatar</h2>
          <p className="mt-1 text-sm text-ink-muted">La IA de MANDO te dibuja como personaje a partir de tu foto. Puedes crear otro cuando quieras.</p>
          <div className="mt-4 flex flex-wrap items-start gap-5">
            {look.avatarUrl && <Cara url={look.avatarUrl} name={`Avatar de ${user.fullName}`} size={132} className="cara-grande" />}
            <div className="min-w-0 flex-1">
              {avatarReady() ? (
                <AvatarMaker hasPhoto={Boolean(look.photoPath)} hasAvatar={Boolean(look.avatarUrl)} showAvatar={look.showAvatar} />
              ) : (
                <p className="text-sm text-ink-muted">Falta conectar el servicio de imágenes para crear avatares.</p>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">Cómo ves MANDO</h2>
          <p className="mt-1 text-sm text-ink-muted">En los tres modos los números, letras y botones son grandes. Cambia al instante.</p>
          <div className="mt-4">
            <ModePicker mode={look.mode} />
          </div>
        </Card>
      </main>
    </>
  );
}
