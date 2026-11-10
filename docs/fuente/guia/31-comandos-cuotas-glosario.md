## 8. Cuotas y costos (plan gratuito)

Cifras de referencia; **verifícalas en la documentación vigente de cada servicio** (los límites cambian).

| Recurso | Dato |
|---|---|
| Firestore (plan gratuito) | 50 000 lecturas al día (dato del curso); también hay límites diarios de escrituras y de borrados (del orden de decenas de miles; verifícalos) |
| Una factura procesada | ~5 lecturas y ~6 escrituras (Fase 6) |
| 1000 facturas | ≈ 5 000 lecturas y ≈ 6 000 escrituras (estimado, no medido al detalle) |
| Borrar los datos de 1000 facturas | ≈ 4 000 borrados (facturas, índices, clientes y cola) + las lecturas para listarlos |
| Un `count()` de Firestore | como mínimo 1 lectura |
| Panel de métricas | 1 lectura por lote + 1 |
| Vercel Hobby | `maxDuration` 300 s, 1 vCPU, cuerpo de petición de 4,5 MB, paquete de la función 250 MB sin comprimir |

**Tiempos medidos** (Vercel Hobby, 3 lotes concurrentes de 4 archivos): ~1,5 s por factura en promedio (10 facturas en 15 s; 200 en ~7 min incluyendo la subida); **1000 facturas ≈ 25 a 35 minutos**. El arranque en frío del primer lote tarda unos 9 s.

## 9. Comandos y scripts

| Comando | Para qué |
|---|---|
| `npm run dev` / `npm run build` / `npm run start` | desarrollo, compilación de producción y servidor de producción local |
| `npm run lint` · `npx tsc --noEmit` · `npm test` | las tres comprobaciones previas a cada commit |
| `npm run docs` | regenera `AGENTS.md` y `CLAUDE.md` desde `docs/fuente/` (solo repositorio de referencia) |
| `npm run presentaciones` | regenera `docs/presentaciones/01-automatizacion.html` y `02-construccion.html` desde sus fragmentos (solo repositorio de referencia) |
| `npx tsx scripts/revisar-presentaciones.ts <carpetaCapturas>` | control de calidad de las presentaciones con navegador real: desbordes, textos que no caben, diagramas encogidos y capturas |
| `npm run generar:facturas -- --cantidad N --semilla S --salida <carpeta>` | generador de facturas (solo profesor, Fase G) |
| `npx tsx scripts/probar-conexion.ts` | Firestore, Auth y Blob responden (Fase 0) |
| `npx tsx scripts/verificar-reglas.ts` | las reglas de Firestore están cerradas (Fase 2) |
| `CORREO=… CLAVE=… npx tsx scripts/crear-usuario.ts` | crea un usuario de Firebase Auth sin dejar la contraseña en un archivo |
| `npx tsx scripts/ocr-muestras.ts <imágenes> <salida>` | guarda el texto del OCR de cada imagen en 3 modos (material para el extractor) |
| `npx tsx scripts/leer-carpeta.ts <imágenes> <verdad.json>` | mide el extractor sobre una carpeta (sin base de datos) |
| `npx tsx scripts/comparar-extraccion.ts <textos> <verdad.json>` | compara el extractor con los textos de OCR guardados |
| `npx tsx scripts/probar-pipeline.ts <imágenes> <verdad.json>` | prueba de servidor: Blob + cola + lotes + Excel + idempotencia (limpia lo que crea) |
| `CORREO=… CLAVE=… npx tsx scripts/probar-http.ts <url> <imágenes>` | recorrido completo **por HTTP** contra local o producción (limpia lo que crea) |
| `CORREO=… CLAVE=… npx tsx scripts/probar-ui.ts <url> <imágenes> <porLote> <capturas>` | prueba de la interfaz con navegador real (`--sin-procesar` para medir solo la subida) |
| `npx tsx scripts/probar-correccion.ts <verdad.json>` | prueba de integración (Firestore real) de la revisión manual: transacción, índices, cliente y contadores (limpia lo que crea) |
| `CORREO=… CLAVE=… npx tsx scripts/probar-revision-ui.ts <url> <imágenes> <verdad.json> <capturas>` | prueba de la revisión manual con navegador real y datos reales (limpia lo que crea) |
| `npx tsx scripts/limpiar-lotes.ts <idLote> …` | borra **solo** los lotes indicados |
| `npx tsx scripts/recalcular-metricas.ts <idLote>` | reconstruye las métricas de un lote |

## 10. Glosario

- **NIT / CC**: número de identificación tributaria (empresas) o cédula (personas). **DV**: dígito de verificación del NIT (algoritmo de la DIAN).
- **DIAN**: autoridad tributaria de Colombia. **Factura electrónica**: factura con número con prefijo, resolución de numeración y **CUFE** (código único, hash de 96 caracteres).
- **IVA**: impuesto al valor agregado, 19 % general. **INC / impoconsumo**: impuesto nacional al consumo, 4 % en telefonía móvil y datos.
- **COP**: pesos colombianos (en el proyecto, enteros sin decimales).
- **OCR**: reconocimiento óptico de caracteres: convertir la imagen de una factura en texto.
- **Lote**: en esta aplicación, una subida (un proceso) con su cola, su Excel y sus métricas.
- **Cola de trabajo**: la lista de archivos por procesar, guardada en Firestore.
- **Arrendamiento (lease)**: marca de tiempo que "reserva" un archivo mientras alguien lo procesa; si la función se cae, caduca y otro lo toma.
- **Idempotente**: se puede repetir sin cambiar el resultado (procesar dos veces la misma carpeta no duplica nada).
- **Hash (SHA-256)**: huella de 64 caracteres de un archivo; la misma imagen siempre da el mismo hash.
- **Transacción**: grupo de lecturas y escrituras que se aplican completas o no se aplican.
- **Cookie de sesión**: archivo pequeño que el navegador envía en cada petición para probar quién eres; aquí la crea el servidor y el navegador no puede leerla (`httpOnly`).
- **Motor**: el componente del navegador que va pidiendo al servidor que procese lotes.
