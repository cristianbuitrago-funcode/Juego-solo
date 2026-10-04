import { ACTIONS, performAction, proposeHypothesis, type Params } from '../../core/api';
import { METRIC_LABEL, metricValue, type HypoSpec } from '../../core/systems/hypotheses';
import type { HypoMetric, RumorKind, WorldState } from '../../core/types';
import { audio } from '../../audio/audio';
import type { App } from '../app';
import { add, clear, h, vibrate } from '../dom';

/**
 * Pantalla de decisión: elegir los detalles de una acción y, si se quiere,
 * acompañarla de una hipótesis ("¿qué pasaría si hago esto durante 5 días?").
 */
const METRICS: HypoMetric[] = ['alimento', 'confianza', 'estabilidad', 'tension', 'ecologia', 'poblacion'];
const DAYS = [3, 5, 7, 10];

function chips<T extends string | number>(options: [T, string][], current: T | undefined, onPick: (v: T) => void): HTMLElement {
  return h('div', { class: 'choices' }, ...options.map(([v, label]) => h('button', { class: current === v ? 'on' : '', onclick: () => onPick(v) }, label)));
}

const knownRegions = (w: WorldState, exclude: number[] = []) => w.regions.filter((r) => !r.isHome && w.intel[r.id].level > 0 && !exclude.includes(r.id));

export interface Extra {
  key: string;
  label: string;
  options: [number | string, string][];
}

export function openAction(app: App, actionId: string, base: Params, opts: { extras?: Extra[]; onDone?: () => void } = {}): void {
  const w = app.w!;
  const def = ACTIONS[actionId];
  const params: Params = { ...base };
  let withHypo = false;
  const hypo: { metric?: HypoMetric; direction?: 'sube' | 'baja' | 'igual'; days: number; note: string; region?: number } = { days: 5, note: '' };
  const body = h('div');

  const draw = () => {
    clear(body);
    add(body, h('h2', null, `${def.icon} ${def.label}`), h('p', { class: 'lead' }, def.hint), params.inPerson ? h('p', { class: 'tiny' }, 'Estás aquí en persona: no hace falta enviar a ningún emisario.') : null);
    for (const ex of opts.extras ?? []) {
      if (params[ex.key] === undefined) params[ex.key] = ex.options[Math.min(1, ex.options.length - 1)][0];
      add(body, h('div', { class: 'field' }, h('label', null, ex.label), chips(ex.options, params[ex.key], (v) => ((params[ex.key] = v), draw()))));
    }
    const r = params.region !== undefined ? w.regions[Number(params.region)] : undefined;
    // Parámetros según el tipo de acción.
    if (def.target === 'par' && r) {
      if (actionId === 'difundir') {
        add(body, 
          h('div', { class: 'field' }, h('label', null, `Rumor que se contará en ${r.name}, sobre…`),
            chips(knownRegions(w, [r.id]).map((x) => [x.id, x.name] as [number, string]), params.other as number | undefined, (v) => ((params.other = v), draw()))),
          h('div', { class: 'field' }, h('label', null, 'Qué se dirá'),
            chips<RumorKind>([['ataque', 'Prepara un ataque'], ['traicion', 'Planea traicionar'], ['riqueza', 'Esconde riquezas'], ['hambre', 'Pasa hambre'], ['enfermedad', 'Hay enfermedad']], params.kind as RumorKind | undefined, (v) => ((params.kind = v), draw()))),
        );
      } else {
        const nbs = r.neighbors.filter((n) => !w.regions[n].isHome && w.intel[n].level > 0);
        add(body, h('div', { class: 'field' }, h('label', null, `Junto a ${r.name}, ¿con quién?`),
          nbs.length ? chips(nbs.map((n) => [n, w.regions[n].name] as [number, string]), params.other as number | undefined, (v) => ((params.other = v), draw())) : h('div', { class: 'muted' }, 'No conoces a sus vecinos.')));
      }
    }
    if (actionId === 'compartir') {
      const ru = w.rumors.find((x) => x.id === params.rumor);
      add(body, 
        h('p', { class: 'quote' }, `«${ru?.text}»`),
        h('div', { class: 'field' }, h('label', null, '¿A quién se lo cuentas?'),
          chips(knownRegions(w).filter((x) => !params.inPerson || x.id === Number(params.region)).map((x) => [x.id, x.name] as [number, string]), params.region as number | undefined, (v) => ((params.region = v), draw()))),
        h('div', { class: 'field' }, h('label', null, 'Qué afirmas'),
          chips<string>([['cierto', 'Que es cierto'], ['falso', 'Que es falso']], params.claim as string | undefined, (v) => ((params.claim = v), draw()))),
        ru?.verdict ? h('div', { class: 'tiny' }, `Lo que tú sabes: ${ru.verdict}.`) : h('div', { class: 'tiny' }, 'Aún no lo has investigado: afirmes lo que afirmes, es una apuesta.'),
      );
    }
    // Hipótesis opcional.
    const hypoRegion = hypo.region ?? (params.region !== undefined ? Number(params.region) : undefined);
    if (hypoRegion !== undefined && !w.regions[hypoRegion].isHome && actionId !== 'ignorar') {
      add(body, 
        h('label', { class: 'switch' }, h('span', null, '🧪 Acompañar con una hipótesis'), h('input', { type: 'checkbox', checked: withHypo, onchange: (e: Event) => ((withHypo = (e.target as HTMLInputElement).checked), draw()) })),
      );
      if (withHypo) {
        const choices: [number, string][] = [[hypoRegion, w.regions[hypoRegion].name]];
        if (params.other !== undefined && actionId !== 'difundir') choices.push([Number(params.other), w.regions[Number(params.other)].name]);
        if (actionId === 'difundir' && params.other !== undefined) choices.push([Number(params.other), w.regions[Number(params.other)].name]);
        add(body, 
          choices.length > 1 ? h('div', { class: 'field' }, h('label', null, 'Creo que en…'), chips(choices, hypoRegion, (v) => ((hypo.region = v), draw()))) : null,
          h('div', { class: 'field' }, h('label', null, `Creo que en ${w.regions[hypoRegion].name}…`), chips(METRICS.map((m) => [m, METRIC_LABEL[m]] as [HypoMetric, string]), hypo.metric, (v) => ((hypo.metric = v), draw()))),
          h('div', { class: 'field' }, chips([['sube', '…aumentará'], ['baja', '…disminuirá'], ['igual', '…no cambiará']] as ['sube' | 'baja' | 'igual', string][], hypo.direction, (v) => ((hypo.direction = v), draw()))),
          h('div', { class: 'field' }, h('label', null, 'En cuántos días'), chips(DAYS.map((d) => [d, `${d} días`] as [number, string]), hypo.days, (v) => ((hypo.days = v), draw()))),
          h('div', { class: 'field' }, h('label', null, 'Tus notas (opcional)'), noteArea(hypo.note, (v) => (hypo.note = v))),
        );
      }
    }
    const reason = def.check(w, params);
    const hypoMissing = withHypo && (!hypo.metric || !hypo.direction);
    add(body, 
      reason ? h('p', { class: 'tiny', style: 'color:var(--bad)' }, reason) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary block', disabled: !!reason || hypoMissing, onclick: () => confirm() }, 'Decidir'),
      ),
    );
  };

  let close = () => {};
  const confirm = () => {
    // La línea base del experimento se mide ANTES de actuar.
    const hypoRegionId = hypo.region ?? Number(params.region);
    const baseline = withHypo && hypo.metric && !Number.isNaN(hypoRegionId) ? metricValue(w, w.regions[hypoRegionId], hypo.metric) : undefined;
    const res = performAction(w, actionId, params);
    if (!res.ok) {
      app.toast(res.message, true);
      return;
    }
    vibrate(15);
    audio.sfx('accion');
    if (withHypo && hypo.metric && hypo.direction) {
      proposeHypothesis(w, { kind: 'metrica', regionId: hypoRegionId, metric: hypo.metric, direction: hypo.direction, days: hypo.days, note: hypo.note, linkedAction: def.label, baseline });
    }
    close();
    app.toast(res.message);
    app.refresh();
    opts.onDone?.();
  };
  draw();
  close = app.modal(() => [body]);
}

function noteArea(value: string, onInput: (v: string) => void): HTMLTextAreaElement {
  const t = h('textarea', { placeholder: 'Ej.: creo que si les ayudo producirán más alimentos…' });
  t.value = value;
  t.addEventListener('input', () => onInput(t.value));
  return t;
}

/** Hipótesis independientes (no ligadas a una acción). */
export function openHypothesisComposer(app: App, preset: Partial<HypoSpec> = {}): void {
  const w = app.w!;
  const spec: Partial<HypoSpec> & { note: string } = { kind: 'metrica', days: 5, note: '', ...preset };
  const body = h('div');
  const draw = () => {
    clear(body);
    add(body, 
      h('h2', null, '🧪 Nueva hipótesis'),
      h('p', { class: 'lead' }, 'Formula una predicción. Cuando venza el plazo, el mundo te dirá si acertaste, y quizás descubras por qué.'),
      h('div', { class: 'field' }, h('label', null, 'Tipo'),
        chips<HypoSpec['kind']>([['metrica', 'Un cambio'], ['rumor', 'Un rumor'], ['conflicto', 'Una guerra'], ['tecnologia', 'Un invento']], spec.kind, (v) => ((spec.kind = v), draw()))),
    );
    if (spec.kind === 'rumor') {
      const rumors = w.rumors.filter((x) => x.known && !x.investigated);
      add(body, h('div', { class: 'field' }, h('label', null, 'Rumor'),
        rumors.length ? h('div', { class: 'choices' }, ...rumors.map((ru) => h('button', { class: spec.rumorId === ru.id ? 'on' : '', onclick: () => ((spec.rumorId = ru.id), (spec.regionId = ru.about), draw()) }, ru.text))) : h('div', { class: 'muted' }, 'No conoces rumores sin investigar.')));
      add(body, h('div', { class: 'field' }, h('label', null, 'Creo que es…'), chips<string>([['si', 'Cierto'], ['no', 'Falso']], spec.claimTrue === undefined ? undefined : spec.claimTrue ? 'si' : 'no', (v) => ((spec.claimTrue = v === 'si'), draw()))));
    } else {
      add(body, h('div', { class: 'field' }, h('label', null, 'Región'), chips(knownRegions(w).map((x) => [x.id, x.name] as [number, string]), spec.regionId, (v) => ((spec.regionId = v), (spec.otherId = undefined), draw()))));
    }
    if (spec.kind === 'metrica' && spec.regionId !== undefined) {
      add(body, 
        h('div', { class: 'field' }, h('label', null, 'Creo que…'), chips(METRICS.map((m) => [m, METRIC_LABEL[m]] as [HypoMetric, string]), spec.metric, (v) => ((spec.metric = v), draw()))),
        h('div', { class: 'field' }, chips([['sube', '…aumentará'], ['baja', '…disminuirá'], ['igual', '…no cambiará']] as ['sube' | 'baja' | 'igual', string][], spec.direction, (v) => ((spec.direction = v), draw()))),
      );
    }
    if (spec.kind === 'conflicto' && spec.regionId !== undefined) {
      const nbs = w.regions[spec.regionId].neighbors.filter((n) => !w.regions[n].isHome && w.intel[n].level > 0);
      add(body, 
        h('div', { class: 'field' }, h('label', null, 'Con quién'), chips(nbs.map((n) => [n, w.regions[n].name] as [number, string]), spec.otherId, (v) => ((spec.otherId = v), draw()))),
        h('div', { class: 'field' }, chips<string>([['si', 'Habrá guerra'], ['no', 'No habrá guerra']], spec.claimTrue === undefined ? undefined : spec.claimTrue ? 'si' : 'no', (v) => ((spec.claimTrue = v === 'si'), draw()))),
      );
    }
    if (spec.kind === 'tecnologia' && spec.regionId !== undefined) {
      add(body, h('div', { class: 'field' }, chips<string>([['si', 'Inventará algo'], ['no', 'No inventará nada']], spec.claimTrue === undefined ? undefined : spec.claimTrue ? 'si' : 'no', (v) => ((spec.claimTrue = v === 'si'), draw()))));
    }
    add(body, 
      h('div', { class: 'field' }, h('label', null, 'Plazo'), chips(DAYS.map((d) => [d, `${d} días`] as [number, string]), spec.days, (v) => ((spec.days = v), draw()))),
      h('div', { class: 'field' }, h('label', null, 'Tus notas (opcional)'), noteArea(spec.note, (v) => (spec.note = v))),
    );
    const ready =
      spec.regionId !== undefined &&
      (spec.kind === 'metrica' ? !!spec.metric && !!spec.direction : spec.kind === 'rumor' ? !!spec.rumorId && spec.claimTrue !== undefined : spec.kind === 'conflicto' ? spec.otherId !== undefined && spec.claimTrue !== undefined : spec.claimTrue !== undefined);
    add(body, h('div', { class: 'actions' }, h('button', { class: 'btn primary block', disabled: !ready, onclick: () => confirm() }, 'Registrar hipótesis')));
  };
  let close = () => {};
  const confirm = () => {
    const text = proposeHypothesis(w, spec as HypoSpec);
    audio.sfx('accion');
    close();
    app.toast(text);
    app.refresh();
  };
  draw();
  close = app.modal(() => [body]);
}
