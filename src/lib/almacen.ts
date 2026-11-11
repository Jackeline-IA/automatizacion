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

/**
 * Guarda un archivo en el bucket. `upsert` hace la subida idempotente: si el
 * navegador reintenta una imagen cuya primera subida sí llegó, no falla ni duplica.
 */
export async function guardarArchivo(ruta: string, contenido: Buffer, contentType: string): Promise<void> {
  const { error } = await almacen().upload(ruta, contenido, { contentType, upsert: true });
  if (error) throw new Error(`No se pudo guardar el archivo en el almacén: ${error.message}`);
}
