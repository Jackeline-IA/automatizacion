import type { ResumenProceso } from "@/lib/procesamiento/proceso";
import { calcularTasas, sumarMetricas } from "@/lib/procesamiento/metricas";
import { pesos } from "./formato";
import { Dato, Insignia } from "./ui";

/** Cifras acumuladas de unos lotes mientras se procesan: sale de sus contadores, sin leer facturas. */
export function ResumenEnVivo({ lotes }: { lotes: ResumenProceso[] }) {
  const suma = sumarMetricas(lotes.map((lote) => lote.metricas));
  const tasas = calcularTasas(suma);
  return (
    <div className="flex flex-col gap-3 rounded border border-borde p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Lo procesado hasta ahora</span>
        <Insignia tono="bueno">{tasas.correctas} leída(s) correctamente</Insignia>
        {tasas.malLeidas > 0 && <Insignia tono="malo">{tasas.malLeidas} a revisión</Insignia>}
        {suma.duplicadas > 0 && <Insignia tono="neutro">{suma.duplicadas} duplicada(s)</Insignia>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Dato etiqueta="Antes de IVA" valor={pesos(suma.aceptadas.subtotal)} />
        <Dato etiqueta="IVA" valor={pesos(suma.aceptadas.iva)} />
        <Dato etiqueta="Impoconsumo" valor={pesos(suma.aceptadas.impoconsumo)} />
        <Dato etiqueta="Total" valor={pesos(suma.aceptadas.total)} />
      </div>
      <p className="text-xs text-secundario">Importes de las facturas leídas correctamente. Las que van a revisión no se suman aquí.</p>
    </div>
  );
}
