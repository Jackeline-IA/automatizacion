/*
 * Modelo de datos de Firestore.
 *
 * Firestore es de documentos, no relacional: no existe UNIQUE. La unicidad se
 * consigue usando el valor único como ID del documento y creándolo dentro de una
 * transacción. Por eso cada colección documenta aquí cuál es su ID.
 *
 * Convenciones: colecciones en snake_case plural, campos en camelCase, importes
 * en pesos COP como enteros (nunca decimales) y marcas de tiempo en milisegundos
 * de época (number), que se comparan y se envían al navegador sin conversiones.
 */

/** Nombres de las colecciones, en un solo sitio para no escribirlos a mano. */
export const COLECCIONES = {
  clientes: "clientes",
  facturas: "facturas",
  indicesNumero: "indices_numero",
  procesos: "procesos",
  /** Subcolección de cada proceso: procesos/{id}/archivos. */
  archivos: "archivos",
} as const;

/**
 * clientes/{documento}
 * ID = el documento (NIT o CC sin puntos, guion ni dígito de verificación):
 * no pueden existir dos clientes iguales. Un cliente se identifica por su
 * documento, nunca por su nombre, porque el OCR altera los nombres.
 */
export interface Cliente {
  documento: string;
  /** Dígito de verificación; null en una cédula que no lo trae. */
  dv: number | null;
  nombre: string;
  creadoEn: number;
  /** Lote que lo creó: permite a una prueba borrar solo los clientes que ella creó. */
  primerProcesoId: string;
}

export type EstadoFactura = "aceptada" | "revision";

/**
 * Un renglón de la factura. Va embebido: siempre se lee junto con ella y son pocos.
 * Las cifras son null cuando el OCR no las pudo leer (la factura queda en
 * revisión): no se inventa un valor para rellenarlas.
 */
export interface ItemFactura {
  descripcion: string;
  cantidad: number | null;
  precioUnitario: number | null;
  subtotal: number | null;
}

/**
 * facturas/{hash}
 * ID = SHA-256 de la imagen: existe siempre (aunque el OCR falle) y hace
 * imposible guardar dos veces el mismo archivo.
 * Los campos leídos son null cuando no se pudieron leer: nunca se inventa un valor.
 */
export interface Factura {
  numero: string | null;
  /** Fecha de emisión, yyyy-mm-dd. */
  fecha: string | null;
  proveedor: string | null;
  nitProveedor: string | null;
  /** null si el documento no pasó el dígito de verificación (no se crea cliente). */
  clienteDocumento: string | null;
  clienteNombre: string | null;
  subtotal: number | null;
  iva: number | null;
  impoconsumo: number | null;
  total: number | null;
  estado: EstadoFactura;
  /** Motivos de revisión; vacío si la factura fue aceptada. */
  motivos: string[];
  /** Nombre original del archivo que subió el usuario. */
  archivo: string;
  /** Ruta de la imagen dentro del bucket privado de Supabase Storage. */
  rutaAlmacen: string;
  confianzaOcr: number | null;
  procesoId: string;
  /** Dueño de la factura: un usuario solo ve lo suyo. */
  uid: string;
  creadoEn: number;
  items: ItemFactura[];

  // --- Desde la Fase 9 (ausentes en facturas guardadas antes: se tratan como null) ---
  /** Dígito de verificación leído del NIT del proveedor. */
  dvProveedor?: number | null;
  /** Dígito de verificación leído del documento del cliente. */
  clienteDv?: number | null;
  /** El documento del cliente TAL COMO SE LEYÓ, aunque no haya pasado el DV (para precargar la revisión). */
  clienteDocumentoLeido?: string | null;
  /** La ingresó o corrigió una persona (revisión manual). */
  corregidaManualmente?: boolean;
  /** Correo de quien la corrigió por última vez. */
  corregidaPor?: string;
  corregidaEn?: number;
  /** Qué motivos de revisión había dado la máquina antes de la primera corrección. */
  motivosOriginales?: string[];
  /** Validaciones que no cuadraban y la persona confirmó de todos modos. */
  validacionesIgnoradas?: string[];
}

/**
 * indices_numero/{numero}
 * ID = el número de factura (FE-000123). Hace único el número; se crea en la
 * misma transacción que la factura.
 */
export interface IndiceNumero {
  hashArchivo: string;
}

export type EstadoProceso = "subiendo" | "ejecutando" | "terminado";

/** Cuántas facturas y cuánto suman (pesos COP, enteros). */
export interface Importes {
  n: number;
  subtotal: number;
  iva: number;
  impoconsumo: number;
  total: number;
}

/**
 * Contadores de un lote. Se actualizan con incrementos DENTRO de la transacción
 * que guarda cada factura: siempre cuadran con los datos y mostrarlos cuesta una
 * lectura (la del lote), no recorrer sus facturas.
 */
export interface MetricasProceso {
  /** Pasaron todas las validaciones. */
  aceptadas: Importes;
  /** Quedaron en revisión (lo que el OCR no leyó suma 0). */
  revision: Importes;
  /** Ingresadas o corregidas a mano (Fase 9). */
  manuales: Importes;
  /** Imágenes que no se pudieron procesar tras agotar los intentos. */
  errores: number;
  /** Imágenes que ya estaban guardadas (no cuentan en los porcentajes). */
  duplicadas: number;
  clientesNuevos: number;
  /** Por NIT del proveedor; solo facturas aceptadas (en revisión el NIT puede estar mal leído). */
  proveedores: Record<string, Importes & { nombre: string }>;
}

/**
 * procesos/{id automático}
 * Un lote: una subida con su cola de trabajo, su Excel y sus métricas.
 */
export interface Proceso {
  uid: string;
  carpeta: string;
  estado: EstadoProceso;
  totalArchivos: number;
  inicio: number;
  fin: number | null;
  /** Ruta del Excel en el bucket; null hasta que el lote termina. */
  rutaExcel: string | null;
  /** Bloqueo temporal para que un solo cliente genere el Excel; null si nadie lo tiene. */
  finalizandoDesde: number | null;
  /** Ausente en lotes creados antes de la Fase 8: se tratan como ceros. */
  metricas?: MetricasProceso;
}

export type EstadoArchivo = "pendiente" | "procesando" | "ok" | "error";
export type ResultadoArchivo = "aceptada" | "revision" | "duplicada" | "error";

/** Valor de `disponibleDesde` de un archivo terminado: nunca vuelve a la cola. */
export const TERMINADO = Number.MAX_SAFE_INTEGER;

/**
 * procesos/{id}/archivos/{nombre del archivo en el bucket}
 * La cola de trabajo: un documento por imagen. El ID sale del nombre del archivo,
 * así que crear la cola dos veces no duplica nada.
 */
export interface ArchivoCola {
  rutaAlmacen: string;
  nombre: string;
  estado: EstadoArchivo;
  resultado: ResultadoArchivo | null;
  clienteNuevo: boolean;
  clienteExistente: boolean;
  hashArchivo: string | null;
  intentos: number;
  error: string | null;
  /**
   * Arrendamiento, en milisegundos de época: 0 mientras espera; ahora + 5 min
   * mientras alguien lo procesa (caduca solo si la función se cae); TERMINADO
   * al acabar. Así la cola se consulta con un solo campo
   * (disponibleDesde <= ahora) y no hace falta un índice compuesto.
   */
  disponibleDesde: number;
}
