import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.js';
test('two-way screens, audio, chat, danmaku, reconnect, stop independence, nickname login', { timeout: 90000 }, async t => {
  const app = createApp({ production: false }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); t.after(() => app.close());
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}), args: ['--autoplay-policy=no-user-gesture-required'] }); t.after(() => browser.close());
  const errors = []; const pages = [];
  for (const name of ['A', 'B', 'C', 'D']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      if (!navigator.mediaDevices) return;
      const Native = RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = class extends Native { constructor(...args) { super(...args); window.__pcs.push(this); } };
      const sound = () => { const c = new AudioContext(); c.resume(); const o = c.createOscillator(), dst = c.createMediaStreamDestination(); o.connect(dst); o.start(); return dst.stream.getAudioTracks()[0]; };
      navigator.mediaDevices.getUserMedia = async () => new MediaStream([sound()]);
      navigator.mediaDevices.getDisplayMedia = async (constraints) => { window.__captureConstraints = constraints; const c = document.createElement('canvas'); c.width = 640; c.height = 360; const ctx = c.getContext('2d'); let i = 0; setInterval(() => { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 1920, 1080); ctx.fillStyle = '#ddd'; ctx.font = '60px sans-serif'; ctx.fillText(`Test screen ${++i}`, 30, 180); }, 16); const s = c.captureStream(20); s.addTrack(sound()); return s; };
    });
    const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(url); pages.push(p);
    assert.equal(await p.locator('input[type=password]').count(), 0);
    if (name === 'A') { mkdirSync('test-results', { recursive: true }); await p.screenshot({ path: 'test-results/home.png', fullPage: true }); }
    await p.getByLabel('昵称', { exact: true }).fill(name); await p.getByRole('button', { name: '进入', exact: true }).click(); await p.getByRole('button', { name: '开始投屏' }).waitFor(); assert.equal(await p.getByLabel('投屏目标帧率').inputValue(), '40');
  }
  const [a, b] = pages;
  for (const p of pages) {
    await p.waitForFunction(() => [...document.querySelectorAll('.member-ping')].length === 4 && [...document.querySelectorAll('.member-ping')].every(e => /\d+ ms/.test(e.textContent)));
  }
  await a.getByRole('button', { name: '开始投屏' }).click(); await b.getByRole('button', { name: '开始投屏' }).click(); assert.equal(await a.evaluate(() => window.__captureConstraints.video.frameRate.ideal), 40);
  for (const p of pages) {
    try { await p.waitForFunction(() => document.querySelectorAll('video').length === 2 && [...document.querySelectorAll('video')].every(v => v.videoWidth > 0 && v.currentTime > 0)); }
    catch (e) { for (const page of pages) t.diagnostic(JSON.stringify(await page.evaluate(() => ({text:document.body.innerText, peers:window.__pcs.map(p=>({state:p.connectionState,signaling:p.signalingState,tracks:p.getSenders().map(s=>s.track?.kind)}))})))); throw e; }
    await p.getByRole('button', { name: '开启麦克风' }).click();
  }
  for (const p of pages) await p.waitForFunction(async () => { const reports = await Promise.all(window.__pcs.filter(p => p.connectionState === 'connected').map(p => p.getStats())); return reports.flatMap(s => [...s.values()]).filter(s => s.type === 'inbound-rtp' && s.kind === 'audio' && s.bytesReceived > 0).length >= 3; });
  await a.getByLabel('聊天消息').fill('测试弹幕 hello'); await a.getByRole('button', { name: '发送', exact: true }).click();
  for (const p of pages) await p.locator('.messages').getByText('测试弹幕 hello').waitFor(); await b.locator('.bullet').first().waitFor();
  await b.getByRole('button', { name: '关闭弹幕' }).click(); assert.equal(await b.locator('.bullet').count(), 0);
  // Exercise real Document PiP if supported by this browser's headless mode.
  if (await a.evaluate(() => !!window.documentPictureInPicture)) {
    await a.getByRole('button', { name: '弹幕小窗' }).click();
    await a.waitForFunction(() => !!window.documentPictureInPicture.window);
    assert.equal(await a.evaluate(() => documentPictureInPicture.window.document.body.textContent.includes('测试弹幕 hello')), true);
    await b.getByLabel('聊天消息').fill('小窗实时消息'); await b.getByRole('button', { name: '发送', exact: true }).click();
    await a.waitForFunction(() => documentPictureInPicture.window.document.body.textContent.includes('小窗实时消息'));
    await a.locator('.screen-card[data-member="B"]').getByRole('button',{name:'直播小窗',exact:true}).click();
    await a.waitForFunction(()=>{const video=documentPictureInPicture.window?.document.querySelector('.pip-live video');return video?.videoWidth>0 && video.currentTime>0;});
    assert.match(await a.evaluate(()=>documentPictureInPicture.window.document.querySelector('.pip-live-name').textContent),/^B/);
    await a.getByRole('button',{name:'弹幕小窗',exact:true}).click();
    await a.waitForFunction(()=>!!documentPictureInPicture.window?.document.querySelector('.pip-messages'));
    t.diagnostic('Real Document PiP received live chat, played the selected remote video, and switched back to chat.');
    await a.evaluate(() => documentPictureInPicture.window.close());
  } else t.diagnostic('Document PiP unavailable in this browser; native PiP test skipped.');
  await a.screenshot({ path: 'test-results/room.png', fullPage: true });
  const thirdCaster = pages[2];
  await thirdCaster.getByRole('button', { name: '开始投屏', exact: true }).click();
  await b.waitForFunction(() => {
    const videos = [...document.querySelectorAll('video')];
    return videos.length === 3 && videos.every(video => video.videoWidth > 0 && video.currentTime > 0);
  });
  await thirdCaster.getByRole('button', { name: '停止投屏', exact: true }).click();
  await a.getByRole('button', { name: '停止投屏' }).click();
  await b.waitForFunction(() => document.querySelectorAll('video').length === 1);
  assert.equal(await b.getByRole('button', { name: '停止投屏' }).count(), 1);
  await a.getByRole('button', { name: '开始投屏' }).click();
  await b.reload(); await b.getByRole('button', { name: '开始投屏' }).waitFor();
  try { await b.waitForFunction(() => document.querySelector('video')?.videoWidth > 0); }
  catch (e) { t.diagnostic(JSON.stringify(await a.evaluate(() => ({ text: document.body.innerText, peers: window.__pcs.map(p => ({ connection: p.connectionState, signaling: p.signalingState, senders: p.getSenders().map(s => s.track?.readyState) })) })))); throw e; }
  await b.getByRole('button', { name: '重连', exact: true }).click(); await b.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
  const fifth = await browser.newPage();
  await fifth.goto(url);
  await fifth.getByLabel('昵称', { exact: true }).fill('E');
  await fifth.getByRole('button', { name: '进入', exact: true }).click();
  await fifth.getByText('5 人在线', { exact: true }).waitFor();
  await fifth.waitForFunction(() => document.querySelector('[data-member="A"] video')?.videoWidth > 0);
  await fifth.getByRole('button', { name: '退出', exact: true }).click();
  await b.getByText('4 人在线', { exact: true }).waitFor();
  await a.getByRole('button', { name: '退出', exact: true }).click();
  await b.getByText('3 人在线', { exact: true }).waitFor();
  await b.setViewportSize({ width: 390, height: 844 }); assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await b.setViewportSize({ width: 1440, height: 900 });
  await b.getByLabel('投屏目标帧率').selectOption('unlimited');
  await b.getByLabel('视频码率上限').selectOption('25');
  await b.getByLabel('发送系统音量', { exact: true }).fill('35');
  await b.getByLabel('发送麦克风音量', { exact: true }).fill('65');
  await b.getByLabel('接收音量', { exact: true }).fill('45');
  const imageData = await b.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 8; const ctx = c.getContext('2d'); ctx.fillStyle = '#777'; ctx.fillRect(0,0,8,8); return c.toDataURL('image/png').split(',')[1]; });
  await b.getByLabel('背景图片').setInputFiles({ name: 'background.png', mimeType: 'image/png', buffer: Buffer.from(imageData,'base64') });
  await b.getByRole('button', { name: '恢复黑色背景' }).waitFor();
  await b.reload(); await b.getByRole('button', { name: '开始投屏' }).waitFor();
  assert.equal(await b.getByLabel('投屏目标帧率').inputValue(), 'unlimited');
  assert.equal(await b.getByLabel('视频码率上限').inputValue(), '25');
  assert.equal(await b.getByLabel('发送系统音量', { exact: true }).inputValue(), '35');
  assert.equal(await b.getByLabel('发送麦克风音量', { exact: true }).inputValue(), '65');
  assert.equal(await b.getByLabel('接收音量', { exact: true }).inputValue(), '45');
  assert.match(await b.locator('.app').evaluate(e => getComputedStyle(e).backgroundImage), /data:image/);
  await b.getByRole('button', { name: '开始投屏' }).click();
  assert.equal(await b.evaluate(() => 'frameRate' in window.__captureConstraints.video), false);
  await b.waitForFunction(() => [...document.querySelectorAll('audio')].length > 0 && [...document.querySelectorAll('audio')].every(a => Math.abs(a.volume - .45) < .001));
  await b.getByLabel('投屏目标帧率').selectOption('40');
  await b.getByLabel('投屏目标帧率').selectOption('unlimited');
  await b.waitForFunction(async () => { const peers=window.__pcs.filter(p=>p.connectionState==='connected'); return peers.length === 2 && peers.every(p=>p.getSenders().filter(s=>s.track?.kind==='video').every(s=>s.getParameters().encodings.every(e=>e.maxFramerate == null))); });
  const listener=pages[2]; await b.getByRole('button',{name:'开启麦克风',exact:true}).click();
  await listener.locator('.screen-card[data-member="B"]').getByText('正在投屏 · 麦克风开').waitFor();
  await listener.getByLabel('B 系统声音接收音量',{exact:true}).fill('0');
  await listener.getByLabel('B 麦克风接收音量',{exact:true}).fill('60');
  await listener.waitForFunction(()=>{ const card=document.querySelector('.screen-card[data-member="B"]'); return card.querySelector('audio[data-channel="system"]')?.volume===0 && card.querySelector('audio[data-channel="mic"]')?.volume===.6 && document.querySelector('.screen-card[data-member="D"] audio[data-channel="mic"]')?.volume===1; });
  async function outgoingRms(index) { return b.evaluate(async i => { const pc=window.__pcs.findLast(p=>p.connectionState==='connected'); const track=pc.getTransceivers()[i].sender.track; const ac=new AudioContext(); await ac.resume(); const source=ac.createMediaStreamSource(new MediaStream([track])), analyser=ac.createAnalyser(); source.connect(analyser); await new Promise(r=>setTimeout(r,200)); const data=new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data); const rms=Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length); source.disconnect(); await ac.close(); return rms; },index); }
  assert.ok(await outgoingRms(1) > .01); assert.ok(await outgoingRms(2) > .01);
  await b.getByLabel('发送系统音量', { exact: true }).fill('0');
  assert.ok(await outgoingRms(1) < .001, 'system gain must mute its actual samples'); assert.ok(await outgoingRms(2) > .01, 'microphone must remain audible');
  await b.getByLabel('发送系统音量', { exact: true }).fill('35');
  await b.getByLabel('发送麦克风音量', { exact: true }).fill('0');
  assert.ok(await outgoingRms(2) < .001, 'mic gain must mute its actual samples'); assert.ok(await outgoingRms(1) > .01, 'system audio must remain audible');
  await b.getByRole('button',{name:'停止投屏',exact:true}).click();
  await listener.locator('.screen-card[data-member="B"]').getByText('未投屏 · 麦克风开').waitFor();
  await b.getByRole('button',{name:'关闭麦克风',exact:true}).click();
  await listener.locator('.screen-card[data-member="B"]').getByText('未投屏 · 麦克风关').waitFor();
  await b.getByRole('button', { name: '恢复黑色背景' }).click();
  await b.reload(); await b.getByRole('button', { name: '开始投屏' }).waitFor();
  assert.equal(await b.locator('.app').evaluate(e=>getComputedStyle(e).backgroundImage), 'none');
  t.diagnostic('Live member RTTs; independent outgoing audio samples; per-member/per-channel receive levels; mic remains on while stopping a screen share; saved settings survive reload.');
  assert.deepEqual(errors, []);
});
