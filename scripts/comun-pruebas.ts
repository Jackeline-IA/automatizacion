/*
 * Piezas compartidas por los scripts de verificación (desde la Fase 8): iniciar
 * sesión, subir y procesar un lote por HTTP, y limpiar SOLO lo que la prueba creó.
 *
 * No es un script: no se ejecuta solo. Nunca imprime tokens, cookies ni valores del .env.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { auth, db } from "../src/lib/firebase/admin";
import { COOKIE_SESION, correosPermitidos } from "../src/lib/auth/sesion";
import { COLECCIONES, type Factura, type IndiceNumero } from "../src/lib/modelo/tipos";
import type { ResumenLote } from "../src/lib/procesamiento/lote";
import { prefijoProceso } from "../src/lib/rutas";

export const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

export const facturas = () => db().collection(COLECCIONES.facturas);
export const clientes = () => db().collection(COLECCIONES.clientes);
export const procesos = () => db().collection(COLECCIONES.procesos);
export const contar = async (consulta: FirebaseFirestore.Query) => (await consulta.count().get()).data().count;

/** Contador de comprobaciones de un script. */
export function crearComprobador() {
  let fallos = 0;
  return {
    comprobar(descripcion: string, obtenido: unknown, esperado: unknown): void {
      const bien = obtenido === esperado;
      if (!bien) fallos += 1;
      console.log(`${bien ? "OK   " : "FALLO"} ${descripcion} → ${String(obtenido)}${bien ? "" : ` (se esperaba ${String(esperado)})`}`);
    },
    fallos: () => fallos,
  };
}

export interface Imagen {
  nombre: string;
  bytes: Uint8Array<ArrayBuffer>;
  /** SHA-256: el ID que tendrá su factura. */
  hash: string;
}

export async function cargarImagenes(carpeta: string): Promise<Imagen[]> {
  const imagenes: Imagen[] = [];
  for (const nombre of (await readdir(carpeta)).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort()) {
    const bytes = new Uint8Array(await readFile(path.join(carpeta, nombre)));
    imagenes.push({ nombre, bytes, hash: createHash("sha256").update(bytes).digest("hex") });
  }
  if (imagenes.length === 0) throw new Error(`No hay imágenes en ${carpeta}`);
  return imagenes;
}

/**
 * Si estas imágenes ya tienen factura guardada, la prueba no puede distinguir lo
 * suyo de lo ajeno: se detiene antes de crear o borrar nada.
 */
export async function exigirImagenesSinProcesar(imagenes: Imagen[]): Promise<void> {
  const previas = await db().getAll(...imagenes.map((imagen) => facturas().doc(imagen.hash)));
  const yaGuardadas = previas.filter((documento) => documento.exists).length;
  if (yaGuardadas > 0) {
    throw new Error(
      `${yaGuardadas} de estas imágenes ya tienen factura guardada (de otro lote). ` +
        "Este script no borra datos que no creó: usa otras imágenes o borra antes esos datos.",
    );
  }
}

/** Cookie de sesión del primer correo permitido, sin conocer su contraseña. */
export async function iniciarSesion(url: string): Promise<{ cookie: string; uid: string }> {
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

/** Llamadas a la API con la sesión puesta. `lotes` acumula lo creado, para la limpieza. */
export function crearCliente(url: string, cookie: string, lotes: string[]) {
  const llamar = (metodo: "GET" | "POST", ruta: string, cuerpo?: unknown) =>
    fetch(`${url}${ruta}`, {
      method: metodo,
      headers: cuerpo === undefined ? { cookie } : { cookie, "content-type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });

  /** Llama y devuelve el JSON; si el servidor falla, el error dice qué ruta y qué respondió. */
  async function pedir<T>(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown): Promise<T> {
    const respuesta = await llamar(metodo, ruta, cuerpo);
    const texto = await respuesta.text();
    if (!respuesta.ok) throw new Error(`${metodo} ${ruta} respondió ${respuesta.status}: ${texto.slice(0, 300) || "(sin cuerpo)"}`);
    return JSON.parse(texto) as T;
  }

  async function crearSubirEIniciar(carpetaLote: string, imagenes: Imagen[]): Promise<string> {
    const { id } = await pedir<{ id: string }>("POST", "/api/procesos", { carpeta: carpetaLote, totalArchivos: imagenes.length });
    lotes.push(id);
    for (const [i, imagen] of imagenes.entries()) {
      const subida = await fetch(`${url}/api/procesos/${id}/imagenes?indice=${i + 1}&nombre=${encodeURIComponent(imagen.nombre)}`, {
        method: "POST",
        headers: { cookie, "content-type": "application/octet-stream" },
        body: imagen.bytes,
      });
      if (!subida.ok) throw new Error(`No se pudo subir ${imagen.nombre} (${subida.status})`);
    }
    await pedir("POST", `/api/procesos/${id}/iniciar`);
    return id;
  }

  /** Lo mismo que hace el Motor del navegador: 3 llamadas a la vez hasta vaciar la cola, y finalizar. */
  async function procesarYFinalizar(id: string): Promise<void> {
    async function trabajador() {
      for (;;) {
        if ((await pedir<ResumenLote>("POST", `/api/procesos/${id}/lote`)).reclamados === 0) return;
      }
    }
    await Promise.all([trabajador(), trabajador(), trabajador()]);
    for (let intento = 0; intento < 15; intento += 1) {
      if ((await pedir<{ listo: boolean }>("POST", `/api/procesos/${id}/finalizar`)).listo) return;
      await esperar(2000);
    }
    throw new Error("El lote no terminó de finalizar");
  }

  return { llamar, pedir, crearSubirEIniciar, procesarYFinalizar };
}

/**
 * Borra lo que creó la prueba, comprobándolo en vez de suponerlo: una factura
 * solo si pertenece a uno de sus lotes, un índice solo si apunta a esa factura y
 * un cliente solo si lo creó uno de sus lotes.
 */
export async function limpiar(lotes: string[], imagenes: Imagen[]): Promise<string> {
  let facturasBorradas = 0;
  let clientesBorrados = 0;
  for (const documento of await db().getAll(...imagenes.map((imagen) => facturas().doc(imagen.hash)))) {
    const factura = documento.data() as Factura | undefined;
    if (!factura || !lotes.includes(factura.procesoId)) continue;
    if (factura.numero) {
      const indice = db().collection(COLECCIONES.indicesNumero).doc(factura.numero);
      if (((await indice.get()).data() as IndiceNumero | undefined)?.hashArchivo === documento.id) await indice.delete();
    }
    await documento.ref.delete();
    facturasBorradas += 1;
  }
  for (const id of lotes) {
    for (const cliente of (await clientes().where("primerProcesoId", "==", id).get()).docs) {
      await cliente.ref.delete();
      clientesBorrados += 1;
    }
    const carpetaLote = prefijoProceso(id).replace(/\/$/, "");
    const { data } = await almacen().list(carpetaLote, { limit: 1000 });
    const rutas = (data ?? []).map((archivo) => `${carpetaLote}/${archivo.name}`);
    if (rutas.length > 0) await almacen().remove(rutas);
    for (const archivo of (await procesos().doc(id).collection(COLECCIONES.archivos).get()).docs) await archivo.ref.delete();
    await procesos().doc(id).delete();
  }
  return `${lotes.length} lote(s) con su cola y sus archivos; ${facturasBorradas} factura(s) con sus índices; ${clientesBorrados} cliente(s)`;
}
