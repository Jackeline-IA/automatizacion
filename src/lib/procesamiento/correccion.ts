/*
 * Revisión manual (Fase 9): funciones PURAS que comparten el navegador (para
 * validar en vivo y proponer totales) y el servidor (que repite la validación y
 * calcula los contadores). Nada de Firestore ni de servidor aquí.
 */
import type { Factura } from "../modelo/tipos";
import { TARIFA_IMPOCONSUMO, TARIFA_IVA } from "../ocr/constantes";
import type { ParcialFactura } from "../ocr/tipos";
import { validar } from "../ocr/validador";
import type { EntradaCorreccion } from "./correccion-esquema";
import type { CambioMetricas } from "./metricas";

const CAMPOS_IMPORTE = ["subtotal", "iva", "impoconsumo", "total"] as const;

/** Subtotal de un ítem: lo calcula la máquina, no lo escribe la persona. */
export function subtotalItem(cantidad: number | null, precioUnitario: number | null): number | null {
  return cantidad === null || precioUnitario === null ? null : cantidad * precioUnitario;
}

/** Lo corregido, con la forma que entienden las reglas del OCR. */
export function aParcial(entrada: EntradaCorreccion): ParcialFactura {
  return {
    numero: entrada.numero,
    fecha: entrada.fecha,
    proveedor: entrada.proveedor,
    nitProveedor: entrada.nitProveedor,
    dvProveedor: entrada.dvProveedor,
    clienteDocumento: entrada.clienteDocumento,
    clienteDv: entrada.clienteDv,
    clienteNombre: entrada.clienteNombre,
    items: entrada.items.map((item) => ({ ...item, subtotal: subtotalItem(item.cantidad, item.precioUnitario) })),
    subtotal: entrada.subtotal,
    iva: entrada.iva,
    impoconsumo: entrada.impoconsumo,
    mencionaImpoconsumo: entrada.impoconsumo !== null,
    total: entrada.total,
  };
}

/** Las MISMAS reglas que decidieron mandar la factura a revisión. Vacío = cuadra. */
export function motivosCorreccion(entrada: EntradaCorreccion): string[] {
  return validar(aParcial(entrada));
}

export interface TotalesPropuestos {
  subtotal: number;
  iva: number;
  impoconsumo: number | null;
  total: number;
}

/**
 * Totales que se proponen a partir de los ítems: IVA del 19 % y, solo si la
 * factura lo trae, impoconsumo del 4 %, redondeados a pesos. La persona puede
 * cambiarlos (la factura impresa manda).
 */
export function proponerTotales(
  items: { cantidad: number | null; precioUnitario: number | null }[],
  llevaImpoconsumo: boolean,
): TotalesPropuestos {
  const subtotal = items.reduce((suma, item) => suma + (subtotalItem(item.cantidad, item.precioUnitario) ?? 0), 0);
  const iva = Math.round(subtotal * TARIFA_IVA);
  const impoconsumo = llevaImpoconsumo ? Math.round(subtotal * TARIFA_IMPOCONSUMO) : null;
  return { subtotal, iva, impoconsumo, total: subtotal + iva + (impoconsumo ?? 0) };
}

/** Con qué llega el formulario: lo que la máquina alcanzó a leer (null = no lo leyó). */
export interface Precarga {
  numero: string | null;
  fecha: string | null;
  proveedor: string | null;
  nitProveedor: string | null;
  dvProveedor: number | null;
  clienteDocumento: string | null;
  clienteDv: number | null;
  clienteNombre: string | null;
  items: { descripcion: string; cantidad: number | null; precioUnitario: number | null }[];
  subtotal: number | null;
  iva: number | null;
  impoconsumo: number | null;
  total: number | null;
}

export function precargaDesdeFactura(f: Factura): Precarga {
  const items = f.items.map(({ descripcion, cantidad, precioUnitario }) => ({ descripcion, cantidad, precioUnitario }));
  return {
    numero: f.numero,
    fecha: f.fecha,
    proveedor: f.proveedor,
    nitProveedor: f.nitProveedor,
    // Facturas guardadas antes de la Fase 9 no tienen estos campos.
    dvProveedor: f.dvProveedor ?? null,
    // El documento LEÍDO, aunque no haya pasado el DV: la persona solo corrige lo que falle.
    clienteDocumento: f.clienteDocumento ?? f.clienteDocumentoLeido ?? null,
    clienteDv: f.clienteDv ?? null,
    clienteNombre: f.clienteNombre,
    // Una factura con error del OCR no trae ítems: siempre al menos una fila para llenar.
    items: items.length > 0 ? items : [{ descripcion: "", cantidad: null, precioUnitario: null }],
    subtotal: f.subtotal,
    iva: f.iva,
    impoconsumo: f.impoconsumo,
    total: f.total,
  };
}

/* --- El formulario trabaja con texto (lo que hay escrito en cada campo) --- */

export interface ItemCampos {
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
}

export interface CamposFormulario {
  numero: string;
  fecha: string;
  proveedor: string;
  nitProveedor: string;
  dvProveedor: string;
  clienteDocumento: string;
  clienteDv: string;
  clienteNombre: string;
  items: ItemCampos[];
  subtotal: string;
  iva: string;
  impoconsumo: string;
  total: string;
  llevaImpoconsumo: boolean;
}

/**
 * Un entero escrito por una persona: admite «$», espacios y puntos de miles.
 * null si está vacío; NaN si no es un entero (el esquema dirá qué está mal:
 * un decimal o una letra no se «arreglan» en silencio).
 */
export function leerEntero(texto: string): number | null {
  const limpio = texto.replace(/[$\s.]/g, "");
  if (limpio === "") return null;
  return /^-?\d+$/.test(limpio) ? Number(limpio) : Number.NaN;
}

const aTexto = (valor: number | string | null) => (valor === null ? "" : String(valor));

/** Campos del formulario a partir de lo que leyó la máquina; los totales que no leyó se proponen. */
export function camposDesdePrecarga(p: Precarga): CamposFormulario {
  const llevaImpoconsumo = p.impoconsumo !== null;
  const propuesta = proponerTotales(p.items, llevaImpoconsumo);
  return {
    numero: aTexto(p.numero),
    fecha: aTexto(p.fecha),
    proveedor: aTexto(p.proveedor),
    nitProveedor: aTexto(p.nitProveedor),
    dvProveedor: aTexto(p.dvProveedor),
    clienteDocumento: aTexto(p.clienteDocumento),
    clienteDv: aTexto(p.clienteDv),
    clienteNombre: aTexto(p.clienteNombre),
    items: p.items.map((item) => ({ descripcion: item.descripcion, cantidad: aTexto(item.cantidad), precioUnitario: aTexto(item.precioUnitario) })),
    subtotal: aTexto(p.subtotal ?? propuesta.subtotal),
    iva: aTexto(p.iva ?? propuesta.iva),
    impoconsumo: aTexto(p.impoconsumo),
    total: aTexto(p.total ?? propuesta.total),
    llevaImpoconsumo,
  };
}

/**
 * Lo que se envía en el PUT (y lo que se valida en vivo con el mismo esquema).
 * Un campo numérico vacío va como `undefined` para que el esquema diga «escribe
 * un número» en vez de tomarlo como cero.
 */
export function entradaDesdeCampos(c: CamposFormulario, confirmado: boolean): unknown {
  const numero = (texto: string) => leerEntero(texto) ?? undefined;
  return {
    numero: c.numero,
    fecha: c.fecha,
    proveedor: c.proveedor,
    nitProveedor: c.nitProveedor,
    dvProveedor: leerEntero(c.dvProveedor),
    clienteDocumento: c.clienteDocumento,
    clienteDv: leerEntero(c.clienteDv),
    clienteNombre: c.clienteNombre,
    items: c.items.map((item) => ({ descripcion: item.descripcion, cantidad: numero(item.cantidad), precioUnitario: numero(item.precioUnitario) })),
    subtotal: numero(c.subtotal),
    iva: numero(c.iva),
    impoconsumo: c.llevaImpoconsumo ? numero(c.impoconsumo) : null,
    total: numero(c.total),
    confirmado,
  };
}

/** Lo que de una factura corregida cuenta en los contadores. */
export interface ImportesCorreccion {
  subtotal: number;
  iva: number;
  impoconsumo: number | null;
  total: number;
  nitProveedor: string;
  proveedor: string;
}

/**
 * Qué contadores del lote cambian al guardar una corrección.
 *
 * Métricas honestas: «revisión» NO baja y «aceptadas» NO sube (miden a la
 * máquina). Lo corregido va a «manuales» y a su proveedor (para «lo procesado»).
 * En una reedición (`anterior` no es null) la factura ya estaba contada: solo se
 * aplican las diferencias. Los incrementos en cero se omiten.
 */
export function cambiosCorreccion(anterior: ImportesCorreccion | null, nueva: ImportesCorreccion, clienteNuevo: boolean): CambioMetricas[] {
  const cambios: CambioMetricas[] = [];
  const sumar = (base: string[], signo: 1 | -1, importes: ImportesCorreccion, restar?: ImportesCorreccion | null, contar = true) => {
    if (contar) cambios.push({ ruta: [...base, "n"], incremento: signo });
    for (const campo of CAMPOS_IMPORTE) {
      const diferencia = signo * ((importes[campo] ?? 0) - (restar?.[campo] ?? 0));
      if (diferencia !== 0) cambios.push({ ruta: [...base, campo], incremento: diferencia });
    }
  };

  // «manuales»: la factura cuenta una vez; en la reedición solo cambian los importes.
  sumar(["manuales"], 1, nueva, anterior, anterior === null);

  // Por proveedor: si sigue siendo el mismo NIT, diferencias; si cambió, sale de uno y entra al otro.
  const mismoProveedor = anterior !== null && anterior.nitProveedor === nueva.nitProveedor;
  if (anterior !== null && !mismoProveedor) sumar(["proveedores", anterior.nitProveedor], -1, anterior);
  const base = ["proveedores", nueva.nitProveedor];
  cambios.push({ ruta: [...base, "nombre"], valor: nueva.proveedor });
  sumar(base, 1, nueva, mismoProveedor ? anterior : null, !mismoProveedor);

  if (clienteNuevo) cambios.push({ ruta: ["clientesNuevos"], incremento: 1 });
  return cambios;
}
