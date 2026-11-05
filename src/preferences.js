const KEY = 'friends-live-preferences-v1';
export const defaults = { bitrate: 15, fps: 40, sendVolume: 1, receiveVolume: 1, background: '' };
export function loadPreferences() {
  let p; try { p = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { p = {}; }
  return {
    bitrate: [8, 15, 25, 40].includes(p.bitrate) ? p.bitrate : 15,
    fps: [30, 40, 60, null].includes(p.fps) ? p.fps : 40,
    sendVolume: typeof p.sendVolume === 'number' && p.sendVolume >= 0 && p.sendVolume <= 1 ? p.sendVolume : 1,
    receiveVolume: typeof p.receiveVolume === 'number' && p.receiveVolume >= 0 && p.receiveVolume <= 1 ? p.receiveVolume : 1,
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
