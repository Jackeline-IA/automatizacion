/*
 * Fase 4 — Guarda el texto que el OCR entrega para cada imagen, en tres modos.
 * Ese texto, con sus errores, es el material de trabajo del extractor y la
 * fuente de los textos de prueba: no se escriben expresiones regulares "a ojo".
 *
 * Uso: npx tsx scripts/ocr-muestras.ts <carpetaImagenes> <carpetaSalida>
 *
 * Solo lee imágenes y escribe archivos .txt en la carpeta de salida. Corre en
 * local, sin red (los datos del idioma vienen del paquete npm) y sin gastar cuota.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

const DATOS_IDIOMA = path.join(process.cwd(), "node_modules/@tesseract.js-data/spa/4.0.0_best_int");

type Modo = "original" | "preprocesado" | "encabezado";

/** Las tres lecturas que usará el motor de la Fase 5. */
async function preparar(imagen: Buffer, modo: Modo): Promise<Buffer> {
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
  // Encabezado: franja superior del 30 % en negativo, para recuperar texto
  // blanco sobre fondo de color (proveedor y NIT de uno de los diseños).
  const { width = 1000, height = 1000 } = await sharp(imagen).metadata();
  return sharp(imagen)
    .extract({ left: 0, top: 0, width, height: Math.round(height * 0.3) })
    .grayscale()
    .negate()
    .normalize()
    .png()
    .toBuffer();
}

async function main(): Promise<void> {
  const [carpetaImagenes, carpetaSalida] = process.argv.slice(2);
  if (!carpetaImagenes || !carpetaSalida) {
    console.error("Uso: npx tsx scripts/ocr-muestras.ts <carpetaImagenes> <carpetaSalida>");
    process.exit(1);
  }

  const archivos = (await readdir(carpetaImagenes)).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort();
  await mkdir(carpetaSalida, { recursive: true });

  const worker = await createWorker("spa", 1, {
    langPath: DATOS_IDIOMA,
    gzip: true,
    cachePath: os.tmpdir(),
    cacheMethod: "none",
  });

  try {
    for (const archivo of archivos) {
      const imagen = await readFile(path.join(carpetaImagenes, archivo));
      const base = archivo.replace(/\.[^.]+$/, "");
      const resumen: string[] = [];
      for (const modo of ["original", "preprocesado", "encabezado"] as const) {
        const inicio = Date.now();
        const { data } = await worker.recognize(await preparar(imagen, modo));
        await writeFile(path.join(carpetaSalida, `${base}.${modo}.txt`), data.text, "utf8");
        resumen.push(`${modo} ${Math.round(data.confidence)}% ${Date.now() - inicio}ms`);
      }
      console.log(`${archivo}: ${resumen.join(" · ")}`);
    }
  } finally {
    await worker.terminate();
  }
  console.log(`\n${archivos.length} imagen(es) leídas. Textos en ${carpetaSalida}`);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
