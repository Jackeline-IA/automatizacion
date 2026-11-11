import { exigirUsuario } from "@/lib/auth/sesion";
import { procesarLote } from "@/lib/procesamiento/lote";
import { loteNoEncontrado, procesoDelUsuario } from "@/lib/procesamiento/proceso";

// El máximo del plan Hobby. El lote se detiene solo a los 200 s (ver lote.ts).
export const maxDuration = 300;

/**
 * Procesa unos pocos archivos de la cola y responde con un resumen. Quien llama
 * repite la petición (varias a la vez) hasta que `reclamados` sea 0.
 */
export async function POST(request: Request, contexto: RouteContext<"/api/procesos/[id]/lote">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { id } = await contexto.params;
  const proceso = await procesoDelUsuario(id, usuario.uid);
  if (!proceso) return loteNoEncontrado();
  if (proceso.estado === "subiendo") {
    return Response.json({ error: "El lote aún no se ha iniciado" }, { status: 409 });
  }

  return Response.json(await procesarLote(id, proceso.uid));
}
