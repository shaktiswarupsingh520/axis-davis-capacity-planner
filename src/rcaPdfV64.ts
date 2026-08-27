import { jsPDF } from 'jspdf';

const PANEL_ID = 'axis-rca-v60';

const clean = (value: string) => value.replace(/\u00a0/g, ' ').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
const escText = (value: string) => clean(value).trim();

function addHeader(doc: jsPDF, title: string, subtitle: string, page: number) {
  doc.setFillColor(22, 41, 67);
  doc.rect(0, 0, 595, 72, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('AXIS BANK  |  ApMoSys TECHNOLOGIES', 36, 21);
  doc.setFontSize(18);
  doc.text(title, 36, 44);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(subtitle, 36, 59);
  doc.text(`Page ${page}`, 557, 21, { align: 'right' });
}

function addFooter(doc: jsPDF) {
  const h = doc.internal.pageSize.getHeight();
  doc.setDrawColor(214, 222, 232);
  doc.line(36, h - 34, 559, h - 34);
  doc.setTextColor(95, 109, 128);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('Axis Davis Capacity Planner - AI-assisted incident RCA', 36, h - 21);
  doc.text(new Date().toLocaleString('en-IN'), 559, h - 21, { align: 'right' });
}

function writeWrapped(doc: jsPDF, value: string, x: number, y: number, width: number, size = 9, leading = 13) {
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(escText(value), width) as string[];
  doc.text(lines, x, y);
  return y + Math.max(1, lines.length) * leading;
}

function ensureSpace(doc: jsPDF, y: number, needed: number, pageRef: { value: number }, title: string, subtitle: string) {
  const h = doc.internal.pageSize.getHeight();
  if (y + needed <= h - 50) return y;
  addFooter(doc);
  doc.addPage();
  pageRef.value += 1;
  addHeader(doc, title, subtitle, pageRef.value);
  return 92;
}

function sectionTitle(doc: jsPDF, title: string, y: number, pageRef: { value: number }, subtitle: string) {
  y = ensureSpace(doc, y, 35, pageRef, 'AI-Assisted Incident Root Cause Analysis', subtitle);
  doc.setTextColor(23, 59, 112);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(escText(title), 36, y);
  doc.setDrawColor(217, 229, 242);
  doc.line(36, y + 5, 559, y + 5);
  return y + 23;
}

function table(doc: jsPDF, headers: string[], rows: string[][], y: number, pageRef: { value: number }, subtitle: string) {
  const widths = headers.length === 4 ? [88, 150, 105, 180] : headers.length === 5 ? [72, 105, 72, 72, 202] : headers.map(() => 523 / headers.length);
  const rowHeight = 24;
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const drawHead = () => {
    doc.setFillColor(22, 41, 67);
    doc.rect(36, y, totalWidth, rowHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    let x = 36;
    headers.forEach((h, i) => { doc.text(escText(h), x + 5, y + 15); x += widths[i]; });
    y += rowHeight;
  };
  drawHead();
  rows.forEach((row, ri) => {
    if (y > doc.internal.pageSize.getHeight() - 65) {
      addFooter(doc); doc.addPage(); pageRef.value += 1;
      addHeader(doc, 'AI-Assisted Incident Root Cause Analysis', subtitle, pageRef.value);
      y = 92; drawHead();
    }
    const fill = ri % 2 ? [247, 249, 252] : [255, 255, 255];
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.setDrawColor(224, 231, 238);
    doc.rect(36, y, totalWidth, rowHeight, 'FD');
    doc.setTextColor(37, 49, 66);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.7);
    let x = 36;
    row.forEach((cell, i) => {
      const lines = doc.splitTextToSize(escText(cell), Math.max(25, widths[i] - 10)) as string[];
      doc.text(lines.slice(0, 2), x + 5, y + 10);
      x += widths[i];
    });
    y += rowHeight;
  });
  return y + 10;
}

function installPdf() {
  const root = document.getElementById(PANEL_ID);
  if (!root || root.getAttribute('data-pdf-v64') === '1') return;
  const button = root.querySelector<HTMLButtonElement>('.rca60-pdf');
  if (!button) return;
  root.setAttribute('data-pdf-v64', '1');
  button.textContent = 'Download RCA PDF';
  button.onclick = () => {
    const body = root.querySelector<HTMLElement>('.rca60-body');
    const analysis = root.querySelector<HTMLElement>('.rca60-analysis');
    if (!body || !analysis || !analysis.textContent?.trim()) {
      const status = root.querySelector<HTMLElement>('.rca60-status');
      if (status) status.textContent = 'Generate the RCA first, then download the PDF.';
      return;
    }

    try {
      button.disabled = true;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pages = { value: 1 };
      const problemId = root.querySelector<HTMLElement>('.rca60-card strong')?.textContent?.trim() || 'Unknown';
      const cards = [...root.querySelectorAll<HTMLElement>('.rca60-card')].map(card => {
        const label = card.querySelector('span')?.textContent?.trim() || '';
        const value = card.querySelector('strong')?.textContent?.trim() || '';
        return { label, value };
      });
      const subtitle = `Problem ${problemId} | Evidence-based RCA generated ${new Date().toLocaleString('en-IN')}`;
      addHeader(doc, 'AI-Assisted Incident Root Cause Analysis', subtitle, pages.value);
      let y = 95;

      doc.setFillColor(245, 249, 253);
      doc.setDrawColor(213, 225, 238);
      doc.roundedRect(36, y, 523, 74, 8, 8, 'FD');
      doc.setTextColor(23, 59, 112);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('Incident RCA Report', 50, y + 22);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(95, 109, 128);
      doc.setFontSize(8);
      doc.text(`Davis Problem: ${escText(problemId)}`, 50, y + 38);
      doc.text('Generated from the RCA evidence currently displayed in the workbench.', 50, y + 53);
      y += 92;

      doc.setTextColor(37, 49, 66);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      cards.forEach((card, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const x = 36 + col * 131;
        const yy = y + row * 55;
        doc.setFillColor(249, 251, 253);
        doc.setDrawColor(224, 231, 238);
        doc.roundedRect(x, yy, 123, 43, 6, 6, 'FD');
        doc.setFontSize(6.5); doc.setTextColor(113, 129, 151); doc.text(escText(card.label).toUpperCase(), x + 7, yy + 13);
        doc.setFontSize(8); doc.setTextColor(37, 49, 66); doc.setFont('helvetica', 'bold');
        doc.text(doc.splitTextToSize(escText(card.value), 109).slice(0, 2), x + 7, yy + 28);
      });
      y += Math.ceil(cards.length / 4) * 55 + 10;

      y = sectionTitle(doc, 'AI Root Cause Analysis', y, pages, subtitle);
      for (const line of (analysis.textContent || '').split(/\r?\n/)) {
        const value = line.trim();
        if (!value) { y += 5; continue; }
        y = ensureSpace(doc, y, 30, pages, 'AI-Assisted Incident Root Cause Analysis', subtitle);
        const heading = /^(?:#{1,4}\s*)?(?:\d+[.)]\s*)?[A-Z][A-Za-z /&-]{2,70}:?$/u.test(value);
        if (heading && value.length < 90) {
          doc.setTextColor(23, 59, 112); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
          y = writeWrapped(doc, value.replace(/^#+\s*/, ''), 36, y, 523, 9.5, 13) + 3;
        } else {
          doc.setTextColor(37, 49, 66); doc.setFont('helvetica', 'normal');
          y = writeWrapped(doc, value, 43, y, 510, 8.4, 12) + 3;
        }
      }

      const historyRows = [...root.querySelectorAll<HTMLTableElement>('.rca60-table')][0]?.querySelectorAll('tbody tr');
      const history = historyRows ? [...historyRows].map(tr => [...tr.children].map(td => td.textContent?.trim() || '')) : [];
      if (history.length && !history[0][0]?.toLowerCase().includes('no matching')) {
        y = sectionTitle(doc, 'Past Occurrences & Recurrence Evidence', y + 10, pages, subtitle);
        y = table(doc, ['Problem', 'Start', 'Status', 'Duration', 'Root Cause'], history, y, pages, subtitle);
      }

      const deploymentTable = [...root.querySelectorAll<HTMLTableElement>('.rca60-table')][1];
      const deploymentRows = deploymentTable ? [...deploymentTable.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent?.trim() || '')) : [];
      if (deploymentRows.length && !deploymentRows[0][0]?.toLowerCase().includes('no custom')) {
        y = sectionTitle(doc, 'Deployment / Change Correlation', y + 10, pages, subtitle);
        y = table(doc, ['Start', 'Name', 'Entity', 'Description'], deploymentRows, y, pages, subtitle);
      }

      y = sectionTitle(doc, 'Evidence Summary & Governance', y + 10, pages, subtitle);
      const evidenceText = root.querySelector<HTMLElement>('.rca60-evidence')?.querySelector('p')?.textContent || 'Evidence summary unavailable.';
      y = writeWrapped(doc, evidenceText, 43, y, 510, 8.5, 12) + 8;
      y = writeWrapped(doc, 'RCA governance: Dynatrace evidence is presented separately from AI inference. Recommendations are proposed actions and must be validated by the responsible SRE/application team.', 43, y, 510, 8.3, 12);
      addFooter(doc);

      const safeId = clean(problemId).replace(/[^A-Za-z0-9_-]+/g, '_');
      doc.save(`Axis-RCA-${safeId || 'Problem'}.pdf`);
      const status = root.querySelector<HTMLElement>('.rca60-status');
      if (status) status.textContent = 'RCA PDF downloaded successfully.';
    } catch (error) {
      const status = root.querySelector<HTMLElement>('.rca60-status');
      if (status) status.textContent = `RCA PDF generation failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      button.disabled = false;
    }
  };
}

export function installRcaPdfV64() {
  const attach = () => installPdf();
  attach();
  const observer = new MutationObserver(attach);
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 30000);
}
