"use client";

import { useSyncExternalStore } from "react";
import type { ResumenProceso } from "@/lib/procesamiento/proceso";
import { escuchar } from "./eventos";

/*
 * Los lotes del usuario con sus métricas (GET /api/metricas: 1 lectura por lote + 1).
 *
 * Para no gastar cuota, se refresca solo cuando hace falta: cada 8 s MIENTRAS
 * haya lotes procesándose y la pestaña esté visible, y al instante cuando el
 * motor avisa de que un lote empezó o terminó, o una persona guardó una revisión.
 *
 * Es un almacén COMPARTIDO (desde la Fase 9): el menú (contador de «Revisión») y
 * el panel de métricas lo usan a la vez y hacen una sola carga, no una cada uno.
 * Empieza con el primer componente que lo usa y se detiene con el último.
 */

const CADA_MS = 8_000;

export interface DatosMetricas {
  lotes: ResumenProceso[];
  /** Clientes en la base (de todos los lotes). */
  clientes: number;
}

interface EstadoMetricas {
  datos: DatosMetricas | null;
  error: string | null;
}

const INICIAL: EstadoMetricas = { datos: null, error: null };
let estado = INICIAL;
const oyentes = new Set<() => void>();
let detener: (() => void) | null = null;

function publicar(nuevo: EstadoMetricas): void {
  estado = nuevo;
  for (const oyente of oyentes) oyente();
}

function arrancar(): () => void {
  let vigente = true;
  let hayLotesProcesando = false;

  async function cargar() {
    try {
      const respuesta = await fetch("/api/metricas");
      if (!vigente) return;
      if (respuesta.status === 401) {
        // La cookie existe pero ya no vale (caducó o se revocó).
        window.location.replace("/login");
        return;
      }
      if (!respuesta.ok) throw new Error();
      const nuevos = (await respuesta.json()) as DatosMetricas;
      if (!vigente) return;
      hayLotesProcesando = nuevos.lotes.some((lote) => lote.estado === "ejecutando");
      publicar({ datos: nuevos, error: null });
    } catch {
      if (vigente) publicar({ ...estado, error: "No se pudieron cargar las métricas. Se reintentará sola." });
    }
  }

  void cargar();
  const reloj = setInterval(() => {
    if (hayLotesProcesando && document.visibilityState === "visible") void cargar();
  }, CADA_MS);
  const dejar = (["lote-iniciado", "lote-terminado", "datos-borrados", "revision-guardada"] as const).map((evento) =>
    escuchar(evento, () => void cargar()),
  );

  return () => {
    vigente = false;
    clearInterval(reloj);
    for (const d of dejar) d();
  };
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  detener ??= arrancar();
  return () => {
    oyentes.delete(oyente);
    if (oyentes.size === 0) {
      detener?.();
      detener = null;
    }
  };
}

export function useMetricas(): EstadoMetricas {
  return useSyncExternalStore(
    suscribir,
    () => estado,
    () => INICIAL,
  );
}
