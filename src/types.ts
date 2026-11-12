/** 全局数据类型定义 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 障碍物限制面(OLS)参数，长度单位米、坡度为 水平/垂直 的比值(如 8 = 1:8) */
export interface OlsParams {
  /** 进近面总水平长度 m */
  approachLength: number;
  /** 进近面内端相对 FATO 标高的超高 m(通常 0) */
  approachInnerElevation: number;
  /** 进近面坡度 水平:垂直，如 8 表示 1:8 */
  approachSlope: number;
  /** 起飞爬升面总水平长度 m */
  takeoffLength: number;
  /** 起飞爬升面坡度 水平:垂直 */
  takeoffSlope: number;
  /** 过渡面坡度 水平:垂直 */
  transitionSlope: number;
  /** 过渡面外侧水平限制面(顶盖)相对 FATO 标高的高度 m */
  capHeight: number;
  /** 水平限制面覆盖半径 m(自平台中心计) */
  limitRadius: number;
}

/** 起降平台 */
export interface Platform {
  id: string;
  /** 平台中心世界坐标(ENU,米)，z 为平台面绝对标高 */
  position: Vec3;
  /** FATO 沿进近方向的长度 m */
  fatoLength: number;
  /** FATO 横向宽度 m */
  fatoWidth: number;
  /** 安全区(TLOF 外围)外扩 m */
  safetyMargin: number;
  /** 进近方向，自正北顺时针的方位角(度) */
  approachBearing: number;
  /** 限制面参数 */
  ols: OlsParams;
  /** 承载该平台的楼顶障碍物 id，该障碍物不参与穿透判断 */
  hostObstacleId: string | null;
}

/** 多边形楼块障碍物 */
export interface BuildingObstacle {
  id: string;
  name: string;
  kind: 'building';
  /** 地面标高 m(绝对) */
  baseElevation: number;
  /** 楼顶相对地面的高度 m */
  height: number;
  /** 俯视多边形顶点(世界 ENU 的 x/y) */
  footprint: Array<{ x: number; y: number }>;
  source?: string;
}

/** 临时塔吊障碍物 */
export interface CraneObstacle {
  id: string;
  name: string;
  kind: 'crane';
  /** 塔身中心平面坐标 m */
  position: { x: number; y: number };
  /** 地面标高 m(绝对) */
  baseElevation: number;
  /** 塔身高 m */
  mastHeight: number;
  /** 起重臂长 m(自塔身中心计) */
  jibLength: number;
  /** 臂顶相对塔尖的高差 m(平衡臂侧可填负) */
  jibTipHeight: number;
  /** 起重臂朝向，自正北顺时针方位角(度) */
  jibBearing: number;
}

export type Obstacle = BuildingObstacle | CraneObstacle;

/** 项目(一个场址) */
export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  platform: Platform;
  obstacles: Obstacle[];
  /** 日照/灯光模式偏好 */
  displayMode: 'day' | 'night';
}

export type SurfaceName = 'approach' | 'takeoff' | 'transition' | 'horizontal';

/** OLS 单点查询结果:h 为该平面位置处限制面的绝对标高 */
export interface OlsPoint {
  h: number;
  surface: SurfaceName | null;
}

/** 楼块穿透体(世界坐标的长方体盒) */
export interface PenetrationBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** 穿透体底面 = 限制面标高，顶面 = 障碍物顶 */
  bottomZ: number;
  topZ: number;
  surface: SurfaceName;
}

/** 塔吊沿线穿透采样点 */
export interface PenetrationPoint {
  x: number;
  y: number;
  z: number;
  limitZ: number;
  surface: SurfaceName;
}

/** 单个障碍物的穿透分析结果 */
export interface ObstaclePenetration {
  obstacleId: string;
  obstacleName: string;
  obstacleKind: 'building' | 'crane';
  /** 是否穿透 */
  penetrated: boolean;
  /** 最大穿透高度 m(障碍物顶高出限制面的最大值) */
  maxPenetration: number;
  /** 最大穿透点世界坐标 */
  maxPoint: Vec3 | null;
  /** 该点处限制面标高 */
  limitElevation: number | null;
  /** 主要被穿透的限制面 */
  surface: SurfaceName | null;
  boxes: PenetrationBox[];
  points: PenetrationPoint[];
}

export interface AnalysisResult {
  projectId: string;
  results: ObstaclePenetration[];
  /** 穿透障碍物数量 */
  penetratedCount: number;
  /** 全场最大穿透高度 m */
  maxPenetration: number;
  /** 分析耗时 ms */
  elapsedMs: number;
}

export const SURFACE_LABEL: Record<SurfaceName, string> = {
  approach: '进近面',
  takeoff: '起飞爬升面',
  transition: '过渡面',
  horizontal: '水平限制面',
};
