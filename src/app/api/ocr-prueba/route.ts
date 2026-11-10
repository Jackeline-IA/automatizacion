/*
 * RUTA TEMPORAL de la Fase 5: comprueba que el OCR funciona dentro de una función
 * desplegada. Recibe UNA imagen en el cuerpo de la petición y devuelve lo leído.
 * No guarda nada (ni en Firestore ni en el almacén). Se borra al terminar la
 * fase: el flujo real leerá las imágenes del almacén (Fase 6).
 */
import { exigirUsuario } from "@/lib/auth/sesion";
import { leerFactura } from "@/lib/ocr/leer-factura";

// El primer OCR tras un arranque en frío tarda varios segundos, y una factura
// difícil puede necesitar tres lecturas.
export const maxDuration = 300;

// Vercel no deja pasar cuerpos de más de 4,5 MB; una factura pesa ~100 KB.
const TAMANO_MAXIMO = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const imagen = Buffer.from(await request.arrayBuffer());
  if (imagen.length === 0) return Response.json({ error: "Falta la imagen en el cuerpo" }, { status: 400 });
  if (imagen.length > TAMANO_MAXIMO) return Response.json({ error: "La imagen pasa de 4 MB" }, { status: 413 });

  const inicio = Date.now();
  try {
    const { factura, motivos, modo, confianza } = await leerFactura(imagen);
    return Response.json({ factura, motivos, modo, confianza, ms: Date.now() - inicio });
  } catch (error) {
    // El mensaje es nuestro (tope de tiempo) o de tesseract/sharp: no lleva secretos.
    const mensaje = error instanceof Error ? error.message : String(error);
    return Response.json({ error: mensaje, ms: Date.now() - inicio }, { status: 500 });
  }
}
