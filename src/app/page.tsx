import { NuevoProceso } from "@/componentes/NuevoProceso";
import { SesionActual } from "@/componentes/SesionActual";

// Por ahora solo sube las imágenes; procesarlas llega en la Fase 6 y el resto de
// la pantalla (avance, métricas), en la Fase 8.
export default function Inicio() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">Procesador de facturas</h1>
      <SesionActual />
      <NuevoProceso />
      <p className="text-sm opacity-70">
        Diagnóstico del despliegue: <a className="underline" href="/api/salud">/api/salud</a>
      </p>
    </main>
  );
}
