const CACHE='aurorar-shell-v2';
const SHELL=['/','/index.html','/styles.css?v=20261028-dashboardcontrast10','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('aurorar-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 event.respondWith(fetch(request).then(response=>{if(response.ok&&response.type==='basic')caches.open(CACHE).then(cache=>cache.put(request,response.clone()));return response}).catch(()=>caches.match(request).then(cached=>cached||caches.match('/index.html'))));
});