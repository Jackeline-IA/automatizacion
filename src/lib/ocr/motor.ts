/*
 * Motor de OCR: SOLO servidor. Convierte una imagen (Buffer) en texto.
 *
 * Un único worker de tesseract.js por instancia de la función, guardado en
 * globalThis para reutilizarlo entre invocaciones (arrancarlo cuesta segundos).
 * En Vercel hay 1 vCPU: un pool de workers no aceleraría nada; el paralelismo
 * lo dan varias invocaciones concurrentes.
 */
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";

export type ModoLectura = "original" | "preprocesado" | "encabezado";

export interface LecturaOcr {
  texto: string;
  /** Confianza media que informa tesseract, de 0 a 100. */
  confianza: number;
}

/*
 * Los datos del idioma vienen del paquete npm: no hay descargas de red. Esta
 * carpeta la carga tesseract con una ruta calculada, así que el trazador de
 * Next no la ve: se incluye a mano en next.config.ts (outputFileTracingIncludes).
 */
const DATOS_IDIOMA = path.join(process.cwd(), "node_modules/@tesseract.js-data/spa/4.0.0_best_int");

/*
 * Topes de tiempo. El worker corre en un hilo aparte: si no puede cargar un
 * archivo, el hilo muere en silencio y su promesa NUNCA se resuelve. Sin tope la
 * función se quedaría colgada hasta agotar su tiempo (504).
 */
const TOPE_ARRANQUE_MS = 60_000;
const TOPE_LECTURA_MS = 60_000;

const global = globalThis as typeof globalThis & {
  __workerOcr?: Promise<Worker>;
  __colaOcr?: Promise<unknown>;
};

function conTope<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  let reloj: NodeJS.Timeout | undefined;
  const tope = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new Error(mensaje)), ms);
  });
  return Promise.race([promesa, tope]).finally(() => clearTimeout(reloj));
}

/** Olvida el worker actual (y lo apaga si llega a responder): el siguiente intento arranca uno nuevo. */
function descartarWorker(): void {
  const anterior = global.__workerOcr;
  global.__workerOcr = undefined;
  anterior?.then((worker) => worker.terminate()).catch(() => undefined);
}

async function obtenerWorker(): Promise<Worker> {
  global.__workerOcr ??= createWorker("spa", 1, {
    langPath: DATOS_IDIOMA,
    gzip: true, // los datos vienen como .traineddata.gz
    cachePath: os.tmpdir(), // /tmp es lo único escribible en Vercel
    cacheMethod: "none",
  });
  try {
    return await conTope(global.__workerOcr, TOPE_ARRANQUE_MS, "El motor de OCR no arrancó a tiempo");
  } catch (error) {
    descartarWorker();
    throw error;
  }
}

/** Las tres versiones de la imagen que se le dan a leer al OCR. */
async function preparar(imagen: Buffer, modo: ModoLectura): Promise<Buffer> {
  if (modo === "original") return imagen;
  if (modo === "preprocesado") {
    const { width = 1000 } = await sharp(imagen).metadata();
    return sharp(imagen)
      .rotate() // respeta la orientación EXIF
      .grayscale()
      .normalize()
      .resize({ width: Math.round(width * 1.5) })
      .sharpen()
      .png()
      .toBuffer();
  }
  // Encabezado: franja superior del 30 % en negativo. Recupera el texto blanco
  // sobre fondo de color (proveedor y NIT de uno de los diseños).
  const { width = 1000, height = 1000 } = await sharp(imagen).metadata();
  return sharp(imagen)
    .extract({ left: 0, top: 0, width, height: Math.round(height * 0.3) })
    .grayscale()
    .negate()
    .normalize()
    .png()
    .toBuffer();
}

async function leerAhora(imagen: Buffer, modo: ModoLectura): Promise<LecturaOcr> {
  const preparada = await preparar(imagen, modo);
  const worker = await obtenerWorker();
  try {
    const { data } = await conTope(worker.recognize(preparada), TOPE_LECTURA_MS, `El OCR no terminó a tiempo (${modo})`);
    return { texto: data.text, confianza: data.confidence };
  } catch (error) {
    // Un worker que falló o se colgó no se reutiliza.
    descartarWorker();
    throw error;
  }
}

/**
 * Lee una imagen con OCR. Las lecturas se hacen de una en una: el worker es uno
 * solo, y así el tope de tiempo de cada lectura empieza a contar cuando le toca.
 */
export function leerImagen(imagen: Buffer, modo: ModoLectura): Promise<LecturaOcr> {
  const turno = (global.__colaOcr ?? Promise.resolve()).then(() => leerAhora(imagen, modo));
  global.__colaOcr = turno.catch(() => undefined);
  return turno;
}
