/*
 * «Borrar todo»: vacía lo que la aplicación ha guardado. SOLO servidor.
 *
 * Borra los datos de TODOS los usuarios (está pensado para practicar desde cero
 * con datos de prueba): facturas, índices de número, clientes, lotes (con su
 * cola) y las imágenes y Excel del almacén. Es irreversible y cada documento
 * borrado cuenta contra el límite diario de borrados de Firestore.
 *
 * No toca las cuentas de usuario ni las carpetas del bucket que no creó la
 * aplicación.
 */
import { borrarCarpetaConSubcarpetas } from "@/lib/almacen";
import { db } from "@/lib/firebase/admin";
import { COLECCIONES } from "@/lib/modelo/tipos";

export interface ResultadoBorrado {
  facturas: number;
  indices: number;
  clientes: number;
  lotes: number;
  archivos: number;
}

const coleccion = (nombre: string) => db().collection(nombre);
const contar = async (nombre: string) => (await coleccion(nombre).count().get()).data().count;

/** Cuántos lotes (de cualquier usuario) están procesándose ahora mismo. */
export async function contarLotesProcesando(): Promise<number> {
  return (await coleccion(COLECCIONES.procesos).where("estado", "==", "ejecutando").count().get()).data().count;
}

export async function borrarTodo(): Promise<ResultadoBorrado> {
  // Se cuenta antes de borrar, para poder decir qué se borró.
  const [facturas, indices, clientes, lotes] = await Promise.all([
    contar(COLECCIONES.facturas),
    contar(COLECCIONES.indicesNumero),
    contar(COLECCIONES.clientes),
    contar(COLECCIONES.procesos),
  ]);

  // recursiveDelete borra también las subcolecciones: la cola (archivos) de cada lote.
  // Primero los lotes: así el Motor de cualquier pestaña recibe 404 y deja de trabajar.
  await db().recursiveDelete(coleccion(COLECCIONES.procesos));
  await Promise.all([
    db().recursiveDelete(coleccion(COLECCIONES.facturas)),
    db().recursiveDelete(coleccion(COLECCIONES.indicesNumero)),
    db().recursiveDelete(coleccion(COLECCIONES.clientes)),
  ]);

  // Todo lo que la aplicación guarda en el almacén está bajo procesos/<id>/.
  const archivos = await borrarCarpetaConSubcarpetas("procesos");

  return { facturas, indices, clientes, lotes, archivos };
}
