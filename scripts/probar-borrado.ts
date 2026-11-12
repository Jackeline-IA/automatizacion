/*
 * Fase 8 (entrega 3) — Comprueba las BARRERAS de «Borrar todo», contra local o el despliegue.
 *
 * Uso: npx tsx scripts/probar-borrado.ts [url]   (por defecto http://localhost:3000)
 *
 * Este script NO BORRA NADA y no puede hacerlo: nunca envía la palabra de
 * confirmación correcta, ni por HTTP ni en el formulario. Solo comprueba que
 * sin ella el servidor se niega y el botón sigue desactivado. El borrado real
 * lo prueba una persona, a mano (una prueba automática no debe vaciar la base).
 */
import { chromium } from "playwright";
import { COOKIE_SESION } from "../src/lib/auth/sesion";
import { clientes, contar, crearComprobador, facturas, iniciarSesion, procesos } from "./comun-pruebas";

const { comprobar, fallos } = crearComprobador();

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const url = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
  console.log(`Probando las barreras de «Borrar todo» en ${url}\n`);

  const antes = { facturas: await contar(facturas()), clientes: await contar(clientes()), lotes: await contar(procesos()) };

  const pedir = (cookie: string | null, cuerpo: unknown) =>
    fetch(`${url}/api/datos/borrar`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    });

  // --- Servidor ---
  // Ninguna petición de este script lleva la palabra correcta, ni siquiera las que van sin sesión.
  comprobar("sin sesión", (await pedir(null, { confirmacion: "sin-sesion" })).status, 401);
  comprobar("GET en vez de POST no borra", (await fetch(`${url}/api/datos/borrar`)).status, 405);

  const { cookie } = await iniciarSesion(url);
  const rechazos: [string, unknown][] = [
    ["sin cuerpo", ""],
    ["cuerpo vacío", {}],
    ["en minúsculas", { confirmacion: "borrar" }],
    ["con un espacio en medio", { confirmacion: "BORRA R" }],
    ["palabra incompleta", { confirmacion: "BORRA" }],
    ["otra palabra", { confirmacion: "SI" }],
    ["solo la confirmación extra", { aunqueHayaLotesProcesando: true }],
    ["la confirmación como lista", { confirmacion: ["B", "O"] }],
  ];
  for (const [descripcion, cuerpo] of rechazos) {
    const respuesta = await pedir(cookie, cuerpo);
    comprobar(`con sesión, ${descripcion}`, respuesta.status, 400);
  }

  // --- Formulario ---
  console.log("");
  const navegador = await chromium.launch();
  try {
    const contexto = await navegador.newContext();
    await contexto.addCookies([{ name: COOKIE_SESION, value: cookie.slice(COOKIE_SESION.length + 1), url }]);
    const page = await contexto.newPage();
    const peticionesDeBorrado: string[] = [];
    page.on("request", (peticion) => {
      if (peticion.url().includes("/api/datos/borrar")) peticionesDeBorrado.push(peticion.method());
    });

    await page.goto(`${url}/`);
    await page.getByRole("button", { name: "Borrar todo…" }).click();
    const definitivo = page.getByRole("button", { name: "Borrar todo definitivamente" });
    const campo = page.locator('input[name="confirmacion"]');
    comprobar("el formulario avisa de que no se puede deshacer", await page.getByText("No se puede deshacer.").isVisible(), true);
    comprobar("  …y de que afecta a todos los usuarios", await page.getByText("todos los usuarios").isVisible(), true);
    comprobar("  …y de que gasta el límite de borrados", await page.getByText(/límite diario de borrados/).isVisible(), true);
    comprobar("el botón definitivo empieza desactivado", await definitivo.isDisabled(), true);
    for (const intento of ["borrar", "BORRA", "Borrar", "BORRA R"]) {
      await campo.fill(intento);
      comprobar(`  …y sigue desactivado al escribir «${intento}»`, await definitivo.isDisabled(), true);
    }
    // Enter en el campo con una palabra incorrecta tampoco envía nada.
    await campo.press("Enter");
    await page.waitForTimeout(500);
    comprobar("pulsar Enter con la palabra incorrecta no envía ninguna petición", peticionesDeBorrado.length, 0);
    await page.getByRole("button", { name: "Cancelar" }).click();
    comprobar("«Cancelar» cierra el formulario", await definitivo.count(), 0);
  } finally {
    await navegador.close();
  }

  // --- Nada cambió ---
  console.log("");
  comprobar("las facturas siguen igual", await contar(facturas()), antes.facturas);
  comprobar("los clientes siguen igual", await contar(clientes()), antes.clientes);
  comprobar("los lotes siguen igual", await contar(procesos()), antes.lotes);

  console.log(fallos() === 0 ? "\nBarreras de borrado correctas. (El borrado real se prueba a mano.)" : `\n${fallos()} comprobación(es) fallaron.`);
  process.exit(fallos() === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
