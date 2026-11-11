import { exigirUsuario } from "@/lib/auth/sesion";
import { iniciarProceso } from "@/lib/procesamiento/iniciar";
import { loteNoEncontrado, procesoDelUsuario } from "@/lib/procesamiento/proceso";

export const maxDuration = 60;

/** Crea la cola de trabajo del lote a partir de las imágenes subidas. Repetirlo no duplica. */
export async function POST(request: Request, contexto: RouteContext<"/api/procesos/[id]/iniciar">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { id } = await contexto.params;
  if (!(await procesoDelUsuario(id, usuario.uid))) return loteNoEncontrado();

  return Response.json(await iniciarProceso(id));
}
