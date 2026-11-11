import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/sesion";
import { db } from "@/lib/firebase/admin";
import { COLECCIONES, type Proceso } from "@/lib/modelo/tipos";
import { MAXIMO_ARCHIVOS_POR_LOTE } from "@/lib/procesamiento/subidas";

const NuevoLote = z.object({
  carpeta: z.string().trim().min(1).max(200),
  totalArchivos: z.number().int().min(1).max(MAXIMO_ARCHIVOS_POR_LOTE),
});

/** Crea un lote vacío, en estado «subiendo», a nombre de quien inició sesión. */
export async function POST(request: Request) {
  const usuario = await exigirUsuario(request);
  if (usuario instanceof Response) return usuario;

  const cuerpo: unknown = await request.json().catch(() => null);
  const datos = NuevoLote.safeParse(cuerpo);
  if (!datos.success) {
    return Response.json(
      { error: `Se esperaba { carpeta, totalArchivos } con 1 a ${MAXIMO_ARCHIVOS_POR_LOTE} archivos` },
      { status: 400 },
    );
  }

  const proceso: Proceso = {
    uid: usuario.uid, // el dueño sale de la sesión, nunca de lo que envía el navegador
    carpeta: datos.data.carpeta,
    estado: "subiendo",
    totalArchivos: datos.data.totalArchivos,
    inicio: Date.now(),
    fin: null,
    rutaExcel: null,
    finalizandoDesde: null,
  };
  const referencia = await db().collection(COLECCIONES.procesos).add(proceso);
  return Response.json({ id: referencia.id }, { status: 201 });
}
