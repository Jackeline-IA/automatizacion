import { describe, expect, it } from "vitest";
import { PALABRA_PARA_BORRAR, revisarPeticionDeBorrado } from "./borrado";

describe("cuándo se permite «Borrar todo»", () => {
  it("la palabra de confirmación es BORRAR", () => {
    expect(PALABRA_PARA_BORRAR).toBe("BORRAR");
  });

  it("con la palabra exacta y sin lotes procesándose, se permite", () => {
    expect(revisarPeticionDeBorrado({ confirmacion: "BORRAR" }, 0)).toEqual({ permitido: true });
  });

  it("sin la palabra exacta se rechaza (400): ni minúsculas, ni espacios, ni parecidos", () => {
    for (const confirmacion of ["borrar", "Borrar", " BORRAR", "BORRAR ", "BORRAR TODO", "BORRA", "", "SI"]) {
      const veredicto = revisarPeticionDeBorrado({ confirmacion }, 0);
      expect(veredicto, `«${confirmacion}»`).toMatchObject({ permitido: false, status: 400 });
    }
  });

  it("un cuerpo que no trae la confirmación como texto se rechaza (400)", () => {
    for (const cuerpo of [null, undefined, "BORRAR", 42, [], {}, { confirmacion: true }, { confirmacion: ["BORRAR"] }, { otra: "BORRAR" }]) {
      expect(revisarPeticionDeBorrado(cuerpo, 0), JSON.stringify(cuerpo)).toMatchObject({ permitido: false, status: 400 });
    }
  });

  it("si hay lotes procesándose se niega (409), aunque la palabra sea correcta", () => {
    const veredicto = revisarPeticionDeBorrado({ confirmacion: "BORRAR" }, 2);
    expect(veredicto).toMatchObject({ permitido: false, status: 409 });
    expect(veredicto.permitido === false && veredicto.error).toContain("2");
  });

  it("…salvo que se confirme además, de forma explícita, que no importa", () => {
    expect(revisarPeticionDeBorrado({ confirmacion: "BORRAR", aunqueHayaLotesProcesando: true }, 2)).toEqual({ permitido: true });
    // Solo vale el booleano true: un «sí» en texto no cuenta.
    expect(revisarPeticionDeBorrado({ confirmacion: "BORRAR", aunqueHayaLotesProcesando: "true" }, 2)).toMatchObject({ permitido: false, status: 409 });
  });

  it("la confirmación extra no sustituye a la palabra", () => {
    expect(revisarPeticionDeBorrado({ aunqueHayaLotesProcesando: true }, 0)).toMatchObject({ permitido: false, status: 400 });
    expect(revisarPeticionDeBorrado({ confirmacion: "borrar", aunqueHayaLotesProcesando: true }, 2)).toMatchObject({ permitido: false, status: 400 });
  });
});
