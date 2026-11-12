/*
 * Revisión manual (Fase 9) en Firestore: SOLO servidor.
 *
 * La corrección ocurre en UNA transacción (todas las lecturas antes de las
 * escrituras): factura, índice del número, cliente y contadores del lote quedan
 * siempre consistentes entre sí, aunque la función se caiga a mitad.
 */
import { db } from "@/lib/firebase/admin";
import { COLECCIONES, type Cliente, type Factura, type IndiceNumero } from "@/lib/modelo/tipos";
import { dvValido } from "@/lib/ocr/nit";
import type { Usuario } from "@/lib/auth/sesion";
import { aParcial, cambiosCorreccion, precargaDesdeFactura, type ImportesCorreccion, type Precarga } from "./correccion";
import type { EntradaCorreccion } from "./correccion-esquema";
import { aplicarCambiosMetricas } from "./metricas-firestore";
import { referenciaProceso } from "./proceso";

/** Como mucho tantas pendientes por consulta: cada una cuesta una lectura. */
const MAXIMO_PENDIENTES = 200;

const facturas = () => db().collection(COLECCIONES.facturas);

/** Una fila de la lista de pendientes (sin rutas del almacén ni uid). */
export interface PendienteRevision {
  hash: string;
  archivo: string;
  procesoId: string;
  numero: string | null;
  proveedor: string | null;
  total: number | null;
  motivos: string[];
  creadoEn: number;
}

/**
 * Las facturas del usuario que esperan a una persona. Solo filtros de igualdad
 * (uid y estado): Firestore los resuelve sin índice compuesto. El orden se hace
 * aquí, en memoria (ordenar en la consulta sí pediría un índice compuesto).
 */
export async function pendientesDeRevision(uid: string): Promise<{ pendientes: PendienteRevision[]; hayMas: boolean }> {
  const consulta = await facturas().where("uid", "==", uid).where("estado", "==", "revision").limit(MAXIMO_PENDIENTES + 1).get();
  const pendientes = consulta.docs
    .slice(0, MAXIMO_PENDIENTES)
    .map((documento) => {
      const f = documento.data() as Factura;
      return {
        hash: documento.id,
        archivo: f.archivo,
        procesoId: f.procesoId,
        numero: f.numero,
        proveedor: f.proveedor,
        total: f.total,
        motivos: f.motivos,
        creadoEn: f.creadoEn,
      };
    })
    .sort((a, b) => a.creadoEn - b.creadoEn || a.archivo.localeCompare(b.archivo));
  return { pendientes, hayMas: consulta.size > MAXIMO_PENDIENTES };
}

/** Lo que necesita el formulario de una factura. */
export interface DetalleRevision {
  hash: string;
  archivo: string;
  procesoId: string;
  estado: Factura["estado"];
  /** Motivos actuales (vacío si ya se corrigió). */
  motivos: string[];
  /** Lo que dijo la máquina antes de la primera corrección. */
  motivosOriginales: string[];
  corregidaManualmente: boolean;
  corregidaPor: string | null;
  corregidaEn: number | null;
  validacionesIgnoradas: string[];
  confianzaOcr: number | null;
  /** ¿Se puede editar? No, si la aceptó la máquina sin intervención humana. */
  editable: boolean;
  precarga: Precarga;
}

/** La factura, si existe y es del usuario; si no, null (mismo 404 en los dos casos). */
export async function detalleRevision(hash: string, uid: string): Promise<DetalleRevision | null> {
  const f = (await facturas().doc(hash).get()).data() as Factura | undefined;
  if (!f || f.uid !== uid) return null;
  const corregida = f.corregidaManualmente === true;
  return {
    hash,
    archivo: f.archivo,
    procesoId: f.procesoId,
    estado: f.estado,
    motivos: f.motivos,
    motivosOriginales: f.motivosOriginales ?? (corregida ? [] : f.motivos),
    corregidaManualmente: corregida,
    corregidaPor: f.corregidaPor ?? null,
    corregidaEn: f.corregidaEn ?? null,
    validacionesIgnoradas: f.validacionesIgnoradas ?? [],
    confianzaOcr: f.confianzaOcr,
    editable: f.estado === "revision" || corregida,
    precarga: precargaDesdeFactura(f),
  };
}

export type ResultadoCorreccion =
  | { ok: true; reedicion: boolean; clienteNuevo: boolean }
  | { ok: false; status: 404 | 409; error: string };

function importesDe(f: Pick<Factura, "subtotal" | "iva" | "impoconsumo" | "total" | "nitProveedor" | "proveedor">): ImportesCorreccion {
  return {
    subtotal: f.subtotal ?? 0,
    iva: f.iva ?? 0,
    impoconsumo: f.impoconsumo,
    total: f.total ?? 0,
    nitProveedor: f.nitProveedor ?? "",
    proveedor: f.proveedor ?? "",
  };
}

/**
 * Guarda la corrección de una persona. `motivos` son los que siguen sin cuadrar
 * (la ruta ya comprobó que, si hay, la persona los confirmó).
 */
export async function corregirFactura(
  hash: string,
  usuario: Usuario,
  entrada: EntradaCorreccion,
  motivos: string[],
): Promise<ResultadoCorreccion> {
  const referenciaFactura = facturas().doc(hash);
  const parcial = aParcial(entrada);
  const documentoFiable = dvValido(entrada.clienteDocumento, entrada.clienteDv);

  return db().runTransaction(async (tx): Promise<ResultadoCorreccion> => {
    // --- Lecturas (todas antes de la primera escritura) ---
    const actual = (await tx.get(referenciaFactura)).data() as Factura | undefined;
    if (!actual || actual.uid !== usuario.uid) return { ok: false, status: 404, error: "La factura no existe" };
    const reedicion = actual.corregidaManualmente === true;
    if (actual.estado === "aceptada" && !reedicion) {
      return { ok: false, status: 409, error: "Esta factura la aceptó la máquina: no está en revisión" };
    }

    const indices = db().collection(COLECCIONES.indicesNumero);
    const referenciaIndice = indices.doc(entrada.numero);
    const numeroAnterior = actual.numero !== null && actual.numero !== entrada.numero ? actual.numero : null;
    const referenciaIndiceAnterior = numeroAnterior ? indices.doc(numeroAnterior) : null;
    const referenciaCliente = documentoFiable ? db().collection(COLECCIONES.clientes).doc(entrada.clienteDocumento) : null;
    const referenciaLote = referenciaProceso(actual.procesoId);

    const [indice, indiceAnterior, cliente, lote] = await Promise.all([
      tx.get(referenciaIndice),
      referenciaIndiceAnterior ? tx.get(referenciaIndiceAnterior) : null,
      referenciaCliente ? tx.get(referenciaCliente) : null,
      tx.get(referenciaLote),
    ]);

    const duenoDelNumero = (indice.data() as IndiceNumero | undefined)?.hashArchivo;
    if (duenoDelNumero !== undefined && duenoDelNumero !== hash) {
      return { ok: false, status: 409, error: `El número ${entrada.numero} ya existe en otra factura` };
    }

    // --- Escrituras ---
    const ahora = Date.now();
    const cambios: Partial<Factura> = {
      numero: entrada.numero,
      fecha: entrada.fecha,
      proveedor: entrada.proveedor,
      nitProveedor: entrada.nitProveedor,
      dvProveedor: entrada.dvProveedor,
      // Mismo criterio que la máquina: sin DV válido no hay documento fiable ni cliente.
      clienteDocumento: documentoFiable ? entrada.clienteDocumento : null,
      clienteDocumentoLeido: entrada.clienteDocumento,
      clienteDv: entrada.clienteDv,
      clienteNombre: entrada.clienteNombre,
      items: parcial.items,
      subtotal: entrada.subtotal,
      iva: entrada.iva,
      impoconsumo: entrada.impoconsumo,
      total: entrada.total,
      estado: "aceptada",
      motivos: [],
      corregidaManualmente: true,
      corregidaPor: usuario.email,
      corregidaEn: ahora,
      // Lo que dijo la máquina se guarda una vez y no se pisa en las reediciones.
      motivosOriginales: reedicion ? (actual.motivosOriginales ?? []) : actual.motivos,
      validacionesIgnoradas: motivos,
    };
    tx.update(referenciaFactura, cambios);

    if (!indice.exists) tx.create(referenciaIndice, { hashArchivo: hash } satisfies IndiceNumero);
    // El número anterior se libera solo si era de esta factura.
    if (referenciaIndiceAnterior && (indiceAnterior?.data() as IndiceNumero | undefined)?.hashArchivo === hash) {
      tx.delete(referenciaIndiceAnterior);
    }

    // El cliente se crea solo si no existe; nunca se sobrescribe su nombre.
    const clienteNuevo = referenciaCliente !== null && cliente !== null && !cliente.exists;
    if (clienteNuevo && referenciaCliente) {
      tx.create(referenciaCliente, {
        documento: entrada.clienteDocumento,
        dv: entrada.clienteDv,
        nombre: entrada.clienteNombre,
        creadoEn: ahora,
        primerProcesoId: actual.procesoId,
      } satisfies Cliente);
    }

    // Contadores del lote (si el lote ya no existe, no hay contadores que mover).
    if (lote.exists) {
      const nueva = importesDe(entrada);
      aplicarCambiosMetricas(tx, actual.procesoId, cambiosCorreccion(reedicion ? importesDe(actual) : null, nueva, clienteNuevo));
    }

    return { ok: true, reedicion, clienteNuevo };
  });
}
