/*
 * Fase D — Ninguna ruta de la API responde sin sesión, y el almacén de archivos es privado.
 *
 * Uso: npx tsx scripts/probar-rutas-sin-sesion.ts [url]   (por defecto http://localhost:3000)
 *
 * 1. Recorre src/app/api, lee qué métodos exporta cada route.ts y llama a cada uno
 *    SIN cookie: todos deben responder 401. Así una ruta nueva que olvide
 *    exigirUsuario se detecta sola (no hay que acordarse de añadirla aquí).
 *    Excepciones, a propósito: POST /api/sesion (es el inicio de sesión: con un
 *    token inventado debe dar 401) y DELETE /api/sesion (cerrar sesión: solo
 *    borra la cookie, no lee ni escribe datos).
 * 2. El bucket de Supabase debe ser privado: un archivo de prueba (que el script
 *    sube y borra) no se puede leer ni por la URL pública ni con la clave anónima,
 *    que es pública por diseño. Es el equivalente de las reglas «denegar todo» de Firestore.
 *
 * No crea datos de la aplicación y nunca imprime claves ni valores del .env.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { crearComprobador } from "./comun-pruebas";

const { comprobar, fallos } = crearComprobador();
const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Valores de relleno para los segmentos dinámicos: con formato válido, para llegar hasta la comprobación de sesión. */
const RELLENO: Record<string, string> = { id: "loteDePrueba123", hash: "0".repeat(64) };

async function rutasDeLaApi(carpeta: string, base = "/api"): Promise<{ ruta: string; metodos: string[] }[]> {
  const encontradas: { ruta: string; metodos: string[] }[] = [];
  for (const entrada of await readdir(carpeta, { withFileTypes: true })) {
    const completa = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) {
      const segmento = entrada.name.replace(/^\[(.+)\]$/, (_, nombre: string) => RELLENO[nombre] ?? "x");
      encontradas.push(...(await rutasDeLaApi(completa, `${base}/${segmento}`)));
    } else if (entrada.name === "route.ts") {
      const codigo = await readFile(completa, "utf8");
      const metodos = METODOS.filter((m) => new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(codigo));
      encontradas.push({ ruta: base, metodos });
    }
  }
  return encontradas;
}

function leer(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new Error(`Falta la variable ${nombre} en .env`);
  return valor;
}

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const url = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/+$/, "");
  console.log(`Probando las rutas sin sesión en ${url}\n`);

  // --- 1. Todas las rutas sin cookie ---
  console.log("— Rutas de la API sin cookie —");
  const rutas = await rutasDeLaApi(path.join("src", "app", "api"));
  let llamadas = 0;
  for (const { ruta, metodos } of rutas.sort((a, b) => a.ruta.localeCompare(b.ruta))) {
    for (const metodo of metodos) {
      if (ruta === "/api/sesion" && metodo === "DELETE") continue; // cerrar sesión: no toca datos
      const esLogin = ruta === "/api/sesion" && metodo === "POST";
      const conCuerpo = metodo !== "GET";
      const respuesta = await fetch(`${url}${ruta}`, {
        method: metodo,
        redirect: "manual",
        headers: conCuerpo ? { "content-type": "application/json" } : undefined,
        // El login recibe un token inventado; las demás, un cuerpo VACÍO: si algún día una ruta perdiera
        // la comprobación de sesión, esta prueba no debe poder hacer el daño que vigila (p. ej. borrar).
        body: conCuerpo ? JSON.stringify(esLogin ? { idToken: "token-inventado" } : {}) : undefined,
      });
      llamadas += 1;
      comprobar(`${metodo.padEnd(6)} ${ruta}${esLogin ? " (token inventado)" : ""}`, respuesta.status, 401);
    }
  }
  comprobar("rutas encontradas en src/app/api", rutas.length >= 15, true);
  console.log(`  (${llamadas} llamadas a ${rutas.length} rutas)`);

  // --- 2. El almacén es privado ---
  console.log("\n— Almacén de archivos (Supabase, bucket privado) —");
  const urlSupabase = leer("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const bucket = leer("SUPABASE_BUCKET");
  const anonima = leer("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const servidor = createClient(urlSupabase, leer("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(bucket);
  // Fuera de procesos/: «Borrar todo» y las pruebas no lo tocan, y este script lo borra al terminar.
  const ruta = `prueba-privacidad/${Date.now()}.txt`;
  const { error: errorSubida } = await servidor.upload(ruta, Buffer.from("archivo de prueba de privacidad"), { contentType: "text/plain" });
  if (errorSubida) throw new Error(`No se pudo subir el archivo de prueba: ${errorSubida.message}`);
  try {
    const conServidor = await servidor.download(ruta);
    comprobar("con la clave del servidor el archivo sí se lee (el archivo existe)", conServidor.error === null, true);
    const publica = await fetch(`${urlSupabase}/storage/v1/object/public/${bucket}/${ruta}`);
    comprobar("por la URL pública NO se lee", publica.ok, false);
    const conAnonima = await fetch(`${urlSupabase}/storage/v1/object/${bucket}/${ruta}`, {
      headers: { apikey: anonima, authorization: `Bearer ${anonima}` },
    });
    comprobar("con la clave anónima (pública) NO se lee", conAnonima.ok, false);
    const listado = await createClient(urlSupabase, anonima, { auth: { persistSession: false } }).storage.from(bucket).list("prueba-privacidad");
    comprobar("con la clave anónima NO se puede listar el bucket", (listado.data ?? []).length, 0);
  } finally {
    const { error } = await servidor.remove([ruta]);
    console.log(error ? `No se pudo borrar el archivo de prueba ${ruta}: ${error.message}` : "Archivo de prueba borrado.");
  }

  console.log(fallos() === 0 ? "\nTodo protegido." : `\n${fallos()} comprobación(es) fallaron.`);
  process.exit(fallos() === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
