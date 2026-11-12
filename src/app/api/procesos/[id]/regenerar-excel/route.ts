import { guardarArchivo } from "@/lib/almacen";
import { exigirUsuario } from "@/lib/auth/sesion";
import { cargarDatosExcel } from "@/lib/excel/datos";
import { CONTENT_TYPE_EXCEL, generarExcel } from "@/lib/excel/generar";
import { loteNoEncontrado, procesoDelUsuario } from "@/lib/procesamiento/proceso";

// Leer las facturas del lote y armar el Excel puede tardar con lotes grandes.
export const maxDuration = 60;

/**
 * Vuelve a generar el Excel de un lote terminado desde la base (Fase 9). El
 * Excel es una foto del momento en que terminó el lote: después de corregir
 * facturas a mano, esto lo pone al día. Reemplaza el archivo anterior (misma ruta).
 *
 *   POST /api/procesos/[id]/regenerar-excel
 */
export async function POST(request: Request, contexto: RouteContext<"/api/procesos/[id]/regenerar-excel">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { id } = await contexto.params;
  const proceso = await procesoDelUsuario(id, usuario.uid);
  if (!proceso) return loteNoEncontrado();
  if (proceso.estado !== "terminado" || !proceso.rutaExcel) {
    return Response.json({ error: "El lote aún no ha terminado: todavía no tiene Excel" }, { status: 409 });
  }

  // La duración que muestra el Excel sigue siendo la del procesamiento, no la de ahora.
  const excel = await generarExcel(await cargarDatosExcel(id, proceso, proceso.fin ?? Date.now()));
  await guardarArchivo(proceso.rutaExcel, excel, CONTENT_TYPE_EXCEL);
  return Response.json({ regenerado: true });
}
