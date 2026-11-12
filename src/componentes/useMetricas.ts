"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResumenProceso } from "@/lib/procesamiento/proceso";
import { escuchar } from "./eventos";

/*
 * Los lotes del usuario con sus métricas (GET /api/metricas: 1 lectura por lote + 1).
 *
 * Para no gastar cuota, se refresca solo cuando hace falta: cada 8 s MIENTRAS
 * haya lotes procesándose y la pestaña esté visible, y al instante cuando el
 * motor avisa de que un lote empezó o terminó.
 */

const CADA_MS = 8_000;

export interface DatosMetricas {
  lotes: ResumenProceso[];
  /** Clientes en la base (de todos los lotes). */
  clientes: number;
}

export function useMetricas(): { datos: DatosMetricas | null; error: string | null } {
  const [datos, setDatos] = useState<DatosMetricas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let vigente = true;
    let hayLotesProcesando = false;

    async function cargar() {
      try {
        const respuesta = await fetch("/api/metricas");
        if (!vigente) return;
        if (respuesta.status === 401) {
          router.replace("/login");
          return;
        }
        if (!respuesta.ok) throw new Error();
        const nuevos = (await respuesta.json()) as DatosMetricas;
        if (!vigente) return;
        hayLotesProcesando = nuevos.lotes.some((lote) => lote.estado === "ejecutando");
        setDatos(nuevos);
        setError(null);
      } catch {
        if (vigente) setError("No se pudieron cargar las métricas. Se reintentará sola.");
      }
    }

    void cargar();
    const reloj = setInterval(() => {
      if (hayLotesProcesando && document.visibilityState === "visible") void cargar();
    }, CADA_MS);
    const dejarIniciado = escuchar("lote-iniciado", () => void cargar());
    const dejarTerminado = escuchar("lote-terminado", () => void cargar());
    const dejarBorrado = escuchar("datos-borrados", () => void cargar());

    return () => {
      vigente = false;
      clearInterval(reloj);
      dejarIniciado();
      dejarTerminado();
      dejarBorrado();
    };
  }, [router]);

  return { datos, error };
}
