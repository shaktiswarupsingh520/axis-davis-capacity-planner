import { jsPDF } from 'jspdf';

let installed = false;
let lastQuestion = '';
let lastAnswer = '';

const C = {
  navy: [22, 41, 67] as const,
  blue: [44, 103, 180] as const,
  text: [37, 49, 66] as const,
  muted: [95, 109, 128] as const,
  border: [214, 222, 232] as const,
  light: [247, 249, 252] as const,
  white: [255, 255, 255] as const,
};

const setFill = (doc: jsPDF, c: readonly number[]) => doc.setFillColor(c[0], c[1], c[2]);
const setStroke = (doc: jsPDF, c: readonly number[]) => doc.setDrawColor(c[0], c[1], c[2]);
const setText = (doc: jsPDF, c: readonly number[]) => doc.setTextColor(c[0], c[1], c[2]);

function addInteractivePage(doc: jsPDF) {
  doc.addPage();
  const total = doc.getNumberOfPages();

  setFill(doc, C.navy);
  doc.rect(0, 0, 595, 82, 'F');
  setText(doc, C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('AXIS BANK  |  ApMoSys TECHNOLOGIES', 38, 25);
  doc.setFontSize(19);
  doc.text('Interactive Davis Capacity Copilot', 38, 49);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Interactive capacity questions using the selected Axis Bank scope', 38, 66);

  let y = 108;
  setText(doc, C.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Ask Davis about capacity', 38, y);
  y += 22;
  setText(doc, C.text);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const intro = doc.splitTextToSize(
    'The Axis Davis Capacity Planner provides an interactive AI experience on the Overview page. Users can ask Davis capacity-planning questions against the currently selected Management Zone. The interactive assessment uses live Dynatrace host telemetry and available forecast, simulation and problem context rather than a generic static response.',
    515,
  );
  doc.text(intro, 38, y);
  y += intro.length * 13 + 18;

  setFill(doc, C.light);
  setStroke(doc, C.border);
  doc.roundedRect(38, y, 515, 104, 8, 8, 'FD');
  setText(doc, C.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Example questions', 52, y + 18);
  const examples = [
    'Which hosts are closest to CPU capacity?',
    'What are the top capacity risks in this Management Zone?',
    'What happens if traffic increases by 48%?',
    'Which resource is the primary capacity constraint?',
    'How many infrastructure problems were generated in the last 30 days?',
    'What should I do about the highest-risk hosts?',
  ];
  setText(doc, C.text);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  examples.forEach((value, index) => doc.text(`• ${value}`, 52, y + 37 + index * 11));
  y += 126;

  if (lastQuestion) {
    setText(doc, C.navy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Interactive question from this report session', 38, y);
    y += 17;
    setText(doc, C.blue);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const questionLines = doc.splitTextToSize(`“${lastQuestion}”`, 500);
    doc.text(questionLines, 48, y);
    y += questionLines.length * 12 + 12;
    if (lastAnswer) {
      setText(doc, C.muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const answerLines = doc.splitTextToSize(lastAnswer, 500).slice(0, 32);
      doc.text(answerLines, 48, y);
      y += answerLines.length * 11 + 16;
    }
  }

  const contextY = Math.min(y + 4, 690);
  setText(doc, C.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Capacity context available to Davis', 38, contextY);
  setText(doc, C.text);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const contextLines = [
    '• Selected Management Zone and live host scope',
    '• Current CPU, memory, disk, network and application-throughput telemetry',
    '• Dynatrace Intelligence forecast context when available',
    '• What-if traffic simulation values when a traffic scenario is supplied',
    '• Davis problem counts and problem context for problem-oriented questions',
  ];
  contextLines.forEach((value, index) => doc.text(value, 46, Math.min(contextY + 26 + index * 13, 720)));

  // Rewrite all footers so the expanded report has correct pagination.
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    setFill(doc, C.white);
    doc.rect(0, 783, 595, 59, 'F');
    setStroke(doc, C.border);
    doc.line(38, 790, 557, 790);
    setText(doc, C.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('Axis Davis Capacity Planner · Live Dynatrace telemetry · Management planning report', 38, 805);
    doc.text(`${i} / ${total}`, 557, 805, { align: 'right' });
  }
  doc.setPage(total);
}

export function installProductionPdfInteractiveV49() {
  if (installed) return;
  installed = true;

  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest('button');
    if (!button || !/Generate PDF Report/i.test(button.textContent || '')) return;
    const panel = document.getElementById('axis-davis-interactive-ai-v47');
    if (!panel) return;
    const textarea = panel.querySelector('textarea') as HTMLTextAreaElement | null;
    const answer = panel.querySelector('[data-answer]') as HTMLElement | null;
    lastQuestion = textarea?.value.trim() || '';
    lastAnswer = answer?.textContent?.trim() || '';
  }, true);

  const originalSave = jsPDF.prototype.save;
  const wrappedSave = function (this: jsPDF, filename?: string, options?: { returnPromise?: boolean }) {
    addInteractivePage(this);
    return originalSave.call(this, filename, options);
  };
  jsPDF.prototype.save = wrappedSave;
}
