// Dockets as PDF files, laid out like the form on screen: the details, each shift, the rows, totals and sign-off.
// Several dockets download together as one .zip with one PDF per docket.
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import type { Row } from './backend';
import { TABLES, type Field, type TableName } from './schema';
import { COMMON_FIELDS, TIME_FIELDS, formFor, shiftFields, sortRows, toView, total } from './docketForms';
import { STAGE_LABEL, stageOf } from './assignment';

export type PdfLookups = Partial<Record<TableName, Row[]>>;
const RED: [number, number, number] = [236, 27, 45];
const GREY: [number, number, number] = [110, 110, 110];
const two = (n: number) => String(n).padStart(2, '0');
/** 24-hour Brisbane time, the same as the app. */
export function when(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 10 * 3.6e6);
  return `${two(t.getUTCDate())}/${two(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${two(t.getUTCHours())}:${two(t.getUTCMinutes())}`;
}
export function show(f: Field, v: unknown, lk: PdfLookups): string {
  if (v === null || v === undefined || v === '') return '';
  if (f.type === 'ref' && f.ref) { const r = (lk[f.ref] ?? []).find(x => x.id === v); return r ? TABLES[f.ref].display(r) : ''; }
  if (f.type === 'datetime') return when(String(v));
  if (f.type === 'date') { const s = String(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s; }
  if (f.type === 'bool') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString('en-AU');
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/** One docket as a PDF document. */
export function docketPdf(d: Row, rows: Row[], signoff: Row | null | undefined, lk: PdfLookups): jsPDF {
  const form = formFor(d.form_type);
  const v = toView(d);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14, inner = W - 2 * M;
  let y = 16;
  const need = (h: number) => { if (y + h > 285) { doc.addPage(); y = 16; } };
  const heading = (t: string) => { need(12); y += 3; doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...RED); doc.text(t, M, y); y += 5; doc.setTextColor(0, 0, 0); };
  // label: value pairs in two columns
  const grid = (pairs: [string, string][]) => {
    const kept = pairs.filter(([, val]) => val !== '');
    doc.setFontSize(9);
    for (let i = 0; i < kept.length; i += 2) {
      doc.setFont('helvetica', 'bold');
      const cells = kept.slice(i, i + 2).map(([l, val]) => ({ l: doc.splitTextToSize(l, 32) as string[], lines: doc.splitTextToSize(val, inner / 2 - 37) as string[] }));
      const h = Math.max(...cells.map(c => Math.max(c.lines.length, c.l.length))) * 4.2 + 1.5;
      need(h);
      cells.forEach((c, j) => {
        const x = M + j * (inner / 2);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...GREY); doc.text(c.l, x, y);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(0, 0, 0); doc.text(c.lines, x + 34, y);
      });
      y += h;
    }
  };
  // a simple table that wraps text and repeats its header on a new page
  const table = (cols: Field[], data: Row[], totals?: string[]) => {
    doc.setFontSize(8);
    const w = inner / cols.length;
    const head = () => {
      need(8); doc.setFillColor(20, 19, 25); doc.rect(M, y - 3.5, inner, 6, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
      cols.forEach((c, i) => doc.text(doc.splitTextToSize(c.label, w - 2)[0], M + i * w + 1, y)); y += 5; doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal');
    };
    head();
    const all = [...data.map(r => cols.map(c => show(c, toView(r)[c.name], lk))),
      ...(totals?.length ? [cols.map((c, i) => totals.includes(c.name) ? total(data, c.name).toLocaleString('en-AU') : i === 0 ? 'Total' : '')] : [])];
    all.forEach((cells, ri) => {
      const wrapped = cells.map(t => doc.splitTextToSize(t, w - 2) as string[]);
      const h = Math.max(1, ...wrapped.map(x => x.length)) * 3.8 + 1.5;
      if (y + h > 285) { doc.addPage(); y = 16; head(); }
      if (totals?.length && ri === all.length - 1) doc.setFont('helvetica', 'bold');
      wrapped.forEach((t, i) => doc.text(t, M + i * w + 1, y));
      doc.setDrawColor(220, 220, 220); doc.line(M, y + h - 3, M + inner, y + h - 3);
      y += h;
    });
    if (!data.length) { doc.setTextColor(...GREY); doc.text('No rows', M, y); doc.setTextColor(0, 0, 0); y += 5; }
    doc.setFont('helvetica', 'normal');
  };

  // title
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Coho Drive', M, y);
  doc.setFontSize(12); doc.text(`Docket No. ${d.docket_no ?? ''}`, W - M, y, { align: 'right' }); y += 6;
  doc.setFontSize(11); doc.text(form.label, M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY);
  doc.text(`${STAGE_LABEL[stageOf(d)]}${form.ref ? '  |  ' + form.ref : ''}`, W - M, y, { align: 'right' }); y += 2;
  doc.setDrawColor(...RED); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); doc.setLineWidth(0.2); doc.setTextColor(0, 0, 0); y += 6;

  const phone = (lk.work_phones ?? []).find(w => w.id === d.assigned_phone_id);
  const people = (d.assigned_person_ids ?? []).map((id: string) => (lk.people ?? []).find(p => p.id === id)?.full_name).filter(Boolean).join(', ');
  heading('Details');
  grid([...COMMON_FIELDS, ...form.header].map(f => [f.label, show(f, v[f.name], lk)] as [string, string])
    .concat([['Crew phone', phone ? `${phone.label ?? ''} ${phone.phone ?? ''}`.trim() : ''], ['Drivers', people]]));
  grid(TIME_FIELDS.map(f => [f.label, show(f, v[f.name], lk)] as [string, string]));

  const sorted = sortRows(rows);
  if (form.shifts) {
    for (const sd of form.shifts.defs) {
      const sf = shiftFields(form, sd.n);
      const pairs = [['Shift time', String(v[`s${sd.n}_band`] ?? '')] as [string, string], ...sf.map(f => [f.label, show(f, v[f.name], lk)] as [string, string])];
      const shiftRows = sorted.filter(r => Number(r.extras?.shift ?? 1) === sd.n);
      if (!pairs.some(([, x]) => x) && !shiftRows.length) continue;
      heading(sd.label);
      grid(pairs);
      if (shiftRows.length) table(form.rows.columns.map(c => form.rows.fields.find(f => f.name === c)!).filter(Boolean), shiftRows, form.rows.totals);
    }
  } else {
    heading(form.rows.label);
    table(form.rows.columns.map(c => form.rows.fields.find(f => f.name === c)!).filter(Boolean), sorted, form.rows.totals);
  }
  if (form.footer.some(f => show(f, v[f.name], lk) !== '')) { heading(form.footerTitle ?? 'Other details'); grid(form.footer.map(f => [f.label, show(f, v[f.name], lk)] as [string, string])); }
  if (form.signoff) {
    heading(form.signoff.title);
    grid([[form.signoff.nameLabel, signoff?.client_name ?? ''], ['Signed at', signoff?.signed_at ? when(signoff.signed_at) : '']]);
    if (signoff?.signature_png && String(signoff.signature_png).startsWith('data:image')) {
      need(30); try { doc.addImage(signoff.signature_png, 'PNG', M, y, 60, 25); y += 28; } catch { /* a damaged image is left out */ }
    }
    if (!signoff?.client_name) { doc.setFontSize(9); doc.setTextColor(...GREY); need(6); doc.text('Not signed yet', M, y); y += 5; doc.setTextColor(0, 0, 0); }
  }
  // footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    doc.text(`Coho Drive  |  Docket No. ${d.docket_no ?? ''}  |  Printed ${when(new Date().toISOString())}  |  Page ${p} of ${pages}`, M, 292);
  }
  return doc;
}

export const pdfName = (d: Row) => `Docket-${d.docket_no ?? d.id.slice(0, 8)}-${formFor(d.form_type).code}${d.work_date ? '-' + d.work_date : ''}.pdf`;

/** Several dockets as one zip of PDFs (or a single PDF when there is only one). Returns the file name saved. */
export async function downloadDocketPdfs(dockets: Row[], rowsFor: (id: string) => Row[], signoffFor: (id: string) => Row | undefined, lk: PdfLookups, zipName: string): Promise<string> {
  const save = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  if (dockets.length === 1) { const d = dockets[0]; const name = pdfName(d); save(docketPdf(d, rowsFor(d.id), signoffFor(d.id), lk).output('blob'), name); return name; }
  const zip = new JSZip();
  for (const d of dockets) zip.file(pdfName(d), docketPdf(d, rowsFor(d.id), signoffFor(d.id), lk).output('arraybuffer'));
  const name = zipName + '.zip';
  save(await zip.generateAsync({ type: 'blob' }), name);
  return name;
}
