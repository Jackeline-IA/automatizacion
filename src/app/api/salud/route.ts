import { existsSync } from "node:fs";
import path from "node:path";
import { exigirUsuario } from "@/lib/auth/sesion";

/*
 * Diagnóstico del despliegue: convierte «no sé qué pasa en Vercel» en un JSON legible.
 * Exige sesión y devuelve SOLO booleanos y nombres de variables, nunca valores.
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

export async function GET(request: Request) {
  // Leer la cookie de la petición hace además que la ruta sea dinámica: con
  // cacheComponents, una ruta GET que no lee nada de la petición se prerenderiza
  // al compilar y respondería con el diagnóstico de la máquina que compiló.
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const variablesFaltantes = VARIABLES.filter((nombre) => !process.env[nombre]?.trim());
  const sharp = await cargaSharp();
  // Que este archivo esté no garantiza que el OCR funcione en Vercel: el núcleo
  // WASM de tesseract se carga de forma dinámica y se configura en la Fase 5.
  const datosIdiomaOcr = existsSync(path.join(process.cwd(), DATOS_IDIOMA));

  return Response.json({
    ok: variablesFaltantes.length === 0 && sharp,
    variablesFaltantes,
    sharp,
    datosIdiomaOcr,
    node: process.version,
  });
}
