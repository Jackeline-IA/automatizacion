/*
 * Lo que el extractor logra leer de una factura. Todo lo que no se encuentra
 * queda en null: nunca se inventa un valor. Los importes son enteros en pesos.
 */

export interface ItemParcial {
  descripcion: string;
  cantidad: number | null;
  precioUnitario: number | null;
  subtotal: number | null;
}

export interface ParcialFactura {
  numero: string | null;
  /** Fecha de emisión, yyyy-mm-dd. */
  fecha: string | null;
  proveedor: string | null;
  /** Solo dígitos, sin puntos, guion ni dígito de verificación. */
  nitProveedor: string | null;
  dvProveedor: number | null;
  clienteDocumento: string | null;
  clienteDv: number | null;
  clienteNombre: string | null;
  items: ItemParcial[];
  subtotal: number | null;
  iva: number | null;
  /** null si la factura no trae la línea o no se pudo leer. */
  impoconsumo: number | null;
  /** El texto nombra el impoconsumo, se haya podido leer su valor o no. */
  mencionaImpoconsumo: boolean;
  total: number | null;
}
