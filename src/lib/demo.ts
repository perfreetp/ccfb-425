import type { Obstacle, Platform, Project } from '../types';
import { uid } from './utils';
import { DEFAULT_OLS } from './ols';

export function defaultPlatform(): Platform {
  return {
    id: uid('pf'),
    position: { x: 0, y: 0, z: 60 },
    fatoLength: 24,
    fatoWidth: 24,
    safetyMargin: 3,
    approachBearing: 45,
    ols: { ...DEFAULT_OLS },
    hostObstacleId: null,
  };
}

/** 生成一套演示城区楼块 + 塔吊，便于开箱查看效果 */
export function demoObstacles(): Obstacle[] {
  const rect = (
    name: string,
    cx: number,
    cy: number,
    w: number,
    d: number,
    h: number,
    rot = 0,
  ): Obstacle => {
    const local = [
      { x: -w / 2, y: -d / 2 },
      { x: w / 2, y: -d / 2 },
      { x: w / 2, y: d / 2 },
      { x: -w / 2, y: d / 2 },
    ];
    const th = (rot * Math.PI) / 180;
    const s = Math.sin(th);
    const c = Math.cos(th);
    const footprint = local.map((p) => ({
      x: cx + p.x * c - p.y * s,
      y: cy + p.x * s + p.y * c,
    }));
    return {
      id: uid('b'),
      name,
      kind: 'building',
      baseElevation: 0,
      height: h,
      footprint,
      source: '演示数据',
    };
  };

  const list: Obstacle[] = [
    rect('宿主楼顶', 0, 0, 36, 36, 60),
    rect('东侧写字楼 A', 95, 30, 30, 42, 78, 8),
    rect('东侧写字楼 B', 150, 70, 26, 30, 66, 8),
    rect('北侧商场', -20, 130, 60, 28, 32),
    rect('西侧住宅', -110, -40, 24, 60, 54),
    rect('西南塔楼', -80, -120, 34, 34, 88),
    rect('远端公寓', 60, -160, 40, 26, 48),
    rect('临街小楼', 180, -30, 22, 22, 24),
  ];

  list.push({
    id: uid('cr'),
    name: '施工塔吊 T-01',
    kind: 'crane',
    position: { x: 70, y: 110 },
    baseElevation: 0,
    mastHeight: 95,
    jibLength: 45,
    jibTipHeight: -8,
    jibBearing: 230,
  });

  return list;
}

export function newProject(name: string): Project {
  const now = Date.now();
  const obstacles = demoObstacles();
  const platform = defaultPlatform();
  platform.hostObstacleId = obstacles[0].id;
  return {
    id: uid('pj'),
    name,
    description: '',
    createdAt: now,
    updatedAt: now,
    platform,
    obstacles,
    displayMode: 'day',
  };
}
