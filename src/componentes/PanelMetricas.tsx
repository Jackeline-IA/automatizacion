"use client";

import { useState } from "react";
import Link from "next/link";
import { calcularTasas, proveedoresOrdenados, sumarMetricas } from "@/lib/procesamiento/metricas";
import { entero, fechaHora, NOMBRE_ESTADO, pesos } from "./formato";
import { Aviso, Barra, Dato, ENLACE, Insignia, Medidor, TablaDesplazable, Tarjeta } from "./ui";
import { useMetricas } from "./useMetricas";

const TODOS = "todos";

/** Panel de métricas: por lote o de todos los lotes. Sale de los contadores de cada lote (1 lectura por lote). */
export function PanelMetricas() {
  const { datos, error } = useMetricas();
  const [elegido, setElegido] = useState(TODOS);

  if (!datos) return error ? <Aviso>{error}</Aviso> : <p className="text-sm text-secundario">Cargando métricas…</p>;

  const { lotes } = datos;
  // Numeración estable: «Lote 1» es el más antiguo.
  const numero = new Map([...lotes].reverse().map((lote, i) => [lote.id, i + 1]));
  const visibles = elegido === TODOS ? lotes : lotes.filter((lote) => lote.id === elegido);
  const suma = sumarMetricas(visibles.map((lote) => lote.metricas));
  const tasas = calcularTasas(suma);
  const proveedores = proveedoresOrdenados(suma);
  const mayorProveedor = proveedores[0]?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {error && <Aviso>{error}</Aviso>}

      <label className="flex flex-col gap-1 self-start text-sm">
        Qué mostrar
        <select
          value={elegido}
          onChange={(e) => setElegido(e.target.value)}
          className="rounded border border-borde bg-superficie px-3 py-2 text-base"
        >
          <option value={TODOS}>Todos los lotes</option>
          {lotes.map((lote) => (
            <option key={lote.id} value={lote.id}>
              Lote {numero.get(lote.id)} — {lote.carpeta} ({fechaHora(lote.inicio)})
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <Medidor
          titulo="Leídas correctamente"
          tono="bueno"
          porcentaje={tasas.porcentajeCorrectas}
          cuenta={tasas.correctas}
          total={tasas.procesadas}
          nota="Pasaron todas las validaciones. No se comparan con una respuesta conocida: un error que cuadre aritméticamente podría pasar."
        />
        <Medidor
          titulo="Mal leídas (a revisión)"
          tono="malo"
          porcentaje={tasas.porcentajeMalLeidas}
          cuenta={tasas.malLeidas}
          total={tasas.procesadas}
          nota="Quedaron en revisión o dieron error. No se pierden: esperan a que una persona las revise."
        />
      </div>

      <Tarjeta>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Dato etiqueta="Facturas procesadas (distintas)" valor={entero(tasas.procesadas)} />
          <Dato etiqueta="Duplicadas (ya estaban; no cuentan en los porcentajes)" valor={entero(suma.duplicadas)} />
          <Dato etiqueta="Clientes en la base" valor={entero(datos.clientes)} />
        </div>
      </Tarjeta>

      <Tarjeta titulo="Lo procesado">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Dato etiqueta="Antes de IVA" valor={pesos(suma.aceptadas.subtotal)} />
          <Dato etiqueta="IVA" valor={pesos(suma.aceptadas.iva)} />
          <Dato etiqueta="Impoconsumo" valor={pesos(suma.aceptadas.impoconsumo)} />
          <Dato etiqueta="Total" valor={pesos(suma.aceptadas.total)} />
        </div>
        <p className="mt-3 text-sm text-secundario">
          Importes de las {entero(suma.aceptadas.n)} factura(s) leídas correctamente.
          {suma.revision.n > 0 &&
            ` Hay ${entero(suma.revision.n)} en revisión que no se suman aquí (lo que se alcanzó a leer de ellas da ${pesos(suma.revision.total)}).`}
        </p>
      </Tarjeta>

      <Tarjeta titulo="Por razón social">
        {proveedores.length === 0 ? (
          <p className="text-sm text-secundario">Aún no hay facturas leídas correctamente.</p>
        ) : (
          <TablaDesplazable>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-secundario">
                <tr>
                  <th className="py-2 pr-3 font-medium">Razón social</th>
                  <th className="py-2 pr-3 font-medium">NIT</th>
                  <th className="py-2 pr-3 text-right font-medium">Facturas</th>
                  <th className="py-2 pr-3 text-right font-medium">Antes de IVA</th>
                  <th className="py-2 pr-3 text-right font-medium">IVA</th>
                  <th className="py-2 pr-3 text-right font-medium">Impoconsumo</th>
                  <th className="py-2 pr-3 text-right font-medium">Total</th>
                  <th className="w-28 py-2 font-medium">Proporción</th>
                </tr>
              </thead>
              <tbody>
                {proveedores.map((p) => (
                  <tr key={p.nit} className="border-t border-borde">
                    <td className="py-2 pr-3">{p.nombre}</td>
                    <td className="cifras py-2 pr-3">{p.nit}</td>
                    <td className="cifras py-2 pr-3 text-right">{p.n}</td>
                    <td className="cifras py-2 pr-3 text-right">{pesos(p.subtotal)}</td>
                    <td className="cifras py-2 pr-3 text-right">{pesos(p.iva)}</td>
                    <td className="cifras py-2 pr-3 text-right">{pesos(p.impoconsumo)}</td>
                    <td className="cifras py-2 pr-3 text-right">{pesos(p.total)}</td>
                    <td className="py-2">
                      <Barra valor={p.total} maximo={mayorProveedor} etiqueta={`Proporción de ${p.nombre}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TablaDesplazable>
        )}
        <p className="mt-3 text-xs text-secundario">Solo facturas leídas correctamente: en las de revisión el NIT puede estar mal leído.</p>
      </Tarjeta>

      <Tarjeta titulo="Por lote">
        {lotes.length === 0 ? (
          <p className="text-sm text-secundario">Todavía no hay lotes.</p>
        ) : (
          <TablaDesplazable>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-secundario">
                <tr>
                  <th className="py-2 pr-3 font-medium">Lote</th>
                  <th className="py-2 pr-3 font-medium">Correctas</th>
                  <th className="py-2 pr-3 font-medium">Mal leídas</th>
                  <th className="w-32 py-2 pr-3 font-medium">Reparto</th>
                  <th className="py-2 pr-3 text-right font-medium">Total aceptado</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 font-medium">Abrir</th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((lote) => {
                  const t = calcularTasas(lote.metricas);
                  return (
                    <tr key={lote.id} className="border-t border-borde">
                      <td className="py-2 pr-3">
                        Lote {numero.get(lote.id)} <span className="text-secundario">· {lote.carpeta}</span>
                      </td>
                      <td className="cifras py-2 pr-3 whitespace-nowrap">
                        ✓ {t.correctas} ({t.porcentajeCorrectas} %)
                      </td>
                      <td className="cifras py-2 pr-3 whitespace-nowrap">
                        ✕ {t.malLeidas} ({t.porcentajeMalLeidas} %)
                      </td>
                      <td className="py-2 pr-3">
                        {/* Barra fina de dos tramos: correctas y mal leídas. Las cifras están en las dos columnas anteriores. */}
                        <div className="flex h-1.5 w-full overflow-hidden rounded bg-acento-suave" aria-hidden="true">
                          <div className="bg-bueno" style={{ width: `${t.porcentajeCorrectas}%` }} />
                          <div className="bg-malo" style={{ width: `${t.porcentajeMalLeidas}%` }} />
                        </div>
                      </td>
                      <td className="cifras py-2 pr-3 text-right">{pesos(lote.metricas.aceptadas.total)}</td>
                      <td className="py-2 pr-3">
                        <Insignia tono={lote.estado === "terminado" ? "bueno" : "neutro"}>{NOMBRE_ESTADO[lote.estado]}</Insignia>
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <Link href={`/procesos/${lote.id}`} className={ENLACE}>
                          Detalle
                        </Link>
                        {lote.tieneExcel && (
                          <>
                            {" · "}
                            <a href={`/api/procesos/${lote.id}/excel`} className={ENLACE}>
                              Excel
                            </a>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TablaDesplazable>
        )}
      </Tarjeta>
    </div>
  );
}
