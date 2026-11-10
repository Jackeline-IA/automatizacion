/*
 * Del texto desordenado del OCR a los campos de una factura.
 *
 * Función pura (sin OCR, sin base de datos): por eso se prueba con texto de
 * ejemplo. Cada regla salió de mirar textos reales (src/lib/ocr/__fixtures__).
 * Lo que no se encuentra queda en null: nunca se inventa un valor.
 */
import { dvValido } from "./nit";
import type { ItemParcial, ParcialFactura } from "./tipos";

// ---------------------------------------------------------------- utilidades

/** Un importe: «$1.234.567» (punto de miles, sin decimales). Captura solo los dígitos. */
const IMPORTE = /\$\s?(\d{1,3}(?:\.\d{3})+|\d+)/g;
/** «19%», «(19%)», «4 %»: se quitan antes de leer importes para no confundirlos. */
const PORCENTAJE = /\(?\d{1,2}\s?%\)?/g;

function importesDe(linea: string): number[] {
  return [...linea.matchAll(IMPORTE)].map((m) => Number(m[1].replace(/\./g, "")));
}

/**
 * Cantidad y precio pegados, seguidos del subtotal: «119426.500 $4.691.500».
 * Grupo 1: los dígitos corridos (cantidad + inicio del precio); grupo 2: los
 * miles del precio («.500»); grupo 3: el subtotal.
 */
const PEGADOS = /(?<![\p{L}\p{N}.$])(\d{2,7})((?:\.\d{3})+) \$(\d{1,3}(?:\.\d{3})+)(?!\d)/gu;

/**
 * Reparte los dígitos corridos entre cantidad y precio. Solo lo hace si
 * cantidad × precio = subtotal; si ninguna partición cuadra, deja el texto igual
 * (repartir «a ojo» sería inventar un valor).
 */
function separarPegados(todo: string, corridos: string, miles: string, subtotal: string): string {
  const valorSubtotal = Number(subtotal.replace(/\./g, ""));
  for (let corte = 1; corte < corridos.length; corte += 1) {
    // Entre la cantidad y el precio puede sobrar un carácter: el «$» leído como dígito.
    for (const sobra of [0, 1]) {
      const inicioPrecio = corridos.slice(corte + sobra);
      if (inicioPrecio.length < 1 || inicioPrecio.length > 3 || inicioPrecio.startsWith("0")) continue;
      const cantidad = Number(corridos.slice(0, corte));
      const precio = Number(inicioPrecio + miles.replace(/\./g, ""));
      if (cantidad >= 1 && cantidad * precio === valorSubtotal) {
        return `${cantidad} $${inicioPrecio}${miles} $${subtotal}`;
      }
    }
  }
  return todo;
}

/**
 * Limpia el texto antes de interpretarlo y lo devuelve como líneas no vacías.
 * Corrige errores típicos del OCR en los importes.
 */
export function normalizar(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((linea) =>
      linea
        .replace(/\$(\d{1,3}) \.(\d{3})/g, "$$$1.$2") // «$496 .000» → «$496.000»
        .replace(/(\d)\$(?=\d)/g, "$1 $$") // «3$146.500» → «3 $146.500»
        .replace(/(?<![\p{L}\p{N}$])S(?=\d{1,3}(?:\.\d{3})+(?!\d))/gu, "$$") // «S146.500»: la S es un $ mal leído
        .replace(PEGADOS, separarPegados) // «119426.500 $4.691.500» → «11 $426.500 $4.691.500»
        .replace(/(?<![\p{L}\p{N}])5\.A\.S\./gu, "S.A.S.") // «5.A.S.»: la S se leyó como 5
        .replace(/^[\s—–\-_=.·;:,|+*~'"]+/, "") // rayas y adornos al inicio de la línea
        .trim(),
    )
    .filter((linea) => linea.length > 0);
}

// --------------------------------------------------------------------- fecha

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

// dd/mm/yyyy · yyyy-mm-dd · «12 de marzo de 2026»
const FECHA = /(\d{1,2})\/(\d{1,2})\/(\d{4})|(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\s+de\s+(\p{L}+)\s+de\s+(\d{4})/giu;
/** Fechas que NO son la de emisión. */
const NO_ES_EMISION = /venc|l[ií]mite|resoluci[oó]n|\bres\.|autorizaci[oó]n|rango/i;
const ES_EMISION = /emisi[oó]n|expedici[oó]n|fecha/i;

/** yyyy-mm-dd si es una fecha real (el 31 de febrero no lo es); si no, null. */
function aIso(anio: number, mes: number, dia: number): string | null {
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  const real = fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
  if (!real) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Una factura trae varias fechas (emisión, vencimiento, resolución DIAN). Se
 * decide por el texto que precede a cada una: gana la que va tras «Emisión»,
 * «expedición» o «Fecha»; se descartan las que van tras vencimiento, límite,
 * resolución, autorización o rango.
 */
function extraerFecha(lineas: string[]): { fecha: string | null; linea: number } {
  let reserva: { fecha: string; linea: number } | null = null;
  for (let i = 0; i < lineas.length; i += 1) {
    let finAnterior = 0;
    for (const m of lineas[i].matchAll(FECHA)) {
      const antes = lineas[i].slice(finAnterior, m.index);
      finAnterior = m.index + m[0].length;

      let iso: string | null;
      if (m[1]) iso = aIso(Number(m[3]), Number(m[2]), Number(m[1]));
      else if (m[4]) iso = aIso(Number(m[4]), Number(m[5]), Number(m[6]));
      else iso = MESES[m[8].toLowerCase()] ? aIso(Number(m[9]), MESES[m[8].toLowerCase()], Number(m[7])) : null;
      if (!iso) continue;

      if (NO_ES_EMISION.test(antes)) continue;
      // En el ticket, la fecha de la resolución va sola en la línea siguiente a «Res. DIAN …».
      if (antes.trim() === "" && i > 0 && NO_ES_EMISION.test(lineas[i - 1])) continue;
      if (ES_EMISION.test(antes)) return { fecha: iso, linea: i };
      reserva ??= { fecha: iso, linea: i };
    }
  }
  return reserva ?? { fecha: null, linea: -1 };
}

// -------------------------------------------------------------------- número

const NUMERO_FACTURA = /(?<![\p{L}\p{N}])([A-Z]{1,4}-\d{6})(?!\d)/u;

/** «FE-000123», ignorando el rango de numeración («del FE-000001 al FE-005000»). */
function extraerNumero(lineas: string[]): string | null {
  for (const linea of lineas) {
    if (/rango|resoluci[oó]n|autorizaci[oó]n/i.test(linea)) continue;
    const m = linea.match(NUMERO_FACTURA);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------- documentos

/** NIT o cédula con dígito de verificación: «900.123.456-7» o «900123456-7». */
const DOCUMENTO = /(?<![\d.])(\d{1,3}(?:\.\d{3}){2,3}|\d{8,10})\s?-\s?(\d)(?!\d)/g;
/**
 * El OCR perdió el guion: «8697452623». De 9 a 11 dígitos seguidos (documento +
 * DV), sin letras, puntos ni guiones pegados. Como también lo cumple un teléfono,
 * solo se acepta si el último dígito ES el DV del resto.
 */
const DOCUMENTO_SIN_GUION = /(?<![\p{L}\d.$-])(\d{9,11})(?![\p{L}\d.-])/gu;
/** Etiquetas que anuncian al cliente. Con límites de palabra: «Monitor» contiene «nit». */
const ETIQUETA_CLIENTE = /(?<!\p{L})(cliente|adquirente|se[ñn]ores|documento)(?!\p{L})|nit\s*\/\s*cc/iu;

interface Documento {
  linea: number;
  numero: string;
  dv: number;
}

function extraerDocumentos(lineas: string[], hasta: number): { proveedor: Documento | null; cliente: Documento | null } {
  const encontrados: Documento[] = [];
  for (let i = 0; i < hasta; i += 1) {
    // Se guarda la posición para respetar el orden en que aparecen en la línea.
    const enLinea: { desde: number; hasta: number; doc: Documento }[] = [];
    for (const m of lineas[i].matchAll(DOCUMENTO)) {
      const doc = { linea: i, numero: m[1].replace(/\./g, ""), dv: Number(m[2]) };
      enLinea.push({ desde: m.index, hasta: m.index + m[0].length, doc });
    }
    for (const m of lineas[i].matchAll(DOCUMENTO_SIN_GUION)) {
      const dentroDeOtro = enLinea.some((e) => m.index < e.hasta && m.index + m[0].length > e.desde);
      const numero = m[1].slice(0, -1);
      const dv = Number(m[1].slice(-1));
      if (dentroDeOtro || !dvValido(numero, dv)) continue;
      enLinea.push({ desde: m.index, hasta: m.index + m[0].length, doc: { linea: i, numero, dv } });
    }
    enLinea.sort((a, b) => a.desde - b.desde);
    encontrados.push(...enLinea.map((e) => e.doc));
  }
  // El del cliente es el que tiene una etiqueta de cliente en su línea o en las
  // dos anteriores (el nombre del cliente puede ocupar dos líneas).
  const cliente =
    encontrados.find((d) =>
      [d.linea, d.linea - 1, d.linea - 2].some((i) => i >= 0 && ETIQUETA_CLIENTE.test(lineas[i])),
    ) ?? null;
  // El del proveedor es el primero del texto, siempre que no sea el del cliente:
  // si el OCR no leyó el NIT del proveedor, no se le asigna el del cliente.
  const primero = encontrados[0] ?? null;
  return { proveedor: primero !== cliente ? primero : null, cliente };
}

// ------------------------------------------------------------- razón social

const TITULO = /FACTURA(\s+(ELECTR[OÓ]NICA|DE|VENTA))*/gi;
/** Sufijos societarios; el más largo primero para que «S.A.S.» no se corte en «S.A.». */
const HASTA_SUFIJO = /^(.*?(?<!\p{L})(?:S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?|LTDA\.?|E\.\s?U\.?))(?=\s|$)/iu;
const SOLO_SUFIJO = /^(?:S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?|LTDA\.?|E\.\s?U\.?)$/i;

function limpiarRazonSocial(linea: string): string {
  const sinTitulo = linea.replace(TITULO, " ").replace(/\s+/g, " ").trim();
  return sinTitulo.match(HASTA_SUFIJO)?.[1].trim() ?? sinTitulo;
}

/** La razón social es la línea anterior a la del NIT del proveedor. */
function extraerProveedor(lineas: string[], lineaNit: number): string | null {
  if (lineaNit < 1) return null;
  let nombre = limpiarRazonSocial(lineas[lineaNit - 1]);
  // Si solo quedó el sufijo, la razón social estaba partida en dos líneas.
  if (SOLO_SUFIJO.test(nombre) && lineaNit >= 2) {
    nombre = `${limpiarRazonSocial(lineas[lineaNit - 2])} ${nombre}`;
  }
  return nombre || null;
}

// ------------------------------------------------------------------- cliente

const INICIO_CLIENTE = /^(cliente|adquirente|se[ñn]ores)(?!\p{L})\s*:?\s*/iu;
const FIN_NOMBRE = /\s+(Emisi[oó]n|NIT\s*\/\s*CC|NIT|Documento|Fecha)(?!\p{L}).*$/iu;

function extraerNombreCliente(lineas: string[], hasta: number, lineaDocumento: number): string | null {
  const etiqueta = lineas.slice(0, hasta).findIndex((linea) => INICIO_CLIENTE.test(linea));
  if (etiqueta === -1) return null;

  let i = etiqueta;
  let nombre = lineas[i].replace(INICIO_CLIENTE, "");
  // «CLIENTE   DATOS DE LA FACTURA» es un encabezado: el nombre va en la línea siguiente.
  if ((nombre === "" || /^datos de la factura/i.test(nombre)) && i + 1 < hasta) {
    i += 1;
    nombre = lineas[i];
  }
  nombre = nombre.replace(FIN_NOMBRE, "").trim();
  // El nombre puede continuar en las líneas que quedan antes de la del documento.
  for (let j = i + 1; j < lineaDocumento; j += 1) nombre += ` ${lineas[j]}`;
  return nombre.trim() || null;
}

// --------------------------------------------------------------------- ítems

const ENCABEZADO_TABLA = /descripci[oó]n|precio unitario|v\. unitario/i;

/** Interpreta una línea con importes como ítem; null si no lo es. */
function interpretarItem(linea: string): ItemParcial | null {
  const sinPorcentajes = linea.replace(PORCENTAJE, " ");
  const importes = importesDe(sinPorcentajes);
  if (importes.length < 2) return null; // una dirección («Av. 27 $ 53-18») trae como mucho uno
  const precio = importes[importes.length - 2];
  const subtotal = importes[importes.length - 1];
  if (precio < 100) return null;

  const prefijo = sinPorcentajes
    .slice(0, sinPorcentajes.search(IMPORTE_UNO))
    .replace(/^(\[\d+\]|\d+\s*\|)\s*/, "") // número de fila: «[2]» o «3 |»
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // La cantidad puede ir al inicio («5 Monitor…»), al final («…semanal 4») o
  // como «23 x». Se elige la que cumple cantidad × precio = subtotal.
  const candidatos: { cantidad: number; descripcion: string }[] = [];
  const conEquis = prefijo.match(/^(.*?)\s*(\d+)\s*x$/i);
  if (conEquis) candidatos.push({ cantidad: Number(conEquis[2]), descripcion: conEquis[1] });
  const alInicio = prefijo.match(/^(\d+)(?:\s+(.*))?$/);
  if (alInicio) candidatos.push({ cantidad: Number(alInicio[1]), descripcion: alInicio[2] ?? "" });
  const alFinal = prefijo.match(/^(.*\S)\s+(\d+)$/);
  if (alFinal) candidatos.push({ cantidad: Number(alFinal[2]), descripcion: alFinal[1] });

  const elegido = candidatos.find((c) => c.cantidad * precio === subtotal);
  if (elegido) {
    return { descripcion: elegido.descripcion.trim(), cantidad: elegido.cantidad, precioUnitario: precio, subtotal };
  }
  // Reparación por redundancia aritmética: si ninguna cantidad cuadra pero
  // subtotal / precio es un entero pequeño, el OCR leyó mal (o no leyó) la cantidad.
  const deducida = subtotal / precio;
  if (Number.isInteger(deducida) && deducida >= 1 && deducida <= 999) {
    return { descripcion: prefijo, cantidad: deducida, precioUnitario: precio, subtotal };
  }
  return { descripcion: prefijo, cantidad: candidatos[0]?.cantidad ?? null, precioUnitario: precio, subtotal };
}

/** Igual que IMPORTE pero sin la marca global, para buscar la posición del primero. */
const IMPORTE_UNO = /\$\s?\d/;

/**
 * Los ítems son las líneas con dos importes (precio y subtotal) entre los datos
 * del cliente y la primera línea de totales. La descripción puede partirse en dos
 * líneas, y la parte sin cifras puede ir antes (ticket) o después (tablas).
 */
function extraerItems(lineas: string[], desde: number, hasta: number): ItemParcial[] {
  const items: ItemParcial[] = [];
  let sueltas: string[] = []; // líneas de texto sin importes, aún sin dueño

  const cerrarSueltas = () => {
    const ultimo = items[items.length - 1];
    if (ultimo && sueltas.length > 0) ultimo.descripcion = `${ultimo.descripcion} ${sueltas.join(" ")}`.trim();
    sueltas = [];
  };

  for (let i = desde; i < hasta; i += 1) {
    const item = interpretarItem(lineas[i]);
    if (!item) {
      // Solo cuenta como texto de una descripción si trae una palabra de verdad.
      if (/\p{L}{4,}/u.test(lineas[i]) && !ENCABEZADO_TABLA.test(lineas[i])) sueltas.push(lineas[i]);
      continue;
    }
    if (item.descripcion === "") {
      // Ticket: la descripción son las líneas anteriores.
      item.descripcion = sueltas.join(" ");
      sueltas = [];
    } else {
      // Tablas: las líneas sueltas eran la continuación del ítem anterior.
      cerrarSueltas();
    }
    items.push(item);
  }
  cerrarSueltas();
  return items;
}

// ------------------------------------------------------------------- totales

const INICIO_TOTALES = /^(valor antes de iva|subtotal|base gravable)(?!\p{L})/iu;
/** Empieza por «IVA»: así «Responsable de IVA» no cuenta. Admite «IVA19%» pegado. */
const LINEA_IVA = /^IVA(?!\p{L})/iu;
/** Empieza por la etiqueta: así «Impresora» no cuenta. */
const LINEA_IMPOCONSUMO = /^(impoconsumo|imp\.?\s*consumo|impuesto\s+nacional\s+al\s+consumo)/i;
const MENCIONA_IMPOCONSUMO = /impoconsumo|imp\.\s*consumo|impuesto\s+nacional\s+al\s+consumo/i;
/** «TOTAL», «Total factura», «TOTAL A PAGAR», «VALOR TOTAL»; nunca «Subtotal». */
const LINEA_TOTAL = /(?<!\p{L})total(?!\p{L})/iu;

function primerImporte(linea: string): number | null {
  return importesDe(linea.replace(PORCENTAJE, " "))[0] ?? null;
}

// ------------------------------------------------------------------ extraer

export function extraer(textoOcr: string): ParcialFactura {
  const lineas = normalizar(textoOcr);

  // Todo lo que va desde la primera línea de totales es zona de totales; lo
  // anterior son datos de cabecera e ítems.
  const encontrada = lineas.findIndex((linea) => INICIO_TOTALES.test(linea));
  const inicioTotales = encontrada === -1 ? lineas.length : encontrada;

  const { fecha, linea: lineaFecha } = extraerFecha(lineas.slice(0, inicioTotales));
  const { proveedor: docProveedor, cliente: docCliente } = extraerDocumentos(lineas, inicioTotales);

  let subtotal: number | null = null;
  let iva: number | null = null;
  let impoconsumo: number | null = null;
  let total: number | null = null;
  for (let i = inicioTotales; i < lineas.length; i += 1) {
    const linea = lineas[i];
    if (i === inicioTotales) subtotal = primerImporte(linea);
    else if (LINEA_IVA.test(linea)) iva ??= primerImporte(linea);
    else if (LINEA_IMPOCONSUMO.test(linea)) impoconsumo ??= primerImporte(linea);
    else if (LINEA_TOTAL.test(linea)) total = primerImporte(linea) ?? total; // gana la última línea «total»
  }

  const inicioItems = Math.max(docCliente?.linea ?? -1, lineaFecha) + 1;

  return {
    numero: extraerNumero(lineas.slice(0, inicioTotales)),
    fecha,
    proveedor: docProveedor ? extraerProveedor(lineas, docProveedor.linea) : null,
    nitProveedor: docProveedor?.numero ?? null,
    dvProveedor: docProveedor?.dv ?? null,
    clienteDocumento: docCliente?.numero ?? null,
    clienteDv: docCliente?.dv ?? null,
    clienteNombre: extraerNombreCliente(lineas, inicioTotales, docCliente?.linea ?? -1),
    items: extraerItems(lineas, inicioItems, inicioTotales),
    subtotal,
    iva,
    impoconsumo,
    mencionaImpoconsumo: lineas.some((linea) => MENCIONA_IMPOCONSUMO.test(linea)),
    total,
  };
}
