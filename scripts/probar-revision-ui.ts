/*
 * Fase 9 — La revisión manual con un navegador real (Playwright), contra local o el despliegue.
 *
 * Uso: npx tsx scripts/probar-revision-ui.ts <carpetaImagenes> [url] [--visible] [--capturas]
 *      (por defecto http://localhost:3000; --capturas guarda imágenes en salida/capturas/)
 *
 * Preparación (como probar-correccion.ts, sin verdad.json): lee con OCR en este
 * computador TODAS las imágenes de la carpeta y crea un lote propio con
 *   - 2 facturas que la máquina acepta, dañadas a propósito (A: sin fecha ni
 *     total; B: dígito de verificación del cliente equivocado): su respuesta
 *     correcta es lo que leyó el OCR;
 *   - las facturas que la máquina NO acepta de verdad, con lo que les leyó.
 * Luego recorre: menú → lista → formulario (imagen, giro, validación en vivo,
 * guardar y saltar a la siguiente) → métricas → detalle del lote → Excel regenerado.
 * Debe terminar con 0 errores en la consola. Al final borra SOLO lo que creó.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { chromium, type Locator, type Page } from "playwright";
import { COOKIE_SESION } from "../src/lib/auth/sesion";
import { COLECCIONES, type ArchivoCola, type Factura } from "../src/lib/modelo/tipos";
import { leerFactura } from "../src/lib/ocr/leer-factura";
import type { ParcialFactura } from "../src/lib/ocr/tipos";
import { validar } from "../src/lib/ocr/validador";
import { guardarFactura } from "../src/lib/procesamiento/guardar";
import { cargarImagenes, clientes, contar, crearCliente, crearComprobador, facturas, iniciarSesion, limpiar, procesos, type Imagen } from "./comun-pruebas";

const { comprobar, fallos } = crearComprobador();
const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

interface Leida {
  imagen: Imagen;
  factura: ParcialFactura;
  motivos: string[];
  confianza: number;
}

/** Solo lo visible: Next 16 (cacheComponents) deja montada y OCULTA la pantalla anterior. */
const visible = (localizador: Locator) => localizador.filter({ visible: true });

async function seVe(page: Page, texto: string | RegExp, ms = 10_000): Promise<boolean> {
  return visible(page.getByText(texto))
    .first()
    .waitFor({ state: "visible", timeout: ms })
    .then(() => true)
    .catch(() => false);
}

/** Medidas reales de la imagen que muestra el formulario, cuando termina de cargar. */
async function medidasImagen(page: Page): Promise<string> {
  const imagen = visible(page.locator('img[data-prueba="imagen-factura"]')).first();
  await imagen.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const img = [...document.querySelectorAll<HTMLImageElement>('img[data-prueba="imagen-factura"]')].find((i) => i.offsetParent !== null);
    return img !== undefined && img.complete && img.naturalWidth > 0;
  });
  return imagen.evaluate((img: HTMLImageElement) => `${img.naturalWidth}x${img.naturalHeight}`);
}

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const argumentos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const conVentana = process.argv.includes("--visible");
  const carpeta = argumentos[0];
  if (!carpeta) {
    console.error("Uso: npx tsx scripts/probar-revision-ui.ts <carpetaImagenes> [url] [--visible] [--capturas]");
    process.exit(1);
  }
  const url = (argumentos[1] ?? "http://localhost:3000").replace(/\/+$/, "");
  console.log(`Probando la revisión manual con navegador en ${url}\n`);

  // --- Leer todas las imágenes con OCR (en este computador) ---
  console.log("Leyendo con OCR en este computador…");
  const leidas: Leida[] = [];
  for (const imagen of await cargarImagenes(carpeta)) {
    if ((await facturas().doc(imagen.hash).get()).exists) {
      console.log(`  ${imagen.nombre}: ya está guardada en otro lote, se omite`);
      continue;
    }
    const lectura = await leerFactura(Buffer.from(imagen.bytes));
    console.log(`  ${imagen.nombre}: ${lectura.motivos.length === 0 ? "aceptada" : `a revisión (${lectura.motivos.length} motivo(s))`}`);
    leidas.push({ imagen, factura: lectura.factura, motivos: lectura.motivos, confianza: lectura.confianza });
  }
  const aceptables = leidas.filter((l) => l.motivos.length === 0 && l.factura.clienteDv !== null);
  const reales = leidas.filter((l) => l.motivos.length > 0);
  if (aceptables.length < 2) throw new Error("Hacen falta al menos 2 imágenes sin guardar que la máquina acepte");
  const [A, B] = aceptables;
  const usadas = [A, B, ...reales];
  const imagenes = usadas.map((l) => l.imagen);
  console.log(`\nLote de prueba: A=${A.imagen.nombre}, B=${B.imagen.nombre} (dañadas a propósito) y ${reales.length} que la máquina no acepta de verdad.`);

  const facturasAntes = await contar(facturas());
  const clientesAntes = await contar(clientes());
  const { cookie, uid } = await iniciarSesion(url);
  const creados: string[] = [];
  const api = crearCliente(url, cookie, creados);

  const navegador = await chromium.launch({ headless: !conVentana });
  const contexto = await navegador.newContext({ viewport: { width: 1366, height: 900 } });
  await contexto.addCookies([{ name: COOKIE_SESION, value: cookie.slice(COOKIE_SESION.length + 1), url }]);
  const page = await contexto.newPage();
  const erroresConsola: string[] = [];
  page.on("console", (mensaje) => {
    if (mensaje.type() === "error") erroresConsola.push(mensaje.text());
  });
  page.on("pageerror", (error) => erroresConsola.push(`excepción: ${error.message}`));
  const capturar = async (nombre: string) => {
    if (!process.argv.includes("--capturas")) return;
    await mkdir(path.join("salida", "capturas"), { recursive: true });
    await page.screenshot({ path: path.join("salida", "capturas", `revision-${nombre}.png`), fullPage: true });
  };
  const campo = (etiqueta: string) => visible(page.getByLabel(etiqueta, { exact: true })).first();
  const boton = (nombre: string | RegExp) => visible(page.getByRole("button", { name: nombre })).first();
  const leerDb = async (hash: string) => (await facturas().doc(hash).get()).data() as Factura;

  try {
    // --- Preparación: el lote con sus facturas en revisión ---
    console.log("\n— Preparación —");
    const id = await api.crearSubirEIniciar("prueba-revision-ui", imagenes);
    const cola = (await procesos().doc(id).collection(COLECCIONES.archivos).get()).docs.map((d) => ({ id: d.id, ...(d.data() as ArchivoCola) }));
    const guardar = async (l: Leida, factura: ParcialFactura) => {
      const archivo = cola.find((c) => c.nombre === l.imagen.nombre);
      if (!archivo) throw new Error(`${l.imagen.nombre} no está en la cola`);
      const ctx = { hash: l.imagen.hash, archivo: archivo.nombre, rutaAlmacen: archivo.rutaAlmacen, procesoId: id, uid, ahora: Date.now() };
      return guardarFactura(ctx, archivo.id, { factura, motivos: validar(factura), confianza: l.confianza });
    };
    comprobar("A (sin fecha ni total) queda en revisión", await guardar(A, { ...A.factura, fecha: null, total: null }), "revision");
    const dvMalo = ((B.factura.clienteDv ?? 0) + 1) % 10;
    comprobar("B (DV del cliente equivocado) queda en revisión", await guardar(B, { ...B.factura, clienteDv: dvMalo }), "revision");
    for (const r of reales) comprobar(`${r.imagen.nombre} (real) queda en revisión`, await guardar(r, r.factura), "revision");
    await api.procesarYFinalizar(id);
    const enRevision = 2 + reales.length;

    // --- Menú y lista ---
    console.log("\n— Lista de pendientes —");
    await page.goto(`${url}/`);
    const menu = page.getByRole("navigation", { name: "Principal" });
    const pestana = menu.getByRole("link", { name: /Revisión/ });
    comprobar("el menú tiene la pestaña «Revisión»", await pestana.count(), 1);
    await pestana.click();
    comprobar("lleva a la lista de pendientes", await seVe(page, "Revisión manual"), true);
    comprobar("  …con «Revisión» resaltado", await menu.locator('a[aria-current="page"]', { hasText: "Revisión" }).count(), 1);
    // El contador sale de los contadores de los lotes (llegan después de pintar el menú): se espera a que aparezca.
    const insignia = menu.getByLabel(/pendiente\(s\)/);
    await insignia.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    const contador = Number((await insignia.textContent().catch(() => "0"))?.replace(/\D/g, "") || 0);
    comprobar(`  …y el contador muestra al menos ${enRevision} pendientes`, contador >= enRevision, true);
    const fila = (l: Leida) => visible(page.getByRole("row").filter({ hasText: l.imagen.nombre })).first();
    await fila(A).waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    comprobar("la lista trae todas las facturas en revisión del lote", (await Promise.all(usadas.map((l) => fila(l).count()))).every((n) => n === 1), true);
    comprobar("  …cada una con su motivo y un botón «Revisar»", await fila(A).getByRole("link", { name: "Revisar" }).count(), 1);
    await capturar("1-lista");

    // --- Formulario de A ---
    console.log("\n— Formulario (A) —");
    await fila(A).getByRole("link", { name: "Revisar" }).click();
    comprobar("abre el formulario de A", await seVe(page, `Revisar ${A.imagen.nombre}`), true);
    comprobar("  …en su dirección", new URL(page.url()).pathname, `/revision/${A.imagen.hash}`);
    const medidasOriginales = await medidasImagen(page);
    comprobar("la imagen original se ve", /^\d+x\d+$/.test(medidasOriginales), true);
    comprobar("  …con lo que dijo la máquina", await seVe(page, "No se pudo leer el total"), true);
    await boton("Girar a la derecha").click();
    await page.waitForFunction(() => document.querySelector('img[data-prueba="imagen-factura"][src*="rotar=90"]') !== null);
    const [ancho, alto] = medidasOriginales.split("x");
    comprobar("girarla 90° intercambia ancho y alto", await medidasImagen(page), `${alto}x${ancho}`);
    comprobar("  …y el servidor rechaza un giro que no sea 90, 180 o 270", (await page.request.get(`${url}/api/facturas/${A.imagen.hash}/imagen?rotar=45`)).status(), 400);
    await boton("Girar a la izquierda").click();

    comprobar("precarga el número leído", await campo("Número").inputValue(), A.factura.numero);
    comprobar("propone el total desde los ítems (la máquina no lo leyó)", await campo("Total").inputValue(), String(A.factura.total));
    comprobar("sin fecha: avisa qué falta", await seVe(page, "La fecha debe escribirse aaaa-mm-dd"), true);
    comprobar("  …y no deja guardar", await boton(/^Guardar/).isDisabled(), true);
    await campo("Fecha de emisión").fill(A.factura.fecha ?? "");
    comprobar("con la fecha: todo cuadra", await seVe(page, "Todo cuadra con las reglas de validación."), true);
    comprobar("  …y el botón dice «Guardar»", await boton(/^Guardar/).textContent(), "Guardar");
    comprobar("  …y está activo", await boton(/^Guardar/).isEnabled(), true);

    // Validación en vivo: un total equivocado exige confirmar.
    await campo("Total").fill(String((A.factura.total ?? 0) + 1000));
    comprobar("un total equivocado: dice qué no cuadra", await seVe(page, "El total no es subtotal + IVA + impoconsumo"), true);
    comprobar("  …el botón pasa a «Guardar de todos modos»", await boton(/^Guardar/).textContent(), "Guardar de todos modos");
    comprobar("  …desactivado hasta confirmar", await boton(/^Guardar/).isDisabled(), true);
    const confirmacion = visible(page.getByLabel(/Revisé la imagen/)).first();
    await confirmacion.check();
    comprobar("  …al confirmar se activa", await boton(/^Guardar/).isEnabled(), true);
    await capturar("2-formulario-no-cuadra");
    await boton("Recalcular desde los ítems").click();
    comprobar("«Recalcular» vuelve al total correcto", await campo("Total").inputValue(), String(A.factura.total));
    comprobar("  …y vuelve a cuadrar", await seVe(page, "Todo cuadra con las reglas de validación."), true);
    await capturar("3-formulario");

    await boton(/^Guardar/).click();
    await page.waitForURL((direccion) => direccion.pathname !== `/revision/${A.imagen.hash}`, { timeout: 15_000 });
    const tras = new URL(page.url()).pathname;
    comprobar("al guardar salta a la siguiente pendiente", tras.startsWith("/revision/") && tras !== `/revision/${A.imagen.hash}`, true);
    const fa = await leerDb(A.imagen.hash);
    comprobar("  …A queda aceptada y corregida a mano", `${fa.estado} ${fa.corregidaManualmente}`, "aceptada true");
    comprobar("  …con la fecha y el total correctos", `${fa.fecha} ${fa.total}`, `${A.factura.fecha} ${A.factura.total}`);
    // key={hash}: la siguiente factura es un formulario nuevo. Se comprueba con su propio título
    // y con que no herede la confirmación que se marcó en A.
    await visible(page.getByRole("heading", { name: /^Revisar / })).first().waitFor({ state: "visible", timeout: 10_000 });
    comprobar("la siguiente es un formulario NUEVO, con su propio título", await visible(page.getByRole("heading", { name: `Revisar ${A.imagen.nombre}` })).count(), 0);
    comprobar("  …y sin la confirmación marcada en A", await visible(page.getByLabel(/Revisé la imagen/).and(page.locator(":checked"))).count(), 0);

    // --- B: el dígito de verificación ---
    console.log("\n— Formulario (B) —");
    await page.goto(`${url}/revision/${B.imagen.hash}`);
    comprobar("abre el formulario de B", await seVe(page, `Revisar ${B.imagen.nombre}`), true);
    comprobar("precarga el documento LEÍDO del cliente", await campo("Documento del cliente").inputValue(), B.factura.clienteDocumento);
    comprobar("  …y avisa que el DV no es válido", await seVe(page, "El dígito de verificación del documento del cliente no es válido"), true);
    await campo("DV del cliente").fill(String(B.factura.clienteDv));
    comprobar("con el DV correcto: todo cuadra", await seVe(page, "Todo cuadra con las reglas de validación."), true);
    await boton(/^Guardar/).click();
    await page.waitForURL((direccion) => direccion.pathname !== `/revision/${B.imagen.hash}`, { timeout: 15_000 });
    comprobar("  …B queda aceptada con su documento", (await leerDb(B.imagen.hash)).clienteDocumento, B.factura.clienteDocumento);

    // --- Métricas ---
    console.log("\n— Métricas —");
    await page.goto(`${url}/metricas`);
    await visible(page.getByLabel("Qué mostrar")).first().selectOption(id);
    const frase = `De las ${enRevision} mal leídas, 2 ya se revisaron a mano y ${enRevision - 2} ${enRevision - 2 === 1 ? "espera" : "esperan"} a una persona.`;
    comprobar("dice cuántas se revisaron a mano y cuántas esperan", await seVe(page, frase), true);
    comprobar("  …«Leídas correctamente» no cambia (mide a la máquina)", await seVe(page, "0 de " + enRevision + " factura(s)"), true);
    comprobar("  …y «Lo procesado» suma las revisadas a mano", await seVe(page, PESOS.format((A.factura.total ?? 0) + (B.factura.total ?? 0))), true);
    await capturar("4-metricas");

    // --- Detalle del lote y Excel ---
    console.log("\n— Detalle del lote —");
    await page.goto(`${url}/procesos/${id}`);
    await visible(page.locator("tbody tr")).first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    comprobar("la tabla marca las 2 «Revisada a mano»", await visible(page.locator("tbody").getByText("Revisada a mano")).count(), 2);
    comprobar("  …y ofrece «Revisar» en las que esperan", await visible(page.locator("tbody").getByRole("link", { name: "Revisar" })).count(), reales.length);
    await boton("Regenerar el Excel con las correcciones a mano").click();
    comprobar("regenerar el Excel", await seVe(page, "Excel actualizado", 30_000), true);
    await capturar("5-detalle");
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(Buffer.from(await (await page.request.get(`${url}/api/procesos/${id}/excel`)).body()) as unknown as ExcelJS.Buffer);
    const resumen: Record<string, ExcelJS.CellValue> = {};
    libro.getWorksheet("Resumen")?.eachRow((r) => {
      resumen[String(r.getCell(1).value)] = r.getCell(2).value;
    });
    comprobar("el Excel regenerado cuenta 2 «Revisadas a mano»", resumen["Revisadas a mano"], 2);
    let estadoA = "";
    libro.getWorksheet("Facturas")?.eachRow((r) => {
      if (String(r.getCell(1).value) === A.imagen.nombre) estadoA = String(r.getCell(12).value);
    });
    comprobar("  …y trae A como aceptada", estadoA, "aceptada");

    const inesperados = erroresConsola.filter((e) => !/404/.test(e));
    comprobar("errores en la consola del navegador", inesperados.length, 0);
    for (const e of inesperados.slice(0, 5)) console.log(`      consola: ${e.slice(0, 200)}`);
  } finally {
    await navegador.close();
    console.log("\n— Limpieza —");
    console.log(`Borrado: ${await limpiar(creados, imagenes)}.`);
    comprobar("la base queda con las mismas facturas que antes de la prueba", await contar(facturas()), facturasAntes);
    comprobar("  …y los mismos clientes", await contar(clientes()), clientesAntes);
  }

  console.log(fallos() === 0 ? "\nRevisión manual en la interfaz correcta." : `\n${fallos()} comprobación(es) fallaron.`);
  process.exit(fallos() === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
