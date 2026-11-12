/*
 * Lleva las métricas de un lote a Firestore: SOLO servidor.
 *
 * Traduce los cambios de metricas.ts a escrituras sobre procesos/{id}.metricas.
 * Se añaden a la MISMA transacción (o lote de escritura) que guarda la factura:
 * o se escriben las dos cosas o ninguna, así los contadores nunca se desfasan de
 * los datos aunque la función se caiga a mitad.
 *
 * Son escrituras «ciegas» (increment no lee el documento): dos funciones que
 * procesan el mismo lote a la vez no se hacen reintentar entre sí.
 */
import { FieldPath, FieldValue, type Transaction, type WriteBatch } from "firebase-admin/firestore";
import { cambiosDe, type CambioMetricas, type EventoMetricas } from "./metricas";
import { referenciaProceso } from "./proceso";

export function aplicarMetricas(escritura: Transaction | WriteBatch, procesoId: string, evento: EventoMetricas): void {
  aplicarCambiosMetricas(escritura, procesoId, cambiosDe(evento));
}

/** Escribe una lista de cambios ya calculada (la usa también la corrección manual, Fase 9). */
export function aplicarCambiosMetricas(escritura: Transaction | WriteBatch, procesoId: string, cambios: CambioMetricas[]): void {
  // Sin cambios no hay nada que escribir (update exige al menos un campo).
  if (cambios.length === 0) return;
  const pares: (FieldPath | FieldValue | string)[] = [];
  for (const cambio of cambios) {
    // FieldPath y no «metricas.proveedores.856162509.n»: el NIT es una clave
    // numérica y en una ruta con puntos no es un nombre de campo válido.
    pares.push(
      new FieldPath("metricas", ...cambio.ruta),
      "valor" in cambio ? cambio.valor : FieldValue.increment(cambio.incremento),
    );
  }
  const [campo, valor, ...resto] = pares;
  // Transaction y WriteBatch comparten esta firma (campo, valor, campo, valor…).
  (escritura as WriteBatch).update(referenciaProceso(procesoId), campo as FieldPath, valor, ...resto);
}
