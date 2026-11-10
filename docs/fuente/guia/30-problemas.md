## 7. Problemas conocidos y cómo resolverlos

Todos ocurrieron de verdad construyendo este proyecto. Si ves el síntoma, empieza por la causa probable.

| Síntoma | Causa probable | Solución |
|---|---|---|
| **Todas** las rutas de API dan **500 en Vercel** pero funcionan en local | `firebase-admin/auth` → `jwks-rsa@4` → `jose@6` (solo ESM): `ERR_REQUIRE_ESM` en las funciones | `overrides: { "firebase-admin": { "jwks-rsa": "3.2.2" } }` en `package.json` y `npm install` (Fase A) |
| `lote` responde **504** `FUNCTION_INVOCATION_TIMEOUT` | El worker de tesseract no encontró su núcleo WASM (no estaba en el paquete) y se colgó sin error | `outputFileTracingIncludes` completo + topes de tiempo en `motor.ts` (Fase 5) |
| `Cannot find module 'tesseract.js-core/tesseract-core-relaxedsimd'` | Se incluyeron solo algunas variantes del núcleo | Incluir **todo** `node_modules/tesseract.js-core/**/*` |
| Login correcto pero **403 "Este correo no está autorizado"** | `USUARIOS_PERMITIDOS` ausente, con comillas pegadas en el panel de Vercel, o sin Redeploy | Definirla sin comillas en el entorno correcto y hacer Redeploy |
| Tras iniciar sesión todo da 401 en local | Cookie con `secure: true` sobre `http://localhost` | `secure` solo si `NODE_ENV === "production"` |
| Una variable nueva no llega a Vercel | Las variables solo se aplican a despliegues nuevos | Redeploy |
| `The query requires an index` (Firestore) | Consulta con filtros combinados o filtro + agregación (`sum`) | Abrir el enlace del mensaje y crear el índice; o rediseñar para usar un solo campo |
| Error de compilación: `Route segment config "dynamic" is not compatible with nextConfig.cacheComponents` | Con `cacheComponents` no existen `dynamic`, `revalidate`, `fetchCache` | Quitarlo y usar `await connection()` de `next/server` |
| TypeScript: `RouteContext` / `PageProps` no existen | Los tipos de rutas se generan | `npx next typegen` |
| `tsx` dice `Top-level await is currently not supported with the cjs output format` | El proyecto no es `"type": "module"` | Envolver el script en `async function main()` |
| La subida no muestra ningún botón | `<input type="file">` sin estilo es solo texto | `<label>` con apariencia de botón + input `sr-only` |
| Cerré la pestaña y dejó de procesar | El Motor corre en el navegador | Abrir cualquier página de la app: retoma los lotes `ejecutando` |
| Facturas en `revision` con "El número FE-… ya existe en otra factura" | Se mezclaron conjuntos con la misma numeración (o dos archivos distintos con el mismo número) | Es el comportamiento diseñado (no se pierden); genera/procesa un conjunto completo de una vez |
| `RESOURCE_EXHAUSTED` / cuota de Firestore | Se agotó el límite diario del plan gratuito | Esperar al día siguiente, reducir el tamaño de la prueba o usar un plan de pago |
| Las reglas de Firestore dejan leer a cualquiera | Quedaron las del "modo de prueba" | Reemplazar por `allow read, write: if false;` y correr `scripts/verificar-reglas.ts` |
| La IA imprimió el `.env` o la clave privada | Un comando que mostró valores (p. ej. `awk` sobre el `.env`) | Considerar la credencial comprometida: generar otra, borrar la anterior, actualizar `.env` y Vercel |
| `next dev` modifica `AGENTS.md` | Next mantiene su bloque `BEGIN:nextjs-agent-rules` | Dejar el bloque y commitearlo con tu trabajo |
| Lint: `react-hooks/set-state-in-effect` o `purity` | `setState` síncrono en un efecto, o `Date.now()` al renderizar | Mover la llamada a un callback/`async` o a un estado actualizado por eventos |
| Playwright: `strict mode violation … resolved to 2 elements` (`main`) | Durante la navegación coexisten la página vieja y la nueva | Selector más específico (por texto o `nth`) |
| Un lote «perdió» sus índices de número tras correr una prueba | El limpiador de la prueba borraba `indices_numero/{número}` de sus facturas sin mirar de quién era el índice (otro conjunto con la misma numeración) | Borrar el índice solo si su `hashArchivo` es el de la factura del lote, y el cliente solo si `primerProcesoId` es el lote (`scripts/limpiar-lotes.ts`); recrear los índices que falten |
| Un script fuera del proyecto dice `Cannot find module '@vercel/blob'` | Node resuelve módulos desde la carpeta del script | Mantener los scripts dentro de `scripts/` |
