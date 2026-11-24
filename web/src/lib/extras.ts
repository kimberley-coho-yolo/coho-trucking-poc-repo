// Extra docket fields by department (design document section 8.2). Stored in dockets.extras (JSON),
// so adding a field here needs no database change.
import type { Field } from './schema';

export const DEPARTMENT_EXTRAS: Record<string, Field[]> = {
  'Completions': [{ name: 'rig_type', label: 'Rig / IOR / United / Other', type: 'select', options: ['Rig', 'IOR', 'United', 'Other'] }],
  'Workover': [{ name: 'rig_type', label: 'Rig / IOR / United / Other', type: 'select', options: ['Rig', 'IOR', 'United', 'Other'] }],
  'Drilling': [{ name: 'rig_type', label: 'Rig / IOR / United / Other', type: 'select', options: ['Rig', 'IOR', 'United', 'Other'] }],
  'Frac support': [
    { name: 'load_risk_rating', label: 'Load risk rating', type: 'select', options: ['Low', 'Medium', 'High'] },
    { name: 'hourly_task_log', label: 'Hourly task log', type: 'textarea' },
  ],
  'Flowback': [
    { name: 'load_risk_rating', label: 'Load risk rating', type: 'select', options: ['Low', 'Medium', 'High'] },
    { name: 'hourly_task_log', label: 'Hourly task log', type: 'textarea' },
  ],
  'Potable and septic': [
    { name: 'sample_result', label: 'Sample result', type: 'text' },
    { name: 'chlorine', label: 'Chlorine (mg/L)', type: 'number' },
    { name: 'meter_start', label: 'Meter reading start', type: 'number' },
    { name: 'meter_end', label: 'Meter reading end', type: 'number' },
  ],
  'Landspray': [
    { name: 'actual_weight', label: 'Actual weight (t)', type: 'number' },
    { name: 'sprayfield', label: 'Sprayfield', type: 'text' },
    { name: 'volume_m3', label: 'Volume (m3)', type: 'number' },
  ],
  'Rig support': [
    { name: 'quantity', label: 'Quantity', type: 'number' },
    { name: 'unit', label: 'Unit', type: 'select', options: ['hours', 'loads', 'days'] },
    { name: 'rate_type', label: 'Rate type', type: 'select', options: ['Hourly', 'Standby', 'Lump sum'] },
    { name: 'fuel_levy_pct', label: 'Fuel levy %', type: 'number' },
  ],
};
