/*
 * Fase 8 — Recorre la interfaz con un navegador real (Playwright), contra local o el despliegue:
 * elegir carpeta → subir por lotes → el Motor procesa → Métricas → Detalle de un lote.
 *
 * Uso: npx tsx scripts/probar-ui.ts <carpetaImagenes> [url] [--visible] [--capturas]
 *      (por defecto http://localhost:3000; --visible abre la ventana del navegador;
 *       --capturas guarda imágenes de cada pantalla en salida/capturas/)
 *
 * No escribe ninguna contraseña: entra con una cookie de sesión obtenida igual
 * que en probar-sesion.ts. Trabaja contra datos REALES y al final borra SOLO
 * los lotes que él creó (con sus facturas y clientes). Debe terminar con 0
 * errores en la consola del navegador. NO pulsa «Borrar todo».
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import type { FacturaDeLote } from "../src/lib/procesamiento/facturas-lote";
import { sumarMetricas } from "../src/lib/procesamiento/metricas";
import type { ResumenProceso } from "../src/lib/procesamiento/proceso";
import { COOKIE_SESION } from "../src/lib/auth/sesion";
import {
  cargarImagenes,
  clientes,
  contar,
  crearComprobador,
  exigirImagenesSinProcesar,
  facturas,
  iniciarSesion,
  limpiar,
} from "./comun-pruebas";

const FACTURAS_POR_LOTE = 4;
const ESPERA_PROCESAMIENTO_MS = 6 * 60 * 1000;

const { comprobar, fallos } = crearComprobador();

/** ¿Se ve este texto en la página? Espera un poco a que aparezca. */
async function seVe(page: Page, texto: string | RegExp, ms = 10_000): Promise<boolean> {
  return page
    .getByText(texto)
    .first()
    .waitFor({ state: "visible", timeout: ms })
    .then(() => true)
    .catch(() => false);
}

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const argumentos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const visible = process.argv.includes("--visible");
  const carpeta = argumentos[0];
  if (!carpeta) {
    console.error("Uso: npx tsx scripts/probar-ui.ts <carpetaImagenes> [url] [--visible]");
    process.exit(1);
  }
  const url = (argumentos[1] ?? "http://localhost:3000").replace(/\/+$/, "");
  const imagenes = await cargarImagenes(carpeta);
  const n = imagenes.length;
  const lotesEsperados = Math.ceil(n / FACTURAS_POR_LOTE);
  console.log(`Probando la interfaz con ${n} imagen(es) en ${url}\n`);

  await exigirImagenesSinProcesar(imagenes);
  const facturasAntes = await contar(facturas());
  const clientesAntes = await contar(clientes());

  const { cookie } = await iniciarSesion(url);
  const navegador = await chromium.launch({ headless: !visible });
  const contexto = await navegador.newContext();
  await contexto.addCookies([{ name: COOKIE_SESION, value: cookie.slice(COOKIE_SESION.length + 1), url }]);
  const page = await contexto.newPage();

  const erroresConsola: string[] = [];
  page.on("console", (mensaje) => {
    if (mensaje.type() === "error") erroresConsola.push(mensaje.text());
  });
  page.on("pageerror", (error) => erroresConsola.push(`excepción: ${error.message}`));

  const api = async <T>(ruta: string) => (await (await page.request.get(`${url}${ruta}`)).json()) as T;
  /** Con --capturas guarda una imagen de la página en salida/capturas/ (fuera de Git), para revisar el diseño. */
  const capturar = async (nombre: string) => {
    if (!process.argv.includes("--capturas")) return;
    await mkdir(path.join("salida", "capturas"), { recursive: true });
    await page.screenshot({ path: path.join("salida", "capturas", `${nombre}.png`), fullPage: true });
  };
  const creados: string[] = [];

  try {
    // --- Sin sesión: la página manda a /login ---
    const anonimo = await (await navegador.newContext()).newPage();
    await anonimo.goto(`${url}/`);
    comprobar("sin sesión, la página lleva a /login", new URL(anonimo.url()).pathname, "/login");
    comprobar("  …y allí no hay menú", await anonimo.getByRole("navigation", { name: "Principal" }).count(), 0);
    await anonimo.context().close();

    // --- Estructura ---
    console.log("\n— Procesar facturas —");
    const lotesPrevios = new Set((await api<{ lotes: ResumenProceso[] }>("/api/procesos")).lotes.map((l) => l.id));
    await page.goto(`${url}/`);
    const menu = page.getByRole("navigation", { name: "Principal" });
    comprobar("el menú tiene «Procesar facturas» y «Métricas»", (await menu.getByRole("link").allTextContents()).join(" | "), "Procesar facturas | Métricas");
    comprobar("  …con «Procesar facturas» resaltado", await menu.getByRole("link", { name: "Procesar facturas" }).getAttribute("aria-current"), "page");
    comprobar("  …y el botón «Cerrar sesión»", await page.getByRole("button", { name: "Cerrar sesión" }).count(), 1);

    // --- Elegir la carpeta y subir por lotes ---
    await page.locator('input[data-prueba="carpeta"]').setInputFiles(path.resolve(carpeta));
    comprobar("al elegir la carpeta cuenta sus imágenes", await seVe(page, `${n} imagen(es)`), true);
    await page.locator('input[name="facturasPorLote"]').fill(String(FACTURAS_POR_LOTE));
    comprobar(`con ${FACTURAS_POR_LOTE} por lote anuncia ${lotesEsperados} lotes`, await seVe(page, `Serán ${lotesEsperados} lote(s)`), true);
    comprobar("  …y estima las lecturas de Firestore", await seVe(page, /lecturas de\s+Firestore/), true);

    const inicio = Date.now();
    await page.getByRole("button", { name: "Subir y procesar" }).click();
    comprobar("la subida termina", await seVe(page, "Subida terminada", 120_000), true);
    const msSubida = Date.now() - inicio;
    comprobar("el Motor anuncia que está procesando (o ya terminó)", (await seVe(page, /Procesando \d+ lote/, 5_000)) || (await seVe(page, `Lote ${lotesEsperados} de ${lotesEsperados} · terminado`, 1_000)), true);

    // --- El Motor procesa en segundo plano hasta terminar todos los lotes ---
    let mios: ResumenProceso[] = [];
    while (Date.now() - inicio < ESPERA_PROCESAMIENTO_MS) {
      mios = (await api<{ lotes: ResumenProceso[] }>("/api/procesos")).lotes.filter((l) => !lotesPrevios.has(l.id));
      if (mios.length === lotesEsperados && mios.every((l) => l.estado === "terminado")) break;
      await page.waitForTimeout(3_000);
    }
    creados.push(...mios.map((l) => l.id));
    const msTotal = Date.now() - inicio;
    comprobar(`se crearon ${lotesEsperados} lotes`, mios.length, lotesEsperados);
    comprobar("  …y el Motor los terminó todos", mios.every((l) => l.estado === "terminado"), true);
    comprobar("  …con Excel cada uno", mios.every((l) => l.tieneExcel), true);
    const suma = sumarMetricas(mios.map((l) => l.metricas));
    comprobar("  …entre todos procesaron todas las imágenes", suma.aceptadas.n + suma.revision.n + suma.errores, n);

    comprobar("la pantalla muestra el último lote como terminado", await seVe(page, `Lote ${lotesEsperados} de ${lotesEsperados} · terminado`, 20_000), true);
    comprobar("  …y el indicador del Motor desaparece", await page.getByText(/Procesando \d+ lote/).count(), 0);
    const totalEnPesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(suma.aceptadas.total);
    comprobar("  …y el total en vivo es el de los contadores", await seVe(page, totalEnPesos), true);
    comprobar("la lista «Tus lotes» tiene un enlace de detalle por lote nuevo", (await page.getByRole("link", { name: "Detalle" }).count()) >= lotesEsperados, true);
    await capturar("1-procesar");

    // --- Métricas ---
    console.log("\n— Métricas —");
    await menu.getByRole("link", { name: "Métricas" }).click();
    comprobar("el menú lleva a /metricas sin recargar", await seVe(page, "Leídas correctamente"), true);
    comprobar("  …con «Métricas» resaltado", await menu.getByRole("link", { name: "Métricas" }).getAttribute("aria-current"), "page");
    for (const texto of ["Mal leídas (a revisión)", "Lo procesado", "Por razón social", "Por lote", "Clientes en la base"]) {
      comprobar(`  …muestra «${texto}»`, await seVe(page, texto, 5_000), true);
    }
    const selector = page.getByLabel("Qué mostrar");
    comprobar("el selector ofrece «Todos los lotes» y cada lote", (await selector.locator("option").count()) >= lotesEsperados + 1, true);
    await selector.selectOption(mios[0].id);
    const delLote = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(mios[0].metricas.aceptadas.total);
    comprobar("  …y al elegir un lote muestra su total", await seVe(page, delLote, 5_000), true);
    await selector.selectOption("todos");
    await capturar("2-metricas");

    // --- Detalle de un lote ---
    console.log("\n— Detalle de un lote —");
    const lote = mios[mios.length - 1]; // el primero que se subió: tiene FACTURAS_POR_LOTE imágenes
    await page.goto(`${url}/procesos/${lote.id}`);
    comprobar("el detalle muestra el botón del Excel", await seVe(page, "Descargar Excel"), true);
    // La tabla llega después (se pide una vez, al ver el lote terminado).
    await page.locator("tbody tr").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    // El texto de un <option> no cuenta como «visible»: se lee del desplegable.
    comprobar("  …y el filtro por estado, con el conteo", await page.getByLabel("Mostrar").locator("option").first().textContent(), `Todas (${lote.totalArchivos})`);
    comprobar("  …con una fila por factura", await page.locator("tbody tr").count(), lote.totalArchivos);
    // exact: «Volver» también contiene «ver».
    comprobar("  …y un enlace a cada imagen", await page.getByRole("link", { name: "Ver", exact: true }).count(), lote.totalArchivos);
    await capturar("3-detalle");

    const excel = await page.request.get(`${url}/api/procesos/${lote.id}/excel`);
    comprobar("el Excel se descarga", excel.status(), 200);
    const { facturas: lista } = await api<{ facturas: FacturaDeLote[] }>(`/api/procesos/${lote.id}/facturas`);
    const imagen = await page.request.get(`${url}/api/facturas/${lista[0].hash}/imagen`);
    comprobar("la imagen original se sirve desde el almacén privado", imagen.status(), 200);
    comprobar("  …como imagen", /^image\/(png|jpeg)$/.test(imagen.headers()["content-type"] ?? ""), true);
    const original = imagenes.find((i) => i.hash === lista[0].hash);
    comprobar("  …y es byte a byte la que se subió", (await imagen.body()).equals(Buffer.from(original?.bytes ?? [])), true);
    comprobar("una imagen que no existe", (await page.request.get(`${url}/api/facturas/${"0".repeat(64)}/imagen`)).status(), 404);
    comprobar("un identificador de imagen inválido", (await page.request.get(`${url}/api/facturas/..%2Fclientes/imagen`)).status(), 404);

    await page.goto(`${url}/procesos/noExisteEsteLote123`);
    comprobar("un lote que no existe lo dice, sin romperse", await seVe(page, "Este lote no existe"), true);
    // Ese 404 es esperado: el navegador lo anota en la consola como recurso fallido.
    const inesperados = erroresConsola.filter((e) => !/404/.test(e));
    comprobar("errores en la consola del navegador", inesperados.length, 0);
    for (const e of inesperados.slice(0, 5)) console.log(`      consola: ${e.slice(0, 200)}`);

    console.log(`\nSubida: ${(msSubida / 1000).toFixed(1)} s. Subida + procesamiento de ${n} facturas en ${lotesEsperados} lotes: ${(msTotal / 1000).toFixed(1)} s.`);
  } finally {
    await navegador.close();
    console.log("\n— Limpieza —");
    console.log(`Borrado: ${await limpiar(creados, imagenes)}.`);
    comprobar("la base queda con las mismas facturas que antes de la prueba", await contar(facturas()), facturasAntes);
    comprobar("  …y los mismos clientes", await contar(clientes()), clientesAntes);
  }

  console.log(fallos() === 0 ? "\nInterfaz correcta." : `\n${fallos()} comprobación(es) fallaron.`);
  process.exit(fallos() === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
