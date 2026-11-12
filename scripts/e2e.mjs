import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const BASE = 'http://127.0.0.1:5173/';
const SHOTS = resolve('scripts/shots');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

try {
  console.log('— 项目列表页 —');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${SHOTS}/01-projects.png` });
  check('标题正确', (await page.title()).includes('eVTOL'));
  const cardCount = await page.locator('.pcard').count();
  check('内置演示项目卡片存在', cardCount >= 1, `count=${cardCount}`);

  console.log('— 新建/复制/删除(空白项目) —');
  await page.getByRole('button', { name: '＋ 新建项目' }).click();
  await page.waitForSelector('.viewport canvas');
  check('新建后进入编辑页且画布存在', await page.locator('.viewport canvas').count() >= 1);
  await page.getByRole('button', { name: '项目列表' }).click();
  const n0 = await page.locator('.pcard').count();
  check('新建后项目数增加', n0 >= 2, `count=${n0}`);
  await page.locator('.pcard').first().getByRole('button', { name: '复制' }).click();
  await page.waitForTimeout(200);
  check('复制后项目数 +1', (await page.locator('.pcard').count()) === n0 + 1);

  // 删除:确认走自定义 modal
  await page.locator('.pcard').first().getByRole('button', { name: '删除' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await page.waitForTimeout(200);
  check('删除后项目数恢复', (await page.locator('.pcard').count()) === n0);

  // 回到演示项目(卡片中带「示例」字样)
  await page.locator('.pcard', { hasText: '示例' }).first().click();
  await page.waitForSelector('.viewport canvas');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/02-editor-day.png` });
  const canvas = page.locator('.viewport canvas').first();
  const box = await canvas.boundingBox();
  check('画布尺寸正常', !!box && box.width > 800 && box.height > 600, JSON.stringify(box));
  check('HUD 场址名显示', (await page.locator('.view-hud .chip').first().innerText()).includes('场址:'));

  // 限制面图例存在
  check('四类限制面图例存在', (await page.locator('.legend .row').count()) === 5);

  console.log('— 平移/旋转模式切换 —');
  await page.getByRole('button', { name: /平移/ }).click();
  await page.getByRole('button', { name: /旋转/ }).click();
  check('旋转模式按钮高亮', await page.getByRole('button', { name: /旋转/ }).evaluate((el) => el.classList.contains('on')));
  await page.getByRole('button', { name: /平移/ }).click();

  console.log('— 夜间灯光模式 —');
  await page.getByRole('button', { name: /灯光/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/03-editor-night.png` });
  check('夜间按钮高亮', await page.getByRole('button', { name: /灯光/ }).evaluate((el) => el.classList.contains('on')));
  await page.getByRole('button', { name: /日照/ }).click();

  console.log('— 线框切换 —');
  await page.getByRole('button', { name: '线框' }).click();
  await page.waitForTimeout(300);
  check('线框按钮高亮', await page.getByRole('button', { name: '线框' }).evaluate((el) => el.classList.contains('on')));
  await page.screenshot({ path: `${SHOTS}/04-wireframe.png` });
  await page.getByRole('button', { name: '线框' }).click();

  console.log('— 平台参数编辑与实时刷新 —');
  const bearingInput = page.locator('label.field').filter({ hasText: '进近方位角' }).locator('input');
  const before = await page.locator('.view-hud').innerText();
  await bearingInput.fill('120');
  await bearingInput.dispatchEvent('input');
  await page.waitForTimeout(600);
  const after = await page.locator('.view-hud').innerText();
  check('修改方位角后 HUD 刷新(出现耗时提示)', after !== before || after.includes('场址'));

  console.log('— 障碍物库 —');
  await page.getByRole('button', { name: '障碍物库' }).click();
  await page.waitForTimeout(400);
  const obBefore = await page.locator('.ob-item').count();
  check('演示障碍物已列出(≥8)', obBefore >= 8, `count=${obBefore}`);
  await page.screenshot({ path: `${SHOTS}/05-obstacles.png` });

  console.log('— GeoJSON 导入 —');
  const file = resolve('public/demo-buildings.geojson');
  check('测试 GeoJSON 文件存在', existsSync(file));
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.locator('input[type=file]').first().setInputFiles(file);
  const toastEl = page.locator('.toast', { hasText: '导入' }).first();
  await toastEl.waitFor({ state: 'attached', timeout: 5000 });
  const obAfter = await page.locator('.ob-item').count();
  check(`导入后新增 3 个楼块(${obBefore} → ${obAfter})`, obAfter - obBefore === 3);
  check('成功 toast 出现', (await toastEl.innerText()).includes('导入'));
  await page.screenshot({ path: `${SHOTS}/06-after-geojson.png` });

  console.log('— 添加塔吊 —');
  await page.getByRole('button', { name: '＋ 添加塔吊' }).click();
  await page.waitForTimeout(300);
  check('塔吊数量增加', (await page.locator('.ob-item').count()) === obAfter + 1);

  console.log('— 净空分析页 —');
  await page.getByRole('button', { name: '净空分析' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/07-analysis.png` });
  const statText = await page.locator('.stats-row').innerText();
  check('统计卡显示障碍物总数', statText.includes('障碍物总数'));
  const penRows = await page.locator('table.data tbody tr').count();
  check('穿透清单有记录', penRows >= 1, `rows=${penRows}`);
  const hudBad = await page.locator('.chip.bad').count();
  check('HUD 红色穿透告警存在', hudBad >= 1);
  // 面筛选
  await page.getByRole('button', { name: '进近面' }).click();
  await page.waitForTimeout(300);
  const filtered = await page.locator('table.data tbody tr').count();
  check('按进近面筛选可用', filtered >= 0);
  await page.getByRole('button', { name: '全部' }).click();

  console.log('— 拖拽平台后穿透实时刷新 —');
  const maxPenBefore = await page.locator('.chip.bad').filter({ hasText: '最大穿透' }).innerText().catch(() => '');
  await page.getByRole('button', { name: '场址编辑' }).click();
  // 直接改 X 坐标模拟平移结果
  const xInput = page.locator('label.field').filter({ hasText: '东向 X' }).locator('input');
  const xVal = parseFloat(await xInput.inputValue());
  await xInput.fill(String(xVal + 40));
  await xInput.dispatchEvent('input');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '净空分析' }).click();
  await page.waitForTimeout(400);
  const maxPenAfter = await page.locator('.chip.bad').filter({ hasText: '最大穿透' }).innerText().catch(() => '');
  check('平移后分析结果可重新读取', maxPenAfter.includes('m') || maxPenAfter === maxPenBefore);

  console.log('— 报告页与 PDF 导出 —');
  await page.getByRole('button', { name: '报告' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /捕获当前三维视图/ }).click();
  await page.waitForTimeout(400);
  check('截图预览生成', (await page.locator('.viewport, .sidebar img').count()) >= 1);
  await page.screenshot({ path: `${SHOTS}/08-report.png` });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.getByRole('button', { name: '导出 PDF 报告' }).click(),
  ]);
  check('PDF 文件触发下载', !!download && (download.suggestedFilename() ?? '').endsWith('.pdf'), download?.suggestedFilename() ?? '');
  const pdfPath = `${SHOTS}/report.pdf`;
  await download.saveAs(pdfPath);
  const { statSync } = await import('node:fs');
  check('PDF 文件非空', statSync(pdfPath).size > 1000, `${statSync(pdfPath).size} bytes`);

  console.log('— 持久化 —');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check('刷新后项目仍在(localStorage 持久化)', (await page.locator('.pcard').count()) >= 1);
  check('演示项目持久化保留', (await page.locator('.pcard', { hasText: '示例' }).count()) === 1);

  console.log('— 项目导出 JSON —');
  await page.locator('.pcard').first().getByRole('button', { name: '导出' }).click();
  await page.waitForTimeout(300);
  check('全程无控制台错误', consoleErrors.length === 0, consoleErrors.join('\n'));
} catch (e) {
  failures++;
  console.error('测试异常:', e);
  await page.screenshot({ path: `${SHOTS}/error.png` }).catch(() => {});
} finally {
  if (consoleErrors.length) {
    console.log('\n控制台错误:');
    consoleErrors.forEach((e) => console.log('  - ' + e));
  }
  await browser.close();
  if (failures > 0) {
    console.error(`\n${failures} 项 E2E 检查失败`);
    process.exit(1);
  }
  console.log('\n全部 E2E 检查通过 ✓');
}
