import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
