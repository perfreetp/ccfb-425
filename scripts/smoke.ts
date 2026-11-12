/** 核心逻辑冒烟测试:直接用 tsx 风格的 esbuild 运行，通过 vite-node 简化 */
import { OlsModel, DEFAULT_OLS } from '../src/lib/ols';
import { runAnalysis } from '../src/lib/analysis';
import { newProject } from '../src/lib/demo';
import type { BuildingObstacle, CraneObstacle, Platform } from '../src/types';
import { uid } from '../src/lib/utils';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const platform: Platform = {
  id: 'pf_test',
  position: { x: 0, y: 0, z: 60 },
  fatoLength: 24,
  fatoWidth: 24,
  safetyMargin: 3,
  approachBearing: 0, // 进近朝向正北 +y
  ols: { ...DEFAULT_OLS },
  hostObstacleId: null,
};

console.log('— OlsModel 坐标变换 —');
const m = new OlsModel(platform);
// 正北 100m:局部 u=100
const loc = m.toLocal(0, 100);
check('正北点 u=100', Math.abs(loc.u - 100) < 1e-9 && Math.abs(loc.v) < 1e-9);
// 正东 50m:局部 v=50
const loc2 = m.toLocal(50, 0);
check('正东点 v=50', Math.abs(loc2.u) < 1e-9 && Math.abs(loc2.v - 50) < 1e-9);
// 方位角 90° 时,正东是进近方向
const p90: Platform = { ...platform, approachBearing: 90 };
const m90 = new OlsModel(p90);
const loc3 = m90.toLocal(100, 0);
check('bearing=90 时正东 u=100', Math.abs(loc3.u - 100) < 1e-9);

console.log('— 限制面标高 —');
// 进近面:正北 80m,坡度 1:8,面高 = 60 + 80/8 = 70
const q1 = m.query(0, 80);
check('进近面标高 70m', Math.abs(q1.h - 70) < 1e-6, `got ${q1.h}, surface ${q1.surface}`);
check('进近面类型正确', q1.surface === 'approach');
// 起飞面:正南 80m,面高同样 70
const q2 = m.query(0, -80);
check('起飞面标高 70m', Math.abs(q2.h - 70) < 1e-6, `got ${q2.h}`);
check('起飞面类型正确', q2.surface === 'takeoff');
// 半径外
const q3 = m.query(0, 500);
check('限制半径外返回 null', q3.surface === null);
// 顶盖:正东侧(进近面外),cap = 60+45 = 105
const q4 = m.query(200, 0);
check('顶盖标高 105m', Math.abs(q4.h - 105) < 1e-6, `got ${q4.h}, ${q4.surface}`);
// 过渡面:进近面侧边外一点。u=80 处半宽 = 15+80/8=25;v=35 → d=10,过渡面高 = 70 + 10/2 = 75
const q5 = m.query(35, 80);
check('过渡面标高 75m', Math.abs(q5.h - 75) < 1e-6, `got ${q5.h}, ${q5.surface}`);
check('过渡面类型正确', q5.surface === 'transition');

console.log('— 穿透分析 —');
// 楼块:位于进近面下方 → 不穿透。u=80 处面高 70,楼顶 68
const low: BuildingObstacle = {
  id: uid('b'),
  name: '矮楼',
  kind: 'building',
  baseElevation: 0,
  height: 68,
  footprint: [
    { x: -8, y: 72 },
    { x: 8, y: 72 },
    { x: 8, y: 88 },
    { x: -8, y: 88 },
  ],
};
// 高楼:同位置,顶 90,穿透 ≈ 90 - 70 = 20
const tall: BuildingObstacle = {
  id: uid('b'),
  name: '高楼',
  kind: 'building',
  baseElevation: 0,
  height: 90,
  footprint: [
    { x: -8, y: 72 },
    { x: 8, y: 72 },
    { x: 8, y: 88 },
    { x: -8, y: 88 },
  ],
};
const r1 = runAnalysis(platform, [low, tall]);
check('矮楼不穿透', !r1.results.find((r) => r.obstacleName === '矮楼')!.penetrated);
const tallR = r1.results.find((r) => r.obstacleName === '高楼')!;
check('高楼穿透', tallR.penetrated && tallR.maxPenetration > 15 && tallR.maxPenetration < 22,
  `pen=${tallR.maxPenetration}`);
check('穿透面为进近面', tallR.surface === 'approach');
check('生成穿透盒', tallR.boxes.length > 0);
check('穿透盒底面≈面高、顶面≈楼顶',
  Math.abs(tallR.boxes[0].topZ - 90) < 1e-6 && tallR.boxes[0].bottomZ > 68 && tallR.boxes[0].bottomZ < 72);

console.log('— 塔吊分析 —');
const crane: CraneObstacle = {
  id: uid('cr'),
  name: '塔吊',
  kind: 'crane',
  position: { x: 0, y: 120 },
  baseElevation: 0,
  mastHeight: 100, // 面高 = 60+120/8 = 75 → 穿透 25
  jibLength: 30,
  jibTipHeight: -5,
  jibBearing: 0,
};
const r2 = runAnalysis(platform, [crane]);
const cr = r2.results[0];
check('塔吊穿透', cr.penetrated && Math.abs(cr.maxPenetration - 25) < 1.5, `pen=${cr.maxPenetration}`);
check('塔吊采样点存在', cr.points.length > 5);

console.log('— 宿主楼豁免 —');
const host: BuildingObstacle = { ...tall, id: 'host1', name: '宿主' };
const r3 = runAnalysis({ ...platform, hostObstacleId: 'host1' }, [host]);
check('宿主楼不参与分析', r3.results.length === 0);

console.log('— 性能(演示场址) —');
const demo = newProject('perf');
const t0 = performance.now();
const dr = runAnalysis(demo.platform, demo.obstacles);
const elapsed = performance.now() - t0;
check(`分析耗时 < 500ms (实际 ${elapsed.toFixed(1)}ms, 穿透 ${dr.penetratedCount} 处)`, elapsed < 500);
check('演示数据存在穿透场景', dr.penetratedCount > 0);
check('最大穿透为正数', dr.maxPenetration > 0);

console.log('— 进近方向旋转联动 —');
// 旋转 180°:原北侧高楼变为起飞面侧,仍应穿透
const rotated = runAnalysis({ ...platform, approachBearing: 180 }, [tall]);
check('旋转后高楼仍穿透(起飞面)', rotated.results[0].penetrated);
check('旋转后穿透面为起飞面', rotated.results[0].surface === 'takeoff');

if (failures > 0) {
  console.error(`\n${failures} 项检查失败`);
  process.exit(1);
} else {
  console.log('\n全部检查通过 ✓');
}
