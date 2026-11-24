import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { backend, type Row } from '../lib/backend';
import { TABLES, TABLE_LIST, type TableName } from '../lib/schema';
import { autoMap, downloadRows, mapRows, readFile, templateRows, type Sheet } from '../lib/importExport';
import { linkTrucks, runMatching } from '../lib/runMatching';
import { clearRefCache, DataTable, errText, Page, useToast } from '../components/ui';
import { DemoBackend } from '../lib/demoBackend';

const TABS = ['integrations', 'import', 'export', 'browse', 'query', 'km'] as const;
const TAB_LABEL: Record<string, string> = { integrations: 'Integrations', import: 'Upload spreadsheet', export: 'Download', browse: 'Browse tables', query: 'Query (SQL)', km: 'Km matching' };

export default function DataPage() {
  const [q, setQ] = useSearchParams();
  const tab = (q.get('tab') as typeof TABS[number]) || 'integrations';
  return (
    <Page title="Data" howTo={<ol>
      <li><b>Integrations</b>: the systems still to connect, and what to upload until they are.</li>
      <li><b>Upload spreadsheet</b>: choose a table, choose a CSV or Excel file, check the column matching and the preview, then <b>Import</b>.</li>
      <li><b>Download</b>: any table as CSV or Excel.</li>
      <li><b>Browse tables</b>: look at any table, search, download.</li>
      <li><b>Query (SQL)</b>: read-only SELECT queries for admin and office, e.g. <code>select * from v_daily_customer</code>.</li>
      <li><b>Km matching</b>: after uploading GPS trips, split km into customer dockets and travel.</li>
    </ol>}>
      <div className="tabs">{TABS.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setQ({ tab: t })}>{TAB_LABEL[t]}</button>)}</div>
      {tab === 'integrations' && <Integrations />}
      {tab === 'import' && <Import initial={(q.get('table') as TableName) || 'gps_trips'} />}
      {tab === 'export' && <Export />}
      {tab === 'browse' && <Browse />}
      {tab === 'query' && <Query />}
      {tab === 'km' && <Km />}
    </Page>
  );
}

function Integrations() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { backend().list('integrations', {}, { column: 'sort_order' }).then(setRows); }, []);
  return <><p>Until each system is connected, use the stand-in on the right: upload its spreadsheet export, or download from here.</p>
    <DataTable table="integrations" rows={rows} /></>;
}

function Import({ initial }: { initial: TableName }) {
  const toast = useToast();
  const importable = TABLE_LIST.filter(t => t.importable);
  const [table, setTable] = useState<TableName>(initial);
  const [sheet, setSheet] = useState<Sheet>([]);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<Record<string, string>>({});
  const fields = TABLES[table].fields;
  const headers = sheet.length ? Object.keys(sheet[0]) : [];
  const rows = mapRows(sheet, map, fields);
  const onFile = async (f?: File) => {
    if (!f) return;
    try { const s = await readFile(f); setSheet(s); setFileName(f.name); setMap(autoMap(s.length ? Object.keys(s[0]) : [], fields)); }
    catch (e) { toast.show(errText(e), 'err'); }
  };
  const doImport = async () => {
    try {
      const batch = await backend().save('import_batches', { target_table: table, file_name: fileName, row_count: rows.length });
      const withBatch = ['gps_trips', 'prestart_records'].includes(table) ? rows.map(r => ({ ...r, import_batch_id: batch.id })) : rows;
      const n = await backend().saveMany(table, withBatch);
      let linked = 0;
      if (table === 'gps_trips' || table === 'prestart_records') linked = await linkTrucks(table);
      clearRefCache(); setSheet([]); toast.show(`Imported ${n} rows${linked ? `, matched ${linked} to trucks` : ''}`);
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  return (
    <div>
      <div className="row">
        <label>Table <select value={table} onChange={e => { setTable(e.target.value as TableName); setSheet([]); }}>
          {importable.map(t => <option key={t.name} value={t.name}>{t.label}</option>)}</select></label>
        <button onClick={() => downloadRows(templateRows(fields), table + '-template', 'xlsx')}>Download blank template</button>
      </div>
      <label className="field"><span className="field-label">Spreadsheet (CSV, XLSX or XLS)</span>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={e => onFile(e.target.files?.[0])} /></label>
      {!!headers.length && <>
        <h2>Match columns</h2>
        <div className="grid">{headers.map(h => <label key={h} className="field"><span className="field-label">File column: {h}</span>
          <select value={map[h] ?? ''} onChange={e => setMap({ ...map, [h]: e.target.value })}>
            <option value="">(ignore)</option>{fields.map(f => <option key={f.name} value={f.name}>{f.label}</option>)}</select></label>)}</div>
        <h2>Preview ({rows.length} rows)</h2>
        <DataTable table={table} rows={rows.slice(0, 10).map((r, i) => ({ id: 'p' + i, ...r }))} />
        <button className="primary" disabled={!rows.length} onClick={doImport}>Import {rows.length} rows</button>
      </>}
      {toast.node}
    </div>
  );
}

const VIEWS = ['v_daily_customer', 'v_daily_truck', 'v_daily_travel'];
function Export() {
  const toast = useToast();
  const [table, setTable] = useState<string>('dockets');
  const go = async (format: 'csv' | 'xlsx') => {
    try {
      const rows = VIEWS.includes(table) ? await backend().runSelect(`select * from ${table}`) : await backend().list(table as TableName);
      downloadRows(rows, table, format); toast.show(`Downloaded ${rows.length} rows`);
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  return <div className="row">
    <label>Table <select value={table} onChange={e => setTable(e.target.value)}>
      {TABLE_LIST.map(t => <option key={t.name} value={t.name}>{t.label}</option>)}
      {backend().mode === 'supabase' && VIEWS.map(v => <option key={v} value={v}>Report: {v}</option>)}</select></label>
    <button onClick={() => go('xlsx')}>Download Excel</button><button onClick={() => go('csv')}>Download CSV</button>{toast.node}</div>;
}

function Browse() {
  const [table, setTable] = useState<TableName>('dockets');
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => { setErr(''); backend().list(table, {}, { column: 'created_at', ascending: false }).then(setRows).catch(e => setErr(errText(e))); }, [table]);
  return <div>
    <div className="row"><label>Table <select value={table} onChange={e => setTable(e.target.value as TableName)}>
      {TABLE_LIST.map(t => <option key={t.name} value={t.name}>{t.label}</option>)}</select></label>
      <button onClick={() => downloadRows(rows, table, 'xlsx')}>Download</button><span className="muted">{rows.length} rows</span></div>
    {err && <p className="err">{err}</p>}
    <DataTable table={table} rows={rows} />
  </div>;
}

function Query() {
  const [sql, setSql] = useState('select * from v_daily_customer order by work_date desc');
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState('');
  const run = async () => { setErr(''); try { setRows(await backend().runSelect(sql)); } catch (e) { setErr(errText(e)); setRows([]); } };
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return <div>
    <textarea className="sql" rows={5} value={sql} onChange={e => setSql(e.target.value)} />
    <div className="row"><button className="primary" onClick={run}>Run query</button>
      <button disabled={!rows.length} onClick={() => downloadRows(rows, 'query', 'xlsx')}>Download result</button>
      <span className="muted">Read-only. Admin and office only. Row level security still applies.</span></div>
    {err && <p className="err">{err}</p>}
    <div className="table-wrap"><table><thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.slice(0, 500).map((r, i) => <tr key={i}>{cols.map(c => <td key={c}>{typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : String(r[c] ?? '')}</td>)}</tr>)}</tbody></table></div>
  </div>;
}

function Km() {
  const toast = useToast();
  const [result, setResult] = useState<string>('');
  const run = async () => {
    try { const r = await runMatching(); setResult(`Matched ${r.shifts} shifts into ${r.segments} segments.${r.flags.length ? ' Flags: ' + r.flags.join('; ') : ''}`); toast.show('Km matching done'); }
    catch (e) { toast.show(errText(e), 'err'); }
  };
  return <div>
    <p>Splits uploaded GPS trips for each shift: time inside a docket goes to that docket (customer); time outside any docket is <b>travel</b> with no customer. In the full build this runs every night by itself.</p>
    <button className="primary" onClick={run}>Run km matching now</button>
    {result && <p className="note">{result}</p>}
    {backend().mode === 'demo' && <p><button className="danger" onClick={() => { if (window.confirm('Reset all demo data in this browser?')) { (backend() as DemoBackend).reset(); location.reload(); } }}>Reset demo data</button></p>}
    {toast.node}
  </div>;
}
