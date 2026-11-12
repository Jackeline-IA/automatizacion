/*
 * Las facturas de un lote, para la tabla de su detalle: SOLO servidor.
 *
 * Cuesta ~2 lecturas por factura (su archivo en la cola + la factura): la
 * interfaz la pide UNA vez, cuando el lote termina, no en cada refresco.
 */
import { db } from "@/lib/firebase/admin";
import { COLECCIONES, type ArchivoCola, type Factura, type ResultadoArchivo } from "@/lib/modelo/tipos";
import { coleccionArchivos } from "./proceso";

const POR_TANDA = 300;

/** Una fila de la tabla. No incluye rutas del almacén ni el uid. */
export interface FacturaDeLote {
  /** ID de la factura (SHA-256 de la imagen); null si la imagen ni se pudo descargar. */
  hash: string | null;
  archivo: string;
  /** Qué le pasó a ESTE archivo en ESTE lote (una factura puede ser «duplicada» aquí). */
  resultado: ResultadoArchivo | null;
  error: string | null;
  numero: string | null;
  fecha: string | null;
  proveedor: string | null;
  clienteNombre: string | null;
  clienteDocumento: string | null;
  subtotal: number | null;
  iva: number | null;
  impoconsumo: number | null;
  total: number | null;
  estado: Factura["estado"] | null;
  motivos: string[];
  /** La corrigió una persona (Fase 9). */
  corregidaManualmente: boolean;
}

export async function facturasDelLote(procesoId: string): Promise<FacturaDeLote[]> {
  const archivos = (await coleccionArchivos(procesoId).get()).docs.map((documento) => documento.data() as ArchivoCola);

  const hashes = [...new Set(archivos.map((a) => a.hashArchivo).filter((hash): hash is string => hash !== null))];
  const porHash = new Map<string, Factura>();
  for (let i = 0; i < hashes.length; i += POR_TANDA) {
    const referencias = hashes.slice(i, i + POR_TANDA).map((hash) => db().collection(COLECCIONES.facturas).doc(hash));
    for (const documento of await db().getAll(...referencias)) {
      if (documento.exists) porHash.set(documento.id, documento.data() as Factura);
    }
  }

  return archivos.map((archivo) => {
    const f = archivo.hashArchivo ? porHash.get(archivo.hashArchivo) : undefined;
    return {
      hash: f ? archivo.hashArchivo : null,
      archivo: archivo.nombre,
      resultado: archivo.resultado,
      error: archivo.error,
      numero: f?.numero ?? null,
      fecha: f?.fecha ?? null,
      proveedor: f?.proveedor ?? null,
      clienteNombre: f?.clienteNombre ?? null,
      clienteDocumento: f?.clienteDocumento ?? null,
      subtotal: f?.subtotal ?? null,
      iva: f?.iva ?? null,
      impoconsumo: f?.impoconsumo ?? null,
      total: f?.total ?? null,
      estado: f?.estado ?? null,
      motivos: f?.motivos ?? [],
      corregidaManualmente: f?.corregidaManualmente === true,
    };
  });
}
