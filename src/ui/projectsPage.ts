import type { Project } from '../types';
import { store } from '../store';
import { h, mount, toast, confirmModal } from './dom';
import { formatTime } from '../lib/utils';
import { runAnalysis } from '../lib/analysis';
import type { PageName } from './app';

export function renderProjectsPage(root: HTMLElement, go: (p: PageName, id?: string) => void): void {
  const projects = store.projects;

  const createProject = () => {
    const name = `新建场址 ${projects.length + 1}`;
    const p = store.create(name);
    toast(`项目「${p.name}」已创建`, 'success');
    go('editor', p.id);
  };

  const importInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    style: 'display:none',
  }) as HTMLInputElement;
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const p = await store.importFile(file);
      toast(`已导入「${p.name}」`, 'success');
      go('editor', p.id);
    } catch (e) {
      toast(`导入失败:${(e as Error).message}`, 'error', 4000);
    } finally {
      importInput.value = '';
    }
  });

  const cards = projects.map((p) => projectCard(p, go));

  const page = h(
    'div',
    { class: 'projects-page' },
    h(
      'div',
      { class: 'projects-inner' },
      h('h1', {}, 'eVTOL 起降点净空分析系统'),
      h(
        'p',
        { class: 'sub' },
        '楼顶场址三维选址 · 自动生成进近面/起飞爬升面/过渡面 · 障碍物穿透校核与 PDF 报告',
      ),
      h(
        'div',
        { class: 'tool-row' },
        h('button', { class: 'btn primary', onclick: createProject }, '＋ 新建项目'),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => importInput.click(),
          },
          '导入项目(JSON)',
        ),
        h(
          'button',
          {
            class: 'btn ghost',
            onclick: () => {
              if (projects.length === 0) return toast('暂无项目可导出', 'error');
              store.exportAll();
              toast('已导出全部项目', 'success');
            },
          },
          '导出全部',
        ),
        importInput,
      ),
      cards.length
        ? h('div', { class: 'card-grid' }, ...cards)
        : h('div', { class: 'empty' }, '还没有项目，点击「新建项目」开始，或导入已有项目文件。'),
    ),
  );

  mount(root, page);
}

function projectCard(p: Project, go: (p: PageName, id?: string) => void): HTMLElement {
  const result = runAnalysis(p.platform, p.obstacles);
  const hasPen = result.penetratedCount > 0;
  return h(
    'div',
    {
      class: 'pcard',
      onclick: () => go('editor', p.id),
    },
    h('h3', {}, p.name),
    h(
      'div',
      { class: 'meta' },
      h('div', {}, p.description || '（无描述）'),
      h('div', {}, `更新于 ${formatTime(p.updatedAt)}`),
      h(
        'div',
        { style: 'display:flex;gap:8px;margin-top:6px;flex-wrap:wrap' },
        h('span', { class: 'badge' }, `障碍物 ${p.obstacles.length}`),
        h(
          'span',
          { class: `badge ${hasPen ? 'bad' : 'good'}` },
          hasPen ? `穿透 ${result.penetratedCount} 处` : '净空合格',
        ),
        h('span', { class: 'badge' }, `进近 ${p.platform.approachBearing.toFixed(0)}°`),
      ),
    ),
    h(
      'div',
      { class: 'card-actions' },
      h(
        'button',
        {
          class: 'btn sm',
          onclick: (e: Event) => {
            e.stopPropagation();
            go('analysis', p.id);
          },
        },
        '净空分析',
      ),
      h(
        'button',
        {
          class: 'btn sm',
          onclick: (e: Event) => {
            e.stopPropagation();
            const copy = store.duplicate(p.id);
            if (copy) toast(`已复制为「${copy.name}」`, 'success');
          },
        },
        '复制',
      ),
      h(
        'button',
        {
          class: 'btn sm',
          onclick: (e: Event) => {
            e.stopPropagation();
            store.exportProject(p.id);
          },
        },
        '导出',
      ),
      h(
        'button',
        {
          class: 'btn sm danger',
          onclick: async (e: Event) => {
            e.stopPropagation();
            const ok = await confirmModal('删除项目', `确定删除「${p.name}」？该操作不可恢复。`);
            if (ok) {
              store.remove(p.id);
              toast('项目已删除', 'success');
            }
          },
        },
        '删除',
      ),
    ),
  );
}
