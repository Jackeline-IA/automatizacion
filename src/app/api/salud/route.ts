import { existsSync } from "node:fs";
import path from "node:path";
import { connection } from "next/server";

/*
 * Diagnóstico del despliegue: convierte «no sé qué pasa en Vercel» en un JSON legible.
 *
 * Devuelve SOLO booleanos y nombres de variables, nunca valores.
 * Pendiente (Fase A): exigir sesión. Hasta que exista el inicio de sesión esta
 * ruta es pública, y por eso no puede revelar nada más que nombres.
 */

const VARIABLES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "USUARIOS_PERMITIDOS",
];

const DATOS_IDIOMA = "node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz";

async function cargaSharp(): Promise<boolean> {
  try {
    await import("sharp");
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  // Con cacheComponents una ruta GET se prerenderiza al compilar si no lee nada de
  // la petición: respondería con el diagnóstico de la máquina que compiló. Esto la
  // obliga a ejecutarse en cada petición, en el servidor real.
  await connection();

  const variablesFaltantes = VARIABLES.filter((nombre) => !process.env[nombre]?.trim());
  const sharp = await cargaSharp();
  // Será false en Vercel hasta la Fase 5, cuando outputFileTracingIncludes meta
  // los datos de idioma en el paquete de la función.
  const datosIdiomaOcr = existsSync(path.join(process.cwd(), DATOS_IDIOMA));

  return Response.json({
    ok: variablesFaltantes.length === 0 && sharp,
    variablesFaltantes,
    sharp,
    datosIdiomaOcr,
    node: process.version,
  });
}
