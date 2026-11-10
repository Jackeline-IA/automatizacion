import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/*
 * Comprobación OPTIMISTA: si no hay cookie de sesión, manda las páginas a /login.
 * Solo mira que la cookie exista, no que sea válida: la verificación real la hace
 * exigirUsuario en cada ruta de la API. El proxy corre aparte del resto del
 * código y no debe compartir módulos con él; por eso el nombre de la cookie se
 * repite aquí en vez de importarse de src/lib/auth/sesion.ts.
 */
const COOKIE_SESION = "sesion";

export function proxy(request: NextRequest) {
  if (request.cookies.has(COOKIE_SESION)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Todo menos /login, la API (que responde 401 por su cuenta) y los archivos estáticos.
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};
