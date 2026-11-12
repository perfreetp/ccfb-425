import type { Project } from '../types';
import { store } from '../store';
import { h, toast } from './dom';
import type { Viewport } from './Viewport';
import { OlsParams, Platform } from '../types';

export function buildEditorSidebar(
  project: Project,
  viewport: Viewport,
  rerender: () => void,
): HTMLElement {
  const p = project.platform;

  const num = (
    label: string,
    value: number,
    step: number,
    onChange: (v: number) => void,
    unit = 'm',
  ) => {
    const input = h('input', {
      type: 'number',
      step: String(step),
      value: String(value),
      oninput: () => {
        const v = parseFloat((input as HTMLInputElement).value);
        if (isFinite(v)) onChange(v);
      },
    }) as HTMLInputElement;
    return h('label', { class: 'field' }, h('span', {}, `${label}（${unit}）`), input);
  };

  const patchPlatform = (patch: Partial<Platform>, instant = true) => {
    store.update(project.id, (proj) => {
      Object.assign(proj.platform, patch);
    });
    if (instant) viewport.updatePlatform(store.getById(project.id)!.platform);
  };

  const patchOls = (patch: Partial<OlsParams>) => {
    store.update(project.id, (proj) => {
      Object.assign(proj.platform.ols, patch);
    });
    viewport.updatePlatform(store.getById(project.id)!.platform);
  };

  const buildings = project.obstacles.filter((o) => o.kind === 'building');

  const body = h(
    'div',
    { class: 'side-body' },
    h('div', { class: 'hint' }, '在三维视图中拖动平台平移位置，切换到旋转模式可调整进近方向；参数修改后穿透结果实时刷新。'),

    section('平台位置与标高'),
    h(
      'div',
      { class: 'three-col' },
      num('东向 X', p.position.x, 1, (v) => patchPlatform({ position: { ...p.position, x: v } })),
      num('北向 Y', p.position.y, 1, (v) => patchPlatform({ position: { ...p.position, y: v } })),
      num('标高 Z', p.position.z, 1, (v) => patchPlatform({ position: { ...p.position, z: v } })),
    ),

    section('FATO 与进近方向'),
    h(
      'div',
      { class: 'two-col' },
      num('FATO 长度', p.fatoLength, 1, (v) => patchPlatform({ fatoLength: Math.max(4, v) })),
      num('FATO 宽度', p.fatoWidth, 1, (v) => patchPlatform({ fatoWidth: Math.max(4, v) })),
    ),
    num('安全区外扩', p.safetyMargin, 0.5, (v) => patchPlatform({ safetyMargin: Math.max(0, v) })),
    num('进近方位角', p.approachBearing, 1, (v) => {
      const b = ((v % 360) + 360) % 360;
      patchPlatform({ approachBearing: b });
    }, '°'),

    section('进近面 / 起飞爬升面'),
    h(
      'div',
      { class: 'two-col' },
      num('进近面长度', p.ols.approachLength, 10, (v) => patchOls({ approachLength: Math.max(20, v) })),
      num('进近坡度 1:', p.ols.approachSlope, 0.5, (v) => patchOls({ approachSlope: Math.max(1, v) }), '水平'),
    ),
    h(
      'div',
      { class: 'two-col' },
      num('起飞面长度', p.ols.takeoffLength, 10, (v) => patchOls({ takeoffLength: Math.max(20, v) })),
      num('起飞坡度 1:', p.ols.takeoffSlope, 0.5, (v) => patchOls({ takeoffSlope: Math.max(1, v) }), '水平'),
    ),

    section('过渡面与水平限制面'),
    h(
      'div',
      { class: 'two-col' },
      num('过渡坡度 1:', p.ols.transitionSlope, 0.5, (v) => patchOls({ transitionSlope: Math.max(1, v) }), '水平'),
      num('顶盖高度', p.ols.capHeight, 1, (v) => patchOls({ capHeight: Math.max(1, v) })),
    ),
    num('水平限制面半径', p.ols.limitRadius, 10, (v) => patchOls({ limitRadius: Math.max(50, v) })),

    section('宿主楼顶（该楼不参与穿透判断）'),
    (() => {
      const sel = h('select', {
        style: 'width:100%',
        onchange: () => {
          const val = (sel as HTMLSelectElement).value;
          patchPlatform({ hostObstacleId: val === '' ? null : val });
          viewport.updateObstacles(store.getById(project.id)!.obstacles, val || null);
          rerender();
        },
      },
        h('option', { value: '' }, '不指定（地面平台）'),
        ...buildings.map((b) =>
          h('option', { value: b.id, selected: b.id === p.hostObstacleId ? '' : null }, b.name),
        ),
      ) as HTMLSelectElement;
      return sel;
    })(),
    h(
      'div',
      { style: 'margin-top:10px;display:flex;gap:8px;flex-wrap:wrap' },
      h(
        'button',
        {
          class: 'btn sm',
          onclick: () => {
            patchPlatform({
              position: { x: 0, y: 0, z: p.position.z },
            });
            toast('平台位置已归零', 'info');
          },
        },
        '位置归零',
      ),
      h(
        'button',
        {
          class: 'btn sm ghost',
          onclick: () => {
            store.update(project.id, (proj) => {
              proj.platform.approachBearing = 0;
            });
            viewport.updatePlatform(store.getById(project.id)!.platform);
            rerender();
          },
        },
        '方位角归零',
      ),
    ),
  );

  return h(
    'div',
    { class: 'sidebar' },
    h(
      'div',
      { class: 'side-head' },
      h('h2', {}, '场址编辑'),
      h('p', {}, '调整平台几何与障碍物限制面参数'),
    ),
    body,
  );
}

function section(title: string): HTMLElement {
  return h('div', { class: 'section-title' }, title);
}
