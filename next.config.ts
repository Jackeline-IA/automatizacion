import type { NextConfig } from "next";

const DATOS_IDIOMA_OCR = "node_modules/@tesseract.js-data/spa/4.0.0_best_int/**/*";

/*
 * Archivos que el OCR necesita dentro de la función y que el trazador de Next no
 * ve: tesseract carga su núcleo WASM y sus dependencias con `require` dinámico
 * desde un hilo aparte, y los datos del idioma con una ruta calculada.
 */
const ARCHIVOS_OCR = [
  DATOS_IDIOMA_OCR,
  "node_modules/tesseract.js/**/*",
  // TODO el núcleo: la variante que elige el worker (relaxedsimd, simd o base,
  // con o sin lstm) depende de la CPU donde corra la función.
  "node_modules/tesseract.js-core/**/*",
  // Dependencias de tesseract.js y de su node-fetch.
  "node_modules/bmp-js/**/*",
  "node_modules/idb-keyval/**/*",
  "node_modules/is-url/**/*",
  "node_modules/node-fetch/**/*",
  "node_modules/regenerator-runtime/**/*",
  "node_modules/wasm-feature-detect/**/*",
  "node_modules/zlibjs/**/*",
  "node_modules/whatwg-url/**/*",
  "node_modules/tr46/**/*",
  "node_modules/webidl-conversions/**/*",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    // Rutas que hacen OCR. La de prueba es temporal (Fase 5) y se borra al terminar.
    "/api/ocr-prueba": ARCHIVOS_OCR,
    "/api/procesos/**": ARCHIVOS_OCR,
    // El diagnóstico solo comprueba que los datos del idioma estén en el paquete.
    "/api/salud": [DATOS_IDIOMA_OCR],
  },
  /* config options here */
  experimental: {
    // Desactivado: con `true`, `next dev` añade un bloque a AGENTS.md en cada
    // arranque y lo restaura si se borra (el archivo quedaba siempre modificado).
    agentFeedback: false,
  },
  cacheComponents: true,
  partialPrefetching: true,
  // tesseract.js usa hilos y WASM: si el empaquetador lo procesa, se rompe.
  // firebase-admin y sharp ya vienen excluidos por defecto en Next.
  serverExternalPackages: ["tesseract.js"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
