/**
 * Writes migrations/0005_task_list_seed.sql: the starting Task Lists, drafted from the products BOQ Maker actually
 * quotes (its catalogue and the lines of its quotes, read 2026-10-20 — names and quantities only, no prices) and
 * typical durations for sports-surface work in India. Everything can be edited later on the Task Lists page.
 *
 *   npx tsx scripts/gen-task-list-seed.ts
 *
 * Durations are working days (Sundays off). F(n) = fixed n days; Q(d, per, unit, min) = d days per `per` units, at
 * least `min`. Sub-tasks run one after another unless a step names another step (`after`) or none (`after: null`).
 * A task's `after` names another Task List task it waits for when both are in a project.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

type Rule = { mode: 'fixed' | 'per_qty'; days: number; perQty: number | null; unit: string | null; minDays: number };
const F = (days: number): Rule => ({ mode: 'fixed', days, perQty: null, unit: null, minDays: 1 });
const Q = (days: number, perQty: number, unit: 'sqft' | 'rmt' | 'rft' | 'nos', minDays = 1): Rule => ({ mode: 'per_qty', days, perQty, unit, minDays });

interface Step {
  name: string;
  rule: Rule;
  /** Another step's name, or null for "starts with the task". Default: the step before. */
  after?: string | null;
}
interface Template {
  key: string;
  category: 'material' | 'equipment' | 'logistics' | 'installation' | 'billing';
  name: string;
  match?: string[];
  after?: string;
  autoAdd?: boolean;
  rule?: Rule;
  steps: Step[];
}
const s = (name: string, rule: Rule, after?: string | null): Step => (after === undefined ? { name, rule } : { name, rule, after });

const TURF = ['verde', 'kryoturf', 'artificial turf'];
const ACRYLIC = ['avalon', 'acrylic'];
const RUBBER = ['epdm', 'sbr'];
const WOOD = ['hardcourt', 'hevea'];
const VINYL = ['strata'];
const TILES = ['velocity pro', 'flexlock'];
const RESIN = ['terralux', 'polymatrix', 'aluminium edge'];
const FENCE = ['gi pro', 'hd pro', 'chain link', 'fencing'];
const NET = ['hdpe net'];
const LIGHTS = ['solaris', 'floodlight'];
const SPORTS = ['portable', 'pickle pro', 'sound board', 'goal pro', 'hoop pro', 'smash pro', 'ace pro', 'volley pro', 'handball'];
const PADEL = ['padel pro'];
const GLASS = ['backwall glass'];
const PAINT = ['hard plaster', 'wall painting'];

const T: Template[] = [
  // ---- Material procurement ----
  {
    key: 'm-turf', category: 'material', name: 'Artificial turf', match: TURF,
    steps: [s('Confirm turf spec, colours & quantity', F(1)), s('Raise PO on turf supplier', F(1)), s('Pay supplier advance', F(1)),
      s('Production / stock allocation', Q(1, 4000, 'sqft', 10)), s('Dispatch & transit to site', F(7)), s('Receive & inspect rolls at site', F(1))],
  },
  {
    key: 'm-acrylic', category: 'material', name: 'Acrylic coating system', match: ACRYLIC,
    steps: [s('Confirm system, layers & colours', F(1)), s('Raise PO', F(1)), s('Pay supplier advance', F(1)), s('Manufacture / stock allocation', F(5)),
      s('Dispatch & transit to site', F(5)), s('Receive & check batch numbers', F(1))],
  },
  {
    key: 'm-rubber', category: 'material', name: 'Rubber flooring (SBR / EPDM)', match: RUBBER,
    steps: [s('Confirm thickness, colours & quantity', F(1)), s('Raise PO for granules & PU binder', F(1)), s('Pay supplier advance', F(1)),
      s('Supplier production', Q(1, 5000, 'sqft', 7)), s('Dispatch & transit to site', F(5)), s('Receive & inspect', F(1))],
  },
  {
    key: 'm-wood', category: 'material', name: 'Wooden sports flooring', match: WOOD,
    steps: [s('Confirm grade, system & finish', F(1)), s('Raise PO', F(1)), s('Pay supplier advance', F(1)), s('Manufacture boards & battens', Q(1, 500, 'sqft', 15)),
      s('Dispatch & transit to site', F(7)), s('Receive & check moisture content', F(1))],
  },
  {
    key: 'm-vinyl', category: 'material', name: 'Vinyl sports flooring', match: VINYL,
    steps: [s('Confirm product, thickness & colour', F(1)), s('Raise PO', F(1)), s('Pay supplier advance', F(1)), s('Supplier stock / import', F(10)),
      s('Dispatch & transit to site', F(5)), s('Receive & inspect rolls', F(1))],
  },
  {
    key: 'm-tiles', category: 'material', name: 'Interlocking court tiles', match: TILES,
    steps: [s('Confirm tile type & colours', F(1)), s('Raise PO', F(1)), s('Pay supplier advance', F(1)), s('Supplier production', Q(1, 5000, 'sqft', 7)),
      s('Dispatch & transit to site', F(5)), s('Receive & count tiles', F(1))],
  },
  {
    key: 'm-resin', category: 'material', name: 'Resin bound surfacing (Terralux)', match: RESIN,
    steps: [s('Confirm aggregate blend, colours & thickness', F(1)), s('Raise PO for aggregates & binder', F(1)), s('Pay supplier advance', F(1)),
      s('Supplier production', Q(1, 10000, 'sqft', 7)), s('Fabricate aluminium edge profiles', Q(1, 300, 'rmt', 5), 'Pay supplier advance'),
      s('Dispatch & transit to site', F(5), 'Supplier production'), s('Receive & inspect', F(1))],
  },
  {
    key: 'm-fence', category: 'material', name: 'Fencing (GI / HD chain-link)', match: FENCE,
    steps: [s('Confirm height, mesh & post layout', F(1)), s('Raise PO', F(1)), s('Pay supplier advance', F(1)), s('Fabricate posts, frames & mesh', Q(1, 3000, 'sqft', 7)),
      s('Galvanising / powder coating', F(5)), s('Dispatch & transit to site', F(4)), s('Receive & inspect', F(1))],
  },
  {
    key: 'm-net', category: 'material', name: 'HDPE netting', match: NET,
    steps: [s('Confirm net spec & coverage', F(1)), s('Raise PO', F(1)), s('Supplier stock', F(5)), s('Dispatch & transit to site', F(4)), s('Receive & inspect', F(1))],
  },
  {
    key: 'm-civil', category: 'material', name: 'Civil contractor & materials', match: ['base preparation', 'earth work', 'drain'],
    steps: [s('Site survey & levels', F(1)), s('Finalise civil contractor & rates', F(3)), s('Issue work order', F(1)),
      s('Arrange cement, steel & aggregates at site', F(3))],
  },
  {
    key: 'm-glass', category: 'material', name: 'Squash court glass back wall', match: GLASS,
    steps: [s('Confirm drawings & glass spec', F(2)), s('Raise PO', F(1)), s('Pay supplier advance', F(1)), s('Fabricate glass & fittings', F(20)),
      s('Dispatch & transit to site', F(5)), s('Receive & inspect', F(1))],
  },
  {
    key: 'm-paint', category: 'material', name: 'Wall plaster & paint materials', match: PAINT,
    steps: [s('Confirm shades & quantities', F(1)), s('Raise PO', F(1)), s('Supplier delivery to site', F(3))],
  },
  {
    key: 'm-cricket', category: 'material', name: 'Cricket mat', match: ['cricket mat'],
    steps: [s('Confirm mat size & spec', F(1)), s('Raise PO', F(1)), s('Supplier stock', F(5)), s('Dispatch & transit to site', F(4))],
  },

  // ---- Equipment procurement ----
  {
    key: 'e-lights', category: 'equipment', name: 'Floodlights & poles', match: LIGHTS,
    steps: [s('Confirm lux design & pole layout', F(2)), s('Raise PO', F(1)), s('Pay supplier advance', F(1)), s('Manufacture fixtures & poles', Q(1, 20, 'nos', 10)),
      s('Dispatch & transit to site', F(5)), s('Receive & test fixtures', F(1))],
  },
  {
    key: 'e-sports', category: 'equipment', name: 'Sports equipment (posts, nets, hoops)', match: SPORTS,
    steps: [s('Confirm equipment list & sizes', F(1)), s('Raise PO', F(1)), s('Pay supplier advance', F(1)), s('Supplier stock / manufacture', F(7)),
      s('Dispatch & transit to site', F(4)), s('Receive & check against PO', F(1))],
  },
  {
    key: 'e-padel', category: 'equipment', name: 'Padel court structure', match: PADEL,
    steps: [s('Confirm court model, glass & colour', F(2)), s('Raise PO', F(1)), s('Pay supplier advance', F(1)), s('Manufacture structure & glass', F(30)),
      s('Shipping & transit to site', F(10)), s('Receive & inspect at site', F(1))],
  },
  {
    key: 'e-tools', category: 'equipment', name: 'Installation machinery & tools',
    steps: [s('List machinery & tools needed', F(1)), s('Arrange / hire machinery', F(3)), s('Service & check machinery', F(1))],
  },

  // ---- Logistics ----
  {
    key: 'l-dispatch', category: 'logistics', name: 'Dispatch from warehouse to site', autoAdd: true,
    steps: [s('Pack & load material', F(1)), s('Arrange transporter & e-way bill', F(1)), s('Transit to site', F(4)), s('Unload & store at site', F(1))],
  },
  {
    key: 'l-team', category: 'logistics', name: 'Team travel & stay', autoAdd: true,
    steps: [s('Plan installation team & dates', F(1)), s('Book travel & stay', F(2)), s('Team travels to site', F(1))],
  },
  {
    key: 'l-inbound', category: 'logistics', name: 'Inbound to warehouse',
    steps: [s('Track inbound shipment', F(5)), s('Receive at warehouse & GRN', F(1)), s('Store & tag', F(1))],
  },
  {
    key: 'l-return', category: 'logistics', name: 'Return of tools & machinery',
    steps: [s('Pack tools & machinery at site', F(1)), s('Transport back to warehouse', F(4)), s('Check in at warehouse', F(1))],
  },

  // ---- Installation (site work) ----
  {
    key: 'i-remove', category: 'installation', name: 'Remove existing flooring', match: ['removal of existing'],
    steps: [s('Dismantle existing flooring', Q(1, 1000, 'sqft', 1)), s('Clear debris from site', F(1))],
  },
  {
    key: 'i-rcc', category: 'installation', name: 'Civil base — RCC / PCC', match: ['with rcc', 'pcc'], after: 'm-civil',
    steps: [s('Excavation & sub-grade compaction', Q(1, 5000, 'sqft', 2)), s('Lay & compact GSB / WMM', Q(1, 4000, 'sqft', 2)),
      s('Formwork & reinforcement', Q(1, 3000, 'sqft', 2)), s('Cast RCC / PCC slab', Q(1, 2000, 'sqft', 2)), s('Curing (28 days)', F(24)), s('Check levels & slopes', F(1))],
  },
  {
    key: 'i-asphalt', category: 'installation', name: 'Civil base — asphalt', match: ['asphalt'], after: 'm-civil',
    steps: [s('Excavation & sub-grade compaction', Q(1, 5000, 'sqft', 2)), s('Lay & compact GSB / WMM', Q(1, 4000, 'sqft', 2)),
      s('Lay bituminous / asphalt layers', Q(1, 10000, 'sqft', 2)), s('Cure asphalt (14 days)', F(12)), s('Check levels & slopes', F(1))],
  },
  {
    key: 'i-earth', category: 'installation', name: 'Civil base — earthwork & GSB (turf)', match: ['base preparation (footbal'], after: 'm-civil',
    steps: [s('Excavation & grading', Q(1, 8000, 'sqft', 2)), s('Lay & compact GSB / WMM', Q(1, 6000, 'sqft', 2)), s('Final levelling & compaction', Q(1, 10000, 'sqft', 1))],
  },
  {
    key: 'i-subdrain', category: 'installation', name: 'Sub-surface drainage', match: ['sub surface'], after: 'm-civil',
    steps: [s('Trench & lay perforated pipes', Q(1, 5000, 'sqft', 3)), s('Backfill with filter media', Q(1, 8000, 'sqft', 2))],
  },
  {
    key: 'i-drain', category: 'installation', name: 'Surface drain (U / saucer)', match: ['saucer drain', 'u-drain'], after: 'm-civil',
    steps: [s('Excavate & cast drain', Q(1, 100, 'rft', 2)), s('Cure & finish drain', F(3))],
  },
  {
    key: 'i-turf', category: 'installation', name: 'Turf installation', match: TURF, after: 'm-turf',
    steps: [s('Check base levels & clean', Q(1, 15000, 'sqft', 1)), s('Unroll, seam & glue turf', Q(1, 4000, 'sqft', 2)), s('Inlay game lines', Q(1, 8000, 'sqft', 1)),
      s('Sand & rubber infill', Q(1, 8000, 'sqft', 1)), s('Brush, groom & final check', F(1))],
  },
  {
    key: 'i-acrylic', category: 'installation', name: 'Acrylic court coating', match: ACRYLIC, after: 'm-acrylic',
    steps: [s('Surface prep, crack & level repair', Q(1, 5000, 'sqft', 1)), s('Primer / resurfacer coats', Q(1, 4000, 'sqft', 2)),
      s('Cushion & colour coats', Q(1, 2000, 'sqft', 3)), s('Line marking', F(1)), s('Cure before play', F(2))],
  },
  {
    key: 'i-rubber', category: 'installation', name: 'Rubber flooring installation', match: RUBBER, after: 'm-rubber',
    steps: [s('Prime the base', Q(1, 8000, 'sqft', 1)), s('Lay SBR base layer', Q(1, 3000, 'sqft', 2)), s('Lay EPDM top layer', Q(1, 2000, 'sqft', 2)),
      s('Cure', F(2)), s('Line marking', F(1))],
  },
  {
    key: 'i-wood', category: 'installation', name: 'Wooden flooring installation', match: WOOD, after: 'm-wood',
    steps: [s('Acclimatise wood at site', F(3)), s('Lay underlay & battens', Q(1, 800, 'sqft', 2)), s('Fix boards', Q(1, 500, 'sqft', 3)),
      s('Sand & apply PU coats', Q(1, 1000, 'sqft', 3)), s('Line marking', F(1)), s('Fix edge beading & skirting', F(1))],
  },
  {
    key: 'i-vinyl', category: 'installation', name: 'Vinyl flooring installation', match: VINYL, after: 'm-vinyl',
    steps: [s('Level / screed the floor', Q(1, 1500, 'sqft', 1)), s('Cure screed', F(2)), s('Lay & weld vinyl', Q(1, 1000, 'sqft', 1)), s('Line marking', F(1))],
  },
  {
    key: 'i-tiles', category: 'installation', name: 'Interlocking tile installation', match: TILES, after: 'm-tiles',
    steps: [s('Check base', F(1)), s('Lay & lock tiles', Q(1, 4000, 'sqft', 1)), s('Fit edges & ramps', F(1)), s('Line marking', F(1))],
  },
  {
    key: 'i-resin', category: 'installation', name: 'Resin bound surfacing installation', match: RESIN, after: 'm-resin',
    steps: [s('Substrate prep & priming', Q(1, 6000, 'sqft', 1)), s('Fix aluminium edge profiles', Q(1, 150, 'rmt', 1)),
      s('Mix & trowel resin bound layer', Q(1, 1500, 'sqft', 2)), s('Cure', F(2))],
  },
  {
    key: 'i-fence', category: 'installation', name: 'Fencing installation', match: FENCE, after: 'm-fence',
    steps: [s('Mark & dig post pits', Q(1, 4000, 'sqft', 1)), s('Cast post foundations', Q(1, 3000, 'sqft', 2)), s('Cure foundations', F(5)),
      s('Erect posts & frames', Q(1, 3000, 'sqft', 1)), s('Fix mesh & gates', Q(1, 3000, 'sqft', 1))],
  },
  {
    key: 'i-net', category: 'installation', name: 'HDPE roof net installation', match: NET, after: 'm-net',
    steps: [s('Rig support cables', Q(1, 6000, 'sqft', 1)), s('Fix & tension net', Q(1, 4000, 'sqft', 1))],
  },
  {
    key: 'i-lights', category: 'installation', name: 'Floodlight installation', match: LIGHTS, after: 'e-lights',
    steps: [s('Cable trenching & electrical works', F(3)), s('Cast pole foundations', Q(1, 8, 'nos', 2)), s('Cure foundations', F(5)),
      s('Erect poles & mount fixtures', Q(1, 6, 'nos', 1)), s('Wiring, aiming & lux test', F(1))],
  },
  {
    key: 'i-sports', category: 'installation', name: 'Sports equipment installation', match: SPORTS, after: 'e-sports',
    steps: [s('Fix ground sleeves for fixed posts', F(1)), s('Install & check equipment', Q(1, 4, 'nos', 1))],
  },
  {
    key: 'i-padel', category: 'installation', name: 'Padel court installation', match: PADEL, after: 'e-padel',
    steps: [s('Check base & anchor layout', F(1)), s('Erect structure & fix anchors', Q(4, 1, 'nos', 4)), s('Fix glass panels & mesh', Q(2, 1, 'nos', 2)),
      s('Lay padel turf & infill', Q(2, 1, 'nos', 2)), s('Lighting & final check', F(1))],
  },
  {
    key: 'i-glass', category: 'installation', name: 'Squash glass back wall installation', match: GLASS, after: 'm-glass',
    steps: [s('Fix floor & wall channels', F(1)), s('Install glass panels & door', F(2)), s('Align & seal', F(1))],
  },
  {
    key: 'i-wall', category: 'installation', name: 'Wall plaster & painting', match: PAINT, after: 'm-paint',
    steps: [s('Hard plaster', Q(1, 500, 'sqft', 2)), s('Cure plaster', F(5)), s('Prime & paint walls', Q(1, 1000, 'sqft', 2))],
  },
  {
    key: 'i-lines', category: 'installation', name: 'Line marking & edge beading', match: ['game line marking', 'edge beading'],
    steps: [s('Mark out game lines', F(1)), s('Paint game lines', F(1)), s('Fix edge beading', F(1))],
  },
  {
    key: 'i-cricket', category: 'installation', name: 'Cricket mat installation', match: ['cricket mat'], after: 'm-cricket',
    steps: [s('Lay & secure cricket mat', F(1))],
  },
  {
    key: 'i-handover', category: 'installation', name: 'Site handover', autoAdd: true,
    steps: [s('Snag list & touch-ups', F(1)), s('Site cleaning', F(1)), s('Client walkthrough & sign-off', F(1)), s('Handover documents & warranty', F(1))],
  },

  // ---- Billing ----
  {
    key: 'b-advance', category: 'billing', name: 'Advance invoice', autoAdd: true,
    steps: [s('Raise advance invoice', F(1)), s('Follow up advance payment', F(5))],
  },
  {
    key: 'b-supply', category: 'billing', name: 'Material supply invoice', autoAdd: true, after: 'l-dispatch',
    steps: [s('Raise invoice on dispatch', F(1)), s('Follow up payment', F(7))],
  },
  {
    key: 'b-final', category: 'billing', name: 'Final invoice & payment', autoAdd: true, after: 'i-handover',
    steps: [s('Joint measurement & completion certificate', F(1)), s('Raise final invoice', F(1)), s('Follow up final payment', F(10))],
  },
  {
    key: 'b-vendor', category: 'billing', name: 'Vendor bill processing',
    steps: [s('Match vendor bills to PO & receipt', F(2)), s('Approve & schedule payment', F(2)), s('Release payment', F(1))],
  },
];

// ---- SQL ----
const AT = '2026-10-20T00:00:00.000Z';
const q = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);
const tid = (key: string) => `tl-${key}`;
const rows: string[] = [];
const deps: [string, string][] = [];
const order: Record<string, number> = {};
const keys = new Set(T.map((t) => t.key));

for (const t of T) {
  order[t.category] = (order[t.category] ?? 0) + 1;
  const rule = t.rule ?? F(1);
  rows.push(row(tid(t.key), t.category, null, t.name, order[t.category]!, rule, t.match ?? [], !!t.autoAdd));
  if (t.after) {
    if (!keys.has(t.after)) throw new Error(`${t.key}: unknown task ${t.after}`);
    deps.push([tid(t.key), tid(t.after)]);
  }
  const ids = new Map<string, string>();
  t.steps.forEach((st, i) => {
    const id = `${tid(t.key)}-${String(i + 1).padStart(2, '0')}`;
    if (ids.has(st.name)) throw new Error(`${t.key}: duplicate step ${st.name}`);
    ids.set(st.name, id);
    rows.push(row(id, t.category, tid(t.key), st.name, i + 1, st.rule, [], false));
    const after = st.after === undefined ? (i > 0 ? t.steps[i - 1]!.name : null) : st.after;
    if (after !== null) {
      const dep = ids.get(after);
      if (!dep) throw new Error(`${t.key}: step "${st.name}" waits for unknown or later step "${after}"`);
      deps.push([id, dep]);
    }
  });
}

function row(id: string, category: string, parentId: string | null, name: string, sort: number, r: Rule, match: string[], autoAdd: boolean): string {
  return `  (${[q(id), q(category), q(parentId), q(name), sort, q(r.mode), r.days, q(r.perQty), q(r.unit), r.minDays, q(JSON.stringify(match)), autoAdd ? 1 : 0, q(AT), q(AT)].join(', ')})`;
}

const sql = `-- 0005_task_list_seed: the starting Task Lists (generated by scripts/gen-task-list-seed.ts — edit there, regenerate
-- only before shipping). Drafted from the products BOQ Maker quotes and typical durations in working days; every
-- entry is editable on the Task Lists page. Append-only: never edit after shipping; later changes are made in the app.

-- Replace the untouched starter catalogue of 0003 (tasks that used it keep their titles; their link becomes NULL).
DELETE FROM catalog_items WHERE id LIKE 'cat-%';

INSERT INTO catalog_items (id, category, parent_id, name, sort_order, duration_mode, duration_days, per_qty, rate_unit, min_days, boq_match, auto_add, created_at, updated_at) VALUES
${rows.join(',\n')};

-- Dependencies (finish → start), set after every row exists.
${deps.map(([id, dep]) => `UPDATE catalog_items SET depends_on_id = ${q(dep)} WHERE id = ${q(id)};`).join('\n')}
`;

const out = path.join(import.meta.dirname, '..', 'migrations', '0005_task_list_seed.sql');
writeFileSync(out, sql);
console.log(`Wrote ${out}: ${T.length} tasks, ${rows.length - T.length} sub-tasks, ${deps.length} dependencies`);
