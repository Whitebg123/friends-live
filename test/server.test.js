import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
async function setup(t, options = {}) {
  const service = createApp({ production: false, grace: 100, ...options }); service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening'); t.after(() => service.close());
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  async function client() {
    const ws = new WebSocket(origin.replace('http', 'ws') + '/ws', { origin }); const messages = []; const waiters = [];
    ws.on('message', raw => { messages.push(JSON.parse(raw)); for (const f of [...waiters]) f(); }); await once(ws, 'open');
    const next = predicate => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('message timeout')), 2000); const check = () => { const i = messages.findIndex(predicate); if (i < 0) return; clearTimeout(timer); const j = waiters.indexOf(check); if (j >= 0) waiters.splice(j, 1); resolve(messages.splice(i, 1)[0]); }; waiters.push(check); check(); });
    const send = data => ws.send(JSON.stringify(data));
    return { ws, next, send, login: async (name = 'Friend') => { send({ type: 'login', name }); return next(d => d.type === 'welcome'); } };
  }
  return { service, origin, client };
}
test('homepage and health, production needs no password', async t => { const { origin } = await setup(t); assert.equal((await fetch(origin)).status, 200); assert.deepEqual(await (await fetch(origin + '/health')).json(), { ok: true }); const s = createApp({ production: true }); await s.close(); });
test('more than four people can join; connections are not capped at 32', async t => {
  const { client } = await setup(t); const clients=[];
  for(let i=0;i<35;i++) clients.push(await client());
  let first,last;
  for(let i=0;i<8;i++) {last=await clients[i].login('Member '+i);first ||= last;}
  assert.equal(last.room.members.length,8);assert.equal(last.room.id,first.room.id);assert.equal(JSON.stringify(last.room).includes(first.token),false);
});
test('both participants share simultaneously and stopping one keeps other sharing', async t => { const { client, service } = await setup(t); const a = await client(), wa = await a.login('A'), b = await client(), wb = await b.login('B'); for (const c of [a, b]) { c.send({ type: 'start', systemAudio: true }); await c.next(d => d.type === 'ack'); } assert.equal([...service.members.values()].filter(m => m.sharing).length, 2); a.send({ type: 'stop' }); await a.next(d => d.type === 'ack'); assert.equal(service.members.get(wa.selfId).sharing, false); assert.equal(service.members.get(wb.selfId).sharing, true); b.send({ type: 'stop', target: wa.selfId }); assert.equal((await b.next(d => d.type === 'error')).code, 'FORBIDDEN'); });
test('chat broadcasts server identity as plain text and has bounded history', async t => { const { client, service } = await setup(t); const a = await client(), wa = await a.login('A'), b = await client(); await b.login('B'); a.send({ type: 'chat', name: 'Impersonator', text: '<img src=x onerror=alert(1)>', requestId: 'x' }); const d = await b.next(d => d.type === 'chat'); assert.equal(d.message.name, 'A'); assert.equal(d.message.senderId, wa.selfId); assert.equal(d.message.text, '<img src=x onerror=alert(1)>'); assert.equal(service.room.messages.length, 1); a.send({ type: 'chat', text: 'x'.repeat(301) }); assert.equal((await a.next(d => d.type === 'error')).code, 'CHAT'); });
test('chat rate limit and login format validation', async t => { const { client } = await setup(t); const a = await client(); a.send({ type: 'login', name: ' ' }); assert.equal((await a.next(d => d.type === 'error')).code, 'NAME'); await a.login(); for (let i = 0; i < 8; i++) { a.send({ type: 'chat', text: String(i) }); await a.next(d => d.type === 'ack'); } a.send({ type: 'chat', text: 'spam' }); assert.equal((await a.next(d => d.type === 'error')).code, 'RATE'); });
test('pair signaling survives unrelated joins and rejects stale epochs and wrong offerer', async t => {
  const {client}=await setup(t);const a=await client(),wa=await a.login('A'),b=await client(),wb=await b.login('B');
  const [offer,answer]=[{c:a,w:wa},{c:b,w:wb}].sort((x,y)=>x.w.selfId<y.w.selfId?-1:1);
  const epoch=[offer,answer].map(({w})=>w.room.members.find(m=>m.id===w.selfId).connectionId).join(':');
  const newcomer=await client();await newcomer.login('C');
  offer.c.send({type:'signal',target:answer.w.selfId,epoch,signal:{kind:'offer',negotiation:'test',sdp:'test-sdp'}});
  assert.equal((await answer.c.next(d=>d.type==='signal')).epoch,epoch);
  answer.c.send({type:'signal',target:offer.w.selfId,epoch,signal:{kind:'offer',negotiation:'test',sdp:'bad'}});
  assert.equal((await answer.c.next(d=>d.type==='error')).code,'SIGNAL');
  offer.c.send({type:'signal',target:answer.w.selfId,epoch:'stale',signal:{kind:'ice',negotiation:'test',candidate:{candidate:'test'}}});
  assert.equal((await offer.c.next(d=>d.type==='error')).code,'SIGNAL');
});
test('session refresh restores identity; leave keeps other user and frees slot', async t => { const { client, service } = await setup(t); const a = await client(), wa = await a.login('A'), b = await client(), wb = await b.login('B'), fresh = await client(); fresh.send({ type: 'resume', token: wa.token }); assert.equal((await fresh.next(d => d.type === 'welcome')).selfId, wa.selfId); fresh.send({ type: 'leave' }); await fresh.next(d => d.type === 'left'); assert.equal(service.members.size, 1); assert.equal(service.room.ownerId, wb.selfId); const c = await client(); assert.equal((await c.login('C')).room.members.length, 2); });
test('timeout expires session and clears messages when room empty', async t => { const { client, service } = await setup(t, { grace: 20 }); const a = await client(), wa = await a.login(); a.send({ type: 'chat', text: 'temporary' }); await a.next(d => d.type === 'ack'); a.ws.terminate(); await once(a.ws, 'close'); await new Promise(r => setTimeout(r, 50)); assert.equal(service.members.size, 0); assert.equal(service.room.messages.length, 0); const b = await client(); b.send({ type: 'resume', token: wa.token }); assert.equal((await b.next(d => d.type === 'error')).code, 'EXPIRED'); });
test('unauthenticated operations and malformed JSON rejected', async t => { const { client } = await setup(t); const a = await client(); a.send({ type: 'chat', text: 'bad' }); assert.equal((await a.next(d => d.type === 'error')).code, 'AUTH'); for (const value of ['null', '[]', '{bad']) { a.ws.send(value); assert.equal((await a.next(d => d.type === 'error')).code, 'FORMAT'); } });
test('cross-origin WebSocket rejected', async t => { const { origin } = await setup(t); const ws = new WebSocket(origin.replace('http', 'ws') + '/ws', { origin: 'https://evil.example' }); assert.match((await once(ws, 'error'))[0].message, /403/); });

test('all six room members can share concurrently', async t=>{
  const {client,service}=await setup(t);
  for(let i=0;i<6;i++){const c=await client();await c.login('Sharer '+i);c.send({type:'start'});await c.next(d=>d.type==='ack');}
  assert.equal([...service.members.values()].filter(m=>m.sharing).length,6);
});
test('watcher probes reach the sharer through the signaling server and the reply returns to the watcher', async t=>{
  const {client}=await setup(t);const a=await client(),wa=await a.login('Sharer'),b=await client(),wb=await b.login('Watcher');
  a.send({type:'start'});await a.next(d=>d.type==='ack');b.send({type:'latency-probe',target:wa.selfId,requestId:'probe'});
  assert.deepEqual(await a.next(d=>d.type==='latency-probe'),{type:'latency-probe',from:wb.selfId,requestId:'probe'});
  a.send({type:'latency-reply',target:wb.selfId,requestId:'probe'});
  assert.deepEqual(await b.next(d=>d.type==='latency-reply'),{type:'latency-reply',from:wa.selfId,requestId:'probe'});
});
