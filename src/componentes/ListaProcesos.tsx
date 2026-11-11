import Link from "next/link";
import type { ResumenProceso } from "@/lib/procesamiento/proceso";
import { calcularTasas } from "@/lib/procesamiento/metricas";
import { fechaHora, NOMBRE_ESTADO, pesos } from "./formato";
import { ENLACE, Insignia, TablaDesplazable, Tarjeta } from "./ui";

/** Los lotes del usuario, del más reciente al más antiguo. */
export function ListaProcesos({ lotes }: { lotes: ResumenProceso[] }) {
  if (lotes.length === 0) {
    return (
      <Tarjeta titulo="Tus lotes">
        <p className="text-sm text-secundario">Todavía no has subido ningún lote.</p>
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo="Tus lotes">
      <TablaDesplazable>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-secundario">
            <tr>
              <th className="py-2 pr-3 font-medium">Carpeta</th>
              <th className="py-2 pr-3 font-medium">Inicio</th>
              <th className="py-2 pr-3 font-medium">Estado</th>
              <th className="py-2 pr-3 text-right font-medium">Facturas</th>
              <th className="py-2 pr-3 text-right font-medium">Total aceptado</th>
              <th className="py-2 font-medium">Abrir</th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((lote) => {
              const tasas = calcularTasas(lote.metricas);
              return (
                <tr key={lote.id} className="border-t border-borde">
                  <td className="py-2 pr-3">{lote.carpeta}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{fechaHora(lote.inicio)}</td>
                  <td className="py-2 pr-3">
                    <Insignia tono={lote.estado === "terminado" ? "bueno" : "neutro"}>{NOMBRE_ESTADO[lote.estado]}</Insignia>
                  </td>
                  <td className="cifras py-2 pr-3 text-right">
                    {tasas.procesadas + lote.metricas.duplicadas} de {lote.totalArchivos}
                  </td>
                  <td className="cifras py-2 pr-3 text-right">{pesos(lote.metricas.aceptadas.total)}</td>
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
    </Tarjeta>
  );
}
