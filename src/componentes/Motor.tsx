"use client";

import { useEffect, useState } from "react";
import { emitir, escuchar } from "./eventos";

/*
 * El Motor: procesa los lotes en segundo plano DESDE EL NAVEGADOR.
 *
 * En Vercel no puede existir un proceso de servidor que viva minutos, así que
 * quien empuja el trabajo es esta pestaña: 3 trabajadores que llaman una y otra
 * vez a POST …/lote (cada llamada es otra instancia de la función: de ahí sale
 * el paralelismo) y, cuando la cola de un lote se vacía, a POST …/finalizar.
 *
 * Vive en el menú superior, que está en el layout: no se desmonta al cambiar de
 * página. Si se cierra la pestaña no se pierde nada: todo es idempotente, y al
 * volver a abrirla el motor descubre los lotes a medias y los retoma.
 */

const TRABAJADORES = 3;
const REPOSO_MS = 1_000;
/** Un lote sin archivos disponibles se vuelve a mirar pasado este tiempo: el arrendamiento de una función caída pudo caducar. */
const REVISAR_AGOTADO_MS = 30_000;
/** Si al finalizar aún hay archivos en manos de otra llamada, se reintenta pasado este tiempo. */
const REINTENTAR_FINALIZAR_MS = 5_000;
const ESPERA_MAXIMA_MS = 30_000;

interface LoteEnCurso {
  id: string;
  /** No pedir más trabajo de este lote antes de este momento. */
  agotadoHasta: number;
  /** No intentar finalizarlo antes de este momento (0 = todavía no toca). */
  finalizarDesde: number;
  finalizando: boolean;
}

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

export function Motor() {
  const [enCurso, setEnCurso] = useState(0);
  const [sesionCaducada, setSesionCaducada] = useState(false);

  useEffect(() => {
    // Todo el estado del motor vive dentro del efecto: si React lo desmonta y lo
    // vuelve a montar, el anterior se apaga (`activo = false`) y este arranca limpio.
    let activo = true;
    const lotes = new Map<string, LoteEnCurso>();
    let turno = 0;

    const publicar = () => setEnCurso(lotes.size);
    const agregar = (id: string) => {
      if (!lotes.has(id)) lotes.set(id, { id, agotadoHasta: 0, finalizarDesde: 0, finalizando: false });
      publicar();
    };
    const quitar = (id: string) => {
      lotes.delete(id);
      publicar();
    };

    /** El siguiente lote con trabajo, rotando para repartir los trabajadores entre lotes. */
    function elegir(ahora: number): { lote: LoteEnCurso; accion: "lote" | "finalizar" } | null {
      const lista = [...lotes.values()];
      for (let i = 0; i < lista.length; i += 1) {
        const lote = lista[(turno + i) % lista.length];
        if (lote.agotadoHasta <= ahora) {
          turno = (turno + i + 1) % lista.length;
          return { lote, accion: "lote" };
        }
      }
      const porCerrar = lista.find((l) => l.finalizarDesde > 0 && l.finalizarDesde <= ahora && !l.finalizando);
      return porCerrar ? { lote: porCerrar, accion: "finalizar" } : null;
    }

    async function trabajador() {
      let fallosSeguidos = 0;
      while (activo) {
        const tarea = elegir(Date.now());
        if (!tarea) {
          await esperar(REPOSO_MS);
          continue;
        }
        const { lote, accion } = tarea;
        if (accion === "finalizar") lote.finalizando = true;
        try {
          const respuesta = await fetch(`/api/procesos/${lote.id}/${accion}`, { method: "POST" });
          if (respuesta.status === 401) {
            // La sesión caducó: no tiene sentido seguir llamando.
            activo = false;
            setSesionCaducada(true);
            return;
          }
          if (respuesta.status === 404) {
            quitar(lote.id); // el lote se borró
            continue;
          }
          if (!respuesta.ok) throw new Error(`error ${respuesta.status}`);
          fallosSeguidos = 0;

          if (accion === "lote") {
            const { reclamados } = (await respuesta.json()) as { reclamados: number };
            if (reclamados === 0) {
              lote.agotadoHasta = Date.now() + REVISAR_AGOTADO_MS;
              if (lote.finalizarDesde === 0) lote.finalizarDesde = Date.now();
            }
          } else {
            const { listo } = (await respuesta.json()) as { listo: boolean };
            if (listo) {
              quitar(lote.id);
              emitir("lote-terminado", lote.id);
            } else {
              lote.finalizarDesde = Date.now() + REINTENTAR_FINALIZAR_MS;
            }
          }
        } catch {
          // Falla de red o error del servidor: se espera cada vez más y se reintenta.
          fallosSeguidos += 1;
          await esperar(Math.min(ESPERA_MAXIMA_MS, 2_000 * 2 ** (fallosSeguidos - 1)));
        } finally {
          if (accion === "finalizar") lote.finalizando = false;
        }
      }
    }

    /** Lotes que quedaron a medias (por ejemplo, se cerró la pestaña): se retoman. */
    async function descubrir() {
      try {
        const respuesta = await fetch("/api/procesos?estado=ejecutando");
        if (!respuesta.ok || !activo) return;
        const { lotes: pendientes } = (await respuesta.json()) as { lotes: { id: string }[] };
        for (const pendiente of pendientes) agregar(pendiente.id);
      } catch {
        // Sin red al cargar: los lotes nuevos llegarán por el evento.
      }
    }

    const dejarDeEscuchar = escuchar("lote-iniciado", agregar);
    void descubrir();
    for (let i = 0; i < TRABAJADORES; i += 1) void trabajador();

    return () => {
      activo = false;
      dejarDeEscuchar();
    };
  }, []);

  if (sesionCaducada) return <span className="text-sm text-malo">✕ La sesión caducó: vuelve a entrar</span>;
  if (enCurso === 0) return null;
  return (
    <span className="flex items-center gap-2 text-sm text-secundario" aria-live="polite">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-acento" aria-hidden="true" />
      Procesando {enCurso} lote(s)…
    </span>
  );
}
