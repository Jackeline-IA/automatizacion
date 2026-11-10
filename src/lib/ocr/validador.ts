/*
 * Reglas de negocio que decide si una factura se acepta sola o va a revisión.
 *
 * Función pura: recibe lo extraído y devuelve la lista de motivos de revisión.
 * Lista vacía = aceptable. «Aceptada» significa que pasó todas estas reglas, no
 * que sea correcta: un error que cuadre aritméticamente (un dígito mal leído en
 * el número de factura, por ejemplo) no se puede detectar aquí.
 *
 * La usa el servidor y, desde la Fase 9, también el navegador: no debe importar
 * nada que solo exista en el servidor.
 */
import { MINIMO_LETRAS_RAZON_SOCIAL, TARIFA_IMPOCONSUMO, TARIFA_IVA, TOLERANCIA_PESOS } from "./constantes";
import { dvValido } from "./nit";
import type { ParcialFactura } from "./tipos";

function cerca(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCIA_PESOS;
}

export function validar(f: ParcialFactura): string[] {
  const motivos: string[] = [];

  // --- Campos obligatorios ---
  if (!f.numero) motivos.push("No se pudo leer el número de factura");
  if (!f.fecha) motivos.push("No se pudo leer la fecha de emisión");
  if (!f.proveedor) motivos.push("No se pudo leer la razón social del proveedor");
  if (!f.nitProveedor) motivos.push("No se pudo leer el NIT del proveedor");
  if (!f.clienteDocumento) motivos.push("No se pudo leer el documento del cliente");
  if (f.subtotal === null) motivos.push("No se pudo leer el subtotal");
  if (f.iva === null) motivos.push("No se pudo leer el IVA");
  if (f.total === null) motivos.push("No se pudo leer el total");
  if (f.items.length === 0) motivos.push("No se pudo leer ningún ítem");

  // --- Proveedor y cliente ---
  if (f.proveedor && (f.proveedor.match(/\p{L}/gu) ?? []).length < MINIMO_LETRAS_RAZON_SOCIAL) {
    motivos.push("La razón social del proveedor no es legible");
  }
  if (f.nitProveedor && !dvValido(f.nitProveedor, f.dvProveedor)) {
    motivos.push("El dígito de verificación del NIT del proveedor no es válido");
  }
  // El cliente se identifica por documento, nunca por nombre: si el DV no pasa,
  // la factura va a revisión y no se crea ningún cliente.
  if (f.clienteDocumento && !dvValido(f.clienteDocumento, f.clienteDv)) {
    motivos.push("El dígito de verificación del documento del cliente no es válido");
  }

  // --- Ítems ---
  f.items.forEach((item, i) => {
    if (item.cantidad === null || item.precioUnitario === null || item.subtotal === null) {
      motivos.push(`Ítem ${i + 1}: no se pudo leer completo`);
    } else if (item.cantidad * item.precioUnitario !== item.subtotal) {
      motivos.push(`Ítem ${i + 1}: cantidad × precio no da el subtotal`);
    }
  });
  if (f.subtotal !== null && f.items.length > 0) {
    const suma = f.items.reduce((total, item) => total + (item.subtotal ?? 0), 0);
    if (suma !== f.subtotal) motivos.push("Los ítems no suman el subtotal");
  }

  // --- Impuestos y total ---
  if (f.subtotal !== null && f.iva !== null && !cerca(f.iva, f.subtotal * TARIFA_IVA)) {
    motivos.push("El IVA no es el 19 % del subtotal");
  }
  if (f.subtotal !== null && f.impoconsumo !== null && !cerca(f.impoconsumo, f.subtotal * TARIFA_IMPOCONSUMO)) {
    motivos.push("El impoconsumo no es el 4 % del subtotal");
  }
  if (f.subtotal !== null && f.iva !== null && f.total !== null) {
    const sinImpoconsumo = f.subtotal + f.iva;
    if (f.mencionaImpoconsumo && f.impoconsumo === null && sinImpoconsumo !== f.total) {
      motivos.push("La factura menciona impoconsumo pero no se pudo leer su valor");
    } else if (sinImpoconsumo + (f.impoconsumo ?? 0) !== f.total) {
      motivos.push("El total no es subtotal + IVA + impoconsumo");
    }
  }

  return motivos;
}
