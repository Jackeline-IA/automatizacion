/*
 * Iniciar un lote: crea la cola de trabajo a partir de lo que hay en el almacén.
 *
 * No se fía de lo que diga el navegador sobre qué subió: lista la carpeta del
 * lote. Es idempotente: el ID de cada documento de la cola sale del nombre del
 * archivo y se usa create(), así que repetir la llamada no duplica nada.
 */
import { listarImagenes } from "@/lib/almacen";
import { db } from "@/lib/firebase/admin";
import type { ArchivoCola } from "@/lib/modelo/tipos";
import { prefijoProceso } from "@/lib/rutas";
import { coleccionArchivos, referenciaProceso } from "./proceso";

// Código gRPC de «el documento ya existe».
const YA_EXISTE = 6;

export interface ResultadoIniciar {
  /** Imágenes del lote en el almacén. */
  total: number;
  /** Documentos de la cola creados en ESTA llamada (0 si ya se había iniciado). */
  nuevos: number;
}

export async function iniciarProceso(procesoId: string): Promise<ResultadoIniciar> {
  const rutas = await listarImagenes(prefijoProceso(procesoId));
  const cola = coleccionArchivos(procesoId);

  // BulkWriter reparte las escrituras en lotes (un lote admite 500 operaciones).
  const escritor = db().bulkWriter();
  // Sin reintentos automáticos: «ya existe» no es un fallo que se arregle reintentando.
  escritor.onWriteError(() => false);
  let nuevos = 0;
  const errores: unknown[] = [];

  for (const ruta of rutas) {
    const nombreEnAlmacen = ruta.slice(ruta.lastIndexOf("/") + 1); // «0001-factura_0001.jpg»
    const archivo: ArchivoCola = {
      rutaAlmacen: ruta,
      nombre: nombreEnAlmacen.replace(/^\d{4}-/, ""),
      estado: "pendiente",
      resultado: null,
      clienteNuevo: false,
      clienteExistente: false,
      hashArchivo: null,
      intentos: 0,
      error: null,
      disponibleDesde: 0, // disponible ya
    };
    escritor
      .create(cola.doc(nombreEnAlmacen), archivo)
      .then(() => {
        nuevos += 1;
      })
      .catch((error: { code?: number }) => {
        // El que ya existe se ignora: eso es lo que hace idempotente la llamada.
        if (error.code !== YA_EXISTE) errores.push(error);
      });
  }
  await escritor.close();
  if (errores.length > 0) throw new Error(`No se pudieron crear ${errores.length} archivo(s) de la cola`);

  // Solo se pasa de «subiendo» a «ejecutando»: un lote ya terminado no retrocede.
  await db().runTransaction(async (tx) => {
    const referencia = referenciaProceso(procesoId);
    const actual = (await tx.get(referencia)).data();
    if (actual?.estado === "subiendo") tx.update(referencia, { estado: "ejecutando", totalArchivos: rutas.length });
  });

  return { total: rutas.length, nuevos };
}
