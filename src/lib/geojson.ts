import type { BuildingObstacle } from '../types';
import { uid } from './utils';

interface GeoJsonGeom {
  type: string;
  coordinates: number[][][] | number[][][][];
}
interface GeoJsonFeature {
  type: string;
  geometry?: GeoJsonGeom | null;
  properties?: Record<string, unknown> | null;
}
interface GeoJsonDoc {
  type: string;
  features?: GeoJsonFeature[];
  geometry?: GeoJsonGeom;
}

const HEIGHT_KEYS = ['height', 'Height', 'building_height', 'buildingHeight', '高度', '楼高', '建筑高度'];
const BASE_KEYS = ['base_elevation', 'baseElevation', 'elevation', '地面标高', '底标高'];
const NAME_KEYS = ['name', 'Name', '名称', '楼名', 'building'];

function pickProp(props: Record<string, unknown> | null | undefined, keys: string[]): unknown {
  if (!props) return undefined;
  for (const k of keys) {
    if (props[k] !== undefined && props[k] !== null) return props[k];
  }
  return undefined;
}

function toNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return typeof n === 'number' && isFinite(n) ? n : undefined;
}

function looksLikeLonLat(rings: number[][][]): boolean {
  for (const ring of rings) {
    for (const [a, b] of ring) {
      if (Math.abs(a) > 180 || Math.abs(b) > 90) return false;
    }
  }
  return true;
}

/** 等距圆柱投影，以首个点为原点，单位米 */
function makeProjector(refLon: number, refLat: number) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((refLat * Math.PI) / 180);
  return (lon: number, lat: number) => ({
    x: (lon - refLon) * mPerDegLon,
    y: (lat - refLat) * mPerDegLat,
  });
}

export interface ImportResult {
  buildings: BuildingObstacle[];
  projected: boolean;
  skipped: number;
}

/** 解析 GeoJSON 文档为楼块障碍物 */
export function parseGeoJson(text: string): ImportResult {
  const doc = JSON.parse(text) as GeoJsonDoc;
  const features: GeoJsonFeature[] =
    doc.type === 'FeatureCollection'
      ? doc.features ?? []
      : doc.type === 'Feature'
        ? [doc as GeoJsonFeature]
        : doc.geometry
          ? [{ type: 'Feature', geometry: doc.geometry, properties: null }]
          : [];

  const polys: { rings: number[][][]; props: Record<string, unknown> | null }[] = [];
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      polys.push({ rings: g.coordinates as number[][][], props: f.properties ?? null });
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates as number[][][][]) {
        polys.push({ rings: poly, props: f.properties ?? null });
      }
    }
  }
  if (polys.length === 0) return { buildings: [], projected: false, skipped: features.length };

  const projected = looksLikeLonLat(polys[0].rings);
  let projector: (lon: number, lat: number) => { x: number; y: number };
  if (projected) {
    const [refLon, refLat] = polys[0].rings[0][0];
    projector = makeProjector(refLon, refLat);
  } else {
    projector = (x, y) => ({ x, y });
  }

  const buildings: BuildingObstacle[] = [];
  let skipped = 0;
  polys.forEach(({ rings, props }, idx) => {
    const outer = rings[0];
    if (!outer || outer.length < 4) {
      skipped++;
      return;
    }
    const footprint = outer.slice(0, -1).map(([a, b]) => projector(a, b));
    // 退化几何剔除
    const xs = new Set(footprint.map((p) => p.x.toFixed(2)));
    const ys = new Set(footprint.map((p) => p.y.toFixed(2)));
    if (xs.size < 2 || ys.size < 2) {
      skipped++;
      return;
    }
    const height = toNumber(pickProp(props, HEIGHT_KEYS)) ?? 20;
    const baseElevation = toNumber(pickProp(props, BASE_KEYS)) ?? 0;
    const nameVal = pickProp(props, NAME_KEYS);
    buildings.push({
      id: uid('b'),
      name: nameVal !== undefined ? String(nameVal) : `楼块 ${idx + 1}`,
      kind: 'building',
      baseElevation,
      height,
      footprint,
      source: 'GeoJSON',
    });
  });

  return { buildings, projected, skipped };
}
