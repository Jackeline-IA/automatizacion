/*
 * Fase 2 — Comprueba que las reglas de Firestore están cerradas ("denegar todo").
 *
 * Uso: npx tsx scripts/verificar-reglas.ts
 *
 * Hace peticiones ANÓNIMAS a la API REST de Firestore, solo con la apiKey pública
 * (lo mismo que podría hacer cualquiera que abra la página). Todas deben recibir
 * 403. No usa la cuenta de servicio: esa se salta las reglas y no probaría nada.
 *
 * Si una escritura anónima llegara a funcionar (reglas abiertas), el script borra
 * el documento que él mismo creó y termina con error.
 */

const COLECCIONES = ["clientes", "facturas", "procesos"] as const;

function leer(nombre: string): string {
  const valor = process.env[nombre]?.trim().replace(/^["']|["']$/g, "");
  if (!valor) throw new Error(`Falta la variable ${nombre} en .env`);
  return valor;
}

interface Resultado {
  coleccion: string;
  operacion: "lectura" | "escritura";
  estado: number;
}

async function main(): Promise<void> {
  process.loadEnvFile(".env");
  const proyecto = leer("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  const apiKey = leer("NEXT_PUBLIC_FIREBASE_API_KEY");
  const raiz = "https://firestore.googleapis.com/v1";
  const base = `${raiz}/projects/${proyecto}/databases/(default)/documents`;

  const resultados: Resultado[] = [];

  for (const coleccion of COLECCIONES) {
    const lectura = await fetch(`${base}/${coleccion}?pageSize=1&key=${apiKey}`);
    resultados.push({ coleccion, operacion: "lectura", estado: lectura.status });

    const escritura = await fetch(`${base}/${coleccion}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: { pruebaDeReglas: { booleanValue: true } } }),
    });
    resultados.push({ coleccion, operacion: "escritura", estado: escritura.status });

    if (escritura.ok) {
      // Las reglas están abiertas: se limpia lo que esta prueba acaba de crear.
      const creado = (await escritura.json()) as { name?: string };
      if (creado.name) await fetch(`${raiz}/${creado.name}?key=${apiKey}`, { method: "DELETE" });
    }
  }

  let fallos = 0;
  for (const r of resultados) {
    const cerrada = r.estado === 403;
    if (!cerrada) fallos += 1;
    console.log(`${cerrada ? "OK   " : "FALLO"} ${r.operacion.padEnd(9)} anónima de ${r.coleccion.padEnd(9)} → ${r.estado}`);
  }

  if (fallos > 0) {
    console.error(
      `\n${fallos} petición(es) no recibieron 403. Revisa las reglas en la consola de Firebase:\n` +
        "Firestore Database → Reglas → deben ser `allow read, write: if false;`",
    );
    process.exit(1);
  }
  console.log("\nReglas cerradas: ninguna petición anónima puede leer ni escribir.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
