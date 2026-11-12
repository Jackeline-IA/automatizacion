import { Suspense } from "react";
import { FormularioFactura } from "@/componentes/FormularioFactura";

// Con cacheComponents, `params` es una promesa que solo se puede leer dentro de
// un <Suspense>: por eso se resuelve en este componente aparte.
async function Formulario({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  // key={hash}: al pasar a la siguiente factura React crea un formulario NUEVO.
  // Sin esto reutilizaría el anterior con sus campos, su confirmación y su mensaje,
  // y se podrían guardar los datos de una factura sobre otra.
  return <FormularioFactura key={hash} hash={hash} />;
}

export default function PaginaRevisionFactura({ params }: PageProps<"/revision/[hash]">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
      <Suspense fallback={<p className="text-sm text-secundario">Cargando la factura…</p>}>
        <Formulario params={params} />
      </Suspense>
    </main>
  );
}
