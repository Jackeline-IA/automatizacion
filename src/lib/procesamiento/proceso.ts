/*
 * Acceso a un lote: SOLO servidor. Todas las rutas de /api/procesos/[id]/…
 * pasan por aquí para comprobar que el lote existe y es de quien inició sesión.
 */
import type { CollectionReference, DocumentReference } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { COLECCIONES, type Proceso } from "@/lib/modelo/tipos";
import { idProcesoValido } from "@/lib/rutas";

export function referenciaProceso(procesoId: string): DocumentReference {
  return db().collection(COLECCIONES.procesos).doc(procesoId);
}

/** La cola de trabajo del lote: procesos/{id}/archivos. */
export function coleccionArchivos(procesoId: string): CollectionReference {
  return referenciaProceso(procesoId).collection(COLECCIONES.archivos);
}

/** El lote, si existe y es del usuario; si no, null. */
export async function procesoDelUsuario(procesoId: string, uid: string): Promise<Proceso | null> {
  if (!idProcesoValido(procesoId)) return null;
  const proceso = (await referenciaProceso(procesoId).get()).data() as Proceso | undefined;
  return proceso && proceso.uid === uid ? proceso : null;
}

/** Mismo 404 si el lote no existe o si es de otro usuario: no se revela que existe. */
export function loteNoEncontrado(): Response {
  return Response.json({ error: "El lote no existe" }, { status: 404 });
}
