/*
 * Genera el Excel de un lote. Función sin efectos: recibe los datos ya leídos de
 * la base (los carga datos.ts) y devuelve el archivo en memoria. Por eso se
 * prueba sin Firestore: la prueba vuelve a abrir el Excel y mira sus celdas.
 *
 * Con ~1000 filas basta el modo normal de exceljs; no hace falta streaming.
 */
import ExcelJS from "exceljs";
import type { ArchivoCola, Factura } from "../modelo/tipos";
import { prefijoProceso } from "../rutas";

export const CONTENT_TYPE_EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface DatosExcel {
  carpeta: string;
  totalArchivos: number;
  duracionMs: number;
  /** La cola del lote: de aquí salen los conteos del resumen. */
  archivos: Pick<ArchivoCola, "resultado" | "clienteNuevo" | "clienteExistente">[];
  /** Las facturas del lote, sin repetir (incluye las «duplicadas» de un reproceso). */
  facturas: Factura[];
  /** Nombre guardado de cada cliente, por documento. */
  nombresClientes: Record<string, string>;
}

// Importes como números con formato (nunca texto): así Excel puede sumarlos.
const MONEDA = '"$"#,##0';
const FECHA = "yyyy-mm-dd";

interface Columna {
  titulo: string;
  ancho: number;
  formato?: string;
}

/** Crea una hoja con encabezados en negrita, filtro automático y primera fila fija. */
function hojaConTabla(libro: ExcelJS.Workbook, nombre: string, columnas: Columna[], filas: ExcelJS.CellValue[][]): void {
  const hoja = libro.addWorksheet(nombre, { views: [{ state: "frozen", ySplit: 1 }] });
  hoja.columns = columnas.map((columna) => ({
    header: columna.titulo,
    width: columna.ancho,
    style: columna.formato ? { numFmt: columna.formato } : {},
  }));
  hoja.getRow(1).font = { bold: true };
  for (const fila of filas) hoja.addRow(fila);
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
}

/**
 * «2026-10-16» → fecha real. Se construye en UTC porque exceljs guarda las
 * fechas en UTC: con la hora local, el día podría correrse uno hacia atrás.
 */
function aFecha(iso: string | null): Date | null {
  if (!iso) return null;
  const [anio, mes, dia] = iso.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function duracion(ms: number): string {
  const segundos = Math.round(ms / 1000);
  return segundos < 60 ? `${segundos} s` : `${Math.floor(segundos / 60)} min ${segundos % 60} s`;
}

export async function generarExcel(datos: DatosExcel): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();

  hojaConTabla(
    libro,
    "Facturas",
    [
      { titulo: "Archivo", ancho: 24 },
      { titulo: "Número", ancho: 14 },
      { titulo: "Fecha", ancho: 13, formato: FECHA },
      { titulo: "Proveedor", ancho: 40 },
      { titulo: "NIT proveedor", ancho: 15 },
      { titulo: "Documento cliente", ancho: 18 },
      { titulo: "Cliente", ancho: 40 },
      { titulo: "Valor antes de IVA", ancho: 19, formato: MONEDA },
      { titulo: "IVA", ancho: 15, formato: MONEDA },
      { titulo: "Impoconsumo", ancho: 15, formato: MONEDA },
      { titulo: "Total", ancho: 17, formato: MONEDA },
      { titulo: "Estado", ancho: 11 },
      { titulo: "Motivos", ancho: 60 },
      { titulo: "Confianza OCR", ancho: 15 },
    ],
    datos.facturas.map((f) => [
      f.archivo,
      f.numero,
      aFecha(f.fecha),
      f.proveedor,
      f.nitProveedor,
      f.clienteDocumento,
      f.clienteNombre,
      f.subtotal,
      f.iva,
      f.impoconsumo,
      f.total,
      f.estado,
      f.motivos.join("; "),
      f.confianzaOcr === null ? null : Math.round(f.confianzaOcr),
    ]),
  );

  hojaConTabla(
    libro,
    "Ítems",
    [
      { titulo: "Número de factura", ancho: 18 },
      { titulo: "Descripción", ancho: 60 },
      { titulo: "Cantidad", ancho: 10 },
      { titulo: "Precio unitario", ancho: 17, formato: MONEDA },
      { titulo: "Subtotal", ancho: 17, formato: MONEDA },
    ],
    datos.facturas.flatMap((f) =>
      f.items.map((item) => [f.numero, item.descripcion, item.cantidad, item.precioUnitario, item.subtotal]),
    ),
  );

  // Un cliente se identifica por su documento: las facturas sin documento fiable
  // no se le atribuyen a nadie.
  const porCliente = new Map<string, { facturas: number; total: number }>();
  for (const f of datos.facturas) {
    if (!f.clienteDocumento) continue;
    const acumulado = porCliente.get(f.clienteDocumento) ?? { facturas: 0, total: 0 };
    acumulado.facturas += 1;
    acumulado.total += f.total ?? 0;
    porCliente.set(f.clienteDocumento, acumulado);
  }
  hojaConTabla(
    libro,
    "Clientes",
    [
      { titulo: "Documento", ancho: 15 },
      { titulo: "Nombre", ancho: 45 },
      { titulo: "Número de facturas", ancho: 19 },
      { titulo: "Total comprado", ancho: 19, formato: MONEDA },
    ],
    [...porCliente].map(([documento, { facturas, total }]) => [
      documento,
      datos.nombresClientes[documento] ?? "",
      facturas,
      total,
    ]),
  );

  const cuantos = (condicion: (archivo: DatosExcel["archivos"][number]) => boolean) => datos.archivos.filter(condicion).length;
  const resumen = libro.addWorksheet("Resumen");
  resumen.columns = [{ width: 24 }, { width: 30 }];
  resumen.addRows([
    ["Carpeta", datos.carpeta],
    ["Total de archivos", datos.totalArchivos],
    ["Aceptadas", cuantos((a) => a.resultado === "aceptada")],
    ["En revisión", cuantos((a) => a.resultado === "revision")],
    ["Duplicadas", cuantos((a) => a.resultado === "duplicada")],
    ["Con error", cuantos((a) => a.resultado === "error")],
    ["Clientes nuevos", cuantos((a) => a.clienteNuevo)],
    ["Clientes existentes", cuantos((a) => a.clienteExistente)],
    ["Duración", duracion(datos.duracionMs)],
  ]);
  resumen.getColumn(1).font = { bold: true };

  return Buffer.from(await libro.xlsx.writeBuffer());
}

/**
 * procesos/<id>/resultado_AAAA-MM-DD_HHmm.xlsx, con la hora de Colombia (el
 * servidor corre en UTC). La hora en el nombre evita pisar un Excel anterior.
 */
export function nombreExcel(procesoId: string, cuando: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(cuando);
  const p = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${prefijoProceso(procesoId)}resultado_${p("year")}-${p("month")}-${p("day")}_${p("hour")}${p("minute")}.xlsx`;
}
