"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PendienteRevision } from "@/lib/procesamiento/corregir";
import { pesos } from "./formato";
import { Aviso, BOTON_SECUNDARIO, Insignia, TablaDesplazable, Tarjeta } from "./ui";

/*
 * Facturas que esperan a una persona (GET /api/facturas: 1 lectura por factura).
 * Se pide una vez al abrir la página, no en cada refresco.
 */
export function ListaRevision() {
  const [pendientes, setPendientes] = useState<PendienteRevision[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let vigente = true;
    async function cargar() {
      try {
        const respuesta = await fetch("/api/facturas");
        if (!vigente) return;
        if (respuesta.status === 401) {
          router.replace("/login");
          return;
        }
        if (!respuesta.ok) throw new Error();
        const cuerpo = (await respuesta.json()) as { pendientes: PendienteRevision[]; hayMas: boolean };
        if (!vigente) return;
        setPendientes(cuerpo.pendientes);
        setHayMas(cuerpo.hayMas);
      } catch {
        if (vigente) setError("No se pudo cargar la lista. Recarga la página.");
      }
    }
    void cargar();
    return () => {
      vigente = false;
    };
  }, [router]);

  if (error) return <Aviso>{error}</Aviso>;
  if (!pendientes) return <p className="text-sm text-secundario">Cargando las facturas pendientes…</p>;

  return (
    <Tarjeta>
      {pendientes.length === 0 ? (
        <p className="text-sm">
          <span aria-hidden="true">✓ </span>
          No hay facturas pendientes de revisión. Todo lo que la máquina no pudo aceptar ya lo revisó una persona.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-secundario">
            {pendientes.length} factura(s) que la máquina no pudo aceptar. Ábrelas una por una: verás la imagen original al lado
            de lo que se alcanzó a leer, para completarlo o corregirlo.
          </p>
          {hayMas && (
            <p className="mb-3 text-sm text-secundario">
              Se muestran las primeras {pendientes.length}; al revisarlas aparecerán las siguientes.
            </p>
          )}
          <TablaDesplazable>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-secundario">
                <tr>
                  <th className="py-2 pr-3 font-medium">Archivo</th>
                  <th className="py-2 pr-3 font-medium">Número</th>
                  <th className="py-2 pr-3 font-medium">Proveedor</th>
                  <th className="py-2 pr-3 text-right font-medium">Total leído</th>
                  <th className="py-2 pr-3 font-medium">Por qué está aquí</th>
                  <th className="py-2 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((p) => (
                  <tr key={p.hash} className="border-t border-borde align-top">
                    <td className="py-2 pr-3">{p.archivo}</td>
                    <td className="cifras py-2 pr-3 whitespace-nowrap">{p.numero ?? "—"}</td>
                    <td className="py-2 pr-3">{p.proveedor ?? "—"}</td>
                    <td className="cifras py-2 pr-3 text-right">{pesos(p.total)}</td>
                    <td className="py-2 pr-3">
                      <Insignia tono="malo">{p.motivos[0] ?? "Sin leer"}</Insignia>
                      {p.motivos.length > 1 && <p className="mt-1 text-xs text-secundario">y {p.motivos.length - 1} motivo(s) más</p>}
                    </td>
                    <td className="py-2">
                      <Link href={`/revision/${p.hash}`} className={BOTON_SECUNDARIO}>
                        Revisar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TablaDesplazable>
        </>
      )}
    </Tarjeta>
  );
}
