import type { Platform, Project } from '../types';
import { store } from '../store';
import { h, clear, toast } from './dom';
import { Viewport } from './Viewport';
import { runAnalysis } from '../lib/analysis';
import { renderProjectsPage } from './projectsPage';
import { buildEditorSidebar } from './editorForm';
import { buildObstacleSidebar } from './obstaclesPage';
import { buildAnalysisSidebar } from './analysisPage';
import { buildReportSidebar } from './reportPage';

export type PageName = 'projects' | 'editor' | 'obstacles' | 'analysis' | 'report';

const TABS: Array<{ key: PageName; label: string }> = [
  { key: 'projects', label: '项目列表' },
  { key: 'editor', label: '场址编辑' },
  { key: 'obstacles', label: '障碍物库' },
  { key: 'analysis', label: '净空分析' },
  { key: 'report', label: '报告' },
];

export class App {
  private root: HTMLElement;
  private page: PageName = 'projects';
  private projectId: string | null = null;
  private viewport: Viewport | null = null;
  private analyzeTimer: number | undefined;
  private transformMode: 'translate' | 'rotate' = 'translate';

  constructor(root: HTMLElement) {
    this.root = root;
    store.subscribe(() => this.render());
    this.render();
  }

  private get project() {
    return this.projectId ? store.getById(this.projectId) : store.active;
  }

  go = (page: PageName, id?: string): void => {
    if (id) {
      this.projectId = id;
      store.select(id);
    }
    this.page = page;
    this.render();
  };

  private render(): void {
    clear(this.root);
    const project = this.project;

    const tabEls = TABS.map((t) => {
      const disabled = t.key !== 'projects' && !project;
      return h(
        'button',
        {
          class: `tab ${this.page === t.key ? 'active' : ''}`,
          disabled: disabled ? '' : null,
          onclick: () => this.go(t.key),
        },
        t.label,
      );
    });

    const topbar = h(
      'div',
      { class: 'topbar' },
      h('div', { class: 'logo' }, h('span', { class: 'mark' }, '✈'), 'eVTOL 净空分析'),
      h('div', { class: 'tabs' }, ...tabEls),
      h('div', { class: 'spacer' }),
      project
        ? h(
            'select',
            {
              onchange: (e: Event) => {
                const id = (e.target as HTMLSelectElement).value;
                this.go(this.page === 'projects' ? 'editor' : this.page, id);
              },
            },
            ...store.projects.map((p) =>
              h('option', { value: p.id, selected: p.id === project.id ? '' : null }, p.name),
            ),
          )
        : null,
    );

    const main = h('div', { class: 'main' });
    this.root.append(topbar, main);

    if (this.page === 'projects' || !project) {
      this.destroyViewport();
      renderProjectsPage(main, this.go);
      return;
    }

    this.ensureViewport(main, project);
    this.renderWorkspace(main, project);
  }

  private destroyViewport(): void {
    if (this.viewport) {
      this.viewport.dispose();
      this.viewport = null;
    }
  }

  private ensureViewport(main: HTMLElement, project: Project): void {
    if (!this.viewport) {
      this.viewport = new Viewport(
        {
          onPlatformChange: (patch: Partial<Platform>) => this.handlePlatformChange(patch),
          onSelectObstacle: (id) => {
            this.viewport?.scene.selectObstacle(id);
          },
        },
        {
          onModeChange: (mode) => {
            const p = this.project;
            if (p && p.displayMode !== mode) {
              store.update(p.id, (proj) => {
                proj.displayMode = mode;
              });
            }
          },
        },
      );
      this.viewport.setProjectName(project.name);
      this.viewport.setData(project.platform, project.obstacles, project.platform.hostObstacleId);
    } else {
      // 切换项目时整体重建
      this.viewport.setProjectName(project.name);
      this.viewport.setData(project.platform, project.obstacles, project.platform.hostObstacleId);
    }
    // 应用该项目保存的显示模式
    this.viewport.setMode(project.displayMode);
    main.appendChild(this.viewport.el);
    requestAnimationFrame(() => this.viewport?.scene.resize());
  }

  private renderWorkspace(main: HTMLElement, project: Project): void {
    const vp = this.viewport!;
    vp.setTransformMode(this.transformMode);
    const rerender = () => this.render();

    let sidebar: HTMLElement;
    switch (this.page) {
      case 'editor':
        sidebar = buildEditorSidebar(project, vp, rerender);
        break;
      case 'obstacles':
        sidebar = buildObstacleSidebar(project, vp, rerender);
        break;
      case 'analysis':
        sidebar = buildAnalysisSidebar(project, vp, rerender).sidebar;
        break;
      case 'report':
        sidebar = buildReportSidebar(project, vp);
        break;
      default:
        sidebar = h('div', { class: 'sidebar' });
    }
    main.insertBefore(sidebar, vp.el);

    const tb = vp.el.querySelector('.view-toolbar') as HTMLElement;
    // 编辑页额外的平移/旋转模式工具;非编辑页移除,避免跨页残留
    tb.querySelectorAll('[data-tf-mode]').forEach((el) => el.remove());
    if (this.page === 'editor') {
      const modeBtn = (mode: 'translate' | 'rotate', label: string) => {
        const btn = h('button', { class: 'btn sm toggle' }, label);
        if (this.transformMode === mode) btn.classList.add('on');
        btn.addEventListener('click', () => {
          this.transformMode = mode;
          vp.setTransformMode(mode);
          tb.querySelectorAll('[data-tf-mode]').forEach((el) => {
            el.classList.toggle('on', (el as HTMLElement).dataset.tfMode === mode);
          });
        });
        btn.setAttribute('data-tf-mode', mode);
        return btn;
      };
      tb.prepend(modeBtn('translate', '✥ 平移'), modeBtn('rotate', '⟳ 旋转'));
    } else {
      vp.setTransformMode(null);
    }
  }

  /** 拖拽/旋转结束:写回 store 并防抖触发穿透重算(目标 <1s 刷新) */
  private handlePlatformChange(patch: Partial<Platform>): void {
    const project = this.project;
    if (!project) return;
    store.update(project.id, (p) => {
      if (patch.position) p.platform.position = { ...patch.position };
      if (typeof patch.approachBearing === 'number') {
        p.platform.approachBearing = patch.approachBearing;
      }
    });
    // 拖拽结束后立即让限制面与平台姿态同步
    const fresh0 = store.getById(project.id);
    if (fresh0) this.viewport?.updatePlatform(fresh0.platform);
    window.clearTimeout(this.analyzeTimer);
    this.analyzeTimer = window.setTimeout(() => {
      const fresh = store.getById(project.id);
      if (!fresh || !this.viewport) return;
      const result = runAnalysis(fresh.platform, fresh.obstacles);
      this.viewport.setResult(result);
      if (this.page === 'analysis' || this.page === 'report') {
        this.render();
      }
      toast(`穿透结果已刷新（${result.elapsedMs.toFixed(0)} ms）`, 'info', 1400);
    }, 250);
  }
}
