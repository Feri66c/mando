import { describe, expect, it } from "vitest";
import { copyMailto, copyNotice, parseCopyList } from "../src/invite-copy";

describe("con copia al dar el mando", () => {
  it("separa por coma, punto y coma o espacios, sin repetir ni incluir a la persona nombrada", () => {
    const r = parseCopyList("Ana@Uno.pe, beto@dos.com; ana@uno.pe\ncarla@tres.org  tati@fredombtl.com", "tati@fredombtl.com");
    expect(r.emails).toEqual(["ana@uno.pe", "beto@dos.com", "carla@tres.org"]);
    expect(r.invalid).toEqual([]);
  });
  it("marca lo que no es correo", () => {
    expect(parseCopyList("ana@uno.pe, beto").invalid).toEqual(["beto"]);
    expect(parseCopyList("   ").emails).toEqual([]);
  });
  it("arma el aviso con nombre, cargo y evento", () => {
    const n = { name: "Tatiana John", title: "Stage manager", eventName: "Concierto", by: "Fer" };
    expect(copyNotice(n).subject).toContain("Tatiana John tiene el mando como Stage manager en Concierto");
    expect(copyNotice(n).body).toContain("Fer nombró a Tatiana John");
    expect(copyMailto(["a@b.pe", "c@d.pe"], n)).toMatch(/^mailto:\?bcc=a%40b\.pe,c%40d\.pe&subject=/);
  });
});
