import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot as mount } from 'react-dom/client';
import { Live } from './live.js';
import './style.css';
import { loadPreferences, backgroundFromFile } from './preferences.js';

function Media({ stream, audio = false, volume = 1, channel }) {
  const ref = useRef(); const [blocked, setBlocked] = useState(false);
  useEffect(() => { ref.current.srcObject = stream; if (stream) ref.current.play().then(() => setBlocked(false)).catch(() => setBlocked(true)); }, [stream]);
  useEffect(() => { if (audio && ref.current) ref.current.volume = volume; }, [volume, audio]);
  const Tag = audio ? 'audio' : 'video';
  return <><Tag ref={ref} autoPlay playsInline muted={!audio} data-channel={channel}/>{blocked && <button className="play" onClick={() => ref.current.play().then(() => setBlocked(false))}>播放{audio ? '声音' : '画面'}</button>}</>;
}
function Volume({label, description = label, value, onChange}) {
  const percent = Math.round(value * 100);
  return <label className="audio-slider"><span>{label}</span><input aria-label={description} type="range" min="0" max="100" value={percent} onChange={e=>onChange(Number(e.target.value)/100)}/><output>{percent}%</output></label>;
}
function Danmaku({ message, enabled }) {
  const [items, setItems] = useState([]);
  const lastSeen = useRef(message?.id);
  const timers = useRef(new Set());
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); }, []);
  useEffect(() => { if (!message || message.id === lastSeen.current) return; lastSeen.current = message.id; if (!enabled) return; setItems(xs => [...xs.filter(x => x.id !== message.id).slice(-7), message]); const id = setTimeout(() => { setItems(xs => xs.filter(x => x.id !== message.id)); timers.current.delete(id); }, 8000); timers.current.add(id); }, [message, enabled]);
  useEffect(() => { if (!enabled) setItems([]); }, [enabled]);
  return <div className="danmaku" aria-hidden="true">{enabled && items.map((m, i) => <span className={`bullet lane-${i % 4}`} key={m.id}>{m.name}: {m.emoji ? <img className="bullet-emoji" src={m.emoji.url} alt="表情包"/> : m.text}</span>)}</div>;
}
function Messages({ messages, compact = false }) {
  const end = useRef();
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);
  return <div className={compact ? 'pip-messages' : 'messages'}>{(compact ? messages.slice(-6) : messages).map(m => <div className="message" key={m.id}><b>{m.name}</b><span>{m.emoji ? <img className="chat-emoji" src={m.emoji.url} alt="表情包" loading="lazy"/> : m.text}</span></div>)}{!messages.length && <p className="muted">暂无消息</p>}<div ref={end}/></div>;
}
const quality = s => !s?.width ? '—' : `${s.width}×${s.height} · ${s.fps == null ? '—' : Math.round(s.fps)} FPS · ${s.bitrate == null ? '—' : s.bitrate.toFixed(1)} Mbps`;
function App() {
  const [s, setS] = useState(() => ({ messages: [], stats: {}, preferences: loadPreferences() })); const live = useRef();
  const [name, setName] = useState(localStorage.getItem('friends-name') || ''), [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [danmaku, setDanmaku] = useState(true), [pip, setPip] = useState(null);
  const [emojiOpen,setEmojiOpen]=useState(false), [uploading,setUploading]=useState(false); const emojiInput=useRef();
  const [pipTarget, setPipTarget] = useState(null);
  const [fullscreen, setFullscreen] = useState(null), [fullscreenChat, setFullscreenChat] = useState(true);
  const pipRef = useRef(); const backgroundInput = useRef(); const prefs = s.preferences || loadPreferences();
  useEffect(() => { const l = new Live(setS); live.current = l; return () => { l.destroy(); pipRef.current?.close(); }; }, []);
  useEffect(() => {
    const update = () => { setFullscreen(document.fullscreenElement?.id || null); setFullscreenChat(true); };
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => { if (!s.room) { pipRef.current?.close(); setPip(null); } }, [s.room]);
  const action = fn => async () => { setBusy(true); try { await fn(); } catch (e) { live.current.emit({ error: e.message }); } finally { setBusy(false); } };
  async function openPip(memberId = null) {
    const title = memberId ? '直播小窗' : '弹幕小窗';
    if (pipRef.current && !pipRef.current.closed) { pipRef.current.document.title = title; setPipTarget(memberId); pipRef.current.focus(); return; }
    if (!window.documentPictureInPicture?.requestWindow) throw Error('此浏览器不支持弹幕画中画，请使用新版桌面 Chrome / Edge');
    const w = await window.documentPictureInPicture.requestWindow(memberId ? { width: 500, height: 300 } : { width: 320, height: 180 });
    pipRef.current = w; w.document.title = title; setPipTarget(memberId);
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) { const copy = w.document.createElement('link'); copy.rel = 'stylesheet'; copy.href = link.href; w.document.head.appendChild(copy); }
    w.document.body.className = 'pip-body';
    w.addEventListener('pagehide', () => { if (pipRef.current === w) { pipRef.current = null; setPip(null); } });
    setPip(w);
  }
  async function chat(e) { e.preventDefault(); if (!text.trim()) return; const value = text; setText(''); try { await live.current.request({ type: 'chat', text: value }); } catch (e) { setText(value); live.current.emit({ error: e.message }); } }
  const changeVolume = (channel, value, memberId) => { try { live.current.setVolume(channel, value, memberId); } catch (e) { live.current.emit({error:e.message}); } };
  const self = s.room?.members.find(m => m.id === s.selfId); const others = s.room?.members.filter(m => m.id !== s.selfId) || []; const peerStates = Object.values(s.remotePeers || {}); const sharers = s.room?.members.filter(m => m.sharing).length || 0;
  const pipMember = pipTarget ? s.room?.members.find(m=>m.id===pipTarget) : null;
  const pipStream = pipTarget === s.selfId ? s.localVideo : s.remotePeers?.[pipTarget]?.remoteVideo;
  return <div className="app" style={prefs.background ? { backgroundImage: `linear-gradient(#000b, #000b), url("${prefs.background}")` } : undefined}><header><b>Friends Live</b><span>{s.room ? `${s.room.members.filter(m => m.online).length} 人在线` : '屏幕共享'}</span></header>
    {!s.room ? <main className="login"><form onSubmit={e => { e.preventDefault(); try { live.current.login(name); } catch (e) { live.current.emit({ error: e.message }); } }}><h1>登录</h1><p>输入昵称，直接进入。</p><label htmlFor="name">昵称</label><input id="name" required maxLength={32} autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} placeholder="你的昵称"/><button className="primary" disabled={!s.connected}>进入</button><small>{s.status}</small></form></main> : <main className="room"><div className="toolbar"><button className="primary" disabled={busy || !s.connected} onClick={action(() => self?.sharing ? live.current.stop() : live.current.share())}>{self?.sharing ? '停止投屏' : '开始投屏'}</button><button disabled={busy || !s.connected} onClick={action(() => live.current.microphone())}>{s.mic ? '关闭麦克风' : '开启麦克风'}</button><button onClick={() => setDanmaku(!danmaku)}>{danmaku ? '关闭弹幕' : '开启弹幕'}</button><button onClick={action(openPip)}>弹幕小窗</button><button onClick={action(() => navigator.clipboard.writeText(location.origin))}>复制网址</button><button onClick={action(() => live.current.retryMedia())} disabled={!others.some(m => m.online)}>重连</button><button onClick={() => backgroundInput.current.click()}>自定义背景</button><input ref={backgroundInput} type="file" aria-label="背景图片" accept="image/png,image/jpeg,image/webp" hidden onChange={async e => { const file = e.target.files[0]; e.target.value = ''; if (!file) return; try { const background = await backgroundFromFile(file); live.current.preference({ background }); } catch (err) { live.current.emit({ error: err.message }); } }}/>{prefs.background && <button onClick={action(() => live.current.preference({ background: '' }))}>恢复黑色背景</button>}<button className="leave" onClick={() => live.current.leave()}>退出</button></div><div className="volume-controls"><Volume label="接收总音量" description="接收音量" value={prefs.receiveVolume} onChange={value=>changeVolume('receive',value)}/></div><div className="content"><section className="screens">{[{ m: self, stream: s.localVideo, local: true }, ...others.map(m => ({ m, stream: s.remotePeers?.[m.id]?.remoteVideo, local: false }))].map(({ m, stream, local }) => <article className="screen-card" key={m.id} data-member={m.name}><div className="screen-label"><span className="member-title"><span className="member-name">{m.name}{local ? '（你）' : ''}</span>{!local && m.sharing && <small className="member-ping" title="投屏者 → 网站服务器 → 你（往返探测折半估算，不含视频编码解码）">{s.latency?.[m.id] == null ? '经服务器 —' : '经服务器约 '+Math.round(s.latency[m.id])+' ms'}</small>}</span><span>{m?.sharing ? '正在投屏' : m?.online ? '未投屏' : '离线'} · {m.mic ? '麦克风开' : '麦克风关'}</span></div><div className="screen" id={'screen-' + m.id}>{m?.sharing && stream ? <Media stream={stream}/> : <p>{local ? '点击上方「开始投屏」' : m?.sharing ? '正在接收画面' : '等待对方投屏'}</p>}<Danmaku message={s.latestChat} enabled={danmaku}/><button className="full" aria-label={fullscreen === 'screen-' + m.id ? '退出全屏' : local ? '全屏自己的画面' : '全屏对方的画面'} onClick={action(() => fullscreen === 'screen-' + m.id ? document.exitFullscreen() : document.getElementById('screen-' + m.id).requestFullscreen())}>{fullscreen === 'screen-' + m.id ? '退出全屏' : '全屏'}</button>
{fullscreen === 'screen-' + m.id && (fullscreenChat ? <aside className="fullscreen-chat" aria-label="全屏聊天"><div className="fullscreen-chat-title"><b>聊天 / 弹幕</b><button onClick={()=>setFullscreenChat(false)}>收起聊天</button></div><Messages messages={s.messages} compact/><form onSubmit={chat}><input aria-label="全屏聊天消息" placeholder="发送弹幕，按 Enter" maxLength={300} value={text} onChange={e=>setText(e.target.value)} disabled={!s.connected}/><button disabled={!s.connected || !text.trim()}>发送弹幕</button></form></aside> : <button className="fullscreen-chat-toggle" onClick={()=>setFullscreenChat(true)}>展开聊天</button>)}{m.sharing && stream && <button className="live-pip-button" onClick={action(()=>openPip(m.id))}>直播小窗</button>}</div><div className="screen-stats">{quality(local ? peerStates.find(p => p.stats?.sent?.width)?.stats.sent : s.remotePeers?.[m.id]?.stats?.received)}<span>{m?.systemAudio ? '系统音频已开启' : '无系统音频'}</span></div><div className="screen-audio" aria-label={local ? '我的发送音量' : m.name+'的接收音量'}>{['mic','system'].map(channel=>{
  const label=channel==='mic'?'麦克风':'系统声音';
  const value=local ? (channel==='mic'?prefs.micVolume:prefs.systemVolume) : (prefs.peerVolumes[m.id]?.[channel] ?? 1);
  const audioStream=local ? null : s.remotePeers?.[m.id]?.remoteAudio?.[channel];
  return <React.Fragment key={channel}><Volume label={label} description={local ? (channel==='mic'?'发送麦克风音量':'发送系统音量') : m.name+' '+label+'接收音量'} value={value} onChange={level=>changeVolume(channel,level,local?undefined:m.id)}/>{audioStream && <Media key={audioStream.id} stream={audioStream} audio channel={channel} volume={value*prefs.receiveVolume}/>}</React.Fragment>;
})}</div></article>)}</section><aside className="chat"><h2>聊天<button className="emoji-toggle" onClick={() => { setEmojiOpen(!emojiOpen); if (!emojiOpen) live.current.loadEmojis().catch(e => live.current.emit({emojiError:e.message})); }}>表情</button></h2><Messages messages={s.messages}/>{emojiOpen && <section className="emoji-panel" aria-label="共享表情库"><div className="emoji-unicode">{['😀','😂','🥲','🥳','👍','❤️'].map(x=><button key={x} aria-label={'插入'+x} onClick={()=>setText(t=>t+x)}>{x}</button>)}</div><div className="emoji-panel-actions"><span>共享表情包</span><button disabled={uploading || !s.emojiConfigured} onClick={()=>emojiInput.current.click()}>{uploading ? '上传中…' : '上传表情'}</button><button aria-label="刷新表情库" onClick={action(()=>live.current.loadEmojis())}>刷新</button></div><input hidden ref={emojiInput} type="file" aria-label="上传表情图片" accept="image/png,image/jpeg,image/gif,image/webp" onChange={async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;setUploading(true);try{await live.current.uploadEmoji(file);}catch(err){live.current.emit({error:err.message});}finally{setUploading(false);}}}/>{s.emojiError && <p className="emoji-hint">{s.emojiError}</p>}{s.emojiConfigured===false && <p className="emoji-hint">云端表情库尚未启用，请联系网站管理员。上方普通表情可直接使用。</p>}<div className="emoji-grid">{s.emojis?.map(item=><button key={item.id} aria-label="发送共享表情" title="点击发送" onClick={action(()=>live.current.request({type:'chat',emojiId:item.id}))}><img src={item.url} alt="共享表情" loading="lazy"/></button>)}</div>{s.emojiConfigured && !s.emojis?.length && <p className="emoji-hint">还没有表情包，上传后所有人都能使用。</p>}</section>}<form onSubmit={chat}><input aria-label="聊天消息" placeholder="发送消息 / 弹幕" maxLength={300} value={text} onChange={e => setText(e.target.value)} disabled={!s.connected}/><button disabled={!s.connected || !text.trim()}>发送</button></form></aside></div><div className="connection">{s.status} · 媒体 {peerStates.filter(p => p.mediaStatus === 'connected').length + '/' + others.filter(m => m.online).length + ' 已连接'} · {sharers} 人投屏<span>目标 1080p · 帧率无上限 · 40 Mbps / 人</span></div></main>}
    {pip && createPortal(pipTarget ? <div className="pip-live">
      {pipMember?.sharing && pipStream ? <Media stream={pipStream}/> : <p>{pipMember ? '等待成员继续投屏' : '成员已离开'}</p>}
      <Danmaku message={s.latestChat} enabled={danmaku}/>
      <div className="pip-live-name">{pipMember?.name || '直播小窗'}<button onClick={action(()=>openPip())}>查看聊天</button></div>
    </div> : <div className="pip-chat"><Messages messages={s.messages} compact/></div>, pip.document.body)}
    {(s.error || s.notice) && <div className="toast" role="alert"><span>{s.error || s.notice}</span><button aria-label="关闭提示" onClick={() => live.current.emit({ error: '', notice: '' })}>×</button></div>}
  </div>;
}
mount(document.getElementById('root')).render(<App/>);
