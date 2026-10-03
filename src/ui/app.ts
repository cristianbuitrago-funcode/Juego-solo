import { advanceDay, createWorld, freeAgents, type DayReport } from '../core/api';
import { loadLegacy } from '../core/legacy';
import { hashString } from '../core/rng';
import { loadGame, saveGame } from '../core/save';
import type { WorldState } from '../core/types';
import { audio } from '../audio/audio';
import { clear, h, vibrate } from './dom';
import { MapView } from './map/view';
import { regionStatus, STATUS_LABEL } from './map/colors';
import { applySettings, loadSettings, saveSettings, type Settings } from './settings';
import { renderChronicle } from './screens/chronicle';
import { renderDecisions } from './screens/decisions';
import { showDawn, showEnd } from './screens/dawn';
import { showHelp } from './screens/help';
import { renderHypotheses } from './screens/hypotheses';
import { renderMenu, showGameMenu } from './screens/menu';
import { openRegionSheet } from './screens/region';
import { renderResearch } from './screens/research';
import { describeTooltip } from './screens/common';

export type View = 'mapa' | 'decisiones' | 'investigar' | 'hipotesis' | 'cronica';

/**
 * Controlador de la interfaz. Mantiene el mundo actual, la vista activa,
 * el mapa, la hoja de región y la pila de modales.
 */
export class App {
  w: WorldState | null = null;
  settings: Settings = loadSettings();
  view: View = 'mapa';
  map: MapView | null = null;
  selected: number | null = null;
  lastReport: DayReport | null = null;
  chronicleTab: 'dias' | 'cadenas' = 'dias';

  private shell: HTMLElement | null = null;
  private top: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private screenEl: HTMLElement | null = null;
  private nav: HTMLElement | null = null;
  private sheetEl: HTMLElement | null = null;
  private tooltipEl: HTMLElement | null = null;
  private modals: HTMLElement[] = [];

  constructor(public root: HTMLElement) {
    applySettings(this.settings);
    audio.setVolumes(this.settings.music, this.settings.sfx);
    // El audio solo puede arrancar tras un gesto del usuario.
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));
  }

  // -------------------------------------------------------------------------
  // Ciclo de partida
  // -------------------------------------------------------------------------
  showMenu(): void {
    this.closeAll();
    this.map?.destroy();
    this.map = null;
    this.w = null;
    clear(this.root);
    this.root.append(renderMenu(this));
  }

  newGame(seedText: string, eraLength: number): void {
    const seed = seedText.trim() ? hashString(seedText.trim()) : (Math.random() * 2 ** 32) >>> 0;
    const w = createWorld(seed, { eraLength, legacy: loadLegacy() });
    this.start(w);
    if (this.settings.tutorial) showHelp(this);
  }

  continueGame(): void {
    const w = loadGame('auto');
    if (w) this.start(w);
  }

  start(w: WorldState): void {
    this.w = w;
    this.view = 'mapa';
    this.selected = null;
    this.lastReport = null;
    this.buildShell();
    saveGame(w, 'auto');
  }

  saveSettings(): void {
    saveSettings(this.settings);
    applySettings(this.settings);
    audio.setVolumes(this.settings.music, this.settings.sfx);
    if (this.map) this.map.reduceMotion = this.settings.reduceMotion;
  }

  /** AVANZAR DÍA: el mundo procesa las consecuencias. */
  advance(): void {
    const w = this.w;
    if (!w) return;
    if (w.ended) {
      showEnd(this);
      return;
    }
    vibrate(20);
    audio.sfx('dia');
    const report = advanceDay(w);
    this.lastReport = report;
    saveGame(w, 'auto');
    if (this.map) {
      this.map.highlights = new Set(report.clues.map((c) => c.regionId));
      this.map.smokeAt = new Set(report.clues.filter((c) => c.kind === 'militar' || c.kind === 'construccion' || c.text.includes('humo')).map((c) => c.regionId));
    }
    audio.setMood(report.mood);
    if (report.newPetitions) audio.sfx('peticion');
    this.refresh();
    if (report.ended) showEnd(this);
    else showDawn(this, report);
  }

  /** Redibuja todo lo que depende del estado del mundo. */
  refresh(): void {
    if (!this.w) return;
    this.renderTop();
    this.renderNav();
    this.map?.setWorld(this.w);
    this.renderView();
    if (this.sheetEl && this.selected !== null) this.openRegion(this.selected, true);
  }

  // -------------------------------------------------------------------------
  // Estructura de pantalla
  // -------------------------------------------------------------------------
  private buildShell(): void {
    this.closeAll();
    clear(this.root);
    this.top = h('header', { class: 'topbar' });
    this.stage = h('main', { class: 'stage' });
    this.nav = h('nav', { class: 'nav' });
    this.shell = h('div', { style: 'display:contents' }, this.top, this.stage, this.nav);
    this.root.append(this.shell);
    this.map?.destroy();
    this.map = new MapView(this.stage, {
      onTap: (id) => {
        this.hideTooltip();
        if (id === null) this.closeRegion();
        else {
          audio.sfx('tap');
          this.openRegion(id);
        }
      },
      onLongPress: (id, x, y) => {
        vibrate(15);
        this.showTooltip(id, x, y);
      },
    });
    this.map.reduceMotion = this.settings.reduceMotion;
    this.map.setWorld(this.w!);
    this.stage.append(
      h('div', { class: 'legend' },
        h('span', { style: '--c:#d9b06b' }, 'Tu hogar'),
        h('span', { style: '--c:#e3a07c' }, 'Tensión'),
        h('span', { style: '--c:#d36a5c' }, 'Guerra'),
        h('span', { style: '--c:#c9a35f' }, 'Escasez'),
        h('span', { style: '--c:#a39f98' }, 'Sin explorar'),
      ),
      h('div', { class: 'fab-left' },
        h('button', { class: 'icon-btn', 'aria-label': 'Encuadrar mapa', onclick: () => this.map?.fit() }, '⤢'),
        h('button', { class: 'icon-btn', 'aria-label': 'Ir a tu hogar', onclick: () => this.w && this.openRegion(this.w.player.home) }, '🏠'),
      ),
      h('button', { class: 'btn primary advance', onclick: () => this.advance() }, h('span', null, 'AVANZAR DÍA', h('span', { class: 'sub' }, 'el mundo responde'))),
    );
    this.refresh();
  }

  renderTop(): void {
    const w = this.w;
    if (!w || !this.top) return;
    const p = w.player;
    const objectivesDone = w.objectives.filter((o) => o.status === 'cumplido').length;
    const visible = w.objectives.filter((o) => !o.hidden).length;
    clear(this.top).append(
      h('button', { class: 'icon-btn', 'aria-label': 'Menú', onclick: () => showGameMenu(this) }, '☰'),
      h('div', { class: 'day' }, `Día ${w.day}`, h('small', null, `de ${w.eraLength} · `, h('span', { class: `mood-dot mood-${w.mood}` }), ` ${moodWord(w.mood)}`)),
      h('div', { class: 'stats' },
        h('button', { class: 'chip', onclick: () => this.setView('decisiones'), 'aria-label': 'Provisiones' }, '🌾', String(Math.round(p.reserves))),
        h('button', { class: 'chip', onclick: () => this.setView('investigar'), 'aria-label': 'Emisarios' }, '🧭', `${Math.max(0, freeAgentsCount(w))}/${p.agents}`),
        h('button', { class: 'chip', onclick: () => showGameMenu(this, 'objetivos'), 'aria-label': 'Objetivos' }, '★', `${objectivesDone}/${visible}`),
      ),
    );
  }

  private renderNav(): void {
    const w = this.w;
    if (!w || !this.nav) return;
    const unreadClues = w.clues.filter((c) => c.day === w.day).length;
    const items: [View, string, string, number][] = [
      ['mapa', '🗺', 'Mapa', 0],
      ['decisiones', '⚖', 'Decisiones', w.petitions.length],
      ['investigar', '🔎', 'Investigar', unreadClues],
      ['hipotesis', '🧪', 'Hipótesis', w.hypotheses.filter((x) => x.result && x.dueDay === w.day).length],
      ['cronica', '📜', 'Crónica', 0],
    ];
    clear(this.nav).append(
      ...items.map(([v, ico, label, badge]) =>
        h('button', { class: this.view === v ? 'on' : '', onclick: () => this.setView(v) }, h('span', { class: 'ico' }, ico), label, badge ? h('span', { class: 'badge' }, String(badge)) : null),
      ),
    );
  }

  setView(v: View): void {
    audio.sfx('tap');
    this.view = v;
    if (v !== 'mapa') this.closeRegion();
    this.renderNav();
    this.renderView();
  }

  private renderedView: View | null = null;

  private renderView(): void {
    // Conserva el desplazamiento si se vuelve a dibujar la misma pantalla.
    const scroll = this.renderedView === this.view ? (this.screenEl?.scrollTop ?? 0) : 0;
    this.screenEl?.remove();
    this.screenEl = null;
    this.renderedView = null;
    if (!this.w || !this.stage || this.view === 'mapa') return;
    const render = { decisiones: renderDecisions, investigar: renderResearch, hipotesis: renderHypotheses, cronica: renderChronicle }[this.view];
    this.screenEl = h('section', { class: `screen ${scroll ? 'noanim' : ''}` }, render(this));
    this.stage.append(this.screenEl);
    this.screenEl.scrollTop = scroll;
    this.renderedView = this.view;
  }

  // -------------------------------------------------------------------------
  // Panel de región (hoja inferior)
  // -------------------------------------------------------------------------
  openRegion(id: number, keepTab = false): void {
    if (!this.w || !this.stage) return;
    if (this.view !== 'mapa') {
      this.view = 'mapa';
      this.renderNav();
      this.renderView();
    }
    const firstOpen = this.selected !== id || !this.sheetEl;
    this.selected = id;
    if (this.map) {
      this.map.selected = id;
      this.map.refresh();
      if (firstOpen) this.map.focus(id);
    }
    const scroll = this.sheetEl?.querySelector('.body')?.scrollTop ?? 0;
    this.sheetEl?.remove();
    this.sheetEl = openRegionSheet(this, id, keepTab);
    this.stage.append(this.sheetEl);
    if (keepTab) {
      this.sheetEl.classList.add('noanim');
      const body = this.sheetEl.querySelector('.body');
      if (body) body.scrollTop = scroll;
    }
  }

  closeRegion(): void {
    this.sheetEl?.remove();
    this.sheetEl = null;
    this.selected = null;
    if (this.map) {
      this.map.selected = null;
      this.map.refresh();
    }
  }

  private showTooltip(id: number, x: number, y: number): void {
    if (!this.w || !this.stage) return;
    this.hideTooltip();
    const rect = this.stage.getBoundingClientRect();
    const tip = h('div', { class: 'tooltip' }, ...describeTooltip(this.w, id, STATUS_LABEL[regionStatus(this.w, id)]));
    tip.style.left = `${Math.min(rect.width - 270, Math.max(8, x - rect.left - 120))}px`;
    tip.style.top = `${Math.max(8, y - rect.top - 140)}px`;
    this.stage.append(tip);
    this.tooltipEl = tip;
    window.setTimeout(() => this.hideTooltip(), 3500);
  }

  private hideTooltip(): void {
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }

  // -------------------------------------------------------------------------
  // Modales y avisos
  // -------------------------------------------------------------------------
  modal(build: (close: () => void) => (Node | null)[], opts: { onClose?: () => void } = {}): () => void {
    const box = h('div', { class: 'modal', role: 'dialog' });
    const overlay = h('div', { class: 'overlay' }, box);
    const close = () => {
      overlay.remove();
      this.modals = this.modals.filter((m) => m !== overlay);
      opts.onClose?.();
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    box.append(h('button', { class: 'icon-btn close-x', 'aria-label': 'Cerrar', onclick: close }, '✕'), ...build(close).filter(Boolean) as Node[]);
    (this.stage ?? this.root).append(overlay);
    this.modals.push(overlay);
    return close;
  }

  toast(msg: string, err = false): void {
    const t = h('div', { class: `toast ${err ? 'err' : ''}` }, msg);
    (this.stage ?? this.root).append(t);
    if (err) audio.sfx('error');
    window.setTimeout(() => t.remove(), 2600);
  }

  closeAll(): void {
    for (const m of this.modals) m.remove();
    this.modals = [];
    this.sheetEl?.remove();
    this.sheetEl = null;
  }

  /** Botón "atrás" de Android: cierra lo último que se abrió. */
  back(): boolean {
    if (this.modals.length) {
      this.modals.pop()!.remove();
      return true;
    }
    if (this.sheetEl) {
      this.closeRegion();
      return true;
    }
    if (this.w && this.view !== 'mapa') {
      this.setView('mapa');
      return true;
    }
    if (this.w) {
      saveGame(this.w, 'auto');
      this.showMenu();
      return true;
    }
    return false;
  }
}

const freeAgentsCount = (w: WorldState) => freeAgents(w);

export function moodWord(m: WorldState['mood']): string {
  return { calma: 'calma', tension: 'tensión', crisis: 'crisis', descubrimiento: 'hallazgo' }[m];
}
