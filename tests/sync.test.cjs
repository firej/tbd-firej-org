const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/app.js', 'utf8');
function app(storage = {}) {
  const localStorage = new Proxy(storage, {get(o,k) {
    if(k==='getItem') return key => o[key] ?? null;
    if(k==='setItem') return (key,value) => {o[key]=value};
    return o[k];
  }});
  const ctx = {localStorage, navigator:{onLine:true}, document:{documentElement:{},addEventListener(){}},
    crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout};
  vm.createContext(ctx);
  const expose = `globalThis.app = {flushPending, sendAction, createTask, patchTask, recoverTemporaryTasks,
    setAPI(fn) {api=fn}, setBoard(id) {currentBoardId=id; tasks=loadCache(id)},
    pending() {return pending}, tasks() {return tasks}};
    setSyncState=()=>{}; renderAll=()=>{}; initSortable=()=>{}; pullAll=async()=>{};`;
  vm.runInContext(source.replace("  document.addEventListener('DOMContentLoaded', boot);",expose),ctx);
  return {a:ctx.app,ctx,storage};
}
test('failed requests remain durable and FIFO; concurrent drains send once', async()=>{
  const {a,storage}=app();
  a.setAPI(async()=>{throw Error('offline')});
  await a.sendAction({method:'PATCH',path:'/a',body:{title:'old'}});
  await a.sendAction({method:'PATCH',path:'/a',body:{title:'new'}});
  assert.deepEqual(JSON.parse(storage['tbd.pending.v1']).map(x=>x.body.title),['old','new']);
  const restarted=app(storage).a;
  let release; const gate=new Promise(r=>release=r); const sent=[];
  restarted.setAPI(async(p,o)=>{sent.push(JSON.parse(o.body).title); await gate});
  const one=restarted.flushPending(), two=restarted.flushPending();
  assert.equal(JSON.parse(storage['tbd.pending.v1']).length,2);
  release(); await Promise.all([one,two]);
  assert.deepEqual(sent,['old','new']);
  assert.equal(restarted.pending().length,0);
});
test('offline creation and later edit retain ID and original board',async()=>{
  const {a,ctx}=app(); ctx.navigator.onLine=false; a.setBoard('A');
  await a.createTask({title:'first',color:'indigo',size:'s'},false);
  const id=a.tasks()[0].id;
  await a.patchTask(id,{title:'second'});
  a.setBoard('B'); ctx.navigator.onLine=true;
  const sent=[]; a.setAPI(async(p,o)=>sent.push([p,JSON.parse(o.body)]));
  await a.flushPending();
  assert.equal(sent[0][0],'/api/boards/A/tasks');
  assert.equal(sent[0][1].id,id);
  assert.equal(sent[1][0],'/api/boards/A/tasks/'+id);
  assert.equal(sent[1][1].title,'second');
});
test('legacy temporary cards recover once, including their local edits',()=>{
  const id='5f5c7df1-aeaa-420e-aed8-32f7bc812419';
  const {a}=app({'tbd.tasks.v1.A':JSON.stringify([{id:'tmp_'+id,title:'saved',done:true}])});
  a.recoverTemporaryTasks(); a.recoverTemporaryTasks();
  assert.equal(a.pending().length,2);
  assert.equal(a.pending()[0].body.id,id);
  assert.equal(a.pending()[1].body.done,true);
});
test('JSON 404 is skipped, then subsequent writes are sent',async()=>{
  const {a,ctx}=app();ctx.navigator.onLine=false;
  await a.sendAction({method:'PATCH',path:'/missing'});
  await a.sendAction({method:'PATCH',path:'/exists'});
  ctx.navigator.onLine=true;const sent=[];
  a.setAPI(async p=>{sent.push(p);if(p==='/missing')throw Object.assign(Error('task not found'),{status:404})});
  await a.flushPending();assert.deepEqual(sent,['/missing','/exists']);assert.equal(a.pending().length,0);
});
