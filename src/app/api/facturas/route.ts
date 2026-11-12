import { exigirUsuario } from "@/lib/auth/sesion";
import { pendientesDeRevision } from "@/lib/procesamiento/corregir";

/**
 * Las facturas del usuario que esperan revisión manual (Fase 9).
 * Cuesta una lectura por factura listada; como mucho 200 (`hayMas` avisa si hay más).
 *
 *   GET /api/facturas  →  { pendientes: [...], hayMas: boolean }
 */
export async function GET(request: Request) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;
  return Response.json(await pendientesDeRevision(usuario.uid), { headers: { "cache-control": "private, no-store" } });
}
