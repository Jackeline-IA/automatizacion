import { describe, expect, it } from "vitest";
import { calcularDv, dvValido } from "./nit";

describe("dígito de verificación del NIT (algoritmo de la DIAN)", () => {
  it("calcula el DV de NIT reales conocidos", () => {
    expect(calcularDv("890903938")).toBe(8);
    expect(calcularDv("860034313")).toBe(7);
    expect(calcularDv("899999068")).toBe(1);
  });

  it("acepta los documentos de las facturas de ejemplo", () => {
    expect(dvValido("856162509", 7)).toBe(true); // proveedor de factura_0001
    expect(dvValido("869745262", 3)).toBe(true); // cliente de factura_0001
    expect(dvValido("893333396", 0)).toBe(true); // DV 0: resto 0 no se convierte en 11
  });

  it("rechaza un DV equivocado y un dígito mal leído", () => {
    expect(dvValido("856162509", 3)).toBe(false);
    expect(dvValido("856162508", 7)).toBe(false); // el OCR cambió el último 9 por un 8
  });

  it("no acepta nada que no sean solo dígitos", () => {
    expect(calcularDv("8561625O9")).toBeNull(); // una letra O en vez de un cero
    expect(calcularDv("")).toBeNull();
    expect(dvValido("856162509", null)).toBe(false);
  });
});
