# Operación del procesador de facturas en Vercel (Fase D)

Despliegue: https://automatizacion-iota-murex.vercel.app (Vercel Hobby, Node 24).
Servicios: Firestore y Firebase Authentication (datos y sesión), Supabase Storage (archivos, bucket privado `bills`).

Verificado en producción el 2026-11-12, con las 11 facturas de `salida/facturas`.

## 1. Variables de entorno

Se definen en `.env` (local, nunca en Git) y en Vercel → Settings → Environment Variables, en **Production, Preview y Development**. Un cambio solo llega a los despliegues nuevos: después de cambiar una variable hay que hacer *Redeploy*.

| Variable | Para qué | ¿Pública? |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | inicio de sesión en el navegador | Sí, por diseño |
| `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | Firestore y verificación de la sesión en el servidor | **No** |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | dirección del proyecto de Supabase (la clave anónima no da acceso al bucket privado) | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | leer y escribir archivos del bucket desde el servidor | **No** |
| `SUPABASE_BUCKET` | nombre del bucket (`bills`) | No |
| `USUARIOS_PERMITIDOS` | correos autorizados, separados por comas; sin ella nadie entra | No |

**Comprobado (2026-11-12):** las 14 variables están en Vercel en los tres entornos. El historial de Git no contiene secretos. La única coincidencia de `BEGIN PRIVATE KEY` es el valor falso de `.env.example`; no hay claves con formato JWT ni `sb_secret_`; `.env` nunca se versionó y `.gitignore` lo excluye.

## 2. Límites de tiempo y tamaño de los lotes

| Ruta | `maxDuration` | Por qué |
|---|---|---|
| `POST /api/procesos/[id]/lote` | 300 s | OCR de hasta 4 facturas; el lote se corta a los 200 s y devuelve lo que falte a la cola |
| `POST /api/procesos/[id]/finalizar` | 300 s | genera el Excel del lote |
| `POST /api/datos/borrar` | 300 s | «Borrar todo» puede recorrer miles de documentos y archivos |
| `POST /api/procesos/[id]/iniciar`, `…/imagenes`, `…/regenerar-excel` | 60 s | operaciones cortas |

Cada llamada a `lote` reclama **4 facturas** (`ARCHIVOS_POR_LOTE`) y el Motor del navegador lanza **3 llamadas a la vez** (`TRABAJADORES`). Con 1 vCPU por función, el paralelismo sale de varias funciones a la vez, no de hilos. Medido en este despliegue: 10 facturas en 34,6 s y 11 facturas en 40,9 s, contando subida y procesamiento (3 lotes de 4).

## 3. Seguridad en producción

- **Toda la API exige sesión.** `npx tsx scripts/probar-rutas-sin-sesion.ts <url>` recorre `src/app/api` y llama sin cookie a cada ruta con cada método: todas responden 401 (19 llamadas a 16 rutas). Si alguien añade una ruta y olvida `exigirUsuario`, el script la detecta solo.
- **El bucket es privado.** El mismo script sube un archivo de prueba y comprueba que no se puede leer por la URL pública ni con la clave anónima, y que esa clave no puede listar el bucket. Después lo borra.
- **Firestore en «denegar todo».** `npx tsx scripts/verificar-reglas.ts`: 403 en lectura y escritura anónimas de `clientes`, `facturas` y `procesos`.

**Comprobado contra producción (2026-11-12):** las 19 llamadas respondieron 401, las 4 comprobaciones del bucket pasaron y las 6 de las reglas también.

## 4. Política de archivos

Cada lote guarda en el bucket sus imágenes (unos 100 KB cada una) y su Excel, bajo `procesos/<id>/`.

**Decisión: se borran con «Borrar todo» entre prácticas.** No hay limpieza automática por antigüedad: con el volumen del curso no compensa un trabajo programado. «Borrar todo»:

- vacía `facturas`, `indices_numero`, `clientes`, `procesos` (con su cola) y la carpeta `procesos/` del bucket;
- no toca las cuentas de usuario;
- exige escribir BORRAR y una confirmación adicional si hay lotes procesándose.

Es irreversible: antes de usarlo, descarga los Excel que quieras conservar.

Para saber cuánto ocupa el bucket: `npx tsx scripts/medir-almacen.ts`, que solo lee.

## 5. Nota de cuota

Corrida del 2026-11-12, con las 11 facturas de `salida/facturas`. Incluye todas las pruebas de ese día: la corrida a mano con su reproceso, `probar-pipeline`, `probar-revision-ui`, `probar-ui` y `probar-correccion`, en local y en producción. Las cifras son, por tanto, un **techo**: una corrida sola gasta bastante menos.

| Servicio | Qué se mide | Valor |
|---|---|---|
| Firestore | lecturas del día (Firebase → Descripción general → Firestore) | **3,1 K** (6 % de las 50 000 diarias del plan gratuito) |
| Firestore | escrituras del día | **836** |
| Firestore | borrados | la vista general de Firebase no los muestra por separado |
| Supabase Storage | bucket después de la corrida a mano y su reproceso (`scripts/medir-almacen.ts`) | **24 archivos, 2,20 MB**: 22 imágenes (2,17 MB) y 2 Excel (26 KB), en 2 lotes |
| Vercel | invocaciones y CPU activa de las funciones | no medido. La vista consultada fue «Daemons Active CPU», que no aplica (sin datos). Las cifras de las funciones están en Vercel → Usage → **Function Invocations** y **Fluid Active CPU**. |
| Authentication | usuarios | **1** (la cuenta autorizada) |

Cada imagen ocupa unos 100 KB en el bucket. Una carpeta de 1000 facturas ocuparía unos 100 MB por cada vez que se suba; un reproceso vuelve a subir las imágenes, aunque no vuelve a guardar las facturas. De ahí la política de borrar entre prácticas.

La interfaz estima unas 5 lecturas por factura antes de subir.

## 6. Logs

Revisión de los *runtime logs* de Vercel tras la corrida (2026-11-12): **sin errores**. No aparecen `RESOURCE_EXHAUSTED` (cuota de Firestore) ni `FUNCTION_INVOCATION_TIMEOUT`. Los 401 y 404 que se ven son los que provocan a propósito las pruebas.

## 6 bis. Observación conocida: un intento de más bajo contención

En una ejecución de `scripts/probar-pipeline.ts` contra producción (2026-11-12) falló **1 de sus comprobaciones**: tras dos reclamos simultáneos de la cola, un archivo quedó con 2 intentos en vez de 1. Esa misma prueba había pasado entera al cerrar la Fase 6, y al repetir solo ese fragmento 10 veces no volvió a ocurrir. Es intermitente.

**Efecto, si ocurre:** el contador de intentos de un archivo sube uno de más. Como el tope es de 3 intentos (`INTENTOS_MAXIMOS`), en el peor caso un archivo se daría por fallido tras 2 intentos reales en vez de 3. **No se pierde:** queda como factura en revisión, con el motivo, para la revisión manual. No afecta a la unicidad de las facturas ni a la de los clientes.

Queda anotado para investigarlo aparte, en `src/lib/procesamiento/cola.ts` (Fase 6, cerrada). No se cambió código.

## 7. Aceptación final

Hecha con las 11 facturas de `salida/facturas`, por decisión del 2026-11-12. Las 1000 del profesor quedan pendientes: la guía estima de 25 a 35 minutos y unas 5 000 lecturas y 6 000 escrituras.

- [x] entre aceptadas, revisión y errores suman 11: `probar-pipeline` en producción dio 10 aceptadas y 1 en revisión, 0 errores, 11 facturas y 10 clientes
- [x] corrida a mano en producción: «Facturas procesadas (distintas)» = 11
- [x] cada lote tiene su Excel descargable, y se abre
- [x] la factura en revisión (0053) se corrigió a mano: Métricas dice «1 ya se revisaron a mano y 0 esperan», y el Excel regenerado muestra «Revisadas a mano: 1»
- [x] reproceso a mano de la misma carpeta: los lotes nuevos salen como duplicados y «Facturas procesadas» sigue en 11
- [x] reprocesar la misma carpeta no duplica nada: `probar-pipeline` en producción reconoció las 11 como duplicadas, sin guardarlas otra vez; facturas y clientes no cambiaron (3,4 s, sin OCR)
- [x] logs sin errores
