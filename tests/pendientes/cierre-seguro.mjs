// Cerrar y deshacer debe conservar el tablero completo, incluso los hitos y enlaces.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
function extract(name){
 let start=html.indexOf(`function ${name}(`);assert.notEqual(start,-1);
 if(html.slice(start-6,start)==='async ')start-=6;
 let i=html.indexOf('{',start),depth=0;
 for(;i<html.length;i++){if(html[i]==='{')depth++;else if(html[i]==='}'&&--depth===0)break;}
 return html.slice(start,i+1);
}
const original=['Nexus','Jorge Luis','2026-11-25','En proceso','Alta','2026-11-21','nexus-id','2026-11-01T00:00:00Z',null,[{id:'internal',title:'Preparar lanzamiento',status:'Pendiente',links:[{id:'doc',url:'https://example.com'}],checklist:[{id:'step',title:'Validar',done:true}]}],'#2563eb',2,null,123,'proyectos',{id:'list-1',title:'Lanzamientos'}];
const clone=x=>JSON.parse(JSON.stringify(x));
function setup(){
 const tombstones={},alerts=[],saves=[],queries=[];let serial=0;
 const c={console,Set,Date,JSON,Array,Number,String,Boolean,Math,
 tasks:[clone(original)],completedTasks:[],closingTaskIds:new Set(),restoringTaskKeys:new Set(),lastClosedTaskKey:'',collapsedSubtaskIds:new Set(),
 taskTimer:{elapsedById:{'nexus-id':47},durationById:{},presetById:{},dailyById:{'nexus-id':{'2026-11-21':{jorge:47}}}},
 editingState:{},state:{},TASK_UPDATED_AT_INDEX:13,TASK_MANUAL_ORDER_INDEX:11,SHARED_PENDING_BACKUP_TABLE:'lr_suite_pending_backups',SHARED_PENDING_APP_ID:'lr-suite-pending',
 window:{confirm:()=>false,alert:m=>alerts.push(m)},
 findPendingTaskById:id=>({task:c.tasks.find(t=>t[6]===id)}),pendingSubtasks:t=>t[9]||[],normalizeText:x=>String(x).toLowerCase(),taskId:t=>t[6],
 activeTimerEntry:()=>null,currentSuiteUserName:()=> 'Jorge Luis',suitePersonKey:x=>x,elapsedSecondsForTask:id=>c.taskTimer.elapsedById[id]||0,
 generatedTaskId:()=>`new-${++serial}`,taskCreatedAt:t=>t[7],subtasksDoneByUserMap:()=>({}),taskTombstones:()=>tombstones,
 mergeCompletedTaskHistory:(...lists)=>lists.flat(),saveTimerState:()=>{},saveTaskState:x=>saves.push(x),tasksModule:()=>{},archiveCompletedTask:async()=>true,
 completedTaskKey:r=>r.completedRecordId,tumbaDeCompletada:r=>`completed:${r.completedRecordId}`,nextTaskStamp:()=>999,topTaskManualOrder:()=>0,
 localMonthKey:x=>String(x).slice(0,7),refreshPendingSurfaces:()=>{},ensureSharedPendingConnection:async()=>true,
 sharedPendingClient:{from(table){queries.push(['from',table]);return this;},select(x){queries.push(['select',x]);return this;},eq(...a){queries.push(['eq',...a]);return this;},contains(...a){queries.push(['contains',...a]);return this;},lte(...a){queries.push(['lte',...a]);return this;},order(...a){queries.push(['order',...a]);return this;},async limit(n){queries.push(['limit',n]);return {data:[{tasks:[clone(original)]}],error:null};}}
 };
 vm.createContext(c);vm.runInContext(['confirmPendingTaskClose','completeTask','deleteTask','moveTaskToCompleted','completedTaskSnapshot','restoreCompletedTask'].map(extract).join('\n'),c);
 return {c,alerts,saves,queries};
}
let {c,alerts,saves}=setup();
assert.equal(c.completeTask('nexus-id'),false);assert.deepEqual(clone(c.tasks),[original]);assert.equal(saves.length,0);assert.equal(c.taskTimer.elapsedById['nexus-id'],47);
c.window.confirm=message=>{assert.match(message,/Nexus/);assert.match(message,/1 tareas internas \(1 sin completar\)/);return true;};
assert.equal(c.completeTask('nexus-id'),true);assert.equal(c.tasks.length,0);assert.equal(c.completedTasks.length,1);
const record=c.completedTasks[0];assert.deepEqual(clone(record.taskSnapshot),original);assert.equal(record.totalSeconds,47);
const key=record.completedRecordId;
await Promise.all([c.restoreCompletedTask(key),c.restoreCompletedTask(key)]);
assert.equal(c.tasks.length,1,'double restore does not duplicate');assert.equal(c.completedTasks.length,0);
assert.deepEqual(clone(c.tasks[0][9]),original[9]);assert.deepEqual(clone(c.tasks[0][15]),original[15]);assert.equal(c.tasks[0][14],'proyectos');
assert.notEqual(c.tasks[0][6],original[6]);assert.equal(c.tasks[0][3],'Pendiente');assert.equal(c.taskTimer.elapsedById[c.tasks[0][6]],47);
assert.deepEqual(clone(c.taskTimer.dailyById[c.tasks[0][6]]),{'2026-11-21':{jorge:47}});assert.equal(c.taskTombstones()[`completed:${key}`].action,'regresada');assert.deepEqual(clone(record.taskSnapshot),original,'restore must not mutate the archive');
let ctx=setup();c=ctx.c;c.tasks=[];c.completedTasks=[{id:'nexus-id',title:'Nexus',completedRecordId:'old',completedAt:'2026-11-21T15:00:00Z'}];
await c.restoreCompletedTask('old');assert.deepEqual(clone(c.tasks[0][9]),original[9]);assert(ctx.queries.some(x=>x[0]==='contains'&&JSON.stringify(x[2])==='[["nexus-id"]]'));
assert(ctx.queries.some(x=>x[0]==='lte'&&x[1]==='created_at'&&x[2]==='2026-11-21T15:00:00Z'));
ctx=setup();c=ctx.c;c.tasks=[];c.completedTasks=[{id:'missing',title:'Nexus',completedRecordId:'old',completedAt:'2026-11-21T15:00:00Z'}];
assert.equal(await c.restoreCompletedTask('old'),false);assert.equal(c.tasks.length,0);assert.equal(c.completedTasks.length,1);assert.equal(ctx.saves.length,0);assert.match(ctx.alerts[0],/no se restauró una copia vacía/);
ctx=setup();c=ctx.c;assert.equal(c.deleteTask('nexus-id'),false);assert.equal(c.tasks.length,1);
c.window.confirm=()=>true;c.deleteTask('nexus-id');assert.equal(c.completedTasks[0].action,'eliminada');assert.deepEqual(clone(c.completedTasks[0].taskSnapshot),original);
assert.match(extract('openTaskBadgeSelect'),/completeTask\(idDeLaTarea\)/);
console.log('PASS cierre seguro: cancelar, confirmar, snapshot completo, deshacer sin duplicados, recuperación antigua por id y fallo sin pérdida.');

// A stale Undo notice must explain a remote restore instead of failing silently.
ctx=setup();c=ctx.c;c.lastClosedTaskKey='missing';
assert.equal(await c.restoreCompletedTask('missing'),false);
assert.equal(c.lastClosedTaskKey,'');assert.match(c.pendingTaskFeedback,/ya no está en el historial/);

// The module handles history/undo before closing list menus and redrawing buttons.
class ClickTarget {
  constructor(button,selector){this.button=button;this.selector=selector;}
  closest(selector){return selector===this.selector?this.button:null;}
}
const actions=[];
const clicks={Element:ClickTarget,openPendingListMenuId:'open-list',
 document:{querySelectorAll:()=>[{remove:()=>actions.push('menu-removed')}]},
 openCompletedTaskHistory:()=>actions.push('history'),
 restorePendingTaskFromButton:(button,key)=>actions.push(`undo:${key}`)};
vm.createContext(clicks);vm.runInContext(extract('handleTaskModuleClick'),clicks);
for(const [selector,button,expected] of [
 ['[data-open-completed-history]',{},'history'],
 ['[data-undo-completed-task]',{dataset:{undoCompletedTask:'archived-id'}},'undo:archived-id']
]){
 actions.length=0;clicks.openPendingListMenuId='open-list';
 const stopped=[];
 clicks.handleTaskModuleClick({target:new ClickTarget(button,selector),preventDefault:()=>stopped.push('default'),stopPropagation:()=>stopped.push('bubble'),stopImmediatePropagation:()=>stopped.push('immediate')});
 assert.equal(clicks.openPendingListMenuId,'');assert.deepEqual(actions,['menu-removed',expected]);
 assert.deepEqual(stopped,['default','bubble','immediate']);
}
console.log('PASS avisos: acciones delegadas antes del redibujo y respuesta explícita para Deshacer obsoleto.');
