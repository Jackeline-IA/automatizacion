import { descargarArchivo } from "@/lib/almacen";
import { exigirUsuario } from "@/lib/auth/sesion";
import { db } from "@/lib/firebase/admin";
import { CONTENT_TYPE, tipoPorFirma } from "@/lib/imagen";
import { COLECCIONES, type Factura } from "@/lib/modelo/tipos";

function noEncontrada(): Response {
  return Response.json({ error: "La factura no existe" }, { status: 404 });
}

/**
 * La imagen original de una factura. El bucket es privado: el navegador no
 * puede pedirla al almacén; el servidor la lee y la entrega solo a su dueño.
 */
export async function GET(request: Request, contexto: RouteContext<"/api/facturas/[hash]/imagen">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { hash } = await contexto.params;
  // El ID de una factura es un SHA-256: 64 caracteres hexadecimales.
  if (!/^[a-f0-9]{64}$/.test(hash)) return noEncontrada();

  const factura = (await db().collection(COLECCIONES.facturas).doc(hash).get()).data() as Factura | undefined;
  // Mismo 404 si no existe o si es de otro usuario: no se revela que existe.
  if (!factura || factura.uid !== usuario.uid) return noEncontrada();

  const imagen = await descargarArchivo(factura.rutaAlmacen);
  const tipo = tipoPorFirma(imagen);
  return new Response(new Uint8Array(imagen), {
    headers: {
      "content-type": tipo ? CONTENT_TYPE[tipo] : "application/octet-stream",
      "content-length": String(imagen.length),
      // La imagen de un hash no cambia nunca, pero es privada: solo la caché del propio navegador.
      "cache-control": "private, max-age=3600",
    },
  });
}
