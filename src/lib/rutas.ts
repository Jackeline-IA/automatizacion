/*
 * Nombres de los archivos dentro del almacén. Funciones puras.
 *
 * Cada lote guarda sus imágenes bajo procesos/<id>/. El nombre final lo decide
 * el servidor: lo que envía el navegador se limpia, para que nadie pueda escribir
 * fuera de la carpeta de su lote ni usar caracteres que el almacén rechaza.
 */
import { EXTENSION, type TipoImagen } from "./imagen";

const LARGO_MAXIMO_NOMBRE = 60;

/** ¿Tiene forma de ID de documento de Firestore? Evita rutas como «../clientes». */
export function idProcesoValido(id: string): boolean {
  return /^[A-Za-z0-9]{1,40}$/.test(id);
}

export function prefijoProceso(procesoId: string): string {
  return `procesos/${procesoId}/`;
}

/** Nombre sin carpetas, extensión, tildes, espacios ni símbolos. */
export function nombreLimpio(nombre: string): string {
  const sinCarpetas = nombre.split(/[\\/]/).pop() ?? "";
  const limpio = sinCarpetas
    .replace(/\.[A-Za-z0-9]{1,5}$/, "") // la extensión la pone el tipo real
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tildes: «ñ» → «n», «á» → «a»
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LARGO_MAXIMO_NOMBRE);
  return limpio || "archivo";
}

/**
 * procesos/<id>/<NNNN>-<nombre limpio>.<extensión del tipo real>
 * El índice va delante para que dos archivos con el mismo nombre no se pisen y
 * para que el listado salga en el orden de la carpeta original.
 */
export function rutaImagen(procesoId: string, indice: number, nombre: string, tipo: TipoImagen): string {
  const numero = String(indice).padStart(4, "0");
  return `${prefijoProceso(procesoId)}${numero}-${nombreLimpio(nombre)}.${EXTENSION[tipo]}`;
}
