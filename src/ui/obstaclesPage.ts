import type { BuildingObstacle, CraneObstacle, Obstacle, Project } from '../types';
import { store } from '../store';
import { h, toast } from './dom';
import type { Viewport } from './Viewport';
import { parseGeoJson } from '../lib/geojson';
import { uid } from '../lib/utils';

export function buildObstacleSidebar(
  project: Project,
  viewport: Viewport,
  rerender: () => void,
): HTMLElement {
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,.geojson,application/geo+json,application/json',
    style: 'display:none',
  }) as HTMLInputElement;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = parseGeoJson(text);
      if (res.buildings.length === 0) {
        toast('未从文件中解析到有效多边形', 'error');
      } else {
        store.update(project.id, (proj) => {
          proj.obstacles.push(...res.buildings);
        });
        const fresh = store.getById(project.id)!;
        viewport.updateObstacles(fresh.obstacles, fresh.platform.hostObstacleId);
        toast(
          `导入 ${res.buildings.length} 个楼块${res.projected ? '（经纬度已投影为米）' : ''}${res.skipped ? `，跳过 ${res.skipped} 个无效几何` : ''}`,
          'success',
          3600,
        );
        rerender();
      }
    } catch (e) {
      toast(`GeoJSON 解析失败:${(e as Error).message}`, 'error', 4000);
    } finally {
      fileInput.value = '';
    }
  });

  const addBlankCrane = () => {
    const crane: CraneObstacle = {
      id: uid('cr'),
      name: `塔吊 ${project.obstacles.filter((o) => o.kind === 'crane').length + 1}`,
      kind: 'crane',
      position: {
        x: project.platform.position.x + 60,
        y: project.platform.position.y + 60,
      },
      baseElevation: 0,
      mastHeight: 80,
      jibLength: 40,
      jibTipHeight: -6,
      jibBearing: project.platform.approachBearing,
    };
    store.update(project.id, (proj) => proj.obstacles.push(crane));
    sync(viewport, project);
    toast('已添加塔吊，可在下方编辑参数，或用「点选放置」改位置', 'success');
    rerender();
  };

  const pickMode = { on: false };
  const pickBtn = h(
    'button',
    {
      class: 'btn sm',
      onclick: () => {
        pickMode.on = !pickMode.on;
        pickBtn.classList.toggle('on', pickMode.on);
        viewport.scene.setPicking(pickMode.on);
        toast(pickMode.on ? '在三维视图中点击地面放置塔吊，按 Esc 取消' : '已退出点选模式');
      },
    },
    '📍 点选放置塔吊',
  ) as HTMLButtonElement;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && pickMode.on) {
      pickMode.on = false;
      pickBtn.classList.remove('on');
      viewport.scene.setPicking(false);
      viewport.scene.clearMarker();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  viewport.scene.setCallbacks({
    onPickPoint: (x: number, y: number) => {
      if (!pickMode.on) return;
      const crane: CraneObstacle = {
        id: uid('cr'),
        name: `塔吊 ${project.obstacles.filter((o) => o.kind === 'crane').length + 1}`,
        kind: 'crane',
        position: { x, y },
        baseElevation: 0,
        mastHeight: 80,
        jibLength: 40,
        jibTipHeight: -6,
        jibBearing: project.platform.approachBearing,
      };
      store.update(project.id, (proj) => proj.obstacles.push(crane));
      sync(viewport, project);
      pickMode.on = false;
      pickBtn.classList.remove('on');
      viewport.scene.setPicking(false);
      viewport.scene.clearMarker();
      toast(`塔吊已放置于 (${x.toFixed(1)}, ${y.toFixed(1)})`, 'success');
      rerender();
    },
  });

  const list = h('div', { class: 'ob-list' });
  project.obstacles.forEach((ob) => list.appendChild(obstacleItem(ob, project, viewport, rerender)));

  const body = h(
    'div',
    { class: 'side-body' },
    h(
      'div',
      { class: 'hint' },
      '支持 GeoJSON Polygon/MultiPolygon，自动识别 height/高度 等属性拉伸楼块；经纬度坐标自动投影为米制平面。',
    ),
    h(
      'div',
      { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn primary sm', onclick: () => fileInput.click() }, '导入 GeoJSON'),
      h('button', { class: 'btn sm', onclick: addBlankCrane }, '＋ 添加塔吊'),
      pickBtn,
      fileInput,
    ),
    h('div', { class: 'section-title', style: 'margin-top:18px' }, `障碍物清单（${project.obstacles.length}）`),
    project.obstacles.length ? list : h('div', { class: 'empty' }, '暂无障碍物，请导入 GeoJSON 或添加塔吊。'),
  );

  return h(
    'div',
    { class: 'sidebar' },
    h('div', { class: 'side-head' }, h('h2', {}, '障碍物库'), h('p', {}, '楼块体导入与临时塔吊管理')),
    body,
  );
}

function sync(viewport: Viewport, project: Project): void {
  const fresh = store.getById(project.id)!;
  viewport.updateObstacles(fresh.obstacles, fresh.platform.hostObstacleId);
}

function obstacleItem(
  ob: Obstacle,
  project: Project,
  viewport: Viewport,
  rerender: () => void,
): HTMLElement {
  const isHost = ob.id === project.platform.hostObstacleId;
  const head = h(
    'div',
    { class: 'name' },
    h('span', {}, ob.name, isHost ? h('span', { class: 'badge good', style: 'margin-left:6px' }, '宿主') : null),
    h(
      'button',
      {
        class: 'btn sm danger',
        onclick: () => {
          store.update(project.id, (proj) => {
            proj.obstacles = proj.obstacles.filter((o) => o.id !== ob.id);
            if (proj.platform.hostObstacleId === ob.id) proj.platform.hostObstacleId = null;
          });
          sync(viewport, project);
          toast('障碍物已删除', 'success');
          rerender();
        },
      },
      '删除',
    ),
  );

  const item = h('div', { class: 'ob-item' }, head);
  item.addEventListener('click', () => {
    viewport.scene.selectObstacle(ob.id);
  });

  if (ob.kind === 'building') {
    const b = ob as BuildingObstacle;
    item.appendChild(
      h(
        'div',
        { class: 'detail' },
        h('div', {}, `类型:楼块 · 顶点 ${b.footprint.length} · 来源:${b.source ?? '手动'}`),
        h('div', {}, `底标高 ${b.baseElevation.toFixed(1)} m · 楼高 ${b.height.toFixed(1)} m · 顶 ${(b.baseElevation + b.height).toFixed(1)} m`),
      ),
    );
    const hInput = h('input', {
      type: 'number',
      value: String(b.height),
      step: '1',
      style: 'margin-top:6px;width:100%',
      oninput: () => {
        const v = parseFloat((hInput as HTMLInputElement).value);
        if (!isFinite(v) || v <= 0) return;
        store.update(project.id, (proj) => {
          const t = proj.obstacles.find((o) => o.id === b.id);
          if (t && t.kind === 'building') t.height = v;
        });
        sync(viewport, project);
      },
    });
    item.appendChild(h('label', { class: 'field', style: 'margin:6px 0 0' }, h('span', {}, '调整楼高(m)'), hInput));
  } else {
    const c = ob as CraneObstacle;
    item.appendChild(
      h(
        'div',
        { class: 'detail' },
        h('div', {}, `类型:塔吊 · 位置 (${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)})`),
        h('div', {}, `塔身高 ${c.mastHeight.toFixed(1)} m · 臂长 ${c.jibLength.toFixed(1)} m · 朝向 ${c.jibBearing.toFixed(0)}°`),
      ),
    );
    const grid = h('div', { class: 'two-col', style: 'margin-top:6px' });
    const field = (label: string, val: number, step: number, fn: (v: number) => void) => {
      const input = h('input', {
        type: 'number',
        value: String(val),
        step: String(step),
        oninput: () => {
          const v = parseFloat((input as HTMLInputElement).value);
          if (isFinite(v)) fn(v);
        },
      }) as HTMLInputElement;
      return h('label', { class: 'field' }, h('span', {}, label), input);
    };
    grid.append(
      field('塔身高 m', c.mastHeight, 1, (v) =>
        updateCrane(project, c.id, { mastHeight: Math.max(1, v) }, viewport),
      ),
      field('臂长 m', c.jibLength, 1, (v) =>
        updateCrane(project, c.id, { jibLength: Math.max(1, v) }, viewport),
      ),
      field('臂顶高差 m', c.jibTipHeight, 0.5, (v) =>
        updateCrane(project, c.id, { jibTipHeight: v }, viewport),
      ),
      field('朝向 °', c.jibBearing, 1, (v) =>
        updateCrane(project, c.id, { jibBearing: ((v % 360) + 360) % 360 }, viewport),
      ),
      field('X m', c.position.x, 1, (v) =>
        updateCrane(project, c.id, { position: { ...c.position, x: v } }, viewport),
      ),
      field('Y m', c.position.y, 1, (v) =>
        updateCrane(project, c.id, { position: { ...c.position, y: v } }, viewport),
      ),
    );
    item.appendChild(grid);
  }
  return item;
}

function updateCrane(
  project: Project,
  id: string,
  patch: Partial<CraneObstacle>,
  viewport: Viewport,
): void {
  store.update(project.id, (proj) => {
    const t = proj.obstacles.find((o) => o.id === id);
    if (t && t.kind === 'crane') Object.assign(t, patch);
  });
  sync(viewport, project);
}
