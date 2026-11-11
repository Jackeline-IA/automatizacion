"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MenuSuperior } from "./MenuSuperior";

/**
 * El marco de todas las páginas: pone el menú superior (y con él, el Motor) en
 * todas menos /login. Está en el layout raíz, así que el menú no se desmonta al
 * navegar entre páginas.
 */
export function Cascaron({ children }: { children: ReactNode }) {
  const ruta = usePathname();
  if (ruta.startsWith("/login")) return <>{children}</>;
  return (
    <>
      <MenuSuperior />
      {children}
    </>
  );
}
