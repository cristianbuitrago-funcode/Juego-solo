/** Mini ayudante para construir DOM sin framework. */
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k === 'html') el.innerHTML = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): HTMLElement {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Barra de progreso sin cifras (el juego evita mostrar números exactos del mundo). */
export function meter(value: number, cls = ''): HTMLElement {
  const bar = h('div', { class: `meter ${cls}` }, h('div', { class: 'meter-fill', style: `width:${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }));
  return bar;
}

export function vibrate(ms = 12): void {
  try {
    if (document.body.dataset.haptics !== 'off') navigator.vibrate?.(ms);
  } catch {
    /* sin vibración */
  }
}

/** append() que ignora null/false (útil para contenido condicional). */
export function add(el: HTMLElement, ...nodes: (Node | string | null | undefined | false)[]): HTMLElement {
  for (const n of nodes) if (n !== null && n !== undefined && n !== false) el.append(n);
  return el;
}
