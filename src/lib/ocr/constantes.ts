/*
 * Tarifas tributarias, en un solo lugar: si cambia la ley, se actualiza una vez.
 * Son las del ejercicio del curso; para datos reales se verifican con un contador.
 */

/** IVA general. */
export const TARIFA_IVA = 0.19;

/** Impuesto nacional al consumo (telefonía móvil y datos), sobre el valor sin IVA. */
export const TARIFA_IMPOCONSUMO = 0.04;

/** Diferencia máxima, en pesos, al comparar un impuesto calculado con el impreso (redondeo). */
export const TOLERANCIA_PESOS = 1;

/** Una razón social con menos letras que esto se considera ilegible. */
export const MINIMO_LETRAS_RAZON_SOCIAL = 6;
