import type { OlsParams, Platform, SurfaceName, Vec3 } from '../types';
import { deg2rad } from './utils';
import type { Pt } from './geometry';

/** 默认限制面参数(可在编辑页调整) */
export const DEFAULT_OLS: OlsParams = {
  approachLength: 300,
  approachInnerElevation: 0,
  approachSlope: 8,
  takeoffLength: 200,
  takeoffSlope: 8,
  transitionSlope: 2,
  capHeight: 45,
  limitRadius: 400,
};

/** 进近/起飞面侧向扩散率 水平:垂直(1:8) */
const DIVERGENCE = 8;

export interface LocalPoint {
  u: number;
  v: number;
}

/** 过渡面侧边带描述(世界坐标折线，供渲染) */
export interface RibbonSpec {
  inner: Pt[];
  innerZ: number[];
  outer: Pt[];
  outerZ: number[];
}

/**
 * 障碍物限制面模型。
 * 世界坐标:ENU，x 东、y 北、z 绝对标高；局部坐标:u 沿进近方向、v 横向(右正)。
 */
export class OlsModel {
  readonly p: Platform;
  private readonly sin: number;
  private readonly cos: number;
  /** FATO 半宽 */
  readonly w0: number;
  /** 安全区半宽(过渡面内边界起点) */
  readonly wSafe: number;
  readonly z0: number;

  constructor(p: Platform) {
    this.p = p;
    const th = deg2rad(p.approachBearing);
    this.sin = Math.sin(th);
    this.cos = Math.cos(th);
    this.w0 = p.fatoWidth / 2;
    this.wSafe = p.fatoWidth / 2 + p.safetyMargin;
    this.z0 = p.position.z + p.ols.approachInnerElevation;
  }

  get params(): OlsParams {
    return this.p.ols;
  }

  /** FATO 基准面绝对标高 */
  get baseZ(): number {
    return this.z0;
  }

  /** 世界 → 局部 */
  toLocal(x: number, y: number): LocalPoint {
    const dx = x - this.p.position.x;
    const dy = y - this.p.position.y;
    return {
      u: dx * this.sin + dy * this.cos,
      v: dx * this.cos - dy * this.sin,
    };
  }

  /** 局部 → 世界 */
  toWorld(u: number, v: number): Pt {
    return {
      x: this.p.position.x + u * this.sin + v * this.cos,
      y: this.p.position.y + u * this.cos - v * this.sin,
    };
  }

  /** 进近/起飞面在 u 处的半宽 */
  surfaceHalfWidth(u: number): number {
    const d = Math.abs(u);
    return this.wSafe + d / DIVERGENCE;
  }

  /** 进近/起飞面在 u 处的面标高 */
  edgeHeight(u: number): number {
    if (u >= 0) return this.z0 + u / this.params.approachSlope;
    return this.z0 + -u / this.params.takeoffSlope;
  }

  /**
   * 查询某平面位置处的限制面标高(取所有适用面的最低值)。
   * 超出水平限制面半径返回 surface=null。
   */
  query(x: number, y: number): { h: number; surface: SurfaceName | null } {
    const loc = this.toLocal(x, y);
    const { u, v } = loc;
    const dx = x - this.p.position.x;
    const dy = y - this.p.position.y;
    const dist = Math.hypot(dx, dy);
    const cap = this.z0 + this.params.capHeight;
    if (dist > this.params.limitRadius) return { h: NaN, surface: null };

    let best = cap;
    let bestSurface: SurfaceName = 'horizontal';

    // 进近面
    if (u >= 0 && u <= this.params.approachLength) {
      const hw = this.surfaceHalfWidth(u);
      if (Math.abs(v) <= hw) {
        const h = this.edgeHeight(u);
        if (h < best) {
          best = h;
          bestSurface = 'approach';
        }
      }
    }

    // 起飞爬升面
    if (u <= 0 && -u <= this.params.takeoffLength) {
      const hw = this.surfaceHalfWidth(u);
      if (Math.abs(v) <= hw) {
        const h = this.edgeHeight(u);
        if (h < best) {
          best = h;
          bestSurface = 'takeoff';
        }
      }
    }

    // 过渡面:沿进近/起飞面侧边向外抬升，至顶盖高度截止
    const inStrip =
      (u >= 0 && u <= this.params.approachLength) ||
      (u < 0 && -u <= this.params.takeoffLength);
    if (inStrip) {
      const wi = this.surfaceHalfWidth(u);
      const av = Math.abs(v);
      if (av > wi) {
        const d = av - wi;
        const h = this.edgeHeight(u) + d / this.params.transitionSlope;
        if (h < best) {
          best = h;
          bestSurface = 'transition';
        }
      }
    }

    return { h: best, surface: bestSurface };
  }

  /** 进近面俯视多边形(世界坐标) */
  approachPolygon(): Pt[] {
    const o = this.params;
    const w0 = this.wSafe;
    const w1 = this.wSafe + o.approachLength / DIVERGENCE;
    return [
      this.toWorld(0, -w0),
      this.toWorld(o.approachLength, -w1),
      this.toWorld(o.approachLength, w1),
      this.toWorld(0, w0),
    ];
  }

  /** 起飞爬升面俯视多边形 */
  takeoffPolygon(): Pt[] {
    const o = this.params;
    const w0 = this.wSafe;
    const w1 = this.wSafe + o.takeoffLength / DIVERGENCE;
    return [
      this.toWorld(0, -w0),
      this.toWorld(0, w0),
      this.toWorld(-o.takeoffLength, w1),
      this.toWorld(-o.takeoffLength, -w1),
    ];
  }

  /**
   * 过渡面侧带(左右各一，进近段与起飞段分开)。
   * 内边界=进近/起飞面侧边，外边界=抬升至顶盖高度处。
   */
  transitionRibbons(segments = 24): RibbonSpec[] {
    const o = this.params;
    const ribbons: RibbonSpec[] = [];
    const cap = this.params.capHeight;
    for (const side of [-1, 1]) {
      for (const dir of [1, -1] as const) {
        const length = dir > 0 ? o.approachLength : o.takeoffLength;
        const slope = dir > 0 ? o.approachSlope : o.takeoffSlope;
        const inner: Pt[] = [];
        const innerZ: number[] = [];
        const outer: Pt[] = [];
        const outerZ: number[] = [];
        for (let i = 0; i <= segments; i++) {
          const d = (length * i) / segments;
          const u = dir * d;
          const wi = this.surfaceHalfWidth(u);
          const he = this.z0 + d / slope;
          const dCap = Math.max(0, (this.z0 + cap - he) * o.transitionSlope);
          inner.push(this.toWorld(u, side * wi));
          innerZ.push(he);
          outer.push(this.toWorld(u, side * (wi + dCap)));
          outerZ.push(this.z0 + cap);
        }
        ribbons.push({ inner, innerZ, outer, outerZ });
      }
    }
    return ribbons;
  }

  /** 水平限制面圆心与半径 */
  horizontalCap(): { center: Vec3; radius: number; z: number } {
    return {
      center: { ...this.p.position },
      radius: this.params.limitRadius,
      z: this.z0 + this.params.capHeight,
    };
  }
}
