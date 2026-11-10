/*
 * Fase 5 — Comprueba el OCR por HTTP, contra local o contra el despliegue.
 * TEMPORAL: usa la ruta /api/ocr-prueba, que se borra al terminar la fase.
 *
 * Uso: npx tsx scripts/probar-ocr.ts <carpetaImagenes> [url]   (por defecto http://localhost:3000)
 *
 * Envía cada imagen de la carpeta en el cuerpo de una petición (una por una,
 * para medir el tiempo de cada factura) e imprime lo que la función leyó.
 * No guarda nada en ningún servicio; nunca imprime tokens ni cookies.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "../src/lib/firebase/admin";
import { COOKIE_SESION, correosPermitidos } from "../src/lib/auth/sesion";
import type { ParcialFactura } from "../src/lib/ocr/tipos";

interface Respuesta {
  factura?: ParcialFactura;
  motivos?: string[];
  modo?: string;
  confianza?: number;
  ms?: number;
  error?: string;
}

/** Cookie de sesión del primer correo permitido, sin conocer su contraseña (igual que probar-sesion.ts). */
async function iniciarSesion(url: string): Promise<string> {
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
  return cookie.split(";")[0];
}

const pesos = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("es-CO")}`);

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const carpeta = process.argv[2];
  if (!carpeta) {
    console.error("Uso: npx tsx scripts/probar-ocr.ts <carpetaImagenes> [url]");
    process.exit(1);
  }
  const url = (process.argv[3] ?? "http://localhost:3000").replace(/\/+$/, "");
  const archivos = (await readdir(carpeta)).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort();
  console.log(`Leyendo ${archivos.length} imagen(es) de ${carpeta} con el OCR de ${url}\n`);

  const sinSesion = await fetch(`${url}/api/ocr-prueba`, { method: "POST", body: "x" });
  console.log(`${sinSesion.status === 401 ? "OK   " : "FALLO"} POST /api/ocr-prueba sin cookie → ${sinSesion.status}\n`);

  const cookie = await iniciarSesion(url);
  const inicioTotal = Date.now();
  let aceptadas = 0;
  let revision = 0;
  let errores = sinSesion.status === 401 ? 0 : 1;

  for (const archivo of archivos) {
    const imagen = await readFile(path.join(carpeta, archivo));
    const inicio = Date.now();
    const respuesta = await fetch(`${url}/api/ocr-prueba`, {
      method: "POST",
      headers: { cookie, "content-type": /\.png$/i.test(archivo) ? "image/png" : "image/jpeg" },
      body: new Uint8Array(imagen),
    });
    const ida = Date.now() - inicio;
    // Un 504 de la plataforma no trae JSON: se muestra el estado tal cual.
    const cuerpo = (await respuesta.json().catch(() => ({}))) as Respuesta;

    if (!respuesta.ok || !cuerpo.factura) {
      errores += 1;
      console.log(`✕ ERROR     ${archivo} → HTTP ${respuesta.status} en ${ida} ms: ${cuerpo.error ?? "(sin mensaje)"}`);
      continue;
    }
    const f = cuerpo.factura;
    const motivos = cuerpo.motivos ?? [];
    if (motivos.length === 0) aceptadas += 1;
    else revision += 1;
    console.log(`${motivos.length === 0 ? "✓ ACEPTADA " : "✕ REVISIÓN "} ${archivo} — ${ida} ms (OCR ${cuerpo.ms} ms, modo ${cuerpo.modo}, confianza ${Math.round(cuerpo.confianza ?? 0)} %)`);
    console.log(`    ${f.numero ?? "—"} · ${f.fecha ?? "—"} · ${f.items.length} ítem(s)`);
    console.log(`    proveedor: ${f.proveedor ?? "—"} (${f.nitProveedor ?? "—"}-${f.dvProveedor ?? "—"})`);
    console.log(`    cliente:   ${f.clienteNombre ?? "—"} (${f.clienteDocumento ?? "—"}-${f.clienteDv ?? "—"})`);
    console.log(`    subtotal ${pesos(f.subtotal)} · IVA ${pesos(f.iva)} · impoconsumo ${pesos(f.impoconsumo)} · total ${pesos(f.total)}`);
    for (const m of motivos) console.log(`    motivo: ${m}`);
  }

  const total = Date.now() - inicioTotal;
  const porImagen = archivos.length ? Math.round(total / archivos.length) : 0;
  console.log(`\n${aceptadas} aceptada(s), ${revision} a revisión, ${errores} error(es).`);
  console.log(`Tiempo total ${(total / 1000).toFixed(1)} s; ${porImagen} ms por imagen.`);
  process.exit(errores === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
