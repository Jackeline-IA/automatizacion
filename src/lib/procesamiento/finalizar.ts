/*
 * Cerrar un lote cuando ya no queda nada por procesar: genera su Excel y lo deja
 * «terminado». Idempotente: llamarlo dos veces, o desde dos pestañas a la vez,
 * deja el lote terminado (y un solo Excel) una sola vez.
 */
import { guardarArchivo } from "@/lib/almacen";
import { cargarDatosExcel } from "@/lib/excel/datos";
import { CONTENT_TYPE_EXCEL, generarExcel, nombreExcel } from "@/lib/excel/generar";
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

  // Tomar el cierre en una transacción: solo un cliente pasa de aquí, así el
  // Excel se genera una sola vez aunque dos pestañas finalicen a la vez.
  const turno = await db().runTransaction(async (tx) => {
    const proceso = (await tx.get(referencia)).data() as Proceso;
    if (proceso.estado === "terminado") return "ya-terminado" as const;
    if (proceso.estado === "subiendo") return "sin-iniciar" as const;
    if (proceso.finalizandoDesde !== null && ahora - proceso.finalizandoDesde < BLOQUEO_CIERRE_MS) {
      return "otro-lo-esta-cerrando" as const;
    }
    tx.update(referencia, { finalizandoDesde: ahora });
    return proceso;
  });

  if (turno === "ya-terminado") return { listo: true, yaEstaba: true };
  if (typeof turno === "string") return { listo: false, motivo: turno };

  // El Excel se arma leyendo la base y se guarda en el almacén (privado). Si
  // algo falla aquí, el lote no queda «terminado» y el bloqueo caduca solo: la
  // siguiente llamada a finalizar lo vuelve a intentar.
  const fin = Date.now();
  const excel = await generarExcel(await cargarDatosExcel(procesoId, turno, fin));
  const rutaExcel = nombreExcel(procesoId, new Date(fin));
  await guardarArchivo(rutaExcel, excel, CONTENT_TYPE_EXCEL);

  await referencia.update({ estado: "terminado", fin, rutaExcel, finalizandoDesde: null });
  return { listo: true, yaEstaba: false };
}
