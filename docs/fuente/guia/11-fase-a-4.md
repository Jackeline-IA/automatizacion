---

### Fase A — Autenticación con Firebase (correo y contraseña; antes de subir nada)

**Objetivo.** Que solo las personas autorizadas usen la aplicación, y que cada lote, factura y archivo pertenezca a un `uid`: un usuario solo ve lo suyo.

**Qué construyes.** `src/lib/firebase/cliente.ts` (Auth en el navegador), `src/lib/auth/sesion.ts` (cookie y `exigirUsuario`), `src/app/api/sesion/route.ts`, `src/app/login/page.tsx`, `src/proxy.ts` y `scripts/crear-usuario.ts`.

**Cómo funciona (flujo).**
1. **Navegador**: `/login` llama `signInWithEmailAndPassword` de `firebase/auth` (con las variables `NEXT_PUBLIC_*`) y obtiene un **ID token**. No hay página de registro.
2. El navegador envía el token a `POST /api/sesion`. El servidor: `verifyIdToken` → comprueba que el correo está en `USUARIOS_PERMITIDOS` (si no, **403**) → `createSessionCookie(idToken, { expiresIn: 5 días })` → fija la cookie `sesion` con `httpOnly`, `secure` (solo en producción), `sameSite: "lax"`, `path: "/"`. Después el navegador cierra la sesión de Firebase (`signOut`): **la sesión real vive en la cookie del servidor**.
3. `DELETE /api/sesion` borra la cookie (cerrar sesión). `GET /api/sesion` devuelve el correo (lo usa el menú).
4. **`exigirUsuario(request)`** lee la cookie y la verifica con `verifySessionCookie(cookie, true)` (el `true` comprueba revocación) y la lista de correos; devuelve `{ uid, email }` o una respuesta **401**. Se usa así en **todas** las rutas: `const u = await exigirUsuario(request); if (u instanceof Response) return u;`.
5. **`src/proxy.ts`** (antes `middleware.ts`) hace solo una comprobación **optimista**: si no hay cookie, redirige las páginas a `/login`. La verificación real está en cada Route Handler, porque el proxy no es el lugar para verificaciones completas. Su `matcher` excluye `/login`, `/api`, `_next/static`, `_next/image` y el favicon.
6. Un lote ajeno responde **404** (no se revela que existe).

**Por qué `USUARIOS_PERMITIDOS` si ya usamos Firebase Auth.** Firebase Auth hace la **autenticación** (¿quién eres?: verifica la contraseña, que jamás está en variables). La lista hace la **autorización** (¿puedes usar esta app?). Se necesita porque la `apiKey` de Firebase es pública y el **registro libre está abierto**: con solo esa clave cualquiera puede crear una cuenta en tu proyecto y obtener un token válido (se comprobó creando y borrando una cuenta). Sin la lista, cualquiera podría gastar tu cuota de Blob, Firestore y CPU. Sin la variable definida, **nadie entra** (falla cerrado). Alternativa: desactivar el registro en la consola de Firebase (puede requerir Identity Platform; verifica el ajuste vigente). El código tolera comillas y espacios alrededor de cada correo.

**Verificación.**
- Sin cookie: `curl -i http://localhost:3000/api/procesos` → **401**; abrir `/` redirige a `/login`.
- Login con el usuario de prueba → entra; `GET /api/sesion` devuelve su correo; cerrar sesión → vuelve a dar 401.
- Un correo que no está en la lista → **403**. Un token inventado → **401**.
- **Repite estas pruebas contra la URL desplegada** (el siguiente error solo aparece allí).

**Error real de esta fase (solo en Vercel).** `firebase-admin@14.5.0` trae `jwks-rsa@4` → `jose@6`, que es **solo ESM**; en las funciones de Vercel el `require()` de ese módulo falla con `ERR_REQUIRE_ESM` y **todas** las rutas que importan `firebase-admin/auth` responden **500** (en local con Node 24 sí funciona, por eso las pruebas locales pasan). Solución: en `package.json`, `"overrides": { "firebase-admin": { "jwks-rsa": "3.2.2" } }` (esa versión usa `jose@4`, dual CJS/ESM) y `npm install`. Revisa si se puede quitar cuando `firebase-admin` lo corrija.

**Otros errores típicos.** Login correcto pero 403: `USUARIOS_PERMITIDOS` no está definida en ese entorno de Vercel, tiene comillas pegadas, o no hubo Redeploy. La cookie con `secure: true` no se guarda en `http://localhost`: actívala solo cuando `NODE_ENV === "production"`.

**Pídele a tu IA.** "Dibújame el recorrido de un login (navegador → Firebase → servidor → cookie) y dime qué parte verifica cada cosa. Luego implementa solo `exigirUsuario` y úsala en una ruta de prueba."

---

### Fase 4 — Extractor de datos (lógica pura, con pruebas)

**Objetivo.** Dos funciones puras, sin OCR ni base de datos (por eso se pueden probar con texto de ejemplo): `extraer(textoOcr): ParcialFactura` y `validar(parcial): string[]` (lista de **motivos de revisión**; vacía = aceptable).

**Qué construyes.** `src/lib/ocr/nit.ts` (dígito de verificación), `src/lib/ocr/constantes.ts` (tarifas parametrizadas), `src/lib/ocr/tipos.ts`, `src/lib/ocr/extractor.ts`, `src/lib/ocr/validador.ts`, y las pruebas `src/lib/ocr/nit.test.ts` y `src/lib/ocr/extractor.test.ts` con textos reales en `src/lib/ocr/__fixtures__/`.

**Primero mira el texto real.** No escribas expresiones regulares "a ojo": corre el OCR sobre unas 10 imágenes de distintos diseños y guarda el texto (`scripts/ocr-muestras.ts <carpetaImagenes> <carpetaTxt>` en el repositorio de referencia). Ese texto —con sus errores— es tu material de trabajo y tus fixtures de prueba.

**Contexto tributario colombiano (entiéndelo, no lo memorices).**
- Una factura electrónica trae: razón social y NIT con dígito de verificación (DV) del emisor, adquirente (razón social y NIT/CC), número con prefijo (`FE-000123`), resolución de numeración DIAN, fecha y hora de emisión, forma y medio de pago, ítems, valor antes de IVA, IVA, total y **CUFE** (hash de 96 caracteres hexadecimales).
- **IVA** general: 19 %. **Impuesto nacional al consumo (INC, "impoconsumo")**: 4 % sobre telefonía móvil, datos e internet móvil; se liquida sobre el valor **sin IVA** y convive con el IVA, así que en esas facturas **`total = subtotal + IVA + impoconsumo`**. (Matiz: para datos móviles la base real es lo que exceda 1,5 UVT mensuales; el generador lo simplifica aplicando 4 % a todo el servicio. Verifica tarifas con un contador y déjalas como constantes.)
- La factura trae **otras fechas y cifras largas que NO son lo buscado**: fecha de vencimiento, fecha de la resolución DIAN, número de resolución (14 dígitos), rango de numeración (`FE-000001 al FE-050000`) y el CUFE. Hay que tomar la fecha de **emisión** y no confundir esas cifras con el NIT, el número de factura o los importes.
- Las etiquetas varían por diseño: "Valor antes de IVA" / "Subtotal" / "Base gravable"; "IVA 19%" / "IVA (19%)"; "Impoconsumo 4%" / "Impuesto nacional al consumo (4%)" / "Imp. consumo 4 %"; "TOTAL A PAGAR" / "Total factura" / "VALOR TOTAL" / "TOTAL". El NIT aparece con o sin puntos (`900.123.456-7` o `900123456-7`).
- **Dígito de verificación del NIT** (algoritmo DIAN): pesos `3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71` aplicados a los dígitos **de derecha a izquierda**; `r = suma mod 11`; `dv = r > 1 ? 11 − r : r`. Casos comprobados: 890903938 → 8, 860034313 → 7, 899999068 → 1. Detecta cerca del 98 % de los errores de un dígito, **no todos**: no lo presentes como garantía.

**Qué devuelve `extraer` (`ParcialFactura`).** `numero`, `fecha` (emisión, `yyyy-mm-dd`), `proveedor`, `nitProveedor` + `dvProveedor`, `clienteDocumento` + `clienteDv` + `clienteNombre`, `items[]`, `subtotal`, `iva`, `impoconsumo` (`null` si no hay línea legible), `mencionaImpoconsumo` y `total`. Todo lo que no se encuentre queda en `null`: **nunca se inventa un valor**.

**Cómo se extrae cada campo.**
1. **Normalizar el texto** del OCR antes de interpretarlo: `$496 .000` → `$496.000`; `3$146.500` → `3 $146.500`; `S146.500` (la S es un `$` mal leído) → `$146.500`; cantidad, precio y subtotal pegados (`119426.500$4.691.500` → `11 $426.500 $4.691.500`, **solo si** cantidad × precio = subtotal). Elimina las líneas vacías.
2. **Importes**: punto de miles (`$1.234.567`), sin decimales; antes de leer una línea se quitan los porcentajes (`19%`) para que no se confundan con importes.
3. **Fecha de emisión**: reconoce `dd/mm/yyyy`, `yyyy-mm-dd` y `12 de marzo de 2026`, las valida como fechas reales y **descarta** las precedidas de vencimiento / límite / resolución / autorización / rango. La que va junto a "Emisión", "expedición" o "Fecha" gana.
4. **Número de factura**: patrón `FE-000123`, ignorando las líneas de rango, resolución o autorización.
5. **Documentos (NIT/CC)**: patrón con o sin puntos y con DV. El primero del texto es el del proveedor; el del cliente es el que tiene una etiqueta (Cliente / Adquirente / Señores / Documento / NIT/CC) en esa línea **o en las dos anteriores** (el nombre del cliente puede partirse en dos líneas). Si el OCR perdió el guion (`8376231879`), solo se acepta si el último dígito **es** un DV válido del número anterior.
6. **Razón social del proveedor**: la(s) línea(s) justo antes de la del NIT. Se quita el título ("FACTURA ELECTRÓNICA DE VENTA", que a veces comparte línea o se parte en dos) y se corta en el sufijo (`S.A.S.`, `S.A.`, `Ltda.`, `E.U.`). Si tras cortar solo queda el sufijo, la razón social estaba **partida en dos líneas** y se antepone la línea anterior.
7. **Ítems**: las líneas con importes antes de la primera línea de totales. La cantidad puede estar pegada al primer importe (`… 2 $116.500`, `20 x $22.700`) o al inicio de la línea; se elige el candidato que cumple cantidad × precio = subtotal. La descripción puede **partirse en dos líneas** y la parte sin cifras puede venir **antes o después** de la línea con los importes. Se descartan líneas de dirección (`Cra 115 $ 48-7`) exigiendo palabras de dirección ausentes y precio ≥ 100.
8. **Totales**: se buscan a partir de la primera línea de subtotal (valor antes de IVA / subtotal / base gravable); el IVA en una línea que **empieza** por "IVA" (no "Responsable de IVA"); el impoconsumo en su línea; el total en la última línea "total". **Reparación por redundancia aritmética**: si cantidad × precio ≠ subtotal pero subtotal / precio es un entero pequeño, el OCR leyó mal la cantidad: se corrige.

**Reglas de `validar`** (cada incumplimiento es un motivo): campos obligatorios presentes (número, fecha, proveedor, NIT del proveedor, documento del cliente, subtotal, IVA, total, al menos un ítem); razón social legible (mínimo 6 letras); DV válido del NIT del proveedor y del documento del cliente; cantidad × precio = subtotal de cada ítem; los ítems suman el subtotal; IVA = 19 % del subtotal (tolerancia de $1); si hay impoconsumo, = 4 % del subtotal (tolerancia de $1); subtotal + IVA + impoconsumo = total; si el texto menciona impoconsumo y no se pudo leer su valor y el total no cuadra sin él, es motivo de revisión. **El cliente se identifica por documento, nunca por nombre** (el OCR altera los nombres): si el documento no pasa el DV, la factura queda en revisión y **no se crea ningún cliente**.

**Lecciones reales que debe cubrir al menos una prueba cada una** (todas salieron de errores verdaderos):
- Falsos positivos de palabras: "Mo**nit**or" contiene "nit" (usa límites de palabra, `\b`); "**Imp**resora" empieza por "imp" y se tomó por la etiqueta de impoconsumo; "Responsable de **IVA**" se tomó por la línea del IVA.
- Etiquetas pegadas por el OCR: `IVA19%` (sin espacio) y `Imp. consumo 4 %`.
- La razón social partida en dos líneas, con el título de la factura intercalado (`…FACTURA ELECTRÓNICA DE` / `S.A.S. VENTA`).
- Las fechas y cifras largas que no son lo buscado (vencimiento, resolución, rango, CUFE).
- Una dirección leída como ítem.
- Una cantidad mal leída que la aritmética puede reparar.

**Cómo probar sin respuestas correctas.** Con vitest: casos con texto real de cada diseño y un caso por cada lección. Para medir de verdad necesitas el `verdad.json` de un conjunto (lo tiene el profesor; `scripts/leer-carpeta.ts <carpeta> <verdad.json>` en el repositorio de referencia compara campo por campo). Sin él, mide el **porcentaje de aceptadas** y revisa a mano 20 facturas aceptadas.

**Verificación.** `npm test` pasa. Referencia (repositorio de referencia, 56 pruebas): 10/10, 39/40 y 56/60 aceptadas en conjuntos de desarrollo distintos y **875/1000 (88 %) en el conjunto del curso** (con 40 facturas problemáticas puestas a propósito que siempre van a revisión; sin ellas, 875/960 = 91 %), con entre 0 y 3 errores sin detectar por conjunto (un dígito mal leído en el número de factura, por ejemplo, que la aritmética no puede ver).

**Errores típicos.** Ajustar el extractor a tus 10 facturas de desarrollo y creer que ya está (con 40 facturas el extractor aceptaba el 98 %, pero con otras 60 de otra semilla bajó al 82 % hasta arreglar un patrón que no se había visto —la razón social partida con el título—, y subió a 93 %: **mide siempre con facturas que no usaste para desarrollar**); arreglar la prueba en vez del código; expresiones regulares ilegibles sin comentarios.

**Pídele a tu IA.** "Muéstrame 3 textos reales de OCR de diseños distintos antes de escribir ninguna expresión regular. Escribe primero la prueba que falla y después el código mínimo que la hace pasar."
