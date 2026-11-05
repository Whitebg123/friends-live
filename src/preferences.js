const KEY = 'friends-live-preferences-v1';
const level = (v, fallback = 1) => typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback;
export function loadPreferences() {
  let p; try { p = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { p = {}; }
  return {
    micVolume: level(p.micVolume, level(p.sendVolume)),
    systemVolume: level(p.systemVolume, level(p.sendVolume)),
    receiveVolume: level(p.receiveVolume),
    peerVolumes: Object.fromEntries(Object.entries(p.peerVolumes || {}).filter(([id, value]) => /^[\w-]{32}$/.test(id) && value && typeof value === 'object').slice(-64).map(([id, value]) => [id, { mic: level(value.mic), system: level(value.system) }])),
    background: typeof p.background === 'string' && /^data:image\/(webp|png|jpeg);base64,/.test(p.background) && p.background.length < 2800000 ? p.background : ''
  };
}
export function savePreferences(p) { localStorage.setItem(KEY, JSON.stringify(p)); }
export async function backgroundFromFile(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw Error('请选择 10 MB 以内的 JPG、PNG 或 WebP 图片');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/webp', .8);
    if (data.length >= 2800000) throw Error('图片过大，请换一张较小的图片');
    return data;
  } finally { bitmap.close(); }
}
