import { describe, expect, it } from "vitest";
import {
  calcularTasas,
  cambiosDe,
  metricasDesdeEventos,
  metricasVacias,
  proveedoresOrdenados,
  sumarMetricas,
  type EventoMetricas,
} from "./metricas";

const ACEPTADA: EventoMetricas = {
  tipo: "aceptada",
  subtotal: 1000000,
  iva: 190000,
  impoconsumo: 40000,
  total: 1230000,
  nitProveedor: "856162509",
  proveedor: "Infotec Rico Rubio S.A.",
  clienteNuevo: true,
};

const REVISION: EventoMetricas = {
  tipo: "revision",
  subtotal: 500000,
  iva: 95000,
  impoconsumo: null,
  total: null, // el OCR no leyó el total
  nitProveedor: "856162509",
  proveedor: "Infotec Rico Rubio S.A.",
  clienteNuevo: false,
};

describe("qué contadores sube cada factura (cambiosDe)", () => {
  it("una aceptada suma a «aceptadas», a su proveedor y, si aplica, a clientes nuevos", () => {
    expect(cambiosDe(ACEPTADA)).toEqual([
      { ruta: ["aceptadas", "n"], incremento: 1 },
      { ruta: ["aceptadas", "subtotal"], incremento: 1000000 },
      { ruta: ["aceptadas", "iva"], incremento: 190000 },
      { ruta: ["aceptadas", "impoconsumo"], incremento: 40000 },
      { ruta: ["aceptadas", "total"], incremento: 1230000 },
      { ruta: ["clientesNuevos"], incremento: 1 },
      { ruta: ["proveedores", "856162509", "nombre"], valor: "Infotec Rico Rubio S.A." },
      { ruta: ["proveedores", "856162509", "n"], incremento: 1 },
      { ruta: ["proveedores", "856162509", "subtotal"], incremento: 1000000 },
      { ruta: ["proveedores", "856162509", "iva"], incremento: 190000 },
      { ruta: ["proveedores", "856162509", "impoconsumo"], incremento: 40000 },
      { ruta: ["proveedores", "856162509", "total"], incremento: 1230000 },
    ]);
  });

  it("una en revisión suma a «revision» pero NO a proveedores (su NIT puede estar mal leído)", () => {
    const cambios = cambiosDe(REVISION);
    expect(cambios).toContainEqual({ ruta: ["revision", "n"], incremento: 1 });
    expect(cambios).toContainEqual({ ruta: ["revision", "subtotal"], incremento: 500000 });
    // Lo que no se leyó suma 0: no se inventa una cifra.
    expect(cambios).toContainEqual({ ruta: ["revision", "total"], incremento: 0 });
    expect(cambios.some((c) => c.ruta[0] === "proveedores")).toBe(false);
    expect(cambios.some((c) => c.ruta[0] === "clientesNuevos")).toBe(false);
  });

  it("una duplicada y un error solo suben su contador", () => {
    expect(cambiosDe({ tipo: "duplicada" })).toEqual([{ ruta: ["duplicadas"], incremento: 1 }]);
    expect(cambiosDe({ tipo: "error" })).toEqual([{ ruta: ["errores"], incremento: 1 }]);
  });
});

describe("reconstruir, sumar y resumir métricas", () => {
  const lote = metricasDesdeEventos([ACEPTADA, ACEPTADA, REVISION, { tipo: "duplicada" }, { tipo: "error" }]);

  it("metricasDesdeEventos aplica los cambios de cada evento", () => {
    expect(lote.aceptadas).toEqual({ n: 2, subtotal: 2000000, iva: 380000, impoconsumo: 80000, total: 2460000 });
    expect(lote.revision).toEqual({ n: 1, subtotal: 500000, iva: 95000, impoconsumo: 0, total: 0 });
    expect(lote.duplicadas).toBe(1);
    expect(lote.errores).toBe(1);
    expect(lote.clientesNuevos).toBe(2);
    expect(lote.proveedores["856162509"]).toEqual({
      nombre: "Infotec Rico Rubio S.A.",
      n: 2,
      subtotal: 2000000,
      iva: 380000,
      impoconsumo: 80000,
      total: 2460000,
    });
  });

  it("un lote sin eventos queda en ceros", () => {
    expect(metricasDesdeEventos([])).toEqual(metricasVacias());
  });

  it("sumarMetricas suma lotes y junta los proveedores por NIT", () => {
    const otro = metricasDesdeEventos([{ ...ACEPTADA, nitProveedor: "830269353", proveedor: "Asesorías Ledesma S.A.S.", clienteNuevo: false }]);
    const total = sumarMetricas([lote, otro, undefined]); // un lote antiguo puede no tener métricas
    expect(total.aceptadas.n).toBe(3);
    expect(total.aceptadas.total).toBe(3690000);
    expect(total.clientesNuevos).toBe(2);
    expect(Object.keys(total.proveedores).sort()).toEqual(["830269353", "856162509"]);
    expect(total.proveedores["856162509"].n).toBe(2);
    // Sumar no modifica los lotes de entrada.
    expect(lote.aceptadas.n).toBe(2);
  });

  it("calcularTasas: porcentajes sobre las facturas distintas; las duplicadas no cuentan", () => {
    // 2 aceptadas + 1 revisión + 1 error = 4 procesadas; la duplicada queda fuera.
    expect(calcularTasas(lote)).toEqual({ procesadas: 4, correctas: 2, malLeidas: 2, porcentajeCorrectas: 50, porcentajeMalLeidas: 50 });
  });

  it("calcularTasas no divide por cero en un lote vacío", () => {
    expect(calcularTasas(metricasVacias())).toEqual({ procesadas: 0, correctas: 0, malLeidas: 0, porcentajeCorrectas: 0, porcentajeMalLeidas: 0 });
  });

  it("proveedoresOrdenados: del que más facturó al que menos, con su NIT", () => {
    const varios = metricasDesdeEventos([
      { ...ACEPTADA, nitProveedor: "111", proveedor: "Pequeño", total: 100 },
      { ...ACEPTADA, nitProveedor: "222", proveedor: "Grande", total: 900 },
    ]);
    expect(proveedoresOrdenados(varios).map((p) => [p.nit, p.nombre, p.total])).toEqual([
      ["222", "Grande", 900],
      ["111", "Pequeño", 100],
    ]);
  });

  it("una aceptada sin NIT legible no crea un proveedor", () => {
    // No debería ocurrir (sin NIT no se acepta), pero no debe crear la clave «null».
    const m = metricasDesdeEventos([{ ...ACEPTADA, nitProveedor: null }]);
    expect(m.aceptadas.n).toBe(1);
    expect(m.proveedores).toEqual({});
  });
});
