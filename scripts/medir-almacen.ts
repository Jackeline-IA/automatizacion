/*
 * Fase D — Cuánto ocupa el almacén de archivos (Supabase Storage), para la nota de cuota.
 *
 * Uso: npx tsx scripts/medir-almacen.ts
 *
 * SOLO LECTURA: lista el bucket y suma tamaños por carpeta de primer nivel y por
 * tipo (imágenes y Excel). No borra ni escribe nada; nunca imprime claves.
 */
import { createClient } from "@supabase/supabase-js";

const POR_PAGINA = 1000;

function leer(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new Error(`Falta la variable ${nombre} en .env`);
  return valor;
}

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const almacen = createClient(leer("NEXT_PUBLIC_SUPABASE_URL"), leer("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(leer("SUPABASE_BUCKET"));

  /** Archivos bajo una carpeta, recorriendo subcarpetas (Supabase devuelve las carpetas sin metadata). */
  async function recorrer(carpeta: string): Promise<{ ruta: string; bytes: number }[]> {
    const archivos: { ruta: string; bytes: number }[] = [];
    for (let offset = 0; ; offset += POR_PAGINA) {
      const { data, error } = await almacen.list(carpeta, { limit: POR_PAGINA, offset });
      if (error) throw new Error(`No se pudo listar ${carpeta || "la raíz"}: ${error.message}`);
      for (const entrada of data) {
        const ruta = carpeta ? `${carpeta}/${entrada.name}` : entrada.name;
        if (entrada.metadata === null) archivos.push(...(await recorrer(ruta)));
        else archivos.push({ ruta, bytes: Number(entrada.metadata?.size ?? 0) });
      }
      if (data.length < POR_PAGINA) return archivos;
    }
  }

  const archivos = await recorrer("");
  const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`);
  const resumir = (lista: typeof archivos) => `${lista.length} archivo(s), ${mb(lista.reduce((s, a) => s + a.bytes, 0))}`;

  console.log(`Bucket completo: ${resumir(archivos)}`);
  const porCarpeta = new Map<string, typeof archivos>();
  for (const archivo of archivos) {
    const raiz = archivo.ruta.includes("/") ? archivo.ruta.slice(0, archivo.ruta.indexOf("/")) : "(raíz)";
    porCarpeta.set(raiz, [...(porCarpeta.get(raiz) ?? []), archivo]);
  }
  for (const [carpeta, lista] of porCarpeta) console.log(`  ${carpeta}/: ${resumir(lista)}`);
  const lotes = new Set(archivos.filter((a) => a.ruta.startsWith("procesos/")).map((a) => a.ruta.split("/")[1]));
  console.log(`  Lotes con archivos: ${lotes.size}`);
  console.log(`  Imágenes: ${resumir(archivos.filter((a) => /\.(png|jpe?g)$/i.test(a.ruta)))}`);
  console.log(`  Excel: ${resumir(archivos.filter((a) => a.ruta.endsWith(".xlsx")))}`);
}

main().catch((error: unknown) => {
  console.error(`ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
