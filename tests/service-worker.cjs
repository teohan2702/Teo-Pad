'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const appDirectory=process.argv[2]||path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(appDirectory,'sw.js'),'utf8');
function env(){
 const maps=new Map(),events={},fail={read:false,write:false},writes=[],logs=[];
 const root='https://example.test/app/';let claimed=0,skipped=0;
 const canonical=r=>typeof r==='string'?r:r.url;
 const cache=name=>({match:async r=>{if(fail.read)throw Error('cache read');return maps.get(name).get(canonical(r))?.clone();},
  put:async(r,res)=>{if(fail.write)throw Error('quota');await Promise.resolve();maps.get(name).set(canonical(r),res.clone());writes.push(canonical(r));},
 });
 const caches={keys:async()=>[...maps.keys()],open:async name=>{if(!maps.has(name))maps.set(name,new Map());return cache(name);},delete:async name=>maps.delete(name)};
 const ctx={self:{location:{href:root+'sw.js'},addEventListener:(k,f)=>events[k]=f,
 clients:{claim:async()=>claimed++},skipWaiting:async()=>skipped++},caches,URL,Request,Response,AbortController,setTimeout,clearTimeout,
 console:{warn:(...x)=>logs.push(x)},fetch:async r=>new Response(canonical(r).endsWith('manifest.json')?' {"name":"new"}':'<html>new</html>',{headers:{'Content-Type':canonical(r).endsWith('manifest.json')?'application/manifest+json':'text/html'}})};
 vm.createContext(ctx);vm.runInContext(source+'\nglobalThis.api={CACHE,ENTRY,MANIFEST,ICON_URLS,navigation,refreshManifest,readCache,writeCache};',ctx);
 function dispatch(request){const promises=[];let response;events.fetch({request,waitUntil:p=>promises.push(p),respondWith:p=>response=p});return {response,done:()=>Promise.all(promises)};}
 return {ctx,api:ctx.api,maps,fail,events,writes,logs,dispatch,root,get claimed(){return claimed},get skipped(){return skipped}};
}
const results=[];async function test(name,fn){try{await fn(env());results.push({name,status:'PASS'})}catch(error){results.push({name,status:'FAIL',error:error.stack})}}
(async()=>{
await test('B21 refreshed manifest replaces the same cache entry',async({api,ctx,maps,dispatch})=>{
 await api.writeCache(api.MANIFEST,new Response('{"name":"old"}'));const req={method:'GET',mode:'cors',url:api.MANIFEST};
 const first=dispatch(req);assert.equal((await(await first.response).json()).name,'old');await first.done();
 const second=dispatch(req);assert.equal((await(await second.response).json()).name,'new');await second.done();assert.equal(maps.size,1);
});
await test('B22 cache miss and offline returns valid 503 response',async({api,ctx,dispatch})=>{
 ctx.fetch=async()=>{throw Error('offline')};const event=dispatch({method:'GET',mode:'cors',url:api.MANIFEST});const response=await event.response;
 assert.equal(response.status,503);assert.match(await response.text(),/çevrimdışı/);await event.done();
});
await test('B23 lifetime promise covers manifest refresh and cache write',async({api,ctx,dispatch,writes})=>{
 let complete;ctx.fetch=()=>new Promise(r=>complete=r);const event=dispatch({method:'GET',mode:'cors',url:api.MANIFEST});
 let ended=false;const done=event.done().then(()=>ended=true);await Promise.resolve();assert.equal(ended,false);
 complete(new Response('{"name":"fresh"}'));await done;assert.ok(writes.includes(api.MANIFEST));assert.equal((await(await event.response).json()).name,'fresh');
});
await test('B23 cache write failure does not lose successful network response',async({api,fail,logs})=>{
 fail.write=true;const response=await api.navigation({url:api.ENTRY});assert.equal(response.status,200);assert.match(await response.text(),/new/);assert.equal(logs.length,1);
});
await test('B23 cache read failure still permits online response',async({api,fail})=>{
 fail.read=true;assert.equal((await api.navigation({url:api.ENTRY})).status,200);
});
await test('B24 unrelated navigation bypasses this service worker',async({root,dispatch,writes})=>{
 const event=dispatch({method:'GET',mode:'navigate',url:root+'help.html'});assert.equal(event.response,undefined);assert.equal(writes.length,0);
});
await test('B24 API, foreign origin and non-GET requests bypass cache',async({root,dispatch})=>{
 for(const request of [{method:'POST',mode:'cors',url:root},{method:'GET',mode:'cors',url:root+'api/private'},{method:'GET',mode:'cors',url:'https://other.test/manifest.json'}])assert.equal(dispatch(request).response,undefined);
});
await test('B24 HTML shell is not replaced by non-HTML response',async({api,ctx})=>{
 await api.writeCache(api.ENTRY,new Response('<html>safe</html>'));ctx.fetch=async()=>new Response('{"name":"wrong"}',{headers:{'Content-Type':'application/json'}});
 assert.equal(await(await api.navigation({url:api.ENTRY})).text(),'<html>safe</html>');assert.equal(await(await api.readCache(api.ENTRY)).text(),'<html>safe</html>');
});
await test('Server error falls back to cached shell',async({api,ctx})=>{
 await api.writeCache(api.ENTRY,new Response('<html>safe</html>'));ctx.fetch=async()=>new Response('error',{status:500});assert.equal(await(await api.navigation({url:api.ENTRY})).text(),'<html>safe</html>');
});
await test('Network timeout aborts and falls back to shell',async({api,ctx})=>{
 await api.writeCache(api.ENTRY,new Response('offline shell'));ctx.setTimeout=(fn)=>setTimeout(fn,15);
 ctx.fetch=(request,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout'))));
 assert.equal(await(await api.navigation({url:api.ENTRY})).text(),'offline shell');
});
await test('Manifest HTML response cannot corrupt cached JSON',async({api,ctx,dispatch})=>{
 await api.writeCache(api.MANIFEST,new Response('{"name":"safe"}'));ctx.fetch=async()=>new Response('<html>portal</html>');
 const e=dispatch({method:'GET',mode:'cors',url:api.MANIFEST});assert.equal((await(await e.response).json()).name,'safe');await e.done();assert.equal((await(await api.readCache(api.MANIFEST)).json()).name,'safe');
});
await test('Installation caches shell, manifest and all nine required icon files',async({events,writes,api,root})=>{
 let done;events.install({waitUntil:p=>done=p});await done;
 const names=['icon-192.png','icon-512.png','icon-maskable-192.png','icon-maskable-512.png','apple-touch-icon.png','favicon-16.png','favicon-32.png','favicon-48.png','favicon.ico'];
 assert.deepEqual(writes,[api.ENTRY,api.MANIFEST,...names.map(name=>root+'icons/'+name)]);
});
await test('Failed required asset prevents installation',async({events,ctx})=>{
 ctx.fetch=async()=>new Response('missing',{status:404});let done;events.install({waitUntil:p=>done=p});await assert.rejects(()=>done,/unavailable/);
});
await test('Activation cleans own releases but preserves another app cache',async e=>{
 e.maps.set('teopad-%2Fapp%2F-old',new Map());e.maps.set('teopad-%2Fother%2F-old',new Map());let done;e.events.activate({waitUntil:p=>done=p});await done;
 assert.equal(e.maps.has('teopad-%2Fapp%2F-old'),false);assert.equal(e.maps.has('teopad-%2Fother%2F-old'),true);assert.equal(e.claimed,1);assert.equal(e.skipped,0);
});
await test('skipWaiting only follows explicit message',async e=>{
 let done;e.events.message({data:{type:'OTHER'},waitUntil:p=>done=p});assert.equal(e.skipped,0);
 e.events.message({data:{type:'SKIP_WAITING'},waitUntil:p=>done=p});await done;assert.equal(e.skipped,1);
});
await test('Installed icons remain available offline with query strings',async({events,ctx,dispatch,api})=>{
 let done;events.install({waitUntil:p=>done=p});await done;
 ctx.fetch=async()=>{throw Error('offline')};
 for(const url of api.ICON_URLS){
  const event=dispatch({method:'GET',mode:'cors',url:url+'?v=1'});
  const response=await event.response;assert.equal(response.status,200);
  assert.equal(await response.text(),'<html>new</html>');
 }
});
await test('Icon cache miss and offline returns valid 503',async({ctx,dispatch,root})=>{
 ctx.fetch=async()=>{throw Error('offline')};
 const response=await dispatch({method:'GET',mode:'cors',url:root+'icons/icon-512.png'}).response;
 assert.equal(response.status,503);
});
await test('Icon cache miss preserves online PNG bytes',async({ctx,dispatch,root})=>{
 const bytes=Uint8Array.of(137,80,78,71,13,10,26,10);
 ctx.fetch=async()=>new Response(bytes,{headers:{'Content-Type':'image/png'}});
 const response=await dispatch({method:'GET',mode:'cors',url:root+'icons/icon-512.png'}).response;
 assert.equal(response.headers.get('Content-Type'),'image/png');
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
});
await test('Icon network timeout aborts and resolves to 503',async({ctx,dispatch,root})=>{
 ctx.setTimeout=fn=>setTimeout(fn,15);
 ctx.fetch=(request,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout'))));
 const response=await dispatch({method:'GET',mode:'cors',url:root+'icons/icon-512.png'}).response;
 assert.equal(response.status,503);
});
await test('Undeclared and out-of-scope icons bypass service worker',async({dispatch,root})=>{
 for(const request of [
  {method:'GET',mode:'cors',url:root+'icons/unknown.png'},
  {method:'GET',mode:'cors',url:'https://example.test/other/icons/icon-512.png'},
  {method:'GET',mode:'cors',url:'https://other.test/app/icons/icon-512.png'},
  {method:'POST',mode:'cors',url:root+'icons/icon-512.png'}
 ])assert.equal(dispatch(request).response,undefined);
});
await test('Missing required PNG prevents worker installation',async({events,ctx,root})=>{
 const fetch=ctx.fetch;
 ctx.fetch=async request=>request.url===root+'icons/icon-512.png'?new Response('missing',{status:404}):fetch(request);
 let done;events.install({waitUntil:p=>done=p});await assert.rejects(()=>done,/icon-512\.png/);
});
fs.writeFileSync(path.join(__dirname,'service-worker-results.json'),JSON.stringify({runtime:process.version,scope:'VM event and Cache mocks with real Web Response API',cases:results},null,2));
for(const r of results)console.log(r.status+' '+r.name+(r.error?'\n'+r.error:''));console.log(`TOTAL ${results.length}; PASS ${results.filter(r=>r.status==='PASS').length}; FAIL ${results.filter(r=>r.status==='FAIL').length}`);process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
})();
