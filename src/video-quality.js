export const videoQuality = Object.freeze({
  highest: { label: '最高', width: 1920, height: 1080, maxBitrate: 40_000_000, priority: 'maintain-resolution' },
  smooth: { label: '高帧率', width: 1280, height: 720, maxBitrate: 20_000_000, priority: 'maintain-framerate' },
  economy: { label: '省带宽', width: 960, height: 540, maxBitrate: 8_000_000, priority: 'maintain-framerate' }
});

export function captureConstraints(profile) { return { width: { ideal: profile.width }, height: { ideal: profile.height } }; }
