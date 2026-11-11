import { exigirUsuario } from "@/lib/auth/sesion";
import { facturasDelLote } from "@/lib/procesamiento/facturas-lote";
import { loteNoEncontrado, procesoDelUsuario } from "@/lib/procesamiento/proceso";

/** Las facturas de un lote, para la tabla de su detalle. */
export async function GET(request: Request, contexto: RouteContext<"/api/procesos/[id]/facturas">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { id } = await contexto.params;
  if (!(await procesoDelUsuario(id, usuario.uid))) return loteNoEncontrado();

  return Response.json({ facturas: await facturasDelLote(id) });
}
