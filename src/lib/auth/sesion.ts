/*
 * Sesión del usuario: SOLO servidor.
 *
 * Firebase Auth responde «¿quién eres?» (autenticación). La lista
 * USUARIOS_PERMITIDOS responde «¿puedes usar esta app?» (autorización): hace
 * falta porque la apiKey de Firebase es pública y cualquiera puede crear una
 * cuenta en el proyecto y obtener un token válido.
 */
import { auth } from "@/lib/firebase/admin";

export const COOKIE_SESION = "sesion";
export const DURACION_SESION_MS = 5 * 24 * 60 * 60 * 1000; // 5 días

export interface Usuario {
  uid: string;
  email: string;
}

/**
 * Correos autorizados, en minúsculas. Tolera comillas y espacios alrededor de
 * cada correo (un pegado descuidado en el panel de Vercel). Si la variable no
 * está definida la lista queda vacía y nadie entra: falla cerrado.
 */
export function correosPermitidos(): string[] {
  return (process.env.USUARIOS_PERMITIDOS ?? "")
    .split(",")
    .map((correo) => correo.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase())
    .filter(Boolean);
}

export function correoPermitido(email: string | undefined): email is string {
  return !!email && correosPermitidos().includes(email.toLowerCase());
}

function leerCookie(request: Request, nombre: string): string | null {
  const cabecera = request.headers.get("cookie");
  if (!cabecera) return null;
  for (const parte of cabecera.split(";")) {
    const igual = parte.indexOf("=");
    if (igual === -1) continue;
    if (parte.slice(0, igual).trim() === nombre) return parte.slice(igual + 1).trim();
  }
  return null;
}

function noAutorizado(): Response {
  return Response.json({ error: "No has iniciado sesión" }, { status: 401 });
}

/**
 * Verificación real de la sesión; se usa en TODAS las rutas de la API:
 *
 *   const u = await exigirUsuario(request);
 *   if (u instanceof Response) return u;
 *
 * Devuelve el usuario o una respuesta 401 lista para devolver.
 */
export async function exigirUsuario(request: Request): Promise<Usuario | Response> {
  const cookie = leerCookie(request, COOKIE_SESION);
  if (!cookie) return noAutorizado();
  try {
    // El `true` comprueba también que la sesión no haya sido revocada.
    const datos = await auth().verifySessionCookie(cookie, true);
    // Se vuelve a mirar la lista en cada petición: quitar un correo de
    // USUARIOS_PERMITIDOS corta su acceso aunque su cookie siga vigente.
    if (!correoPermitido(datos.email)) return noAutorizado();
    return { uid: datos.uid, email: datos.email };
  } catch {
    // Cookie inventada, caducada o revocada: no se revela cuál de las tres.
    return noAutorizado();
  }
}
