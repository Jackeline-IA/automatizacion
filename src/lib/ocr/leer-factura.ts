/*
 * De una imagen a una factura leída: OCR → extraer → validar, con reintentos.
 *
 * Estrategia (cada paso solo se da si el anterior dejó motivos de revisión):
 *   1. leer la imagen original;
 *   2. leerla preprocesada y quedarse con el resultado que tenga MENOS motivos;
 *   3. leer el encabezado invertido y anteponer su texto al mejor texto.
 * Lo que siga con motivos queda en revisión: no se descarta ni se inventa nada.
 */
import { extraer } from "./extractor";
import { leerImagen, type LecturaOcr, type ModoLectura } from "./motor";
import type { ParcialFactura } from "./tipos";
import { validar } from "./validador";

export type { ModoLectura };

/** Quien hace el OCR. Se recibe como parámetro para poder probar la estrategia sin tesseract. */
export type LectorImagen = (imagen: Buffer, modo: ModoLectura) => Promise<LecturaOcr>;

export interface LecturaFactura {
  factura: ParcialFactura;
  /** Motivos de revisión; vacío = aceptable. */
  motivos: string[];
  /** Texto del OCR del que salió este resultado. */
  texto: string;
  confianza: number;
  /** Última lectura que mejoró el resultado. */
  modo: ModoLectura;
}

function interpretar(texto: string, confianza: number, modo: ModoLectura): LecturaFactura {
  const factura = extraer(texto);
  return { factura, motivos: validar(factura), texto, confianza, modo };
}

export async function leerFactura(imagen: Buffer, leer: LectorImagen = leerImagen): Promise<LecturaFactura> {
  const original = await leer(imagen, "original");
  let mejor = interpretar(original.texto, original.confianza, "original");
  if (mejor.motivos.length === 0) return mejor;

  const preprocesado = await leer(imagen, "preprocesado");
  const segunda = interpretar(preprocesado.texto, preprocesado.confianza, "preprocesado");
  if (segunda.motivos.length < mejor.motivos.length) mejor = segunda;
  if (mejor.motivos.length === 0) return mejor;

  // El encabezado solo trae la parte de arriba (proveedor, NIT, número): por sí
  // solo no es una factura, así que se antepone al mejor texto completo.
  const encabezado = await leer(imagen, "encabezado");
  const tercera = interpretar(`${encabezado.texto}\n${mejor.texto}`, mejor.confianza, "encabezado");
  if (tercera.motivos.length < mejor.motivos.length) mejor = tercera;
  return mejor;
}
