/* Formatos de la interfaz (pesos colombianos, fechas y duraciones). Funciones puras. */

const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const ENTERO = new Intl.NumberFormat("es-CO");
const FECHA_HORA = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });

/** «$ 1.234.567»; una raya si el valor no se leyó. */
export function pesos(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? "—" : PESOS.format(valor);
}

export function entero(valor: number): string {
  return ENTERO.format(valor);
}

export function fechaHora(ms: number): string {
  return FECHA_HORA.format(new Date(ms));
}

export function megas(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const NOMBRE_ESTADO = { subiendo: "Subiendo", ejecutando: "Procesando", terminado: "Terminado" } as const;
