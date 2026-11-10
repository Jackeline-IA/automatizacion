"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { authCliente } from "@/lib/firebase/cliente";

function mensajeDeError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
      case "auth/invalid-email":
        return "Correo o contraseña incorrectos.";
      case "auth/too-many-requests":
        return "Demasiados intentos. Espera unos minutos y vuelve a probar.";
      case "auth/network-request-failed":
        return "No hay conexión con el servicio de inicio de sesión.";
    }
  }
  return error instanceof Error ? error.message : "No se pudo iniciar sesión.";
}

export default function PaginaLogin() {
  const router = useRouter();
  const [correo, setCorreo] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      // 1. Firebase verifica la contraseña y entrega un ID token.
      const credencial = await signInWithEmailAndPassword(authCliente(), correo.trim(), clave);
      const idToken = await credencial.user.getIdToken();

      // 2. Nuestro servidor lo verifica, mira la lista de correos y fija la cookie.
      const respuesta = await fetch("/api/sesion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      // 3. La sesión real vive en la cookie del servidor: la de Firebase en el
      //    navegador ya no hace falta.
      await signOut(authCliente());

      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
        throw new Error(cuerpo.error ?? "No se pudo iniciar sesión.");
      }
      // La cookie ya está fijada: la siguiente petición la lleva.
      router.replace("/");
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      <form onSubmit={entrar} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Correo
          <input
            type="email"
            name="correo"
            autoComplete="username"
            required
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            className="rounded border border-foreground/30 bg-transparent px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Contraseña
          <input
            type="password"
            name="clave"
            autoComplete="current-password"
            required
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            className="rounded border border-foreground/30 bg-transparent px-3 py-2 text-base"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            ✕ {error}
          </p>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-60"
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
      <p className="text-sm opacity-70">No hay registro: las cuentas las crea quien administra la aplicación.</p>
    </main>
  );
}
