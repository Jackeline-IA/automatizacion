/*
 * Fase 7 — Comprueba el Excel de un lote, contra local o contra el despliegue:
 * que se genera al finalizar, que se descarga y que dice lo mismo que la base.
 *
 * Uso: npx tsx scripts/probar-excel.ts <carpetaImagenes> [url]   (por defecto http://localhost:3000)
 *
 * Trabaja contra Firestore y el almacén REALES y al final borra SOLO lo que creó
 * (mismas reglas que probar-pipeline.ts). Deja una copia de los dos Excel en
 * salida/ para abrirlos a mano. Nunca imprime tokens, cookies ni valores del .env.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { AggregateField } from "firebase-admin/firestore";
import { auth, db } from "../src/lib/firebase/admin";
import { COOKIE_SESION, correosPermitidos } from "../src/lib/auth/sesion";
import { COLECCIONES, type Factura, type IndiceNumero, type Proceso } from "../src/lib/modelo/tipos";
import type { ResumenLote } from "../src/lib/procesamiento/lote";
import { prefijoProceso } from "../src/lib/rutas";

const TIPO_EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let fallos = 0;
function comprobar(descripcion: string, obtenido: unknown, esperado: unknown): void {
  const bien = obtenido === esperado;
  if (!bien) fallos += 1;
  console.log(`${bien ? "OK   " : "FALLO"} ${descripcion} → ${String(obtenido)}${bien ? "" : ` (se esperaba ${String(esperado)})`}`);
}

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

/** Cookie de sesión del primer correo permitido, sin conocer su contraseña (igual que probar-sesion.ts). */
async function iniciarSesion(url: string): Promise<{ cookie: string }> {
  const correo = correosPermitidos()[0];
  if (!correo) throw new Error("USUARIOS_PERMITIDOS está vacía");
  const usuario = await auth().getUserByEmail(correo);
  const tokenPropio = await auth().createCustomToken(usuario.uid);
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const cambio = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: tokenPropio, returnSecureToken: true }),
  });
  if (!cambio.ok) throw new Error(`Firebase rechazó el token de prueba (${cambio.status})`);
  const { idToken } = (await cambio.json()) as { idToken: string };
  const login = await fetch(`${url}/api/sesion`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!login.ok) throw new Error(`POST /api/sesion respondió ${login.status}`);
  const cookie = login.headers.getSetCookie().find((l) => l.startsWith(`${COOKIE_SESION}=`));
  if (!cookie) throw new Error("El servidor no devolvió la cookie de sesión");
  return { cookie: cookie.split(";")[0] };
}

function almacen() {
  const leer = (nombre: string) => {
    const valor = process.env[nombre]?.trim();
    if (!valor) throw new Error(`Falta la variable ${nombre} en .env`);
    return valor;
  };
  const supabase = createClient(leer("NEXT_PUBLIC_SUPABASE_URL"), leer("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabase.storage.from(leer("SUPABASE_BUCKET"));
}

const facturas = () => db().collection(COLECCIONES.facturas);
const clientes = () => db().collection(COLECCIONES.clientes);
const procesos = () => db().collection(COLECCIONES.procesos);
const contar = async (coleccion: FirebaseFirestore.Query) => (await coleccion.count().get()).data().count;
/** Agregación sum() de Firestore sobre el total de TODAS las facturas. */
const sumaDeTotales = async () => (await facturas().aggregate({ suma: AggregateField.sum("total") }).get()).data().suma;

/** Columna de una hoja, por el título de su encabezado (sin la fila de encabezados). */
function columna(hoja: ExcelJS.Worksheet, titulo: string): ExcelJS.CellValue[] {
  let numero = 0;
  hoja.getRow(1).eachCell((celda, i) => {
    if (celda.value === titulo) numero = i;
  });
  if (numero === 0) throw new Error(`La hoja ${hoja.name} no tiene la columna «${titulo}»`);
  const valores: ExcelJS.CellValue[] = [];
  for (let fila = 2; fila <= hoja.rowCount; fila += 1) valores.push(hoja.getRow(fila).getCell(numero).value);
  return valores;
}

function resumenDe(libro: ExcelJS.Workbook): Record<string, ExcelJS.CellValue> {
  const resumen: Record<string, ExcelJS.CellValue> = {};
  libro.getWorksheet("Resumen")?.eachRow((fila) => {
    resumen[String(fila.getCell(1).value)] = fila.getCell(2).value;
  });
  return resumen;
}

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const carpeta = process.argv[2];
  if (!carpeta) {
    console.error("Uso: npx tsx scripts/probar-excel.ts <carpetaImagenes> [url]");
    process.exit(1);
  }
  const url = (process.argv[3] ?? "http://localhost:3000").replace(/\/+$/, "");

  const imagenes: { nombre: string; bytes: Uint8Array<ArrayBuffer>; hash: string }[] = [];
  for (const nombre of (await readdir(carpeta)).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort()) {
    const bytes = new Uint8Array(await readFile(path.join(carpeta, nombre)));
    imagenes.push({ nombre, bytes, hash: createHash("sha256").update(bytes).digest("hex") });
  }
  const n = imagenes.length;
  if (n === 0) throw new Error(`No hay imágenes en ${carpeta}`);
  console.log(`Probando el Excel con ${n} imagen(es) en ${url}\n`);

  // Si estas imágenes ya están guardadas, no se puede distinguir lo propio de lo ajeno.
  const previas = await db().getAll(...imagenes.map((imagen) => facturas().doc(imagen.hash)));
  if (previas.some((documento) => documento.exists)) {
    throw new Error("Estas imágenes ya tienen factura guardada (de otro lote). Este script no borra datos que no creó.");
  }
  const facturasAntes = await contar(facturas());
  const clientesAntes = await contar(clientes());
  const sumaAntes = await sumaDeTotales();

  const lotes: string[] = []; // lo que este script crea, para borrarlo al final

  try {
    comprobar("GET …/excel sin cookie", (await fetch(`${url}/api/procesos/cualquiera/excel`)).status, 401);

    const { cookie } = await iniciarSesion(url);
    const llamar = (metodo: "GET" | "POST", ruta: string) => fetch(`${url}${ruta}`, { method: metodo, headers: { cookie } });
    async function pedir<T>(metodo: "GET" | "POST", ruta: string): Promise<T> {
      const respuesta = await llamar(metodo, ruta);
      const texto = await respuesta.text();
      if (!respuesta.ok) throw new Error(`${metodo} ${ruta} respondió ${respuesta.status}: ${texto.slice(0, 300) || "(sin cuerpo)"}`);
      return JSON.parse(texto) as T;
    }

    async function crearSubirEIniciar(carpetaLote: string): Promise<string> {
      const creado = await fetch(`${url}/api/procesos`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ carpeta: carpetaLote, totalArchivos: n }),
      });
      if (creado.status !== 201) throw new Error(`No se pudo crear el lote (${creado.status})`);
      const { id } = (await creado.json()) as { id: string };
      lotes.push(id);
      for (const [i, imagen] of imagenes.entries()) {
        const subida = await fetch(`${url}/api/procesos/${id}/imagenes?indice=${i + 1}&nombre=${encodeURIComponent(imagen.nombre)}`, {
          method: "POST",
          headers: { cookie, "content-type": "application/octet-stream" },
          body: imagen.bytes,
        });
        if (!subida.ok) throw new Error(`No se pudo subir ${imagen.nombre} (${subida.status})`);
      }
      await pedir("POST", `/api/procesos/${id}/iniciar`);
      return id;
    }

    async function procesarYFinalizar(id: string): Promise<number> {
      async function trabajador() {
        for (;;) {
          const resumen = await pedir<ResumenLote>("POST", `/api/procesos/${id}/lote`);
          if (resumen.reclamados === 0) return;
        }
      }
      await Promise.all([trabajador(), trabajador(), trabajador()]);
      const inicio = Date.now();
      for (let intento = 0; intento < 15; intento += 1) {
        if ((await pedir<{ listo: boolean }>("POST", `/api/procesos/${id}/finalizar`)).listo) return Date.now() - inicio;
        await esperar(2000);
      }
      throw new Error("El lote no terminó de finalizar");
    }

    async function descargar(id: string, copia: string): Promise<ExcelJS.Workbook> {
      const respuesta = await llamar("GET", `/api/procesos/${id}/excel`);
      comprobar("GET …/excel del lote terminado", respuesta.status, 200);
      comprobar("  …es un Excel", respuesta.headers.get("content-type"), TIPO_EXCEL);
      const disposicion = respuesta.headers.get("content-disposition") ?? "";
      comprobar("  …se entrega como descarga, con su nombre", /^attachment; filename="resultado_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx"$/.test(disposicion), true);
      const bytes = Buffer.from(await respuesta.arrayBuffer());
      await mkdir("salida", { recursive: true });
      await writeFile(path.join("salida", copia), bytes);
      const libro = new ExcelJS.Workbook();
      // exceljs declara su propio tipo Buffer, distinto del de Node 24.
      await libro.xlsx.load(bytes as unknown as ExcelJS.Buffer);
      return libro;
    }

    // --- Lote A: imágenes nuevas ---
    console.log("— Lote A: imágenes nuevas —");
    const loteA = await crearSubirEIniciar("_prueba-excel-A");
    comprobar("antes de terminar no hay Excel", (await llamar("GET", `/api/procesos/${loteA}/excel`)).status, 409);
    const msFinalizar = await procesarYFinalizar(loteA);

    const procesoA = (await procesos().doc(loteA).get()).data() as Proceso;
    comprobar("el lote guarda la ruta de su Excel, dentro de su carpeta", procesoA.rutaExcel?.startsWith(`${prefijoProceso(loteA)}resultado_`) ?? false, true);
    comprobar("  …y el estado lo anuncia", (await pedir<{ tieneExcel: boolean }>("GET", `/api/procesos/${loteA}`)).tieneExcel, true);

    const libroA = await descargar(loteA, "excel-prueba-A.xlsx");
    comprobar("tiene las cuatro hojas", libroA.worksheets.map((h) => h.name).join(", "), "Facturas, Ítems, Clientes, Resumen");
    const hojaFacturas = libroA.getWorksheet("Facturas") as ExcelJS.Worksheet;
    comprobar("hoja Facturas: una fila por imagen", hojaFacturas.rowCount - 1, n);

    const guardadas = (await db().getAll(...imagenes.map((imagen) => facturas().doc(imagen.hash)))).map((d) => d.data() as Factura);
    const totales = columna(hojaFacturas, "Total");
    const sumaExcel = totales.reduce<number>((suma, valor) => suma + (typeof valor === "number" ? valor : 0), 0);
    const sumaBase = (await sumaDeTotales()) - sumaAntes;
    comprobar("la suma de la columna Total = sum() de Firestore", sumaExcel, sumaBase);
    comprobar("  …y = la suma de las facturas leídas una por una", sumaExcel, guardadas.reduce((s, f) => s + (f.total ?? 0), 0));

    const dinero = ["Valor antes de IVA", "IVA", "Impoconsumo", "Total"].flatMap((titulo) => columna(hojaFacturas, titulo));
    comprobar("los importes son números (o celdas vacías), nunca texto", dinero.every((v) => v === null || typeof v === "number"), true);
    comprobar("  …y hay importes de verdad", dinero.filter((v) => typeof v === "number").length >= n * 3, true);
    const fechas = columna(hojaFacturas, "Fecha");
    comprobar("las fechas son fechas reales", fechas.every((v) => v === null || v instanceof Date), true);
    const porArchivo = new Map(guardadas.map((f) => [f.archivo, f.fecha]));
    const archivosHoja = columna(hojaFacturas, "Archivo");
    const fechasIguales = fechas.every((v, i) => (v instanceof Date ? v.toISOString().slice(0, 10) : null) === porArchivo.get(String(archivosHoja[i])));
    comprobar("  …y coinciden con las guardadas (sin correrse de día)", fechasIguales, true);

    comprobar("hoja Ítems: una fila por ítem guardado", (libroA.getWorksheet("Ítems")?.rowCount ?? 0) - 1, guardadas.reduce((s, f) => s + f.items.length, 0));
    const documentos = new Set(guardadas.map((f) => f.clienteDocumento).filter((d) => d !== null));
    const hojaClientes = libroA.getWorksheet("Clientes") as ExcelJS.Worksheet;
    comprobar("hoja Clientes: una fila por documento distinto", hojaClientes.rowCount - 1, documentos.size);
    comprobar("  …su «Total comprado» suma lo mismo", columna(hojaClientes, "Total comprado").reduce<number>((s, v) => s + (typeof v === "number" ? v : 0), 0), guardadas.filter((f) => f.clienteDocumento !== null).reduce((s, f) => s + (f.total ?? 0), 0));

    const resumenA = resumenDe(libroA);
    comprobar("hoja Resumen: total de archivos", resumenA["Total de archivos"], n);
    comprobar("  …aceptadas + en revisión", Number(resumenA.Aceptadas) + Number(resumenA["En revisión"]), n);
    comprobar("  …clientes nuevos", resumenA["Clientes nuevos"], documentos.size);

    // --- Finalizar otra vez no genera otro Excel ---
    comprobar("finalizar otra vez no hace nada", (await pedir<{ yaEstaba?: boolean }>("POST", `/api/procesos/${loteA}/finalizar`)).yaEstaba, true);
    const enAlmacen = await almacen().list(prefijoProceso(loteA).replace(/\/$/, ""), { limit: 1000 });
    comprobar("  …sigue habiendo un solo Excel en el almacén", (enAlmacen.data ?? []).filter((a) => a.name.endsWith(".xlsx")).length, 1);

    // --- Lote B: reproceso de las mismas imágenes ---
    console.log("\n— Lote B: las mismas imágenes otra vez —");
    const loteB = await crearSubirEIniciar("_prueba-excel-B");
    await procesarYFinalizar(loteB);
    const libroB = await descargar(loteB, "excel-prueba-B.xlsx");
    comprobar("el Excel de un reproceso NO sale vacío: trae las duplicadas", (libroB.getWorksheet("Facturas")?.rowCount ?? 0) - 1, n);
    comprobar("  …y su resumen las cuenta como duplicadas", resumenDe(libroB).Duplicadas, n);

    // --- Lote de otro usuario ---
    const ajeno: Proceso = { uid: "otro-usuario-de-prueba", carpeta: "_prueba-excel-ajeno", estado: "terminado", totalArchivos: 0, inicio: Date.now(), fin: Date.now(), rutaExcel: procesoA.rutaExcel, finalizandoDesde: null };
    const loteAjeno = (await procesos().add(ajeno)).id;
    lotes.push(loteAjeno);
    console.log("");
    comprobar("GET …/excel de un lote ajeno", (await llamar("GET", `/api/procesos/${loteAjeno}/excel`)).status, 404);

    console.log(`\nGenerar y guardar el Excel de ${n} facturas tardó ${msFinalizar} ms (llamada a …/finalizar).`);
    console.log("Copias para abrir a mano: salida/excel-prueba-A.xlsx y salida/excel-prueba-B.xlsx");
  } finally {
    console.log("\n— Limpieza —");
    const candidatas = await db().getAll(...imagenes.map((imagen) => facturas().doc(imagen.hash)));
    let facturasBorradas = 0;
    for (const documento of candidatas) {
      const factura = documento.data() as Factura | undefined;
      if (!factura || !lotes.includes(factura.procesoId)) continue; // solo las de mis lotes
      if (factura.numero) {
        const indice = db().collection(COLECCIONES.indicesNumero).doc(factura.numero);
        // El índice se borra solo si apunta a ESTA factura.
        if (((await indice.get()).data() as IndiceNumero | undefined)?.hashArchivo === documento.id) await indice.delete();
      }
      await documento.ref.delete();
      facturasBorradas += 1;
    }
    let clientesBorrados = 0;
    for (const id of lotes) {
      for (const cliente of (await clientes().where("primerProcesoId", "==", id).get()).docs) {
        await cliente.ref.delete(); // solo los que creó un lote mío
        clientesBorrados += 1;
      }
      const carpetaLote = prefijoProceso(id).replace(/\/$/, "");
      const { data } = await almacen().list(carpetaLote, { limit: 1000 });
      const rutas = (data ?? []).map((archivo) => `${carpetaLote}/${archivo.name}`);
      if (rutas.length > 0) await almacen().remove(rutas);
      for (const archivo of (await procesos().doc(id).collection(COLECCIONES.archivos).get()).docs) await archivo.ref.delete();
      await procesos().doc(id).delete();
    }
    console.log(`Borrado: ${lotes.length} lote(s) con su cola, sus imágenes y su Excel; ${facturasBorradas} factura(s) con sus índices; ${clientesBorrados} cliente(s).`);
    comprobar("la base queda con las mismas facturas que antes de la prueba", await contar(facturas()), facturasAntes);
    comprobar("  …y los mismos clientes", await contar(clientes()), clientesAntes);
  }

  console.log(fallos === 0 ? "\nExcel correcto." : `\n${fallos} comprobación(es) fallaron.`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
