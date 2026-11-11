import { descargarArchivo } from "@/lib/almacen";
import { exigirUsuario } from "@/lib/auth/sesion";
import { CONTENT_TYPE_EXCEL } from "@/lib/excel/generar";
import { loteNoEncontrado, procesoDelUsuario } from "@/lib/procesamiento/proceso";

/**
 * Descarga el Excel del lote. El bucket es privado: el navegador no puede ir a
 * buscarlo; el servidor lo lee del almacén y lo entrega solo al dueño del lote.
 */
export async function GET(request: Request, contexto: RouteContext<"/api/procesos/[id]/excel">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { id } = await contexto.params;
  const proceso = await procesoDelUsuario(id, usuario.uid);
  if (!proceso) return loteNoEncontrado();
  if (!proceso.rutaExcel) {
    return Response.json({ error: "El lote aún no tiene Excel: todavía no ha terminado" }, { status: 409 });
  }

  const excel = await descargarArchivo(proceso.rutaExcel);
  const nombre = proceso.rutaExcel.slice(proceso.rutaExcel.lastIndexOf("/") + 1);
  return new Response(new Uint8Array(excel), {
    headers: {
      "content-type": CONTENT_TYPE_EXCEL,
      // «attachment»: el navegador lo descarga en vez de intentar abrirlo.
      "content-disposition": `attachment; filename="${nombre}"`,
      "content-length": String(excel.length),
      "cache-control": "private, no-store",
    },
  });
}
