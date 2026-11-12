"use client";

import { BorrarTodo } from "./BorrarTodo";
import { ListaProcesos } from "./ListaProcesos";
import { NuevoProceso } from "./NuevoProceso";
import { Aviso } from "./ui";
import { useMetricas } from "./useMetricas";

/**
 * La pantalla «Procesar facturas». Pide los lotes UNA vez y se los pasa a la
 * subida (para el avance en vivo) y a la lista: así no hay dos sondeos gastando
 * lecturas por lo mismo.
 */
export function Procesar() {
  const { datos, error } = useMetricas();
  const lotes = datos?.lotes ?? [];
  return (
    <>
      <NuevoProceso lotes={lotes} />
      {error && <Aviso>{error}</Aviso>}
      {datos ? <ListaProcesos lotes={lotes} /> : !error && <p className="text-sm text-secundario">Cargando tus lotes…</p>}
      <BorrarTodo />
    </>
  );
}
