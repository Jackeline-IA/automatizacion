import { describe, expect, it } from "vitest";
import type { Factura } from "../modelo/tipos";
import { aParcial, cambiosCorreccion, motivosCorreccion, precargaDesdeFactura, proponerTotales, type ImportesCorreccion } from "./correccion";
import { erroresDeFormato, type EntradaCorreccion } from "./correccion-esquema";

// Los datos reales de factura_0001 (sus dígitos de verificación son válidos).
const BUENA: EntradaCorreccion = {
  numero: "FE-000833",
  fecha: "2026-10-16",
  proveedor: "Infotec Rico Rubio S.A.",
  nitProveedor: "856162509",
  dvProveedor: 7,
  clienteDocumento: "869745262",
  clienteDv: 3,
  clienteNombre: "Inversiones Rangel Batista S.A.S.",
  items: [{ descripcion: "Monitor", cantidad: 5, precioUnitario: 763900 }],
  subtotal: 3819500,
  iva: 725705,
  impoconsumo: null,
  total: 4545205,
  confirmado: false,
};

describe("formato de lo que envía el formulario (esquema)", () => {
  it("unos datos completos y bien escritos no tienen errores de formato", () => {
    expect(erroresDeFormato(BUENA)).toEqual([]);
  });

  it("rechaza lo que no es un objeto", () => {
    expect(erroresDeFormato(null).length).toBeGreaterThan(0);
    expect(erroresDeFormato("hola").length).toBeGreaterThan(0);
  });

  it("los campos obligatorios vacíos son errores de formato", () => {
    const errores = erroresDeFormato({ ...BUENA, numero: "  ", proveedor: "", clienteNombre: "" });
    expect(errores).toContain("Falta el número de factura");
    expect(errores).toContain("Falta la razón social del proveedor");
    expect(errores).toContain("Falta el nombre del cliente");
  });

  it("la fecha debe existir y escribirse aaaa-mm-dd", () => {
    expect(erroresDeFormato({ ...BUENA, fecha: "16/10/2026" })).toContain("La fecha debe escribirse aaaa-mm-dd");
    expect(erroresDeFormato({ ...BUENA, fecha: "2026-02-30" })).toContain("Esa fecha no existe");
  });

  it("los documentos van solo con dígitos (sin puntos, guion ni DV)", () => {
    expect(erroresDeFormato({ ...BUENA, nitProveedor: "856.162.509-7" })).toContain(
      "El NIT del proveedor: solo dígitos, sin puntos, guion ni dígito de verificación",
    );
  });

  it("los importes son pesos enteros: nada de decimales ni negativos", () => {
    expect(erroresDeFormato({ ...BUENA, iva: 725705.5 })).toContain("El IVA debe ser un número entero de pesos, sin decimales");
    expect(erroresDeFormato({ ...BUENA, total: -1 })).toContain("El total no puede ser negativo");
  });

  it("al menos un ítem, y los errores de un ítem dicen cuál es", () => {
    expect(erroresDeFormato({ ...BUENA, items: [] })).toContain("Debe haber al menos un ítem");
    const errores = erroresDeFormato({ ...BUENA, items: [BUENA.items[0], { descripcion: "", cantidad: 0, precioUnitario: 10 }] });
    expect(errores).toContain("Ítem 2: falta la descripción");
    expect(errores).toContain("Ítem 2: la cantidad debe ser mayor que cero");
  });

  it("no acepta campos que no conoce (el servidor decide quién corrige y cuándo)", () => {
    expect(erroresDeFormato({ ...BUENA, corregidaPor: "otro@correo.com" }).length).toBeGreaterThan(0);
  });
});

describe("del formulario a las reglas del OCR (aParcial y motivos)", () => {
  it("calcula el subtotal de cada ítem: no lo escribe la persona", () => {
    expect(aParcial(BUENA).items).toEqual([{ descripcion: "Monitor", cantidad: 5, precioUnitario: 763900, subtotal: 3819500 }]);
  });

  it("unos datos correctos pasan las mismas validaciones de la máquina", () => {
    expect(motivosCorreccion(BUENA)).toEqual([]);
  });

  it("un total equivocado da el mismo motivo que daría el OCR", () => {
    expect(motivosCorreccion({ ...BUENA, total: 4545000 })).toContain("El total no es subtotal + IVA + impoconsumo");
  });

  it("un dígito de verificación equivocado sigue siendo motivo", () => {
    expect(motivosCorreccion({ ...BUENA, clienteDv: 9 })).toContain("El dígito de verificación del documento del cliente no es válido");
  });

  it("con impoconsumo, el total lo incluye", () => {
    const conImpo = { ...BUENA, impoconsumo: 152780, total: 4545205 + 152780 };
    expect(motivosCorreccion(conImpo)).toEqual([]);
  });
});

describe("propuesta de totales desde los ítems", () => {
  const items = [
    { cantidad: 5, precioUnitario: 763900 },
    { cantidad: 2, precioUnitario: 1001 },
  ];

  it("IVA del 19 % redondeado a pesos y total = subtotal + IVA", () => {
    // 3 821 502 × 0,19 = 726 085,38 → 726 085
    expect(proponerTotales(items, false)).toEqual({ subtotal: 3821502, iva: 726085, impoconsumo: null, total: 4547587 });
  });

  it("impoconsumo del 4 % solo si la factura lo trae", () => {
    // 3 821 502 × 0,04 = 152 860,08 → 152 860
    expect(proponerTotales(items, true)).toEqual({ subtotal: 3821502, iva: 726085, impoconsumo: 152860, total: 4700447 });
  });

  it("los ítems a medio llenar no suman", () => {
    expect(proponerTotales([{ cantidad: null, precioUnitario: 1000 }], false)).toEqual({ subtotal: 0, iva: 0, impoconsumo: null, total: 0 });
  });

  it("lo propuesto pasa las validaciones", () => {
    const propuesta = proponerTotales(
      BUENA.items.map(({ cantidad, precioUnitario }) => ({ cantidad, precioUnitario })),
      false,
    );
    expect(motivosCorreccion({ ...BUENA, ...propuesta })).toEqual([]);
  });
});

describe("precarga del formulario con lo que leyó la máquina", () => {
  const enRevision: Factura = {
    numero: "FE-000833",
    fecha: null,
    proveedor: "Infotec Rico Rubio S.A.",
    nitProveedor: "856162509",
    dvProveedor: 7,
    clienteDocumento: null,
    clienteDocumentoLeido: "869745262",
    clienteDv: 9,
    clienteNombre: "Inversiones Rangel Batista S.A.S.",
    subtotal: 3819500,
    iva: 725705,
    impoconsumo: null,
    total: null,
    estado: "revision",
    motivos: ["No se pudo leer la fecha de emisión"],
    archivo: "factura_0001.jpg",
    rutaAlmacen: "procesos/lote1/0001-factura_0001.jpg",
    confianzaOcr: 80,
    procesoId: "lote1",
    uid: "usuario1",
    creadoEn: 1,
    items: [{ descripcion: "Monitor", cantidad: 5, precioUnitario: 763900, subtotal: 3819500 }],
  };

  it("usa el documento LEÍDO del cliente aunque no haya pasado el DV", () => {
    const precarga = precargaDesdeFactura(enRevision);
    expect(precarga.clienteDocumento).toBe("869745262");
    expect(precarga.clienteDv).toBe(9);
    expect(precarga.fecha).toBeNull();
    expect(precarga.total).toBeNull();
    expect(precarga.items).toEqual([{ descripcion: "Monitor", cantidad: 5, precioUnitario: 763900 }]);
  });

  it("una factura con error del OCR (sin ítems ni campos nuevos) trae al menos una fila vacía", () => {
    const vacia: Factura = { ...enRevision, items: [], dvProveedor: undefined, clienteDv: undefined, clienteDocumentoLeido: undefined };
    const precarga = precargaDesdeFactura(vacia);
    expect(precarga.items).toEqual([{ descripcion: "", cantidad: null, precioUnitario: null }]);
    expect(precarga.dvProveedor).toBeNull();
    expect(precarga.clienteDocumento).toBeNull();
  });
});

describe("contadores del lote al corregir (cambiosCorreccion)", () => {
  const NUEVA: ImportesCorreccion = {
    subtotal: 3819500,
    iva: 725705,
    impoconsumo: null,
    total: 4545205,
    nitProveedor: "856162509",
    proveedor: "Infotec Rico Rubio S.A.",
  };

  it("primera corrección: suma a «manuales» y a su proveedor; «revisión» no cambia", () => {
    expect(cambiosCorreccion(null, NUEVA, true)).toEqual([
      { ruta: ["manuales", "n"], incremento: 1 },
      { ruta: ["manuales", "subtotal"], incremento: 3819500 },
      { ruta: ["manuales", "iva"], incremento: 725705 },
      { ruta: ["manuales", "total"], incremento: 4545205 },
      { ruta: ["proveedores", "856162509", "nombre"], valor: "Infotec Rico Rubio S.A." },
      { ruta: ["proveedores", "856162509", "n"], incremento: 1 },
      { ruta: ["proveedores", "856162509", "subtotal"], incremento: 3819500 },
      { ruta: ["proveedores", "856162509", "iva"], incremento: 725705 },
      { ruta: ["proveedores", "856162509", "total"], incremento: 4545205 },
      { ruta: ["clientesNuevos"], incremento: 1 },
    ]);
  });

  it("reedición con el mismo proveedor: solo las diferencias, sin volver a contar la factura", () => {
    const cambios = cambiosCorreccion(NUEVA, { ...NUEVA, iva: 725706, total: 4545206 }, false);
    expect(cambios).toEqual([
      { ruta: ["manuales", "iva"], incremento: 1 },
      { ruta: ["manuales", "total"], incremento: 1 },
      { ruta: ["proveedores", "856162509", "nombre"], valor: "Infotec Rico Rubio S.A." },
      { ruta: ["proveedores", "856162509", "iva"], incremento: 1 },
      { ruta: ["proveedores", "856162509", "total"], incremento: 1 },
    ]);
  });

  it("reedición que cambia el NIT del proveedor: sale del anterior y entra al nuevo", () => {
    const cambios = cambiosCorreccion(NUEVA, { ...NUEVA, nitProveedor: "900123456", proveedor: "Otra S.A.S." }, false);
    expect(cambios).toEqual([
      { ruta: ["proveedores", "856162509", "n"], incremento: -1 },
      { ruta: ["proveedores", "856162509", "subtotal"], incremento: -3819500 },
      { ruta: ["proveedores", "856162509", "iva"], incremento: -725705 },
      { ruta: ["proveedores", "856162509", "total"], incremento: -4545205 },
      { ruta: ["proveedores", "900123456", "nombre"], valor: "Otra S.A.S." },
      { ruta: ["proveedores", "900123456", "n"], incremento: 1 },
      { ruta: ["proveedores", "900123456", "subtotal"], incremento: 3819500 },
      { ruta: ["proveedores", "900123456", "iva"], incremento: 725705 },
      { ruta: ["proveedores", "900123456", "total"], incremento: 4545205 },
    ]);
  });
});
