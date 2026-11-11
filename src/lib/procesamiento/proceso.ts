/*
 * Acceso a un lote: SOLO servidor. Todas las rutas de /api/procesos/[id]/…
 * pasan por aquí para comprobar que el lote existe y es de quien inició sesión.
 */
import type { CollectionReference, DocumentReference } from "firebase-admin/firestore";
import { db } from "@/lib/firebase/admin";
import { COLECCIONES, type MetricasProceso, type Proceso } from "@/lib/modelo/tipos";
import { idProcesoValido } from "@/lib/rutas";
import { metricasVacias } from "./metricas";

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

/** Lo que la interfaz necesita saber de un lote (sin rutas internas del almacén). */
export interface ResumenProceso {
  id: string;
  carpeta: string;
  estado: Proceso["estado"];
  totalArchivos: number;
  inicio: number;
  fin: number | null;
  tieneExcel: boolean;
  metricas: MetricasProceso;
}

export function resumirProceso(id: string, proceso: Proceso): ResumenProceso {
  return {
    id,
    carpeta: proceso.carpeta,
    estado: proceso.estado,
    totalArchivos: proceso.totalArchivos,
    inicio: proceso.inicio,
    fin: proceso.fin,
    tieneExcel: proceso.rutaExcel !== null,
    // Un lote anterior a la Fase 8 no tiene contadores: se muestran en cero.
    metricas: { ...metricasVacias(), ...proceso.metricas },
  };
}

/**
 * Todos los lotes del usuario, del más reciente al más antiguo. Una sola
 * consulta por un solo campo (uid): filtrar u ordenar por otro campo en la
 * consulta pediría un índice compuesto, así que eso se hace aquí, en memoria.
 */
export async function lotesDelUsuario(uid: string): Promise<ResumenProceso[]> {
  const consulta = await db().collection(COLECCIONES.procesos).where("uid", "==", uid).get();
  return consulta.docs
    .map((documento) => resumirProceso(documento.id, documento.data() as Proceso))
    .sort((a, b) => b.inicio - a.inicio);
}

/** Mismo 404 si el lote no existe o si es de otro usuario: no se revela que existe. */
export function loteNoEncontrado(): Response {
  return Response.json({ error: "El lote no existe" }, { status: 404 });
}
