---

### Fase D — Despliegue y operación en Vercel

**Objetivo.** Dejar el sistema listo para que otras personas lo usen sin sorpresas. Se va cumpliendo desde la Fase 1; esta lista debe estar **completa al final**.

**Lista de comprobación.**
1. **Variables de entorno** definidas en Production, Preview y Development; ningún secreto en el repositorio (`git log -p --all -S "BEGIN PRIVATE KEY" --oneline` solo debe encontrar el valor **falso** de `.env.example`).
2. **`maxDuration`** configurado según el plan Hobby (máximo 300 s): `lote` y `finalizar` 300, `iniciar` 60, `datos/borrar` 300. El tamaño de lote (4) y la concurrencia (3) se justifican con las mediciones de la Fase 5.
3. **Autenticación en producción**: ninguna ruta de API responde sin sesión (comprueba con `curl` cada ruta: todas deben dar 401); `USUARIOS_PERMITIDOS` y el resto de variables están en Vercel; las **reglas de Firestore siguen en "denegar todo"** (`npx tsx scripts/verificar-reglas.ts`).
4. **Política de los blobs**: decide y documenta qué pasa con las imágenes y Excel de lotes antiguos (borrarlos tras un tiempo, o con «Borrar todo» entre prácticas). Los blobs ocupan almacenamiento del plan.
5. **Logs**: revisa los *runtime logs* de Vercel tras una corrida completa y reporta cualquier 504, 413, 500 o error de cuota de Firestore.
6. **Nota de cuota**: anota lo que gastó la corrida (Blob, CPU activa en Vercel; lecturas, escrituras y borrados en Firestore; usuarios en Authentication). Ver sección 8.
7. **Aceptación final con la carpeta completa en la URL de producción**: se procesan las 1000 facturas; entre aceptadas, revisión y errores suman **1000**; «Clientes en la base» muestra **850** (después de revisar a mano las 40 facturas con problema deliberado); cada lote tiene su Excel descargable; **reprocesar la misma carpeta no duplica nada**.

**Verificación.** Corrida completa en producción sin errores en los logs, y una nota con el uso de cuota que dejó. Si dispones del `verdad.json` del conjunto, compara la base con él (exactitud por campo, aceptadas con error no detectado, clientes que no existen en la verdad: deben ser 0). *El repositorio de referencia no incluye un comando `verificar`; `scripts/leer-carpeta.ts` mide la extracción sin base de datos y es un buen punto de partida si quieres escribirlo.*

---

### Fase G — Generador de facturas (SOLO PROFESOR; los estudiantes reciben las imágenes)

**Qué es.** `scripts/generar-facturas.ts` (+ `scripts/generador/datos.ts` y `scripts/generador/disenos.ts`) produce facturas colombianas sintéticas **sin ningún modelo de IA** (cero tokens): todo sale de `@faker-js/faker` con semilla fija, HTML dibujado con Chromium (`playwright`) y degradado con `sharp`. Los estudiantes **no** lo ejecutan.

**Uso.** `npm run generar:facturas -- --cantidad 1000 --semilla 2026 --salida <carpeta>` crea `<carpeta>/facturas/` (solo imágenes `factura_0001.png|jpg` …) y `<carpeta>/verdad.json` (las respuestas correctas, **fuera** de la carpeta de imágenes). **El script borra `<carpeta>/facturas` antes de escribir**: apunta a una carpeta donde no haya nada tuyo.

**Qué genera.** Un pool de clientes únicos (documento de 9 dígitos con DV válido) y facturas restantes asignadas a clientes ya usados (un cliente repetido conserva exactamente el mismo documento y nombre): con 1000 facturas, **850 clientes distintos y 150 repeticiones**; proveedores ficticios con NIT válido; números `FE-000001…` únicos y sin relación con el nombre del archivo; fecha y hora de emisión y de vencimiento; IVA 19 %; impoconsumo 4 % solo en facturas de telefonía móvil (15 %); un CUFE simulado (no verificable ante la DIAN); **4 diseños** (clásico con tabla, encabezado de color con texto blanco, ticket angosto, caja con borde doble) y **3 calidades** por cuotas (60 % limpia, 30 % media con rotación leve y desenfoque, 10 % mala con baja resolución y JPEG agresivo). Cada imagen lleva el aviso "documento sintético con datos ficticios para fines académicos".

**Casos que siempre requieren revisión manual (1 % de cada tipo, 40 de 1000).** Son deterministas (se eligen por posición, sin consumir números aleatorios: las otras 960 facturas salen idénticas con o sin esta función), nunca de calidad «mala» (deben poder leerse a simple vista) y cada una queda anotada en `verdad.json` con `problema`, `rotacion`, `totalCorrecto` y `dvCorrecto` (los demás campos son lo **impreso**, equivocado a propósito):

| `problema` | Qué trae la imagen | Por qué la máquina la rechaza |
|---|---|---|
| `total-no-cuadra` | un total mayor que subtotal + IVA + INC (entre $10.000 y $49.000) | la suma no cuadra |
| `iva-tarifa` | IVA al 5 % en el primer ítem o exento (0 %), sin el rótulo «19 %» | el IVA no es el 19 % del subtotal |
| `dv-cliente` | documento del cliente (un cliente que se repite) con el dígito de verificación equivocado | el DV no pasa; no se crea cliente |
| `girada` | la imagen entera girada 90°, 180° o 270° | el OCR no lee texto girado: falta el número de factura |

Una persona las resuelve en el formulario de la Fase 9: corrige el total, confirma «Guardar de todos modos» cuando la factura trae de verdad una tarifa distinta, corrige el dígito de verificación mirando la imagen, o **gira la imagen** con los botones ↺ ↻ y la transcribe.

**Comprobaciones que hace al terminar** (falla con `exit 1` si algo no cuadra): número de imágenes, números repetidos, `subtotal + IVA + INC = total`, impoconsumo coherente con "móvil" y DV válidos (salvo en los casos de problema deliberado, donde comprueba lo contrario: que la validación del sistema **sí** los rechaza). Imprime también cuántas facturas requieren revisión y de qué tipo. Imprime clientes distintos, repeticiones, móviles, diseños, calidades y tamaño (1000 facturas ≈ 108 MB).

**Cuidado al mezclar conjuntos.** Dos corridas con semillas distintas numeran ambas desde `FE-000001`; si las procesas juntas, las facturas con número repetido (y archivo distinto) quedan en `revision` con "ya existe en otra factura". Genera siempre el conjunto completo de una vez.
