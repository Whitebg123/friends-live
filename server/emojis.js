import { createHash } from 'node:crypto';
const MAX_BYTES = 2 * 1024 * 1024;
const KEY = /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/;
function imageType(bytes) {
  if (bytes.length < 16) return null;
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['png','image/png'];
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['jpg','image/jpeg'];
  if (/^GIF8[79]a$/.test(bytes.toString('ascii',0,6))) return ['gif','image/gif'];
  if (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return ['webp','image/webp'];
  return null;
}
export class EmojiStore {
  constructor({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, bucket = process.env.EMOJI_BUCKET || 'friends-live-emojis' } = {}) {
    this.enabled = !!(url && key); this.url = url?.replace(/\/$/,''); this.key = key; this.bucket = bucket;
    this.queue = Promise.resolve();
  }
  async call(route, options = {}) {
    if (!this.enabled) throw Error('云端表情库尚未配置，请联系网站管理员');
    const response = await fetch(`${this.url}/storage/v1/${route}`, { ...options, headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, ...options.headers }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('云端表情库访问失败，请检查存储配置或稍后重试');
    return response;
  }
  async list() {
    const r = await this.call(`object/list/${encodeURIComponent(this.bucket)}`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ prefix:'', limit:201, offset:0, sortBy:{column:'created_at',order:'desc'} }) });
    const rows = await r.json(); if (!Array.isArray(rows)) throw Error('云端表情库响应无效');
    return rows.filter(x => KEY.test(x.name)).slice(0,200).map(x => ({ id:x.name, url:`/api/emojis/${x.name}`, name:'共享表情', createdAt:x.created_at }));
  }
  async upload(bytes) {
    const action = async () => {
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw Error('表情图片最大 2 MB');
      const type = imageType(bytes); if (!type) throw Error('仅支持 PNG、JPG、GIF、WebP 图片，不支持 SVG');
      const id = `${createHash('sha256').update(bytes).digest('hex')}.${type[0]}`;
      const items = await this.list(); const existing = items.find(x => x.id === id); if (existing) return existing;
      if (items.length >= 200) throw Error('共享表情库已满（最多 200 张）');
      await this.call(`object/${encodeURIComponent(this.bucket)}/${id}`, { method:'POST', headers:{'Content-Type':type[1], 'x-upsert':'false'}, body:bytes });
      return { id, url:`/api/emojis/${id}`, name:'共享表情' };
    };
    const result = this.queue.then(action); this.queue = result.catch(() => {}); return result;
  }
  async read(id) {
    if (!KEY.test(id)) throw Error('表情不存在');
    const r = await this.call(`object/authenticated/${encodeURIComponent(this.bucket)}/${id}`);
    if (Number(r.headers.get('content-length')) > MAX_BYTES) throw Error('表情图片过大');
    const reader = r.body.getReader(); const chunks = []; let length = 0;
    try { while (true) { const {value,done}=await reader.read(); if(done)break; length+=value.length; if(length>MAX_BYTES)throw Error('表情图片过大'); chunks.push(Buffer.from(value)); } }
    finally { await reader.cancel().catch(()=>{}); }
    const bytes=Buffer.concat(chunks), type=imageType(bytes); if (!type) throw Error('无效的表情图片');
    return { bytes, mime:type[1] };
  }
}
export function emojiRoutes(app, { express, store, memberForToken, allow, changed }) {
  const auth = (req,res,next) => { const member=memberForToken(req.headers.authorization?.replace(/^Bearer /,'')); if(!member){res.status(401).json({error:'请先登录'});return;} req.member=member; next(); };
  app.get('/api/emojis', auth, async (req,res) => {
    if (!allow(`emojilist:${req.member.id}`,60)) return res.status(429).json({error:'请求太快，请稍后重试'});
    res.set('Cache-Control','no-store');
    if(!store.enabled) return res.json({ configured:false, items:[] });
    try { res.json({configured:true,items:await store.list()}); } catch(e) {res.status(503).json({error:e.message});}
  });
  app.post('/api/emojis', auth, (req,res,next) => { if(!store.enabled)return res.status(503).json({error:'云端表情库尚未配置，请联系网站管理员'}); if(!allow(`emojiupload:${req.member.id}`,10)||!allow('emojiupload:all',20))return res.status(429).json({error:'上传太快，请稍后重试'}); next(); }, express.raw({type:'application/octet-stream',limit:MAX_BYTES}), async (req,res) => {
    try { const item=await store.upload(req.body); changed(); res.status(201).json({item}); } catch(e) { res.status(400).json({error:e.message}); }
  });
  // Random content-addressed image URLs can be embedded in chat and PiP; credentials never leave the server.
  app.get('/api/emojis/:id', async (req,res) => { try { const image=await store.read(req.params.id); res.set({'Content-Type':image.mime,'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}).send(image.bytes); } catch {res.status(404).end();} });
  app.use('/api/emojis', (err,req,res,next) => { if(err.type==='entity.too.large')return res.status(413).json({error:'表情图片最大 2 MB'}); next(err); });
}
