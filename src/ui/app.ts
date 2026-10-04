import { advanceDay, createWorld, type DayReport } from '../core/api';
import { loadLegacy } from '../core/legacy';
import { hashString } from '../core/rng';
import { loadGame, saveGame } from '../core/save';
import type { WorldState } from '../core/types';
import { audio } from '../audio/audio';
import { WorldScene, type Target } from '../render/scene';
import { clockText, dayOf, hourOf, seasonOf, weatherOf, yearOf } from '../world/clock';
import { wireWorld } from '../world';
import { maybeSpawn } from '../world/encounters';
import { getLayout } from '../world/layout';
import { addScore, eat, rest, speedFactor, story, tickNeeds, tryFragment, type GainNote } from '../world/identity';
import { ensureLife, syncClock } from '../world/life';
import { exploreLearning, forage, sleepOutcome } from '../world/livelihood';
import { discoverNear, presenceTick } from '../world/presence';
import { DAY_MINUTES } from '../world/types';
import { clear, h, vibrate } from './dom';
import { MapView } from './map/view';
import { applySettings, loadSettings, saveSettings, type Settings } from './settings';
import { renderChronicle } from './screens/chronicle';
import { renderDecisions } from './screens/decisions';
import { showEnd } from './screens/dawn';
import { renderHypotheses } from './screens/hypotheses';
import { renderMenu, objectivesDialog, renderSettingsInline, savesDialog } from './screens/menu';
import { openRegionSheet } from './screens/region';
import { renderResearch } from './screens/research';
import { renderFamily } from './screens/family';
import { arrive, dialogue, focusButtons, showFragment, succession } from './world-dialogs';

export type View = 'mapa' | 'cronica' | 'hipotesis' | 'investigar' | 'decisiones' | 'objetivos' | 'familia' | 'ajustes';

/**
 * Controlador de la interfaz. Durante la exploración solo hay un HUD mínimo:
 * día, hora, estado general, recursos básicos, menú y avisos discretos.
 * El diario (mapa, crónica, hipótesis, investigación, consejo…) es secundario.
 */
export class App {
  w: WorldState | null = null;
  settings: Settings = loadSettings();
  scene: WorldScene | null = null;
  lastReport: DayReport | null = null;
  chronicleTab: 'vida' | 'dias' | 'cadenas' = 'vida';
  waypoint: number | null = null;
  private stage: HTMLElement | null = null;
  private hud: HTMLElement | null = null;
  private prompt: HTMLElement | null = null;
  private whisperBox: HTMLElement | null = null;
  private diary: HTMLElement | null = null;
  private diaryView: View = 'mapa';
  private map: MapView | null = null;
  private sheet: HTMLElement | null = null;
  private modals: HTMLElement[] = [];
  private whispers: string[] = [];
  private whisperTimer = 0;
  private lastHour = -1;
  private sleeping = false;
  private fainting = false;
  private hudTimer = 0;
  private unread = 0;
  private spawnTimer = 0;
  focus: Target | null = null;

  constructor(public root: HTMLElement) {
    wireWorld();
    applySettings(this.settings);
    audio.setVolumes(this.settings.music, this.settings.sfx);
    window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        audio.suspend();
        if (this.w) saveGame(this.w, 'auto');
      } else audio.resume();
    });
  }

  // -------------------------------------------------------------------------
  // Partida
  // -------------------------------------------------------------------------
  showMenu(): void {
    this.closeAll();
    this.scene?.destroy();
    this.scene = null;
    this.w = null;
    clear(this.root).append(renderMenu(this));
  }

  newGame(seedText: string, eraLength: number): void {
    const seed = seedText.trim() ? hashString(seedText.trim()) : (Math.random() * 2 ** 32) >>> 0;
    this.loading(() => {
      const w = createWorld(seed, { eraLength, legacy: loadLegacy() });
      this.start(w);
      this.awaken();
    });
  }

  continueGame(): void {
    const w = loadGame('auto');
    if (w) this.loading(() => this.start(w));
  }

  /** Pantalla de carga mientras el mundo se genera (terreno, pueblos, caminos). */
  private loading(then: () => void): void {
    clear(this.root).append(h('div', { class: 'menu' }, h('h1', { class: 'logo', style: 'font-size:40px' }, 'ECOS'), h('p', { class: 'tag' }, 'El mundo despierta…')));
    window.setTimeout(then, 40);
  }

  start(w: WorldState): void {
    this.closeAll();
    this.w = w;
    ensureLife(w);
    syncClock(w);
    getLayout(w);
    this.scene?.destroy();
    clear(this.root);
    this.stage = h('main', { class: 'stage world' });
    this.root.append(this.stage);
    this.scene = new WorldScene(this.stage, w, {
      advance: (m) => this.advanceMinutes(m),
      onRegion: (id, prev) => this.enterRegion(id, prev),
      onFocus: (t) => this.setFocus(t),
      onArrive: (t) => arrive(this, t),
      onTick: () => this.tick(),
    });
    this.scene.reduceMotion = this.settings.reduceMotion;
    this.scene.setQuality(this.settings.quality);
    this.hud = h('header', { class: 'hud' });
    this.whisperBox = h('div', { class: 'whispers' });
    this.prompt = h('div', { class: 'prompt' });
    this.stage.append(
      this.hud,
      this.whisperBox,
      this.prompt,
      h('button', { class: 'run-btn', 'aria-label': 'Correr', onclick: (e: Event) => this.toggleRun(e.currentTarget as HTMLElement) }, '🏃'),
      h('button', { class: 'quick-btn', 'aria-label': 'Acciones', onclick: () => this.quickActions() }, '✋'),
    );
    this.scene.speed = () => speedFactor(ensureLife(w).identity);
    this.renderHud();
    audio.setMood(w.mood);
    saveGame(w, 'auto');
  }

  private toggleRun(btn: HTMLElement): void {
    if (!this.scene) return;
    this.scene.running = !this.scene.running;
    btn.classList.toggle('on', this.scene.running);
    vibrate(8);
  }

  saveSettings(): void {
    saveSettings(this.settings);
    applySettings(this.settings);
    audio.setVolumes(this.settings.music, this.settings.sfx);
    if (this.scene) (this.scene.reduceMotion = this.settings.reduceMotion), this.scene.setQuality(this.settings.quality);
    if (this.map) this.map.reduceMotion = this.settings.reduceMotion;
  }

  // -------------------------------------------------------------------------
  // Tiempo: el mundo sigue aunque no mires
  // -------------------------------------------------------------------------
  advanceMinutes(minutes: number): void {
    const w = this.w;
    if (!w || w.ended) return;
    const life = ensureLife(w);
    life.clock += minutes;
    while (dayOf(life.clock) > w.day && !w.ended) this.dawn();
    if (!this.sleeping && life.identity) {
      const n = tickNeeds(life.identity, minutes);
      for (const t of n.notes) this.whisper(t);
      if (n.faint && !this.fainting) this.faint();
    }
    this.hudTimer += minutes;
    if (this.hudTimer > 10) {
      this.hudTimer = 0;
      this.renderHud();
    }
  }

  /** Pasa el tiempo deprisa (descansar, viajar). */
  passTime(minutes: number): void {
    this.advanceMinutes(minutes);
    this.renderHud();
  }

  /** Dormir hasta el próximo amanecer: en casa, en la posada, en el templo o al raso. */
  sleep(where: 'casa' | 'posada' | 'templo' | 'raso' = 'casa'): void {
    const w = this.w!;
    const life = ensureLife(w);
    const next = w.day * DAY_MINUTES + 30;
    this.sleeping = true;
    this.passTime(Math.max(0, next - life.clock));
    this.sleeping = false;
    const id = life.identity;
    if (id) id.needs.hunger = Math.min(1, id.needs.hunger + 0.15);
    const o = sleepOutcome(w, where === 'templo' ? 'casa' : where === 'raso' ? 'raso' : 'casa');
    if (where === 'templo' && id) id.needs.fatigue = 0.2;
    this.notes(o.notes);
    this.toast(o.lines[0] ?? `Duermes. Amanece el día ${w.day}.`);
    if (o.fragment) window.setTimeout(() => showFragment(this, o.fragment!), 400);
  }

  /** Lo que aprendes: lo pequeño se susurra; lo importante se anuncia. */
  notes(list: GainNote[]): void {
    for (const n of list) {
      if (n.big) {
        audio.sfx('descubrimiento');
        this.banner('Descubres algo de ti', n.text.split('.').slice(-2, -1)[0]?.trim() || n.text);
      }
      this.whisper(n.text);
    }
    if (list.length) this.renderHud();
  }

  /** El protagonista se desploma de hambre o cansancio: despierta donde alguien le recogió. */
  private faint(): void {
    const w = this.w!;
    const life = ensureLife(w);
    const id = life.identity!;
    this.fainting = true;
    const l = getLayout(w);
    const me = life.player;
    const reg = l.terrain.region[Math.floor(me.y) * 500 + Math.floor(me.x)];
    const v = l.villages[reg >= 0 ? reg : w.player.home];
    const hunger = id.needs.hunger >= 1;
    const lost = Math.ceil(id.needs.coins / 2);
    id.needs.coins -= lost;
    this.sleeping = true;
    this.passTime(Math.max(0, w.day * DAY_MINUTES + 30 - life.clock));
    this.sleeping = false;
    id.needs.hunger = hunger ? 0.55 : id.needs.hunger;
    rest(id, true);
    eat(id, 0);
    const temple = v.keys.find((k) => k.kind === 'templo') ?? v.keys[0];
    const spot = { x: temple.x + temple.w / 2, y: temple.y + temple.h + 1.2 };
    this.scene?.teleport(spot.x, spot.y);
    story(w, `Se desplomó ${hunger ? 'de hambre' : 'de agotamiento'} cerca de ${w.regions[v.regionId].name}. Alguien le recogió.`, 'error');
    addScore(w, v.regionId, -1);
    this.fainting = false;
    dialogue(this, 'Todo se vuelve negro', '', [hunger ? 'Las piernas no te sostienen. Caes de rodillas y luego de bruces.' : 'Los ojos se te cierran solos. Caes donde estás.', `Despiertas en un banco del templo de ${w.regions[v.regionId].name}, con una manta encima. ${lost ? `Te faltan ${lost} monedas.` : ''}`, '«Tienes que cuidarte», te dice alguien. No sabes quién te trajo.'], [{ label: 'Levantarte', run: () => this.refresh(), primary: true }]);
  }

  /** Despertar: la primera escena. Sin explicaciones: preguntas. */
  awaken(): void {
    if (!this.stage) return;
    const w = this.w!;
    const id = ensureLife(w).identity;
    if (!id || id.mode !== 'forastero') return;
    this.pause(true);
    const el = h('div', { class: 'awaken' },
      h('p', null, 'Frío. Hierba mojada bajo la mejilla.'),
      h('p', null, 'Abres los ojos. El cielo empieza a clarear. No sabes dónde estás.'),
      h('p', null, 'Intentas recordar cómo llegaste aquí. Tu nombre. Cualquier cosa.'),
      h('p', null, 'Nada. Solo un colgante frío contra el pecho y, a lo lejos, humo de chimeneas.'),
      h('button', { class: 'btn primary', onclick: () => { el.remove(); this.pause(false); this.whisper('Hay humo hacia allí. Quizá un pueblo.'); this.renderHud(); } }, 'Levantarte'),
    );
    this.stage.append(el);
  }

  /** Acciones rápidas del cuerpo: comer de la mochila, buscar comida, descansar, mirar el colgante. */
  quickActions(): void {
    const w = this.w;
    if (!w) return;
    const life = ensureLife(w);
    const id = life.identity!;
    const me = life.player;
    const l = getLayout(w);
    const reg = l.terrain.region[Math.floor(me.y) * 500 + Math.floor(me.x)];
    const v = reg >= 0 ? l.villages[reg] : null;
    const inVillage = !!v && Math.hypot(v.cx - me.x, v.cy - me.y) < v.plazaR + 22;
    const choices: { label: string; run: () => void; hint?: string; primary?: boolean }[] = [];
    if (life.player.inventory.comida > 0) choices.push({ label: `🍞 Comer de la mochila (${life.player.inventory.comida})`, primary: id.needs.hunger > 0.4, run: () => { life.player.inventory.comida--; eat(id); this.toast('Comes despacio. Te sienta bien.'); this.refresh(); } });
    if (!inVillage) choices.push({ label: '🧺 Buscar comida por aquí', hint: '1 hora', run: () => { const o = forage(w, me.x, me.y); this.passTime(o.minutes); this.notes(o.notes); this.toast(o.lines[0]); this.refresh(); } });
    choices.push({ label: '⏳ Descansar un rato', hint: '2 horas', run: () => { this.sleeping = true; this.passTime(120); this.sleeping = false; rest(id, false); this.toast('Te sientas a recuperar el aliento.'); this.refresh(); } });
    if (hourOf(life.clock) >= 20 || hourOf(life.clock) < 5 || id.needs.fatigue > 0.7) choices.push({ label: '🌙 Dormir al raso', hint: 'Gratis, pero se descansa mal', run: () => this.sleep('raso') });
    if (id.items.includes('colgante')) choices.push({ label: '🔱 Mirar el colgante', run: () => { const ev = tryFragment(w, { kind: 'colgante' }); if (ev) showFragment(this, ev); } });
    choices.push({ label: 'Nada', run: () => {} });
    dialogue(this, 'Tú', `🍞 ${Math.round(id.needs.hunger * 100)}% hambre · 💤 ${Math.round(id.needs.fatigue * 100)}% cansancio · 🪙 ${id.needs.coins}`, [], choices);
  }

  private dawn(): void {
    const w = this.w!;
    const report = advanceDay(w);
    this.lastReport = report;
    audio.sfx('dia');
    audio.setMood(report.mood);
    // Las noticias no llegan de golpe: se oyen a lo largo del día.
    for (const c of report.clues) this.whispers.push(c.text);
    for (const r of report.rumors) this.whispers.push(`Se rumorea: «${r.text}»`);
    const results = w.hypotheses.filter((x) => x.result && x.dueDay === w.day);
    for (const hy of results) this.whispers.unshift(`🧪 Hipótesis ${hy.result}: ${hy.text}`);
    if (report.newPetitions) this.whispers.unshift(`Un mensajero te espera ante el salón del consejo.`);
    const inbox = ensureLife(w).identity?.inbox;
    if (inbox?.length) this.whispers.unshift(...inbox.splice(0));
    this.unread += report.entries.length;
    this.banner(`Día ${w.day}`, `${seasonOf(w.day)} del año ${yearOf(w.day)}`);
    saveGame(w, 'auto');
    this.scene?.setWorld(w);
    if (report.ended) window.setTimeout(() => showEnd(this), 300);
    if (ensureLife(w).player.pendingDeath) window.setTimeout(() => succession(this), 600);
    this.renderHud();
    if (this.diary) this.renderDiary();
  }

  private tick(): void {
    const w = this.w;
    if (!w || !this.scene) return;
    const life = ensureLife(w);
    const l = getLayout(w);
    const me = life.player;
    const region = l.terrain.region[Math.floor(me.y) * 500 + Math.floor(me.x)];
    // Observación directa cada hora de juego.
    const hour = Math.floor(life.clock / 60);
    if (hour !== this.lastHour && region >= 0) {
      this.lastHour = hour;
      const v = l.villages[region];
      const near = Math.hypot(v.cx - me.x, v.cy - me.y) < v.wallR + 12;
      for (const n of presenceTick(w, region, near)) this.whisper(n);
      if (!near) this.notes(exploreLearning(w, false));
    }
    // Destino marcado.
    if (this.waypoint !== null) {
      const v = l.villages[this.waypoint];
      if (Math.hypot(v.cx - me.x, v.cy - me.y) < 8) {
        this.waypoint = null;
        this.scene.waypoint = null;
      } else this.scene.waypoint = { x: v.cx + 0.5, y: v.cy + 0.5, label: w.intel[this.waypoint].level ? w.regions[this.waypoint].name : '¿?' };
    } else this.scene.waypoint = null;
    const place = discoverNear(w, me.x, me.y);
    if (place) {
      audio.sfx('descubrimiento');
      this.banner('Descubrimiento', place.name);
    }
    this.spawnTimer++;
    if (this.spawnTimer > 16) {
      this.spawnTimer = 0;
      const facing = { x: Math.cos(life.clock), y: Math.sin(life.clock) };
      const msg = maybeSpawn(w, facing);
      if (msg) this.whisper(msg, true);
    }
    // Avisos repartidos a lo largo del día.
    this.whisperTimer++;
    if (this.whisperTimer > 30 && this.whispers.length) {
      this.whisperTimer = 0;
      this.whisper(this.whispers.shift()!);
    }
  }

  private enterRegion(id: number, prev: number): void {
    const w = this.w!;
    const r = w.regions[id];
    const life = ensureLife(w);
    const ident = life.identity;
    const first = life.visited[id] === undefined;
    const homey = r.isHome && (ident?.mode === 'gobernante' || ident?.housed);
    // Al despertar no sabes ni dónde estás: el nombre del lugar se descubre al llegar al pueblo.
    if (prev < 0 && ident?.mode === 'forastero' && w.day === 1 && !ident.story.some((e) => e.kind === 'lugar')) {
      life.visited[id] = w.day;
      return;
    }
    if (prev >= 0 || first) this.banner(homey ? 'Vuelves a casa' : first ? 'Llegas a' : 'Has entrado en', r.name);
    if (first) {
      life.visited[id] = w.day;
      if (prev >= 0 || ident?.mode !== 'forastero') this.notes(exploreLearning(w, true));
      story(w, `Llegó por primera vez a ${r.name}.`, 'lugar');
    }
    const memory = tryFragment(w, { kind: 'region', regionId: id });
    if (memory) window.setTimeout(() => showFragment(this, memory), 1200);
    for (const n of presenceTick(w, id, false)) this.whisper(n);
  }

  // -------------------------------------------------------------------------
  // HUD mínimo
  // -------------------------------------------------------------------------
  renderHud(): void {
    const w = this.w;
    if (!w || !this.hud) return;
    const life = ensureLife(w);
    const weather = weatherOf(w, w.day);
    const wIcon = { despejado: hourOf(life.clock) > 20 || hourOf(life.clock) < 6 ? '🌙' : '☀', nublado: '☁', lluvia: '🌧', tormenta: '⛈', viento: '🌬', niebla: '🌫', nieve: '❄' }[weather];
    const inv = life.player.inventory;
    const free = w.player.agents - w.missions.length - Object.values(w.intel).filter((i) => i.observerStationed).length;
    const id = life.identity;
    const auth = w.player.authority ?? 6;
    const needs = id && id.mode === 'forastero' ? id.needs : null;
    clear(this.hud).append(
      h('button', { class: 'icon-btn', 'aria-label': 'Diario', onclick: () => this.setView(this.diaryView) }, '☰'),
      h('div', { class: 'clock' }, h('b', null, `Día ${w.day} · ${clockText(life.clock)}`), h('small', null, `${wIcon} ${seasonOf(w.day)} · año ${yearOf(w.day)} · `, h('span', { class: `mood-dot mood-${w.mood}` }))),
      h('div', { class: 'stats' },
        auth >= 5 ? h('span', { class: 'chip', title: 'Provisiones del pueblo' }, '🌾', String(Math.round(w.player.reserves))) : null,
        needs ? h('span', { class: 'chip', title: 'Monedas' }, '🪙', String(needs.coins)) : null,
        h('span', { class: 'chip', title: 'Tu mochila' }, '🎒', `${inv.comida}·${inv.hierbas}`),
        needs && needs.hunger >= 0.6 ? h('span', { class: `chip ${needs.hunger >= 0.8 ? 'warn' : ''}`, title: 'Hambre' }, '🍞') : null,
        needs && needs.fatigue >= 0.65 ? h('span', { class: `chip ${needs.fatigue >= 0.85 ? 'warn' : ''}`, title: 'Cansancio' }, '💤') : null,
        auth >= 4 ? h('span', { class: 'chip', title: 'Emisarios libres' }, '🧭', `${Math.max(0, free)}`) : null,
        this.unread ? h('button', { class: 'chip news', onclick: () => ((this.unread = 0), this.setView('cronica')) }, '📜', String(this.unread)) : null,
      ),
    );
  }

  private setFocus(t: Target | null): void {
    this.focus = t;
    if (!this.prompt) return;
    clear(this.prompt);
    if (!t || !this.w) return;
    this.prompt.append(h('div', { class: 'prompt-label' }, t.label), h('div', { class: 'prompt-actions' }, ...focusButtons(this, t)));
  }

  whisper(text: string, sound = false): void {
    if (!this.whisperBox) return;
    const el = h('div', { class: 'whisper' }, text);
    this.whisperBox.append(el);
    if (sound) audio.sfx('peticion');
    while (this.whisperBox.children.length > 3) this.whisperBox.firstChild?.remove();
    window.setTimeout(() => el.classList.add('out'), 6000);
    window.setTimeout(() => el.remove(), 7000);
  }

  banner(top: string, main: string): void {
    if (!this.stage) return;
    this.stage.querySelector('.banner')?.remove();
    const b = h('div', { class: 'banner' }, h('small', null, top), h('div', null, main));
    this.stage.append(b);
    window.setTimeout(() => b.remove(), 3600);
  }

  // -------------------------------------------------------------------------
  // Diario: menú secundario con la información avanzada
  // -------------------------------------------------------------------------
  setView(v: View): void {
    if (!this.w || !this.stage) return;
    audio.sfx('tap');
    this.diaryView = v;
    if (!this.diary) {
      this.diary = h('section', { class: 'diary' });
      this.stage.append(this.diary);
    }
    this.pause(true);
    this.renderDiary();
  }

  closeDiary(): void {
    this.map?.destroy();
    this.map = null;
    this.sheet = null;
    this.diary?.remove();
    this.diary = null;
    this.pause(false);
    this.renderHud();
  }

  private renderDiary(): void {
    const w = this.w;
    if (!w || !this.diary) return;
    // El diario crece con la vida del personaje: al principio solo hay mapa, crónica y quién eres.
    const auth = w.player.authority ?? 6;
    const id = ensureLife(w).identity;
    const curious = !!id && (id.know.politica.level > 0 || id.skills.investigacion.level > 0);
    const tabs: [View, string][] = [
      ['mapa', '🗺 Mapa'],
      ['familia', '🪞 Quién soy'],
      ['cronica', '📜 Crónica'],
      ...((auth >= 4 || curious ? [['investigar', '🔎 Investigación']] : []) as [View, string][]),
      ...((auth >= 4 ? [['hipotesis', '🧪 Hipótesis'], ['decisiones', '⚖ Consejo']] : []) as [View, string][]),
      ...((auth >= 5 ? [['objetivos', '★ Objetivos']] : []) as [View, string][]),
      ['ajustes', '⚙ Ajustes'],
    ];
    if (!tabs.some(([v]) => v === this.diaryView)) this.diaryView = 'mapa';
    const scrollEl = this.diary.querySelector('.diary-body') as HTMLElement | null;
    const scroll = scrollEl?.dataset.view === this.diaryView ? scrollEl.scrollTop : 0;
    this.map?.destroy();
    this.map = null;
    this.sheet = null;
    const body = h('div', { class: 'diary-body', 'data-view': this.diaryView });
    clear(this.diary).append(
      h('div', { class: 'diary-head' },
        h('div', { class: 'tabs' }, ...tabs.map(([v, l]) => h('button', { class: this.diaryView === v ? 'on' : '', onclick: () => this.setView(v) }, l))),
        h('button', { class: 'icon-btn', 'aria-label': 'Volver al mundo', onclick: () => this.closeDiary() }, '✕'),
      ),
      body,
    );
    if (this.diaryView === 'mapa') {
      body.classList.add('map-body');
      this.map = new MapView(body, { onTap: (id) => (id === null ? this.closeRegion() : this.openRegion(id)), onLongPress: (id) => this.openRegion(id) });
      this.map.reduceMotion = this.settings.reduceMotion;
      const life = ensureLife(w);
      this.map.player = { x: life.player.x * 2, y: life.player.y * 2 };
      this.map.setWorld(w);
      body.append(h('div', { class: 'map-hint' }, 'Toca una región para ver lo que sabes de ella.'));
      return;
    }
    const render = {
      cronica: renderChronicle,
      hipotesis: renderHypotheses,
      investigar: renderResearch,
      decisiones: renderDecisions,
      objetivos: () => objectivesDialog(this, true),
      familia: renderFamily,
      ajustes: () => renderSettingsInline(this),
    }[this.diaryView];
    body.append(...(render(this) as Node[]));
    body.scrollTop = scroll;
  }

  /** Abre la ficha de una región (lo que sabes de ella). */
  openRegion(id: number, keepTab = false): void {
    if (!this.w) return;
    if (!this.diary || this.diaryView !== 'mapa') this.setView('mapa');
    const body = this.diary!.querySelector('.diary-body') as HTMLElement;
    this.sheet?.remove();
    this.sheet = openRegionSheet(this, id, keepTab);
    body.append(this.sheet);
    if (this.map) {
      this.map.selected = id;
      this.map.refresh();
      this.map.focus(id);
    }
  }

  closeRegion(): void {
    this.sheet?.remove();
    this.sheet = null;
    if (this.map) {
      this.map.selected = null;
      this.map.refresh();
    }
  }

  /** Redibuja lo que depende del estado del mundo. */
  refresh(): void {
    if (!this.w) return;
    this.renderHud();
    if (this.diary) this.renderDiary();
    if (this.focus) this.setFocus(this.focus);
  }

  // -------------------------------------------------------------------------
  // Modales y avisos
  // -------------------------------------------------------------------------
  pause(on: boolean): void {
    if (this.scene) this.scene.paused = on || !!this.diary || this.modals.length > 0;
  }

  modal(build: (close: () => void) => (Node | null)[], opts: { onClose?: () => void; cls?: string } = {}): () => void {
    const box = h('div', { class: `modal ${opts.cls ?? ''}`, role: 'dialog' });
    const overlay = h('div', { class: 'overlay' }, box);
    const close = () => {
      overlay.remove();
      this.modals = this.modals.filter((m) => m !== overlay);
      this.pause(false);
      opts.onClose?.();
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    box.append(h('button', { class: 'icon-btn close-x', 'aria-label': 'Cerrar', onclick: close }, '✕'), ...(build(close).filter(Boolean) as Node[]));
    (this.stage ?? this.root).append(overlay);
    this.modals.push(overlay);
    this.pause(true);
    return close;
  }

  toast(msg: string, err = false): void {
    const t = h('div', { class: `toast ${err ? 'err' : ''}` }, msg);
    (this.stage ?? this.root).append(t);
    if (err) audio.sfx('error');
    window.setTimeout(() => t.remove(), 2800);
  }

  closeAll(): void {
    for (const m of this.modals) m.remove();
    this.modals = [];
    this.diary?.remove();
    this.diary = null;
    this.map?.destroy();
    this.map = null;
  }

  saves(): void {
    savesDialog(this, !!this.w);
  }

  /** Botón «atrás» de Android. */
  back(): boolean {
    if (this.modals.length) {
      this.modals.pop()!.remove();
      this.pause(false);
      return true;
    }
    if (this.sheet) {
      this.closeRegion();
      return true;
    }
    if (this.diary) {
      this.closeDiary();
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

export function moodWord(m: WorldState['mood']): string {
  return { calma: 'calma', tension: 'tensión', crisis: 'crisis', descubrimiento: 'hallazgo' }[m];
}
