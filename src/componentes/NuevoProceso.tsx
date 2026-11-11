"use client";

import { useState, type ChangeEvent } from "react";
import type { ResumenProceso } from "@/lib/procesamiento/proceso";
import { emitir } from "./eventos";
import { megas } from "./formato";
import { ResumenEnVivo } from "./ResumenEnVivo";
import { Aviso, Barra, BOTON, BOTON_SECUNDARIO, Tarjeta } from "./ui";

/*
 * Subida de una carpeta de facturas, por lotes. El navegador no habla con el
 * almacén: manda cada imagen, en su propia petición, a nuestra API.
 *
 * Por cada lote: crearlo → subir sus imágenes → iniciarlo → avisar al Motor →
 * pasar al SIGUIENTE lote sin esperar a que el anterior termine de procesarse.
 * Subir y procesar quedan desacoplados: el usuario no espera.
 */

const EXTENSIONES = /\.(png|jpe?g)$/i;
const FACTURAS_POR_LOTE = 100;
const MAXIMO_POR_LOTE = 1000; // el tope que acepta POST /api/procesos
const SUBIDAS_EN_PARALELO = 6;
const INTENTOS = 3;
/** Lecturas de Firestore que cuesta procesar una factura (reclamo, atajo por hash, factura, índice, cliente). */
const LECTURAS_POR_FACTURA = 5;

interface Fallo {
  archivo: File;
  procesoId: string;
  indice: number;
  motivo: string;
}

/** Un lote de esta subida, tal como lo ve la pantalla. */
interface LoteSubida {
  id: string;
  total: number;
  subidas: number;
  /** El lote ya se inició: el Motor lo está procesando. */
  iniciado: boolean;
}

type Estado = "eligiendo" | "subiendo" | "terminado";

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

/** Sube una imagen. Devuelve null si quedó guardada o el motivo si no. */
async function subirUna(procesoId: string, indice: number, archivo: File): Promise<string | null> {
  const direccion = `/api/procesos/${procesoId}/imagenes?indice=${indice}&nombre=${encodeURIComponent(archivo.name)}`;
  let ultimo = "sin respuesta";
  for (let intento = 1; intento <= INTENTOS; intento += 1) {
    try {
      // El cuerpo es el propio archivo: el navegador envía sus bytes, sin multipart.
      const respuesta = await fetch(direccion, {
        method: "POST",
        headers: { "content-type": archivo.type || "application/octet-stream" },
        body: archivo,
      });
      if (respuesta.ok) return null;
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
      ultimo = cuerpo.error ?? `error ${respuesta.status}`;
      // Un rechazo 4xx no se reintenta: el problema es el archivo (o la sesión), no la red.
      if (respuesta.status < 500) return ultimo;
    } catch {
      ultimo = "falla de red";
    }
    if (intento < INTENTOS) await esperar(intento * 1000); // espera creciente
  }
  return `${ultimo} (tras ${INTENTOS} intentos)`;
}

/** Ejecuta las tareas de a `limite` a la vez: sin esto, 1000 peticiones saldrían juntas. */
async function enParalelo<T>(elementos: T[], limite: number, tarea: (elemento: T) => Promise<void>): Promise<void> {
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < elementos.length) {
      const actual = elementos[siguiente];
      siguiente += 1;
      await tarea(actual);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, elementos.length) }, trabajador));
}

/** `lotes` son los del servidor (con sus métricas): de ahí sale el avance del procesamiento. */
export function NuevoProceso({ lotes: lotesServidor }: { lotes: ResumenProceso[] }) {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [descartados, setDescartados] = useState(0);
  const [porLote, setPorLote] = useState(FACTURAS_POR_LOTE);
  const [estado, setEstado] = useState<Estado>("eligiendo");
  const [lotes, setLotes] = useState<LoteSubida[]>([]);
  const [fallos, setFallos] = useState<Fallo[]>([]);
  const [error, setError] = useState<string | null>(null);

  function elegir(evento: ChangeEvent<HTMLInputElement>) {
    const todos = Array.from(evento.target.files ?? []);
    const imagenes = todos
      .filter((archivo) => EXTENSIONES.test(archivo.name))
      // Orden estable: el índice de cada imagen sale de su posición.
      .sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));
    setArchivos(imagenes);
    setDescartados(todos.length - imagenes.length);
    setEstado("eligiendo");
    setLotes([]);
    setFallos([]);
    setError(null);
    evento.target.value = ""; // permite volver a elegir la misma carpeta
  }

  const cambiarLote = (id: string, cambio: (lote: LoteSubida) => LoteSubida) =>
    setLotes((lista) => lista.map((lote) => (lote.id === id ? cambio(lote) : lote)));

  async function subirGrupo(pendientes: { archivo: File; procesoId: string; indice: number }[]) {
    await enParalelo(pendientes, SUBIDAS_EN_PARALELO, async ({ archivo, procesoId, indice }) => {
      const motivo = await subirUna(procesoId, indice, archivo);
      // Un archivo que falla no detiene el resto: queda en la lista con su motivo.
      if (motivo === null) cambiarLote(procesoId, (lote) => ({ ...lote, subidas: lote.subidas + 1 }));
      else setFallos((lista) => [...lista, { archivo, procesoId, indice, motivo }]);
    });
  }

  /** Crea la cola del lote y avisa al Motor de que hay trabajo. */
  async function iniciar(procesoId: string): Promise<boolean> {
    const respuesta = await fetch(`/api/procesos/${procesoId}/iniciar`, { method: "POST" }).catch(() => null);
    if (!respuesta?.ok) return false;
    cambiarLote(procesoId, (lote) => ({ ...lote, iniciado: true }));
    emitir("lote-iniciado", procesoId);
    return true;
  }

  // 0 = todo en un solo lote (hasta el máximo que admite el servidor).
  const tamano = porLote === 0 ? Math.min(archivos.length, MAXIMO_POR_LOTE) : porLote;
  const cuantosLotes = tamano > 0 ? Math.ceil(archivos.length / tamano) : 0;

  async function subirYProcesar() {
    setEstado("subiendo");
    setError(null);
    const carpeta = archivos[0]?.webkitRelativePath.split("/")[0] || "Archivos sueltos";

    for (let inicio = 0; inicio < archivos.length; inicio += tamano) {
      const trozo = archivos.slice(inicio, inicio + tamano);
      const respuesta = await fetch("/api/procesos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ carpeta, totalArchivos: trozo.length }),
      }).catch(() => null);
      if (!respuesta?.ok) {
        setError(
          respuesta?.status === 401
            ? "La sesión caducó: vuelve a iniciar sesión."
            : "No se pudo crear el lote. Las imágenes que faltan no se subieron.",
        );
        break;
      }
      const { id } = (await respuesta.json()) as { id: string };
      setLotes((lista) => [...lista, { id, total: trozo.length, subidas: 0, iniciado: false }]);
      await subirGrupo(trozo.map((archivo, i) => ({ archivo, procesoId: id, indice: i + 1 })));
      // Se inicia con lo que haya subido bien y se sigue con el siguiente lote,
      // sin esperar a que este termine de procesarse.
      if (!(await iniciar(id))) setError("No se pudo iniciar un lote. Recarga la página para ver su estado.");
    }
    setEstado("terminado");
  }

  async function reintentarFallidos() {
    const pendientes = fallos;
    setFallos([]);
    setEstado("subiendo");
    await subirGrupo(pendientes);
    // Volver a iniciar es idempotente: solo añade a la cola las imágenes nuevas.
    for (const id of new Set(pendientes.map((fallo) => fallo.procesoId))) await iniciar(id);
    setEstado("terminado");
  }

  const pesoTotal = archivos.reduce((suma, archivo) => suma + archivo.size, 0);
  const subiendo = estado === "subiendo";
  const botonArchivos = `cursor-pointer ${BOTON_SECUNDARIO} focus-within:outline focus-within:outline-2 ${subiendo ? "pointer-events-none opacity-50" : ""}`;
  const delServidor = new Map(lotesServidor.map((lote) => [lote.id, lote]));

  return (
    <Tarjeta titulo="Procesar facturas">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          {/* Un <input type="file"> sin estilo es solo texto: la etiqueta hace de botón. */}
          <label className={botonArchivos}>
            Elegir carpeta…
            <input
              type="file"
              multiple
              // @ts-expect-error webkitdirectory no está en los tipos de React, pero los navegadores lo admiten.
              webkitdirectory=""
              data-prueba="carpeta"
              className="sr-only"
              disabled={subiendo}
              onChange={elegir}
            />
          </label>
          {/* Algunos navegadores móviles no dejan elegir carpetas. */}
          <label className={botonArchivos}>
            Elegir archivos…
            <input
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,image/png,image/jpeg"
              data-prueba="archivos"
              className="sr-only"
              disabled={subiendo}
              onChange={elegir}
            />
          </label>
        </div>

        {archivos.length > 0 && (
          <p className="text-sm">
            {archivos.length} imagen(es), {megas(pesoTotal)}.
            {descartados > 0 && ` Se ignoraron ${descartados} archivo(s) que no son .png ni .jpg.`}
          </p>
        )}
        {archivos.length === 0 && descartados > 0 && <p className="text-sm">No hay imágenes .png ni .jpg en lo que elegiste.</p>}

        {archivos.length > 0 && estado === "eligiendo" && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Facturas por lote (0 = todas en un solo lote)
              <input
                type="number"
                name="facturasPorLote"
                min={0}
                max={MAXIMO_POR_LOTE}
                value={porLote}
                onChange={(e) => setPorLote(Math.min(MAXIMO_POR_LOTE, Math.max(0, Math.floor(Number(e.target.value)) || 0)))}
                className="w-28 rounded border border-borde bg-superficie px-3 py-2 text-base"
              />
            </label>
            <p className="text-sm text-secundario">
              Serán {cuantosLotes} lote(s). Procesarlas gastará unas {(archivos.length * LECTURAS_POR_FACTURA).toLocaleString("es-CO")} lecturas de
              Firestore (≈ {LECTURAS_POR_FACTURA} por factura; el plan gratuito da 50.000 al día).
            </p>
            <button type="button" onClick={subirYProcesar} className={`${BOTON} self-start`}>
              Subir y procesar
            </button>
          </div>
        )}

        {lotes.length > 0 && (
          <ul className="flex flex-col gap-3" aria-live="polite">
            {lotes.map((lote, i) => {
              const servidor = delServidor.get(lote.id);
              const m = servidor?.metricas;
              const procesadas = m ? m.aceptadas.n + m.revision.n + m.errores + m.duplicadas : 0;
              return (
                <li key={lote.id} className="flex flex-col gap-1 text-sm">
                  <p className="font-medium">
                    Lote {i + 1} de {cuantosLotes}{" "}
                    <span className="font-normal text-secundario">
                      · {servidor?.estado === "terminado" ? "terminado" : lote.iniciado ? "procesando" : "subiendo"}
                    </span>
                  </p>
                  <p className="cifras text-secundario">
                    Subida: {lote.subidas} de {lote.total}
                  </p>
                  <Barra valor={lote.subidas} maximo={lote.total} etiqueta={`Subida del lote ${i + 1}`} />
                  <p className="cifras text-secundario">
                    Procesadas: {procesadas} de {lote.total}
                  </p>
                  <Barra valor={procesadas} maximo={lote.total} tono="bueno" etiqueta={`Procesamiento del lote ${i + 1}`} />
                </li>
              );
            })}
          </ul>
        )}

        {lotes.length > 0 && <ResumenEnVivo lotes={lotes.flatMap((lote) => delServidor.get(lote.id) ?? [])} />}

        {estado === "terminado" && (
          <p className="text-sm">
            Subida terminada. Puedes elegir otra carpeta o cambiar de página: el procesamiento sigue en segundo plano mientras esta pestaña
            esté abierta.
          </p>
        )}

        {error && <Aviso>{error}</Aviso>}

        {fallos.length > 0 && !subiendo && (
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">Archivos que no se pudieron subir:</p>
            <ul className="max-h-48 overflow-auto">
              {fallos.map((fallo) => (
                <li key={`${fallo.procesoId}-${fallo.indice}`}>
                  ✕ {fallo.archivo.name}: {fallo.motivo}
                </li>
              ))}
            </ul>
            <button type="button" onClick={reintentarFallidos} className={`${BOTON_SECUNDARIO} self-start`}>
              Reintentar esos archivos
            </button>
          </div>
        )}
      </div>
    </Tarjeta>
  );
}
