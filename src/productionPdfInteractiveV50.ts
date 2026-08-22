import { jsPDF } from 'jspdf';

let installed = false;

type QaState = { question: string; answer: string };
const getQa = (): QaState => (window as Window & { __axisDavisLastQa?: QaState }).__axisDavisLastQa ?? { question: '', answer: '' };

function addInteractivePage(doc: jsPDF) {
  const qa = getQa();
  doc.addPage();
  const page = doc.getNumberOfPages();
  const navy = [22, 41, 67] as const;
  const blue = [44, 103, 180] as const;
  const text = [37, 49, 66] as const;
  const muted = [95, 109, 128] as const;
  const border = [214, 222, 232] as const;
  const light = [247, 249, 252] as const;
  const white = [255, 255, 255] as const;
  doc.setFillColor(...navy); doc.rect(0,0,595,82,'F');
  doc.setTextColor(...white); doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.text('AXIS BANK  |  ApMoSys TECHNOLOGIES',38,25);
  doc.setFontSize(19); doc.text('Interactive Davis Capacity Copilot',38,49);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.text('Interactive capacity planning using live Dynatrace context',38,66);

  let y=108;
  doc.setTextColor(...navy); doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.text('Ask Davis about capacity',38,y); y+=22;
  doc.setTextColor(...text); doc.setFont('helvetica','normal'); doc.setFontSize(9);
  y += doc.splitTextToSize('The Overview page supports interactive capacity questions. Davis can use live host telemetry, forecast context, read-only Grail/DQL results and what-if capacity simulation to answer the question rather than relying only on a static summary.',515).length*13;
  doc.text(doc.splitTextToSize('The Overview page supports interactive capacity questions. Davis can use live host telemetry, forecast context, read-only Grail/DQL results and what-if capacity simulation to answer the question rather than relying only on a static summary.',515),38,130);
  y=174;

  doc.setFillColor(...light); doc.setDrawColor(...border); doc.roundedRect(38,y,515,112,8,8,'FD');
  doc.setTextColor(...navy); doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.text('Example questions',52,y+18);
  const examples=['Which hosts are closest to CPU capacity?','What happens if traffic increases by 48%?','How many infrastructure problems were generated in the last 30 days?','Which resource is the primary capacity constraint?','What should I do about the highest-risk hosts?'];
  doc.setTextColor(...text); doc.setFont('helvetica','normal'); doc.setFontSize(8.3); examples.forEach((v,i)=>doc.text(`• ${v}`,52,y+37+i*13));
  y+=134;

  doc.setTextColor(...navy); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('Interactive session captured in this report',38,y); y+=18;
  if(qa.question){doc.setTextColor(...blue);doc.setFont('helvetica','bold');doc.setFontSize(9);const qLines=doc.splitTextToSize(`Question: ${qa.question}`,500);doc.text(qLines,48,y);y+=qLines.length*12+12;}
  if(qa.answer){doc.setTextColor(...text);doc.setFont('helvetica','normal');doc.setFontSize(8);const aLines=doc.splitTextToSize(`Davis answer:\n${qa.answer}`,500).slice(0,40);doc.text(aLines,48,y);y+=aLines.length*11+18;} else {doc.setTextColor(...muted);doc.setFontSize(8);doc.text('No interactive question was answered before PDF generation.',48,y);y+=22;}

  doc.setTextColor(...navy);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text('Agent context available',38,Math.min(y,690));
  doc.setTextColor(...text);doc.setFont('helvetica','normal');doc.setFontSize(8.3);
  ['Selected Management Zone and live host inventory','CPU / memory / disk / network / throughput telemetry','Dynatrace Intelligence forecast context','Read-only DQL/Grail evidence for arbitrary capacity questions','Traffic what-if simulation values and projected capacity impact'].forEach((v,i)=>doc.text(`• ${v}`,48,Math.min(y+22+i*13,720)));

  // Final-page footer; update all pages so numbering includes this page.
  for(let i=1;i<=page;i+=1){doc.setPage(i);doc.setFillColor(...white);doc.rect(0,783,595,59,'F');doc.setDrawColor(...border);doc.line(38,790,557,790);doc.setTextColor(...muted);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text('Axis Davis Capacity Planner · Live Dynatrace telemetry · Management planning report',38,805);doc.text(`${i} / ${page}`,557,805,{align:'right'})}
  doc.setPage(page);
}

export function installProductionPdfInteractiveV50(){
  if(installed)return; installed=true;
  window.addEventListener('axis-davis-answer',(event)=>{const detail=(event as CustomEvent<QaState>).detail;if(detail?.question){(window as Window & { __axisDavisLastQa?: QaState }).__axisDavisLastQa={question:String(detail.question),answer:String(detail.answer||'')}}});
  const anyJsPdf = jsPDF as unknown as { prototype: { save: (...args:any[])=>any } };
  const originalSave = anyJsPdf.prototype.save;
  anyJsPdf.prototype.save = function(this:jsPDF,...args:any[]){
    const marker='__axisDavisInteractivePdfV50';
    const docAny=this as jsPDF & Record<string,unknown>;
    if(!docAny[marker]){docAny[marker]=true;addInteractivePage(this)}
    return originalSave.apply(this,args);
  };
}
