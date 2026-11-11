import { exigirUsuario } from "@/lib/auth/sesion";
import { finalizarProceso } from "@/lib/procesamiento/finalizar";
import { loteNoEncontrado, procesoDelUsuario } from "@/lib/procesamiento/proceso";

// En la Fase 7 aquí se genera el Excel.
export const maxDuration = 300;

/** Cierra el lote si ya no queda nada pendiente; si queda, responde `listo: false`. */
export async function POST(request: Request, contexto: RouteContext<"/api/procesos/[id]/finalizar">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { id } = await contexto.params;
  if (!(await procesoDelUsuario(id, usuario.uid))) return loteNoEncontrado();

  return Response.json(await finalizarProceso(id));
}
