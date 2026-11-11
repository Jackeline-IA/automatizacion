/*
 * Métricas de un lote: funciones PURAS (sin Firestore), para el servidor y el
 * navegador. Aquí se decide qué contador sube con cada factura y cómo se suman y
 * resumen; metricas-firestore.ts solo traduce esos cambios a incrementos.
 *
 * Definiciones que usa la interfaz:
 *  - Leída correctamente = pasó TODAS las validaciones. No se compara con una
 *    respuesta conocida: un error que cuadre aritméticamente podría pasar.
 *  - Mal leída = quedó en revisión o dio error.
 *  - Los porcentajes son sobre las facturas DISTINTAS procesadas (aceptadas +
 *    revisión + errores). Las duplicadas no cuentan: ya estaban guardadas.
 */
import type { Importes, MetricasProceso } from "../modelo/tipos";

/** Lo que le pasó a un archivo del lote, con lo necesario para contarlo. */
export type EventoMetricas =
  | {
      tipo: "aceptada" | "revision";
      subtotal: number | null;
      iva: number | null;
      impoconsumo: number | null;
      total: number | null;
      nitProveedor: string | null;
      proveedor: string | null;
      /** La factura creó un cliente que no existía. */
      clienteNuevo: boolean;
    }
  | { tipo: "duplicada" }
  | { tipo: "error" };

/** Un cambio sobre `metricas`: sumar a un contador o fijar un texto. `ruta` son las claves anidadas. */
export type CambioMetricas = { ruta: string[]; incremento: number } | { ruta: string[]; valor: string };

const CAMPOS_IMPORTE = ["subtotal", "iva", "impoconsumo", "total"] as const;

const importesVacios = (): Importes => ({ n: 0, subtotal: 0, iva: 0, impoconsumo: 0, total: 0 });

export function metricasVacias(): MetricasProceso {
  return {
    aceptadas: importesVacios(),
    revision: importesVacios(),
    manuales: importesVacios(),
    errores: 0,
    duplicadas: 0,
    clientesNuevos: 0,
    proveedores: {},
  };
}

/** Qué contadores sube un evento. Lo que el OCR no leyó (null) suma 0. */
export function cambiosDe(evento: EventoMetricas): CambioMetricas[] {
  if (evento.tipo === "duplicada") return [{ ruta: ["duplicadas"], incremento: 1 }];
  if (evento.tipo === "error") return [{ ruta: ["errores"], incremento: 1 }];

  const grupo = evento.tipo === "aceptada" ? "aceptadas" : "revision";
  const sumarEn = (base: string[]): CambioMetricas[] => [
    { ruta: [...base, "n"], incremento: 1 },
    ...CAMPOS_IMPORTE.map((campo) => ({ ruta: [...base, campo], incremento: evento[campo] ?? 0 })),
  ];

  const cambios = sumarEn([grupo]);
  if (evento.clienteNuevo) cambios.push({ ruta: ["clientesNuevos"], incremento: 1 });
  // Por proveedor solo cuentan las aceptadas: en revisión el NIT puede estar mal leído.
  if (evento.tipo === "aceptada" && evento.nitProveedor) {
    const base = ["proveedores", evento.nitProveedor];
    cambios.push({ ruta: [...base, "nombre"], valor: evento.proveedor ?? "" }, ...sumarEn(base));
  }
  return cambios;
}

/** Aplica cambios a unas métricas en memoria (lo mismo que Firestore hace con los incrementos). */
function aplicar(metricas: MetricasProceso, cambios: CambioMetricas[]): void {
  for (const cambio of cambios) {
    let nodo = metricas as unknown as Record<string, unknown>;
    for (const clave of cambio.ruta.slice(0, -1)) {
      nodo[clave] ??= {};
      nodo = nodo[clave] as Record<string, unknown>;
    }
    const ultima = cambio.ruta[cambio.ruta.length - 1];
    if ("valor" in cambio) nodo[ultima] = cambio.valor;
    else nodo[ultima] = ((nodo[ultima] as number | undefined) ?? 0) + cambio.incremento;
  }
}

/** Reconstruye las métricas de un lote a partir de lo que le pasó a cada archivo. */
export function metricasDesdeEventos(eventos: EventoMetricas[]): MetricasProceso {
  const metricas = metricasVacias();
  for (const evento of eventos) aplicar(metricas, cambiosDe(evento));
  return metricas;
}

function sumarImportes(a: Importes, b: Importes | undefined): Importes {
  return {
    n: a.n + (b?.n ?? 0),
    subtotal: a.subtotal + (b?.subtotal ?? 0),
    iva: a.iva + (b?.iva ?? 0),
    impoconsumo: a.impoconsumo + (b?.impoconsumo ?? 0),
    total: a.total + (b?.total ?? 0),
  };
}

/** Suma las métricas de varios lotes. Un lote sin métricas (anterior a la Fase 8) cuenta como ceros. */
export function sumarMetricas(lotes: (MetricasProceso | undefined)[]): MetricasProceso {
  const total = metricasVacias();
  for (const lote of lotes) {
    if (!lote) continue;
    total.aceptadas = sumarImportes(total.aceptadas, lote.aceptadas);
    total.revision = sumarImportes(total.revision, lote.revision);
    total.manuales = sumarImportes(total.manuales, lote.manuales);
    total.errores += lote.errores ?? 0;
    total.duplicadas += lote.duplicadas ?? 0;
    total.clientesNuevos += lote.clientesNuevos ?? 0;
    for (const [nit, proveedor] of Object.entries(lote.proveedores ?? {})) {
      const acumulado = total.proveedores[nit] ?? { ...importesVacios(), nombre: proveedor.nombre };
      total.proveedores[nit] = { ...sumarImportes(acumulado, proveedor), nombre: acumulado.nombre || proveedor.nombre };
    }
  }
  return total;
}

export interface Tasas {
  /** Facturas distintas procesadas: aceptadas + en revisión + con error. */
  procesadas: number;
  correctas: number;
  malLeidas: number;
  porcentajeCorrectas: number;
  porcentajeMalLeidas: number;
}

export function calcularTasas(metricas: MetricasProceso): Tasas {
  const correctas = metricas.aceptadas.n;
  const malLeidas = metricas.revision.n + metricas.errores;
  const procesadas = correctas + malLeidas;
  const porcentaje = (parte: number) => (procesadas === 0 ? 0 : Math.round((parte / procesadas) * 100));
  return {
    procesadas,
    correctas,
    malLeidas,
    porcentajeCorrectas: porcentaje(correctas),
    // El complemento, para que los dos porcentajes sumen 100 pese al redondeo.
    porcentajeMalLeidas: procesadas === 0 ? 0 : 100 - porcentaje(correctas),
  };
}

/** Proveedores de mayor a menor total, con su NIT. */
export function proveedoresOrdenados(metricas: MetricasProceso): (Importes & { nit: string; nombre: string })[] {
  return Object.entries(metricas.proveedores)
    .map(([nit, proveedor]) => ({ nit, ...proveedor }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
}
