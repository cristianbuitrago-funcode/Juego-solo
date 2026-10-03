/**
 * Almacenamiento clave-valor. En el navegador / WebView de Android usa
 * localStorage; en pruebas (Node) cae a un mapa en memoria.
 */
const memory = new Map<string, string>();

function ls(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export const storage = {
  get(key: string): string | null {
    const s = ls();
    return s ? s.getItem(key) : (memory.get(key) ?? null);
  },
  set(key: string, value: string): void {
    const s = ls();
    if (s) s.setItem(key, value);
    else memory.set(key, value);
  },
  remove(key: string): void {
    const s = ls();
    if (s) s.removeItem(key);
    else memory.delete(key);
  },
};
