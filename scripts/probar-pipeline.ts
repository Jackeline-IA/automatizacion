/*
 * Fase 6 — Comprueba el procesamiento completo por HTTP, contra local o contra el despliegue:
 * subir → iniciar → lotes concurrentes → finalizar, y que repetirlo no duplica nada.
 *
 * Uso: npx tsx scripts/probar-pipeline.ts <carpetaImagenes> [url]   (por defecto http://localhost:3000)
 *
 * Trabaja contra Firestore y el almacén REALES. Al final borra SOLO lo que creó,
 * y lo comprueba en vez de suponerlo: una factura solo si pertenece a uno de sus
 * lotes, un índice solo si apunta a una de esas facturas y un cliente solo si lo
 * creó uno de sus lotes. Si las imágenes ya estaban procesadas de antes, se
 * detiene sin tocar nada. Nunca imprime tokens, cookies ni valores del .env.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { auth, db } from "../src/lib/firebase/admin";
import { COOKIE_SESION, correosPermitidos } from "../src/lib/auth/sesion";
import { COLECCIONES, TERMINADO, type ArchivoCola, type Factura, type IndiceNumero, type Proceso } from "../src/lib/modelo/tipos";
import { ARRENDAMIENTO_MS, devolver, reclamar } from "../src/lib/procesamiento/cola";
import type { ResumenLote } from "../src/lib/procesamiento/lote";
import { prefijoProceso } from "../src/lib/rutas";

const LLAMADAS_CONCURRENTES = 3;

let fallos = 0;
function comprobar(descripcion: string, obtenido: unknown, esperado: unknown): void {
  const bien = obtenido === esperado;
  if (!bien) fallos += 1;
  console.log(`${bien ? "OK   " : "FALLO"} ${descripcion} → ${String(obtenido)}${bien ? "" : ` (se esperaba ${String(esperado)})`}`);
}

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

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

const facturas = () => db().collection(COLECCIONES.facturas);
const clientes = () => db().collection(COLECCIONES.clientes);
const procesos = () => db().collection(COLECCIONES.procesos);
const contar = async (coleccion: FirebaseFirestore.Query) => (await coleccion.count().get()).data().count;

interface Imagen {
  nombre: string;
  bytes: Uint8Array<ArrayBuffer>;
  hash: string;
}

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const carpeta = process.argv[2];
  if (!carpeta) {
    console.error("Uso: npx tsx scripts/probar-pipeline.ts <carpetaImagenes> [url]");
    process.exit(1);
  }
  const url = (process.argv[3] ?? "http://localhost:3000").replace(/\/+$/, "");

  const imagenes: Imagen[] = [];
  for (const nombre of (await readdir(carpeta)).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort()) {
    const bytes = new Uint8Array(await readFile(path.join(carpeta, nombre)));
    imagenes.push({ nombre, bytes, hash: createHash("sha256").update(bytes).digest("hex") });
  }
  const n = imagenes.length;
  if (n === 0) throw new Error(`No hay imágenes en ${carpeta}`);
  console.log(`Probando el procesamiento de ${n} imagen(es) en ${url}\n`);

  // Si estas imágenes ya están guardadas, la prueba no puede distinguir lo suyo
  // de lo ajeno: se detiene antes de crear o borrar nada.
  const previas = await db().getAll(...imagenes.map((imagen) => facturas().doc(imagen.hash)));
  const yaGuardadas = previas.filter((documento) => documento.exists).length;
  if (yaGuardadas > 0) {
    throw new Error(
      `${yaGuardadas} de estas imágenes ya tienen factura guardada (de otro lote). ` +
        "Este script no borra datos que no creó: usa otras imágenes o borra antes esos datos a mano.",
    );
  }
  const facturasAntes = await contar(facturas());
  const clientesAntes = await contar(clientes());

  const lotes: string[] = []; // lo que este script crea, para borrarlo al final

  try {
    // --- Sin sesión ---
    for (const [metodo, ruta] of [["POST", "iniciar"], ["POST", "lote"], ["POST", "finalizar"], ["GET", ""]] as const) {
      const respuesta = await fetch(`${url}/api/procesos/cualquiera/${ruta}`.replace(/\/$/, ""), { method: metodo });
      comprobar(`${metodo} /api/procesos/[id]/${ruta} sin cookie`, respuesta.status, 401);
    }

    const { cookie, uid } = await iniciarSesion(url);
    const llamar = (metodo: "GET" | "POST", ruta: string) => fetch(`${url}${ruta}`, { method: metodo, headers: { cookie } });
    /** Llama y devuelve el JSON; si el servidor falla, el error dice qué ruta y qué respondió. */
    async function pedir<T>(metodo: "GET" | "POST", ruta: string): Promise<T> {
      const respuesta = await llamar(metodo, ruta);
      const texto = await respuesta.text();
      if (!respuesta.ok) throw new Error(`${metodo} ${ruta} respondió ${respuesta.status}: ${texto.slice(0, 300) || "(sin cuerpo)"}`);
      return JSON.parse(texto) as T;
    }

    async function crearYSubir(carpetaLote: string): Promise<string> {
      const creado = await fetch(`${url}/api/procesos`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ carpeta: carpetaLote, totalArchivos: n }),
      });
      if (creado.status !== 201) throw new Error(`No se pudo crear el lote (${creado.status})`);
      const { id } = (await creado.json()) as { id: string };
      lotes.push(id);
      for (const [i, imagen] of imagenes.entries()) {
        const subida = await fetch(`${url}/api/procesos/${id}/imagenes?indice=${i + 1}&nombre=${encodeURIComponent(imagen.nombre)}`, {
          method: "POST",
          headers: { cookie, "content-type": "application/octet-stream" },
          body: imagen.bytes,
        });
        if (!subida.ok) throw new Error(`No se pudo subir ${imagen.nombre} (${subida.status})`);
      }
      return id;
    }

    /** Lo que hará el Motor del navegador en la Fase 8: varias llamadas a la vez hasta vaciar la cola. */
    async function procesar(id: string): Promise<ResumenLote & { llamadas: number }> {
      const total = { reclamados: 0, aceptadas: 0, revision: 0, duplicadas: 0, errores: 0, reintentos: 0, devueltos: 0, ms: 0, llamadas: 0 };
      const inicio = Date.now();
      async function trabajador() {
        for (;;) {
          const respuesta = await llamar("POST", `/api/procesos/${id}/lote`);
          if (!respuesta.ok) throw new Error(`POST …/lote respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 200)}`);
          const resumen = (await respuesta.json()) as ResumenLote;
          total.llamadas += 1;
          if (resumen.reclamados === 0) return;
          for (const clave of ["reclamados", "aceptadas", "revision", "duplicadas", "errores", "reintentos", "devueltos"] as const) {
            total[clave] += resumen[clave];
          }
        }
      }
      await Promise.all(Array.from({ length: LLAMADAS_CONCURRENTES }, trabajador));
      total.ms = Date.now() - inicio;
      return total;
    }

    async function finalizar(id: string): Promise<{ listo: boolean; yaEstaba?: boolean }> {
      for (let intento = 0; intento < 15; intento += 1) {
        const resultado = await pedir<{ listo: boolean; yaEstaba?: boolean }>("POST", `/api/procesos/${id}/finalizar`);
        if (resultado.listo) return resultado;
        await esperar(2000);
      }
      return { listo: false };
    }

    // --- Primer lote: todo es nuevo ---
    console.log("\n— Lote A: imágenes nuevas —");
    const loteA = await crearYSubir("_prueba-pipeline-A");
    comprobar("lote sin iniciar: POST …/lote", (await llamar("POST", `/api/procesos/${loteA}/lote`)).status, 409);

    const inicio1 = await pedir<{ total: number; nuevos: number }>("POST", `/api/procesos/${loteA}/iniciar`);
    comprobar("iniciar encuentra las imágenes del lote", inicio1.total, n);
    comprobar("  …y crea un documento de cola por imagen", inicio1.nuevos, n);
    const inicio2 = await pedir<{ total: number; nuevos: number }>("POST", `/api/procesos/${loteA}/iniciar`);
    comprobar("iniciar otra vez no crea nada (idempotente)", inicio2.nuevos, 0);
    comprobar("  …la cola sigue con un documento por imagen", await contar(procesos().doc(loteA).collection(COLECCIONES.archivos)), n);

    const estadoA = await pedir<{ estado: string; pendientes: number }>("GET", `/api/procesos/${loteA}`);
    comprobar("el lote pasa a «ejecutando»", estadoA.estado, "ejecutando");
    comprobar("  …con todos los archivos pendientes", estadoA.pendientes, n);

    const resumenA = await procesar(loteA);
    comprobar(`${LLAMADAS_CONCURRENTES} llamadas concurrentes procesan cada archivo una sola vez`, resumenA.reclamados, n);
    comprobar("  …todas quedan aceptadas o en revisión", resumenA.aceptadas + resumenA.revision, n);
    comprobar("  …ninguna duplicada", resumenA.duplicadas, 0);
    comprobar("  …ningún error", resumenA.errores + resumenA.reintentos, 0);

    comprobar("finalizar cierra el lote", (await finalizar(loteA)).listo, true);
    comprobar("finalizar otra vez no hace nada (idempotente)", (await finalizar(loteA)).yaEstaba, true);
    const cerradoA = await pedir<{ estado: string; pendientes: number }>("GET", `/api/procesos/${loteA}`);
    comprobar("el lote queda «terminado»", cerradoA.estado, "terminado");

    const colaA = (await procesos().doc(loteA).collection(COLECCIONES.archivos).get()).docs.map((d) => d.data() as ArchivoCola);
    comprobar("todos los archivos de la cola quedan cerrados", colaA.filter((a) => a.disponibleDesde === TERMINADO && a.estado === "ok").length, n);

    const guardadas = await db().getAll(...imagenes.map((imagen) => facturas().doc(imagen.hash)));
    const datos = guardadas.filter((d) => d.exists).map((d) => d.data() as Factura);
    comprobar("hay una factura por imagen, con el hash como ID", datos.length, n);
    comprobar("  …todas del lote A y del usuario", datos.filter((f) => f.procesoId === loteA && f.uid === uid).length, n);

    const documentos = new Set(datos.map((f) => f.clienteDocumento).filter((d): d is string => d !== null));
    const clientesA = await contar(clientes().where("primerProcesoId", "==", loteA));
    comprobar("un cliente por cada documento distinto (sin duplicados)", clientesA, documentos.size);

    let indicesBien = 0;
    const conNumero = guardadas.filter((d) => d.exists && (d.data() as Factura).numero !== null);
    for (const documento of conNumero) {
      const indice = await db().collection(COLECCIONES.indicesNumero).doc((documento.data() as Factura).numero as string).get();
      if ((indice.data() as IndiceNumero | undefined)?.hashArchivo === documento.id) indicesBien += 1;
    }
    comprobar("cada número de factura tiene su índice apuntando a su imagen", indicesBien, conNumero.length);

    comprobar("facturas en la base: las de antes + las nuevas", await contar(facturas()), facturasAntes + n);
    comprobar("clientes en la base: los de antes + los nuevos", await contar(clientes()), clientesAntes + clientesA);
    const sumaTotales = datos.reduce((suma, f) => suma + (f.total ?? 0), 0);
    console.log(`     ${resumenA.aceptadas} aceptada(s), ${resumenA.revision} a revisión; suma de totales $${sumaTotales.toLocaleString("es-CO")}`);
    console.log(`     ${(resumenA.ms / 1000).toFixed(1)} s en ${resumenA.llamadas} llamada(s) a …/lote (${Math.round(resumenA.ms / n)} ms por imagen)`);

    // --- Segundo lote: las MISMAS imágenes, en otra ruta del almacén ---
    console.log("\n— Lote B: las mismas imágenes otra vez —");
    const loteB = await crearYSubir("_prueba-pipeline-B");
    await pedir("POST", `/api/procesos/${loteB}/iniciar`);
    const resumenB = await procesar(loteB);
    comprobar("todas se reconocen como duplicadas (por el hash)", resumenB.duplicadas, n);
    comprobar("  …ninguna se vuelve a guardar", resumenB.aceptadas + resumenB.revision + resumenB.errores, 0);
    comprobar("finalizar cierra el lote", (await finalizar(loteB)).listo, true);
    comprobar("las facturas en la base no cambian", await contar(facturas()), facturasAntes + n);
    comprobar("los clientes en la base no cambian", await contar(clientes()), clientesAntes + clientesA);
    console.log(`     ${(resumenB.ms / 1000).toFixed(1)} s (sin OCR: ${Math.round(resumenB.ms / n)} ms por imagen)`);

    // --- La cola: reclamos concurrentes y caducidad del arrendamiento ---
    // Lote sin imágenes, solo con documentos de cola: se prueba cola.ts directamente.
    console.log("\n— La cola: reclamos y arrendamiento —");
    const base: Proceso = { uid, carpeta: "_prueba-pipeline-cola", estado: "ejecutando", totalArchivos: 5, inicio: Date.now(), fin: null, rutaExcel: null, finalizandoDesde: null };
    const loteC = (await procesos().add(base)).id;
    lotes.push(loteC);
    for (let i = 1; i <= 5; i += 1) {
      const archivo: ArchivoCola = { rutaAlmacen: `no-existe/${i}.png`, nombre: `${i}.png`, estado: "pendiente", resultado: null, clienteNuevo: false, clienteExistente: false, hashArchivo: null, intentos: 0, error: null, disponibleDesde: 0 };
      await procesos().doc(loteC).collection(COLECCIONES.archivos).doc(`000${i}-${i}.png`).set(archivo);
    }
    const ahora = Date.now();
    const [uno, dos] = await Promise.all([reclamar(loteC, 4, ahora), reclamar(loteC, 4, ahora)]);
    const tomados = [...uno, ...dos].map((a) => a.id);
    comprobar("dos reclamos simultáneos se reparten los 5 archivos", tomados.length, 5);
    comprobar("  …sin tomar ninguno los dos", new Set(tomados).size, 5);
    comprobar("un archivo arrendado no se puede reclamar", (await reclamar(loteC, 4, ahora)).length, 0);
    await devolver(loteC, tomados[0]);
    const devuelto = await reclamar(loteC, 4, ahora);
    comprobar("un archivo devuelto vuelve a estar disponible", devuelto.length, 1);
    comprobar("  …sin que la devolución cuente como intento", devuelto[0]?.intentos, 1);
    const trasCaducar = await reclamar(loteC, 4, ahora + ARRENDAMIENTO_MS + 1);
    comprobar("al caducar el arrendamiento (función caída) vuelven a la cola", trasCaducar.length, 4);
    comprobar("  …y ese sí cuenta como segundo intento", trasCaducar.every((a) => a.intentos === 2), true);

    // --- Lote de otro usuario ---
    console.log("\n— Lote de otro usuario —");
    const loteD = (await procesos().add({ ...base, uid: "otro-usuario-de-prueba", carpeta: "_prueba-pipeline-ajeno" } satisfies Proceso)).id;
    lotes.push(loteD);
    for (const [metodo, ruta] of [["POST", "/iniciar"], ["POST", "/lote"], ["POST", "/finalizar"], ["GET", ""]] as const) {
      comprobar(`${metodo} …${ruta || "/(estado)"} de un lote ajeno`, (await llamar(metodo, `/api/procesos/${loteD}${ruta}`)).status, 404);
    }
  } finally {
    console.log("\n— Limpieza —");
    // Facturas: solo las de estas imágenes QUE pertenezcan a un lote de este script.
    const candidatas = await db().getAll(...imagenes.map((imagen) => facturas().doc(imagen.hash)));
    let facturasBorradas = 0;
    let indicesBorrados = 0;
    for (const documento of candidatas) {
      const factura = documento.data() as Factura | undefined;
      if (!factura || !lotes.includes(factura.procesoId)) continue;
      if (factura.numero) {
        // El índice se borra solo si apunta a ESTA factura.
        const indice = db().collection(COLECCIONES.indicesNumero).doc(factura.numero);
        if (((await indice.get()).data() as IndiceNumero | undefined)?.hashArchivo === documento.id) {
          await indice.delete();
          indicesBorrados += 1;
        }
      }
      await documento.ref.delete();
      facturasBorradas += 1;
    }
    // Clientes: solo los que creó un lote de este script.
    let clientesBorrados = 0;
    for (const id of lotes) {
      for (const cliente of (await clientes().where("primerProcesoId", "==", id).get()).docs) {
        await cliente.ref.delete();
        clientesBorrados += 1;
      }
    }
    // Lotes: su cola, sus archivos en el almacén y el propio lote.
    for (const id of lotes) {
      const carpetaLote = prefijoProceso(id).replace(/\/$/, "");
      const { data } = await almacen().list(carpetaLote, { limit: 1000 });
      const rutas = (data ?? []).map((archivo) => `${carpetaLote}/${archivo.name}`);
      if (rutas.length > 0) await almacen().remove(rutas);
      for (const archivo of (await procesos().doc(id).collection(COLECCIONES.archivos).get()).docs) await archivo.ref.delete();
      await procesos().doc(id).delete();
    }
    console.log(`Borrado: ${lotes.length} lote(s) con su cola y sus archivos, ${facturasBorradas} factura(s), ${indicesBorrados} índice(s), ${clientesBorrados} cliente(s).`);
    comprobar("la base queda con las mismas facturas que antes de la prueba", await contar(facturas()), facturasAntes);
    comprobar("  …y los mismos clientes", await contar(clientes()), clientesAntes);
  }

  console.log(fallos === 0 ? "\nProcesamiento correcto." : `\n${fallos} comprobación(es) fallaron.`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
