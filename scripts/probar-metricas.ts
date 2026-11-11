/*
 * Fase 8 (entrega 1) — Comprueba que los contadores de cada lote cuadran con las
 * facturas guardadas, y las rutas que los entregan a la interfaz.
 *
 * Uso: npx tsx scripts/probar-metricas.ts <carpetaImagenes> [url]   (por defecto http://localhost:3000)
 *
 * Trabaja contra Firestore y el almacén REALES y al final borra SOLO lo que creó.
 */
import { db } from "../src/lib/firebase/admin";
import type { Factura, MetricasProceso, Proceso } from "../src/lib/modelo/tipos";
import { calcularTasas, metricasDesdeEventos, type EventoMetricas } from "../src/lib/procesamiento/metricas";
import type { ResumenProceso } from "../src/lib/procesamiento/proceso";
import {
  cargarImagenes,
  clientes,
  contar,
  crearCliente,
  crearComprobador,
  exigirImagenesSinProcesar,
  facturas,
  iniciarSesion,
  limpiar,
  procesos,
} from "./comun-pruebas";

const { comprobar, fallos } = crearComprobador();

/** Igualdad de contenido, sin importar el orden de las claves. */
function igual(a: unknown, b: unknown): boolean {
  const ordenar = (valor: unknown): unknown =>
    valor && typeof valor === "object" && !Array.isArray(valor)
      ? Object.fromEntries(Object.entries(valor).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, ordenar(v)]))
      : valor;
  return JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b));
}

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const carpeta = process.argv[2];
  if (!carpeta) {
    console.error("Uso: npx tsx scripts/probar-metricas.ts <carpetaImagenes> [url]");
    process.exit(1);
  }
  const url = (process.argv[3] ?? "http://localhost:3000").replace(/\/+$/, "");
  const imagenes = await cargarImagenes(carpeta);
  const n = imagenes.length;
  console.log(`Probando las métricas con ${n} imagen(es) en ${url}\n`);

  await exigirImagenesSinProcesar(imagenes);
  const facturasAntes = await contar(facturas());
  const clientesAntes = await contar(clientes());
  const lotes: string[] = [];

  try {
    comprobar("GET /api/metricas sin cookie", (await fetch(`${url}/api/metricas`)).status, 401);
    comprobar("GET /api/procesos sin cookie", (await fetch(`${url}/api/procesos`)).status, 401);

    const { cookie } = await iniciarSesion(url);
    const api = crearCliente(url, cookie, lotes);
    comprobar("GET /api/procesos con un estado que no existe", (await api.llamar("GET", "/api/procesos?estado=inventado")).status, 400);

    // --- Lote A: imágenes nuevas ---
    console.log("\n— Lote A: imágenes nuevas —");
    const loteA = await api.crearSubirEIniciar("_prueba-metricas-A", imagenes);
    const enCurso = await api.pedir<{ lotes: ResumenProceso[] }>("GET", "/api/procesos?estado=ejecutando");
    comprobar("el lote iniciado aparece entre los «ejecutando» (así lo descubre el motor)", enCurso.lotes.some((l) => l.id === loteA), true);
    await api.procesarYFinalizar(loteA);

    const guardadas = (await db().getAll(...imagenes.map((imagen) => facturas().doc(imagen.hash)))).map((d) => d.data() as Factura);
    const clientesCreados = await contar(clientes().where("primerProcesoId", "==", loteA));
    const metricasA = ((await procesos().doc(loteA).get()).data() as Proceso).metricas as MetricasProceso;

    // Lo que DEBERÍAN decir los contadores, recalculado desde las facturas guardadas.
    const eventos: EventoMetricas[] = guardadas.map((f) => ({
      tipo: f.estado,
      subtotal: f.subtotal,
      iva: f.iva,
      impoconsumo: f.impoconsumo,
      total: f.total,
      nitProveedor: f.nitProveedor,
      proveedor: f.proveedor,
      clienteNuevo: false, // los clientes nuevos se comprueban aparte, contra la colección
    }));
    const esperadas = metricasDesdeEventos(eventos);

    comprobar("aceptadas: el contador = las facturas aceptadas, con sus importes", igual(metricasA.aceptadas, esperadas.aceptadas), true);
    comprobar("revisión: el contador = las facturas en revisión", igual(metricasA.revision, esperadas.revision), true);
    comprobar("aceptadas + revisión = imágenes del lote", metricasA.aceptadas.n + metricasA.revision.n, n);
    comprobar("clientes nuevos: el contador = los clientes que creó el lote", metricasA.clientesNuevos, clientesCreados);
    // El nombre NO se compara tal cual: con llamadas concurrentes queda el de la
    // última factura guardada de ese NIT, y el OCR puede leerlo distinto en cada
    // una (mayúsculas, por ejemplo). Se comparan las cifras y que el nombre sea
    // uno de los leídos para ese NIT.
    const sinNombre = (proveedores: MetricasProceso["proveedores"]) =>
      Object.fromEntries(Object.entries(proveedores).map(([nit, p]) => [nit, { n: p.n, subtotal: p.subtotal, iva: p.iva, impoconsumo: p.impoconsumo, total: p.total }]));
    comprobar("por proveedor (NIT): las cifras coinciden con agrupar las aceptadas", igual(sinNombre(metricasA.proveedores), sinNombre(esperadas.proveedores)), true);
    const nombresLeidos = (nit: string) => guardadas.filter((f) => f.nitProveedor === nit).map((f) => f.proveedor);
    comprobar("  …y cada nombre es uno de los leídos para ese NIT", Object.entries(metricasA.proveedores).every(([nit, p]) => nombresLeidos(nit).includes(p.nombre)), true);
    comprobar("  …y sus facturas suman las aceptadas", Object.values(metricasA.proveedores).reduce((s, p) => s + p.n, 0), metricasA.aceptadas.n);
    comprobar("sin duplicadas ni errores", metricasA.duplicadas + metricasA.errores, 0);
    const tasas = calcularTasas(metricasA);
    console.log(`     ${tasas.correctas} de ${tasas.procesadas} leídas correctamente (${tasas.porcentajeCorrectas} %); total aceptado $${metricasA.aceptadas.total.toLocaleString("es-CO")}; ${Object.keys(metricasA.proveedores).length} proveedor(es)`);

    // --- Lote B: reproceso ---
    console.log("\n— Lote B: las mismas imágenes otra vez —");
    const loteB = await api.crearSubirEIniciar("_prueba-metricas-B", imagenes);
    await api.procesarYFinalizar(loteB);
    const metricasB = ((await procesos().doc(loteB).get()).data() as Proceso).metricas as MetricasProceso;
    comprobar("todas cuentan como duplicadas", metricasB.duplicadas, n);
    comprobar("  …y nada más sube", metricasB.aceptadas.n + metricasB.revision.n + metricasB.errores + metricasB.clientesNuevos, 0);
    comprobar("  …el porcentaje no las cuenta (0 procesadas)", calcularTasas(metricasB).procesadas, 0);
    const trasB = ((await procesos().doc(loteA).get()).data() as Proceso).metricas as MetricasProceso;
    comprobar("las métricas del lote A no cambian con el reproceso", igual(trasB, metricasA), true);

    // --- Rutas para la interfaz ---
    console.log("\n— Rutas —");
    const panel = await api.pedir<{ lotes: ResumenProceso[]; clientes: number }>("GET", "/api/metricas");
    const enPanelA = panel.lotes.find((l) => l.id === loteA);
    const enPanelB = panel.lotes.find((l) => l.id === loteB);
    comprobar("GET /api/metricas trae los dos lotes", enPanelA !== undefined && enPanelB !== undefined, true);
    comprobar("  …con las mismas métricas que hay en la base", igual(enPanelA?.metricas, metricasA) && igual(enPanelB?.metricas, metricasB), true);
    comprobar("  …del más reciente al más antiguo", panel.lotes.findIndex((l) => l.id === loteB) < panel.lotes.findIndex((l) => l.id === loteA), true);
    comprobar("  …terminados y con Excel", enPanelA?.estado === "terminado" && enPanelA.tieneExcel, true);
    comprobar("  …y el número de clientes de la base", panel.clientes, clientesAntes + clientesCreados);
    comprobar("  …sin exponer rutas internas del almacén", JSON.stringify(panel).includes("rutaExcel"), false);

    const terminados = await api.pedir<{ lotes: ResumenProceso[] }>("GET", "/api/procesos?estado=terminado");
    comprobar("GET /api/procesos?estado=terminado los incluye", [loteA, loteB].every((id) => terminados.lotes.some((l) => l.id === id)), true);
    const yaNoEnCurso = await api.pedir<{ lotes: ResumenProceso[] }>("GET", "/api/procesos?estado=ejecutando");
    comprobar("  …y ya no están entre los «ejecutando»", [loteA, loteB].some((id) => yaNoEnCurso.lotes.some((l) => l.id === id)), false);
    const detalle = await api.pedir<ResumenProceso>("GET", `/api/procesos/${loteA}`);
    comprobar("GET /api/procesos/[id] trae también las métricas", igual(detalle.metricas, metricasA), true);

    // Un lote de otro usuario no aparece en ninguna lista.
    const ajeno = (await procesos().add({ uid: "otro-usuario-de-prueba", carpeta: "_prueba-metricas-ajeno", estado: "terminado", totalArchivos: 0, inicio: Date.now(), fin: Date.now(), rutaExcel: null, finalizandoDesde: null } satisfies Proceso)).id;
    lotes.push(ajeno);
    const otraVez = await api.pedir<{ lotes: ResumenProceso[] }>("GET", "/api/metricas");
    comprobar("un lote de otro usuario no aparece en mis métricas", otraVez.lotes.some((l) => l.id === ajeno), false);
  } finally {
    console.log("\n— Limpieza —");
    console.log(`Borrado: ${await limpiar(lotes, imagenes)}.`);
    comprobar("la base queda con las mismas facturas que antes de la prueba", await contar(facturas()), facturasAntes);
    comprobar("  …y los mismos clientes", await contar(clientes()), clientesAntes);
  }

  console.log(fallos() === 0 ? "\nMétricas correctas." : `\n${fallos()} comprobación(es) fallaron.`);
  process.exit(fallos() === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
