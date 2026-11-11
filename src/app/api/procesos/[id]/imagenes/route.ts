import { guardarArchivo } from "@/lib/almacen";
import { exigirUsuario } from "@/lib/auth/sesion";
import { CONTENT_TYPE, tipoPorFirma } from "@/lib/imagen";
import { comprobarImagen, leerCuerpoLimitado, loteAbierto, TAMANO_MAXIMO_BYTES } from "@/lib/procesamiento/subidas";
import { rutaImagen } from "@/lib/rutas";

export const maxDuration = 60;

function rechazo(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/**
 * Recibe UNA imagen (los bytes son el cuerpo de la petición) y la guarda en el
 * almacén si pasa todas las comprobaciones. El orden importa: primero lo barato
 * y lo que protege (sesión, lote), al final lo caro (decodificar, subir).
 *
 *   POST /api/procesos/<id>/imagenes?indice=N&nombre=factura.png
 */
export async function POST(request: Request, contexto: RouteContext<"/api/procesos/[id]/imagenes">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { id } = await contexto.params;
  const lote = await loteAbierto(id, usuario.uid);
  // Mismo 404 si no existe, si es de otro usuario o si ya no admite subidas.
  if (!lote) return rechazo(404, "El lote no existe o ya no admite imágenes");

  const parametros = new URL(request.url).searchParams;
  const indice = Number(parametros.get("indice"));
  if (!Number.isInteger(indice) || indice < 1 || indice > lote.totalArchivos) {
    return rechazo(400, `El índice debe ser un entero entre 1 y ${lote.totalArchivos}`);
  }

  // Tamaño: la cabecera permite rechazar sin leer nada, pero la escribe quien
  // envía; por eso también se cuentan los bytes reales.
  if (Number(request.headers.get("content-length") ?? 0) > TAMANO_MAXIMO_BYTES) {
    return rechazo(413, "La imagen pasa de 4 MB");
  }
  const imagen = await leerCuerpoLimitado(request, TAMANO_MAXIMO_BYTES);
  if (imagen === null) return rechazo(413, "La imagen pasa de 4 MB");
  if (imagen.length === 0) return rechazo(400, "Falta la imagen en el cuerpo de la petición");

  // Tipo real por la firma: no se confía en el nombre ni en el content-type.
  const tipo = tipoPorFirma(imagen);
  if (!tipo) return rechazo(415, "El archivo no es una imagen PNG ni JPEG");

  const estado = await comprobarImagen(imagen);
  if (estado === "demasiados-pixeles") return rechazo(413, "La imagen tiene demasiados píxeles");
  if (estado === "ilegible") return rechazo(415, "La imagen está dañada y no se puede leer");

  const ruta = rutaImagen(id, indice, parametros.get("nombre") ?? "", tipo);
  await guardarArchivo(ruta, imagen, CONTENT_TYPE[tipo]);
  return Response.json({ ruta });
}
