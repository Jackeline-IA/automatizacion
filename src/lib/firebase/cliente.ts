/*
 * Firebase en el NAVEGADOR: solo Authentication. El navegador nunca habla con
 * Firestore ni con el almacén de archivos; eso lo hace el servidor.
 *
 * Estas variables son públicas por diseño (viajan dentro de la página). Hay que
 * escribirlas completas, una por una: Next sustituye `process.env.NEXT_PUBLIC_X`
 * por su valor al compilar y no puede hacerlo con un nombre calculado.
 */
import { getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const configuracion = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** Auth del navegador; la app se crea una sola vez (la recarga en caliente reevalúa el módulo). */
export function authCliente(): Auth {
  return getAuth(getApps()[0] ?? initializeApp(configuracion));
}
