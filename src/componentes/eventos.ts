/*
 * Avisos entre componentes del navegador que no se conocen entre sí: quien sube
 * un lote avisa al motor de que hay trabajo, y el motor avisa a los paneles de
 * que un lote terminó (para que se refresquen al instante, sin esperar al sondeo).
 */

export type EventoLote = "lote-iniciado" | "lote-terminado";

export function emitir(evento: EventoLote, procesoId: string): void {
  window.dispatchEvent(new CustomEvent(evento, { detail: { id: procesoId } }));
}

/** Devuelve la función que deja de escuchar (para el `return` de un efecto). */
export function escuchar(evento: EventoLote, alOcurrir: (procesoId: string) => void): () => void {
  const manejador = (e: Event) => alOcurrir((e as CustomEvent<{ id: string }>).detail.id);
  window.addEventListener(evento, manejador);
  return () => window.removeEventListener(evento, manejador);
}
