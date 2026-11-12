import { exigirUsuario } from "@/lib/auth/sesion";
import { revisarPeticionDeBorrado } from "@/lib/procesamiento/borrado";
import { borrarTodo, contarLotesProcesando } from "@/lib/procesamiento/borrar";

// Borrar miles de documentos y archivos puede tardar.
export const maxDuration = 300;

/**
 * «Borrar todo»: vacía los datos de la aplicación, de todos los usuarios.
 * Exige sesión, la palabra BORRAR escrita tal cual y, si hay lotes procesándose,
 * una confirmación adicional. Irreversible.
 *
 *   POST /api/datos/borrar   { "confirmacion": "BORRAR", "aunqueHayaLotesProcesando"?: true }
 */
export async function POST(request: Request) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const cuerpo: unknown = await request.json().catch(() => null);

  // Primero la palabra (sin tocar la base): una petición mal hecha no cuesta lecturas.
  const sinContarLotes = revisarPeticionDeBorrado(cuerpo, 0);
  if (!sinContarLotes.permitido) return Response.json({ error: sinContarLotes.error }, { status: sinContarLotes.status });

  const veredicto = revisarPeticionDeBorrado(cuerpo, await contarLotesProcesando());
  if (!veredicto.permitido) return Response.json({ error: veredicto.error }, { status: veredicto.status });

  return Response.json({ borrado: await borrarTodo() });
}
