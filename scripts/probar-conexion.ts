/*
 * Fase 0 — Comprueba que este computador se conecta a los tres servicios del proyecto:
 * Firestore, Firebase Authentication y Supabase Storage.
 *
 * Uso: npx tsx scripts/probar-conexion.ts
 *
 * Reglas de este script:
 *  - Nunca imprime valores del .env: solo nombres de variables, "OK" o el mensaje de error.
 *  - Solo borra lo que él mismo crea (un documento y un archivo temporales).
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createClient } from "@supabase/supabase-js";

const VARIABLES_NECESARIAS = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_BUCKET",
  "USUARIOS_PERMITIDOS",
] as const;

// PNG de 1×1 píxel. Se sube una imagen (y no un texto) para que la prueba siga
// funcionando si el bucket se restringe a image/png e image/jpeg.
const PNG_MINIMO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Lee una variable obligatoria; el error nombra la variable, nunca su valor. */
function leer(nombre: (typeof VARIABLES_NECESARIAS)[number]): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new Error(`Falta la variable ${nombre} en .env`);
  return valor;
}

function iniciarFirebase(): void {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId: leer("FIREBASE_ADMIN_PROJECT_ID"),
      clientEmail: leer("FIREBASE_ADMIN_CLIENT_EMAIL"),
      // En .env la clave va en una sola línea con "\n" escritos; el certificado
      // necesita saltos de línea reales. Si el cargador ya los convirtió, no cambia nada.
      privateKey: leer("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });
}

async function probarFirestore(): Promise<string> {
  iniciarFirebase();
  const db = getFirestore();
  const ref = db.collection("_prueba_conexion").doc(`prueba-${Date.now()}`);
  await ref.set({ creadoEn: Date.now() });
  try {
    const leido = await ref.get();
    if (!leido.exists) throw new Error("El documento escrito no se pudo leer");
  } finally {
    // Se borra aunque la lectura falle, para no dejar basura en la base.
    await ref.delete();
  }
  return "escritura, lectura y borrado";
}

async function probarAuth(): Promise<string> {
  iniciarFirebase();
  const auth = getAuth();
  const { users } = await auth.listUsers(100);

  // Autorización: cuántos de los correos permitidos tienen cuenta creada.
  const permitidos = leer("USUARIOS_PERMITIDOS")
    .split(",")
    .map((c) => c.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter(Boolean);
  const registrados = new Set(users.map((u) => u.email?.toLowerCase()));
  const conCuenta = permitidos.filter((c) => registrados.has(c)).length;

  const aviso = conCuenta === 0 ? " — AVISO: ningún correo permitido tiene cuenta todavía" : "";
  return `${users.length} usuario(s) registrado(s); ${conCuenta} de ${permitidos.length} correo(s) permitido(s) con cuenta${aviso}`;
}

async function probarStorage(): Promise<string> {
  const supabase = createClient(leer("NEXT_PUBLIC_SUPABASE_URL"), leer("SUPABASE_SERVICE_ROLE_KEY"), {
    // Script de servidor: no hay sesión de usuario que guardar ni renovar.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const nombreBucket = leer("SUPABASE_BUCKET");

  const bucket = await supabase.storage.getBucket(nombreBucket);
  if (bucket.error) throw new Error(`No se encontró el bucket "${nombreBucket}": ${bucket.error.message}`);
  if (bucket.data.public) {
    throw new Error(`El bucket "${nombreBucket}" es PÚBLICO: las facturas tienen datos de clientes, debe ser privado`);
  }

  const almacen = supabase.storage.from(nombreBucket);
  const carpeta = "_prueba-conexion";
  const ruta = `${carpeta}/prueba-${Date.now()}.png`;

  const subida = await almacen.upload(ruta, PNG_MINIMO, { contentType: "image/png" });
  if (subida.error) throw new Error(`Subida: ${subida.error.message}`);
  try {
    const lista = await almacen.list(carpeta);
    if (lista.error) throw new Error(`Listado: ${lista.error.message}`);
    if (!lista.data.some((archivo) => ruta.endsWith(archivo.name))) {
      throw new Error("El archivo subido no aparece en el listado");
    }
  } finally {
    const borrado = await almacen.remove([ruta]);
    if (borrado.error) throw new Error(`Borrado: ${borrado.error.message}`);
  }
  return `bucket privado "${nombreBucket}": subida, listado y borrado`;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    console.error("No se pudo leer .env (ejecuta el script desde la carpeta del proyecto).");
    process.exit(1);
  }
  
  const faltantes = VARIABLES_NECESARIAS.filter((nombre) => !process.env[nombre]?.trim());
  if (faltantes.length > 0) {
    console.error(`Faltan variables en .env: ${faltantes.join(", ")}`);
    process.exit(1);
  }

  const pruebas: [string, () => Promise<string>][] = [
    ["Firestore", probarFirestore],
    ["Auth", probarAuth],
    ["Storage", probarStorage],
  ];

  let fallos = 0;
  // En serie: así un error se lee junto al servicio que lo produjo.
  for (const [nombre, probar] of pruebas) {
    try {
      console.log(`${nombre} OK — ${await probar()}`);
    } catch (error) {
      fallos += 1;
      console.error(`${nombre} ERROR — ${mensajeDe(error)}`);
    }
  }

  process.exit(fallos === 0 ? 0 : 1);
}

void main();
