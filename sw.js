const CACHE='aurorar-shell-v4';
const SHELL=['/','/index.html','/styles.css?v=20261028-lighttheme4','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.all(SHELL.map(async path=>{try{const response=await fetch(path,{cache:'reload'});if(response.ok)await cache.put(path,response);}catch(error){console.warn('Optional shell asset unavailable:',path);}}));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('aurorar-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put('/index.html',response.clone()));return response;}).catch(()=>caches.match('/index.html')));
  return;
 }
 event.respondWith(fetch(request).then(response=>{
  if(response.ok&&response.type==='basic')caches.open(CACHE).then(cache=>cache.put(request,response.clone()));
  return response;
 }).catch(()=>caches.match(request).then(cached=>cached||caches.match('/index.html'))));
});