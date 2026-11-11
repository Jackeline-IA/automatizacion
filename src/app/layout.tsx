import { Suspense } from "react";
import type { Metadata } from "next";
import { Cascaron } from "@/componentes/Cascaron";
import "./globals.css";

export const metadata: Metadata = {
  title: "Procesador de facturas",
  description: "Lee facturas con OCR, valida sus cifras y genera un Excel por lote.",
};

// Sin next/font/google: el entorno de compilación no siempre tiene acceso a
// internet para descargar las fuentes, así que se usan las del sistema.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {/* El Cascaron lee la ruta actual (para no poner el menú en /login): con
            cacheComponents eso exige estar dentro de un <Suspense>. */}
        <Suspense>
          <Cascaron>{children}</Cascaron>
        </Suspense>
      </body>
    </html>
  );
}
