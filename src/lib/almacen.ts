/*
 * Almacén de archivos (Supabase Storage, bucket privado): SOLO servidor.
 *
 * Usa la clave «service role», que se salta todas las políticas de Supabase: por
 * eso no puede llegar al navegador. El navegador nunca habla con el almacén;
 * manda cada imagen a nuestra API, que la valida y es la única que escribe aquí.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Lee una variable obligatoria; el error nombra la variable, nunca su valor. */
function leer(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

// Un cliente por instancia de la función, creado al primer uso (no al importar:
// `next build` importa el módulo sin que las variables existan).
let cliente: SupabaseClient | undefined;

function almacen() {
  cliente ??= createClient(leer("NEXT_PUBLIC_SUPABASE_URL"), leer("SUPABASE_SERVICE_ROLE_KEY"), {
    // Servidor: no hay sesión de usuario de Supabase que guardar ni renovar.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cliente.storage.from(leer("SUPABASE_BUCKET"));
}

const POR_PAGINA = 1000;

/** Rutas completas de las imágenes que hay bajo una carpeta, en orden de nombre. */
export async function listarImagenes(carpeta: string): Promise<string[]> {
  const sinBarra = carpeta.replace(/\/+$/, "");
  const rutas: string[] = [];
  // Supabase devuelve como mucho una página por llamada: se pagina con `offset`.
  for (let offset = 0; ; offset += POR_PAGINA) {
    const { data, error } = await almacen().list(sinBarra, {
      limit: POR_PAGINA,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`No se pudo listar el almacén: ${error.message}`);
    for (const archivo of data) {
      if (/\.(png|jpe?g)$/i.test(archivo.name)) rutas.push(`${sinBarra}/${archivo.name}`);
    }
    if (data.length < POR_PAGINA) return rutas;
  }
}

/**
 * Borra TODO lo que hay bajo una carpeta de primer nivel cuyas subcarpetas
 * contienen archivos (como «procesos/<id>/…»). Devuelve cuántos archivos borró.
 * Irreversible: solo la usa «Borrar todo».
 */
export async function borrarCarpetaConSubcarpetas(raiz: string): Promise<number> {
  let borrados = 0;
  for (;;) {
    // Siempre desde el principio: lo ya borrado desaparece del listado.
    const { data: subcarpetas, error } = await almacen().list(raiz, { limit: POR_PAGINA });
    if (error) throw new Error(`No se pudo listar el almacén: ${error.message}`);
    if (subcarpetas.length === 0) return borrados;

    let borradosEnEstaVuelta = 0;
    for (const subcarpeta of subcarpetas) {
      const carpeta = `${raiz}/${subcarpeta.name}`;
      for (;;) {
        const { data: archivos, error: errorLista } = await almacen().list(carpeta, { limit: POR_PAGINA });
        if (errorLista) throw new Error(`No se pudo listar el almacén: ${errorLista.message}`);
        if (archivos.length === 0) break;
        const { error: errorBorrado } = await almacen().remove(archivos.map((archivo) => `${carpeta}/${archivo.name}`));
        if (errorBorrado) throw new Error(`No se pudieron borrar archivos del almacén: ${errorBorrado.message}`);
        borradosEnEstaVuelta += archivos.length;
      }
    }
    borrados += borradosEnEstaVuelta;
    // Sin avance no se insiste: evita un bucle sin fin si algo no se deja borrar.
    if (borradosEnEstaVuelta === 0) return borrados;
  }
}

export async function descargarArchivo(ruta: string): Promise<Buffer> {
  const { data, error } = await almacen().download(ruta);
  if (error) throw new Error(`No se pudo descargar ${ruta}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Guarda un archivo en el bucket. `upsert` hace la subida idempotente: si el
 * navegador reintenta una imagen cuya primera subida sí llegó, no falla ni duplica.
 */
export async function guardarArchivo(ruta: string, contenido: Buffer, contentType: string): Promise<void> {
  const { error } = await almacen().upload(ruta, contenido, { contentType, upsert: true });
  if (error) throw new Error(`No se pudo guardar el archivo en el almacén: ${error.message}`);
}
