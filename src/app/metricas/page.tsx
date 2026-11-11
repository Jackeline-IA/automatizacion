import { PanelMetricas } from "@/componentes/PanelMetricas";

export default function PaginaMetricas() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Métricas</h1>
      <PanelMetricas />
    </main>
  );
}
