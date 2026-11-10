import { NextResponse } from "next/server";
import { auth } from "@/lib/firebase/admin";
import { COOKIE_SESION, DURACION_SESION_MS, correoPermitido, exigirUsuario } from "@/lib/auth/sesion";

// Un ID token solo se cambia por una sesión si el inicio de sesión es reciente:
// así un token robado más tarde no sirve para fabricar una cookie de 5 días.
const ANTIGUEDAD_MAXIMA_LOGIN_S = 5 * 60;

function opcionesCookie(maxAgeSegundos: number) {
  return {
    httpOnly: true, // el JavaScript del navegador no puede leerla
    // En http://localhost una cookie `secure` no siempre se guarda.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSegundos,
  };
}

/** Iniciar sesión: cambia el ID token de Firebase por una cookie de sesión. */
export async function POST(request: Request) {
  let idToken: unknown;
  try {
    idToken = ((await request.json()) as { idToken?: unknown }).idToken;
  } catch {
    idToken = undefined;
  }
  if (typeof idToken !== "string" || idToken.length === 0) {
    return Response.json({ error: "Falta el token de inicio de sesión" }, { status: 400 });
  }

  let datos;
  try {
    datos = await auth().verifyIdToken(idToken);
  } catch {
    return Response.json({ error: "Token no válido" }, { status: 401 });
  }

  if (Date.now() / 1000 - datos.auth_time > ANTIGUEDAD_MAXIMA_LOGIN_S) {
    return Response.json({ error: "El inicio de sesión caducó; vuelve a entrar" }, { status: 401 });
  }
  if (!correoPermitido(datos.email)) {
    return Response.json({ error: "Este correo no está autorizado" }, { status: 403 });
  }

  const cookie = await auth().createSessionCookie(idToken, { expiresIn: DURACION_SESION_MS });
  const respuesta = NextResponse.json({ email: datos.email });
  respuesta.cookies.set(COOKIE_SESION, cookie, opcionesCookie(DURACION_SESION_MS / 1000));
  return respuesta;
}

/** ¿Quién soy? Lo usa la interfaz para mostrar el correo. */
export async function GET(request: Request) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  return Response.json({ email: usuario.email });
}

/** Cerrar sesión: borra la cookie. */
export async function DELETE() {
  const respuesta = NextResponse.json({ ok: true });
  respuesta.cookies.set(COOKIE_SESION, "", opcionesCookie(0));
  return respuesta;
}
