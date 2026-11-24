import { Page } from '../components/ui';

const SCREENS: [string, string][] = [
  ['Sign in', 'Work mobile or email, then the 6-digit code.'],
  ['Who is driving?', 'Pick your name from the people on this work phone, or Cover driver.'],
  ['Home', 'Start a shift, My drafts, Report a fault; staff also see Approvals, Reports, Admin and Data.'],
  ['Start a shift', 'Scan the truck QR (or type it / pick the truck), check date, Day/Night and trailer.'],
  ['Prestart', 'Do the Gearbox prestart, then use it here or mark passed / failed.'],
  ['Shift', 'Prestart status, today\'s jobs, dockets, fault, end of shift.'],
  ['Docket', 'Job details, times, department extras, loads, end of job, client sign-off. Save, Save and exit, Close docket.'],
  ['Report a fault', 'Truck, fault, safe to run. Not safe tags the truck out.'],
  ['End shift and timesheet', 'Hours worked out for you: docket, travel, standby. Add R&R, wet hours, diary page. Submit.'],
  ['My drafts', 'Everything unfinished. Resume takes you back to where you left off.'],
  ['Approvals', 'Supervisors approve or query timesheet lines; export approved hours for MYOB.'],
  ['Reports', 'Per customer and rig, per truck, and travel. Download to Excel.'],
  ['Admin', 'Logins and roles, people, work phones and who uses them, trucks, trailers, customers, rigs, jobs, allocations.'],
  ['Data', 'Integrations list, upload spreadsheets, download, browse, SQL query, km matching.'],
];
export default function Help() {
  return (
    <Page title="Help">
      <p>Every screen has a <b>How to use this screen</b> link at the top. Every field is optional in this proof of concept, and you can <b>Save and exit</b> at any point and carry on from <b>My drafts</b>.</p>
      <div className="table-wrap"><table><thead><tr><th>Screen</th><th>What it is for</th></tr></thead>
        <tbody>{SCREENS.map(([a, b]) => <tr key={a}><td><b>{a}</b></td><td>{b}</td></tr>)}</tbody></table></div>
      <p className="muted">Full manuals: Coho Drive (Coho Trucking PoC) User Manual and Developer Manual (Word, in the Trucking spreadsheet folder).</p>
    </Page>
  );
}
