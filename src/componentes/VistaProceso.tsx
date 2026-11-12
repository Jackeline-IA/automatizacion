"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FacturaDeLote } from "@/lib/procesamiento/facturas-lote";
import { calcularTasas, loProcesado, revisionManual } from "@/lib/procesamiento/metricas";
import type { ResumenProceso } from "@/lib/procesamiento/proceso";
import { escuchar } from "./eventos";
import { fechaHora, NOMBRE_ESTADO, pesos } from "./formato";
import { Aviso, Barra, BOTON, BOTON_SECUNDARIO, Dato, ENLACE, Insignia, TablaDesplazable, Tarjeta } from "./ui";

/*
 * Detalle de un lote. Mientras procesa, lee el propio documento del lote (con
 * sus contadores) cada 4 s, solo con la pestaña visible. La lista de facturas
 * cuesta ~2 lecturas por factura: se pide UNA vez, cuando el lote termina.
 */

const CADA_MS = 4_000;
type Filtro = "todas" | "aceptada" | "revision";

export function VistaProceso({ id }: { id: string }) {
  const [lote, setLote] = useState<ResumenProceso | null>(null);
  const [facturas, setFacturas] = useState<FacturaDeLote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [regenerando, setRegenerando] = useState<"no" | "si" | "listo" | "error">("no");
  const router = useRouter();

  /** El Excel es una foto del momento en que terminó el lote: esto lo pone al día con las correcciones. */
  async function regenerarExcel() {
    setRegenerando("si");
    try {
      const respuesta = await fetch(`/api/procesos/${id}/regenerar-excel`, { method: "POST" });
      setRegenerando(respuesta.ok ? "listo" : "error");
    } catch {
      setRegenerando("error");
    }
  }

  useEffect(() => {
    let vigente = true;
    let terminado = false;
    let facturasPedidas = false;

    async function cargarFacturas() {
      facturasPedidas = true;
      try {
        const respuesta = await fetch(`/api/procesos/${id}/facturas`);
        if (!respuesta.ok) throw new Error();
        const cuerpo = (await respuesta.json()) as { facturas: FacturaDeLote[] };
        if (vigente) setFacturas(cuerpo.facturas);
      } catch {
        if (vigente) setError("No se pudo cargar la lista de facturas. Recarga la página.");
      }
    }

    async function cargar() {
      try {
        const respuesta = await fetch(`/api/procesos/${id}`);
        if (!vigente) return;
        if (respuesta.status === 401) {
          router.replace("/login");
          return;
        }
        if (respuesta.status === 404) {
          terminado = true; // no hay nada que seguir consultando
          setError("Este lote no existe (o se borró).");
          return;
        }
        if (!respuesta.ok) throw new Error();
        const nuevo = (await respuesta.json()) as ResumenProceso;
        if (!vigente) return;
        setLote(nuevo);
        setError(null);
        terminado = nuevo.estado === "terminado";
        if (terminado && !facturasPedidas) void cargarFacturas();
      } catch {
        if (vigente) setError("No se pudo consultar el lote. Se reintentará sola.");
      }
    }

    void cargar();
    const reloj = setInterval(() => {
      if (!terminado && document.visibilityState === "visible") void cargar();
    }, CADA_MS);
    // Cuando el motor cierra este lote, se refresca al instante.
    const dejar = escuchar("lote-terminado", (terminadoId) => {
      if (terminadoId === id) void cargar();
    });
    return () => {
      vigente = false;
      clearInterval(reloj);
      dejar();
    };
  }, [id, router]);

  if (!lote) return error ? <Aviso>{error}</Aviso> : <p className="text-sm text-secundario">Cargando el lote…</p>;

  const m = lote.metricas;
  const tasas = calcularTasas(m);
  const procesado = loProcesado(m);
  const revision = revisionManual(m);
  const hechas = tasas.procesadas + m.duplicadas;
  const visibles = (facturas ?? []).filter((f) => filtro === "todas" || f.estado === filtro);

  return (
    <div className="flex flex-col gap-4">
      {error && <Aviso>{error}</Aviso>}

      <Tarjeta>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{lote.carpeta}</h1>
          <Insignia tono={lote.estado === "terminado" ? "bueno" : "neutro"}>{NOMBRE_ESTADO[lote.estado]}</Insignia>
          {lote.tieneExcel && (
            <a href={`/api/procesos/${lote.id}/excel`} className={`${BOTON} ml-auto text-sm`}>
              Descargar Excel
            </a>
          )}
        </div>
        <p className="mt-1 text-sm text-secundario">
          Iniciado el {fechaHora(lote.inicio)}
          {lote.fin !== null && ` · terminado el ${fechaHora(lote.fin)}`}
        </p>
        <p className="cifras mt-4 mb-1 text-sm">
          {hechas} de {lote.totalArchivos} imagen(es) procesadas
        </p>
        <Barra valor={hechas} maximo={lote.totalArchivos} etiqueta="Avance del lote" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Insignia tono="bueno">{m.aceptadas.n} leída(s) correctamente</Insignia>
          <Insignia tono="malo">{tasas.malLeidas} a revisión</Insignia>
          {revision.revisadas > 0 && <Insignia tono="bueno">{revision.revisadas} revisada(s) a mano</Insignia>}
          <Insignia tono="neutro">{m.duplicadas} duplicada(s)</Insignia>
          <Insignia tono="neutro">{m.clientesNuevos} cliente(s) nuevo(s)</Insignia>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Lo procesado">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Dato etiqueta="Antes de IVA" valor={pesos(procesado.subtotal)} />
          <Dato etiqueta="IVA" valor={pesos(procesado.iva)} />
          <Dato etiqueta="Impoconsumo" valor={pesos(procesado.impoconsumo)} />
          <Dato etiqueta="Total" valor={pesos(procesado.total)} />
        </div>
        <p className="mt-3 text-xs text-secundario">
          Importes de las facturas leídas correctamente{revision.revisadas > 0 && " y de las revisadas a mano"}.
          {revision.pendientes > 0 &&
            (revision.pendientes === 1 ? " 1 espera revisión y no se suma todavía." : ` ${revision.pendientes} esperan revisión y no se suman todavía.`)}
        </p>
      </Tarjeta>

      {lote.tieneExcel && revision.revisadas > 0 && (
        <Tarjeta>
          <p className="text-sm">
            El Excel se generó cuando el lote terminó. Si corregiste facturas después, regenéralo para que las incluya.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={regenerarExcel} disabled={regenerando === "si"} className={BOTON_SECUNDARIO}>
              {regenerando === "si" ? "Regenerando…" : "Regenerar el Excel con las correcciones a mano"}
            </button>
            {regenerando === "listo" && (
              <p className="text-sm text-bueno">
                ✓ Excel actualizado.{" "}
                <a href={`/api/procesos/${lote.id}/excel`} className={ENLACE}>
                  Descargarlo
                </a>
              </p>
            )}
            {regenerando === "error" && <p className="text-sm text-malo">✕ No se pudo regenerar. Inténtalo de nuevo.</p>}
          </div>
        </Tarjeta>
      )}

      <Tarjeta titulo="Facturas del lote">
        {lote.estado !== "terminado" ? (
          <p className="text-sm text-secundario">La lista aparece cuando el lote termina de procesarse.</p>
        ) : facturas === null ? (
          <p className="text-sm text-secundario">Cargando las facturas…</p>
        ) : (
          <>
            <label className="mb-3 flex flex-col gap-1 self-start text-sm">
              Mostrar
              <select
                value={filtro}
                onChange={(e) => setFiltro(e.target.value as Filtro)}
                className="w-fit rounded border border-borde bg-superficie px-3 py-2 text-base"
              >
                <option value="todas">Todas ({facturas.length})</option>
                <option value="aceptada">Leídas correctamente ({facturas.filter((f) => f.estado === "aceptada").length})</option>
                <option value="revision">A revisión ({facturas.filter((f) => f.estado === "revision").length})</option>
              </select>
            </label>
            <TablaDesplazable>
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="text-xs text-secundario">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Archivo</th>
                    <th className="py-2 pr-3 font-medium">Número</th>
                    <th className="py-2 pr-3 font-medium">Fecha</th>
                    <th className="py-2 pr-3 font-medium">Proveedor</th>
                    <th className="py-2 pr-3 font-medium">Cliente</th>
                    <th className="py-2 pr-3 text-right font-medium">Antes de IVA</th>
                    <th className="py-2 pr-3 text-right font-medium">IVA</th>
                    <th className="py-2 pr-3 text-right font-medium">Impoconsumo</th>
                    <th className="py-2 pr-3 text-right font-medium">Total</th>
                    <th className="py-2 pr-3 font-medium">Estado</th>
                    <th className="py-2 font-medium">Imagen</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f, i) => (
                    <tr key={`${f.archivo}-${i}`} className="border-t border-borde align-top">
                      <td className="py-2 pr-3">{f.archivo}</td>
                      <td className="cifras py-2 pr-3 whitespace-nowrap">{f.numero ?? "—"}</td>
                      <td className="cifras py-2 pr-3 whitespace-nowrap">{f.fecha ?? "—"}</td>
                      <td className="py-2 pr-3">{f.proveedor ?? "—"}</td>
                      <td className="py-2 pr-3">{f.clienteNombre ?? "—"}</td>
                      <td className="cifras py-2 pr-3 text-right">{pesos(f.subtotal)}</td>
                      <td className="cifras py-2 pr-3 text-right">{pesos(f.iva)}</td>
                      <td className="cifras py-2 pr-3 text-right">{pesos(f.impoconsumo)}</td>
                      <td className="cifras py-2 pr-3 text-right">{pesos(f.total)}</td>
                      <td className="py-2 pr-3">
                        {f.estado === "aceptada" && f.corregidaManualmente ? (
                          <Insignia tono="bueno">Revisada a mano</Insignia>
                        ) : f.estado === "aceptada" ? (
                          <Insignia tono="bueno">Correcta</Insignia>
                        ) : f.estado === "revision" ? (
                          <>
                            <Insignia tono="malo">Revisión</Insignia>
                            {f.hash && (
                              <p className="mt-1 text-xs">
                                <Link href={`/revision/${f.hash}`} className={ENLACE}>
                                  Revisar
                                </Link>
                              </p>
                            )}
                          </>
                        ) : (
                          <Insignia tono="malo">Error</Insignia>
                        )}
                        {f.resultado === "duplicada" && <p className="mt-1 text-xs text-secundario">Ya estaba guardada</p>}
                        {(f.motivos.length > 0 || f.error) && (
                          <ul className="mt-1 max-w-xs text-xs text-secundario">
                            {f.motivos.map((motivo) => (
                              <li key={motivo}>{motivo}</li>
                            ))}
                            {f.estado === null && f.error && <li>{f.error}</li>}
                          </ul>
                        )}
                      </td>
                      <td className="py-2">
                        {f.hash ? (
                          <a href={`/api/facturas/${f.hash}/imagen`} target="_blank" rel="noreferrer" className={ENLACE}>
                            Ver
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TablaDesplazable>
          </>
        )}
      </Tarjeta>

      <p className="text-sm">
        <Link href="/" className={ENLACE}>
          ← Volver a «Procesar facturas»
        </Link>
      </p>
    </div>
  );
}
