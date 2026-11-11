/*
 * Validación pura de imágenes por sus bytes (sin red, sin disco: se prueba sola).
 *
 * El tipo de un archivo NO se decide por su nombre ni por el content-type que
 * declara el navegador: ambos los escribe quien envía el archivo. Lo único que no
 * se puede falsear sin cambiar el contenido son sus primeros bytes (la «firma»).
 */

export type TipoImagen = "png" | "jpeg";

/** Extensión con la que se guarda cada tipo. */
export const EXTENSION: Record<TipoImagen, string> = { png: "png", jpeg: "jpg" };
export const CONTENT_TYPE: Record<TipoImagen, string> = { png: "image/png", jpeg: "image/jpeg" };

// Todo PNG empieza por estos 8 bytes; todo JPEG, por FF D8 FF.
const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FIRMA_JPEG = [0xff, 0xd8, 0xff];

function empiezaPor(bytes: Uint8Array, firma: number[]): boolean {
  return bytes.length >= firma.length && firma.every((valor, i) => bytes[i] === valor);
}

/** El tipo real de la imagen según su firma, o null si no es PNG ni JPEG. */
export function tipoPorFirma(bytes: Uint8Array): TipoImagen | null {
  if (empiezaPor(bytes, FIRMA_PNG)) return "png";
  if (empiezaPor(bytes, FIRMA_JPEG)) return "jpeg";
  return null;
}
