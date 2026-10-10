// Verifies the waste-removal fixes:
//   1) Digger hire is billed in flat 5-day blocks (not per individual day)
//   2) Digger hire's £300 is treated as already net (Inc. VAT unticked by default)
//   3) Clearance labour uses the crew's day rate, with its day-count driven by a
//      70 m²/day PRODUCTIVITY rate (Settings > Pricing), same pattern as digger (/50) and
//      grab (/35) — NOT a flat £/day rate.
//   4) Each of the three productivity rates can be overridden per job via calcWasteRemoval's
//      third (opts) argument, and the actually-used values round-trip through .options.
const { ru, sum, ctxFor, calcWasteRemoval, WASTE_ELIGIBLE } = require('/tmp/mobiletest/engine_extract3.js');

const settings = require('/tmp/mobiletest/real_settings.json');
// Make sure the settings blob has the new productivity keys (defaultSettings()/loadAll()'s
// migration would normally do this on load) so ctxFor's fallbacks aren't the only thing tested.
settings.productivity = settings.productivity || {};
if (settings.productivity.wasteDigger == null) settings.productivity.wasteDigger = 50;
if (settings.productivity.wasteGrab == null) settings.productivity.wasteGrab = 35;
if (settings.productivity.wasteLabour == null) settings.productivity.wasteLabour = 70;

function approxEqual(a,b,eps=0.01){ return Math.abs(a-b)<eps; }

// Reproduce the live draft: Rayner job, waste-eligible combined area 207.76 m², 3 people on site.
const ctx = ctxFor(settings, 3);
const sections = [
  {key:'paving', area: 4*10 + 4*8 + 3*3.6 + 1.2*3.5 + 1*27},
  {key:'turf', area: 4*8.8 + 6*8},
  {key:'concretebase', area: 0},
  {key:'gravel', area: 8.8*1.2},
];
const combined = sum(sections.map(s=>s.area));
console.log('combined area (expect 207.76):', combined.toFixed(2));

const waste = calcWasteRemoval(sections, ctx);
const digger = waste.plant.find(p=>p.item==='Digger hire');
const grab = waste.plant.find(p=>p.item==='Grab hire');

const diggerDays = ru(combined/50); // 5
const expectedDiggerBlocks = ru(diggerDays/5); // ceil(5/5) = 1
console.log('digger days needed (expect 5):', diggerDays);
console.log('digger hire billed as blocks, not days (expect qty 1, not 5):', digger.qty);
console.log('digger hire rate is net £300, no VAT stripped out (expect 300):', digger.rate);
console.log('digger hire cost = 1 block x £300 (expect 300):', digger.cost);

console.log('grab hire unchanged: still per-day (expect qty 6, rate £300 net = 360/1.2):', grab.qty, grab.rate);

// Clearance labour: 207.76 / 70 productivity = 3 days (ROUNDUP), charged at the 3-person crew's
// day rate (£450/day), NOT a flat £/day rate.
const labourDays = ru(combined/70); // 3
const crewDayRate = 3 * settings.dayRatePerPerson; // 3 people x £150
console.log('clearance labour days (expect 3, i.e. ROUNDUP(207.76/70)):', waste.days);
console.log('clearance labour uses the crew day rate, not a flat rate (expect', 3*crewDayRate, '):', waste.labourCost);
console.log('  (3 days x £' + crewDayRate + '/day crew rate = £' + (3*crewDayRate) + ')');

// Options round-trip: the productivities actually used come back in .options, so editing a
// saved quote restores them correctly.
console.log('returned options reflect the defaults used (50/35/70):', waste.options);

// Per-job override: pass opts overriding just the labour productivity.
const overridden = calcWasteRemoval(sections, ctx, {labourProductivity: 50});
console.log('\nwith a per-job override of labourProductivity=50:');
console.log('  labour days (expect ROUNDUP(207.76/50)=5):', overridden.days);
console.log('  digger/grab untouched by the labour override (still 1 block / 6 days):',
  overridden.plant.find(p=>p.item==='Digger hire').qty, overridden.plant.find(p=>p.item==='Grab hire').qty);
console.log('  returned options reflect the override:', overridden.options);

// sanity: a bigger job needing 6 digger-days should need 2 hire blocks, not 6
const bigSection = [{key:'paving', area: 260}]; // 260/50 = 5.2 -> ru = 6 digger-days
const bigWaste = calcWasteRemoval(bigSection, ctxFor(settings, 2));
const bigDigger = bigWaste.plant.find(p=>p.item==='Digger hire');
console.log('\n260m2 job needs 6 digger-days -> 2 hire blocks (expect qty 2, cost 600):', bigDigger.qty, bigDigger.cost);

console.log('\nAll good:',
  digger.qty===expectedDiggerBlocks && digger.rate===300 && digger.cost===300 &&
  waste.days===labourDays && approxEqual(waste.labourCost, labourDays*crewDayRate) &&
  overridden.days===5 && overridden.options.labourProductivity===50 &&
  overridden.options.diggerProductivity===50 && overridden.options.grabProductivity===35 &&
  bigDigger.qty===2 && bigDigger.cost===600
);
