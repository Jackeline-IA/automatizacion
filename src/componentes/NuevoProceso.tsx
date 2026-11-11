"use client";

import { useState, type ChangeEvent } from "react";

/*
 * Subida de una carpeta de facturas. El navegador no habla con el almacén: manda
 * cada imagen, en su propia petición, a nuestra API, que la valida y la guarda.
 * Procesar las imágenes (cola, OCR, guardado) llega en la Fase 6.
 */

const EXTENSIONES = /\.(png|jpe?g)$/i;
const TAMANO_LOTE_POR_DEFECTO = 100;
const TAMANO_LOTE_MAXIMO = 1000;
const SUBIDAS_EN_PARALELO = 6;
const INTENTOS = 3;

interface Fallo {
  archivo: File;
  procesoId: string;
  indice: number;
  motivo: string;
}

interface Lote {
  id: string;
  total: number;
}

type Estado = "eligiendo" | "subiendo" | "terminado";

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

function megas(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

export function NuevoProceso() {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [descartados, setDescartados] = useState(0);
  const [tamanoLote, setTamanoLote] = useState(TAMANO_LOTE_POR_DEFECTO);
  const [estado, setEstado] = useState<Estado>("eligiendo");
  const [subidas, setSubidas] = useState(0);
  const [lotes, setLotes] = useState<Lote[]>([]);
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
    setSubidas(0);
    setLotes([]);
    setFallos([]);
    setError(null);
    evento.target.value = ""; // permite volver a elegir la misma carpeta
  }

  async function subirGrupo(pendientes: { archivo: File; procesoId: string; indice: number }[]) {
    await enParalelo(pendientes, SUBIDAS_EN_PARALELO, async ({ archivo, procesoId, indice }) => {
      const motivo = await subirUna(procesoId, indice, archivo);
      // Un archivo que falla no detiene el resto: queda en la lista con su motivo.
      if (motivo === null) setSubidas((n) => n + 1);
      else setFallos((lista) => [...lista, { archivo, procesoId, indice, motivo }]);
    });
  }

  async function subir() {
    setEstado("subiendo");
    setError(null);
    const carpeta = archivos[0]?.webkitRelativePath.split("/")[0] || "Archivos sueltos";

    for (let inicio = 0; inicio < archivos.length; inicio += tamanoLote) {
      const trozo = archivos.slice(inicio, inicio + tamanoLote);
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
      setLotes((lista) => [...lista, { id, total: trozo.length }]);
      await subirGrupo(trozo.map((archivo, i) => ({ archivo, procesoId: id, indice: i + 1 })));
    }
    setEstado("terminado");
  }

  async function reintentarFallidos() {
    const pendientes = fallos;
    setFallos([]);
    setEstado("subiendo");
    await subirGrupo(pendientes);
    setEstado("terminado");
  }

  const pesoTotal = archivos.reduce((suma, archivo) => suma + archivo.size, 0);
  const subiendo = estado === "subiendo";
  const botonArchivos = `cursor-pointer rounded border border-foreground/30 px-4 py-2 text-sm font-medium focus-within:outline focus-within:outline-2 ${
    subiendo ? "pointer-events-none opacity-50" : ""
  }`;

  return (
    <section className="flex flex-col gap-4 rounded border border-foreground/20 p-4">
      <h2 className="text-xl font-semibold">Procesar facturas</h2>

      <div className="flex flex-wrap gap-3">
        {/* Un <input type="file"> sin estilo es solo texto: la etiqueta hace de botón. */}
        <label className={botonArchivos}>
          Elegir carpeta
          <input
            type="file"
            multiple
            // @ts-expect-error webkitdirectory no está en los tipos de React, pero los navegadores lo admiten.
            webkitdirectory=""
            className="sr-only"
            disabled={subiendo}
            onChange={elegir}
          />
        </label>
        {/* Algunos navegadores móviles no dejan elegir carpetas. */}
        <label className={botonArchivos}>
          Elegir archivos
          <input
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,image/png,image/jpeg"
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
      {archivos.length === 0 && descartados > 0 && (
        <p className="text-sm">No hay imágenes .png ni .jpg en lo que elegiste.</p>
      )}

      {archivos.length > 0 && estado === "eligiendo" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Imágenes por lote
            <input
              type="number"
              min={1}
              max={TAMANO_LOTE_MAXIMO}
              value={tamanoLote}
              onChange={(e) =>
                setTamanoLote(Math.min(TAMANO_LOTE_MAXIMO, Math.max(1, Math.floor(Number(e.target.value)) || 1)))
              }
              className="w-28 rounded border border-foreground/30 bg-transparent px-3 py-2 text-base"
            />
          </label>
          <button type="button" onClick={subir} className="rounded bg-foreground px-4 py-2 font-medium text-background">
            Subir {archivos.length} imagen(es) en {Math.ceil(archivos.length / tamanoLote)} lote(s)
          </button>
        </div>
      )}

      {estado !== "eligiendo" && (
        <div className="flex flex-col gap-2 text-sm" aria-live="polite">
          <progress className="w-full" max={archivos.length} value={subidas + fallos.length} />
          <p>
            {subiendo ? "Subiendo… " : "Subida terminada. "}
            {subidas} de {archivos.length} guardada(s)
            {fallos.length > 0 && `, ${fallos.length} con problema`}.
          </p>
          {lotes.length > 0 && (
            <ul className="opacity-70">
              {lotes.map((lote, i) => (
                <li key={lote.id}>
                  Lote {i + 1}: {lote.total} imagen(es) · id <code>{lote.id}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          ✕ {error}
        </p>
      )}

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
          <button
            type="button"
            onClick={reintentarFallidos}
            className="self-start rounded border border-foreground/30 px-3 py-1"
          >
            Reintentar esos archivos
          </button>
        </div>
      )}
    </section>
  );
}
