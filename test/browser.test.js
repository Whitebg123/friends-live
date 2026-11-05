import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.js';
test('two-way screens, audio, chat, danmaku, reconnect, stop independence, nickname login', { timeout: 90000 }, async t => {
  const app = createApp({ production: false }); let browser;
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); t.after(async () => { await browser?.close(); await app.close(); });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = []; const pages = [];
  for (const name of ['A', 'B', 'C', 'D']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      if (!navigator.mediaDevices) return;
      if(!localStorage.getItem('friends-live-preferences-v1')) localStorage.setItem('friends-live-preferences-v1',JSON.stringify({fps:30,bitrate:8}));
      const Native = RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = class extends Native { constructor(...args) { super(...args); window.__pcs.push(this); } };
      const sound = () => { const c = new AudioContext(); c.resume(); const o = c.createOscillator(), dst = c.createMediaStreamDestination(); o.connect(dst); o.start(); return dst.stream.getAudioTracks()[0]; };
      navigator.mediaDevices.getUserMedia = async () => new MediaStream([sound()]);
      const supported=navigator.mediaDevices.getSupportedConstraints.bind(navigator.mediaDevices);
      navigator.mediaDevices.getSupportedConstraints=()=>({...supported(),restrictOwnAudio:true});
      navigator.mediaDevices.getDisplayMedia = async (constraints) => { window.__captureConstraints = constraints; const c = document.createElement('canvas'); c.width = 640; c.height = 360; const ctx = c.getContext('2d'); let i = 0; setInterval(() => { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 1920, 1080); ctx.fillStyle = '#ddd'; ctx.font = '60px sans-serif'; ctx.fillText(`Test screen ${++i}`, 30, 180); }, 16); const s = c.captureStream(20); if(constraints.audio) { const track=sound(), settings=track.getSettings.bind(track); if(window.__ownAudioIsolated) track.getSettings=()=>({...settings(),restrictOwnAudio:true}); track.applyConstraints=async options=>{window.__audioIsolationAttempted=options.restrictOwnAudio;throw new DOMException('Test: audio isolation unavailable','OverconstrainedError');}; s.addTrack(track); } return s; };
    });
    const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(url); pages.push(p);
    assert.equal(await p.locator('input[type=password]').count(), 0);
    if (name === 'A') { mkdirSync('test-results', { recursive: true }); await p.screenshot({ path: 'test-results/home.png', fullPage: true }); }
    await p.getByLabel('昵称', { exact: true }).fill(name); await p.getByRole('button', { name: '进入', exact: true }).click(); await p.getByRole('button', { name: '开始投屏' }).waitFor(); assert.equal(await p.getByLabel('投屏目标帧率').count(), 0); assert.equal(await p.getByLabel('视频码率上限').count(),0);
  }
  const [a, b] = pages;
  assert.equal(await a.locator('.screen-card[data-member="A"] input[type=range]').count(),0);
  assert.equal(await a.locator('.screen-card[data-member="B"] input[type=range]').count(),2);
  await a.getByRole('button',{name:'画质：最高',exact:true}).waitFor();
  await a.getByRole('button', { name: '开始投屏' }).click(); await b.getByRole('button', { name: '开始投屏' }).click(); assert.equal(await a.evaluate(()=>'frameRate' in window.__captureConstraints.video),false);
  assert.equal(await a.evaluate(()=>window.__captureConstraints.audio), true);
  await a.waitForFunction(()=>window.__audioIsolationAttempted===true);
  await pages[2].waitForFunction(()=>[...document.querySelectorAll('.member-ping')].length===2 && [...document.querySelectorAll('.member-ping')].every(e=>/经服务器约 \d+ ms/.test(e.textContent)));
  assert.equal(await a.locator('.screen-card[data-member="A"] .member-ping').count(),0);
  for (const p of pages) {
    try { await p.waitForFunction(() => document.querySelectorAll('video').length === 2 && [...document.querySelectorAll('video')].every(v => v.videoWidth > 0 && v.currentTime > 0)); }
    catch (e) { for (const page of pages) t.diagnostic(JSON.stringify(await page.evaluate(() => ({text:document.body.innerText, peers:window.__pcs.map(p=>({state:p.connectionState,signaling:p.signalingState,tracks:p.getSenders().map(s=>s.track?.kind)}))})))); throw e; }
    await p.getByRole('button', { name: '开启麦克风' }).click();
  }
  for (const p of pages) await p.waitForFunction(async () => { const reports = await Promise.all(window.__pcs.filter(p => p.connectionState === 'connected').map(p => p.getStats())); return reports.flatMap(s => [...s.values()]).filter(s => s.type === 'inbound-rtp' && s.kind === 'audio' && s.bytesReceived > 0).length >= 3; });
  for(const p of [a,b]) await p.waitForFunction(()=>{const audio=[...document.querySelectorAll('audio[data-channel]')];return audio.length>0&&audio.every(el=>el.muted);});
  assert.equal(await pages[2].locator('audio[data-channel]').first().evaluate(el=>el.muted),false);
  assert.equal(await a.locator('.screen-card[data-member="A"] video').evaluate(video=>video.muted&&video.srcObject.getAudioTracks().length===0),true);
  await a.getByLabel('聊天消息').fill('测试弹幕 hello'); await a.getByRole('button', { name: '发送', exact: true }).click();
  for (const p of pages) await p.locator('.messages').getByText('测试弹幕 hello').waitFor(); await b.locator('.bullet').first().waitFor();
  await b.getByRole('button', { name: '关闭弹幕' }).click(); assert.equal(await b.locator('.bullet').count(), 0);
  await a.locator('.screen-card[data-member="B"]').getByRole('button',{name:'全屏对方的画面',exact:true}).click();
  await a.getByLabel('全屏聊天消息').fill('全屏发送测试');
  await a.getByLabel('全屏聊天消息').press('Enter');
  await b.locator('.messages').getByText('全屏发送测试',{exact:true}).waitFor();
  await a.getByRole('button',{name:'收起聊天',exact:true}).click();assert.equal(await a.getByLabel('全屏聊天消息').count(),0);
  await a.getByRole('button',{name:'展开聊天',exact:true}).click();await a.getByLabel('全屏聊天消息').waitFor();
  await a.getByRole('button',{name:'退出全屏',exact:true}).click();await a.waitForFunction(()=>!document.fullscreenElement);
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
    assert.equal(await a.evaluate(()=>{const v=documentPictureInPicture.window.document.querySelector('.pip-live video');return v.muted&&v.srcObject.getAudioTracks().length===0;}),true);
    assert.equal(await a.evaluate(()=>documentPictureInPicture.window.document.querySelectorAll('.pip-live .bullet').length),0);
    await b.getByLabel('聊天消息').fill('只显示新弹幕');await b.getByRole('button',{name:'发送',exact:true}).click();
    await a.waitForFunction(()=>[...documentPictureInPicture.window.document.querySelectorAll('.pip-live .bullet')].some(e=>e.textContent.includes('只显示新弹幕')));
    await a.getByRole('button',{name:'弹幕小窗',exact:true}).click();
    await a.waitForFunction(()=>!!documentPictureInPicture.window?.document.querySelector('.pip-messages'));
    t.diagnostic('Real Document PiP received live chat, played the selected remote video, and switched back to chat.');
    await a.evaluate(() => documentPictureInPicture.window.close());
  } else t.diagnostic('Document PiP unavailable in this browser; native PiP test skipped.');
  await a.screenshot({ path: 'test-results/room.png', fullPage: true });
  await pages[2].getByRole('button',{name:'开始投屏',exact:true}).click();
  await b.waitForFunction(()=>document.querySelectorAll('video').length===3 && [...document.querySelectorAll('video')].every(v=>v.videoWidth>0));
  await pages[2].getByRole('button',{name:'停止投屏',exact:true}).click();
  await pages[2].waitForFunction(()=>[...document.querySelectorAll('audio[data-channel]')].every(el=>!el.muted));
  await a.getByRole('button',{name:'只分享画面并恢复收听',exact:true}).click();
  await b.locator('.screen-card[data-member="A"]').getByText('无系统音频',{exact:true}).waitFor();
  await a.waitForFunction(()=>[...document.querySelectorAll('audio[data-channel]')].every(el=>!el.muted)&&window.__pcs.filter(p=>p.connectionState==='connected').every(p=>p.getTransceivers()[1].sender.track===null));
  await a.getByRole('button',{name:'停止投屏',exact:true}).waitFor();
  await a.getByRole('button', { name: '停止投屏' }).click();
  await b.waitForFunction(() => document.querySelectorAll('video').length === 1);
  assert.equal(await b.getByRole('button', { name: '停止投屏' }).count(), 1);
  await a.getByRole('button', { name: '开始投屏' }).click();
  await b.reload(); await b.getByRole('button', { name: '开始投屏' }).waitFor();
  try { await b.waitForFunction(() => document.querySelector('video')?.videoWidth > 0); }
  catch (e) { t.diagnostic(JSON.stringify(await a.evaluate(() => ({ text: document.body.innerText, peers: window.__pcs.map(p => ({ connection: p.connectionState, signaling: p.signalingState, senders: p.getSenders().map(s => s.track?.readyState) })) })))); throw e; }
  await b.waitForFunction(()=>window.__pcs.filter(p=>p.connectionState==='connected').length===3);
  await b.evaluate(()=>{window.__beforeRetry=window.__pcs.filter(p=>p.connectionState==='connected');});
  await b.getByRole('button', { name: '重连', exact: true }).click();
  await b.waitForFunction(()=>window.__beforeRetry.every(p=>p.connectionState==='closed')&&window.__pcs.filter(p=>p.connectionState==='connected').length===3&&document.querySelector('video')?.videoWidth>0);
  await a.waitForFunction(()=>window.__pcs.filter(p=>p.connectionState==='connected').length===3);
  await a.evaluate(()=>{window.__beforeJoin=window.__pcs.filter(p=>p.connectionState==='connected');});
  const fifth=await browser.newPage();await fifth.goto(url);await fifth.getByLabel('昵称',{exact:true}).fill('E');await fifth.getByRole('button',{name:'进入',exact:true}).click();await fifth.getByText('5 人在线',{exact:true}).waitFor();
  await fifth.waitForFunction(()=>document.querySelector('video')?.videoWidth>0);
  assert.equal(await a.evaluate(()=>window.__beforeJoin.length===3&&window.__beforeJoin.every(p=>p.connectionState==='connected')),true);
  await fifth.getByRole('button',{name:'退出',exact:true}).click();await b.getByText('4 人在线',{exact:true}).waitFor();
  await a.getByRole('button', { name: '退出', exact: true }).click(); await b.getByText('3 人在线').waitFor();
  await b.setViewportSize({ width: 390, height: 844 }); assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await b.setViewportSize({ width: 1440, height: 900 });
  await b.getByRole('button',{name:'画质：最高',exact:true}).click();
  await b.getByRole('button',{name:'高帧率',exact:true}).click();
  await b.getByLabel('接收音量', { exact: true }).fill('45');
  const imageData = await b.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 8; const ctx = c.getContext('2d'); ctx.fillStyle = '#777'; ctx.fillRect(0,0,8,8); return c.toDataURL('image/png').split(',')[1]; });
  await b.getByLabel('背景图片').setInputFiles({ name: 'background.png', mimeType: 'image/png', buffer: Buffer.from(imageData,'base64') });
  await b.getByRole('button', { name: '恢复黑色背景' }).waitFor();
  await b.reload(); await b.getByRole('button', { name: '开始投屏' }).waitFor();
  await b.getByRole('button',{name:'画质：高帧率',exact:true}).waitFor();
  assert.equal(await b.getByLabel('接收音量', { exact: true }).inputValue(), '45');
  assert.match(await b.locator('.app').evaluate(e => getComputedStyle(e).backgroundImage), /data:image/);
  await b.evaluate(()=>{window.__ownAudioIsolated=true;});
  await b.getByRole('button', { name: '开始投屏' }).click();
  assert.equal(await b.evaluate(() => 'frameRate' in window.__captureConstraints.video), false);
  assert.equal(await b.evaluate(() => window.__captureConstraints.video.height.ideal),720);
  await b.waitForFunction(() => [...document.querySelectorAll('audio')].length > 0 && [...document.querySelectorAll('audio')].every(a => Math.abs(a.volume - .45) < .001));
  assert.equal(await b.locator('audio[data-channel]').first().evaluate(el=>el.muted),false);
  assert.equal(await b.getByRole('button',{name:'只分享画面并恢复收听',exact:true}).count(),0);
  await b.waitForFunction(() => { const peers=window.__pcs.filter(p=>p.connectionState==='connected'); return peers.length===2 && peers.every(p=>{const cfg=p.getSenders().find(s=>s.track?.kind==='video')?.getParameters();return cfg?.degradationPreference==='maintain-framerate' && cfg.encodings[0]?.maxBitrate===20000000 && cfg.encodings[0]?.maxFramerate==null;}); });
  await b.getByRole('button',{name:'画质：高帧率',exact:true}).click();await b.getByRole('button',{name:'最高',exact:true}).click();
  await b.waitForFunction(()=>window.__pcs.filter(p=>p.connectionState==='connected').some(p=>p.getSenders().find(s=>s.track?.kind==='video')?.getParameters().encodings[0]?.maxBitrate===40000000));
  const listener=pages[2]; await b.getByRole('button',{name:'开启麦克风',exact:true}).click();
  await listener.locator('.screen-card[data-member="B"]').getByText('正在投屏 · 麦克风开').waitFor();
  await listener.getByLabel('B 系统声音接收音量',{exact:true}).fill('0');
  await listener.getByLabel('B 麦克风接收音量',{exact:true}).fill('60');
  await listener.waitForFunction(()=>{ const card=document.querySelector('.screen-card[data-member="B"]'); return card.querySelector('audio[data-channel="system"]')?.volume===0 && card.querySelector('audio[data-channel="mic"]')?.volume===.6 && document.querySelector('.screen-card[data-member="D"] audio[data-channel="mic"]')?.volume===1; });
  await b.getByRole('button',{name:'停止投屏',exact:true}).click();
  await listener.locator('.screen-card[data-member="B"]').getByText('未投屏 · 麦克风开').waitFor();
  await b.getByRole('button',{name:'关闭麦克风',exact:true}).click();
  await listener.locator('.screen-card[data-member="B"]').getByText('未投屏 · 麦克风关').waitFor();
  await b.getByRole('button', { name: '恢复黑色背景' }).click();
  await b.reload(); await b.getByRole('button', { name: '开始投屏' }).waitFor();
  assert.equal(await b.locator('.app').evaluate(e=>getComputedStyle(e).backgroundImage), 'none');
  t.diagnostic('Muted video previews and PiP; no receive playback during unisolated system audio sharing; restoring playback does not stop video; browser-reported isolation keeps receive playback enabled.');
  assert.deepEqual(errors, []);
});

test('display video survives a rejected system audio track and supports a manual video-only retry', { timeout: 35000 }, async t => {
  const app = createApp({ production: false });
  let browser;
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => { await browser?.close(); await app.close(); });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
  const caster = await browser.newPage();
  const viewer = await browser.newPage();
  await caster.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    const replaceTrack = RTCRtpSender.prototype.replaceTrack;
    RTCRtpSender.prototype.replaceTrack = function(track) {
      if (track && track === window.systemTrackForTest) {
        window.audioRejected = true;
        return Promise.reject(new DOMException('Test: system audio sender rejected track', 'InvalidModificationError'));
      }
      return replaceTrack.call(this, track);
    };
    navigator.mediaDevices.getDisplayMedia = async ({ audio }) => {
      window.captureAttempts = (window.captureAttempts || 0) + 1;
      if (audio && window.failCapture) throw new DOMException('Test: capture audio unavailable', 'NotReadableError');
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const paint = canvas.getContext('2d');
      const stream = canvas.captureStream(15);
      setInterval(() => { paint.fillStyle = '#398'; paint.fillRect(0, 0, 320, 180); }, 50);
      if (audio) {
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        window.systemTrackForTest = destination.stream.getAudioTracks()[0];
        stream.addTrack(window.systemTrackForTest);
      }
      return stream;
    };
  });
  for (const [page, name] of [[caster, 'Caster'], [viewer, 'Viewer']]) {
    await page.goto(url);
    await page.getByLabel('昵称', { exact: true }).fill(name);
    await page.getByRole('button', { name: '进入', exact: true }).click();
  }
  await caster.getByText(/媒体 1\/1 已连接/).waitFor();
  const remoteVideo = viewer.locator('[data-member="Caster"] video');
  await caster.getByRole('button', { name: '开始投屏', exact: true }).click();
  await caster.waitForFunction(() => window.audioRejected);
  await remoteVideo.waitFor({ timeout: 5000 });
  await viewer.waitForFunction(() => document.querySelector('[data-member="Caster"] video')?.videoWidth > 0);
  await caster.getByRole('button', { name: '停止投屏', exact: true }).click();
  await remoteVideo.waitFor({ state: 'detached' });

  await caster.evaluate(() => { window.failCapture = true; window.captureAttempts = 0; });
  await caster.getByRole('button', { name: '开始投屏', exact: true }).click();
  const videoOnly = caster.getByRole('button', { name: '仅共享画面', exact: true });
  await videoOnly.waitFor();
  assert.equal(await caster.evaluate(() => window.captureAttempts), 1);
  await videoOnly.click();
  await viewer.waitForFunction(() => document.querySelector('[data-member="Caster"] video')?.videoWidth > 0);
  assert.equal(await caster.evaluate(() => window.captureAttempts), 2);
});
