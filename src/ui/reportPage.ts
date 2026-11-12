import type { AnalysisResult, Project } from '../types';
import { SURFACE_LABEL } from '../types';
import { store } from '../store';
import { h, toast } from './dom';
import type { Viewport } from './Viewport';
import { runAnalysis } from '../lib/analysis';
import { exportPdfReport } from '../lib/pdf';

export function buildReportSidebar(project: Project, viewport: Viewport): HTMLElement {
  const fresh = store.getById(project.id)!;
  const result: AnalysisResult = runAnalysis(fresh.platform, fresh.obstacles);
  viewport.setResult(result);

  const descInput = h('textarea', {
    rows: '3',
    style: 'width:100%;resize:vertical',
    placeholder: '填写场址说明、气象条件或审批备注…',
    oninput: () => {
      store.update(project.id, (p) => {
        p.description = (descInput as HTMLTextAreaElement).value;
      });
    },
  }) as HTMLTextAreaElement;
  descInput.value = fresh.description;

  const penRows = result.results
    .filter((r) => r.penetrated)
    .sort((a, b) => b.maxPenetration - a.maxPenetration);

  const preview = h('div', {
    style:
      'width:100%;aspect-ratio:16/9;background:#0b111b;border:1px solid var(--border);border-radius:8px;display:grid;place-items:center;color:var(--text-dim);font-size:12px;overflow:hidden',
  }, '截图预览（点击下方按钮捕获三维视图）');

  const captureBtn = h(
    'button',
    { class: 'btn' },
    '📷 捕获当前三维视图',
  ) as HTMLButtonElement;
  const pdfBtn = h(
    'button',
    { class: 'btn primary', disabled: '' },
    '导出 PDF 报告',
  ) as HTMLButtonElement;

  let screenshot = '';

  captureBtn.addEventListener('click', () => {
    screenshot = viewport.scene.capture();
    preview.replaceChildren();
    const img = document.createElement('img');
    img.src = screenshot;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    preview.appendChild(img);
    pdfBtn.removeAttribute('disabled');
    toast('截图已捕获', 'success');
  });

  pdfBtn.addEventListener('click', async () => {
    if (!screenshot) return;
    const p = store.getById(project.id)!;
    pdfBtn.setAttribute('disabled', '');
    pdfBtn.textContent = '生成中…';
    try {
      await exportPdfReport(p, result, screenshot);
      toast('PDF 报告已生成并下载', 'success', 3500);
    } catch (e) {
      toast(`PDF 生成失败:${(e as Error).message}`, 'error', 4000);
    } finally {
      pdfBtn.removeAttribute('disabled');
      pdfBtn.textContent = '导出 PDF 报告';
    }
  });

  const p = fresh.platform;
  return h(
    'div',
    { class: 'sidebar' },
    h('div', { class: 'side-head' }, h('h2', {}, '分析报告'), h('p', {}, '截图与穿透清单一键导出 PDF')),
    h(
      'div',
      { class: 'side-body' },
      h('div', { class: 'section-title' }, '报告信息'),
      h('label', { class: 'field' }, h('span', {}, '场址备注'), descInput),

      h('div', { class: 'section-title' }, '关键指标'),
      h(
        'div',
        { class: 'stats-row' },
        stat(String(result.penetratedCount), '穿透数', result.penetratedCount > 0 ? 'danger' : 'ok'),
        stat(`${result.maxPenetration.toFixed(2)} m`, '最大穿透', result.maxPenetration > 0 ? 'danger' : 'ok'),
        stat(`${p.approachBearing.toFixed(0)}°`, '进近方位', ''),
      ),

      h('div', { class: 'section-title' }, '三维截图'),
      preview,
      h('div', { style: 'display:flex;gap:8px;margin:10px 0 16px;flex-wrap:wrap' }, captureBtn, pdfBtn),

      h('div', { class: 'section-title' }, '报告将包含以下内容'),
      h(
        'ul',
        { style: 'color:var(--text-dim);line-height:2;padding-left:18px;margin:0 0 14px' },
        h('li', {}, '场址概况与平台/FATO 参数'),
        h('li', {}, '三维场景截图'),
        h('li', {}, `四类限制面参数（进近 1:${p.ols.approachSlope}、起飞 1:${p.ols.takeoffSlope}、过渡 1:${p.ols.transitionSlope}、顶盖 ${p.ols.capHeight} m）`),
        h('li', {}, `穿透清单（${penRows.length} 条，含障碍物、限制面类型、穿透高度、坐标）`),
        h('li', {}, '自动结论（PASS / FAIL）'),
      ),

      penRows.length
        ? h(
            'div',
            { style: 'overflow-x:auto' },
            h(
              'table',
              { class: 'data' },
              h('thead', {}, h('tr', {}, h('th', {}, '障碍物'), h('th', {}, '限制面'), h('th', {}, '穿透 m'))),
              h(
                'tbody',
                {},
                ...penRows.map((r) =>
                  h(
                    'tr',
                    { class: 'pen' },
                    h('td', {}, r.obstacleName),
                    h('td', {}, SURFACE_LABEL[r.surface!]),
                    h('td', {}, r.maxPenetration.toFixed(2)),
                  ),
                ),
              ),
            ),
          )
        : h('div', { class: 'empty' }, '无穿透记录，报告结论将为 PASS。'),
    ),
  );
}

function stat(num: string, label: string, cls: string): HTMLElement {
  return h('div', { class: `stat ${cls}` }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, label));
}
