import { geoOf, weatherIn } from '../world/geography';
import { playerRegion } from '../world/society';
import { warOf } from '../world/war';
import { darkness } from '../world/clock';
import { renderWorld } from './screens/world';
import { advanceDay, createWorld, type DayReport } from '../core/api';
import { loadLegacy } from '../core/legacy';
import { hashString } from '../core/rng';
import { loadGame, saveGame } from '../core/save';
import type { WorldState } from '../core/types';
import { audio } from '../audio/audio';
import { WorldScene, type Target } from '../render/scene';
import { clockText, dayOf, hourOf, seasonOf, yearOf } from '../world/clock';
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
import { approachNear, catchUp, liveNotices } from '../world/social';
import { convoyTick } from '../world/trade';
import { capacityOf, cargoCount, deliverContracts, playerEco } from '../world/business';
import { GOOD, type Good } from '../world/economy';
import { businessDialog } from './market';
import type { Approach } from '../world/gossip';
import { prologueDawn, prologueOf, prologueQuiet, prologueTick, recap } from '../world/prologue';
import { renderMenu, objectivesDialog, renderSettingsInline, savesDialog } from './screens/menu';
import { openRegionSheet } from './screens/region';
import { renderResearch } from './screens/research';
import { renderFamily } from './screens/family';
import { approachDialog, arrive, dialogue, focusButtons, showFragment } from './world-dialogs';
import { successionScreen } from './generations';

export type View = 'mapa' | 'mundo' | 'cronica' | 'hipotesis' | 'investigar' | 'decisiones' | 'objetivos' | 'familia' | 'ajustes';

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
  chronicleTab: 'vida' | 'dias' | 'cadenas' | 'historia' = 'vida';
  waypoint: number | null = null;
  stage: HTMLElement | null = null;
  private hud: HTMLElement | null = null;
  private prompt: HTMLElement | null = null;
  private whisperBox: HTMLElement | null = null;
  private diary: HTMLElement | null = null;
  private diaryView: View = 'mapa';
  private map: MapView | null = null;
  private mapLayer: MapView['layer'] = 'normal';
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
    const ended = w.day;
    this.sleeping = true;
    this.passTime(Math.max(0, next - life.clock));
    this.sleeping = false;
    const id = life.identity;
    if (id) id.needs.hunger = Math.min(1, id.needs.hunger + 0.15);
    const o = sleepOutcome(w, where === 'templo' ? 'casa' : where === 'raso' ? 'raso' : 'casa');
    if (where === 'templo' && id) id.needs.fatigue = 0.2;
    this.notes(o.notes);
    const p = prologueOf(w);
    if (p && ended <= 3 && p.recapDay < ended) {
      p.recapDay = ended;
      this.dayCard(ended, recap(w, ended), o.lines[0], () => o.fragment && showFragment(this, o.fragment));
      return;
    }
    this.toast(o.lines[0] ?? `Duermes. Amanece el día ${w.day}.`);
    if (o.fragment) window.setTimeout(() => showFragment(this, o.fragment!), 400);
  }

  /** Al dormir los primeros días: un respiro y un pequeño resumen de lo vivido. */
  private dayCard(day: number, lines: string[], waking: string | undefined, then: () => void): void {
    if (!this.stage) return then();
    this.pause(true);
    const el = h('div', { class: 'awaken daycard' },
      h('h2', null, `Día ${day}`),
      ...lines.map((l) => h('p', null, l)),
      waking ? h('p', { class: 'tiny' }, waking) : null,
      h('button', { class: 'btn primary', onclick: () => { el.remove(); this.pause(false); this.renderHud(); then(); } }, 'Despertar'),
    );
    this.stage.append(el);
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
      h('button', { class: 'btn primary', onclick: () => { el.remove(); this.pause(false); this.whisper('Hay humo hacia allí. Quizá un pueblo.'); this.banner('Descubre', 'dónde estás'); this.renderHud(); } }, 'Levantarte'),
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
    const pe = life.society ? playerEco(w) : null;
    if (pe && cargoCount(pe) > 0) choices.push({ label: `📦 Tu carga: ${Object.entries(pe.cargo).filter(([, n]) => (n ?? 0) >= 0.5).map(([g, n]) => `${Math.round(n!)} ${GOOD[g as Good].name}`).join(', ')}`, run: () => this.refresh() });
    for (const b of pe?.businesses ?? []) choices.push({ label: `📒 Tu ${b.kind === 'puesto' ? 'puesto' : b.kind === 'granja' ? 'campo' : 'transporte'} en ${w.regions[b.regionId].name}`, run: () => businessDialog(this, b.id, () => this.refresh()) });
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
    // Lo que hiciste ayer se nota hoy.
    this.whispers.unshift(...prologueDawn(w));
    this.unread += report.entries.length;
    this.banner(`Día ${w.day}`, `${seasonOf(w.day)} del año ${yearOf(w.day)}`);
    saveGame(w, 'auto');
    this.scene?.setWorld(w);
    if (report.ended) window.setTimeout(() => showEnd(this), 300);
    if (ensureLife(w).player.pendingDeath) window.setTimeout(() => successionScreen(this), 600);
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
    // El paisaje sonoro: el bosque, la costa, el viento del monte, la lluvia, los tambores de guerra.
    if (region >= 0) audio.setAmbience({ biome: geoOf(w, region).biome, weather: weatherIn(w, region), war: !!warOf(w, region), night: darkness(life.clock) > 0.5 });
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
    // La gente vive: lo que empieza a pasar cerca (gritos, campanas, música)…
    const hNow = hourOf(life.clock);
    if (region >= 0 && this.lastSocialHour !== undefined && hNow !== this.lastSocialHour) for (const m of liveNotices(w, region, hNow, this.lastSocialHour < hNow ? this.lastSocialHour : hNow - 0.01)) this.whisper(m, true);
    this.lastSocialHour = hNow;
    // …y quien quiere hablar contigo viene a buscarte.
    this.approachTick();
    // Las caravanas avanzan por los caminos (cada hora de juego): llegadas, retrasos, asaltos.
    const hourNow = Math.floor(life.clock / 60);
    if (hourNow !== this.lastConvoyHour) {
      this.lastConvoyHour = hourNow;
      for (const msg of convoyTick(w)) if (region >= 0 && msg.includes(w.regions[region].name)) this.whisper(msg);
    }
    const pt = prologueTick(w, me.x, me.y, life.clock);
    if (pt.banner) (audio.sfx('descubrimiento'), this.banner(pt.banner[0], pt.banner[1]));
    for (const m of pt.whispers) this.whisper(m, true);
    if (pt.banner || pt.whispers.length) this.renderHud();
    const place = discoverNear(w, me.x, me.y);
    if (place) {
      audio.sfx('descubrimiento');
      this.banner('Descubrimiento', place.name);
    }
    this.spawnTimer++;
    if (this.spawnTimer > 16 && !prologueQuiet(w)) {
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

  private lastSocialHour?: number;
  private lastConvoyHour = -1;
  private approachCooldown = 0;
  private approaching: Approach | null = null;

  private approachTick(): void {
    const w = this.w!;
    const scene = this.scene!;
    const busy = !!this.stage?.querySelector('.overlay') || this.sleeping;
    if (this.approaching) {
      const d = scene.distanceTo(this.approaching.folk);
      if (d === Infinity || busy) {
        if (d === Infinity) (scene.summon(null), (this.approaching = null));
        return;
      }
      if (d < 1.9) {
        const ap = this.approaching;
        this.approaching = null;
        scene.summon(null);
        this.approachCooldown = 40;
        approachDialog(this, ap);
      }
      return;
    }
    if (busy || --this.approachCooldown > 0) return;
    const ap = approachNear(w, scene.folkNear(10));
    if (!ap) return;
    this.approaching = ap;
    scene.summon(ap.folk);
    const f = ensureLife(w).folk.find((x) => x.id === ap.folk);
    if (f) this.whisper(`${f.name} viene hacia ti.`);
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
    // El pueblo no se detuvo mientras estabas fuera.
    for (const n of catchUp(w, id)) this.whispers.unshift(n);
    for (const n of deliverContracts(w, id)) this.whisper(n, true);
    for (const n of presenceTick(w, id, false)) this.whisper(n);
  }

  // -------------------------------------------------------------------------
  // HUD mínimo
  // -------------------------------------------------------------------------
  renderHud(): void {
    const w = this.w;
    if (!w || !this.hud) return;
    const life = ensureLife(w);
    // El tiempo que se ve en la escena (el de tu región), no el general.
    const weather = (this.scene?.debugWeather ?? weatherIn(w, playerRegion(w))) as keyof typeof WICON;
    const wIcon = weather === 'despejado' && (hourOf(life.clock) > 20 || hourOf(life.clock) < 6) ? '🌙' : WICON[weather] ?? '☀';
    const inv = life.player.inventory;
    const free = w.player.agents - w.missions.length - Object.values(w.intel).filter((i) => i.observerStationed).length;
    const id = life.identity;
    const auth = w.player.authority ?? 6;
    const needs = id && id.mode === 'forastero' ? id.needs : null;
    clear(this.hud).append(
      h('button', { class: 'icon-btn', 'aria-label': 'Diario', onclick: () => this.setView(this.diaryView) }, '☰'),
      h('div', { class: 'clock' }, h('b', null, `Día ${w.day} · ${clockText(life.clock)}`), h('small', null, `${wIcon} ${seasonOf(w.day)} · año ${yearOf(w.day)} · `, h('span', { class: `mood-dot mood-${w.mood}` })), life.prologue?.objective ? h('small', { class: 'objective' }, life.prologue.objective) : null),
      h('div', { class: 'stats' },
        auth >= 5 ? h('span', { class: 'chip', title: 'Provisiones del pueblo' }, '🌾', String(Math.round(w.player.reserves))) : null,
        needs ? h('span', { class: 'chip', title: 'Monedas' }, '🪙', String(Math.floor(needs.coins))) : null,
        h('span', { class: 'chip', title: 'Comida · hierbas' }, '🍞', String(Math.floor(inv.comida)), h('span', { class: 'sep' }, '·'), '🌿', String(Math.floor(inv.hierbas))),
        life.society && cargoCount(playerEco(w)) > 0 ? h('span', { class: 'chip', title: 'Tu carga' }, playerEco(w).vehicle === 'carreta' ? '🛞' : playerEco(w).vehicle === 'mula' ? '🐴' : '📦', `${Math.round(cargoCount(playerEco(w)))}/${capacityOf(playerEco(w))}`) : null,
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

  banner(top: string, main: string, cine = !/^Día \d/.test(top) && top !== 'Has entrado en'): void {
    if (!this.stage) return;
    this.stage.querySelector('.banner')?.remove();
    const b = h('div', { class: 'banner' }, h('small', null, top), h('div', null, main));
    this.stage.append(b);
    // Los momentos que merecen cartel (llegar a un sitio nuevo, descubrirse, una nueva
    // generación) merecen plano de cine; el amanecer de cada día, no.
    if (!cine) return;
    this.scene?.cinematic({ seconds: 3.4 });
    this.stage.classList.add('cine');
    window.setTimeout(() => this.stage?.classList.remove('cine'), 3200);
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
      this.diary = h('section', { class: `diary ${v === 'mapa' ? 'from-world' : ''}` });
      this.stage.append(this.diary);
      // Transición mundo → mapa: la escena se aleja y se desenfoca mientras el mapa aparece.
      if (v === 'mapa') this.stage.classList.add('to-map');
    }
    this.pause(true);
    this.renderDiary();
  }

  closeDiary(): void {
    this.stage?.classList.remove('to-map');
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
      ['mundo', '🏛 Mundo'],
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
    // La pestaña activa siempre a la vista (las demás se deslizan).
    requestAnimationFrame(() => this.diary?.querySelector('.diary-head .tabs button.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }));
    if (this.diaryView === 'mapa') {
      body.classList.add('map-body');
      this.map = new MapView(body, { onTap: (id) => (id === null ? this.closeRegion() : this.openRegion(id)), onLongPress: (id) => this.openRegion(id) });
      this.map.reduceMotion = this.settings.reduceMotion;
      const life = ensureLife(w);
      this.map.player = { x: life.player.x * 2, y: life.player.y * 2 };
      this.map.setWorld(w);
      body.append(h('div', { class: 'map-hint' }, 'Toca una región para ver lo que sabes de ella.'));
      // Capas del mapa estratégico (solo con lo que sabes).
      if (life.politics) {
        const layers: [MapView['layer'], string][] = [['normal', 'Mapa'], ['estados', 'Estados'], ['politica', 'Relaciones'], ['comercio', 'Comercio'], ['conflictos', 'Conflictos']];
        const bar = h('div', { class: 'map-layers' }, ...layers.map(([k, l]) => h('button', { class: `opt-chip ${this.mapLayer === k ? 'on' : ''}`, onclick: () => ((this.mapLayer = k), this.map && ((this.map.layer = k), this.map.refresh()), bar.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', layers[i][0] === k))) }, l)));
        body.append(bar);
        this.map.layer = this.mapLayer;
        this.map.refresh();
      }
      return;
    }
    const render = {
      cronica: renderChronicle,
      mundo: renderWorld,
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
    // La muerte puede llegar a mitad del día (una batalla): la historia continúa igual.
    if (ensureLife(this.w).player.pendingDeath && !this.modals.length) window.setTimeout(() => successionScreen(this), 400);
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

const WICON = { despejado: '☀', nublado: '☁', lluvia: '🌧', tormenta: '⛈', viento: '🌬', niebla: '🌫', nieve: '❄' } as const;
