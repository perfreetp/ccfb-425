import type { Project } from './types';
import { deepClone, downloadText, readTextFile, uid } from './lib/utils';
import { defaultPlatform, newProject } from './lib/demo';

const STORAGE_KEY = 'evtol-ols-studio:v1';

interface StoreShape {
  projects: Project[];
  activeId: string | null;
}

type Listener = () => void;

class Store {
  private state: StoreShape = { projects: [], activeId: null };
  private listeners = new Set<Listener>();

  constructor() {
    this.load();
    if (this.state.projects.length === 0) {
      this.seed();
    }
  }

  private seed(): void {
    const p = newProject('示例场址 · 中央商务区');
    p.description = '内置演示数据:宿主楼顶平台 + 周边楼块与施工塔吊';
    this.state = { projects: [p], activeId: p.id };
    this.persist();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoreShape;
        if (Array.isArray(parsed.projects)) {
          this.state = parsed;
        }
      }
    } catch (e) {
      console.error('读取本地数据失败', e);
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('写入本地数据失败', e);
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get projects(): Project[] {
    return this.state.projects;
  }

  get activeId(): string | null {
    return this.state.activeId;
  }

  get active(): Project | null {
    return this.state.projects.find((p) => p.id === this.state.activeId) ?? null;
  }

  getById(id: string): Project | null {
    return this.state.projects.find((p) => p.id === id) ?? null;
  }

  select(id: string): void {
    this.state.activeId = id;
    this.persist();
    this.emit();
  }

  create(name: string): Project {
    const now = Date.now();
    const project: Project = {
      id: uid('pj'),
      name: name || '未命名场址',
      description: '',
      createdAt: now,
      updatedAt: now,
      platform: defaultPlatform(),
      obstacles: [],
      displayMode: 'day',
    };
    this.state.projects.unshift(project);
    this.state.activeId = project.id;
    this.persist();
    this.emit();
    return project;
  }

  duplicate(id: string): Project | null {
    const src = this.getById(id);
    if (!src) return null;
    const copy = deepClone(src);
    copy.id = uid('pj');
    copy.name = `${src.name} 副本`;
    copy.platform.id = uid('pf');
    const idMap = new Map<string, string>();
    for (const ob of copy.obstacles) {
      const nid = uid(ob.kind === 'building' ? 'b' : 'cr');
      idMap.set(ob.id, nid);
      ob.id = nid;
    }
    if (copy.platform.hostObstacleId) {
      copy.platform.hostObstacleId = idMap.get(copy.platform.hostObstacleId) ?? null;
    }
    copy.updatedAt = Date.now();
    const idx = this.state.projects.findIndex((p) => p.id === id);
    this.state.projects.splice(idx + 1, 0, copy);
    this.state.activeId = copy.id;
    this.persist();
    this.emit();
    return copy;
  }

  remove(id: string): void {
    const idx = this.state.projects.findIndex((p) => p.id === id);
    if (idx < 0) return;
    this.state.projects.splice(idx, 1);
    if (this.state.activeId === id) {
      this.state.activeId = this.state.projects[0]?.id ?? null;
    }
    this.persist();
    this.emit();
  }

  /** 以更新函数修改项目并持久化 */
  update(id: string, fn: (p: Project) => void): void {
    const p = this.getById(id);
    if (!p) return;
    fn(p);
    p.updatedAt = Date.now();
    this.persist();
    this.emit();
  }

  exportProject(id: string): void {
    const p = this.getById(id);
    if (!p) return;
    downloadText(`${p.name.replace(/[\\/:*?"<>|]/g, '_')}.json`, JSON.stringify(p, null, 2));
  }

  exportAll(): void {
    downloadText(
      `evtol-projects-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(this.state.projects, null, 2),
    );
  }

  async importFile(file: File): Promise<Project> {
    const text = await readTextFile(file);
    const data = JSON.parse(text);
    const items: Project[] = Array.isArray(data) ? data : [data];
    const imported: Project[] = [];
    for (const item of items) {
      if (!item.platform || !Array.isArray(item.obstacles)) {
        throw new Error('文件格式不正确:缺少 platform 或 obstacles 字段');
      }
      const p = item as Project;
      p.id = uid('pj');
      p.platform.id = uid('pf');
      const idMap = new Map<string, string>();
      for (const ob of p.obstacles) {
        const nid = uid(ob.kind === 'building' ? 'b' : 'cr');
        idMap.set(ob.id, nid);
        ob.id = nid;
      }
      if (p.platform.hostObstacleId) {
        p.platform.hostObstacleId = idMap.get(p.platform.hostObstacleId) ?? null;
      }
      p.updatedAt = Date.now();
      imported.push(p);
    }
    this.state.projects.unshift(...imported);
    this.state.activeId = imported[0].id;
    this.persist();
    this.emit();
    return imported[0];
  }
}

export const store = new Store();
