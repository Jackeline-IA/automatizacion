/*
 * Cerrar un lote cuando ya no queda nada por procesar. Idempotente: llamarlo dos
 * veces, o desde dos pestañas a la vez, deja el lote terminado una sola vez.
 */
import { db } from "@/lib/firebase/admin";
import type { Proceso } from "@/lib/modelo/tipos";
import { contarPendientes } from "./cola";
import { referenciaProceso } from "./proceso";

/** Mientras alguien tiene el cierre, los demás esperan; si se cae, caduca solo. */
const BLOQUEO_CIERRE_MS = 2 * 60 * 1000;

export type ResultadoFinalizar =
  | { listo: true; yaEstaba: boolean }
  | { listo: false; motivo: "pendientes"; pendientes: number }
  | { listo: false; motivo: "sin-iniciar" | "otro-lo-esta-cerrando" };

export async function finalizarProceso(procesoId: string): Promise<ResultadoFinalizar> {
  const pendientes = await contarPendientes(procesoId);
  if (pendientes > 0) return { listo: false, motivo: "pendientes", pendientes };

  const referencia = referenciaProceso(procesoId);
  const ahora = Date.now();

  // Tomar el cierre en una transacción: solo un cliente pasa de aquí. En la
  // Fase 7 esto protege la generación del Excel (que no debe hacerse dos veces).
  const turno = await db().runTransaction(async (tx) => {
    const proceso = (await tx.get(referencia)).data() as Proceso;
    if (proceso.estado === "terminado") return "ya-terminado" as const;
    if (proceso.estado === "subiendo") return "sin-iniciar" as const;
    if (proceso.finalizandoDesde !== null && ahora - proceso.finalizandoDesde < BLOQUEO_CIERRE_MS) {
      return "otro-lo-esta-cerrando" as const;
    }
    tx.update(referencia, { finalizandoDesde: ahora });
    return "mio" as const;
  });

  if (turno === "ya-terminado") return { listo: true, yaEstaba: true };
  if (turno !== "mio") return { listo: false, motivo: turno };

  // (Fase 7: aquí se genera el Excel y se guarda su ruta en `rutaExcel`.)
  await referencia.update({ estado: "terminado", fin: Date.now(), finalizandoDesde: null });
  return { listo: true, yaEstaba: false };
}
