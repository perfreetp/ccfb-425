import type {
  AnalysisResult,
  BuildingObstacle,
  CraneObstacle,
  Obstacle,
  ObstaclePenetration,
  PenetrationBox,
  PenetrationPoint,
  Platform,
  SurfaceName,
  Vec3,
} from '../types';
import { OlsModel } from './ols';
import { bbox, gridStep, pointInPolygon } from './geometry';

const EPS = 0.05;

interface Cell {
  ix: number;
  iy: number;
  x: number;
  y: number;
  h: number;
  surface: SurfaceName;
}

/** 网格相邻穿透格合并为长方体盒 */
function mergeCells(cells: Cell[], step: number, topZ: number): PenetrationBox[] {
  const key = (ix: number, iy: number) => `${ix},${iy}`;
  const map = new Map<string, Cell>();
  for (const c of cells) map.set(key(c.ix, c.iy), c);
  const visited = new Set<string>();
  const boxes: PenetrationBox[] = [];

  for (const start of cells) {
    const sk = key(start.ix, start.iy);
    if (visited.has(sk)) continue;
    const stack: Cell[] = [start];
    const group: Cell[] = [];
    visited.add(sk);
    while (stack.length) {
      const c = stack.pop()!;
      group.push(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = key(c.ix + dx, c.iy + dy);
        const n = map.get(nk);
        if (n && !visited.has(nk)) {
          visited.add(nk);
          stack.push(n);
        }
      }
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let bottomZ = Infinity;
    const surfaceVotes = new Map<SurfaceName, number>();
    for (const c of group) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
      bottomZ = Math.min(bottomZ, c.h);
      surfaceVotes.set(c.surface, (surfaceVotes.get(c.surface) ?? 0) + 1);
    }
    let surface: SurfaceName = group[0].surface;
    let bestVote = 0;
    for (const [s, n] of surfaceVotes) {
      if (n > bestVote) {
        bestVote = n;
        surface = s;
      }
    }
    const half = step / 2;
    boxes.push({
      minX: minX - half,
      maxX: maxX + half,
      minY: minY - half,
      maxY: maxY + half,
      bottomZ,
      topZ,
      surface,
    });
  }
  return boxes;
}

function analyzeBuilding(
  b: BuildingObstacle,
  model: OlsModel,
): ObstaclePenetration {
  const result: ObstaclePenetration = {
    obstacleId: b.id,
    obstacleName: b.name,
    obstacleKind: 'building',
    penetrated: false,
    maxPenetration: 0,
    maxPoint: null,
    limitElevation: null,
    surface: null,
    boxes: [],
    points: [],
  };
  if (b.footprint.length < 3) return result;
  const box = bbox(b.footprint);
  const topZ = b.baseElevation + b.height;
  const step = gridStep(box);
  const cells: Cell[] = [];
  let maxPen = 0;
  let maxCell: Cell | null = null;

  for (let ix = 0, x = box.minX + step / 2; x < box.maxX; ix++, x += step) {
    for (let iy = 0, y = box.minY + step / 2; y < box.maxY; iy++, y += step) {
      if (!pointInPolygon({ x, y }, b.footprint)) continue;
      const q = model.query(x, y);
      if (!q.surface) continue;
      if (topZ > q.h + EPS) {
        const cell: Cell = { ix, iy, x, y, h: q.h, surface: q.surface };
        cells.push(cell);
        const pen = topZ - q.h;
        if (pen > maxPen) {
          maxPen = pen;
          maxCell = cell;
        }
      }
    }
  }

  if (cells.length === 0 || !maxCell) return result;
  result.penetrated = true;
  result.maxPenetration = maxPen;
  result.maxPoint = { x: maxCell.x, y: maxCell.y, z: topZ };
  result.limitElevation = maxCell.h;
  result.surface = maxCell.surface;
  result.boxes = mergeCells(cells, step, topZ);
  return result;
}

function analyzeCrane(c: CraneObstacle, model: OlsModel): ObstaclePenetration {
  const result: ObstaclePenetration = {
    obstacleId: c.id,
    obstacleName: c.name,
    obstacleKind: 'crane',
    penetrated: false,
    maxPenetration: 0,
    maxPoint: null,
    limitElevation: null,
    surface: null,
    boxes: [],
    points: [],
  };

  const points: PenetrationPoint[] = [];
  const mastTop = c.baseElevation + c.mastHeight;
  const consider = (x: number, y: number, z: number) => {
    const q = model.query(x, y);
    if (!q.surface) return;
    if (z > q.h + EPS) {
      points.push({ x, y, z, limitZ: q.h, surface: q.surface });
    }
  };

  // 塔身:同一平面位置，最高点最不利
  consider(c.position.x, c.position.y, mastTop);

  // 起重臂:沿线采样，臂顶线性收坡
  const samples = Math.max(20, Math.ceil(c.jibLength / 2));
  const th = (c.jibBearing * Math.PI) / 180;
  const sx = Math.sin(th);
  const cy = Math.cos(th);
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const d = c.jibLength * t;
    const x = c.position.x + d * sx;
    const y = c.position.y + d * cy;
    const z = mastTop + c.jibTipHeight * t;
    consider(x, y, z);
  }

  if (points.length === 0) return result;
  let maxPen = 0;
  let maxPt: PenetrationPoint | null = null;
  for (const pt of points) {
    const pen = pt.z - pt.limitZ;
    if (pen > maxPen) {
      maxPen = pen;
      maxPt = pt;
    }
  }
  result.penetrated = true;
  result.points = points;
  result.maxPenetration = maxPen;
  result.maxPoint = { x: maxPt!.x, y: maxPt!.y, z: maxPt!.z };
  result.limitElevation = maxPt!.limitZ;
  result.surface = maxPt!.surface;
  return result;
}

/** 对项目执行完整净空穿透分析 */
export function runAnalysis(platform: Platform, obstacles: Obstacle[]): AnalysisResult {
  const t0 = performance.now();
  const model = new OlsModel(platform);
  const results: ObstaclePenetration[] = [];
  let penetratedCount = 0;
  let maxPenetration = 0;

  for (const ob of obstacles) {
    if (ob.id === platform.hostObstacleId) continue;
    const r = ob.kind === 'building' ? analyzeBuilding(ob, model) : analyzeCrane(ob, model);
    results.push(r);
    if (r.penetrated) {
      penetratedCount++;
      maxPenetration = Math.max(maxPenetration, r.maxPenetration);
    }
  }

  return {
    projectId: '',
    results,
    penetratedCount,
    maxPenetration,
    elapsedMs: performance.now() - t0,
  };
}

export function emptyResult(): AnalysisResult {
  return { projectId: '', results: [], penetratedCount: 0, maxPenetration: 0, elapsedMs: 0 };
}

export type { Vec3 };
