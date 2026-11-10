"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Muestra el correo de quien inició sesión y el botón para cerrarla. */
export function SesionActual() {
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
      const datos = (await respuesta.json()) as { email: string };
      setCorreo(datos.email);
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
    <p className="flex flex-wrap items-center gap-3 text-sm">
      <span className="opacity-70">{correo ? `Sesión: ${correo}` : "Comprobando la sesión…"}</span>
      <button type="button" onClick={cerrarSesion} className="rounded border border-foreground/30 px-3 py-1">
        Cerrar sesión
      </button>
    </p>
  );
}
