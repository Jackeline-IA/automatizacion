import { exigirUsuario } from "@/lib/auth/sesion";
import { contarPendientes } from "@/lib/procesamiento/cola";
import { loteNoEncontrado, procesoDelUsuario } from "@/lib/procesamiento/proceso";

/** Estado de un lote y cuántos archivos le faltan. */
export async function GET(request: Request, contexto: RouteContext<"/api/procesos/[id]">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { id } = await contexto.params;
  const proceso = await procesoDelUsuario(id, usuario.uid);
  if (!proceso) return loteNoEncontrado();

  const { carpeta, estado, totalArchivos, inicio, fin, rutaExcel } = proceso;
  return Response.json({
    id,
    carpeta,
    estado,
    totalArchivos,
    inicio,
    fin,
    tieneExcel: rutaExcel !== null,
    pendientes: estado === "ejecutando" ? await contarPendientes(id) : 0,
  });
}
