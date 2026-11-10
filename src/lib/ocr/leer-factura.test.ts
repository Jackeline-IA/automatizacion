import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { leerFactura, type LectorImagen, type ModoLectura } from "./leer-factura";

/** Texto real del OCR (sin retocar). */
function texto(nombre: string): string {
  return readFileSync(path.join(import.meta.dirname, "__fixtures__", `${nombre}.txt`), "utf8");
}

/**
 * Lector de mentira: en vez de hacer OCR devuelve un texto fijo por modo y anota
 * qué modos se pidieron. Así se prueba la estrategia de reintentos sin tesseract.
 */
function lectorFalso(textos: Record<ModoLectura, string>) {
  const pedidos: ModoLectura[] = [];
  const leer: LectorImagen = async (_imagen, modo) => {
    pedidos.push(modo);
    return { texto: textos[modo], confianza: 90 };
  };
  return { leer, pedidos };
}

const IMAGEN = Buffer.from("no se usa: el lector es de mentira");

describe("estrategia de lectura de una factura", () => {
  it("si el original se acepta, no gasta más lecturas", async () => {
    const { leer, pedidos } = lectorFalso({
      original: texto("factura_0001"),
      preprocesado: "no debería leerse",
      encabezado: "no debería leerse",
    });
    const lectura = await leerFactura(IMAGEN, leer);
    expect(lectura.motivos).toEqual([]);
    expect(lectura.modo).toBe("original");
    expect(pedidos).toEqual(["original"]);
  });

  it("si el original tiene motivos, reintenta preprocesado y se queda con el mejor", async () => {
    // Caso real: en el original el OCR leyó «NIT 8808 24-0»; preprocesado, «880877724-0».
    const { leer, pedidos } = lectorFalso({
      original: texto("factura_0003"),
      preprocesado: texto("factura_0003.preprocesado"),
      encabezado: "no debería leerse",
    });
    const lectura = await leerFactura(IMAGEN, leer);
    expect(lectura.motivos).toEqual([]);
    expect(lectura.modo).toBe("preprocesado");
    expect(lectura.factura.nitProveedor).toBe("880877724");
    expect(pedidos).toEqual(["original", "preprocesado"]);
  });

  it("si siguen los motivos, antepone el texto del encabezado", async () => {
    // El preprocesado tampoco sirve: solo el encabezado invertido trae el NIT.
    const { leer, pedidos } = lectorFalso({
      original: texto("factura_0003"),
      preprocesado: texto("factura_0003"),
      encabezado: texto("factura_0003.encabezado"),
    });
    const lectura = await leerFactura(IMAGEN, leer);
    expect(pedidos).toEqual(["original", "preprocesado", "encabezado"]);
    expect(lectura.modo).toBe("encabezado");
    expect(lectura.factura.proveedor).toBe("Compuredes Villalpando Ordóñez S.A.S.");
    expect(lectura.factura.nitProveedor).toBe("880877724");
    expect(lectura.motivos).toEqual([]);
  });

  it("si nada lo arregla, devuelve la lectura con menos motivos (va a revisión, no falla)", async () => {
    const { leer } = lectorFalso({
      original: texto("factura_0003"), // 2 motivos
      preprocesado: "texto ilegible", // muchos motivos
      encabezado: "tampoco ayuda",
    });
    const lectura = await leerFactura(IMAGEN, leer);
    expect(lectura.modo).toBe("original");
    expect(lectura.motivos).toEqual([
      "No se pudo leer la razón social del proveedor",
      "No se pudo leer el NIT del proveedor",
    ]);
    // Los datos que sí se leyeron no se pierden.
    expect(lectura.factura.numero).toBe("FE-000545");
  });
});
