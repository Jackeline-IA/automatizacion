/*
 * Fase 9 — Revisión manual por la API, contra Firestore real (local o el despliegue).
 *
 * Uso: npx tsx scripts/probar-correccion.ts <carpetaImagenes> [url]
 *      (por defecto http://localhost:3000)
 *
 * No hay verdad.json: la «respuesta correcta» de cada factura es lo que lee el
 * OCR en este computador sobre imágenes que la máquina ACEPTA. Con 4 de ellas:
 *   - sube un lote por la API (como la página) y guarda cada factura con el mismo
 *     código del servidor (guardarFactura), pero dañando a propósito 3 lecturas
 *     para que queden «a revisión»:
 *       A: sin fecha ni total · B: dígito de verificación del cliente equivocado
 *       C: con el número de D (como si el OCR lo hubiera leído mal) · D: correcta
 *   - corrige A, B y C por PUT /api/facturas/[hash] y comprueba cada efecto.
 * Al final borra SOLO lo que creó (lote, facturas, índices, clientes, archivos).
 * No escribe ninguna contraseña: entra con una cookie de sesión como los demás scripts.
 */
import ExcelJS from "exceljs";
import sharp from "sharp";
import { db } from "../src/lib/firebase/admin";
import { COLECCIONES, type ArchivoCola, type Cliente, type Factura, type IndiceNumero, type Proceso } from "../src/lib/modelo/tipos";
import { leerFactura } from "../src/lib/ocr/leer-factura";
import type { ParcialFactura } from "../src/lib/ocr/tipos";
import { validar } from "../src/lib/ocr/validador";
import { erroresDeFormato, type EntradaCorreccion } from "../src/lib/procesamiento/correccion-esquema";
import type { DetalleRevision, PendienteRevision } from "../src/lib/procesamiento/corregir";
import { guardarFactura } from "../src/lib/procesamiento/guardar";
import { cargarImagenes, clientes, contar, crearCliente, crearComprobador, facturas, iniciarSesion, limpiar, procesos, type Imagen } from "./comun-pruebas";

const { comprobar, fallos } = crearComprobador();

interface Elegida {
  imagen: Imagen;
  /** Lo que leyó el OCR y aceptó la máquina: la respuesta correcta de esta prueba. */
  verdad: ParcialFactura;
  confianza: number;
}

/** De lo leído al cuerpo que enviaría el formulario. */
function entradaDe(v: ParcialFactura, cambios: Partial<EntradaCorreccion> = {}): EntradaCorreccion {
  return {
    numero: v.numero ?? "",
    fecha: v.fecha ?? "",
    proveedor: v.proveedor ?? "",
    nitProveedor: v.nitProveedor ?? "",
    dvProveedor: v.dvProveedor,
    clienteDocumento: v.clienteDocumento ?? "",
    clienteDv: v.clienteDv,
    clienteNombre: v.clienteNombre?.trim() || "Cliente sin nombre",
    items: v.items.map((item) => ({
      descripcion: item.descripcion.trim().slice(0, 200) || "Ítem",
      cantidad: item.cantidad ?? 0,
      precioUnitario: item.precioUnitario ?? 0,
    })),
    subtotal: v.subtotal ?? 0,
    iva: v.iva ?? 0,
    impoconsumo: v.impoconsumo,
    total: v.total ?? 0,
    confirmado: false,
    ...cambios,
  };
}

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const argumentos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const carpeta = argumentos[0];
  if (!carpeta) {
    console.error("Uso: npx tsx scripts/probar-correccion.ts <carpetaImagenes> [url]");
    process.exit(1);
  }
  const url = (argumentos[1] ?? "http://localhost:3000").replace(/\/+$/, "");
  console.log(`Probando la revisión manual en ${url}\n`);

  // --- Elegir 4 imágenes que la máquina acepta (y que no estén ya guardadas) ---
  console.log("Leyendo con OCR en este computador para tener los datos correctos…");
  const elegidas: Elegida[] = [];
  for (const imagen of await cargarImagenes(carpeta)) {
    if (elegidas.length === 4) break;
    if ((await facturas().doc(imagen.hash).get()).exists) continue; // de otro lote: no se toca
    const lectura = await leerFactura(Buffer.from(imagen.bytes));
    const formatoOk = erroresDeFormato(entradaDe(lectura.factura)).length === 0;
    console.log(`  ${imagen.nombre}: ${lectura.motivos.length === 0 && formatoOk ? "aceptada" : "no sirve (la máquina no la acepta)"}`);
    if (lectura.motivos.length === 0 && formatoOk) elegidas.push({ imagen, verdad: lectura.factura, confianza: lectura.confianza });
  }
  if (elegidas.length < 4) throw new Error("Hacen falta 4 imágenes sin guardar que la máquina acepte");
  const [A, B, C, D] = elegidas;
  const imagenes = elegidas.map((e) => e.imagen);

  const facturasAntes = await contar(facturas());
  const clientesAntes = await contar(clientes());
  const { cookie, uid } = await iniciarSesion(url);
  const creados: string[] = [];
  const api = crearCliente(url, cookie, creados);
  const put = (hash: string, cuerpo: unknown, conSesion = true) =>
    fetch(`${url}/api/facturas/${hash}`, {
      method: "PUT",
      headers: conSesion ? { cookie, "content-type": "application/json" } : { "content-type": "application/json" },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    });
  const leerFacturaDb = async (hash: string) => (await facturas().doc(hash).get()).data() as Factura;
  const indiceDe = async (numero: string) =>
    ((await db().collection(COLECCIONES.indicesNumero).doc(numero).get()).data() as IndiceNumero | undefined)?.hashArchivo ?? null;
  const ajena = "e".repeat(64);
  let ajenaCreada = false;

  try {
    // --- Preparar: un lote con 3 facturas en revisión y 1 aceptada ---
    console.log("\n— Preparación —");
    const id = await api.crearSubirEIniciar("prueba-correccion", imagenes);
    const metricas = async () => ((await procesos().doc(id).get()).data() as Proceso).metricas!;
    const cola = (await procesos().doc(id).collection(COLECCIONES.archivos).get()).docs.map((d) => ({ id: d.id, ...(d.data() as ArchivoCola) }));
    const guardar = async (e: Elegida, factura: ParcialFactura) => {
      const archivo = cola.find((c) => c.nombre === e.imagen.nombre);
      if (!archivo) throw new Error(`${e.imagen.nombre} no está en la cola`);
      const contexto = { hash: e.imagen.hash, archivo: archivo.nombre, rutaAlmacen: archivo.rutaAlmacen, procesoId: id, uid, ahora: Date.now() };
      return guardarFactura(contexto, archivo.id, { factura, motivos: validar(factura), confianza: e.confianza });
    };
    comprobar("D (correcta) la acepta la máquina", await guardar(D, D.verdad), "aceptada");
    comprobar("A (sin fecha ni total) va a revisión", await guardar(A, { ...A.verdad, fecha: null, total: null }), "revision");
    const dvMalo = ((B.verdad.clienteDv ?? 0) + 1) % 10;
    comprobar("B (DV del cliente equivocado) va a revisión", await guardar(B, { ...B.verdad, clienteDv: dvMalo }), "revision");
    comprobar("C (con el número de D) va a revisión", await guardar(C, { ...C.verdad, numero: D.verdad.numero }), "revision");
    await api.procesarYFinalizar(id);
    const inicial = await metricas();
    comprobar("contadores al empezar: 1 aceptada", inicial.aceptadas.n, 1);
    comprobar("  …3 en revisión", inicial.revision.n, 3);
    comprobar("  …0 revisadas a mano", inicial.manuales.n, 0);

    // --- Lista y detalle ---
    console.log("\n— Lista y detalle —");
    const sinSesion = await fetch(`${url}/api/facturas`);
    comprobar("la lista sin sesión", sinSesion.status, 401);
    const { pendientes } = await api.pedir<{ pendientes: PendienteRevision[] }>("GET", "/api/facturas");
    const hashes = new Set(pendientes.map((p) => p.hash));
    comprobar("la lista trae A, B y C", [A, B, C].every((e) => hashes.has(e.imagen.hash)), true);
    comprobar("  …y no trae D (la aceptó la máquina)", hashes.has(D.imagen.hash), false);
    const detalleB = await api.pedir<DetalleRevision>("GET", `/api/facturas/${B.imagen.hash}`);
    comprobar("el detalle de B precarga el documento LEÍDO del cliente", detalleB.precarga.clienteDocumento, B.verdad.clienteDocumento);
    comprobar("  …con el DV equivocado que leyó la máquina", detalleB.precarga.clienteDv, dvMalo);
    comprobar("  …y se puede editar", detalleB.editable, true);
    comprobar("el detalle de una factura que no existe", (await api.llamar("GET", `/api/facturas/${"0".repeat(64)}`)).status, 404);

    // --- La imagen girada ---
    const original = await sharp(Buffer.from(A.imagen.bytes)).metadata();
    const girada = await api.llamar("GET", `/api/facturas/${A.imagen.hash}/imagen?rotar=90`);
    comprobar("la imagen girada 90°", girada.status, 200);
    const medidas = await sharp(Buffer.from(await girada.arrayBuffer())).metadata();
    comprobar("  …intercambia ancho y alto", `${medidas.width}x${medidas.height}`, `${original.height}x${original.width}`);
    comprobar("un giro que no es 90, 180 ni 270", (await api.llamar("GET", `/api/facturas/${A.imagen.hash}/imagen?rotar=45`)).status, 400);

    // --- Rechazos que no escriben nada ---
    console.log("\n— Rechazos —");
    const antesA = (await facturas().doc(A.imagen.hash).get()).updateTime?.toMillis();
    comprobar("sin sesión", (await put(A.imagen.hash, entradaDe(A.verdad), false)).status, 401);
    comprobar("un cuerpo que no es JSON", (await put(A.imagen.hash, "no es json")).status, 400);
    const formatoMalo = await put(A.imagen.hash, entradaDe(A.verdad, { fecha: "16/10/2026" }));
    comprobar("una fecha mal escrita", formatoMalo.status, 400);
    comprobar("  …y dice qué está mal", ((await formatoMalo.json()) as { errores: string[] }).errores.includes("La fecha debe escribirse aaaa-mm-dd"), true);
    const totalMalo = entradaDe(A.verdad, { total: (A.verdad.total ?? 0) + 1000 });
    const sinConfirmar = await put(A.imagen.hash, totalMalo);
    comprobar("un total que no cuadra, sin confirmar", sinConfirmar.status, 422);
    comprobar("  …y explica el motivo", ((await sinConfirmar.json()) as { motivos: string[] }).motivos.includes("El total no es subtotal + IVA + impoconsumo"), true);
    comprobar("  …sin escribir nada en la factura", (await facturas().doc(A.imagen.hash).get()).updateTime?.toMillis(), antesA);
    comprobar("  …ni en los contadores", (await metricas()).manuales.n, 0);
    comprobar("corregir D, que aceptó la máquina", (await put(D.imagen.hash, entradaDe(D.verdad))).status, 409);
    comprobar("una factura que no existe", (await put("0".repeat(64), entradaDe(A.verdad))).status, 404);
    comprobar("un identificador inválido", (await put("..%2Fclientes", entradaDe(A.verdad))).status, 404);
    if (!(await facturas().doc(ajena).get()).exists) {
      const deOtro: Factura = { ...(await leerFacturaDb(A.imagen.hash)), uid: "otro-usuario-de-prueba", procesoId: "noExiste" };
      await facturas().doc(ajena).create(deOtro);
      ajenaCreada = true;
      comprobar("una factura de otro usuario (no se revela que existe)", (await put(ajena, entradaDe(A.verdad))).status, 404);
    }

    // --- A: guardar, reeditar y cambiar de número ---
    console.log("\n— Corregir A —");
    const motivosMaquinaA = (await leerFacturaDb(A.imagen.hash)).motivos;
    const guardadaA = await put(A.imagen.hash, entradaDe(A.verdad));
    comprobar("guardar A con sus datos correctos", guardadaA.status, 200);
    const fa = await leerFacturaDb(A.imagen.hash);
    comprobar("  …queda aceptada", fa.estado, "aceptada");
    comprobar("  …marcada como corregida a mano", fa.corregidaManualmente, true);
    comprobar("  …con quién la corrigió", typeof fa.corregidaPor === "string" && fa.corregidaPor.includes("@"), true);
    comprobar("  …y lo que había dicho la máquina", JSON.stringify(fa.motivosOriginales), JSON.stringify(motivosMaquinaA));
    comprobar("  …sin validaciones ignoradas", fa.validacionesIgnoradas?.length, 0);
    comprobar("  …con su total", fa.total, A.verdad.total);
    comprobar("  …y el índice de su número apunta a ella", await indiceDe(A.verdad.numero ?? ""), A.imagen.hash);
    let m = await metricas();
    comprobar("  …suma 1 a «revisadas a mano»", m.manuales.n, 1);
    comprobar("  …con su total", m.manuales.total, A.verdad.total);
    comprobar("  …«en revisión» no baja (mide a la máquina)", m.revision.n, 3);
    comprobar("  …y «aceptadas» no sube", m.aceptadas.n, 1);

    const reedicion = await put(A.imagen.hash, { ...totalMalo, confirmado: true });
    comprobar("reeditar A con un total que no cuadra, confirmando", reedicion.status, 200);
    const fa2 = await leerFacturaDb(A.imagen.hash);
    comprobar("  …deja constancia de la validación ignorada", fa2.validacionesIgnoradas?.includes("El total no es subtotal + IVA + impoconsumo"), true);
    comprobar("  …sin perder lo que dijo la máquina", JSON.stringify(fa2.motivosOriginales), JSON.stringify(motivosMaquinaA));
    m = await metricas();
    comprobar("  …no vuelve a contar la factura", m.manuales.n, 1);
    comprobar("  …y aplica solo la diferencia (+1000)", m.manuales.total, (A.verdad.total ?? 0) + 1000);

    const numeroNuevo = `FE-P${String(Date.now()).slice(-6)}`;
    if ((await indiceDe(numeroNuevo)) !== null) throw new Error(`El número ${numeroNuevo} ya existe: vuelve a ejecutar`);
    comprobar("cambiar el número de A", (await put(A.imagen.hash, entradaDe(A.verdad, { numero: numeroNuevo }))).status, 200);
    comprobar("  …libera el índice del número anterior", await indiceDe(A.verdad.numero ?? ""), null);
    comprobar("  …y crea el del nuevo", await indiceDe(numeroNuevo), A.imagen.hash);
    comprobar("  …y el total vuelve al correcto", (await metricas()).manuales.total, A.verdad.total);

    // --- B: el cliente se crea al corregir el DV ---
    console.log("\n— Corregir B —");
    const documentoB = B.verdad.clienteDocumento ?? "";
    const clienteYaExistia = (await clientes().doc(documentoB).get()).exists;
    const clientesNuevosAntes = (await metricas()).clientesNuevos;
    const guardadaB = await put(B.imagen.hash, entradaDe(B.verdad));
    comprobar("guardar B con el DV correcto", guardadaB.status, 200);
    comprobar("  …el servidor avisa si creó el cliente", ((await guardadaB.json()) as { clienteNuevo: boolean }).clienteNuevo, !clienteYaExistia);
    const clienteB = (await clientes().doc(documentoB).get()).data() as Cliente | undefined;
    comprobar("  …el cliente existe", clienteB !== undefined, true);
    if (!clienteYaExistia) comprobar("  …creado por este lote", clienteB?.primerProcesoId, id);
    comprobar("  …y la factura ya tiene su documento", (await leerFacturaDb(B.imagen.hash)).clienteDocumento, documentoB);
    comprobar("  …«clientes nuevos» del lote", (await metricas()).clientesNuevos, clientesNuevosAntes + (clienteYaExistia ? 0 : 1));

    // --- C: el número repetido ---
    console.log("\n— Corregir C —");
    const repetido = await put(C.imagen.hash, entradaDe(C.verdad, { numero: D.verdad.numero ?? "" }));
    comprobar("guardar C con el número de D", repetido.status, 409);
    comprobar("  …sin quitarle el índice a D", await indiceDe(D.verdad.numero ?? ""), D.imagen.hash);
    comprobar("guardar C con su número real", (await put(C.imagen.hash, entradaDe(C.verdad))).status, 200);
    comprobar("  …crea su índice", await indiceDe(C.verdad.numero ?? ""), C.imagen.hash);

    // --- Al final ---
    console.log("\n— Resultado —");
    const { pendientes: despues } = await api.pedir<{ pendientes: PendienteRevision[] }>("GET", "/api/facturas");
    comprobar("A, B y C ya no están pendientes", despues.some((p) => [A, B, C].some((e) => e.imagen.hash === p.hash)), false);
    m = await metricas();
    const totalCorregidas = [A, B, C].reduce((suma, e) => suma + (e.verdad.total ?? 0), 0);
    comprobar("3 revisadas a mano", m.manuales.n, 3);
    comprobar("  …y su total es el de las 3", m.manuales.total, totalCorregidas);
    comprobar("  …«en revisión» sigue en 3", m.revision.n, 3);
    const porProveedor = Object.values(m.proveedores).reduce((suma, p) => suma + p.total, 0);
    comprobar("«por razón social» suma las aceptadas + las revisadas a mano", porProveedor, (D.verdad.total ?? 0) + totalCorregidas);

    comprobar("regenerar el Excel sin sesión", (await fetch(`${url}/api/procesos/${id}/regenerar-excel`, { method: "POST" })).status, 401);
    comprobar("regenerar el Excel de un lote que no existe", (await api.llamar("POST", "/api/procesos/noExisteEsteLote123/regenerar-excel")).status, 404);
    comprobar("regenerar el Excel", (await api.llamar("POST", `/api/procesos/${id}/regenerar-excel`)).status, 200);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(Buffer.from(await (await api.llamar("GET", `/api/procesos/${id}/excel`)).arrayBuffer()) as unknown as ExcelJS.Buffer);
    const filas: { archivo: string; total: number; estado: string }[] = [];
    libro.getWorksheet("Facturas")?.eachRow((fila, n) => {
      if (n > 1) filas.push({ archivo: String(fila.getCell(1).value), total: Number(fila.getCell(11).value), estado: String(fila.getCell(12).value) });
    });
    const filaA = filas.find((f) => f.archivo === A.imagen.nombre);
    comprobar("el Excel regenerado trae A aceptada", filaA?.estado, "aceptada");
    comprobar("  …con su total corregido", filaA?.total, A.verdad.total);
    const enBase = await Promise.all(imagenes.map(async (imagen) => (await leerFacturaDb(imagen.hash)).total ?? 0));
    comprobar("  …y la suma del Excel = la de la base", filas.reduce((s, f) => s + f.total, 0), enBase.reduce((s, t) => s + t, 0));
  } finally {
    console.log("\n— Limpieza —");
    if (ajenaCreada) await facturas().doc(ajena).delete();
    console.log(`Borrado: ${await limpiar(creados, imagenes)}${ajenaCreada ? " y la factura «de otro usuario»" : ""}.`);
    comprobar("la base queda con las mismas facturas que antes de la prueba", await contar(facturas()), facturasAntes);
    comprobar("  …y los mismos clientes", await contar(clientes()), clientesAntes);
  }

  console.log(fallos() === 0 ? "\nRevisión manual correcta." : `\n${fallos()} comprobación(es) fallaron.`);
  process.exit(fallos() === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
