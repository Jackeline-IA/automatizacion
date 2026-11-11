import { exigirUsuario } from "@/lib/auth/sesion";
import { db } from "@/lib/firebase/admin";
import { COLECCIONES } from "@/lib/modelo/tipos";
import { lotesDelUsuario } from "@/lib/procesamiento/proceso";

/**
 * Lo que necesita el panel de métricas: los lotes del usuario con sus contadores
 * y cuántos clientes hay en la base. Cuesta 1 lectura por lote + 1 (el conteo):
 * no se recorre ninguna factura.
 */
export async function GET(request: Request) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const [lotes, clientes] = await Promise.all([
    lotesDelUsuario(usuario.uid),
    db().collection(COLECCIONES.clientes).count().get(),
  ]);
  return Response.json({ lotes, clientes: clientes.data().count });
}
