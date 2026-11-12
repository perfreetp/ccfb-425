import type { AnalysisResult, Project, SurfaceName } from '../types';
import { SURFACE_LABEL } from '../types';
import { store } from '../store';
import { h, toast } from './dom';
import type { Viewport } from './Viewport';
import { runAnalysis } from '../lib/analysis';

export function buildAnalysisSidebar(
  project: Project,
  viewport: Viewport,
  rerender: () => void,
): { sidebar: HTMLElement; analyze: () => AnalysisResult } {
  const analyze = (): AnalysisResult => {
    const fresh = store.getById(project.id)!;
    const result = runAnalysis(fresh.platform, fresh.obstacles);
    result.projectId = fresh.id;
    viewport.setResult(result);
    return result;
  };

  const result = runAnalysis(store.getById(project.id)!.platform, store.getById(project.id)!.obstacles);
  viewport.setResult(result);

  const filterState: { surface: SurfaceName | 'all' } = { surface: 'all' };

  const stats = h(
    'div',
    { class: 'stats-row' },
    statCard(String(project.obstacles.length), '障碍物总数', ''),
    statCard(String(result.penetratedCount), '穿透障碍物', result.penetratedCount > 0 ? 'danger' : 'ok'),
    statCard(`${result.maxPenetration.toFixed(2)} m`, '最大穿透高度', result.maxPenetration > 0 ? 'danger' : 'ok'),
  );

  const filterBtns = (['all', 'approach', 'takeoff', 'transition', 'horizontal'] as const).map((s) =>
    h(
      'button',
      {
        class: `btn sm ${filterState.surface === s ? 'toggle on' : ''}`,
        onclick: () => {
          filterState.surface = s;
          rerender();
        },
      },
      s === 'all' ? '全部' : SURFACE_LABEL[s],
    ),
  );

  const rows = result.results
    .filter((r) => r.penetrated)
    .filter((r) => filterState.surface === 'all' || r.surface === filterState.surface)
    .sort((a, b) => b.maxPenetration - a.maxPenetration);

  const table =
    rows.length === 0
      ? h(
          'div',
          { class: 'empty' },
          result.penetratedCount === 0
            ? '✓ 所有障碍物均位于限制面以下，净空条件满足要求。'
            : '当前筛选条件下没有穿透记录。',
        )
      : h(
          'div',
          { style: 'overflow-x:auto' },
          h(
            'table',
            { class: 'data' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', {}, '障碍物'),
                h('th', {}, '类型'),
                h('th', {}, '穿透面'),
                h('th', {}, '穿透高度'),
                h('th', {}, '限制面标高'),
                h('th', {}, '最大穿透点 E,N,Z'),
              ),
            ),
            h(
              'tbody',
              {},
              ...rows.map((r) =>
                h(
                  'tr',
                  { class: 'pen' },
                  h('td', {}, r.obstacleName),
                  h('td', {}, r.obstacleKind === 'building' ? '楼块' : '塔吊'),
                  h('td', {}, SURFACE_LABEL[r.surface!]),
                  h('td', {}, `${r.maxPenetration.toFixed(2)} m`),
                  h('td', {}, `${(r.limitElevation ?? 0).toFixed(2)} m`),
                  h(
                    'td',
                    {},
                    `${r.maxPoint!.x.toFixed(1)}, ${r.maxPoint!.y.toFixed(1)}, ${r.maxPoint!.z.toFixed(1)}`,
                  ),
                ),
              ),
            ),
          ),
        );

  const sidebar = h(
    'div',
    { class: 'sidebar' },
    h(
      'div',
      { class: 'side-head' },
      h('h2', {}, '净空分析'),
      h('p', {}, `基于网格扫描与沿线采样，耗时 ${result.elapsedMs.toFixed(1)} ms`),
    ),
    h(
      'div',
      { class: 'side-body' },
      h(
        'div',
        { class: 'hint' },
        '红色体块即障碍物穿出限制面的部分；在编辑页拖动平台或转动进近方向后，回到本页会自动重新计算。',
      ),
      stats,
      h(
        'div',
        { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px' },
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => {
              analyze();
              toast('净空分析已刷新', 'success');
              rerender();
            },
          },
          '重新计算',
        ),
        ...filterBtns,
      ),
      h('div', { class: 'section-title' }, `穿透清单（${rows.length}）`),
      table,
    ),
  );

  return { sidebar, analyze };
}

function statCard(num: string, label: string, cls: string): HTMLElement {
  return h('div', { class: `stat ${cls}` }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, label));
}
