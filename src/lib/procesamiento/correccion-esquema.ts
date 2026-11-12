/*
 * Formato de una corrección manual (Fase 9): lo que el formulario envía en
 * PUT /api/facturas/[hash]. Lo usan el servidor (que no confía en el navegador)
 * y el navegador (para avisar en vivo con los mismos mensajes). Sin nada de servidor.
 *
 * Aquí solo se mira el FORMATO (que cada campo exista y esté bien escrito). Si
 * los números cuadran entre sí lo deciden las reglas del OCR (validar).
 */
import { z } from "zod";

const MAXIMO_PESOS = 1e13;

/** Pesos COP: enteros, nunca decimales ni negativos. */
function pesos(campo: string) {
  return z
    .number({ error: `${campo}: escribe un número` })
    .int({ error: `${campo} debe ser un número entero de pesos, sin decimales` })
    .min(0, { error: `${campo} no puede ser negativo` })
    .max(MAXIMO_PESOS, { error: `${campo} es demasiado grande` });
}

/** NIT o cédula sin puntos, guion ni dígito de verificación. */
function documento(campo: string) {
  return z.string().trim().regex(/^\d{5,15}$/, { error: `${campo}: solo dígitos, sin puntos, guion ni dígito de verificación` });
}

const digitoVerificacion = z.number({ error: "El dígito de verificación debe ser un número" }).int().min(0).max(9).nullable();

function texto(falta: string, maximo = 200) {
  return z.string().trim().min(1, { error: falta }).max(maximo, { error: `${falta.replace(/^Falta /, "")}: demasiado largo` });
}

/** ¿Existe ese día? «2026-02-30» tiene buen formato pero no existe. */
function fechaReal(iso: string): boolean {
  const [anio, mes, dia] = iso.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

const esquemaItem = z.strictObject({
  descripcion: texto("falta la descripción"),
  cantidad: z
    .number({ error: "la cantidad debe ser un número" })
    .int({ error: "la cantidad debe ser un número entero" })
    .min(1, { error: "la cantidad debe ser mayor que cero" })
    .max(1_000_000, { error: "la cantidad es demasiado grande" }),
  precioUnitario: pesos("el precio unitario"),
});

export const esquemaCorreccion = z.strictObject({
  // En mayúsculas: «fe-000833» y «FE-000833» son el mismo número (y el mismo índice).
  numero: texto("Falta el número de factura", 30)
    .regex(/^[A-Za-z0-9-]*$/, { error: "El número de factura solo admite letras, dígitos y guiones" })
    .toUpperCase(),
  fecha: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "La fecha debe escribirse aaaa-mm-dd" })
    .refine(fechaReal, { error: "Esa fecha no existe" }),
  proveedor: texto("Falta la razón social del proveedor"),
  nitProveedor: documento("El NIT del proveedor"),
  dvProveedor: digitoVerificacion,
  clienteDocumento: documento("El documento del cliente"),
  clienteDv: digitoVerificacion,
  clienteNombre: texto("Falta el nombre del cliente"),
  items: z.array(esquemaItem).min(1, { error: "Debe haber al menos un ítem" }).max(100, { error: "Como máximo 100 ítems" }),
  subtotal: pesos("El subtotal"),
  iva: pesos("El IVA"),
  /** null = la factura no trae impoconsumo. */
  impoconsumo: pesos("El impoconsumo").nullable(),
  total: pesos("El total"),
  /** «Revisé la imagen y estos datos son los de la factura»: guarda aunque haya motivos. */
  confirmado: z.boolean(),
});

export type EntradaCorreccion = z.infer<typeof esquemaCorreccion>;

/** Mensajes de formato, listos para mostrar; vacío si el formato es correcto. */
export function erroresDeFormato(cuerpo: unknown): string[] {
  const resultado = esquemaCorreccion.safeParse(cuerpo);
  if (resultado.success) return [];
  return resultado.error.issues.map((problema) => {
    const [campo, posicion] = problema.path;
    // Los errores de un ítem dicen cuál es («Ítem 2: …»), contando desde 1.
    if (campo === "items" && typeof posicion === "number") return `Ítem ${posicion + 1}: ${problema.message}`;
    return problema.message;
  });
}
