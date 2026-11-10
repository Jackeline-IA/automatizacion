<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — Procesador de facturas (Next.js + OCR + Vercel Blob + Firebase + Excel)

Instrucciones para **cualquier agente de IA** que ayude a construir este proyecto (Codex, Cursor, GitHub Copilot, Gemini CLI, Claude Code, ChatGPT con acceso al repositorio…). Si eres una IA: **lee este archivo completo antes de escribir una sola línea de código** y vuelve a consultarlo al empezar cada fase. Si eres un estudiante: es tu mapa; léelo tú también.

Resumen en una frase: una aplicación web desplegada en Vercel donde el usuario elige una carpeta con imágenes de facturas colombianas; la app las sube a Vercel Blob, las lee con OCR, extrae y valida los campos, los guarda en Firestore, calcula métricas y genera un Excel por lote.

Idioma: todo (código de dominio, textos de interfaz, mensajes de commit y explicaciones) en **español**.
