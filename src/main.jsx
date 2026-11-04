import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot as mount } from 'react-dom/client';
import { Live } from './live.js';
import './style.css';

function Media({ stream, audio = false }) {
  const ref = useRef(); const [blocked, setBlocked] = useState(false);
  useEffect(() => { ref.current.srcObject = stream; if (stream) ref.current.play().then(() => setBlocked(false)).catch(() => setBlocked(true)); }, [stream]);
  const Tag = audio ? 'audio' : 'video';
  return <><Tag ref={ref} autoPlay playsInline muted={!audio}/>{blocked && <button className="play" onClick={() => ref.current.play().then(() => setBlocked(false))}>播放{audio ? '声音' : '画面'}</button>}</>;
}
function Danmaku({ message, enabled }) {
  const [items, setItems] = useState([]);
  const timers = useRef(new Set());
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); }, []);
  useEffect(() => { if (!message || !enabled) return; setItems(xs => [...xs.filter(x => x.id !== message.id).slice(-7), message]); const id = setTimeout(() => { setItems(xs => xs.filter(x => x.id !== message.id)); timers.current.delete(id); }, 8000); timers.current.add(id); }, [message, enabled]);
  useEffect(() => { if (!enabled) setItems([]); }, [enabled]);
  return <div className="danmaku" aria-hidden="true">{enabled && items.map((m, i) => <span className={`bullet lane-${i % 4}`} key={m.id}>{m.name}: {m.text}</span>)}</div>;
}
function Messages({ messages, compact = false }) {
  const end = useRef();
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);
  return <div className={compact ? 'pip-messages' : 'messages'}>{(compact ? messages.slice(-6) : messages).map(m => <div className="message" key={m.id}><b>{m.name}</b><span>{m.text}</span></div>)}{!messages.length && <p className="muted">暂无消息</p>}<div ref={end}/></div>;
}
const quality = s => !s?.width ? '—' : `${s.width}×${s.height} · ${s.fps == null ? '—' : Math.round(s.fps)} FPS · ${s.bitrate == null ? '—' : s.bitrate.toFixed(1)} Mbps`;
function App() {
  const [s, setS] = useState({ messages: [], stats: {} }); const live = useRef();
  const [name, setName] = useState(localStorage.getItem('friends-name') || ''), [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [danmaku, setDanmaku] = useState(true), [pip, setPip] = useState(null);
  const pipRef = useRef();
  useEffect(() => { const l = new Live(setS); live.current = l; return () => { l.destroy(); pipRef.current?.close(); }; }, []);
  useEffect(() => { if (!s.room) { pipRef.current?.close(); setPip(null); } }, [s.room]);
  const action = fn => async () => { setBusy(true); try { await fn(); } catch (e) { live.current.emit({ error: e.message }); } finally { setBusy(false); } };
  async function openPip() {
    if (pipRef.current && !pipRef.current.closed) { pipRef.current.focus(); return; }
    if (!window.documentPictureInPicture?.requestWindow) throw Error('此浏览器不支持弹幕画中画，请使用新版桌面 Chrome / Edge');
    const w = await window.documentPictureInPicture.requestWindow({ width: 320, height: 180 });
    pipRef.current = w; w.document.title = '弹幕';
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) { const copy = w.document.createElement('link'); copy.rel = 'stylesheet'; copy.href = link.href; w.document.head.appendChild(copy); }
    w.document.body.className = 'pip-body';
    w.addEventListener('pagehide', () => { if (pipRef.current === w) { pipRef.current = null; setPip(null); } });
    setPip(w);
  }
  async function chat(e) { e.preventDefault(); if (!text.trim()) return; const value = text; setText(''); try { await live.current.request({ type: 'chat', text: value }); } catch (e) { setText(value); live.current.emit({ error: e.message }); } }
  const self = s.room?.members.find(m => m.id === s.selfId), other = s.room?.members.find(m => m.id !== s.selfId);
  return <div className="app"><header><b>Friends Live</b><span>{s.room ? `${s.room.members.filter(m => m.online).length} / 2 在线` : '双人投屏'}</span></header>
    {!s.room ? <main className="login"><form onSubmit={e => { e.preventDefault(); try { live.current.login(name); } catch (e) { live.current.emit({ error: e.message }); } }}><h1>登录</h1><p>输入昵称，直接进入。</p><label htmlFor="name">昵称</label><input id="name" required maxLength={32} autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} placeholder="你的昵称"/><button className="primary" disabled={!s.connected}>进入</button><small>{s.status}</small></form></main> : <main className="room"><div className="toolbar"><button className="primary" disabled={busy || !s.connected} onClick={action(() => self?.sharing ? live.current.stop() : live.current.share())}>{self?.sharing ? '停止投屏' : '开始投屏'}</button><button disabled={busy || !s.connected} onClick={action(() => live.current.microphone())}>{s.mic ? '关闭麦克风' : '开启麦克风'}</button><button onClick={() => setDanmaku(!danmaku)}>{danmaku ? '关闭弹幕' : '开启弹幕'}</button><button onClick={action(openPip)}>弹幕小窗</button><button onClick={action(() => navigator.clipboard.writeText(location.origin))}>复制网址</button><button onClick={action(() => live.current.retryMedia())} disabled={!other?.online}>重连</button><select aria-label="视频码率上限" defaultValue="15" onChange={e => live.current.setBitrate(e.target.value)}><option value="8">8 Mbps</option><option value="15">15 Mbps</option><option value="25">25 Mbps</option><option value="40">40 Mbps</option></select><button className="leave" onClick={() => live.current.leave()}>退出</button></div><div className="content"><section className="screens">{[{ m: self, stream: s.localVideo, local: true }, { m: other, stream: s.remoteVideo, local: false }].map(({ m, stream, local }) => <article className="screen-card" key={local ? 'self' : 'other'}><div className="screen-label"><span>{m ? m.name : '等待另一人'}{local ? '（你）' : ''}</span><span>{m?.sharing ? '正在投屏' : m?.online ? '未投屏' : '离线'}</span></div><div className="screen">{m?.sharing && stream ? <Media stream={stream}/> : <p>{local ? '点击上方「开始投屏」' : m?.sharing ? '正在接收画面' : '等待对方投屏'}</p>}<Danmaku message={s.latestChat} enabled={danmaku}/><button className="full" aria-label={local ? '全屏自己的画面' : '全屏对方的画面'} onClick={action(() => document.querySelectorAll('.screen')[local ? 0 : 1].requestFullscreen())}>全屏</button></div><div className="screen-stats">{quality(local ? s.stats.sent : s.stats.received)}<span>{m?.systemAudio ? '系统音频已开启' : '无系统音频'}</span></div></article>)}</section><aside className="chat"><h2>聊天</h2><Messages messages={s.messages}/><form onSubmit={chat}><input aria-label="聊天消息" placeholder="发送消息 / 弹幕" maxLength={300} value={text} onChange={e => setText(e.target.value)} disabled={!s.connected}/><button disabled={!s.connected || !text.trim()}>发送</button></form></aside></div><div className="connection">{s.status} · 媒体 {s.mediaStatus || '等待连接'} · {s.stats.route || '—'} · RTT {s.stats.rtt == null ? '—' : Math.round(s.stats.rtt) + ' ms'}<span>目标 1080p / 60 FPS</span></div>{s.remoteAudio?.map(a => <Media key={a.id} stream={a} audio/>)}</main>}
    {pip && createPortal(<div className="pip-chat"><Messages messages={s.messages} compact/></div>, pip.document.body)}
    {(s.error || s.notice) && <div className="toast" role="alert"><span>{s.error || s.notice}</span><button aria-label="关闭提示" onClick={() => live.current.emit({ error: '', notice: '' })}>×</button></div>}
  </div>;
}
mount(document.getElementById('root')).render(<App/>);
