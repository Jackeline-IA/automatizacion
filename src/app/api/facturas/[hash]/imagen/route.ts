import sharp from "sharp";
import { descargarArchivo } from "@/lib/almacen";
import { exigirUsuario } from "@/lib/auth/sesion";
import { db } from "@/lib/firebase/admin";
import { CONTENT_TYPE, tipoPorFirma } from "@/lib/imagen";
import { COLECCIONES, type Factura } from "@/lib/modelo/tipos";

function noEncontrada(): Response {
  return Response.json({ error: "La factura no existe" }, { status: 404 });
}

/** Giros permitidos (Fase 9): para leer facturas fotografiadas de lado. */
const GIROS = new Set(["90", "180", "270"]);

/**
 * La imagen original de una factura. El bucket es privado: el navegador no
 * puede pedirla al almacén; el servidor la lee y la entrega solo a su dueño.
 *
 *   GET /api/facturas/[hash]/imagen            la imagen tal cual se subió
 *   GET /api/facturas/[hash]/imagen?rotar=90   girada (90, 180 o 270 grados, sentido horario);
 *                                              el original del almacén no se toca
 */
export async function GET(request: Request, contexto: RouteContext<"/api/facturas/[hash]/imagen">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { hash } = await contexto.params;
  // El ID de una factura es un SHA-256: 64 caracteres hexadecimales.
  if (!/^[a-f0-9]{64}$/.test(hash)) return noEncontrada();

  // Se valida antes de leer nada: un giro inválido no cuesta lecturas.
  const rotar = new URL(request.url).searchParams.get("rotar");
  if (rotar !== null && !GIROS.has(rotar)) {
    return Response.json({ error: "rotar solo admite 90, 180 o 270" }, { status: 400 });
  }

  const factura = (await db().collection(COLECCIONES.facturas).doc(hash).get()).data() as Factura | undefined;
  // Mismo 404 si no existe o si es de otro usuario: no se revela que existe.
  if (!factura || factura.uid !== usuario.uid) return noEncontrada();

  const original = await descargarArchivo(factura.rutaAlmacen);
  const tipo = tipoPorFirma(original);
  // Girada se entrega en el mismo formato que la original (PNG o JPEG).
  const imagen = rotar === null || !tipo ? original : await sharp(original).rotate(Number(rotar)).toFormat(tipo).toBuffer();
  return new Response(new Uint8Array(imagen), {
    headers: {
      "content-type": tipo ? CONTENT_TYPE[tipo] : "application/octet-stream",
      "content-length": String(imagen.length),
      // La imagen de un hash no cambia nunca, pero es privada: solo la caché del propio navegador.
      "cache-control": "private, max-age=3600",
    },
  });
}
