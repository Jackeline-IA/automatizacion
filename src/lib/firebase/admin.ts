/*
 * Firebase Admin: SOLO servidor (Route Handlers y scripts). Nunca lo importes
 * desde un componente con "use client": la cuenta de servicio se salta las reglas
 * de seguridad y su clave privada no puede llegar al navegador.
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/** Lee una variable obligatoria; el error nombra la variable, nunca su valor. */
function leer(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

/*
 * Se inicializa una sola vez y de forma perezosa (al primer uso, no al importar):
 *  - una instancia caliente de la función reutiliza la app entre invocaciones;
 *  - en desarrollo, la recarga en caliente vuelve a evaluar este módulo y
 *    initializeApp fallaría si la app ya existe;
 *  - `next build` puede importar el módulo sin que las variables existan.
 */
function app(): App {
  const existente = getApps()[0];
  if (existente) return existente;
  return initializeApp({
    credential: cert({
      projectId: leer("FIREBASE_ADMIN_PROJECT_ID"),
      clientEmail: leer("FIREBASE_ADMIN_CLIENT_EMAIL"),
      // En .env la clave va en una línea con "\n" escritos; el certificado
      // necesita saltos de línea reales.
      privateKey: leer("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });
}

export function db(): Firestore {
  return getFirestore(app());
}

export function auth(): Auth {
  return getAuth(app());
}
