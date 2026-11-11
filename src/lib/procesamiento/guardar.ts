/*
 * Guardar una factura en Firestore: SOLO servidor.
 *
 * Todo ocurre en UNA transacción: o se escriben la factura, el índice de su
 * número, el cliente y el cierre del archivo en la cola, o no se escribe nada.
 * La unicidad no la da un UNIQUE (Firestore no lo tiene) sino los IDs:
 * facturas/{hash de la imagen}, indices_numero/{número} y clientes/{documento}.
 */
import { db } from "@/lib/firebase/admin";
import { COLECCIONES, TERMINADO, type Factura, type IndiceNumero, type ResultadoArchivo } from "@/lib/modelo/tipos";
import { dvValido } from "@/lib/ocr/nit";
import { decidirGuardado, type ContextoArchivo, type LecturaParaGuardar } from "./decidir";
import { coleccionArchivos } from "./proceso";

function referenciaFactura(hash: string) {
  return db().collection(COLECCIONES.facturas).doc(hash);
}

/** ¿Esta imagen ya está guardada? Una lectura que ahorra todo el OCR en un reproceso. */
export async function facturaYaExiste(hash: string): Promise<boolean> {
  return (await referenciaFactura(hash).get()).exists;
}

/** Cierra un archivo de la cola como duplicado (su factura ya existía). */
export async function marcarDuplicada(procesoId: string, archivoId: string, hash: string): Promise<void> {
  await coleccionArchivos(procesoId).doc(archivoId).update({
    estado: "ok",
    resultado: "duplicada",
    hashArchivo: hash,
    error: null,
    disponibleDesde: TERMINADO,
  });
}

export async function guardarFactura(
  contexto: ContextoArchivo,
  archivoId: string,
  lectura: LecturaParaGuardar,
): Promise<Exclude<ResultadoArchivo, "error">> {
  const { numero, clienteDocumento, clienteDv } = lectura.factura;
  const factura = referenciaFactura(contexto.hash);
  const indice = numero ? db().collection(COLECCIONES.indicesNumero).doc(numero) : null;
  // Solo se consulta (y se crea) un cliente cuyo documento pasa el dígito de verificación.
  const cliente =
    clienteDocumento && dvValido(clienteDocumento, clienteDv)
      ? db().collection(COLECCIONES.clientes).doc(clienteDocumento)
      : null;
  const archivo = coleccionArchivos(contexto.procesoId).doc(archivoId);

  return db().runTransaction(async (tx) => {
    // Regla de Firestore: TODAS las lecturas van antes de la primera escritura.
    const [facturaLeida, indiceLeido, clienteLeido] = await Promise.all([
      tx.get(factura),
      indice ? tx.get(indice) : null,
      cliente ? tx.get(cliente) : null,
    ]);

    const plan = decidirGuardado(contexto, lectura, {
      facturaExiste: facturaLeida.exists,
      hashDelNumero: (indiceLeido?.data() as IndiceNumero | undefined)?.hashArchivo ?? null,
      clienteExiste: clienteLeido?.exists ?? false,
    });

    if (plan.resultado === "duplicada") {
      tx.update(archivo, { estado: "ok", resultado: "duplicada", hashArchivo: contexto.hash, error: null, disponibleDesde: TERMINADO });
      return "duplicada";
    }

    tx.create(factura, plan.factura);
    if (plan.crearIndice && indice) tx.create(indice, { hashArchivo: contexto.hash } satisfies IndiceNumero);
    if (plan.clienteNuevo && cliente) tx.create(cliente, plan.clienteNuevo);
    tx.update(archivo, {
      estado: "ok",
      resultado: plan.resultado,
      clienteNuevo: plan.clienteNuevo !== null,
      clienteExistente: plan.clienteExistente,
      hashArchivo: contexto.hash,
      error: null,
      disponibleDesde: TERMINADO,
    });
    return plan.resultado;
  });
}

/**
 * Se agotaron los intentos de una imagen. No se pierde: si se llegó a calcular su
 * hash, queda una factura en revisión con el motivo; el archivo se cierra con error.
 * (Sin hash —la imagen ni siquiera se pudo descargar— no hay ID con el que
 * guardar una factura: queda solo el error en la cola.)
 */
export async function guardarFallo(
  contexto: Omit<ContextoArchivo, "hash"> & { hash: string | null },
  archivoId: string,
  mensaje: string,
): Promise<void> {
  const archivo = coleccionArchivos(contexto.procesoId).doc(archivoId);
  const cierre = { estado: "error", resultado: "error", hashArchivo: contexto.hash, error: mensaje, disponibleDesde: TERMINADO };
  if (contexto.hash === null) {
    await archivo.update(cierre);
    return;
  }
  const factura = referenciaFactura(contexto.hash);
  await db().runTransaction(async (tx) => {
    const existente = await tx.get(factura);
    if (!existente.exists) {
      const vacia: Factura = {
        numero: null,
        fecha: null,
        proveedor: null,
        nitProveedor: null,
        clienteDocumento: null,
        clienteNombre: null,
        subtotal: null,
        iva: null,
        impoconsumo: null,
        total: null,
        estado: "revision",
        motivos: [`No se pudo procesar la imagen: ${mensaje}`],
        archivo: contexto.archivo,
        rutaAlmacen: contexto.rutaAlmacen,
        confianzaOcr: null,
        procesoId: contexto.procesoId,
        uid: contexto.uid,
        creadoEn: contexto.ahora,
        items: [],
      };
      tx.create(factura, vacia);
    }
    tx.update(archivo, cierre);
  });
}
