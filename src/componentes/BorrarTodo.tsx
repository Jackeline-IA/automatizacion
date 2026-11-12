"use client";

import { useState, type FormEvent } from "react";
import { PALABRA_PARA_BORRAR } from "@/lib/procesamiento/borrado";
import type { ResultadoBorrado } from "@/lib/procesamiento/borrar";
import { emitir } from "./eventos";
import { Aviso, Tarjeta } from "./ui";

/*
 * «Borrar todo»: para practicar desde cero con datos de prueba. Es irreversible,
 * así que el botón solo se activa al escribir la palabra exacta; el servidor
 * vuelve a comprobarlo (lo que decide es el servidor, no este formulario).
 */
export function BorrarTodo() {
  const [abierto, setAbierto] = useState(false);
  const [palabra, setPalabra] = useState("");
  const [hayLotesProcesando, setHayLotesProcesando] = useState(false);
  const [aunqueHayaLotes, setAunqueHayaLotes] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoBorrado | null>(null);

  const palabraCorrecta = palabra === PALABRA_PARA_BORRAR;

  async function borrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!palabraCorrecta) return;
    setBorrando(true);
    setError(null);
    try {
      const respuesta = await fetch("/api/datos/borrar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmacion: palabra, aunqueHayaLotesProcesando: aunqueHayaLotes }),
      });
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string; borrado?: ResultadoBorrado };
      if (respuesta.status === 409) {
        // Hay lotes procesándose: se pide la confirmación adicional.
        setHayLotesProcesando(true);
        setError(cuerpo.error ?? "Hay lotes procesándose.");
        return;
      }
      if (!respuesta.ok || !cuerpo.borrado) throw new Error(cuerpo.error ?? "No se pudo borrar.");
      setResultado(cuerpo.borrado);
      setPalabra("");
      setAunqueHayaLotes(false);
      setHayLotesProcesando(false);
      setAbierto(false);
      emitir("datos-borrados", ""); // los paneles vuelven a cargar
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar.");
    } finally {
      setBorrando(false);
    }
  }

  return (
    <Tarjeta titulo="Borrar todos los datos">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-secundario">
          Vacía la aplicación para practicar desde cero: borra las facturas, los clientes, los lotes y todas las imágenes y Excel guardados.
        </p>

        {resultado && (
          <p role="status" className="rounded bg-bueno-suave px-3 py-2 text-bueno">
            ✓ Borrado: {resultado.lotes} lote(s), {resultado.facturas} factura(s), {resultado.clientes} cliente(s) y {resultado.archivos}{" "}
            archivo(s).
          </p>
        )}

        {!abierto ? (
          <button
            type="button"
            onClick={() => {
              setAbierto(true);
              setResultado(null);
              setError(null);
            }}
            className="self-start rounded border border-malo px-3 py-1.5 font-medium text-malo"
          >
            Borrar todo…
          </button>
        ) : (
          <form onSubmit={borrar} className="flex flex-col gap-3 rounded border border-malo p-3">
            <ul className="list-disc pl-5">
              <li>
                <strong>No se puede deshacer.</strong> No hay papelera ni copia de seguridad.
              </li>
              <li>
                Borra los datos de <strong>todos los usuarios</strong>, no solo los tuyos.
              </li>
              <li>Cada documento borrado gasta del límite diario de borrados de Firestore.</li>
            </ul>
            <label className="flex flex-col gap-1">
              Para confirmar, escribe {PALABRA_PARA_BORRAR} en mayúsculas
              <input
                type="text"
                name="confirmacion"
                autoComplete="off"
                value={palabra}
                onChange={(e) => setPalabra(e.target.value)}
                className="w-48 rounded border border-borde bg-superficie px-3 py-2 text-base"
              />
            </label>
            {hayLotesProcesando && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={aunqueHayaLotes} onChange={(e) => setAunqueHayaLotes(e.target.checked)} className="mt-1" />
                Borrar aunque haya lotes procesándose (se interrumpen y se pierde su avance)
              </label>
            )}
            {error && <Aviso>{error}</Aviso>}
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={!palabraCorrecta || borrando || (hayLotesProcesando && !aunqueHayaLotes)}
                className="rounded bg-malo px-4 py-2 font-medium text-white disabled:opacity-40"
              >
                {borrando ? "Borrando…" : "Borrar todo definitivamente"}
              </button>
              <button
                type="button"
                disabled={borrando}
                onClick={() => {
                  setAbierto(false);
                  setPalabra("");
                  setError(null);
                }}
                className="rounded border border-borde bg-superficie px-3 py-1.5 font-medium"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </Tarjeta>
  );
}
