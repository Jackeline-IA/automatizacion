/*
 * La cola de trabajo de un lote (procesos/{id}/archivos), en Firestore.
 *
 * Sustituye a un gestor de trabajos en memoria, que no puede existir en Vercel.
 * Todo gira en torno a `disponibleDesde`, un ARRENDAMIENTO en milisegundos:
 *   0                → esperando;
 *   ahora + 5 min    → alguien lo está procesando (si esa función se cae, el
 *                      arrendamiento caduca solo y el archivo vuelve a la cola);
 *   TERMINADO        → ya no vuelve.
 * Así la cola se consulta con un solo campo y no hace falta un índice compuesto.
 */
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { TERMINADO, type ArchivoCola } from "@/lib/modelo/tipos";
import { coleccionArchivos } from "./proceso";

export const ARRENDAMIENTO_MS = 5 * 60 * 1000;
export const ARCHIVOS_POR_LOTE = 4;
export const INTENTOS_MAXIMOS = 3;

export interface ArchivoReclamado extends ArchivoCola {
  /** ID del documento en la cola (el nombre del archivo en el almacén). */
  id: string;
}

/**
 * Toma hasta `cantidad` archivos disponibles y los arrienda, todo en UNA
 * transacción: si dos invocaciones leen los mismos documentos, Firestore hace
 * reintentar a una de ellas, que al volver a leer ya no los ve disponibles.
 * `ahora` es un parámetro para poder probar la caducidad sin esperar 5 minutos.
 */
export async function reclamar(procesoId: string, cantidad = ARCHIVOS_POR_LOTE, ahora = Date.now()): Promise<ArchivoReclamado[]> {
  const cola = coleccionArchivos(procesoId);
  return db().runTransaction(async (tx) => {
    const disponibles = await tx.get(
      cola.where("disponibleDesde", "<=", ahora).orderBy("disponibleDesde").limit(cantidad),
    );
    return disponibles.docs.map((documento) => {
      const archivo = documento.data() as ArchivoCola;
      const cambios = {
        estado: "procesando" as const,
        intentos: archivo.intentos + 1,
        disponibleDesde: ahora + ARRENDAMIENTO_MS,
      };
      tx.update(documento.ref, cambios);
      return { ...archivo, ...cambios, id: documento.id };
    });
  });
}

/** Devuelve a la cola un archivo que no se llegó a empezar: no cuenta como intento. */
export async function devolver(procesoId: string, archivoId: string): Promise<void> {
  await coleccionArchivos(procesoId).doc(archivoId).update({
    estado: "pendiente",
    intentos: FieldValue.increment(-1),
    disponibleDesde: 0,
  });
}

/** Un intento falló pero quedan más: vuelve a la cola con el error anotado. */
export async function reintentarMasTarde(procesoId: string, archivoId: string, error: string): Promise<void> {
  await coleccionArchivos(procesoId).doc(archivoId).update({ estado: "pendiente", error, disponibleDesde: 0 });
}

/** Cuántos archivos del lote NO han terminado (esperando o arrendados). */
export async function contarPendientes(procesoId: string): Promise<number> {
  const conteo = await coleccionArchivos(procesoId).where("disponibleDesde", "<", TERMINADO).count().get();
  return conteo.data().count;
}
