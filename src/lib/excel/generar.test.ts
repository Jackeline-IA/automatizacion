import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { Factura } from "../modelo/tipos";
import { generarExcel, nombreExcel, type DatosExcel } from "./generar";

function factura(cambios: Partial<Factura>): Factura {
  return {
    numero: "FE-000001",
    fecha: "2026-10-16",
    proveedor: "Infotec Rico Rubio S.A.",
    nitProveedor: "856162509",
    clienteDocumento: "869745262",
    clienteNombre: "Nombre leído por el OCR",
    subtotal: 1000000,
    iva: 190000,
    impoconsumo: null,
    total: 1190000,
    estado: "aceptada",
    motivos: [],
    archivo: "factura_0001.jpg",
    rutaAlmacen: "procesos/lote1/0001-factura_0001.jpg",
    confianzaOcr: 88.4,
    procesoId: "lote1",
    uid: "usuario1",
    creadoEn: 0,
    items: [
      { descripcion: "Monitor", cantidad: 2, precioUnitario: 400000, subtotal: 800000 },
      { descripcion: "Teclado", cantidad: 1, precioUnitario: 200000, subtotal: 200000 },
    ],
    ...cambios,
  };
}

const DATOS: DatosExcel = {
  carpeta: "facturas-octubre",
  totalArchivos: 4,
  duracionMs: 65_000,
  archivos: [
    { resultado: "aceptada", clienteNuevo: true, clienteExistente: false },
    { resultado: "revision", clienteNuevo: false, clienteExistente: true },
    { resultado: "duplicada", clienteNuevo: false, clienteExistente: false },
    { resultado: "error", clienteNuevo: false, clienteExistente: false },
  ],
  facturas: [
    factura({}),
    factura({
      numero: "FE-000002",
      archivo: "factura_0002.png",
      subtotal: 2000000,
      iva: 380000,
      impoconsumo: 80000,
      total: 2460000,
      estado: "revision",
      motivos: ["El total no cuadra", "Ítem 1: no se pudo leer completo"],
      items: [{ descripcion: "Plan móvil", cantidad: null, precioUnitario: 2000000, subtotal: 2000000 }],
    }),
    // Una factura que no se pudo leer: casi todo en null.
    factura({ numero: null, fecha: null, proveedor: null, nitProveedor: null, clienteDocumento: null, clienteNombre: null, subtotal: null, iva: null, total: null, estado: "revision", motivos: ["No se pudo procesar la imagen"], confianzaOcr: null, items: [], archivo: "factura_0003.jpg" }),
  ],
  nombresClientes: { "869745262": "Inversiones Rangel Batista S.A.S." },
};

async function abrir(datos: DatosExcel = DATOS): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook();
  // exceljs declara su propio tipo Buffer, distinto del de Node 24.
  await libro.xlsx.load((await generarExcel(datos)) as unknown as ExcelJS.Buffer);
  return libro;
}

/** Fila como objeto { encabezado: valor }. */
function fila(hoja: ExcelJS.Worksheet, numero: number): Record<string, ExcelJS.CellValue> {
  const salida: Record<string, ExcelJS.CellValue> = {};
  hoja.getRow(1).eachCell((celda, columna) => {
    salida[String(celda.value)] = hoja.getRow(numero).getCell(columna).value;
  });
  return salida;
}

describe("Excel de un lote", () => {
  it("trae las cuatro hojas", async () => {
    const libro = await abrir();
    expect(libro.worksheets.map((hoja) => hoja.name)).toEqual(["Facturas", "Ítems", "Clientes", "Resumen"]);
  });

  it("hoja Facturas: una fila por factura, con sus columnas", async () => {
    const hoja = (await abrir()).getWorksheet("Facturas")!;
    expect(hoja.rowCount).toBe(1 + 3);
    expect(Object.keys(fila(hoja, 1))).toEqual([
      "Archivo", "Número", "Fecha", "Proveedor", "NIT proveedor", "Documento cliente", "Cliente",
      "Valor antes de IVA", "IVA", "Impoconsumo", "Total", "Estado", "Motivos", "Confianza OCR",
    ]);
    expect(fila(hoja, 2)).toMatchObject({ Archivo: "factura_0001.jpg", "Número": "FE-000001", Estado: "aceptada", "Documento cliente": "869745262" });
    expect(fila(hoja, 3).Motivos).toBe("El total no cuadra; Ítem 1: no se pudo leer completo");
  });

  it("los importes son NÚMEROS con formato de moneda, no texto", async () => {
    const hoja = (await abrir()).getWorksheet("Facturas")!;
    const total = hoja.getRow(2).getCell(11);
    expect(total.value).toBe(1190000);
    expect(typeof total.value).toBe("number");
    expect(total.numFmt).toBe('"$"#,##0');
    expect(fila(hoja, 3).Impoconsumo).toBe(80000);
    // Se puede sumar la columna: es lo que comprueba la verificación de la fase.
    const suma = [2, 3, 4].reduce((s, n) => s + (Number(hoja.getRow(n).getCell(11).value) || 0), 0);
    expect(suma).toBe(1190000 + 2460000);
  });

  it("la fecha es una FECHA real (sin corrimiento de zona horaria)", async () => {
    const hoja = (await abrir()).getWorksheet("Facturas")!;
    const fecha = hoja.getRow(2).getCell(3);
    expect(fecha.value).toBeInstanceOf(Date);
    expect((fecha.value as Date).toISOString().slice(0, 10)).toBe("2026-10-16");
    expect(fecha.numFmt).toBe("yyyy-mm-dd");
  });

  it("lo que no se leyó queda vacío: no se escribe 0 ni «null»", async () => {
    const hoja = (await abrir()).getWorksheet("Facturas")!;
    const vacia = fila(hoja, 4);
    expect(vacia.Total).toBeNull();
    expect(vacia["Número"]).toBeNull();
    expect(vacia.Fecha).toBeNull();
    expect(vacia.Archivo).toBe("factura_0003.jpg");
  });

  it("encabezados en negrita, con filtro automático y fila fija", async () => {
    const hoja = (await abrir()).getWorksheet("Facturas")!;
    expect(hoja.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(hoja.autoFilter).toBeTruthy();
    expect(hoja.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("hoja Ítems: una fila por ítem, con el número de su factura", async () => {
    const hoja = (await abrir()).getWorksheet("Ítems")!;
    expect(hoja.rowCount).toBe(1 + 3);
    expect(fila(hoja, 2)).toEqual({ "Número de factura": "FE-000001", "Descripción": "Monitor", Cantidad: 2, "Precio unitario": 400000, Subtotal: 800000 });
    expect(fila(hoja, 4).Cantidad).toBeNull(); // la cantidad que el OCR no leyó
  });

  it("hoja Clientes: agrupa por documento y usa el nombre guardado del cliente", async () => {
    const hoja = (await abrir()).getWorksheet("Clientes")!;
    expect(hoja.rowCount).toBe(1 + 1); // la factura sin documento no cuenta para ningún cliente
    expect(fila(hoja, 2)).toEqual({
      Documento: "869745262",
      Nombre: "Inversiones Rangel Batista S.A.S.",
      "Número de facturas": 2,
      "Total comprado": 1190000 + 2460000,
    });
  });

  it("hoja Resumen: cuenta los resultados de la cola del lote", async () => {
    const hoja = (await abrir()).getWorksheet("Resumen")!;
    const resumen: Record<string, ExcelJS.CellValue> = {};
    hoja.eachRow((r) => {
      resumen[String(r.getCell(1).value)] = r.getCell(2).value;
    });
    expect(resumen).toMatchObject({
      Carpeta: "facturas-octubre",
      "Total de archivos": 4,
      Aceptadas: 1,
      "En revisión": 1,
      Duplicadas: 1,
      "Con error": 1,
      "Clientes nuevos": 1,
      "Clientes existentes": 1,
      "Duración": "1 min 5 s",
    });
  });

  it("hoja Resumen: cuenta aparte las facturas revisadas a mano (Fase 9)", async () => {
    // «En revisión» sigue contando lo que dijo la máquina; lo corregido se ve en su propia fila.
    const corregida = factura({ numero: "FE-000009", archivo: "factura_0009.png", corregidaManualmente: true, corregidaPor: "persona@correo.com" });
    const hoja = (await abrir({ ...DATOS, facturas: [...DATOS.facturas, corregida] })).getWorksheet("Resumen")!;
    const resumen: Record<string, ExcelJS.CellValue> = {};
    hoja.eachRow((r) => {
      resumen[String(r.getCell(1).value)] = r.getCell(2).value;
    });
    expect(resumen["Revisadas a mano"]).toBe(1);
    expect(resumen["En revisión"]).toBe(1);
  });

  it("un lote sin facturas genera un Excel válido solo con encabezados", async () => {
    const libro = await abrir({ ...DATOS, archivos: [], facturas: [], totalArchivos: 0 });
    expect(libro.getWorksheet("Facturas")!.rowCount).toBe(1);
  });
});

describe("nombre del Excel en el almacén", () => {
  it("usa la hora de Colombia, no la del servidor (UTC)", () => {
    // 03:30 UTC del 11 de noviembre son las 22:30 del día 10 en Bogotá (UTC−5).
    expect(nombreExcel("lote1", new Date("2026-11-11T03:30:00Z"))).toBe("procesos/lote1/resultado_2026-11-10_2230.xlsx");
    expect(nombreExcel("lote1", new Date("2026-03-05T14:07:00Z"))).toBe("procesos/lote1/resultado_2026-03-05_0907.xlsx");
  });
});
