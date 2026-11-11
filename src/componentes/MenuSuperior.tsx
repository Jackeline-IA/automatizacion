"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Motor } from "./Motor";
import { BOTON_SECUNDARIO } from "./ui";

const ENLACES = [
  { href: "/", texto: "Procesar facturas" },
  { href: "/metricas", texto: "Métricas" },
];

/** «Procesar facturas» también queda resaltado en el detalle de un lote. */
function estaActivo(href: string, ruta: string): boolean {
  return href === "/" ? ruta === "/" || ruta.startsWith("/procesos") : ruta.startsWith(href);
}

export function MenuSuperior() {
  const ruta = usePathname();
  const router = useRouter();
  const [correo, setCorreo] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    async function cargar() {
      const respuesta = await fetch("/api/sesion");
      if (!vigente) return;
      if (respuesta.status === 401) {
        // La cookie existe pero ya no vale (caducó o se revocó).
        router.replace("/login");
        return;
      }
      setCorreo(((await respuesta.json()) as { email: string }).email);
    }
    void cargar();
    return () => {
      vigente = false;
    };
  }, [router]);

  async function cerrarSesion() {
    await fetch("/api/sesion", { method: "DELETE" });
    router.replace("/login");
  }

  return (
    <header className="border-b border-borde bg-superficie">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <nav aria-label="Principal" className="flex gap-1">
          {ENLACES.map(({ href, texto }) => {
            const activo = estaActivo(href, ruta);
            return (
              <Link
                key={href}
                href={href}
                aria-current={activo ? "page" : undefined}
                className={`rounded px-3 py-1.5 text-sm font-medium ${activo ? "bg-acento text-sobre-acento" : "text-texto hover:bg-acento-suave"}`}
              >
                {texto}
              </Link>
            );
          })}
        </nav>
        {/* El Motor vive aquí porque el menú no se desmonta al cambiar de página. */}
        <Motor />
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-secundario">{correo ?? "…"}</span>
          <button type="button" onClick={cerrarSesion} className={BOTON_SECUNDARIO}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </header>
  );
}
