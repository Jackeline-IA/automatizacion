import { exigirUsuario } from "@/lib/auth/sesion";
import { motivosCorreccion } from "@/lib/procesamiento/correccion";
import { erroresDeFormato, esquemaCorreccion } from "@/lib/procesamiento/correccion-esquema";
import { corregirFactura, detalleRevision } from "@/lib/procesamiento/corregir";

function noEncontrada(): Response {
  return Response.json({ error: "La factura no existe" }, { status: 404 });
}

/** El ID de una factura es un SHA-256: 64 caracteres hexadecimales. */
const hashValido = (hash: string) => /^[a-f0-9]{64}$/.test(hash);

/** Detalle de una factura para el formulario de revisión. */
export async function GET(request: Request, contexto: RouteContext<"/api/facturas/[hash]">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { hash } = await contexto.params;
  if (!hashValido(hash)) return noEncontrada();
  const detalle = await detalleRevision(hash, usuario.uid);
  // Mismo 404 si no existe o si es de otro usuario: no se revela que existe.
  if (!detalle) return noEncontrada();
  return Response.json(detalle, { headers: { "cache-control": "private, no-store" } });
}

/**
 * Guarda la revisión manual. El servidor NO confía en el navegador: valida el
 * formato con zod y repite las reglas del OCR.
 *   400 formato · 422 validaciones sin confirmar · 404 no existe o es ajena
 *   409 la aceptó la máquina, o su número ya existe en otra factura
 */
export async function PUT(request: Request, contexto: RouteContext<"/api/facturas/[hash]">) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const { hash } = await contexto.params;
  if (!hashValido(hash)) return noEncontrada();

  // Primero lo que no cuesta lecturas: formato y reglas.
  const cuerpo: unknown = await request.json().catch(() => null);
  const errores = erroresDeFormato(cuerpo);
  if (errores.length > 0) return Response.json({ error: "Hay datos con formato incorrecto", errores }, { status: 400 });
  const entrada = esquemaCorreccion.parse(cuerpo);

  const motivos = motivosCorreccion(entrada);
  if (motivos.length > 0 && !entrada.confirmado) {
    return Response.json(
      { error: "Hay validaciones que no cuadran: revisa la imagen y confirma para guardar de todos modos", motivos },
      { status: 422 },
    );
  }

  const resultado = await corregirFactura(hash, usuario, entrada, motivos);
  if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });
  return Response.json({ guardada: true, reedicion: resultado.reedicion, clienteNuevo: resultado.clienteNuevo, validacionesIgnoradas: motivos });
}
