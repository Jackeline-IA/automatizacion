import { ListaRevision } from "@/componentes/ListaRevision";

export default function PaginaRevision() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Revisión manual</h1>
      <ListaRevision />
    </main>
  );
}
