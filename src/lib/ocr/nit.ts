/*
 * Dígito de verificación (DV) del NIT, algoritmo de la DIAN.
 *
 * Sirve para detectar documentos mal leídos por el OCR. Detecta cerca del 98 %
 * de los errores de un dígito, NO todos: es un filtro, no una garantía.
 */

// Se aplican a los dígitos de derecha a izquierda.
const PESOS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** DV del número (sin puntos, guion ni DV), o null si no son solo dígitos. */
export function calcularDv(numero: string): number | null {
  if (!/^\d{1,15}$/.test(numero)) return null;
  let suma = 0;
  for (let i = 0; i < numero.length; i += 1) {
    suma += Number(numero[numero.length - 1 - i]) * PESOS[i];
  }
  const resto = suma % 11;
  return resto > 1 ? 11 - resto : resto;
}

export function dvValido(numero: string, dv: number | null): boolean {
  return dv !== null && calcularDv(numero) === dv;
}
