/*
 * Reglas de la subida de imágenes: SOLO servidor.
 *  - a qué lote se puede subir (existe, es del usuario y sigue en «subiendo»);
 *  - qué imagen se acepta (tamaño, y que de verdad se pueda decodificar).
 */
import sharp from "sharp";
import { db } from "@/lib/firebase/admin";
import { COLECCIONES, type Proceso } from "@/lib/modelo/tipos";
import { idProcesoValido } from "@/lib/rutas";

/** Vercel no deja pasar cuerpos de más de 4,5 MB; una factura pesa ~100 KB. */
export const TAMANO_MAXIMO_BYTES = 4 * 1024 * 1024;
/** Tope de píxeles: una imagen pequeña en bytes puede descomprimirse a algo enorme. */
export const PIXELES_MAXIMOS = 40_000_000;
/** Imágenes por lote que admite `POST /api/procesos`. */
export const MAXIMO_ARCHIVOS_POR_LOTE = 1000;

// Se recuerda 20 s que un lote está abierto para no leer Firestore por cada
// imagen (100 imágenes de un lote = 1 lectura, no 100). Solo se recuerdan los
// «sí»: un «no» se vuelve a comprobar siempre. La memoria es de esta instancia.
const RECORDAR_MS = 20_000;
const abiertos = new Map<string, { hasta: number; totalArchivos: number }>();

/**
 * Devuelve el total de archivos del lote si el usuario puede subir a él; si no,
 * null. No distingue «no existe» de «es de otro»: así no se revela que existe.
 */
export async function loteAbierto(procesoId: string, uid: string): Promise<{ totalArchivos: number } | null> {
  if (!idProcesoValido(procesoId)) return null;
  const clave = `${procesoId}:${uid}`;
  const recordado = abiertos.get(clave);
  if (recordado && recordado.hasta > Date.now()) return { totalArchivos: recordado.totalArchivos };

  const documento = await db().collection(COLECCIONES.procesos).doc(procesoId).get();
  const proceso = documento.data() as Proceso | undefined;
  if (!proceso || proceso.uid !== uid || proceso.estado !== "subiendo") return null;

  abiertos.set(clave, { hasta: Date.now() + RECORDAR_MS, totalArchivos: proceso.totalArchivos });
  return { totalArchivos: proceso.totalArchivos };
}

/**
 * Lee el cuerpo de la petición sin pasar del tope: si lo supera, deja de leer y
 * devuelve null (no se carga en memoria un archivo de cualquier tamaño).
 */
export async function leerCuerpoLimitado(request: Request, maximo: number): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const lector = request.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximo) {
      await lector.cancel();
      return null;
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos);
}

/**
 * ¿La imagen se puede leer de verdad? La firma solo mira los primeros bytes: un
 * archivo cortado o dañado la conserva. Aquí se decodifica entera.
 */
export async function comprobarImagen(imagen: Buffer): Promise<"ok" | "ilegible" | "demasiados-pixeles"> {
  try {
    const { width = 0, height = 0 } = await sharp(imagen, { limitInputPixels: false }).metadata();
    if (width === 0 || height === 0) return "ilegible";
    if (width * height > PIXELES_MAXIMOS) return "demasiados-pixeles";
    await sharp(imagen, { failOn: "error" }).stats(); // decodifica todos los píxeles
    return "ok";
  } catch {
    return "ilegible";
  }
}
