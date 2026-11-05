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
    t.diagnostic('Real Document PiP opened and received live chat updates in Edge.');
    await a.evaluate(() => documentPictureInPicture.window.close());
  } else t.diagnostic('Document PiP unavailable in this browser; native PiP test skipped.');
  await a.screenshot({ path: 'test-results/room.png', fullPage: true });
  assert.equal(await pages[2].getByRole('button', { name: '开始投屏' }).isDisabled(), true); await a.getByRole('button', { name: '停止投屏' }).click();
  await b.waitForFunction(() => document.querySelectorAll('video').length === 1);
  assert.equal(await b.getByRole('button', { name: '停止投屏' }).count(), 1);
  await a.getByRole('button', { name: '开始投屏' }).click();
  await b.reload(); await b.getByRole('button', { name: '开始投屏' }).waitFor();
  try { await b.waitForFunction(() => document.querySelector('video')?.videoWidth > 0); }
  catch (e) { t.diagnostic(JSON.stringify(await a.evaluate(() => ({ text: document.body.innerText, peers: window.__pcs.map(p => ({ connection: p.connectionState, signaling: p.signalingState, senders: p.getSenders().map(s => s.track?.readyState) })) })))); throw e; }
  await b.getByRole('button', { name: '重连', exact: true }).click(); await b.waitForFunction(() => document.querySelector('video')?.videoWidth > 0);
  const third = await browser.newPage(); await third.goto(url); await third.getByLabel('昵称', { exact: true }).fill('C'); await third.getByRole('button', { name: '进入', exact: true }).click(); await third.getByRole('alert').filter({ hasText: '最多同时在线 4 人' }).waitFor();
  await a.getByRole('button', { name: '退出', exact: true }).click(); await b.getByText('3 / 4 在线').waitFor();
  await b.setViewportSize({ width: 390, height: 844 }); assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});
