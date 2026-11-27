// Settings (admin only): create roles and choose, for every function, whether each role has it
// hidden, read only or edit. The database enforces the same settings, so this is not just cosmetic.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { backend, type Row } from '../lib/backend';
import { allowedLevels, effectiveAccess, FEATURES, type Access, type Feature } from '../lib/permissions';
import { TABLES } from '../lib/schema';
import { EditOnly, errText, FieldGrid, Page, useReadOnly, useToast } from '../components/ui';
import { useApp } from '../state';
import { DAY_NAMES, DUE_TIME, periodEnd, periodStart, submitBy, weekday, type PeriodView } from '../lib/forms';
import { periodSettingsFrom, reloadAppSettings } from '../lib/appSettings';
import { todayIso } from '../components/ui';

const LEVEL_LABEL: Record<Access, string> = { hidden: 'Hidden', read: 'Read only', edit: 'Edit' };
const SHORT: Record<Access, string> = { hidden: '-', read: 'Read', edit: 'Edit' };

/** Turn "HSE Manager" into "hse_manager" for the role code. */
export function roleCode(label: string) {
  const c = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  return /^[a-z]/.test(c) ? c : 'r_' + c;
}

export default function Settings() {
  const { refresh } = useApp();
  const toast = useToast();
  const readOnly = useReadOnly();
  const [roles, setRoles] = useState<Row[]>([]);
  const [features, setFeatures] = useState<Feature[]>(FEATURES);
  const [stored, setStored] = useState<Row[]>([]);
  const [sel, setSel] = useState('driver');
  const [draft, setDraft] = useState<Record<string, Access>>({});
  const [roleEdit, setRoleEdit] = useState<Row | null>(null);
  const [newRole, setNewRole] = useState<{ label: string; copyFrom: string } | null>(null);

  const load = async () => {
    try {
      const [r, f, p] = await Promise.all([
        backend().list('roles', {}, { column: 'rank' }),
        backend().list('features', {}, { column: 'sort' }),
        backend().list('role_permissions'),
      ]);
      setRoles([...r].sort((a, b) => (a.rank ?? 50) - (b.rank ?? 50)));
      if (f.length) setFeatures([...f].sort((a, b) => a.sort - b.sort) as Feature[]);
      setStored(p);
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const role = roles.find(r => r.code === sel);
  const storedFor = (code: string, f: string) => stored.find(p => p.role === code && p.feature === f)?.access as Access | undefined;
  const current = (f: Feature): Access => draft[f.code] ?? effectiveAccess(sel, f, storedFor(sel, f.code));
  const changed = Object.keys(draft).filter(k => draft[k] !== effectiveAccess(sel, features.find(f => f.code === k), storedFor(sel, k)));
  const groups = useMemo(() => [...new Set(features.map(f => f.grp))], [features]);

  const pick = (code: string) => {
    if (changed.length && !window.confirm('You have unsaved access changes for this role. Discard them?')) return;
    setSel(code); setDraft({}); setRoleEdit(null); setNewRole(null);
  };
  const setAll = (a: Access) => {
    const next: Record<string, Access> = {};
    for (const f of features) { const ok = allowedLevels(sel, f); next[f.code] = ok.includes(a) ? a : ok[ok.length - 1]; }
    setDraft(next);
  };
  const copyFrom = (code: string) => {
    const next: Record<string, Access> = {};
    for (const f of features) { const a = effectiveAccess(code, f, storedFor(code, f.code)); next[f.code] = allowedLevels(sel, f).includes(a) ? a : 'read'; }
    setDraft(next);
  };

  const saveAccess = async () => {
    try {
      for (const k of changed) {
        const existing = stored.find(p => p.role === sel && p.feature === k);
        await backend().save('role_permissions', existing ? { id: existing.id, access: draft[k] } : { role: sel, feature: k, access: draft[k] });
      }
      toast.show(`Saved ${changed.length} change${changed.length === 1 ? '' : 's'} for ${role?.label ?? sel}. People with this role see the change next time they open the app.`);
      setDraft({}); await load(); await refresh();
    } catch (e) { toast.show(errText(e), 'err'); }
  };

  const saveRole = async () => {
    try { await backend().save('roles', roleEdit!); setRoleEdit(null); toast.show('Role saved'); await load(); }
    catch (e) { toast.show(errText(e), 'err'); }
  };
  const deleteRole = async () => {
    if (!role || !window.confirm(`Delete the role "${role.label}"? Logins must be moved to another role first. This cannot be undone.`)) return;
    try { await backend().remove('roles', role.id); toast.show('Role deleted'); setSel('driver'); setRoleEdit(null); await load(); }
    catch (e) { toast.show(errText(e), 'err'); }
  };
  const createRole = async () => {
    if (!newRole?.label.trim()) return;
    const code = roleCode(newRole.label);
    if (roles.some(r => r.code === code)) { toast.show('A role with that name already exists', 'err'); return; }
    try {
      await backend().save('roles', { code, label: newRole.label.trim(), rank: 50, active: true, description: null });
      for (const f of features) {
        const a = effectiveAccess(newRole.copyFrom, f, storedFor(newRole.copyFrom, f.code));
        await backend().save('role_permissions', { role: code, feature: f.code, access: allowedLevels(code, f).includes(a) ? a : 'read' });
      }
      toast.show(`Role "${newRole.label.trim()}" created. Now choose what it can see, then add logins with this role under Admin > Logins and roles.`);
      setNewRole(null); setDraft({}); await load(); setSel(code);
    } catch (e) { toast.show(errText(e), 'err'); }
  };

  return (
    <Page title="Settings" howTo={<ol>
      <li>Pick a role at the top. Each function in the app is set to <b>Hidden</b> (not shown at all), <b>Read only</b> (can look, cannot change) or <b>Edit</b>.</li>
      <li>Tap the choice you want for each function, then tap <b>Save access</b>. People with that role see the change the next time they open the app.</li>
      <li><b>New role</b> creates a role (for example HSE or Payroll) and copies its starting access from an existing role. Then give people that role under <b>Admin &gt; Logins and roles</b>.</li>
      <li>The system admin (SYS.ADM) always has full access so someone can always fix these settings. Integrations, Logins and these Settings can only ever be edited by the system admin (SYS.ADM).</li>
      <li>The database enforces these settings too, so hidden or read-only data cannot be reached another way.</li>
    </ol>}>
      <TimesheetSettings />
      <h2>Roles</h2>
      <div className="role-tabs" role="tablist">
        {roles.map(r => <button key={r.code} role="tab" aria-selected={sel === r.code} className={(sel === r.code ? 'on ' : '') + (r.active === false ? 'retired' : '')}
          onClick={() => pick(r.code)}>{r.label}</button>)}
        <EditOnly><button onClick={() => { setNewRole({ label: '', copyFrom: 'driver' }); setRoleEdit(null); }}>+ New role</button></EditOnly>
      </div>

      {newRole && <div className="subform"><h2>New role</h2>
        <div className="grid">
          <label className="field"><span className="field-label">Name</span>
            <input value={newRole.label} onChange={e => setNewRole({ ...newRole, label: e.target.value })} placeholder="e.g. HSE" /></label>
          <label className="field"><span className="field-label">Start with the same access as</span>
            <select value={newRole.copyFrom} onChange={e => setNewRole({ ...newRole, copyFrom: e.target.value })}>
              {roles.filter(r => r.code !== 'admin').map(r => <option key={r.code} value={r.code}>{r.label}</option>)}</select></label>
        </div>
        <div className="savebar"><button className="primary" disabled={!newRole.label.trim()} onClick={createRole}>Create role</button><button onClick={() => setNewRole(null)}>Cancel</button></div>
      </div>}

      {role && <>
        <div className="page-head">
          <div><h2 style={{ marginBottom: 2 }}>{role.label}{role.active === false && ' (retired)'}</h2>
            <span className="muted">{role.description || 'No description yet.'}</span></div>
          <EditOnly><div className="row"><button onClick={() => setRoleEdit({ ...role })}>Edit role details</button></div></EditOnly>
        </div>
        {roleEdit && <div className="subform"><h2>Role details</h2>
          <FieldGrid fields={TABLES.roles.fields.filter(f => f.name !== 'code' && !(role.code === 'admin' && ['rank', 'active'].includes(f.name)))} value={roleEdit} onChange={setRoleEdit} />
          <p className="muted small">Role code: <code>{role.code}</code>{role.is_system ? ' (built-in role: it can be renamed but not deleted)' : ''}. Retiring a role (untick Active) removes access for every login with it.</p>
          <div className="savebar"><button className="primary" onClick={saveRole}>Save role</button><button onClick={() => setRoleEdit(null)}>Cancel</button>
            {!role.is_system && <button className="danger" onClick={deleteRole}>Delete role</button>}</div>
        </div>}

        {sel === 'admin'
          ? <p className="note">The system admin (SYS.ADM) can do everything: every function is set to Edit and cannot be restricted, so there is always someone who can manage logins, integrations, reports and these settings.</p>
          : <EditOnly><div className="row" style={{ margin: '8px 0' }}>
              <span className="muted">Quick set:</span>
              <button className="small" onClick={() => setAll('hidden')}>All hidden</button>
              <button className="small" onClick={() => setAll('read')}>All read only</button>
              <label className="row small">Copy from <select value="" onChange={e => e.target.value && copyFrom(e.target.value)}>
                <option value="">choose a role</option>
                {roles.filter(r => r.code !== sel).map(r => <option key={r.code} value={r.code}>{r.label}</option>)}</select></label>
            </div></EditOnly>}

        <div className="table-wrap"><table className="access-grid">
          <thead><tr><th>Function</th><th>Access for {role.label}</th></tr></thead>
          <tbody>{groups.map(g => <Fragment key={g}>
            <tr><th colSpan={2}>{g}</th></tr>
            {features.filter(f => f.grp === g).map(f => {
              const ok = allowedLevels(sel, f);
              const cur = current(f);
              const isChanged = changed.includes(f.code);
              return <tr key={f.code} className={isChanged ? 'changed' : ''}>
                <td className="fn"><b>{f.label}</b><small>{f.description}</small></td>
                <td>
                  <div className="seg" role="radiogroup" aria-label={`${f.label} access for ${role.label}`}>
                    {(['hidden', 'read', 'edit'] as Access[]).map(a => (
                      <button key={a} type="button" role="radio" aria-checked={cur === a}
                        className={(cur === a ? 'on ' : '') + (cur === a && a === 'hidden' ? 'hidden-on' : '')}
                        disabled={readOnly || !ok.includes(a)}
                        onClick={() => setDraft({ ...draft, [f.code]: a })}>{LEVEL_LABEL[a]}</button>))}
                  </div>
                  {sel !== 'admin' && f.admin_only_edit && <div className="lock">Only SYS.ADM can edit</div>}
                  {sel !== 'admin' && !f.admin_only_edit && f.max_level === 'read' && <div className="lock">Only SYS.ADM can edit</div>}
                </td>
              </tr>;
            })}
          </Fragment>)}</tbody>
        </table></div>

        {sel !== 'admin' && <EditOnly><div className="savebar">
          <button className="primary" disabled={!changed.length} onClick={saveAccess}>Save access{changed.length ? ` (${changed.length} change${changed.length === 1 ? '' : 's'})` : ''}</button>
          <button disabled={!changed.length} onClick={() => setDraft({})}>Undo changes</button>
        </div></EditOnly>}
      </>}

      <h2>All roles at a glance</h2>
      <div className="table-wrap"><table className="matrix">
        <thead><tr><th>Function</th>{roles.map(r => <th key={r.code} className="rot">{r.label}</th>)}</tr></thead>
        <tbody>{features.map(f => <tr key={f.code}><td>{f.label}</td>
          {roles.map(r => { const a = r.code === sel && draft[f.code] ? draft[f.code] : effectiveAccess(r.code, f, storedFor(r.code, f.code));
            return <td key={r.code} className={'lvl ' + a}>{SHORT[a]}</td>; })}</tr>)}</tbody>
      </table></div>
      {toast.node}
    </Page>
  );
}

/** Admin: which day timesheet weeks start on, and whether timesheets open as a fortnight or a week. */
function TimesheetSettings() {
  const toast = useToast();
  const readOnly = useReadOnly();
  const [rows, setRows] = useState<Row[]>([]);
  const [ws, setWs] = useState(1);
  const [view, setView] = useState<PeriodView>('fortnight');
  useEffect(() => { backend().list('app_settings').then(r => { setRows(r); const p = periodSettingsFrom(r); setWs(p.weekStart); setView(p.view); }).catch(() => null); }, []);
  const p = periodSettingsFrom(rows);
  const preview = { ...p, weekStart: ws, view };
  const start = periodStart(todayIso(), preview);
  const save = async () => {
    try {
      const put = (id: string, value: unknown) => backend().save('app_settings', { ...(rows.find(r => r.id === id) ?? { id }), value });
      await put('timesheet_week_start', ws);
      await put('timesheet_default_view', view);
      reloadAppSettings();
      setRows(await backend().list('app_settings'));
      toast.show('Timesheet settings saved');
    } catch (e) { toast.show(errText(e), 'err'); }
  };
  return (
    <section className="timesheet-settings">
      <h2>Timesheets</h2>
      <div className="grid">
        <label className="field"><span className="field-label">Weeks start on</span>
          <select value={ws} disabled={readOnly} onChange={e => setWs(Number(e.target.value))}>
            {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          <small className="help">Timesheets and approvals run from this day, e.g. Monday to Sunday.</small></label>
        <label className="field"><span className="field-label">Timesheets open as</span>
          <select value={view} disabled={readOnly} onChange={e => setView(e.target.value as PeriodView)}>
            <option value="fortnight">Fortnight (14 days)</option><option value="week">Week (7 days)</option></select>
          <small className="help">Anyone can still switch between week and fortnight on the screen.</small></label>
      </div>
      <p className="muted">Today falls in the {view} {start} ({DAY_NAMES[ws]}) to {periodEnd(start, view)}. Due by {DUE_TIME} {weekday(submitBy(start, view).slice(0, 10))} {submitBy(start, view).slice(0, 10)}.</p>
      <EditOnly><button className="primary" onClick={save}>Save timesheet settings</button></EditOnly>
      {toast.node}
    </section>
  );
}
