/*
 * La regla que decide si se permite «Borrar todo». Función PURA: la usan el
 * servidor (que es quien decide) y el navegador (para activar el botón).
 *
 * Borrar todo es irreversible, así que hay dos barreras:
 *  1. escribir exactamente la palabra BORRAR (un clic por error no basta);
 *  2. si hay lotes procesándose, una confirmación aparte: borrar a mitad deja a
 *     las funciones en marcha escribiendo sobre datos que ya no existen.
 */

export const PALABRA_PARA_BORRAR = "BORRAR";

export type VeredictoBorrado = { permitido: true } | { permitido: false; status: 400 | 409; error: string };

export function revisarPeticionDeBorrado(cuerpo: unknown, lotesProcesando: number): VeredictoBorrado {
  const datos = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;

  // Comparación exacta: ni minúsculas, ni espacios de más.
  if (datos.confirmacion !== PALABRA_PARA_BORRAR) {
    return { permitido: false, status: 400, error: `Para borrar hay que escribir exactamente ${PALABRA_PARA_BORRAR}` };
  }
  if (lotesProcesando > 0 && datos.aunqueHayaLotesProcesando !== true) {
    return {
      permitido: false,
      status: 409,
      error: `Hay ${lotesProcesando} lote(s) procesándose. Espera a que terminen o confirma que quieres borrar de todos modos.`,
    };
  }
  return { permitido: true };
}
