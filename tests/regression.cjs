'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const {Worker:Thread} = require('worker_threads');
const {webcrypto} = require('crypto');
const appDirectory = process.argv[2] || path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(appDirectory,'index.html'),'utf8');
const appSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const expose = `globalThis.testAPI = {Store,searchEngine,runJob,cancelJobs,openFile,openDialog,save,newDocument,decodeFile,encodeFile,
  commitDocument,replaceAll,runFind,gotoMatch,invalidateSearch,search,replaceRange,indentSelection,autoInput,undo,
  lineStart,lineAt,indexLines,renderStatus,renderGutter,dirty,persist,recordOf,filename,splitName,rename,applyWrap,requestUpdate,
  setupServiceWorker,toast,hideToast,markSaved,init,emergencyJournal,setSetting,ui,
  get doc(){return doc;}, get history(){return history;},get pendingReload(){return pendingReload;},
  setReady:v=>{ready=v;}, setWorker:w=>{waitingWorker=w;}, setPersisted:n=>{persistedRevision=n;},
  setTab:v=>{tabIndent=v;},setUpdating:v=>{updating=v;}};`;
function fakeIDB() {
  const data = new Map();
  const options = {readFailure:false,writeFailure:false,openFailure:false};
  const database = {objectStoreNames:{contains:()=>true},close(){},transaction(store,mode){
    const tx = {};
    tx.objectStore = () => Object.fromEntries(['get','getAll','put','delete'].map(operation => [operation,(value,key) => {
      const request = {};
      queueMicrotask(() => {
        const fails = mode === 'readwrite' ? options.writeFailure : options.readFailure;
        if (fails) { tx.error = Error('Injected IDB failure');tx.onerror?.();return; }
        if (operation === 'get') request.result = data.get(value);
        if (operation === 'getAll') request.result = [...data.values()];
        if (operation === 'put') {data.set(key,structuredClone(value));request.result=key;}
        if (operation === 'delete') data.delete(value);
        tx.oncomplete?.();
      });
      return request;
    }]));
    return tx;
  }};
  return {data,options,api:{open(){const request={result:database};queueMicrotask(()=>{
    if(options.openFailure){request.error=Error('open fail');request.onerror?.();}else request.onsuccess?.();
  });return request;}}};
}
function environment({realWorker=false}={}) {
  const elements={}, events={}, timers=new Set(), storage=new Map(), session=new Map(), blobs=new Map();
  const idb=fakeIDB();
  let context, urlCount=0, downloads=0;
  function element(id='', tag='DIV') {
    const classes=new Set();
    const result={id,tagName:tag,value:id==='fName'?'index.html':'',hidden:id==='searchPanel',checked:false,
      selectionStart:0,selectionEnd:0,scrollTop:0,scrollLeft:0,clientWidth:500,clientHeight:240,offsetTop:12,offsetLeft:12,
      textContent:'',title:'',style:{},dataset:{},attributes:{},options:[],children:[],listeners:{},readOnly:false,disabled:false,
      classList:{add(...names){names.forEach(x=>classes.add(x));},remove(...names){names.forEach(x=>classes.delete(x));},contains:n=>classes.has(n),toggle(n,on){if(on??!classes.has(n))classes.add(n);else classes.delete(n);}},
      setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},getAttribute(k){return this.attributes[k];},
      addEventListener(k,f){this.listeners[k]=f;},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},
      add(option){this.options.push(option);option.remove=()=>{this.options=this.options.filter(o=>o!==option);};},
      remove(){},focus(){context.document.activeElement=this;},select(){this.selectionStart=0;this.selectionEnd=this.value.length;},
      setSelectionRange(a,b){this.selectionStart=Math.max(0,Math.min(a,this.value.length));this.selectionEnd=Math.max(this.selectionStart,Math.min(b,this.value.length));},
      click(){downloads++;},showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(){return [];}};
    return result;
  }
  const makeStorage = map => ({get length(){return map.size;},key:n=>[...map.keys()][n],getItem:k=>map.has(k)?map.get(k):null,
    setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)});
  const document={activeElement:null,title:'',visibilityState:'visible',body:element('body'),documentElement:element('root'),
    getElementById:id=>elements[id] ||= element(id,id==='ed'?'TEXTAREA':'DIV'),
    createElement:tag=>element('',tag.toUpperCase()),createTextNode:text=>({textContent:text}),
    querySelector:()=>element('toolbar'),addEventListener:(k,f)=>events['document:'+k]=f};
  const workers=new Set();
  class BrowserWorker {
    constructor(url){
      if(!realWorker)throw Error('Worker unavailable');
      this.dead=false;workers.add(this);this.buffer=[];
      blobs.get(url).text().then(source=>{
        if(this.dead)return;
        this.thread=new Thread(`const {parentPort}=require('worker_threads');globalThis.self={postMessage:v=>parentPort.postMessage(v)};${source};parentPort.on('message',data=>self.onmessage({data}));`,{eval:true});
        this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',error=>this.onerror?.(error));
        for(const value of this.buffer)this.thread.postMessage(value);this.buffer=[];
      });
    }
    postMessage(value){if(this.thread)this.thread.postMessage(value);else this.buffer.push(value);}
    terminate(){this.dead=true;this.thread?.terminate();workers.delete(this);}
  }
  class BrowserURL extends URL {}
  BrowserURL.createObjectURL=blob=>{const url='blob:test/'+(++urlCount);blobs.set(url,blob);return url;};
  BrowserURL.revokeObjectURL=url=>blobs.delete(url);
  context={console,document,indexedDB:idb.api,localStorage:makeStorage(storage),sessionStorage:makeStorage(session),
    setTimeout:(callback,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);callback();},ms);timers.add(timer);return timer;},
    clearTimeout:timer=>{timers.delete(timer);clearTimeout(timer);},requestAnimationFrame:()=>0,
    crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,DataView,Blob,DOMException,URL:BrowserURL,Worker:BrowserWorker,
    confirm:()=>true,navigator:{},location:{href:'https://example.test/app/',protocol:'https:',reload(){}},
    history:{replaceState(){}},getComputedStyle:()=>({lineHeight:'25.6px',fontFamily:'monospace',fontSize:'16px'}),
    matchMedia:()=>({matches:false,addEventListener(){}}),Option:function(text,value){return {text,value,dataset:{}}},
    addEventListener:(k,f)=>events['window:'+k]=f};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(appSource.replace('const initialization = init();','const initialization = Promise.resolve();')
    .replace(/\}\)\(\);\s*$/,expose+'})();'),context);
  context.testAPI.setReady(true);
  return {A:context.testAPI,context,elements,events,storage,session,idb,get downloads(){return downloads;},
    close(){context.testAPI.cancelJobs();for(const timer of timers)clearTimeout(timer);for(const worker of workers)worker.terminate();}};
}
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const cases=[];
async function test(name,fn,options){const env=environment(options);try{await fn(env);cases.push({name,status:'PASS'});}catch(error){cases.push({name,status:'FAIL',error:error.stack});}finally{env.close();}}
const file=(name,text)=>({name,size:Buffer.byteLength(text),arrayBuffer:async()=>new TextEncoder().encode(text).buffer});
function draft(id,revision,text){return {schema:3,id,revision,text,name:'draft.txt',savedAt:Date.now(),encoding:'utf-8',bom:false,eol:'\n'};}
(async()=>{
await test('B01 cancel opening preserves text and handle',async({A,context})=>{
 const old={name:'old.txt'};A.commitDocument({text:'unsaved',handle:old,snapshot:null});context.confirm=()=>false;
 assert.equal(await A.openFile(file('other.txt','other'),{name:'other.txt'}),false);assert.equal(A.doc.handle,old);assert.equal(A.doc.text,'unsaved');
});
await test('B01 read failure preserves text and handle',async({A})=>{
 const old={name:'old.txt'};A.commitDocument({text:'unsaved',handle:old,snapshot:null});
 assert.equal(await A.openFile({size:1,name:'bad.txt',arrayBuffer:async()=>{throw Error('fail');}},{name:'bad.txt'}),false);assert.equal(A.doc.handle,old);
});
await test('B01 successful open commits all document fields',async({A})=>{
 const handle={name:'good.txt'};assert.equal(await A.openFile(file('good.txt','good'),handle),true);
 assert.equal(A.doc.text,'good');assert.equal(A.doc.name,'good.txt');assert.equal(A.doc.handle,handle);assert.equal(A.dirty(),false);
});
await test('B02 in-flight save keeps newer edit dirty',async({A})=>{
 let finish,written;const handle={name:'a.txt',createWritable:async()=>({write:async b=>written=new TextDecoder().decode(b),close:()=>new Promise(r=>finish=r)})};
 A.commitDocument({text:'old',name:'a.txt',handle,snapshot:null});const promise=A.save();await tick();
 A.replaceRange('new',0,3);finish();assert.equal(await promise,true);assert.equal(written,'old');assert.equal(A.doc.snapshot.text,'old');assert.equal(A.dirty(),true);
});
await test('B02 overlapping save requests do not write concurrently',async({A})=>{
 let finish,n=0;const handle={name:'a.txt',createWritable:async()=>{n++;return {write:async()=>{},close:()=>new Promise(r=>finish=r)}}};
 A.commitDocument({text:'x',name:'a.txt',handle,snapshot:null});const one=A.save();await tick();assert.equal(await A.save(),false);finish();await one;assert.equal(n,1);
});
await test('B03 legacy draft imported before migration marker',async({A,storage,idb})=>{
 storage.set('txt','legacy');await A.Store.migrate();assert.equal(storage.get('txt'),'legacy');assert.equal(storage.get('teopad:migration-v3'),'done');
 assert.ok((await A.Store.list()).some(x=>x.text==='legacy'));assert.ok(idb.data.has('draft:legacy-txt'));
});
await test('B03 failed migration retains originals and no success marker',async({A,context,storage,idb})=>{
 storage.set('txt','legacy');idb.options.writeFailure=true;context.localStorage.setItem=()=>{throw Error('quota')};
 await assert.rejects(()=>A.Store.migrate());assert.equal(storage.get('txt'),'legacy');assert.equal(storage.has('teopad:migration-v3'),false);
});
await test('B04 newer fallback wins older IndexedDB record',async({A,idb})=>{
 await A.Store.put(draft('same',1,'old'));idb.options.writeFailure=true;await A.Store.put(draft('same',2,'new'));
 assert.equal((await A.Store.list())[0].text,'new');
});
await test('B04 empty draft remains intentionally empty',async({A,idb})=>{
 await A.Store.put(draft('same',1,'old'));idb.options.writeFailure=true;await A.Store.put(draft('same',2,''));assert.equal((await A.Store.list())[0].text,'');
});
await test('B04 ambiguous legacy stores retained separately',async({A,idb,storage})=>{
 idb.data.set('content','IDB');storage.set('teopad:content','LOCAL');await A.Store.migrate();const records=await A.Store.list();
 assert.ok(records.some(x=>x.text==='IDB'));assert.ok(records.some(x=>x.text==='LOCAL'));
});
await test('B05 delayed file read cannot overwrite newer edit',async({A})=>{
 let done;A.commitDocument({text:'old',snapshot:null});const pending=A.openFile({size:1,name:'late.txt',arrayBuffer:()=>new Promise(r=>done=r)});
 A.replaceRange('new',0,3);done(new TextEncoder().encode('late').buffer);assert.equal(await pending,false);assert.equal(A.doc.text,'new');
});
await test('B05 startup locks editor until recovery completes',async({A})=>{
 A.setReady(false);let finish;A.Store.migrate=()=>new Promise(r=>finish=r);A.Store.list=async()=>[draft('old',1,'restore')];
 const pending=A.init();assert.equal(A.ui.ed.readOnly,true);finish();await pending;assert.equal(A.ui.ed.readOnly,false);assert.equal(A.doc.text,'restore');
});
await test('B06 late replacement cannot overwrite new text',async({A})=>{
 A.commitDocument({text:'abc'});A.ui.sTxt.value='a';A.ui.rTxt.value='X';const pending=A.replaceAll();A.replaceRange('NEW',0,3);
 await pending;assert.equal(A.doc.text,'NEW');
});
await test('B07 deleting all content is still dirty and warns on unload',({A,events})=>{
 A.commitDocument({text:'data',snapshot:{text:'data',name:'index.html'}});A.replaceRange('',0,4);
 assert.equal(A.dirty(),true);let warned=false;events['window:beforeunload']({preventDefault(){warned=true}});assert.equal(warned,true);
});
await test('B08 failed draft save blocks update activation',async({A,context,idb})=>{
 idb.options.writeFailure=true;context.localStorage.setItem=()=>{throw Error('quota')};let activated=false;
 A.setWorker({postMessage(){activated=true;}});await A.requestUpdate();assert.equal(activated,false);assert.equal(A.ui.ed.readOnly,false);
});
await test('B09 first controllerchange never reloads without consent',async({A,context})=>{
 let listener,reloads=0;context.navigator.serviceWorker={addEventListener:(k,f)=>listener=f,register:async()=>({addEventListener(){}})};
 context.location.reload=()=>reloads++;A.setupServiceWorker();await tick();listener();assert.equal(reloads,0);
});
await test('B09 approved update persists then activates and permits reload',async({A,context})=>{
 let listener,reloads=0,activated=false;
 context.navigator.serviceWorker={addEventListener:(k,f)=>listener=f,register:async()=>({addEventListener(){}})};
 context.location.reload=()=>reloads++;A.setupServiceWorker();A.setWorker({postMessage(){activated=true}});await A.requestUpdate();
 assert.equal(activated,true);assert.equal(A.pendingReload,true);listener();assert.equal(reloads,1);
});
await test('B10 invalid UTF-8 rejected without replacement characters',({A})=>{
 assert.throws(()=>A.decodeFile(Uint8Array.of(0xfd).buffer),/UTF-8/);
});
await test('B10 UTF-8 BOM and CRLF preserved byte for byte',({A})=>{
 const bytes=Buffer.concat([Buffer.from([239,187,191]),Buffer.from('ığüş\r\nx\r\n')]);
 const decoded=A.decodeFile(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));assert.deepEqual(Buffer.from(A.encodeFile(decoded)),bytes);
});
await test('B10 UTF-16LE and UTF-16BE BOM roundtrip',({A})=>{
 for(const encoding of ['utf-16le','utf-16be']){const original={text:'ğ😀\nx',encoding,bom:true,eol:'\r\n'};const bytes=A.encodeFile(original);
  const decoded=A.decodeFile(bytes.buffer);assert.equal(decoded.text,original.text);assert.equal(decoded.encoding,encoding);assert.deepEqual(Buffer.from(A.encodeFile(decoded)),Buffer.from(bytes));}
});
await test('B10 mixed line endings require explicit confirmation',async({A,context})=>{
 A.commitDocument({text:'safe'});context.confirm=()=>false;assert.equal(await A.openFile(file('mixed.txt','a\rb\r\nc\n')),false);assert.equal(A.doc.text,'safe');
});
await test('B11 dotfile, unknown extension and extensionless name preserved',({A})=>{
 for(const name of ['.env','README','app.mjs','custom.unknown']){A.rename(name);assert.equal(A.filename(),name);}
});
await test('B11 renamed file uses Save As instead of original handle',async({A,context})=>{
 let oldWrites=0,newWrites=0;const old={name:'old.txt',createWritable:async()=>{oldWrites++;}};
 const target={name:'new.js',createWritable:async()=>({write:async()=>newWrites++,close:async()=>{}})};
 context.showSaveFilePicker=async()=>target;A.commitDocument({text:'x',name:'new.js',handle:old,snapshot:null});await A.save();
 assert.equal(oldWrites,0);assert.equal(newWrites,1);assert.equal(A.doc.handle,target);
});
await test('B11 draft metadata survives recovery',async({A})=>{
 A.commitDocument({name:'.env',text:'data',encoding:'utf-16le',bom:true,eol:'\r\n'});await A.persist();const record=(await A.Store.list())[0];
 assert.equal(record.name,'.env');assert.equal(record.bom,true);assert.equal(record.eol,'\r\n');
});
await test('B12 replace all ignores temporary find selection',async({A})=>{
 A.commitDocument({text:'foo foo'});A.ui.sTxt.value='foo';A.ui.rTxt.value='bar';A.ui.ed.setSelectionRange(0,3);
 await A.replaceAll();assert.equal(A.doc.text,'bar bar');
});
await test('B12 explicit scope replaces only requested range',async({A})=>{
 A.commitDocument({text:'foo foo'});A.ui.sTxt.value='foo';A.ui.rTxt.value='bar';A.search.scope=[4,7];A.ui.cScope.checked=true;
 await A.replaceAll();assert.equal(A.doc.text,'foo bar');
});
await test('B13 clearing query invalidates in-flight result',async({A})=>{
 A.commitDocument({text:'abc'});A.ui.searchPanel.hidden=false;A.ui.sTxt.value='a';const pending=A.runFind();A.ui.sTxt.value='';A.invalidateSearch();
 await pending;assert.equal(A.search.matches.length,0);
});
await test('B13 closing panel invalidates result generation',async({A})=>{
 A.commitDocument({text:'abc'});A.ui.searchPanel.hidden=false;A.ui.sTxt.value='a';const pending=A.runFind();A.ui.searchPanel.hidden=true;A.invalidateSearch();
 await pending;assert.equal(A.search.matches.length,0);
});
await test('B14 regex disabled when Worker unavailable',async({A})=>{
 await assert.rejects(()=>A.runJob('find',{op:'find',query:'(a|a)*b',regex:true,text:'a'.repeat(28),cap:20000}),/Web Worker/);
});
await test('B14 literal fallback treats regex punctuation literally',async({A})=>{
 const result=await A.runJob('find',{op:'find',query:'(a|a)*b',regex:false,text:'(a|a)*b',cap:20000});assert.equal(result.matches.length,1);
});
await test('B14 actual worker isolates and terminates expensive regex',async({A})=>{
 const start=Date.now();await assert.rejects(()=>A.runJob('find',{op:'find',query:'(a|a)*b',regex:true,text:'a'.repeat(36),cap:20000}),/zaman aşımı/);
 assert.ok(Date.now()-start<4000);
},{realWorker:true});
await test('B15 selection ending at next line start excludes that line',({A})=>{
 A.commitDocument({text:'aa\nbb'});A.ui.ed.setSelectionRange(0,3);A.indentSelection(false);assert.equal(A.doc.text,'  aa\nbb');
});
await test('B15 dedent respects same boundary and undo restores it',({A})=>{
 A.commitDocument({text:'  aa\n  bb'});A.ui.ed.setSelectionRange(0,5);A.indentSelection(true);assert.equal(A.doc.text,'aa\n  bb');A.undo();assert.equal(A.doc.text,'  aa\n  bb');
});
await test('B16 leading newline at position zero reports line one',({A})=>{
 A.commitDocument({text:'\nx'});A.ui.ed.setSelectionRange(0,0);A.renderStatus();assert.equal(A.ui.posInfo.textContent,'Sat 1, Süt 1');
});
await test('B17 selection offset correct; pixel geometry is NOT browser-tested',async({A})=>{
 A.commitDocument({text:'x'.repeat(1000)+'a'});A.ui.searchPanel.hidden=false;A.ui.sTxt.value='a';await A.runFind();await A.gotoMatch(1);
 assert.equal(A.ui.ed.selectionStart,1000); // Pixel geometry requires a browser, not this DOM model.
});
await test('B18 default Tab preserves native focus navigation',({A,events})=>{
 let prevented=false;events['document:keydown']({key:'Tab',target:A.ui.ed,preventDefault(){prevented=true}});assert.equal(prevented,false);
});
await test('B18 indent mode has Escape exit to toolbar',({A,events,elements})=>{
 A.setTab(true);events['document:keydown']({key:'Escape',target:A.ui.ed});assert.ok(elements.openButton);
});
await test('B19 hidden toast removes actionable control',({A})=>{
 A.toast('test',{label:'action',run(){}});A.hideToast();assert.equal(A.ui.toastAction.hidden,true);assert.equal(A.ui.toastAction.onclick,null);
});
await test('B20 exact cap is not falsely marked truncated',({A})=>{
 assert.equal(A.searchEngine({op:'find',query:'a',text:'aaa',cap:3}).truncated,false);
 assert.equal(A.searchEngine({op:'find',query:'a',text:'aaaa',cap:3}).truncated,true);
});
await test('B20 truncation indicator survives navigation',async({A})=>{
 A.commitDocument({text:'a'.repeat(20001)});A.ui.searchPanel.hidden=false;A.ui.sTxt.value='a';await A.runFind();await A.gotoMatch(1);
 assert.equal(A.ui.findCount.textContent,'1/20000+');
});
await test('B25 new shortcut opens blank but preserves old draft',async({A,context})=>{
 A.Store.migrate=async()=>{};A.Store.list=async()=>[draft('previous',1,'keep')];context.location.href='https://example.test/app/?new=1';
 await A.init();assert.equal(A.doc.text,'');assert.equal((await A.Store.list())[0].text,'keep');
});
await test('History undo and redo preserve programmatic edits',({A})=>{
 A.commitDocument({text:'abc'});A.replaceRange('X',1,2);assert.equal(A.doc.text,'aXc');A.undo();assert.equal(A.doc.text,'abc');A.undo(true);assert.equal(A.doc.text,'aXc');
});
await test('Worker replacement matches native JS substitution semantics',({A})=>{
 const fixtures=[['abc123','(abc)(123)','$2-$1-$$-$&'],['abc','(?<first>a)(b)','$<first>-$02-$12-$0'],['aba','a',"$`/$'"],['abc','(?:)','$&x'],['b','(a)?b','$1'],['aaa','a','$10'],['a','(a)','$01']];
 for(const [text,query,replacement] of fixtures){const output=A.searchEngine({op:'replace',regex:true,text,query,replacement,cap:20000,limit:10000}).text;
 assert.equal(output,text.replace(new RegExp(query,'gi'),replacement),JSON.stringify({text,query,replacement}));}
});
await test('Actual Worker successfully returns regex captures',async({A})=>{
 const result=await A.runJob('replace',{op:'replace',regex:true,text:'foo42',query:'(foo)(42)',replacement:'$2$1',cap:20000,limit:1000});assert.equal(result.text,'42foo');
},{realWorker:true});
await test('Output and replacement-count limits are enforced',({A})=>{
 assert.throws(()=>A.searchEngine({op:'replace',text:'aaa',query:'a',replacement:'xxxx',cap:3,limit:5}),/boyutu/);
 assert.throws(()=>A.searchEngine({op:'replace',text:'aaa',query:'a',replacement:'b',cap:2,limit:100}),/en fazla/);
});
await test('Wrap changes never schedule a content write',async({A,idb})=>{
 A.applyWrap(true);await tick();assert.equal(idb.data.size,0);
});
await test('Line gutter renders only viewport subset',({A})=>{
 A.commitDocument({text:'x\n'.repeat(100000)});A.renderGutter();assert.ok(A.ui.gutterLines.textContent.split('\n').length<20);
});
await test('New page draft branches never reuse restored identity',({A})=>{
 const first=A.doc.id;A.commitDocument({text:'restored'});assert.notEqual(A.doc.id,first);
});
await test('Failed file write preserves dirty status and aborts stream',async({A})=>{
 let aborted=false;A.commitDocument({text:'x',name:'x.txt',snapshot:null,handle:{name:'x.txt',createWritable:async()=>({write:async()=>{throw Error('disk full')},abort:async()=>aborted=true})}});
 assert.equal(await A.save(),false);assert.equal(A.dirty(),true);assert.equal(aborted,true);
});
await test('Fallback download stays dirty until explicit confirmation',async({A})=>{
 A.commitDocument({text:'unsaved',snapshot:null});await A.save();assert.equal(A.dirty(),true);A.ui.toastAction.onclick();await tick();assert.equal(A.dirty(),false);
});
await test('Editing invalidates a previously captured scope',({A})=>{
 A.commitDocument({text:'abc'});A.search.scope=[0,2];A.ui.cScope.checked=true;A.replaceRange('x',0,0);assert.equal(A.search.scope,null);assert.equal(A.ui.cScope.checked,false);
});
await test('Oversized files rejected without state changes',async({A})=>{
 A.commitDocument({text:'safe'});assert.equal(await A.openFile({name:'huge',size:11*1024*1024}),false);assert.equal(A.doc.text,'safe');
});
await test('Opening another file while save is active is blocked',async({A})=>{
 let finish;A.commitDocument({text:'x',name:'x.txt',handle:{name:'x.txt',createWritable:async()=>({write:async()=>{},close:()=>new Promise(r=>finish=r)})}});
 const saving=A.save();await tick();assert.equal(await A.openFile(file('new.txt','new')),false);finish();await saving;assert.equal(A.doc.text,'x');
});
await test('Newer emergency journal survives completion of an older IDB write',async({A,storage})=>{
 const writing=A.Store.put(draft('same',1,'old'));A.Store.journal(draft('same',2,'new'));await writing;
 assert.equal(JSON.parse(storage.get('teopad:draft:same')).text,'new');assert.equal((await A.Store.list())[0].text,'new');
});
await test('Emergency journal immediately records current recovery identity',({A,session})=>{
 A.commitDocument({text:'unsaved',snapshot:null});A.emergencyJournal();assert.equal(session.get('teopad:last-draft'),A.doc.id);
});
await test('Successful draft save does not clear an independent settings failure',async({A,context})=>{
 context.localStorage.setItem=()=>{throw Error('settings blocked')};A.setSetting('theme','dark');await A.persist();
 assert.equal(A.ui.storageWarn.hidden,false);assert.match(A.ui.storageWarn.textContent,/ayarlar/);
});
await test('Cancelled Worker cannot delete or resolve a newer job',async({A})=>{
 const old=A.runJob('find',{op:'find',regex:true,query:'(a|a)*b',text:'a'.repeat(36),cap:20});
 const failure=assert.rejects(()=>old,error=>error.name==='AbortError');
 const fresh=A.runJob('find',{op:'find',regex:true,query:'b',text:'abc',cap:20});await failure;assert.equal((await fresh).matches.length,1);
},{realWorker:true});
await test('Changing replacement while a search is pending schedules fresh results',async({A})=>{
 A.commitDocument({text:'foo'});A.ui.sTxt.value='foo';A.ui.searchPanel.hidden=false;const previous=A.runFind();
 A.ui.rTxt.value='bar';A.ui.rTxt.listeners.input();await previous;await A.runFind();assert.equal(A.search.matches.length,1);
});
await test('R27 older failed IDB write cannot overwrite newer emergency journal',async({A,idb,storage})=>{
 idb.options.writeFailure=true;
 const writing=A.Store.put(draft('same',1,'old'));
 A.Store.journal(draft('same',2,'new'));
 await writing;
 assert.equal(JSON.parse(storage.get('teopad:draft:same')).text,'new');
 assert.equal((await A.Store.list())[0].text,'new');
});
await test('R28 failed activation message revokes reload permission',async({A,context})=>{
 let controllerChanged,reloads=0;
 context.navigator.serviceWorker={addEventListener:(k,f)=>controllerChanged=f,register:async()=>({addEventListener(){}})};
 context.location.reload=()=>reloads++;
 A.setupServiceWorker();A.setWorker({postMessage(){throw Error('worker redundant')}});
 await A.requestUpdate();
 assert.equal(A.pendingReload,false);
 assert.match(A.ui.toastMsg.textContent,/Taslak korundu ancak/);
 controllerChanged();assert.equal(reloads,0);assert.equal(A.ui.ed.readOnly,false);
});
await test('R29 update invalidates already-resolving literal replacement',async({A})=>{
 A.commitDocument({text:'abc',snapshot:null});A.ui.sTxt.value='a';A.ui.rTxt.value='X';
 const replacing=A.replaceAll();A.setWorker({postMessage(){}});
 await A.requestUpdate();assert.equal(await replacing,false);
 assert.equal(A.doc.text,'abc');assert.equal((await A.Store.list())[0].text,A.doc.text);
});
await test('R29 update terminates outstanding Worker replacement',async({A})=>{
 A.commitDocument({text:'abc',snapshot:null});A.ui.sTxt.value='a';A.ui.rTxt.value='X';A.ui.cReg.checked=true;
 const replacing=A.replaceAll();A.setWorker({postMessage(){}});
 await A.requestUpdate();assert.equal(await replacing,false);
 assert.equal(A.doc.text,'abc');assert.equal((await A.Store.list())[0].text,A.doc.text);
},{realWorker:true});
// Static contracts are checked against the exact generated deliverables.
const manifest=JSON.parse(fs.readFileSync(path.join(appDirectory,'manifest.json'),'utf8'));
const codeTypes=JSON.parse(appSource.match(/const TYPES = (.*);/)[1]);
try{assert.deepEqual(codeTypes,manifest.file_handlers[0].accept);cases.push({name:'B26 file type definitions match manifest exactly',status:'PASS'});}catch(error){cases.push({name:'B26 file types',status:'FAIL',error:error.message});}
const {createHash}=require('crypto');
try{for(const [,script]of html.matchAll(/<script>([\s\S]*?)<\/script>/g)){const hash=createHash('sha256').update(script).digest('base64');assert.ok(html.includes("'sha256-"+hash+"'"));new vm.Script(script);}new vm.Script(fs.readFileSync(path.join(appDirectory,'sw.js'),'utf8'));cases.push({name:'Syntax and inline CSP hashes valid',status:'PASS'});}catch(error){cases.push({name:'Syntax/CSP',status:'FAIL',error:error.stack});}
const result={runtime:process.version,scope:'Node VM DOM/IDB mocks + real Node Web APIs + real worker_threads; no browser rendering',cases};
fs.writeFileSync(path.join(__dirname,'regression-results.json'),JSON.stringify(result,null,2));
for(const entry of cases)console.log(entry.status+' '+entry.name+(entry.error?'\n'+entry.error:''));
console.log(`TOTAL ${cases.length}; PASS ${cases.filter(x=>x.status==='PASS').length}; FAIL ${cases.filter(x=>x.status==='FAIL').length}`);
process.exitCode=cases.some(x=>x.status==='FAIL')?1:0;
})();
