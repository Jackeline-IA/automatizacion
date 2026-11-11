import type { ReactNode } from "react";

/* Piezas visuales compartidas. Los estados bueno/malo llevan SIEMPRE icono y texto, nunca solo color. */

export const BOTON = "rounded bg-acento px-4 py-2 font-medium text-sobre-acento disabled:opacity-50";
export const BOTON_SECUNDARIO = "rounded border border-borde bg-superficie px-3 py-1.5 text-sm font-medium disabled:opacity-50";
export const ENLACE = "text-acento underline underline-offset-2";

export function Tarjeta({ titulo, children, className = "" }: { titulo?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-borde bg-superficie p-4 ${className}`}>
      {titulo && <h2 className="mb-3 text-lg font-semibold">{titulo}</h2>}
      {children}
    </section>
  );
}

/** Barra de avance o de proporción. `tono` solo cambia el color; el dato va también en texto junto a ella. */
export function Barra({ valor, maximo, tono = "acento", etiqueta }: { valor: number; maximo: number; tono?: "acento" | "bueno" | "malo"; etiqueta: string }) {
  const porcentaje = maximo <= 0 ? 0 : Math.min(100, Math.round((valor / maximo) * 100));
  const color = tono === "bueno" ? "bg-bueno" : tono === "malo" ? "bg-malo" : "bg-acento";
  return (
    <div role="progressbar" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100} aria-valuenow={porcentaje} className="h-2 w-full overflow-hidden rounded bg-acento-suave">
      <div className={`h-full ${color}`} style={{ width: `${porcentaje}%` }} />
    </div>
  );
}

/** Etiqueta de estado con icono + texto. */
export function Insignia({ tono, children }: { tono: "bueno" | "malo" | "neutro"; children: ReactNode }) {
  const estilos = { bueno: "bg-bueno-suave text-bueno", malo: "bg-malo-suave text-malo", neutro: "bg-acento-suave text-texto" }[tono];
  const icono = { bueno: "✓", malo: "✕", neutro: "•" }[tono];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${estilos}`}>
      <span aria-hidden="true">{icono}</span>
      {children}
    </span>
  );
}

/** Medidor grande: porcentaje, barra y «n de total». */
export function Medidor({ titulo, tono, porcentaje, cuenta, total, nota }: { titulo: string; tono: "bueno" | "malo"; porcentaje: number; cuenta: number; total: number; nota: string }) {
  return (
    <Tarjeta>
      <p className={`flex items-center gap-2 text-sm font-medium ${tono === "bueno" ? "text-bueno" : "text-malo"}`}>
        <span aria-hidden="true">{tono === "bueno" ? "✓" : "✕"}</span>
        {titulo}
      </p>
      <p className="cifras my-2 text-4xl font-semibold">{porcentaje} %</p>
      <Barra valor={cuenta} maximo={total} tono={tono} etiqueta={titulo} />
      <p className="cifras mt-2 text-sm">
        {cuenta} de {total} factura(s)
      </p>
      <p className="mt-1 text-xs text-secundario">{nota}</p>
    </Tarjeta>
  );
}

/** Un dato suelto con su etiqueta. */
export function Dato({ etiqueta, valor }: { etiqueta: string; valor: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-secundario">{etiqueta}</p>
      <p className="cifras text-lg font-semibold">{valor}</p>
    </div>
  );
}

/** Contenedor de tablas: en pantallas estrechas la tabla hace scroll horizontal, no la página. */
export function TablaDesplazable({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Aviso({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex gap-2 rounded bg-malo-suave px-3 py-2 text-sm text-malo">
      <span aria-hidden="true">✕</span>
      <span>{children}</span>
    </p>
  );
}
