/*
 * Fase 3 — Comprueba la subida de imágenes por HTTP, contra local o contra el despliegue.
 *
 * Uso: npx tsx scripts/probar-subida.ts <carpetaImagenes> [url]   (por defecto http://localhost:3000)
 *
 * Crea un lote de prueba, sube 3 imágenes reales y comprueba que el servidor
 * RECHAZA lo que debe rechazar. Al final borra SOLO lo que él mismo creó: sus
 * lotes en Firestore y los archivos bajo procesos/<id de esos lotes>/.
 * Nunca imprime tokens, cookies ni valores del .env.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { auth, db } from "../src/lib/firebase/admin";
import { COOKIE_SESION, correosPermitidos } from "../src/lib/auth/sesion";
import { COLECCIONES, type Proceso } from "../src/lib/modelo/tipos";
import { prefijoProceso } from "../src/lib/rutas";

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IMAGENES_A_SUBIR = 3;

let fallos = 0;
function comprobar(descripcion: string, obtenido: unknown, esperado: unknown): void {
  const bien = obtenido === esperado;
  if (!bien) fallos += 1;
  console.log(`${bien ? "OK   " : "FALLO"} ${descripcion} → ${String(obtenido)}${bien ? "" : ` (se esperaba ${String(esperado)})`}`);
}

/** Cookie de sesión del primer correo permitido, sin conocer su contraseña (igual que probar-sesion.ts). */
async function iniciarSesion(url: string): Promise<{ cookie: string; uid: string }> {
  const correo = correosPermitidos()[0];
  if (!correo) throw new Error("USUARIOS_PERMITIDOS está vacía");
  const usuario = await auth().getUserByEmail(correo);
  const tokenPropio = await auth().createCustomToken(usuario.uid);
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const cambio = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: tokenPropio, returnSecureToken: true }),
  });
  if (!cambio.ok) throw new Error(`Firebase rechazó el token de prueba (${cambio.status})`);
  const { idToken } = (await cambio.json()) as { idToken: string };
  const login = await fetch(`${url}/api/sesion`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!login.ok) throw new Error(`POST /api/sesion respondió ${login.status}`);
  const cookie = login.headers.getSetCookie().find((l) => l.startsWith(`${COOKIE_SESION}=`));
  if (!cookie) throw new Error("El servidor no devolvió la cookie de sesión");
  return { cookie: cookie.split(";")[0], uid: usuario.uid };
}

function almacen() {
  const leer = (nombre: string) => {
    const valor = process.env[nombre]?.trim();
    if (!valor) throw new Error(`Falta la variable ${nombre} en .env`);
    return valor;
  };
  const supabase = createClient(leer("NEXT_PUBLIC_SUPABASE_URL"), leer("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabase.storage.from(leer("SUPABASE_BUCKET"));
}

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const carpeta = process.argv[2];
  if (!carpeta) {
    console.error("Uso: npx tsx scripts/probar-subida.ts <carpetaImagenes> [url]");
    process.exit(1);
  }
  const url = (process.argv[3] ?? "http://localhost:3000").replace(/\/+$/, "");
  const nombres = (await readdir(carpeta)).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort().slice(0, IMAGENES_A_SUBIR);
  if (nombres.length < IMAGENES_A_SUBIR) throw new Error(`Hacen falta al menos ${IMAGENES_A_SUBIR} imágenes en ${carpeta}`);
  console.log(`Probando la subida de imágenes en ${url}\n`);

  // Lo que este script crea, para borrarlo al final (y solo eso).
  const lotesCreados: string[] = [];

  try {
    // --- Sin sesión ---
    const crearSinSesion = await fetch(`${url}/api/procesos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ carpeta: "x", totalArchivos: 1 }),
    });
    comprobar("POST /api/procesos sin cookie", crearSinSesion.status, 401);
    const subirSinSesion = await fetch(`${url}/api/procesos/cualquiera/imagenes?indice=1&nombre=a.png`, { method: "POST", body: "x" });
    comprobar("POST …/imagenes sin cookie", subirSinSesion.status, 401);

    const { cookie, uid } = await iniciarSesion(url);
    const json = { cookie, "content-type": "application/json" };

    // --- Crear el lote ---
    const invalido = await fetch(`${url}/api/procesos`, { method: "POST", headers: json, body: JSON.stringify({ carpeta: "", totalArchivos: 0 }) });
    comprobar("POST /api/procesos con datos inválidos", invalido.status, 400);

    const creado = await fetch(`${url}/api/procesos`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ carpeta: "_prueba-subida", totalArchivos: IMAGENES_A_SUBIR }),
    });
    comprobar("POST /api/procesos crea el lote", creado.status, 201);
    const { id } = (await creado.json()) as { id: string };
    lotesCreados.push(id);

    const guardado = (await db().collection(COLECCIONES.procesos).doc(id).get()).data() as Proceso | undefined;
    comprobar("  …queda en «subiendo» y a nombre del usuario", guardado?.estado === "subiendo" && guardado.uid === uid, true);

    const subir = (lote: string, indice: string, nombre: string, cuerpo: Uint8Array<ArrayBuffer> | string, tipo = "image/png") =>
      fetch(`${url}/api/procesos/${lote}/imagenes?indice=${indice}&nombre=${encodeURIComponent(nombre)}`, {
        method: "POST",
        headers: { cookie, "content-type": tipo },
        body: cuerpo,
      });

    // --- Imágenes reales ---
    const inicio = Date.now();
    for (const [i, nombre] of nombres.entries()) {
      const bytes = new Uint8Array(await readFile(path.join(carpeta, nombre)));
      const respuesta = await subir(id, String(i + 1), nombre, bytes, /\.png$/i.test(nombre) ? "image/png" : "image/jpeg");
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { ruta?: string; error?: string };
      comprobar(`sube ${nombre}${cuerpo.error ? ` (${cuerpo.error})` : ""}`, respuesta.status, 200);
      comprobar("  …bajo la carpeta del lote", cuerpo.ruta?.startsWith(`${prefijoProceso(id)}000${i + 1}-`) ?? false, true);
    }
    const duracion = Date.now() - inicio;

    const listado = await almacen().list(prefijoProceso(id).replace(/\/$/, ""));
    if (listado.error) throw new Error(`Listado del almacén: ${listado.error.message}`);
    comprobar("el almacén tiene los archivos del lote", listado.data.length, IMAGENES_A_SUBIR);

    // --- Rechazos ---
    const real = new Uint8Array(await readFile(path.join(carpeta, nombres[0])));
    comprobar("un texto llamado .png", (await subir(id, "1", "falsa.png", "esto no es una imagen")).status, 415);
    const danado = Uint8Array.from([...FIRMA_PNG, ...new Array<number>(200).fill(7)]);
    comprobar("firma PNG pero archivo dañado", (await subir(id, "1", "danada.png", danado)).status, 415);
    const enorme = new Uint8Array(4 * 1024 * 1024 + 1);
    enorme.set(FIRMA_PNG);
    comprobar("más de 4 MB", (await subir(id, "1", "enorme.png", enorme)).status, 413);
    comprobar("índice 0", (await subir(id, "0", "a.png", real)).status, 400);
    comprobar("índice mayor que el total del lote", (await subir(id, "99", "a.png", real)).status, 400);
    comprobar("índice que no es un número", (await subir(id, "abc", "a.png", real)).status, 400);
    comprobar("lote inexistente", (await subir("noExisteEsteLote123", "1", "a.png", real)).status, 404);
    comprobar("identificador de lote con forma inválida", (await subir("..%2Fclientes", "1", "a.png", real)).status, 404);

    // Lote de OTRO usuario: se crea directamente en la base con otro uid.
    const ajeno = await db().collection(COLECCIONES.procesos).add({
      uid: "otro-usuario-de-prueba",
      carpeta: "_prueba-subida-ajeno",
      estado: "subiendo",
      totalArchivos: 1,
      inicio: Date.now(),
      fin: null,
      rutaExcel: null,
      finalizandoDesde: null,
    } satisfies Proceso);
    lotesCreados.push(ajeno.id);
    comprobar("lote de otro usuario (no se revela que existe)", (await subir(ajeno.id, "1", "a.png", real)).status, 404);

    console.log(`\n${IMAGENES_A_SUBIR} imágenes subidas en ${duracion} ms (${Math.round(duracion / IMAGENES_A_SUBIR)} ms por imagen).`);
  } finally {
    // Limpieza: solo los lotes de `lotesCreados` y los archivos bajo su carpeta.
    for (const id of lotesCreados) {
      const carpetaLote = prefijoProceso(id).replace(/\/$/, "");
      const { data } = await almacen().list(carpetaLote);
      const rutas = (data ?? []).map((archivo) => `${carpetaLote}/${archivo.name}`);
      if (rutas.length > 0) await almacen().remove(rutas);
      await db().collection(COLECCIONES.procesos).doc(id).delete();
    }
    console.log(`Limpieza: ${lotesCreados.length} lote(s) de prueba borrados con sus archivos.`);
  }

  console.log(fallos === 0 ? "\nSubida correcta." : `\n${fallos} comprobación(es) fallaron.`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
