import { Suspense } from "react";
import { VistaProceso } from "@/componentes/VistaProceso";

// Con cacheComponents, `params` es una promesa que solo se puede leer dentro de
// un <Suspense>: por eso se resuelve en este componente aparte.
async function Detalle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VistaProceso id={id} />;
}

export default function PaginaProceso({ params }: PageProps<"/procesos/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
      <Suspense fallback={<p className="text-sm text-secundario">Cargando el lote…</p>}>
        <Detalle params={params} />
      </Suspense>
    </main>
  );
}
