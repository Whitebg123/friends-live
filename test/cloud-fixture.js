import { createServer } from 'node:http';
import { once } from 'node:events';
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
export async function fakeCloud() {
  const objects=new Map();
  const server=createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer test-service-key'){res.writeHead(401).end();return;}
    const path=req.url;
    if(path==='/storage/v1/object/list/friends-live-emojis'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([...objects.keys()].map(name=>({name,created_at:new Date().toISOString()}))));return;}
    const prefix=req.method==='GET'?'/storage/v1/object/authenticated/friends-live-emojis/':'/storage/v1/object/friends-live-emojis/';
    if(!path.startsWith(prefix)){res.writeHead(404).end();return;}
    const id=path.slice(prefix.length);
    if(req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);objects.set(id,Buffer.concat(chunks));res.end('{}');}
    else if(objects.has(id)){res.setHeader('Content-Type','image/png');res.end(objects.get(id));}else res.writeHead(404).end();
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return { options:{url:`http://127.0.0.1:${server.address().port}`,key:'test-service-key'}, close:()=>new Promise(r=>server.close(r)) };
}

