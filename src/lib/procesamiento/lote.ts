/*
 * Un «lote» de trabajo: reclama unos pocos archivos de la cola y los procesa en
 * serie. Es lo que ejecuta cada invocación de POST /api/procesos/[id]/lote.
 *
 * El paralelismo no está aquí (Vercel Hobby da 1 vCPU por función): lo da quien
 * llama, lanzando varias invocaciones a la vez.
 */
import { createHash } from "node:crypto";
import { descargarArchivo } from "@/lib/almacen";
import { leerFactura } from "@/lib/ocr/leer-factura";
import { devolver, INTENTOS_MAXIMOS, reclamar, reintentarMasTarde, type ArchivoReclamado } from "./cola";
import { facturaYaExiste, guardarFactura, guardarFallo, marcarDuplicada } from "./guardar";

/*
 * Presupuesto de tiempo: la función puede vivir 300 s. Pasados 200 s no se
 * empieza otro archivo; los que faltan se devuelven a la cola. Es mejor
 * devolverlos que dejar que la plataforma mate la función a mitad de un guardado.
 */
const PRESUPUESTO_MS = 200_000;

export interface ResumenLote {
  reclamados: number;
  aceptadas: number;
  revision: number;
  duplicadas: number;
  /** Archivos que agotaron sus intentos. */
  errores: number;
  /** Fallaron esta vez pero les quedan intentos: volvieron a la cola. */
  reintentos: number;
  /** No se empezaron por falta de tiempo: volvieron a la cola sin contar intento. */
  devueltos: number;
  ms: number;
}

type Resultado = "aceptada" | "revision" | "duplicada";

async function procesarArchivo(
  procesoId: string,
  uid: string,
  archivo: ArchivoReclamado,
  alCalcularHash: (hash: string) => void,
): Promise<Resultado> {
  const imagen = await descargarArchivo(archivo.rutaAlmacen);
  const hash = createHash("sha256").update(imagen).digest("hex");
  alCalcularHash(hash);

  // Atajo previo al OCR: si esta imagen ya se guardó, basta 1 lectura. Reprocesar
  // la misma carpeta pasa de minutos de CPU a segundos.
  if (await facturaYaExiste(hash)) {
    await marcarDuplicada(procesoId, archivo.id, hash);
    return "duplicada";
  }

  const lectura = await leerFactura(imagen);
  const contexto = { hash, archivo: archivo.nombre, rutaAlmacen: archivo.rutaAlmacen, procesoId, uid, ahora: Date.now() };
  return guardarFactura(contexto, archivo.id, lectura);
}

export async function procesarLote(procesoId: string, uid: string): Promise<ResumenLote> {
  const inicio = Date.now();
  const reclamados = await reclamar(procesoId);
  const resumen: ResumenLote = {
    reclamados: reclamados.length,
    aceptadas: 0,
    revision: 0,
    duplicadas: 0,
    errores: 0,
    reintentos: 0,
    devueltos: 0,
    ms: 0,
  };

  for (const [i, archivo] of reclamados.entries()) {
    if (Date.now() - inicio > PRESUPUESTO_MS) {
      const resto = reclamados.slice(i);
      await Promise.all(resto.map((pendiente) => devolver(procesoId, pendiente.id)));
      resumen.devueltos = resto.length;
      break;
    }

    let hash: string | null = null;
    try {
      const resultado = await procesarArchivo(procesoId, uid, archivo, (calculado) => {
        hash = calculado;
      });
      if (resultado === "aceptada") resumen.aceptadas += 1;
      else if (resultado === "revision") resumen.revision += 1;
      else resumen.duplicadas += 1;
    } catch (error) {
      // Un error en una imagen no detiene el lote.
      const mensaje = error instanceof Error ? error.message : String(error);
      if (archivo.intentos >= INTENTOS_MAXIMOS) {
        await guardarFallo(
          { hash, archivo: archivo.nombre, rutaAlmacen: archivo.rutaAlmacen, procesoId, uid, ahora: Date.now() },
          archivo.id,
          mensaje,
        );
        resumen.errores += 1;
      } else {
        await reintentarMasTarde(procesoId, archivo.id, mensaje);
        resumen.reintentos += 1;
      }
    }
  }

  resumen.ms = Date.now() - inicio;
  return resumen;
}
