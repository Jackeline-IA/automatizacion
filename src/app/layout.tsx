import type { Metadata } from "next";
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
