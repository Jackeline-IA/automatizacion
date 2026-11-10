# CLAUDE.md — Procesador de facturas (Next.js + OCR + Vercel Blob + Firebase + Excel) desplegado en Vercel

Eres Claude Code ayudando a un estudiante a construir **desde cero** este proyecto, por fases. Contexto: clase "Tendencias en desarrollo de software", tema **automatización**. El estudiante sabe TypeScript y Python. **El objetivo es que entienda lo que construye**: explica brevemente el porqué de cada paso y no avances de fase sin que la verificación pase.

Todo lo que sigue a esta cabecera (a partir de la sección 1) es **la misma guía paso a paso que contiene `AGENTS.md`** (la leen otros agentes de IA). Esta cabecera añade solo lo específico de Claude Code y el estado del repositorio de referencia.

## Cómo trabajar con Claude Code en este proyecto

- **Al empezar una fase**: usa el modo de plan (o resume tu plan en máximo 8 líneas), lista los archivos que vas a tocar y el comando que demuestra que terminó. Espera el visto bueno.
- **Lee y entiende cada petición de permiso** antes de aprobarla. No apruebes en bloque comandos que impriman o lean `.env`, que borren datos, que hagan `git push --force` o que creen recursos en la nube.
- **Si una acción es denegada** (por el estudiante o por el sistema de permisos), no la rodees por otro camino: busca una alternativa más segura y, si de verdad hace falta esa acción, explica por qué y deja que el estudiante decida. Un caso real: una prueba automática terminaba pulsando «Borrar todo» contra la base real y el sistema la bloqueó con razón; la solución fue limpiar solo lo que la prueba crea.
- **Entre fases**, limpia la conversación (`/clear`): esta guía y el repositorio ya contienen el contexto; no hace falta arrastrar historial.
- **No lances subagentes ni tareas largas en segundo plano sin que el estudiante lo pida**, y no dejes procesos corriendo al terminar.
- **Documentación primero**: para Next.js 16 lee `node_modules/next/dist/docs/` antes de escribir código (ver el detector de código desactualizado, sección 2).
- **Cómo mirar `.env` en una sesión nueva**: nunca lo leas ni lo imprimas. Comprueba que está completo con `npx tsx scripts/probar-conexion.ts`; si necesitas ver qué nombres hay, `grep -v '^#' .env | cut -d= -f1` (solo la parte anterior al primer `=`).

<!-- PROFESOR:INICIO — Esta sección es el estado del repositorio de referencia. Bórrala si entregas este archivo a los estudiantes. -->

## 0. Estado del repositorio de referencia (SOLO PROFESOR — léelo primero en una sesión nueva)

Repositorio: https://github.com/justojaramillo/automation (rama `main`). Producción: https://automation-six-chi.vercel.app (Vercel Hobby, `maxDuration` 300 s). Cuenta de prueba: `billing@me.com` (creada con `scripts/crear-usuario.ts`; la contraseña es débil: cambiarla antes de usar datos reales). Etiquetas de git: `fase-1`, `fase-2`, `fase-a`, `fase-4`, `fase-8` (el trabajo se subió en pocos commits, no uno por fase).

**Construido y verificado (2026-11-06/07):** todas las fases (0, 1, 2, A, 4, 5, 3, 6, 7, 8, 9) y el generador (G). Fase D parcial: falta la nota de cuota completa y `npm run verificar` no existe (se usa `scripts/leer-carpeta.ts` para medir el extractor).

**Decisiones de arquitectura del profesor (2026-11-07):** (1) **las imágenes pasan por la API**, una por petición (`POST /api/procesos/[id]/imagenes`): el servidor valida sesión, lote, tamaño ≤ 4 MB, tipo real por bytes y que la imagen se pueda leer, y es el único que escribe en Blob; se descartó la subida directa con token (límite de 4,5 MB por petición: las facturas pesan ~100 KB, la mayor 192 KB). (2) **Revisión manual** (Fase 9): formulario con la imagen al lado para ingresar o corregir las facturas que la máquina no aceptó; sus métricas van aparte (`manuales`) para no inflar «leídas correctamente». Las pruebas son `scripts/probar-correccion.ts` (28 comprobaciones contra Firestore), `scripts/probar-revision-ui.ts` (navegador real) y `scripts/probar-http.ts` (incluye los rechazos de la subida).

**Datos para los estudiantes:** `/home/justo/projects/facturas` (fuera del repositorio): **1000 imágenes** (111 MB, solo imágenes; **40 con problema deliberado que siempre van a revisión manual**: 10 con total que no cuadra, 10 con IVA al 5 % o exento, 10 con dígito de verificación del cliente equivocado y 10 giradas; las otras 960 son idénticas al conjunto anterior), regeneradas el 2026-11-06 con `npm run generar:facturas -- --cantidad 1000 --semilla 2026 --salida ..` (850 clientes distintos, 150 repeticiones, 150 con impoconsumo, 250 por diseño, `FE-000001…FE-001000` únicos). Respuestas correctas: `salida/verdad_1000.json` (**SOLO PROFESOR**; el generador la deja en `../verdad.json` y se movió allí para que no viaje con la carpeta). Los 40 casos están marcados en `verdad_1000.json` (`problema`, `rotacion`, `totalCorrecto`, `dvCorrecto`). Cuidado: el generador **borra** `<salida>/facturas`; con `--salida ..` borraría `../facturas`. Las 10 facturas de `salida/facturas` (semilla 2026, cantidad 10, con su `salida/verdad.json`) son solo de desarrollo y **no** forman parte de las 1000 (numeran desde `FE-000001`: mezclarlas duplicaría números).

**Mediciones del extractor** (offline, `scripts/leer-carpeta.ts`): 10/10 aceptadas (conjunto de desarrollo), 39/40 (semilla 777), 56/60 (semilla 31; era 82 % antes de arreglar la razón social partida con el título de la factura) y, **sobre las 1000 facturas de los estudiantes (con los 40 casos deliberados), 875 aceptadas (88 %) y 125 a revisión; de las aceptadas, 872 totalmente correctas y 3 con error no detectado** (25 min de CPU, sin cuota). Las 40 deliberadas terminan **todas** en revisión (0 aceptadas, comprobado una por una); las otras 960 dan el mismo resultado que antes (875 de 960 = 91 %; el conjunto anterior daba 915/1000 = 92 %). Una muestra de 100 del conjunto anterior había dado 85 %: las muestras pequeñas engañan. Exactitud por campo sobre las 1000: número 986, fecha 986, NIT proveedor 977, documento cliente 963, subtotal 981, IVA 971, impoconsumo 996, total 983, nº de ítems 974 (incluyen los 10 casos girados, que no se leen). Motivos de revisión más comunes: documento del cliente no leído (21), IVA que no es el 19 % (16), total que no cuadra (12), ítems que no suman el subtotal (12), proveedor no leído (11), dígito de verificación del cliente (11), número de factura no leído (10: las giradas).

**Medido en producción (Vercel Hobby):** 10 facturas en 14,7 s (3 lotes concurrentes de 4); 200 facturas en 2 lotes de 100 → ~7 min, 94/100 correctas en cada lote, 0 errores de consola; subida de 1000 imágenes (10 lotes) **a través de la API** en 68 s con retraso máximo del navegador de 9 ms (la subida directa a Blob medía 89 s; se cambió por decisión del profesor para que la API valide cada archivo). **No se han procesado las 1000 completas en producción** (≈ 25–35 min, ≈ 5 000 lecturas y 6 000 escrituras de cuota).

**Decisiones del profesor:**
- Cuota: el plan gratuito de Firestore da 50 000 lecturas al día (dato del profesor; las escrituras y borrados diarios no se han confirmado). Pidió poder subir 1000 facturas, así que la interfaz no limita y muestra la estimación de lecturas.
- La clave privada de Firebase que se imprimió por error en una sesión anterior **no se rota por ahora** (proyecto de desarrollo, sin datos reales). No mencionarlo como pendiente; el profesor conoce el riesgo.
- Las contraseñas y claves **nunca** se escriben en este archivo ni en el repositorio.

**Pendiente:** (1) procesar las 1000 completas en producción y anotar la cuota gastada; (2) probar el botón «Borrar todo» contra la base real (una prueba automática no debe ejecutarlo; el sistema de seguridad lo bloqueó con razón) y la interfaz en un teléfono; (3) completar la Fase D (nota de cuota, política de blobs); (4) opcional: `npm run verificar` contra `verdad.json`.

**Presentaciones para la clase (2026-11-07):** `docs/presentaciones/index.html` enlaza dos mazos HTML que funcionan sin internet (abrir en el navegador; `F` pantalla completa, `N` notas del profesor, `T` tema, `Ctrl+P` PDF): `01-automatizacion.html` (32 diapositivas: qué es automatizar, qué se puede automatizar, objetivos, tecnologías, áreas de una empresa, qué es un proceso, caso de la nómina, riesgos, ciclo, actividad en clase) y `02-construccion.html` (26 diapositivas: arquitectura, restricciones de Vercel y cada fase con su diagrama, porqué y verificación; errores reales y resultados medidos). Se arman con `npm run presentaciones` desde fragmentos en `docs/presentaciones/fuente/` (una diapositiva por archivo); `npx tsx scripts/revisar-presentaciones.ts <carpeta>` detecta desbordes y diagramas encogidos y guarda capturas. Los ejemplos de nómina (Ana: devengado 3.150.000, salud y pensión 4 % = 126.000 cada una, neto 2.898.000) son ilustrativos y simplificados; las tarifas se verifican con un contador. Las cifras de las diapositivas de resultados son las medidas de este documento.

**Mantenimiento de la documentación:** `AGENTS.md` y `CLAUDE.md` se generan con `npm run docs` desde `docs/fuente/` (cabeceras `cabecera-agents.md` y `cabecera-claude.md` + guía en `docs/fuente/guia/*.md`). Edita la fuente y regenera; `npm test` falla si los archivos no coinciden o si la guía menciona un archivo, variable o comando que ya no existe.

<!-- PROFESOR:FIN -->

<!-- Archivo GENERADO por `npm run docs` (scripts/generar-docs.ts) a partir de docs/fuente/. Edita la fuente, no este archivo. -->

## 1. Cómo usar esta guía con tu IA

Este mismo paso a paso está en `AGENTS.md` (lo leen casi todos los agentes de IA) y en `CLAUDE.md` (lo lee Claude Code): el contenido es idéntico, solo cambian las primeras líneas. Contexto: clase "Tendencias en desarrollo de software", tema **automatización**; se asume que sabes TypeScript y Python.

**El objetivo no es que la IA termine el proyecto: es que tú entiendas lo que se construye.** Una IA puede escribir mucho código muy rápido y equivocarse con seguridad; tu trabajo es dirigirla, entender cada paso y comprobar que funciona.

### Cómo arrancar cada sesión

Pega esto (cambiando el número de fase) en tu agente:

> Lee `AGENTS.md` (o `CLAUDE.md`) completo. Hoy trabajamos la **Fase N**. Antes de escribir código: (1) dime en máximo 8 líneas qué vas a construir y por qué, (2) lista los archivos que vas a crear o modificar, (3) dime qué comando demuestra que la fase está terminada. Cuando termines, ejecuta esa verificación y pégame la salida **real** (no un resumen). No avances a la siguiente fase hasta que yo lo diga.

### Reglas para ti (el estudiante)

1. **Una fase a la vez.** Cada fase termina con una verificación que se puede ejecutar; si no pasa, la fase no está terminada.
2. **Ejecuta tú la verificación al menos una vez**, en tu terminal, sin delegarla. Si solo dice "listo" la IA, no sabes si es cierto.
3. **Pídele que te explique el porqué** de cada decisión (cada fase de esta guía trae una sección "Por qué" que puedes usar como pauta). Si no puedes explicarlo con tus palabras, aún no lo entiendes.
4. **Lee el diff antes de hacer commit** (`git diff`). Busca: secretos escritos en el código, archivos que no esperabas, pruebas que cambiaron para que pasen.
5. **Nunca pegues credenciales en el chat con la IA** (ni el contenido de `.env`, ni la clave privada de Firebase). Todo lo que pegas queda registrado fuera de tu computador. Si ocurre, considera la credencial comprometida y genera una nueva (ver Fase 0).
6. **Una IA equivocada se nota así**: usa funciones o archivos que no existen en las versiones instaladas; dice "debería funcionar" sin ejecutar nada; modifica las pruebas en vez de arreglar el código; toca archivos que nada tienen que ver con la fase; borra o sobrescribe sin mirar antes. Ante cualquiera de estas, detén la sesión y pídele que lo revierta.

### Qué vas a construir (resultado final)

```
 navegador                                   Vercel (funciones)                       servicios
┌───────────────────────┐   una imagen por   ┌──────────────────────────┐
│ 1. eliges la carpeta  │   petición         │ POST …/imagenes          │
│ 2. se divide en lotes │ ─────────────────► │ valida: sesión, lote,    │
│ 3. subes cada imagen  │                    │ tamaño, tipo real        │ ───────►  Vercel Blob (privado)
│    (a través de la API)│                   └──────────────────────────┘
│ 4. POST …/iniciar     │ ─────────────────► crea la cola en Firestore   ───────►  Firestore
│                       │                                                          (clientes, facturas,
│ MOTOR (segundo plano) │   3 llamadas       ┌──────────────────────────┐          índices, procesos,
│ llama a …/lote en     │ ─────────────────► │ POST …/lote              │          métricas)
│ paralelo (x3)         │   concurrentes     │ reclama 4 archivos       │ ◄──────►
│                       │                    │ descarga de Blob ◄───────┼───────►  Vercel Blob
│ 5. POST …/finalizar   │ ─────────────────► │ OCR → extraer → validar  │
│                       │                    │ guarda (transacción)     │
│ 6. ve métricas, tabla,│ ◄───────────────── │ genera Excel ────────────┼───────►  Vercel Blob (Excel)
│    descarga el Excel  │                    └──────────────────────────┘
└───────────────────────┘     (el navegador NUNCA habla directo con Blob ni con Firestore;
                                todas las rutas exigen sesión de Firebase Auth)
```

Funciones finales: inicio de sesión (correo y contraseña); subir una carpeta de hasta 1000 facturas que se divide en **lotes**; procesamiento automático en segundo plano con avance en vivo (incluye antes de IVA, IVA, impoconsumo y total acumulados); un **Excel por lote**; **panel de métricas** (facturas leídas correctamente vs mal leídas, por lote o en total, y totales por razón social); tabla de resultados con la imagen original de cada factura; un **formulario de revisión manual** para ingresar o corregir a mano las facturas que la máquina no pudo aceptar (cierra el ciclo de validación humana); y un botón para borrar todos los datos de prueba.

## 2. Reglas de trabajo (para la IA y para ti)

Estas reglas existen porque cada una evitó (o habría evitado) un problema real durante la construcción del proyecto de referencia.

1. **Trabaja por fases (sección 6) y detente al terminar cada una.** Al terminar: ejecuta la verificación de la fase, muestra la salida real, haz un commit (`fase-N: …`), etiqueta (`git tag fase-N`), súbelo a GitHub (Vercel despliega solo) y **espera** a que el estudiante diga que continúe.
2. **Nunca inventes credenciales ni valores de conexión.** Los crea el estudiante en las consolas (Fase 0); tú solo guías. **Nunca escribas secretos en el código ni en Git.**
3. **Nunca imprimas el contenido de `.env`** (ni con `cat`, ni con `awk`, ni con `grep` que muestre valores, ni en logs). Para saber qué variables existen, muestra solo los nombres: `grep -v '^#' .env | cut -d= -f1`. Para saber si funcionan, ejecuta `npx tsx scripts/probar-conexion.ts`. (Un `awk` que partía cada línea en el primer `=` imprimió la clave privada de Firebase, porque su contenido base64 trae `=`.) Mantén `.env*` en `.gitignore` (con la excepción `!.env.example`) **antes** de que existan archivos con secretos, y mantén `.env.example` con los nombres y valores falsos. La clave privada de Firebase solo se usa en el servidor y **jamás** lleva el prefijo `NEXT_PUBLIC_`.
4. **No escribas de memoria APIs de librerías.** Tu conocimiento puede estar desactualizado y estas versiones son nuevas. Antes de usar Next.js, `firebase-admin`, `firebase`, `@vercel/blob`, `tesseract.js`, `exceljs` o `zod`: comprueba la versión instalada (`npm ls <paquete>`) y lee los tipos en `node_modules/<paquete>` o su documentación oficial. Para Next.js, lee `node_modules/next/dist/docs/`. Instala versiones **exactas** (`npm install --save-exact`) tras mirar la última (`npm view <paquete> version`).
5. **Los límites de Vercel cambian.** Antes de decidir duración, tamaño de lote o tamaño de paquete, consulta https://vercel.com/docs/functions/limitations y https://vercel.com/docs/vercel-blob/usage-and-pricing.
6. **Pide permiso antes de acciones difíciles de deshacer o que salgan de tu computador**: crear cuentas o recursos en la nube, cambiar variables de entorno, desplegar, `git push --force`, y sobre todo **borrar datos** (incluido el botón «Borrar todo» de la aplicación, que vacía Firestore y Blob completos). Las pruebas automáticas deben **limpiar solo lo que ellas mismas crearon**, nunca "todo"; y «lo que crearon» se comprueba, no se supone: un número de factura o un cliente pueden pertenecer a otro lote (dos conjuntos de facturas numeran ambos desde `FE-000001`), así que se borra un índice solo si apunta a una factura del lote y un cliente solo si lo creó ese lote.
7. **Sé honesto con los resultados.** Si una prueba falla, muestra la salida. Si un paso de esta guía no funciona como dice, dilo y explica qué cambiaste. **Nunca modifiques una prueba para que pase** sin explicar por qué la prueba estaba mal. **Mide, no supongas**: las cifras de exactitud de esta guía son de un conjunto concreto; el tuyo puede variar.
8. **Verifica en el despliegue, no solo en local.** Dos fallos de este proyecto solo aparecían en Vercel (Fase A y Fase 5) y pasaban todas las pruebas locales. Una fase que toca servidor no está terminada hasta que funciona en la URL desplegada.
9. **No te adelantes ni agregues funciones que no pidió la fase.** Si ves una mejora, propónla al final; no la hagas sin que te la pidan.
10. **Código**: TypeScript en modo estricto, sin `any` (salvo justificación en un comentario). `camelCase` para variables y funciones, `PascalCase` para tipos y componentes, colecciones de Firestore en `snake_case` plural (`clientes`, `facturas`, `indices_numero`, `procesos`), campos en `camelCase`, importes en pesos COP como **enteros** (nunca decimales). Comentarios en español que expliquen el *porqué*, no el *qué*.
11. **Commits**: uno por fase, mensaje `fase-3: subida de carpeta a Blob`, y etiqueta `fase-N`. Antes de commitear: `npm run lint`, `npx tsc --noEmit` y `npm test` deben pasar.
12. **Si una credencial se imprime o se pega por error** en un chat, un log o un commit, considérala comprometida: genera una nueva en la consola del servicio, borra la anterior y actualiza `.env` y Vercel.

### Detector de código desactualizado (Next.js 16)

Si vas a escribir algo de esta lista, **para y lee la documentación** en `node_modules/next/dist/docs/`:

- `middleware.ts` ahora es **`proxy.ts`** (exporta `proxy`, no `middleware`).
- `params` y `searchParams` son **`Promise`**: hay que hacer `await`. Las rutas dinámicas de Route Handlers reciben `RouteContext<"/api/…/[id]">`; ese tipo lo genera `npx next typegen` (si TypeScript dice que no existe, ejecútalo).
- No uses `getServerSideProps`, `pages/` ni `next lint` (no existe: usa ESLint directo, `npm run lint`).
- Paquetes nativos o con WASM/hilos del servidor se declaran en `serverExternalPackages` (aquí: `tesseract.js`; `firebase-admin` y `sharp` ya vienen excluidos por defecto).
- Con `cacheComponents: true` (que usa este proyecto): **no existen** `export const dynamic`, `revalidate` ni `fetchCache` (dan error de compilación); una ruta es dinámica si lee algo de la petición o si llama `await connection()` de `next/server`; las páginas con segmentos dinámicos (`/procesos/[id]`) leen `params` dentro de un `<Suspense>`. `export const maxDuration` sí funciona.
- `cookies()` y `headers()` son asíncronas.
- React 19 + reglas de lint del proyecto: no llamar `setState` de forma síncrona dentro de un `useEffect`; no llamar funciones impuras (`Date.now()`) al renderizar.

## 3. Pila tecnológica y versiones exactas

| Pieza | Elección (versión del repositorio de referencia) | Por qué / nota |
|---|---|---|
| Hosting | **Vercel**, plan Hobby, proyecto enlazado a GitHub | Cada `git push` despliega. Node 24 (`"engines": { "node": "24.x" }`). |
| Framework | **Next.js 16.4.5**, App Router, TypeScript estricto, React 19.3.0 | Route Handlers como API. Opción `cacheComponents: true`. |
| Archivos | **Vercel Blob** (`@vercel/blob` 2.8.2), store **privado** | Las facturas tienen datos de clientes. El acceso (privado/público) **no se puede cambiar** tras crear el store. El navegador **no** habla con Blob: manda cada imagen a nuestra API, que la valida y es quien escribe en el almacén (`put` desde el servidor). |
| Base de datos | **Cloud Firestore** vía `firebase-admin` 14.5.0, **solo desde el servidor** | NoSQL de documentos. La cuenta de servicio se salta las reglas, por eso las **reglas deben quedar en "denegar todo"**. |
| Autenticación | **Firebase Authentication** (correo y contraseña): `firebase` 13.2.0 en el navegador | El servidor cambia el ID token por una **cookie de sesión** y la verifica en cada ruta. |
| OCR | `tesseract.js` 7.0.0 + `@tesseract.js-data/spa` 1.0.0 | WASM; los datos del idioma vienen del paquete npm (sin descargas de red). |
| Imagen | `sharp` 0.35.5 | Preprocesado para el reintento de OCR. |
| Validación | `zod` 4.6.7 | Instalado para validar entradas; las reglas de negocio de las facturas son funciones puras propias. |
| Excel | `exceljs` 4.4.0 | Celdas numéricas reales con formato de moneda. |
| Estilos | Tailwind CSS 4 | Colores como variables CSS por rol, con modo oscuro. |
| Pruebas | `vitest` 5.1.0; `playwright` 1.65.0 para probar la interfaz con navegador real | |
| Solo profesor | `@faker-js/faker` 10.6.0 (+ `playwright`, `sharp`) | Generador de facturas sintéticas (Fase G). |
| Parche necesario | `overrides: { "firebase-admin": { "jwks-rsa": "3.2.2" } }` en `package.json` | Ver Fase A: sin esto, `firebase-admin/auth` no carga en Vercel. |

Comprobar compatibilidad entre `vitest`, `firebase-admin` y `@types/node` (hubo un conflicto de pares con `@types/node@20`; el proyecto usa la serie 24, igual que Node).

## 4. Por qué el diseño es así (restricciones de Vercel)

Entender estas cuatro restricciones explica casi todas las decisiones del proyecto:

1. **No hay un proceso que viva mucho tiempo.** Las funciones son efímeras (Hobby: máximo 300 s por invocación). Un "trabajo en segundo plano" en memoria del servidor no funciona. Por eso el avance se guarda en la base de datos y el trabajo se reparte en **lotes pequeños e idempotentes** (se pueden repetir sin duplicar nada) que un **motor en el navegador** va pidiendo.
2. **El cuerpo de una petición no pasa de 4,5 MB.** Por eso cada imagen viaja en **su propia petición** a nuestra API (una factura pesa unos 100 KB; el servidor rechaza lo que pase de 4 MB). Decisión consciente: la API valida cada archivo y el navegador nunca recibe permisos sobre el almacén. Contrapartida: una invocación por imagen y un tope de tamaño; con archivos de decenas de MB habría que reconsiderarlo (la alternativa, subida directa con un token de un solo uso, evita el límite pero entrega permisos al navegador).
3. **El sistema de archivos es de solo lectura** (salvo `/tmp`). Todo lo persistente va a Blob o a Firestore. Un servidor en la nube tampoco puede escribir en el disco del usuario: el Excel se guarda en Blob y se descarga desde la interfaz.
4. **1 vCPU en Hobby.** Un pool propio de hilos no acelera nada; el paralelismo se logra con **varias invocaciones concurrentes** de la función (el motor lanza 3 llamadas `lote` a la vez y Vercel crea una instancia por cada una).

Consecuencia de seguridad: al no existir un explorador de carpetas del servidor desaparece el riesgo de recorrer su disco, pero aparece otro: cualquiera con la URL podría gastar cuota de Blob, Firestore y CPU. Por eso la autenticación se construye **antes** de la subida (Fase A) y todas las rutas la exigen; y por eso el servidor valida cada imagen (tamaño, tipo real y que se pueda leer) antes de guardarla.

## 5. Mapa del repositorio

```
src/app/                       páginas y Route Handlers (la API)
  page.tsx                     «Procesar facturas» (subida por lotes)
  metricas/page.tsx            panel de métricas
  revision/page.tsx            lista de facturas pendientes de revisión
  revision/[hash]/page.tsx     formulario de revisión manual (imagen + datos)
  procesos/[id]/page.tsx       detalle de un lote (avance, Excel, tabla de facturas)
  login/page.tsx               inicio de sesión
  api/sesion/route.ts          login/logout: ID token → cookie de sesión
  api/procesos/route.ts        crea un lote / lista los del usuario
  api/procesos/[id]/…          imagenes (sube y valida), iniciar, lote, finalizar, excel, facturas, estado
  api/metricas/route.ts        métricas de todos los lotes (1 lectura por lote)
  api/facturas/route.ts        facturas pendientes de revisión humana
  api/facturas/[hash]/route.ts detalle y guardado de la revisión manual (PUT)
  api/facturas/[hash]/imagen/  sirve la imagen original desde el Blob privado
  api/datos/borrar/route.ts    «Borrar todo» (confirmación escrita)
  api/salud/route.ts           diagnóstico del despliegue (exige sesión)
src/proxy.ts                   redirección optimista a /login si no hay cookie
src/componentes/               Motor, MenuSuperior, NuevoProceso, PanelMetricas, VistaProceso, ui…
src/lib/firebase/              admin.ts (servidor) y cliente.ts (navegador, solo Auth)
src/lib/auth/sesion.ts         cookie de sesión y exigirUsuario(request)
src/lib/modelo/tipos.ts        tipos de las colecciones de Firestore
src/lib/ocr/                   motor (tesseract), extractor, validador, nit, leer-factura
src/lib/procesamiento/         cola, lote, guardar, iniciar, finalizar, metricas, avance
src/lib/excel/generar.ts       generación del Excel
src/lib/blob.ts, rutas.ts      utilidades de Blob (servidor) y de rutas de archivos
src/lib/imagen.ts              validación pura de imágenes por sus bytes (con pruebas)
scripts/                       verificaciones y herramientas (ver sección 9)
docs/fuente/                   fuente de AGENTS.md y CLAUDE.md (solo en el repositorio de referencia)
docs/presentaciones/           dos presentaciones HTML para la clase: automatización y construcción paso a paso
```

## 6. Datos del ejercicio y plan paso a paso

### Datos del ejercicio (criterio de aceptación)

El profesor entrega **una carpeta `facturas/` con 1000 imágenes** (`factura_0001.png|jpg` … `factura_1000`), solo imágenes, de **850 clientes distintos**: 850 clientes aparecen una vez y **150 facturas son de clientes que ya existen** (repetidos). Las imágenes son sintéticas (datos ficticios): 4 diseños de factura (250 de cada uno), 3 calidades (60 % limpias, 30 % de calidad media, 10 % malas: rotadas, borrosas o de baja resolución), 150 con impoconsumo (telefonía móvil). **Entre las 1000 hay 40 facturas con un problema deliberado que la máquina nunca debe aceptar** (10 de cada tipo: el total impreso no cuadra con los ítems, el IVA no es el 19 % —5 % o exento—, el dígito de verificación del documento del cliente es incorrecto, y la imagen viene girada), para que la revisión manual (Fase 9) sea obligatoria y no opcional. **Esa carpeta se elige desde el navegador** (selector de carpeta) y se sube a Blob: no se copia a ninguna ruta del servidor.

Al terminar de procesar la carpeta completa:

- `facturas` tiene **1000 documentos**. Las dudosas quedan con `estado = "revision"`: **no se pierden**. Como mínimo **40 quedan en revisión sí o sí** (las de problema deliberado); ninguna de ellas puede aparecer como «leída correctamente».
- `clientes` tiene **850 documentos** una vez que una persona haya revisado a mano las 40 (la factura con el dígito de verificación del cliente equivocado no crea cliente hasta que se corrige), sin duplicados ni clientes inventados por errores del OCR.
- **Reprocesar la misma carpeta no duplica nada** (idempotencia), aunque las imágenes se suban otra vez con otra ruta.
- Cada lote tiene su Excel y sus métricas; la suma de la columna Total del Excel coincide con la base de datos.

**Qué exactitud esperar.** Medida en el repositorio de referencia **sobre las 1000 facturas del curso** (solo extracción, sin base de datos): **875 aceptadas automáticamente (88 %) y 125 a revisión** (40 de ellas son los casos problemáticos deliberados, que siempre van a revisión; el resto, 85, son lecturas que el OCR no logró); de las 875 aceptadas, **872 totalmente correctas y 3 con un error que la validación no detectó**. Con otros conjuntos de facturas la cifra varió entre 82 % y 98 %, y una muestra de 100 del mismo conjunto dio 85 %: una muestra pequeña engaña. El 100 % no existe con OCR sobre imágenes degradadas, y por eso existe la **revisión manual** (Fase 9). Los motivos de revisión más comunes: documento del cliente no leído, proveedor no leído e ítems que no suman el subtotal. Una factura "aceptada" solo significa que pasó todas las validaciones; un error que cuadre aritméticamente (por ejemplo, un dígito mal leído en el número de factura) puede pasar. **Mide con tu conjunto; no supongas.**

### Orden recomendado

Las fases conservan el número histórico (por eso `fase-3` va después de `fase-5`): el orden de trabajo es el de esta tabla.

| Paso | Fase | Resultado | Cómo se demuestra |
|---|---|---|---|
| 1 | 0 | Cuentas y conexiones | `npx tsx scripts/probar-conexion.ts` → Firestore OK, Auth OK, Blob OK |
| 2 | 1 | Proyecto base y primer despliegue | `npm run build` y la URL de Vercel abre |
| 3 | 2 | Modelo de datos y reglas cerradas | `npx tsx scripts/verificar-reglas.ts` → 403 anónimos |
| 4 | A | Autenticación | login real + `curl` a `/api/procesos` sin cookie → 401 |
| 5 | 4 | Extractor y validador (lógica pura) | `npm test` |
| 6 | 5 | OCR dentro de una función de Vercel | 20 facturas leídas **en el despliegue** |
| 7 | 3 | Subida de la carpeta a Blob | 20 archivos bajo `procesos/<id>/` en el panel de Blob |
| 8 | 6 | Lotes, cola y guardado idempotente | procesar dos veces no duplica nada |
| 9 | 7 | Excel en Blob | la suma del Excel = la suma en Firestore |
| 10 | 8 | Interfaz, motor, métricas y borrado | recorrido completo con navegador real |
| 11 | 9 | Revisión manual de las facturas dudosas | `probar-correccion` y `probar-revision-ui` |
| 12 | D | Operación en Vercel | logs sin errores, nota de cuota |

### Fase 0 — Cuentas y conexiones (PREGUNTAR, no asumir)

**Objetivo.** Tener todos los servicios creados y el archivo `.env` completo, y comprobar que el computador se conecta a los tres: Firestore, Authentication y Blob. Va **antes de escribir cualquier código de base de datos o de Blob**. El estudiante crea los recursos; la IA solo lo guía y **nunca inventa ni escribe a mano valores de credenciales**.

**Pasos.**
1. Repositorio en GitHub (vacío o con el proyecto base). Pregunta al estudiante la URL.
2. Cuenta de **Vercel** (plan Hobby) e importar el repositorio como proyecto (cada `git push` despliega).
3. Proyecto de **Firebase** (https://console.firebase.google.com):
   - **Firestore Database** → modo **producción**; elige una región cercana a las funciones de Vercel (por defecto Washington D.C., `iad1`). **La ubicación no se puede cambiar después.**
   - **Authentication → Método de acceso →** habilitar **Correo electrónico/contraseña**.
   - **Configuración del proyecto → Tus apps →** crear una **app web** (da la configuración pública).
   - **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada** (un JSON secreto). De él solo se necesitan **tres campos**; no copies el resto.
4. En Vercel: **Storage → Blob →** crear un store **privado** y conectarlo al proyecto (esto crea `BLOB_READ_WRITE_TOKEN` en Vercel).
5. Copia `.env.example` a `.env` y rellénalo. Los **nombres** son estos (los valores son tuyos y nunca se suben a Git):

| Variable | De dónde sale | Pública |
|---|---|---|
| `BLOB_STORE_ID`, `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → tu store (o `vercel env pull`) | No |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | configuración de la app web de Firebase | Sí, por diseño |
| `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | del JSON de la cuenta de servicio (`project_id`, `client_email`, `private_key`) | **No, solo servidor** |
| `USUARIOS_PERMITIDOS` | correos autorizados, separados por comas (ver Fase A) | No |
| `DEEPSEEK_API_KEY` | opcional; el flujo no la usa | No |

   La clave privada lleva los saltos de línea escritos como `\n` literales y va **entre comillas dobles en `.env`**. En el **panel de Vercel** pega los valores **sin comillas** (allí las comillas se guardan tal cual y rompen el valor).
6. Define **las mismas variables en Vercel** (Settings → Environment Variables) para Production, Preview y Development. **Las variables solo se aplican a despliegues nuevos**: después de cambiarlas, haz Redeploy.
7. Comprueba que `.env*` está en `.gitignore` (con `!.env.example`) con `git check-ignore .env` **antes** de crear el archivo.
8. Escribe `scripts/probar-conexion.ts`: escribe, lee y borra un documento temporal en Firestore; lista usuarios de Authentication; lista el almacén de Blob; imprime "OK" o el error de cada uno **sin imprimir secretos**.
9. Crea un usuario de prueba: en la consola (Authentication → Usuarios) o con `scripts/crear-usuario.ts` (lee `CORREO` y `CLAVE` de variables de entorno, así la contraseña no queda en ningún archivo).

**Por qué.** Los tres servicios son la base de todo; si fallan, los errores de fases posteriores son imposibles de interpretar. La clave privada da **acceso de administrador** a tu proyecto de Firebase (se salta las reglas de seguridad): por eso vive solo en el servidor.

**Verificación.** `npx tsx scripts/probar-conexion.ts` imprime `Firestore OK`, `Auth OK` y `Blob OK`. No continúes hasta que funcione.

**Errores típicos.** Clave privada con saltos de línea mal escritos (debe ser `\n` literal entre comillas dobles); Firestore sin crear o con la API deshabilitada en Google Cloud; variables definidas en el entorno equivocado de Vercel; token de Blob ausente en local; comillas pegadas en el panel de Vercel.

**Pídele a tu IA.** "Guíame paso a paso para crear Firebase y Blob. No me pidas que te pegue ningún valor secreto; solo dime dónde copiarlo y cómo comprobar que quedó bien con `probar-conexion.ts`."

---

### Fase 1 — Proyecto base y primer despliegue

**Objetivo.** Un proyecto Next.js limpio, configurado para lo que viene, **desplegado ya** (así los problemas de despliegue aparecen pronto y no al final).

**Qué construyes.** `package.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx` trivial y `src/app/api/salud/route.ts`.

**Pasos.**
1. `npx create-next-app@latest` con TypeScript, ESLint, Tailwind, App Router, carpeta `src/` y alias de importación `@/*` → `src/*`. Revisa lo que genera antes de añadir nada.
2. Quita `next/font/google` (el entorno de build no siempre tiene acceso) y los archivos de ejemplo que no uses.
3. Fija Node: `"engines": { "node": "24.x" }` (que coincida con tu Node local).
4. En `next.config.ts`: `cacheComponents: true`, `serverExternalPackages: ["tesseract.js"]` y `outputFileTracingIncludes` (se completa en la Fase 5). `firebase-admin` y `sharp` **ya vienen excluidos por defecto**.
5. Instala dependencias con versiones exactas (sección 3). Al instalar `firebase-admin`, añade desde ya el `overrides` de `jwks-rsa` (ver Fase A).
6. `/api/salud`: ruta de diagnóstico que devuelve solo booleanos y nombres (nunca valores): si los datos de idioma de tesseract están en la función, si `sharp` carga y qué variables de entorno faltan. Usa `await connection()` para que se ejecute en cada petición.
7. Haz push y mira el despliegue.

**Por qué.** `serverExternalPackages` evita que el empaquetador rompa paquetes con hilos o WASM. `/api/salud` convierte "no sé qué pasa en Vercel" en un JSON legible.

**Verificación.** `npm run dev` abre la página; `npm run build` termina sin errores; el despliegue de Vercel queda en verde y su URL abre la página.

**Errores típicos.** `export const dynamic = "force-dynamic"` da error con `cacheComponents` (usa `await connection()`); una variable de entorno nueva no llega porque no hubo Redeploy.

**Pídele a tu IA.** "Antes de configurar `next.config.ts`, lee `node_modules/next/dist/docs/` sobre `cacheComponents`, `serverExternalPackages` y `outputFileTracingIncludes` y dime qué cambia respecto a lo que tú recuerdas."

---

### Fase 2 — Modelo de datos (Firestore)

**Objetivo.** Diseñar las colecciones y dejar las reglas de Firestore cerradas.

**Qué construyes.** `src/lib/firebase/admin.ts` (inicializa `firebase-admin` una vez; solo servidor), `src/lib/modelo/tipos.ts` y `scripts/verificar-reglas.ts`.

**Firestore es de documentos, no relacional.** Aquí el diseño parte de qué consultas hacen falta y de cómo garantizar **unicidad** (no hay `UNIQUE`): se usa el valor único como **ID del documento** y se crea dentro de una **transacción**.

| Colección | ID del documento | Campos principales |
|---|---|---|
| `clientes` | el documento (NIT/CC sin puntos ni guion ni DV) → no puede haber dos | `documento`, `dv`, `nombre`, `creadoEn`, `primerProcesoId` |
| `facturas` | **SHA-256 de la imagen** (existe siempre, aunque el OCR falle) → el mismo archivo nunca se guarda dos veces | `numero`, `fecha` (emisión, `yyyy-mm-dd`), `proveedor`, `nitProveedor`, `clienteDocumento` (`null` si no pasó el DV), `clienteNombre`, `subtotal`, `iva`, `impoconsumo`, `total` (enteros COP), `estado` (`aceptada`\|`revision`), `motivos[]`, `archivo`, `blobPathname`, `confianzaOcr`, `procesoId`, `uid`, `creadoEn`, `items[]` (embebidos: `descripcion`, `cantidad`, `precioUnitario`, `subtotal`); y, desde la Fase 9, `dvProveedor`, `clienteDv`, `clienteDocumentoLeido`, `corregidaManualmente`, `corregidaPor`, `motivosOriginales`, `validacionesIgnoradas` |
| `indices_numero` | el número de factura (`FE-000123`) | `{ hashArchivo }` — hace único el número; se crea en la misma transacción que la factura |
| `procesos` (un **lote**) | id automático | `uid`, `carpeta`, `estado` (`subiendo`\|`ejecutando`\|`terminado`), `totalArchivos`, `inicio`, `fin`, `rutaExcel`, `finalizandoDesde`, `metricas` (Fase 8) |
| `procesos/{id}/archivos` (la **cola de trabajo**) | el nombre del blob | `blobPathname`, `nombre`, `estado`, `resultado` (`aceptada`\|`revision`\|`duplicada`\|`error`), `clienteNuevo`, `clienteExistente`, `hashArchivo`, `intentos`, `error`, **`disponibleDesde`** |

`disponibleDesde` (milisegundos de época) es un **arrendamiento**: `0` mientras espera, `ahora + 5 min` mientras alguien lo procesa (caduca solo si la función se cae) y `Number.MAX_SAFE_INTEGER` cuando termina. Así la cola se consulta con **un solo campo** (`where("disponibleDesde", "<=", ahora)`) y no hace falta un índice compuesto.

**Reglas de seguridad:** **denegar todo** (`allow read, write: if false;`). Todo el acceso pasa por el servidor. Comprueba que no queden las reglas del "modo de prueba", que dejan la base abierta y caducan a los 30 días.

**Por qué.** El ID de la factura es el hash del archivo porque siempre existe y hace imposible duplicar. El ID del cliente es su documento porque el OCR altera los nombres: **un cliente se identifica por documento, nunca por nombre**. Los ítems van embebidos porque siempre se leen junto con la factura y son pocos.

**Verificación.** `npx tsx scripts/probar-conexion.ts` sigue en verde. `npx tsx scripts/verificar-reglas.ts` hace peticiones **anónimas** a Firestore (solo con la `apiKey` pública) y debe recibir **403** en lectura y escritura de `clientes`, `facturas` y `procesos`.

**Errores típicos.** Una consulta que combina filtros o un filtro con una agregación puede pedir un **índice compuesto**: Firestore devuelve un enlace para crearlo en el mensaje de error (ejemplo: `sum()` filtrado por `procesoId`). Importes como decimales o texto: usa enteros.

**Pídele a tu IA.** "Explícame con un ejemplo por qué usar el hash como ID del documento impide duplicados, y qué pasaría si dos lotes intentaran crear la misma factura a la vez."

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

---

### Fase 5 — OCR dentro de una función de Vercel

**Objetivo.** Leer imágenes con OCR **dentro de una función desplegada** (no solo en tu computador), con una estrategia de reintentos y sin que una falla cuelgue la función.

**Qué construyes.** `src/lib/ocr/motor.ts`, `src/lib/ocr/leer-factura.ts` y la configuración de empaquetado en `next.config.ts`.

**Pasos.**
1. **Motor** (`motor.ts`): crea **un** worker de `tesseract.js` con idioma `spa` (`createWorker("spa", 1, { langPath, gzip: true, cachePath: os.tmpdir(), cacheMethod: "none" })`). `langPath` apunta a `node_modules/@tesseract.js-data/spa/4.0.0_best_int` (comprueba la ruta real instalada) para que **no haya descargas de red**; los archivos son `.traineddata.gz`, de ahí `gzip: true`; el único sitio escribible en Vercel es `/tmp`. El worker se guarda en `globalThis` para **reutilizarlo entre invocaciones** de la misma instancia caliente. Expone `leerImagen(buffer, modo): { texto, confianza }`. La imagen llega como `Buffer` descargado de Blob, nunca del disco.
2. **Tres modos** de lectura: `original`; `preprocesado` (con `sharp`: respetar la orientación EXIF, escala de grises, `normalize`, ampliar 1,5× y `sharpen`); y `encabezado` (franja superior del 30 % **invertida**, que recupera texto blanco sobre fondo de color: proveedor y NIT de uno de los diseños).
3. **Estrategia** (`leer-factura.ts`): leer el original → extraer → validar; si hay motivos, reintentar en modo preprocesado y quedarse con el resultado que tenga **menos motivos**; si siguen, leer el encabezado y **anteponer** su texto al mejor texto, y volver a elegir. Lo que siga fallando queda en revisión.
4. **Topes de tiempo** (60 s al arrancar el worker y 60 s por lectura): el worker corre en un hilo aparte; si no puede cargar un archivo, **el hilo muere en silencio y la promesa nunca se resuelve**. Sin tope, la función se cuelga hasta agotar el tiempo (504). Con tope falla con un mensaje claro, se descarta el worker (el siguiente intento arranca uno nuevo) y el lote lo reintenta.
5. **Empaquetado** en `next.config.ts`: tesseract carga con `require` dinámico el núcleo WASM y varias dependencias, y los datos del idioma con una ruta calculada; el trazador de archivos de Next **no los ve** y no entran a la función. Hay que incluirlos con `outputFileTracingIncludes` en las rutas que hacen OCR (`/api/procesos/**`): `node_modules/@tesseract.js-data/spa/4.0.0_best_int/**/*`, `node_modules/tesseract.js/**/*`, **todo** `node_modules/tesseract.js-core/**/*` (el núcleo que elige el worker depende de la CPU: `relaxedsimd`, `simd` o base, con o sin `lstm`; excluir variantes dio `Cannot find module`) y las dependencias `bmp-js`, `idb-keyval`, `is-url`, `node-fetch`, `regenerator-runtime`, `wasm-feature-detect`, `zlibjs`, `whatwg-url`, `tr46`, `webidl-conversions`. El paquete de la función queda en unos 113 MB (límite: 250 MB sin comprimir).
6. **Simular el empaquetado en local**: `output: "standalone"` copia **solo** los archivos trazados. El repositorio de referencia lo activa con la variable `NEXT_STANDALONE=1` (`NEXT_STANDALONE=1 npm run build` y luego `node .next/standalone/server.js` con tu `.env` copiado dentro). Sirve para detectar archivos que faltan, pero **no detecta todo** (en local se eligió otra variante del núcleo que en Vercel): la prueba definitiva es el despliegue.

**Por qué.** `tesseract.js` ya usa hilos internamente; con 1 vCPU un pool propio no acelera nada, el paralelismo lo da el motor del navegador (Fase 8). El reintento con imagen preprocesada y con el encabezado invertido es lo que sube la tasa de facturas aceptadas.

**Verificación.** Procesar **20 facturas ya subidas a Blob ejecutándose en el despliegue de Vercel (no solo en local)** e imprimir tiempo total, tiempo por imagen y los campos extraídos. Si solo funciona en local, la fase **no** está terminada. (En el repositorio de referencia esta verificación se hace con `scripts/probar-http.ts` una vez construidas las Fases 3 y 6; si quieres verificar antes, escribe una ruta temporal protegida con sesión y bórrala al terminar.) Referencia medida en Vercel Hobby: unos **1,5 s por factura** en promedio con 3 lotes concurrentes; el primer lote tras un arranque en frío tardó ~9 s.

**Errores reales de esta fase (solo en Vercel).**
- `/lote` responde **504 `FUNCTION_INVOCATION_TIMEOUT`**: el worker no encontraba `tesseract.js-core` (no estaba en el paquete) y se colgó.
- `Cannot find module 'tesseract.js-core/tesseract-core-relaxedsimd'`: se había incluido solo la variante `lstm`.
- Faltan los datos de idioma: tesseract intentaría descargarlos de internet.

**Pídele a tu IA.** "Explícame por qué el worker puede quedarse colgado sin dar error, qué hace `outputFileTracingIncludes` y cómo puedo comprobar qué archivos entraron al paquete de la función."

---

### Fase 3 — Selección y subida de la carpeta (a través de la API)

**Objetivo.** Elegir una carpeta con miles de imágenes en el navegador y subirla **a través de nuestra API**, que valida cada archivo y es la única que escribe en Blob, sin que la página se bloquee.

**Qué construyes.** `src/lib/imagen.ts` (validación pura por bytes, con pruebas en `src/lib/imagen.test.ts`), `src/lib/rutas.ts` (nombres de archivo), `src/app/api/procesos/[id]/imagenes/route.ts` (recibe y valida **una imagen por petición**), `src/lib/procesamiento/subidas.ts`, `POST /api/procesos` en `src/app/api/procesos/route.ts` (crea el lote) y la parte de subida de `src/componentes/NuevoProceso.tsx`.

**Pasos.**
1. **Elegir la carpeta**: `<input type="file" webkitdirectory multiple>` (el navegador no entrega rutas reales del disco). TypeScript no conoce `webkitdirectory`: usa un `@ts-expect-error` comentado. Un `<input type="file">` sin estilo es solo texto; envuélvelo en una `<label>` con apariencia de botón y deja el input con `sr-only`. Ofrece también "Elegir archivos" (algunos navegadores móviles no soportan carpetas). Filtra en el cliente `.png/.jpg/.jpeg` y muestra el conteo y el tamaño.
2. **Lotes**: divide la selección en trozos (por defecto 100). Cada trozo es un lote: `POST /api/procesos` crea un documento en `procesos` (estado `subiendo`, con el `uid`) y devuelve el `id`.
3. **Una petición por imagen**: `fetch("/api/procesos/<id>/imagenes?indice=N&nombre=…", { method: "POST", headers: { "content-type": tipo }, body: archivo })`; el cuerpo es el propio `File` (el navegador envía los bytes, sin `multipart`). **Seis en paralelo**; hasta 3 intentos con espera creciente para fallas de red o errores 5xx; un **rechazo 4xx del servidor no se reintenta** (el archivo es el problema). **Un archivo que falla no detiene el resto**: queda en una lista, con su motivo, para «Reintentar esos archivos».
4. **La ruta valida en este orden**: sesión (401) → el lote existe, es del usuario y está en `subiendo` (404; la respuesta afirmativa se recuerda 20 s en la memoria de la instancia para no leer Firestore por cada imagen) → índice válido (400) → **tamaño** ≤ 4 MB, mirando la cabecera `content-length` y los bytes reales (413) → **tipo real por la firma de los primeros bytes** (PNG o JPEG; no se confía en el nombre ni en el `content-type` que declara el navegador) (415) → la imagen **se puede decodificar** con `sharp` y no pasa de 40 millones de píxeles (415/413) → nombre final `procesos/<id>/<NNNN>-<nombre limpio>` **con la extensión del tipo real** → `put` en el Blob privado desde el servidor. Responde `{ pathname }`.
5. Al terminar de subir, `iniciar` (Fase 6) lista el prefijo del lote con `list()`; no se depende de ningún aviso del almacén.

**Por qué.** La API es la **única** que habla con Blob: valida con las reglas del negocio, el navegador nunca recibe permisos sobre el almacén y un archivo que no sea una imagen válida jamás llega a él. **Contrapartida, dicha con claridad**: hay una invocación de función por imagen, y una petición no puede pasar de 4,5 MB en Vercel (por eso el tope de 4 MB; las facturas pesan ~100 KB y la mayor del conjunto del curso, 192 KB). Si algún día hubiera archivos de decenas de MB, esta decisión habría que reconsiderarla (la alternativa es la subida directa con un token de un solo uso, que evita el límite a cambio de entregar permisos al navegador).

**Verificación.** Elegir la carpeta, subir 20 imágenes y ver en el panel de Blob los 20 archivos bajo `procesos/<id>/`. Además, el servidor debe **rechazar**: sin sesión (401), un texto con nombre `.png` (415), un archivo con firma PNG pero dañado (415), más de 4 MB (413), un lote inexistente o ajeno (404) y un índice inválido (400). Referencia (`scripts/probar-http.ts` hace todas estas comprobaciones): 1000 imágenes (108 MB) subieron en **68 s** en producción (78 s desde un servidor local) y el navegador no se bloqueó (retraso máximo del bucle de eventos de 9 ms).

**Errores típicos.** Botón de archivos invisible (input sin estilo); olvidar el `content-type` o el índice en la petición; subir archivos de más de 4,5 MB y recibir el error de la plataforma antes de llegar a tu código; confiar en la extensión del archivo en vez de en sus bytes.

**Pídele a tu IA.** "Explícame por qué el tipo de un archivo se valida con sus primeros bytes y no con su extensión, y qué podría pasar si solo miráramos el nombre."

---

### Fase 6 — Procesamiento por lotes, guardado en la base de datos e idempotencia

**Objetivo.** Procesar miles de imágenes con funciones de corta vida, de forma que **repetir cualquier paso, o que una función se caiga a mitad, no duplique ni pierda nada**. El estado vive en Firestore, no en memoria.

**Qué construyes.** `src/lib/procesamiento/iniciar.ts`, `cola.ts`, `lote.ts`, `guardar.ts`, `finalizar.ts`, `proceso.ts`, y las rutas `src/app/api/procesos/[id]/iniciar/route.ts`, `src/app/api/procesos/[id]/lote/route.ts`, `src/app/api/procesos/[id]/finalizar/route.ts` y `src/app/api/procesos/[id]/route.ts`. Todas exigen sesión **y** comprueban que el lote es del usuario.

**Flujo.**
1. **`iniciar`** (`maxDuration` 60): lista con `list()` el prefijo `procesos/<id>/` de Blob (paginando de a 1000, solo imágenes), crea un documento en la cola por imagen con `BulkWriter` (un lote de escritura admite 500 operaciones) y pasa el lote a `ejecutando`. El **ID del documento sale del nombre del blob** y se usa `create()`: repetir la llamada no duplica (los que ya existen se ignoran). Responde de inmediato.
2. **`lote`** (`maxDuration` 300): **reclama** hasta 4 archivos dentro de **una transacción**: lee la cola con `where("disponibleDesde", "<=", ahora).orderBy("disponibleDesde").limit(4)` y a cada uno le pone `estado: "procesando"`, `intentos + 1` y `disponibleDesde: ahora + 5 min` (el arrendamiento). Dos invocaciones concurrentes nunca toman el mismo archivo (la transacción se reintenta si hay conflicto) y los que quedaron "procesando" por una función caída vuelven a estar disponibles cuando caduca el arrendamiento. Luego procesa cada archivo **en serie** y responde con un resumen (`reclamados`, `aceptadas`, `revision`, `duplicadas`, `errores`, tiempos).
3. **Presupuesto de tiempo**: antes de cada archivo el lote comprueba el tiempo transcurrido; pasados **200 s** (de los 300 máximos) **devuelve** los archivos que faltan a la cola sin contarlos como intento.
4. **Cada archivo**: descargar de Blob → **SHA-256 de la imagen** → **atajo previo al OCR**: si `facturas/{hash}` ya existe (1 lectura), se marca `duplicada` **sin gastar CPU** (reprocesar la misma carpeta pasa de minutos a segundos) → OCR + extraer + validar (Fase 5) → guardar.
5. **Guardar** (`guardarFactura`), en **una transacción** con **todas las lecturas antes de las escrituras** (regla de Firestore):
   - Lee `facturas/{hash}`, `indices_numero/{numero}` y, si el documento del cliente pasa el dígito de verificación, `clientes/{documento}`.
   - Si la factura ya existe → archivo `duplicada`, nada más.
   - Si el **número** ya existe pero el archivo es distinto (otro hash), **no se descarta**: se guarda en `revision` con el motivo "El número FE-… ya existe en otra factura" y sin crear el índice (podría ser un número mal leído; descartarla perdería una factura). Solo el mismo hash es duplicada.
   - El cliente se crea **solo si no existe** y nunca se sobrescribe su nombre. Si el documento no pasa el DV, `clienteDocumento` queda en `null`, la factura va a revisión y **no se crea cliente**.
   - Crea la factura (con ítems embebidos) y el índice del número, y marca el archivo `ok` con su `resultado` y `hashArchivo`.
   - Como el ID del cliente es su documento, es **imposible** que existan dos clientes iguales, aunque dos lotes concurrentes lo intenten a la vez.
6. **Errores**: un error en una imagen **no detiene el lote**: se registra en `archivos.error`; se reintenta hasta 3 intentos (vuelve a la cola) y, si sigue fallando, `guardarFallo` deja la factura en `revision` con el motivo y el archivo en `error`.
7. **`finalizar`** (`maxDuration` 300, idempotente): si queda algún archivo sin terminar (cuenta con `count()` los `disponibleDesde < MAX_SAFE_INTEGER`) responde `listo: false`. Si no, **toma el cierre** en una transacción (`finalizandoDesde`, bloqueo de 2 min, para que solo un cliente genere el Excel), genera el Excel (Fase 7), lo sube a Blob y pasa el lote a `terminado`.

**Quién llama a `lote`**: el **cliente**