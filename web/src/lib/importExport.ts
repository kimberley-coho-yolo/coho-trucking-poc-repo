// Spreadsheet upload and download. Accepts CSV, XLSX and XLS. Column headers are matched to
// field names or labels, ignoring case, spaces and punctuation.
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { Field } from './schema';

export type Sheet = Record<string, any>[];

export async function readFile(file: File): Promise<Sheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    const text = await file.text();
    return parseCsv(text);
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: false }) as Sheet;
}

export function parseCsv(text: string): Sheet {
  const r = Papa.parse<Record<string, any>>(text, { header: true, skipEmptyLines: true });
  return r.data;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Returns { header in the file -> field name } for headers we recognise.
export function autoMap(headers: string[], fields: Field[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const k = key(h);
    const f = fields.find(f => key(f.name) === k || key(f.label) === k);
    if (f) map[h] = f.name;
  }
  return map;
}

export function convert(value: any, field: Field): any {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const v = String(value).trim();
  switch (field.type) {
    case 'number': { const n = Number(v.replace(/,/g, '')); return Number.isFinite(n) ? n : null; }
    case 'bool': return /^(true|yes|y|1|x)$/i.test(v);
    case 'date': { const d = parseDate(v); return d ? d.toISOString().slice(0, 10) : null; }
    case 'datetime': { const d = parseDate(v); return d ? d.toISOString() : null; }
    default: return v;
  }
}

// Accepts ISO dates and Australian day-first dates such as 24/11/2026 18:30.
export function parseDate(v: string): Date | null {
  const au = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (au) {
    const [, d, m, y, hh = '0', mm = '0', ss = '0'] = au;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return new Date(year, Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}

export function mapRows(sheet: Sheet, mapping: Record<string, string>, fields: Field[]) {
  return sheet.map(src => {
    const row: Record<string, any> = {};
    for (const [h, fname] of Object.entries(mapping)) {
      const f = fields.find(x => x.name === fname);
      if (f) row[fname] = convert(src[h], f);
    }
    return row;
  }).filter(r => Object.values(r).some(v => v !== null));
}

export function toCsv(rows: Record<string, any>[]): string {
  return Papa.unparse(rows.map(flatten));
}

export function downloadRows(rows: Record<string, any>[], baseName: string, format: 'csv' | 'xlsx') {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (format === 'csv') {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv' });
    saveBlob(blob, `${baseName}-${stamp}.csv`);
  } else {
    const ws = XLSX.utils.json_to_sheet(rows.map(flatten));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, baseName.slice(0, 31));
    XLSX.writeFile(wb, `${baseName}-${stamp}.xlsx`);
  }
}

export function templateRows(fields: Field[]) {
  return [Object.fromEntries(fields.map(f => [f.label, '']))];
}

function flatten(r: Record<string, any>) {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(r)) o[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  return o;
}

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
