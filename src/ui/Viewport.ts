import { Scene3D } from '../three/Scene3D';
import type { AnalysisResult, Platform, Obstacle } from '../types';
import { SURFACE_LABEL } from '../types';
import { h } from './dom';

export interface ViewportOptions {
  showAnalysisHud?: boolean;
  onModeChange?: (mode: 'day' | 'night') => void;
}

/** 三维视口:挂载 Scene3D 并叠加 HUD/工具栏/图例 */
export class Viewport {
  readonly el: HTMLElement;
  readonly scene: Scene3D;
  private hud: HTMLElement;
  private wireBtn: HTMLButtonElement;
  private result: AnalysisResult | null = null;
  private projectName = '';
  private mode: 'day' | 'night' = 'day';
  private onModeChange?: (mode: 'day' | 'night') => void;

  constructor(cb: ConstructorParameters<typeof Scene3D>[1], opts: ViewportOptions = {}) {
    this.onModeChange = opts.onModeChange;
    const view = h('div', { class: 'viewport' });
    const canvasHost = h('div', { style: 'position:absolute;inset:0' });
    view.appendChild(canvasHost);
    this.scene = new Scene3D(canvasHost, cb);

    this.hud = h('div', { class: 'view-hud' });
    view.appendChild(this.hud);

    this.wireBtn = h('button', {
      class: 'btn sm toggle',
      onclick: () => {
        const on = !this.wireBtn.classList.contains('on');
        this.wireBtn.classList.toggle('on', on);
        this.scene.setWireframe(on);
      },
    }, '线框') as HTMLButtonElement;

    const toolbar = h(
      'div',
      { class: 'view-toolbar' },
      h(
        'div',
        { class: 'mode-switch' },
        h('button', {
          class: 'on',
          'data-mode': 'day',
          onclick: (e: Event) => this.setMode('day', e.target as HTMLElement),
        }, '☀ 日照'),
        h('button', {
          'data-mode': 'night',
          onclick: (e: Event) => this.setMode('night', e.target as HTMLElement),
        }, '🌙 灯光'),
      ),
      this.wireBtn,
      h('button', { class: 'btn sm', onclick: () => this.scene.fitView() }, '复位视角'),
    );
    view.appendChild(toolbar);

    const legend = h(
      'div',
      { class: 'legend' },
      legendRow('#2ecc71', SURFACE_LABEL.approach),
      legendRow('#3498db', SURFACE_LABEL.takeoff),
      legendRow('#f39c12', SURFACE_LABEL.transition),
      legendRow('#9b59b6', SURFACE_LABEL.horizontal),
      legendRow('#ff2a2a', '穿透体'),
    );
    view.appendChild(legend);

    if (opts.showAnalysisHud !== false) this.renderHud();
    this.el = view;
  }

  setProjectName(name: string): void {
    this.projectName = name;
    this.renderHud();
  }

  setData(platform: Platform, obstacles: Obstacle[], hostId: string | null): void {
    this.scene.setData(platform, obstacles, hostId);
  }

  updatePlatform(platform: Platform): void {
    this.scene.updatePlatform(platform);
  }

  updateObstacles(obstacles: Obstacle[], hostId: string | null): void {
    this.scene.updateObstacles(obstacles, hostId);
  }

  setResult(result: AnalysisResult | null): void {
    this.result = result;
    if (result) this.scene.showPenetration(result);
    else this.scene.clearPenetration();
    this.renderHud();
  }

  setMode(mode: 'day' | 'night', btn?: HTMLElement): void {
    this.scene.setMode(mode);
    this.mode = mode;
    this.onModeChange?.(mode);
    // 同步工具栏切换按钮(程序化调用时 btn 为空,按 data-mode 查找)
    const sw = this.el.querySelector('.mode-switch');
    if (sw) {
      [...sw.children].forEach((c) => {
        const on = (c as HTMLElement).dataset.mode === mode;
        c.classList.toggle('on', on);
      });
    }
    if (btn && btn.parentElement) {
      [...btn.parentElement.children].forEach((c) => c.classList.toggle('on', c === btn));
    }
  }

  setTransformMode(mode: 'translate' | 'rotate' | null): void {
    this.scene.setTransformMode(mode);
  }

  get currentMode(): 'day' | 'night' {
    return this.mode;
  }

  private renderHud(): void {
    const chips: HTMLElement[] = [h('div', { class: 'chip' }, '场址:', h('b', {}, this.projectName || '—'))];
    if (this.result) {
      const r = this.result;
      chips.push(
        h(
          'div',
          { class: `chip ${r.penetratedCount > 0 ? 'bad' : 'good'}` },
          '穿透障碍物:',
          h('b', {}, String(r.penetratedCount)),
        ),
        h(
          'div',
          { class: `chip ${r.maxPenetration > 0 ? 'bad' : 'good'}` },
          '最大穿透:',
          h('b', {}, `${r.maxPenetration.toFixed(2)} m`),
        ),
        h('div', { class: 'chip' }, '分析耗时:', h('b', {}, `${r.elapsedMs.toFixed(0)} ms`)),
      );
    }
    this.hud.replaceChildren(...chips);
  }

  dispose(): void {
    this.scene.dispose();
    this.el.remove();
  }
}

function legendRow(color: string, label: string): HTMLElement {
  return h('div', { class: 'row' }, h('span', { class: 'dot', style: `background:${color}` }), label);
}
