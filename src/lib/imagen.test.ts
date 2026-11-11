import { describe, expect, it } from "vitest";
import { CONTENT_TYPE, EXTENSION, tipoPorFirma } from "./imagen";

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FIRMA_JPEG = [0xff, 0xd8, 0xff, 0xe0];

describe("tipo real de una imagen por sus primeros bytes", () => {
  it("reconoce un PNG y un JPEG por su firma", () => {
    expect(tipoPorFirma(Uint8Array.from([...FIRMA_PNG, 0, 0, 0, 13]))).toBe("png");
    expect(tipoPorFirma(Uint8Array.from([...FIRMA_JPEG, 0, 16]))).toBe("jpeg");
  });

  it("un texto no es una imagen, se llame como se llame", () => {
    // El nombre «factura.png» no llega a esta función: solo cuentan los bytes.
    expect(tipoPorFirma(new TextEncoder().encode("esto es un texto, no una imagen"))).toBeNull();
  });

  it("rechaza otros formatos y firmas incompletas", () => {
    expect(tipoPorFirma(new TextEncoder().encode("GIF89a..."))).toBeNull();
    expect(tipoPorFirma(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(tipoPorFirma(Uint8Array.from(FIRMA_PNG.slice(0, 5)))).toBeNull(); // PNG cortado
    expect(tipoPorFirma(Uint8Array.from([0xff, 0xd8]))).toBeNull(); // JPEG cortado
    expect(tipoPorFirma(new Uint8Array(0))).toBeNull();
  });

  it("da la extensión y el content-type del tipo real", () => {
    expect(EXTENSION.png).toBe("png");
    expect(EXTENSION.jpeg).toBe("jpg");
    expect(CONTENT_TYPE.png).toBe("image/png");
    expect(CONTENT_TYPE.jpeg).toBe("image/jpeg");
  });
});
