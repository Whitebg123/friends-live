import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { EmojiStore } from '../server/emojis.js';
import { png, fakeCloud } from './cloud-fixture.js';
async function service(t,store){const app=createApp({production:false,emojiStore:store});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());return {app,url:`http://127.0.0.1:${app.server.address().port}`};}
async function login(url,name){const ws=new WebSocket(url.replace('http','ws')+'/ws',{origin:url});await once(ws,'open');const welcome=once(ws,'message');ws.send(JSON.stringify({type:'login',name}));return {ws,...JSON.parse((await welcome)[0])};}
test('shared cloud upload, content validation, deduplication, image retrieval and reload after app restart',async t=>{
  const cloud=await fakeCloud();t.after(()=>cloud.close());
  const {app,url}=await service(t,new EmojiStore(cloud.options));const a=await login(url,'A');
  const headers={Authorization:`Bearer ${a.token}`,'Content-Type':'application/octet-stream'};
  assert.equal((await fetch(url+'/api/emojis')).status,401);
  const upload=await fetch(url+'/api/emojis',{method:'POST',headers,body:png});assert.equal(upload.status,201);const {item}=await upload.json();
  assert.match(item.id,/^[a-f0-9]{64}\.png$/);
  const other=await login(url,'B');const list=await (await fetch(url+'/api/emojis',{headers:{Authorization:`Bearer ${other.token}`}})).json();assert.equal(list.items[0].id,item.id);
  const repeated=await (await fetch(url+'/api/emojis',{method:'POST',headers,body:png})).json();assert.equal(repeated.item.id,item.id);
  const read=await fetch(url+item.url);assert.equal(read.headers.get('content-type').split(';')[0],'image/png');assert.deepEqual(Buffer.from(await read.arrayBuffer()),png);
  assert.equal((await fetch(url+'/api/emojis',{method:'POST',headers,body:Buffer.from('<svg onload="alert(1)"></svg>')})).status,400);
  assert.equal((await fetch(url+'/api/emojis',{method:'POST',headers,body:Buffer.alloc(2*1024*1024+1)})).status,413);
  const waiting=new Promise(resolve=>other.ws.on('message',raw=>{const d=JSON.parse(raw);if(d.type==='chat')resolve(d);}));a.ws.send(JSON.stringify({type:'chat',emojiId:item.id}));assert.equal((await waiting).message.emoji.id,item.id);
  await app.close();
  const fresh=new EmojiStore(cloud.options);assert.equal((await fresh.list())[0].id,item.id);
});
test('unconfigured cloud is explicit and does not accept uploads into temporary memory',async t=>{
  const {url}=await service(t,new EmojiStore({url:'',key:''}));const a=await login(url,'A'),headers={Authorization:`Bearer ${a.token}`,'Content-Type':'application/octet-stream'};
  assert.deepEqual(await (await fetch(url+'/api/emojis',{headers})).json(),{configured:false,items:[]});
  assert.equal((await fetch(url+'/api/emojis',{method:'POST',headers,body:png})).status,503);
});
