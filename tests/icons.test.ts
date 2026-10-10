import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_EMOJI } from '../src/ui/icons';

/** Todo lo que la interfaz enseña con un emoji debe tener su icono propio (los emojis del sistema cambian según el móvil). */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('iconos propios', () => {
  it('no queda ningún emoji en la interfaz sin icono dibujado', () => {
    const missing = new Map<string, string>();
    const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B50}\u{2705}\u{2716}\u{2753}-\u{2757}\u{2744}\u{23F3}\u{23CF}]/gu;
    for (const f of [...files('src/ui'), ...files('src/world'), ...files('src/core')]) {
      if (f.endsWith('icons.ts')) continue;
      for (const m of readFileSync(f, 'utf8').matchAll(re)) if (!KNOWN_EMOJI.has(m[0])) missing.set(m[0], f);
    }
    expect([...missing].map(([e, f]) => `${e} (${f})`)).toEqual([]);
  });
});
