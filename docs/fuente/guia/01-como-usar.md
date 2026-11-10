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
