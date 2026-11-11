/*
 * Lee de Firestore lo que necesita el Excel de un lote: SOLO servidor.
 *
 * El Excel se arma a partir de la BASE, no de lo que pasó por la memoria de las
 * funciones: así muestra exactamente lo que quedó guardado.
 */
import type { DocumentReference } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { COLECCIONES, type ArchivoCola, type Cliente, type Factura, type Proceso } from "@/lib/modelo/tipos";
import { coleccionArchivos } from "@/lib/procesamiento/proceso";
import type { DatosExcel } from "./generar";

const POR_TANDA = 300;

/** getAll por tandas (y sin fallar con una lista vacía). */
async function leerTodos<T>(referencias: DocumentReference[]): Promise<Map<string, T>> {
  const leidos = new Map<string, T>();
  for (let i = 0; i < referencias.length; i += POR_TANDA) {
    for (const documento of await db().getAll(...referencias.slice(i, i + POR_TANDA))) {
      if (documento.exists) leidos.set(documento.id, documento.data() as T);
    }
  }
  return leidos;
}

export async function cargarDatosExcel(procesoId: string, proceso: Proceso, fin: number): Promise<DatosExcel> {
  const archivos = (await coleccionArchivos(procesoId).get()).docs.map((documento) => documento.data() as ArchivoCola);

  // Los hash distintos de la cola, en su orden. Se incluyen los archivos
  // «duplicados»: su factura la guardó otro lote, pero pertenece a esta carpeta
  // (si no, el Excel de un reproceso saldría vacío).
  const hashes = [...new Set(archivos.map((archivo) => archivo.hashArchivo).filter((hash): hash is string => hash !== null))];
  const porHash = await leerTodos<Factura>(hashes.map((hash) => db().collection(COLECCIONES.facturas).doc(hash)));
  const facturas = hashes.map((hash) => porHash.get(hash)).filter((factura): factura is Factura => factura !== undefined);

  const documentos = [...new Set(facturas.map((f) => f.clienteDocumento).filter((d): d is string => d !== null))];
  const clientes = await leerTodos<Cliente>(documentos.map((documento) => db().collection(COLECCIONES.clientes).doc(documento)));

  return {
    carpeta: proceso.carpeta,
    totalArchivos: proceso.totalArchivos,
    duracionMs: fin - proceso.inicio,
    archivos,
    facturas,
    nombresClientes: Object.fromEntries([...clientes].map(([documento, cliente]) => [documento, cliente.nombre])),
  };
}
