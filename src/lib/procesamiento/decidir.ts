/*
 * Qué se guarda de una factura leída. Función PURA: recibe lo leído por el OCR y
 * lo que ya existe en la base, y devuelve el plan de escritura. No toca Firestore
 * (eso lo hace guardar.ts, dentro de una transacción), y por eso se prueba sola.
 */
import type { Cliente, Factura } from "../modelo/tipos";
import { dvValido } from "../ocr/nit";
import type { ParcialFactura } from "../ocr/tipos";

/** De qué archivo de qué lote sale la factura. */
export interface ContextoArchivo {
  /** SHA-256 de la imagen: es el ID de la factura. */
  hash: string;
  archivo: string;
  rutaAlmacen: string;
  procesoId: string;
  uid: string;
  ahora: number;
}

/** Lo que la transacción leyó antes de decidir. */
export interface EstadoLeido {
  /** ¿Ya existe facturas/{hash}? Es decir, ¿esta misma imagen ya se guardó? */
  facturaExiste: boolean;
  /** A qué imagen apunta indices_numero/{numero}; null si ese número no está usado. */
  hashDelNumero: string | null;
  /** ¿Ya existe clientes/{documento}? */
  clienteExiste: boolean;
}

export interface LecturaParaGuardar {
  factura: ParcialFactura;
  motivos: string[];
  confianza: number | null;
}

export type PlanGuardado =
  | { resultado: "duplicada" }
  | {
      resultado: "aceptada" | "revision";
      factura: Factura;
      /** Crear indices_numero/{numero} apuntando a esta imagen. */
      crearIndice: boolean;
      /** El cliente a crear, o null si no hay que crear ninguno. */
      clienteNuevo: Cliente | null;
      /** El cliente ya existía (no se toca: nunca se sobrescribe su nombre). */
      clienteExistente: boolean;
    };

export function decidirGuardado(contexto: ContextoArchivo, lectura: LecturaParaGuardar, leido: EstadoLeido): PlanGuardado {
  // La misma imagen ya está guardada: no se escribe nada más.
  if (leido.facturaExiste) return { resultado: "duplicada" };

  const f = lectura.factura;
  const motivos = [...lectura.motivos];

  // Un número que ya usa OTRA imagen puede ser un número mal leído: la factura
  // no se descarta, va a revisión, y el índice sigue apuntando a la primera.
  const numeroRepetido = f.numero !== null && leido.hashDelNumero !== null && leido.hashDelNumero !== contexto.hash;
  if (numeroRepetido) motivos.push(`El número ${f.numero} ya existe en otra factura`);

  // El cliente se identifica por su documento, nunca por su nombre. Si el
  // documento no pasa el dígito de verificación, no se guarda ni se crea cliente.
  const documentoFiable = f.clienteDocumento !== null && dvValido(f.clienteDocumento, f.clienteDv);

  const estado = motivos.length === 0 ? "aceptada" : "revision";
  const factura: Factura = {
    numero: f.numero,
    fecha: f.fecha,
    proveedor: f.proveedor,
    nitProveedor: f.nitProveedor,
    dvProveedor: f.dvProveedor,
    clienteDocumento: documentoFiable ? f.clienteDocumento : null,
    // Lo leído se conserva aunque no pase el DV: la revisión manual lo precarga.
    clienteDocumentoLeido: f.clienteDocumento,
    clienteDv: f.clienteDv,
    clienteNombre: f.clienteNombre,
    subtotal: f.subtotal,
    iva: f.iva,
    impoconsumo: f.impoconsumo,
    total: f.total,
    estado,
    motivos,
    archivo: contexto.archivo,
    rutaAlmacen: contexto.rutaAlmacen,
    confianzaOcr: lectura.confianza,
    procesoId: contexto.procesoId,
    uid: contexto.uid,
    creadoEn: contexto.ahora,
    items: f.items.map((item) => ({ ...item })),
  };

  const crearCliente = documentoFiable && !leido.clienteExiste;
  return {
    resultado: estado,
    factura,
    crearIndice: f.numero !== null && leido.hashDelNumero === null,
    clienteNuevo: crearCliente
      ? {
          documento: f.clienteDocumento as string,
          dv: f.clienteDv,
          // Vacío si el OCR no leyó el nombre: no se inventa uno.
          nombre: f.clienteNombre ?? "",
          creadoEn: contexto.ahora,
          primerProcesoId: contexto.procesoId,
        }
      : null,
    clienteExistente: documentoFiable && leido.clienteExiste,
  };
}
