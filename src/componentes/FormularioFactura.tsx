"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  camposDesdePrecarga,
  entradaDesdeCampos,
  leerEntero,
  motivosCorreccion,
  proponerTotales,
  subtotalItem,
  type CamposFormulario,
  type ItemCampos,
} from "@/lib/procesamiento/correccion";
import { erroresDeFormato, esquemaCorreccion } from "@/lib/procesamiento/correccion-esquema";
import type { DetalleRevision, PendienteRevision } from "@/lib/procesamiento/corregir";
import { TARIFA_IMPOCONSUMO } from "@/lib/ocr/constantes";
import { emitir } from "./eventos";
import { fechaHora, pesos } from "./formato";
import { Aviso, BOTON, BOTON_SECUNDARIO, ENLACE, Insignia, TablaDesplazable, Tarjeta } from "./ui";

/*
 * Formulario de revisión manual (Fase 9): la imagen original a la izquierda y lo
 * que leyó la máquina a la derecha, para completarlo o corregirlo.
 *
 * La validación en vivo usa las MISMAS funciones que el servidor (formato con zod
 * y las reglas del OCR). La persona es la autoridad: si algo no cuadra puede
 * guardar de todos modos, pero tiene que confirmarlo y queda constancia.
 */

const GIROS = [0, 90, 180, 270] as const;
type Giro = (typeof GIROS)[number];

const CAMPO = "w-full rounded border border-borde bg-superficie px-2 py-1.5 text-base";

/** Un número escrito, o null si no es un entero (para los cálculos de la pantalla). */
function numeroONull(texto: string): number | null {
  const valor = leerEntero(texto);
  return valor === null || Number.isNaN(valor) ? null : valor;
}

function Campo({
  etiqueta,
  valor,
  alCambiar,
  tipo = "text",
  modo,
  className = "",
  ayuda,
}: {
  etiqueta: string;
  valor: string;
  alCambiar: (valor: string) => void;
  tipo?: "text" | "date";
  modo?: "numeric" | "text";
  className?: string;
  ayuda?: string;
}) {
  const id = useId();
  // La ayuda va FUERA de la etiqueta (aria-describedby): dentro, formaría parte del
  // nombre del campo («Número Por ejemplo FE-000123») para un lector de pantalla.
  return (
    <div className={`flex flex-col gap-1 text-sm ${className}`}>
      <label htmlFor={id}>{etiqueta}</label>
      <input
        id={id}
        type={tipo}
        inputMode={modo}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        className={`${CAMPO} ${modo === "numeric" ? "cifras" : ""}`}
      />
      {ayuda && (
        <span id={`${id}-ayuda`} className="text-xs text-secundario">
          {ayuda}
        </span>
      )}
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-borde p-3">
      <legend className="px-1 text-sm font-semibold">{titulo}</legend>
      {children}
    </fieldset>
  );
}

export function FormularioFactura({ hash }: { hash: string }) {
  const router = useRouter();
  const [detalle, setDetalle] = useState<DetalleRevision | null>(null);
  const [campos, setCampos] = useState<CamposFormulario | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  // Qué motivos confirmó la persona: si cambian, la confirmación deja de valer.
  const [confirmadoPara, setConfirmadoPara] = useState<string | null>(null);
  const [giro, setGiro] = useState<Giro>(0);
  const [zoom, setZoom] = useState(100);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; lista: string[] } | null>(null);
  const [guardada, setGuardada] = useState(false);

  useEffect(() => {
    let vigente = true;
    async function cargar() {
      try {
        const respuesta = await fetch(`/api/facturas/${hash}`);
        if (!vigente) return;
        if (respuesta.status === 401) {
          router.replace("/login");
          return;
        }
        if (respuesta.status === 404) {
          setErrorCarga("Esta factura no existe (o se borró).");
          return;
        }
        if (!respuesta.ok) throw new Error();
        const cuerpo = (await respuesta.json()) as DetalleRevision;
        if (!vigente) return;
        setDetalle(cuerpo);
        setCampos(camposDesdePrecarga(cuerpo.precarga));
      } catch {
        if (vigente) setErrorCarga("No se pudo cargar la factura. Recarga la página.");
      }
    }
    void cargar();
    return () => {
      vigente = false;
    };
  }, [hash, router]);

  if (errorCarga) return <Aviso>{errorCarga}</Aviso>;
  if (!detalle || !campos) return <p className="text-sm text-secundario">Cargando la factura…</p>;

  // --- Validación en vivo, con las mismas reglas del servidor ---
  const errores = erroresDeFormato(entradaDesdeCampos(campos, false));
  const motivos = errores.length === 0 ? motivosCorreccion(esquemaCorreccion.parse(entradaDesdeCampos(campos, false))) : [];
  const claveMotivos = motivos.join("|");
  const confirmado = motivos.length > 0 && confirmadoPara === claveMotivos;
  const sePuedeGuardar = errores.length === 0 && (motivos.length === 0 || confirmado) && !guardando && !guardada;

  const cambiar = (cambios: Partial<CamposFormulario>) => {
    setCampos({ ...campos, ...cambios });
    setMensaje(null);
  };
  const cambiarItem = (indice: number, cambios: Partial<ItemCampos>) =>
    cambiar({ items: campos.items.map((item, i) => (i === indice ? { ...item, ...cambios } : item)) });

  const itemsNumericos = campos.items.map((item) => ({ cantidad: numeroONull(item.cantidad), precioUnitario: numeroONull(item.precioUnitario) }));

  function recalcular() {
    const propuesta = proponerTotales(itemsNumericos, campos!.llevaImpoconsumo);
    cambiar({
      subtotal: String(propuesta.subtotal),
      iva: String(propuesta.iva),
      impoconsumo: propuesta.impoconsumo === null ? "" : String(propuesta.impoconsumo),
      total: String(propuesta.total),
    });
  }

  function marcarImpoconsumo(lleva: boolean) {
    const subtotal = numeroONull(campos!.subtotal);
    // Al marcarlo se propone el 4 % del subtotal; el total se ajusta con «Recalcular».
    const impoconsumo = lleva && campos!.impoconsumo === "" && subtotal !== null ? String(Math.round(subtotal * TARIFA_IMPOCONSUMO)) : campos!.impoconsumo;
    cambiar({ llevaImpoconsumo: lleva, impoconsumo });
  }

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    try {
      const respuesta = await fetch(`/api/facturas/${hash}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entradaDesdeCampos(campos!, confirmado)),
      });
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string; errores?: string[]; motivos?: string[] };
      if (respuesta.status === 401) {
        router.replace("/login");
        return;
      }
      if (!respuesta.ok) {
        setMensaje({ texto: cuerpo.error ?? "No se pudo guardar. Inténtalo de nuevo.", lista: cuerpo.errores ?? cuerpo.motivos ?? [] });
        return;
      }
      setGuardada(true);
      emitir("revision-guardada", detalle!.procesoId);
      // Siguiente pendiente (la que se acaba de guardar ya no está en la lista).
      const lista = await fetch("/api/facturas");
      const { pendientes } = lista.ok ? ((await lista.json()) as { pendientes: PendienteRevision[] }) : { pendientes: [] };
      const siguiente = pendientes.find((p) => p.hash !== hash);
      router.push(siguiente ? `/revision/${siguiente.hash}` : "/revision");
    } catch {
      setMensaje({ texto: "No se pudo conectar con el servidor. Inténtalo de nuevo.", lista: [] });
    } finally {
      setGuardando(false);
    }
  }

  const girar = (pasos: 1 | -1) => setGiro(GIROS[(GIROS.indexOf(giro) + pasos + GIROS.length) % GIROS.length]);
  const srcImagen = `/api/facturas/${hash}/imagen${giro === 0 ? "" : `?rotar=${giro}`}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold">Revisar {detalle.archivo}</h1>
        <Link href="/revision" className={`${ENLACE} text-sm`}>
          ← Volver a la lista
        </Link>
        <Link href={`/procesos/${detalle.procesoId}`} className={`${ENLACE} text-sm`}>
          Ver su lote
        </Link>
      </div>

      {!detalle.editable ? (
        <Tarjeta>
          <p className="text-sm">
            <Insignia tono="bueno">Leída correctamente</Insignia> Esta factura la aceptó la máquina: no necesita revisión.
          </p>
        </Tarjeta>
      ) : (
        // Más ancho para los datos (los ítems necesitan espacio); la imagen tiene zoom.
        <div className="grid items-start gap-4 lg:grid-cols-[5fr_7fr]">
          {/* --- Imagen original --- */}
          <Tarjeta className="lg:sticky lg:top-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => girar(-1)} className={BOTON_SECUNDARIO} aria-label="Girar a la izquierda">
                ↺ Girar
              </button>
              <button type="button" onClick={() => girar(1)} className={BOTON_SECUNDARIO} aria-label="Girar a la derecha">
                Girar ↻
              </button>
              <label className="ml-auto flex items-center gap-2 text-sm">
                Zoom
                <input type="range" min={50} max={300} step={25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="accent-acento" />
                <span className="cifras w-12 text-right">{zoom} %</span>
              </label>
            </div>
            <div className="max-h-[75vh] overflow-auto rounded border border-borde bg-fondo">
              {/* <img> y no next/image: la imagen es privada y la sirve nuestra API con la cookie de sesión;
                  el optimizador de next/image la pediría sin cookie y recibiría 401. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={srcImagen} alt={`Imagen original de ${detalle.archivo}`} data-prueba="imagen-factura" style={{ width: `${zoom}%`, maxWidth: "none" }} />
            </div>
            <div className="mt-3 text-sm">
              <p className="font-medium">Lo que dijo la máquina</p>
              {detalle.motivosOriginales.length === 0 ? (
                <p className="text-secundario">Sin motivos registrados.</p>
              ) : (
                <ul className="mt-1 list-disc pl-5 text-secundario">
                  {detalle.motivosOriginales.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
              {detalle.confianzaOcr !== null && <p className="mt-1 text-xs text-secundario">Confianza del OCR: {Math.round(detalle.confianzaOcr)} %</p>}
            </div>
          </Tarjeta>

          {/* --- Datos --- */}
          <div className="flex flex-col gap-4">
            {detalle.corregidaManualmente && (
              <p className="rounded bg-acento-suave px-3 py-2 text-sm">
                Ya la revisó {detalle.corregidaPor ?? "una persona"}
                {detalle.corregidaEn !== null && ` el ${fechaHora(detalle.corregidaEn)}`}. Si la guardas otra vez, se reemplazan sus datos y los
                contadores se ajustan solo con las diferencias.
              </p>
            )}

            <Grupo titulo="Factura">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Número" valor={campos.numero} alCambiar={(v) => cambiar({ numero: v })} ayuda="Por ejemplo FE-000123" />
                <Campo etiqueta="Fecha de emisión" tipo="date" valor={campos.fecha} alCambiar={(v) => cambiar({ fecha: v })} />
              </div>
            </Grupo>

            <Grupo titulo="Proveedor">
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem_4rem]">
                <Campo etiqueta="Razón social" valor={campos.proveedor} alCambiar={(v) => cambiar({ proveedor: v })} />
                <Campo etiqueta="NIT del proveedor" modo="numeric" valor={campos.nitProveedor} alCambiar={(v) => cambiar({ nitProveedor: v })} />
                <Campo etiqueta="DV" modo="numeric" valor={campos.dvProveedor} alCambiar={(v) => cambiar({ dvProveedor: v })} />
              </div>
              <p className="mt-2 text-xs text-secundario">El NIT va sin puntos, sin guion y sin el dígito de verificación (DV), que va aparte.</p>
            </Grupo>

            <Grupo titulo="Cliente">
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem_6.5rem]">
                <Campo etiqueta="Nombre del cliente" valor={campos.clienteNombre} alCambiar={(v) => cambiar({ clienteNombre: v })} />
                <Campo etiqueta="Documento del cliente" modo="numeric" valor={campos.clienteDocumento} alCambiar={(v) => cambiar({ clienteDocumento: v })} />
                <Campo etiqueta="DV del cliente" modo="numeric" valor={campos.clienteDv} alCambiar={(v) => cambiar({ clienteDv: v })} />
              </div>
              <p className="mt-2 text-xs text-secundario">El cliente se identifica por su documento: si el DV no es válido, la factura se guarda pero no se crea el cliente.</p>
            </Grupo>

            <Grupo titulo="Ítems">
              <TablaDesplazable>
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="text-xs text-secundario">
                    <tr>
                      <th className="pb-1 pr-2 font-medium">Descripción</th>
                      <th className="w-20 pb-1 pr-2 font-medium">Cantidad</th>
                      <th className="w-28 pb-1 pr-2 font-medium">Precio unitario</th>
                      <th className="w-28 pb-1 pr-2 text-right font-medium">Subtotal</th>
                      <th className="w-8 pb-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {campos.items.map((item, i) => (
                      <tr key={i} className="align-top">
                        <td className="py-1 pr-2">
                          <input
                            aria-label={`Ítem ${i + 1}: descripción`}
                            title={item.descripcion}
                            value={item.descripcion}
                            onChange={(e) => cambiarItem(i, { descripcion: e.target.value })}
                            className={CAMPO}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <input aria-label={`Ítem ${i + 1}: cantidad`} inputMode="numeric" value={item.cantidad} onChange={(e) => cambiarItem(i, { cantidad: e.target.value })} className={`${CAMPO} cifras`} />
                        </td>
                        <td className="py-1 pr-2">
                          <input aria-label={`Ítem ${i + 1}: precio unitario`} inputMode="numeric" value={item.precioUnitario} onChange={(e) => cambiarItem(i, { precioUnitario: e.target.value })} className={`${CAMPO} cifras`} />
                        </td>
                        <td className="cifras py-2.5 pr-2 text-right">{pesos(subtotalItem(itemsNumericos[i].cantidad, itemsNumericos[i].precioUnitario))}</td>
                        <td className="py-1">
                          {/* Siempre queda al menos una fila. */}
                          {campos.items.length > 1 && (
                            <button type="button" onClick={() => cambiar({ items: campos.items.filter((_, j) => j !== i) })} className="px-2 py-1.5 text-malo" aria-label={`Quitar el ítem ${i + 1}`}>
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TablaDesplazable>
              <button type="button" onClick={() => cambiar({ items: [...campos.items, { descripcion: "", cantidad: "", precioUnitario: "" }] })} className={`${BOTON_SECUNDARIO} mt-2`}>
                + Añadir ítem
              </button>
            </Grupo>

            <Grupo titulo="Totales">
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={campos.llevaImpoconsumo} onChange={(e) => marcarImpoconsumo(e.target.checked)} className="accent-acento" />
                La factura trae impoconsumo (telefonía móvil y datos, 4 %)
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Valor antes de IVA" modo="numeric" valor={campos.subtotal} alCambiar={(v) => cambiar({ subtotal: v })} />
                <Campo etiqueta="IVA" modo="numeric" valor={campos.iva} alCambiar={(v) => cambiar({ iva: v })} />
                {campos.llevaImpoconsumo && <Campo etiqueta="Impoconsumo" modo="numeric" valor={campos.impoconsumo} alCambiar={(v) => cambiar({ impoconsumo: v })} />}
                <Campo etiqueta="Total" modo="numeric" valor={campos.total} alCambiar={(v) => cambiar({ total: v })} />
              </div>
              <button type="button" onClick={recalcular} className={`${BOTON_SECUNDARIO} mt-3`}>
                Recalcular desde los ítems
              </button>
              <p className="mt-2 text-xs text-secundario">Propone IVA del 19 % y, si aplica, impoconsumo del 4 %. Si la factura impresa dice otra cosa, escribe lo que dice.</p>
            </Grupo>

            {/* --- Validación y guardado --- */}
            <Tarjeta>
              <div aria-live="polite" className="text-sm">
                {errores.length > 0 ? (
                  <div className="rounded bg-malo-suave px-3 py-2 text-malo">
                    <p className="font-medium">
                      <span aria-hidden="true">✕ </span>Falta completar o corregir:
                    </p>
                    <ul className="mt-1 list-disc pl-5">
                      {errores.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                ) : motivos.length > 0 ? (
                  <div className="rounded bg-malo-suave px-3 py-2 text-malo">
                    <p className="font-medium">
                      <span aria-hidden="true">✕ </span>No cuadra con las reglas de validación:
                    </p>
                    <ul className="mt-1 list-disc pl-5">
                      {motivos.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                    <label className="mt-2 flex items-start gap-2 text-texto">
                      <input
                        type="checkbox"
                        checked={confirmado}
                        onChange={(e) => setConfirmadoPara(e.target.checked ? claveMotivos : null)}
                        className="mt-1 accent-acento"
                      />
                      Revisé la imagen y estos datos son los de la factura (quedará constancia de que se guardó sin cuadrar).
                    </label>
                  </div>
                ) : (
                  <p className="rounded bg-bueno-suave px-3 py-2 text-bueno">
                    <span aria-hidden="true">✓ </span>Todo cuadra con las reglas de validación.
                  </p>
                )}
              </div>

              {mensaje && (
                <div className="mt-3">
                  <Aviso>
                    {mensaje.texto}
                    {mensaje.lista.length > 0 && ` (${mensaje.lista.join("; ")})`}
                  </Aviso>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={guardar} disabled={!sePuedeGuardar} className={BOTON}>
                  {guardando ? "Guardando…" : motivos.length > 0 ? "Guardar de todos modos" : "Guardar"}
                </button>
                {guardada && <p className="text-sm text-bueno">✓ Guardada. Pasando a la siguiente…</p>}
              </div>
            </Tarjeta>
          </div>
        </div>
      )}
    </div>
  );
}
