/*
 * Fase A — Comprueba la autenticación por HTTP, contra local o contra el despliegue.
 *
 * Uso: npx tsx scripts/probar-sesion.ts [url]      (por defecto http://localhost:3000)
 *
 * No necesita ninguna contraseña: usa la cuenta de servicio para fabricar un
 * token de un solo uso del primer correo de USUARIOS_PERMITIDOS y lo cambia por
 * un ID token, igual que haría el navegador tras escribir la contraseña.
 * No crea ni borra nada; nunca imprime tokens ni cookies.
 */
import { auth } from "../src/lib/firebase/admin";
import { COOKIE_SESION, correosPermitidos } from "../src/lib/auth/sesion";

let fallos = 0;
function comprobar(descripcion: string, obtenido: unknown, esperado: unknown): void {
  const bien = obtenido === esperado;
  if (!bien) fallos += 1;
  console.log(`${bien ? "OK   " : "FALLO"} ${descripcion} → ${String(obtenido)}${bien ? "" : ` (se esperaba ${String(esperado)})`}`);
}

/** ID token real del usuario, sin conocer su contraseña. */
async function obtenerIdToken(correo: string): Promise<string> {
  const usuario = await auth().getUserByEmail(correo);
  const tokenPropio = await auth().createCustomToken(usuario.uid);
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const respuesta = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: tokenPropio, returnSecureToken: true }),
    },
  );
  if (!respuesta.ok) throw new Error(`Firebase rechazó el token de prueba (${respuesta.status})`);
  return ((await respuesta.json()) as { idToken: string }).idToken;
}

/** Extrae «sesion=valor» de la cabecera Set-Cookie para reenviarla. */
function cookieDe(respuesta: Response): string | null {
  for (const linea of respuesta.headers.getSetCookie()) {
    if (linea.startsWith(`${COOKIE_SESION}=`)) return linea.split(";")[0];
  }
  return null;
}

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const url = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
  console.log(`Probando la autenticación en ${url}\n`);

  // --- Sin sesión ---
  comprobar("GET /api/salud sin cookie", (await fetch(`${url}/api/salud`)).status, 401);
  comprobar("GET /api/sesion sin cookie", (await fetch(`${url}/api/sesion`)).status, 401);

  const inicio = await fetch(`${url}/`, { redirect: "manual" });
  comprobar("GET / sin cookie redirige", inicio.status >= 300 && inicio.status < 400, true);
  comprobar("  …hacia /login", new URL(inicio.headers.get("location") ?? "/", url).pathname, "/login");
  comprobar("GET /login abre sin sesión", (await fetch(`${url}/login`)).status, 200);

  const cookieFalsa = { headers: { cookie: `${COOKIE_SESION}=esto-no-es-una-cookie-valida` } };
  comprobar("GET /api/salud con cookie inventada", (await fetch(`${url}/api/salud`, cookieFalsa)).status, 401);

  const tokenFalso = await fetch(`${url}/api/sesion`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "token.inventado.xyz" }),
  });
  comprobar("POST /api/sesion con token inventado", tokenFalso.status, 401);

  // --- Inicio de sesión real ---
  const correo = correosPermitidos()[0];
  if (!correo) throw new Error("USUARIOS_PERMITIDOS está vacía");
  const idToken = await obtenerIdToken(correo);

  const login = await fetch(`${url}/api/sesion`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  comprobar("POST /api/sesion con token real", login.status, 200);
  const setCookie = login.headers.getSetCookie().find((l) => l.startsWith(`${COOKIE_SESION}=`)) ?? "";
  comprobar("  …la cookie es httpOnly", /;\s*httponly/i.test(setCookie), true);

  const cookie = cookieDe(login);
  if (!cookie) throw new Error("El servidor no devolvió la cookie de sesión");
  const conSesion = { headers: { cookie } };

  const quien = await fetch(`${url}/api/sesion`, conSesion);
  comprobar("GET /api/sesion con cookie", quien.status, 200);
  const datos = (await quien.json()) as { email?: string };
  comprobar("  …devuelve el correo permitido", datos.email?.toLowerCase() === correo, true);
  comprobar("GET /api/salud con cookie", (await fetch(`${url}/api/salud`, conSesion)).status, 200);
  comprobar("GET / con cookie abre", (await fetch(`${url}/`, { ...conSesion, redirect: "manual" })).status, 200);

  // --- Cerrar sesión ---
  const salida = await fetch(`${url}/api/sesion`, { method: "DELETE", ...conSesion });
  comprobar("DELETE /api/sesion", salida.status, 200);
  const borrada = salida.headers.getSetCookie().find((l) => l.startsWith(`${COOKIE_SESION}=`)) ?? "";
  comprobar("  …ordena borrar la cookie", /max-age=0/i.test(borrada), true);

  console.log(fallos === 0 ? "\nAutenticación correcta." : `\n${fallos} comprobación(es) fallaron.`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
