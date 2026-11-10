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
