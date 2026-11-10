/*
 * Fase 4 — Mide el extractor sobre los textos de OCR guardados por ocr-muestras.ts.
 *
 * Uso: npx tsx scripts/medir-extractor.ts <carpetaTextos>
 *
 * Sin las respuestas correctas (verdad.json) solo se puede medir cuántas
 * facturas pasan TODAS las validaciones. Por eso imprime también lo extraído:
 * hay que compararlo a mano con la imagen. Solo lee archivos; no escribe nada.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extraer } from "../src/lib/ocr/extractor";
import { validar } from "../src/lib/ocr/validador";

const pesos = (n: number | null) => (n === null ? "—" : `$${n.toLocaleString("es-CO")}`);

async function main(): Promise<void> {
  const carpeta = process.argv[2];
  if (!carpeta) {
    console.error("Uso: npx tsx scripts/medir-extractor.ts <carpetaTextos>");
    process.exit(1);
  }
  // Solo la lectura «original»; las otras dos son para los reintentos de la Fase 5.
  const todos = (await readdir(carpeta)).filter((n) => n.endsWith(".txt")).sort();
  const archivos = todos.some((n) => n.endsWith(".original.txt")) ? todos.filter((n) => n.endsWith(".original.txt")) : todos;

  let aceptadas = 0;
  const conteoMotivos = new Map<string, number>();

  for (const archivo of archivos) {
    const f = extraer(await readFile(path.join(carpeta, archivo), "utf8"));
    const motivos = validar(f);
    if (motivos.length === 0) aceptadas += 1;
    for (const m of motivos) {
      const clave = m.replace(/Ítem \d+/, "Ítem N");
      conteoMotivos.set(clave, (conteoMotivos.get(clave) ?? 0) + 1);
    }

    console.log(`${motivos.length === 0 ? "✓ ACEPTADA" : "✕ REVISIÓN"}  ${archivo}`);
    console.log(`    ${f.numero ?? "—"} · ${f.fecha ?? "—"} · ${f.items.length} ítem(s)`);
    console.log(`    proveedor: ${f.proveedor ?? "—"} (${f.nitProveedor ?? "—"}-${f.dvProveedor ?? "—"})`);
    console.log(`    cliente:   ${f.clienteNombre ?? "—"} (${f.clienteDocumento ?? "—"}-${f.clienteDv ?? "—"})`);
    console.log(`    subtotal ${pesos(f.subtotal)} · IVA ${pesos(f.iva)} · impoconsumo ${pesos(f.impoconsumo)} · total ${pesos(f.total)}`);
    for (const m of motivos) console.log(`    motivo: ${m}`);
  }

  const total = archivos.length;
  console.log(`\n${aceptadas} de ${total} aceptadas (${total ? Math.round((aceptadas / total) * 100) : 0} %); ${total - aceptadas} a revisión.`);
  if (conteoMotivos.size > 0) {
    console.log("Motivos de revisión:");
    for (const [motivo, n] of [...conteoMotivos].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${motivo}`);
  }
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
