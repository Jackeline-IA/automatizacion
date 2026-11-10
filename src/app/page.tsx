// Página provisional de la Fase 1: solo demuestra que el proyecto compila y
// despliega. La pantalla «Procesar facturas» se construye en las Fases 3 y 8.
export default function Inicio() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">Procesador de facturas</h1>
      <p>
        Proyecto base desplegado. Las siguientes fases añaden el inicio de sesión, la subida de
        facturas, la lectura con OCR y las métricas.
      </p>
      <p className="text-sm opacity-70">
        Diagnóstico del despliegue: <a className="underline" href="/api/salud">/api/salud</a>
      </p>
    </main>
  );
}
