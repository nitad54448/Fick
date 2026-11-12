const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../diffusion_main_5_4.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const engine = scripts.find(s => s.includes('function calculateDiffusionMap'));
assert(engine);
function inputs(seconds = 81) {
  // Constant D and 1 um spacing give the independent CFL bound dt <= 0.4 s.
  return {temp:1000,timeHours:seconds/3600,totalLength:2,sourceLength:0.5,N:3,
    targetD0:1e-12,targetQ:0,targetName:'Matrix',maxConc:100,blockingEnabled:false,
    elements:[{name:'Reference',d0:1e-12,q:0,beta:0,c0:25,color:'#123456'}]};
}
function harness() {
  const nodes = new Map(), plots = [], purged = [], downloads = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id,{style:{display:'none'},textContent:'',disabled:false,getContext:()=>({})});
    return nodes.get(id);
  };
  const context = {
    console:{error:()=>{}}, Blob,
    Chart: class { static register() {} destroy() {} },
    Plotly:{newPlot:(id,traces)=>plots.push({id,traces}),purge:id=>purged.push(id),Plots:{resize:()=>{}}},
    document:{getElementById:node,createElement:()=>({click(){downloads.push(this);}})},
    window:{URL:{createObjectURL:blob=>{context.blob=blob;return 'blob:test';},revokeObjectURL:()=>{}},addEventListener:()=>{}},
    setTimeout:fn=>{fn();return 1;},clearTimeout:()=>{},
  };
  vm.createContext(context);
  vm.runInContext(engine,context);
  return {context,node,plots,purged,downloads,run:(p,mode='snapshot',temp=null,time=null)=>context.calculateDiffusionMap(p,mode,temp,time)};
}
test('oversized runs are refused instead of returning the first two million steps', () => {
  const h = harness();
  // 800000.4 s needs 2000001 stable steps; no simulation loop is needed to refuse it.
  assert.throws(()=>h.run(inputs(800000.4)),/Cannot reach.*simulation limit/);
});
test('a run at the exact two-million-step budget still completes the requested duration', {timeout:30000}, () => {
  const h = harness(), r = h.run(inputs(800000));
  assert.equal(r.steps,2000000);
  assert.equal(r.actualTimeHours,r.requestedTimeHours);
});
test('an accepted nonintegral step count reaches the end without overshooting the CFL bound', () => {
  const r = harness().run(inputs());
  assert.equal(r.steps,203); // ceil(81 / 0.4)
  assert.equal(r.actualTimeHours,81/3600);
  assert(r.actualTimeHours*3600/r.steps <= 0.4);
  assert(r.elements[0].C.every(Number.isFinite));
});
test('history contains actual monotonic timestamps, aligned with snapshots and one final frame', () => {
  const r = harness().run(inputs(),'history');
  const times = Array.from(r.historyTimesHours);
  assert.equal(times[0],0);
  assert.equal(times.at(-1),81/3600);
  assert.equal(times.length,r.elements[0].history.length);
  assert(times.every((t,i)=>!i || t>times[i-1]));
  // First sample is step 9, not a uniformly relabelled 1/25 of the requested duration.
  assert.equal(times[1],(9*81/203)/3600);
  assert.equal(times.filter(t=>t===81/3600).length,1);
});
test('override duration is honored and invalid times cannot bypass the budget check', () => {
  const h = harness();
  const r = h.run(inputs(800000.4),'snapshot',null,81/3600);
  assert.equal(r.actualTimeHours,81/3600);
  for (const bad of [0,-1,NaN,Infinity]) {
    assert.throws(()=>h.run(inputs(),'snapshot',null,bad),/finite positive/);
  }
  assert.throws(()=>h.run(inputs(),'snapshot',null,1e300),/simulation limit|finite positive/);
});
test('non-finite diffusion parameters cannot silently yield a result', () => {
  const h=harness();
  for(const bad of [NaN,Infinity]) {
    const p=inputs(); p.elements[0].beta=bad;
    assert.throws(()=>h.run(p),/finite positive/);
  }
  const p=inputs(); p.elements[0].beta=1000;
  assert.throws(()=>h.run(p),/finite numerical range/);
});
test('the time-history renderer uses recorded snapshot times', () => {
  const h=harness(), p=inputs();
  const expected=Array.from(h.run(p,'history').historyTimesHours);
  h.context.render3DTime(p);
  assert.deepEqual(Array.from(h.plots[0].traces[0].y),expected);
});
test('an oversized visualization shows an error, clears stale plots, and releases the loading overlay', () => {
  const h=harness(); h.context.validateInputs=()=>inputs(800000.4);
  let destroyed=0;
  h.context.oldChart={destroy:()=>destroyed++};
  vm.runInContext('chartInstance=oldChart;diffChartInstance=oldChart;',h.context);
  h.context.triggerCalculation();
  assert.match(h.node('simulation-status').textContent,/No partial result/);
  assert.equal(h.node('simulation-status').style.display,'block');
  assert.equal(h.node('loading-overlay').style.display,'none');
  assert.equal(destroyed,2);
  assert.deepEqual(h.purged,['plotly-time','plotly-temp']);
});
test('an oversized export shows the error and creates no download', async () => {
  const h=harness(); h.context.validateInputs=()=>inputs(800000.4);
  await h.context.saveData();
  assert.equal(h.downloads.length,0);
  assert.equal(h.context.blob,undefined);
  assert.match(h.node('simulation-status').textContent,/Cannot reach/);
  assert.equal(h.node('saveBtn').disabled,false);
});
test('a successful export records requested and actual time and the bumped legacy version', async () => {
  const h=harness();h.context.validateInputs=()=>inputs();
  await h.context.saveData();
  assert.equal(h.downloads.length,1);
  assert.equal(h.downloads[0].download,'DiffusionData_v5.4.1.txt');
  const text=await h.context.blob.text();
  assert.match(text,/CATION DIFFUSION SIM v5\.4\.1/);
  assert(text.includes('Requested Time(h): '+81/3600+', Actual Time(h): '+81/3600));
  assert.match(text,/Completed Steps: 203/);
});
test('all inline scripts parse and package versions agree', () => {
  scripts.forEach(s=>new vm.Script(s));
  for (const label of ['\u00b5m', 'D\u2080', 'm\u00b2/s', '\u03b2 (Interact)']) {
    assert(html.includes(label));
  }
  assert(!html.includes('\u00c3'));
  const pkg=require('../package.json'),lock=require('../package-lock.json');
  assert.equal(pkg.version,'1.0.1');
  assert.equal(lock.version,pkg.version);
  assert.equal(lock.packages[''].version,pkg.version);
  assert.match(html,/<title>.*v5\.4\.1/);
});
