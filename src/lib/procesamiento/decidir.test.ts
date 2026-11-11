import { describe, expect, it } from "vitest";
import type { ParcialFactura } from "../ocr/tipos";
import { decidirGuardado, type ContextoArchivo, type EstadoLeido } from "./decidir";

// Documentos reales de factura_0001 (su dígito de verificación es válido).
const LEIDA: ParcialFactura = {
  numero: "FE-000833",
  fecha: "2026-10-16",
  proveedor: "Infotec Rico Rubio S.A.",
  nitProveedor: "856162509",
  dvProveedor: 7,
  clienteDocumento: "869745262",
  clienteDv: 3,
  clienteNombre: "Inversiones Rangel Batista S.A.S.",
  items: [{ descripcion: "Monitor", cantidad: 5, precioUnitario: 763900, subtotal: 3819500 }],
  subtotal: 3819500,
  iva: 725705,
  impoconsumo: null,
  mencionaImpoconsumo: false,
  total: 4545205,
};

const CONTEXTO: ContextoArchivo = {
  hash: "hash-de-esta-imagen",
  archivo: "factura_0001.jpg",
  rutaAlmacen: "procesos/lote1/0001-factura_0001.jpg",
  procesoId: "lote1",
  uid: "usuario1",
  ahora: 1_700_000_000_000,
};

const NADA_EXISTE: EstadoLeido = { facturaExiste: false, hashDelNumero: null, clienteExiste: false };

const lectura = (factura: ParcialFactura = LEIDA, motivos: string[] = []) => ({ factura, motivos, confianza: 88 });

describe("qué se guarda de una factura leída", () => {
  it("factura nueva y válida: se acepta y se crean factura, índice y cliente", () => {
    const plan = decidirGuardado(CONTEXTO, lectura(), NADA_EXISTE);
    if (plan.resultado === "duplicada") throw new Error("no debía ser duplicada");
    expect(plan.resultado).toBe("aceptada");
    expect(plan.factura).toMatchObject({
      numero: "FE-000833",
      estado: "aceptada",
      motivos: [],
      clienteDocumento: "869745262",
      total: 4545205,
      archivo: "factura_0001.jpg",
      rutaAlmacen: "procesos/lote1/0001-factura_0001.jpg",
      confianzaOcr: 88,
      procesoId: "lote1",
      uid: "usuario1",
      creadoEn: 1_700_000_000_000,
    });
    expect(plan.factura.items).toHaveLength(1);
    expect(plan.crearIndice).toBe(true);
    expect(plan.clienteNuevo).toEqual({
      documento: "869745262",
      dv: 3,
      nombre: "Inversiones Rangel Batista S.A.S.",
      creadoEn: 1_700_000_000_000,
      primerProcesoId: "lote1",
    });
    expect(plan.clienteExistente).toBe(false);
  });

  it("la misma imagen otra vez (mismo hash): duplicada, no se escribe nada más", () => {
    const plan = decidirGuardado(CONTEXTO, lectura(), { ...NADA_EXISTE, facturaExiste: true });
    expect(plan).toEqual({ resultado: "duplicada" });
  });

  it("el número ya existe en OTRA imagen: no se descarta, va a revisión y sin índice", () => {
    // Podría ser un número mal leído: descartarla perdería una factura.
    const plan = decidirGuardado(CONTEXTO, lectura(), { ...NADA_EXISTE, hashDelNumero: "hash-de-otra-imagen" });
    if (plan.resultado === "duplicada") throw new Error("no debía ser duplicada");
    expect(plan.resultado).toBe("revision");
    expect(plan.factura.estado).toBe("revision");
    expect(plan.factura.motivos).toContain("El número FE-000833 ya existe en otra factura");
    expect(plan.crearIndice).toBe(false);
  });

  it("el cliente ya existe: no se crea de nuevo ni se toca su nombre", () => {
    const plan = decidirGuardado(CONTEXTO, lectura(), { ...NADA_EXISTE, clienteExiste: true });
    if (plan.resultado === "duplicada") throw new Error("no debía ser duplicada");
    expect(plan.clienteNuevo).toBeNull();
    expect(plan.clienteExistente).toBe(true);
    expect(plan.resultado).toBe("aceptada");
  });

  it("documento del cliente con dígito de verificación inválido: sin cliente y a revisión", () => {
    const mala = { ...LEIDA, clienteDv: 9 };
    const motivos = ["El dígito de verificación del documento del cliente no es válido"];
    const plan = decidirGuardado(CONTEXTO, lectura(mala, motivos), NADA_EXISTE);
    if (plan.resultado === "duplicada") throw new Error("no debía ser duplicada");
    expect(plan.resultado).toBe("revision");
    expect(plan.factura.clienteDocumento).toBeNull(); // no se guarda un documento dudoso
    expect(plan.factura.clienteNombre).toBe("Inversiones Rangel Batista S.A.S."); // lo leído no se pierde
    expect(plan.clienteNuevo).toBeNull();
    expect(plan.clienteExistente).toBe(false);
  });

  it("en revisión por otro motivo, pero con documento válido: el cliente sí se crea", () => {
    const plan = decidirGuardado(CONTEXTO, lectura(LEIDA, ["El total no es subtotal + IVA + impoconsumo"]), NADA_EXISTE);
    if (plan.resultado === "duplicada") throw new Error("no debía ser duplicada");
    expect(plan.resultado).toBe("revision");
    expect(plan.clienteNuevo?.documento).toBe("869745262");
    expect(plan.crearIndice).toBe(true);
  });

  it("sin número leído: no hay índice que crear", () => {
    const sinNumero = { ...LEIDA, numero: null };
    const plan = decidirGuardado(CONTEXTO, lectura(sinNumero, ["No se pudo leer el número de factura"]), NADA_EXISTE);
    if (plan.resultado === "duplicada") throw new Error("no debía ser duplicada");
    expect(plan.crearIndice).toBe(false);
    expect(plan.factura.numero).toBeNull();
  });

  it("un ítem a medio leer se guarda con sus null: no se inventa la cantidad", () => {
    const items = [{ descripcion: "Monitor", cantidad: null, precioUnitario: 763900, subtotal: 3819500 }];
    const plan = decidirGuardado(CONTEXTO, lectura({ ...LEIDA, items }, ["Ítem 1: no se pudo leer completo"]), NADA_EXISTE);
    if (plan.resultado === "duplicada") throw new Error("no debía ser duplicada");
    expect(plan.factura.items[0].cantidad).toBeNull();
  });
});
