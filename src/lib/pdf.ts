import { jsPDF } from 'jspdf';
import type { AnalysisResult, Project, SurfaceName } from '../types';
import { SURFACE_LABEL } from '../types';
import { formatTime, m } from './utils';

interface ImgDim {
  w: number;
  h: number;
}

function imageDim(dataUrl: string): Promise<ImgDim> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = () => resolve({ w: 1600, h: 900 });
    img.src = dataUrl;
  });
}

/** 生成带截图与穿透清单的 PDF 报告并触发下载 */
export async function exportPdfReport(project: Project, result: AnalysisResult, screenshot: string): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 0;

  const ensure = (need: number) => {
    if (y + need > 282) {
      doc.addPage();
      y = margin;
    }
  };

  // ---------- 封面区 ----------
  doc.setFillColor(26, 42, 66);
  doc.rect(0, 0, pageW, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('eVTOL Vertiport OLS Report', margin, 14);
  doc.setFontSize(11);
  doc.text(project.name, margin, 23);
  doc.setFontSize(9);
  doc.setTextColor(200, 210, 225);
  doc.text(`Generated: ${formatTime(Date.now())}    Project ID: ${project.id.slice(0, 12)}`, margin, 29);

  y = 42;
  doc.setTextColor(40, 40, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('1. Site Overview', margin, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const p = project.platform;
  const overview: Array<[string, string]> = [
    ['Project', project.name],
    ['Description', project.description || '—'],
    ['Platform center (E, N, Z m)', `${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}, ${p.position.z.toFixed(2)}`],
    ['FATO L x W (m)', `${p.fatoLength} x ${p.fatoWidth}`],
    ['Safety margin (m)', String(p.safetyMargin)],
    ['Approach bearing (deg)', p.approachBearing.toFixed(1)],
    ['Obstacle count', String(project.obstacles.length)],
    ['Penetrating obstacles', String(result.penetratedCount)],
    ['Max penetration (m)', result.maxPenetration.toFixed(2)],
    ['Analysis time (ms)', result.elapsedMs.toFixed(1)],
  ];
  for (const [k, v] of overview) {
    ensure(7);
    doc.setTextColor(110, 110, 110);
    doc.text(k, margin, y);
    doc.setTextColor(30, 30, 30);
    doc.text(String(v), margin + 62, y);
    y += 6;
  }

  // ---------- 截图 ----------
  y += 4;
  ensure(70);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(40, 40, 40);
  doc.text('2. 3D Scene Screenshot', margin, y);
  y += 4;
  const dim = await imageDim(screenshot);
  const imgW = contentW;
  const imgH = (imgW * dim.h) / dim.w;
  ensure(Math.min(imgH, 110) + 4);
  doc.addImage(screenshot, 'PNG', margin, y, imgW, Math.min(imgH, 110), undefined, 'FAST');
  y += Math.min(imgH, 110) + 6;

  // ---------- 限制面参数 ----------
  ensure(50);
  doc.setFontSize(13);
  doc.text('3. Obstacle Limitation Surfaces', margin, y);
  y += 7;
  doc.setFontSize(10);
  const o = p.ols;
  const rows: Array<[string, string]> = [
    ['Approach surface', `length ${m(o.approachLength)}, slope 1:${o.approachSlope}`],
    ['Take-off / climb surface', `length ${m(o.takeoffLength)}, slope 1:${o.takeoffSlope}`],
    ['Transition surface', `slope 1:${o.transitionSlope}`],
    ['Horizontal cap', `height ${m(o.capHeight)}, radius ${m(o.limitRadius)}`],
  ];
  for (const [k, v] of rows) {
    ensure(6);
    doc.setTextColor(110, 110, 110);
    doc.text(k, margin, y);
    doc.setTextColor(30, 30, 30);
    doc.text(v, margin + 62, y);
    y += 6;
  }

  // ---------- 穿透清单 ----------
  y += 4;
  ensure(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(40, 40, 40);
  doc.text('4. Penetration List', margin, y);
  y += 7;

  const cols = [margin, margin + 52, margin + 96, margin + 126, margin + 156];
  const colW = [52, 44, 30, 30, contentW - 156];
  const header = ['Obstacle', 'Surface', 'Pen (m)', 'Limit Z (m)', 'Location (E, N, Z)'];
  doc.setFillColor(26, 42, 66);
  doc.rect(margin, y - 4.5, contentW, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  header.forEach((h, i) => doc.text(h, cols[i] + 1.5, y));
  y += 4;

  const penetrated = result.results.filter((r) => r.penetrated);
  if (penetrated.length === 0) {
    y += 8;
    doc.setTextColor(30, 120, 60);
    doc.setFontSize(10);
    doc.text('No penetration detected. All obstacles are below the OLS.', margin + 2, y);
  } else {
    doc.setFontSize(8.5);
    penetrated.forEach((r, idx) => {
      ensure(9);
      if (idx % 2 === 0) {
        doc.setFillColor(238, 242, 247);
        doc.rect(margin, y - 4.5, contentW, 8, 'F');
      }
      doc.setTextColor(40, 40, 40);
      const pt = r.maxPoint!;
      const vals = [
        r.obstacleName.slice(0, 24),
        SURFACE_LABEL[r.surface as SurfaceName],
        r.maxPenetration.toFixed(2),
        (r.limitElevation ?? 0).toFixed(2),
        `${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}, ${pt.z.toFixed(1)}`,
      ];
      vals.forEach((v, i) => doc.text(v, cols[i] + 1.5, y, { maxWidth: colW[i] - 2 }));
      y += 8;
    });
  }

  // ---------- 结论 ----------
  y += 6;
  ensure(30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(40, 40, 40);
  doc.text('5. Conclusion', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const ok = result.penetratedCount === 0;
  doc.setTextColor(ok ? 30 : 200, ok ? 120 : 50, ok ? 60 : 50);
  const conclusion = ok
    ? 'PASS: no obstacle penetrates the obstacle limitation surfaces.'
    : `FAIL: ${result.penetratedCount} obstacle(s) penetrate the OLS, max penetration ${result.maxPenetration.toFixed(2)} m. Adjust platform location, bearing or obstacle heights.`;
  const lines = doc.splitTextToSize(conclusion, contentW);
  for (const line of lines) {
    ensure(6);
    doc.text(line, margin, y);
    y += 6;
  }

  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(
    'Generated by eVTOL OLS Studio. Reference geometry only; verify against official aeronautical surveys.',
    margin,
    290,
  );

  doc.save(`${project.name.replace(/[\\/:*?"<>|]/g, '_')}_OLS_Report.pdf`);
}
