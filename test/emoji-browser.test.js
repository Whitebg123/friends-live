import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.js';
import { EmojiStore } from '../server/emojis.js';
import { fakeCloud } from './cloud-fixture.js';
test('browser uploads cloud sticker, other member sees library and reuses it; unicode and PiP render correctly', {timeout:45000}, async t=>{
  const cloud=await fakeCloud();const app=createApp({production:false,emojiStore:new EmojiStore(cloud.options)});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser=await chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
  t.after(async()=>{await browser.close();await app.close();await cloud.close();});
  const url=`http://127.0.0.1:${app.server.address().port}`, pages=[];
  for(const name of ['Sticker A','Sticker B']){const context=await browser.newContext();const p=await context.newPage();await p.goto(url);await p.getByLabel('昵称',{exact:true}).fill(name);await p.getByRole('button',{name:'进入',exact:true}).click();await p.getByRole('button',{name:'表情',exact:true}).click();await p.getByRole('button',{name:'上传表情',exact:true}).waitFor();pages.push(p);}
  const [a,b]=pages;
  const data=await a.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=16;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,16,16);return c.toDataURL('image/png').split(',')[1];});
  await a.getByLabel('上传表情图片').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
  await a.getByRole('button',{name:'发送共享表情',exact:true}).waitFor();await b.getByRole('button',{name:'发送共享表情',exact:true}).waitFor();
  await a.getByRole('button',{name:'发送共享表情',exact:true}).click();await b.locator('.messages img.chat-emoji').waitFor();
  assert.ok(await b.locator('.messages img.chat-emoji').evaluate(img=>img.complete&&img.naturalWidth>0));
  await b.getByRole('button',{name:'发送共享表情',exact:true}).click();await a.waitForFunction(()=>document.querySelectorAll('.messages img.chat-emoji').length===2);
  await b.reload();await b.getByRole('button',{name:'表情',exact:true}).click();await b.getByRole('button',{name:'发送共享表情',exact:true}).waitFor();
  await a.getByRole('button',{name:'插入😀',exact:true}).click();assert.equal(await a.getByLabel('聊天消息').inputValue(),'😀');await a.getByRole('button',{name:'发送',exact:true}).click();await b.locator('.messages').getByText('😀',{exact:true}).waitFor();
  if(await b.evaluate(()=>!!window.documentPictureInPicture)){await b.getByRole('button',{name:'弹幕小窗',exact:true}).click();await b.waitForFunction(()=>documentPictureInPicture.window?.document.querySelectorAll('img.chat-emoji').length===2);await b.evaluate(()=>documentPictureInPicture.window.close());}
});
