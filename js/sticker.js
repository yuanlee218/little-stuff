// Turn a photo + foreground mask into a die-cut sticker (white outline + soft shadow).

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Load a File into a canvas, longest side <= maxSide.
export async function fileToCanvas(file, maxSide = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = makeCanvas(Math.round(img.naturalWidth * s), Math.round(img.naturalHeight * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function makeSticker(src, mask, maxOut = 640) {
  const w = src.width, h = src.height;
  const cut = makeCanvas(w, h);
  const cx = cut.getContext('2d');
  cx.drawImage(src, 0, 0);
  const id = cx.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let i = 0; i < w * h; i++) {
    const a = mask[i];
    id.data[i * 4 + 3] = a < 50 ? 0 : a > 200 ? 255 : a;
    if (a > 128) {
      count++;
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const frac = count / (w * h);
  if (frac < 0.01 || frac > 0.97) return { canvas: polaroid(src, maxOut), cutout: false };
  cx.putImageData(id, 0, 0);

  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const scale = Math.min(1, maxOut / Math.max(bw, bh));
  const sw = Math.round(bw * scale), sh = Math.round(bh * scale);
  const stroke = Math.round(Math.max(sw, sh) * 0.035) + 5;
  const pad = stroke + 10;
  const W = sw + pad * 2, H = sh + pad * 2;

  // the cut-out, cropped + scaled
  const piece = makeCanvas(W, H);
  piece.getContext('2d').drawImage(cut, minX, minY, bw, bh, pad, pad, sw, sh);

  // white silhouette
  const sil = makeCanvas(W, H);
  const sx = sil.getContext('2d');
  sx.drawImage(piece, 0, 0);
  sx.globalCompositeOperation = 'source-in';
  sx.fillStyle = '#fff';
  sx.fillRect(0, 0, W, H);

  // outline = silhouette stamped in a ring
  const ring = makeCanvas(W, H);
  const rx = ring.getContext('2d');
  for (let r = stroke; r > 0; r -= Math.max(2, stroke / 3)) {
    for (let k = 0; k < 24; k++) {
      const t = (k / 24) * Math.PI * 2;
      rx.drawImage(sil, Math.cos(t) * r, Math.sin(t) * r);
    }
  }
  rx.drawImage(sil, 0, 0);

  const out = makeCanvas(W, H);
  const ox = out.getContext('2d');
  ox.shadowColor = 'rgba(70, 55, 40, 0.28)';
  ox.shadowBlur = 8;
  ox.shadowOffsetY = 3;
  ox.drawImage(ring, 0, 0);
  ox.shadowColor = 'transparent';
  ox.drawImage(piece, 0, 0);
  return { canvas: out, cutout: true };
}

// Fallback when the cut-out fails: a little white-framed photo sticker.
export function polaroid(src, maxOut = 640) {
  const s = Math.min(1, (maxOut - 40) / Math.max(src.width, src.height));
  const w = Math.round(src.width * s), h = Math.round(src.height * s);
  const b = 14;
  const out = makeCanvas(w + b * 2 + 16, h + b * 2 + 16);
  const x = out.getContext('2d');
  x.shadowColor = 'rgba(70, 55, 40, 0.28)';
  x.shadowBlur = 8; x.shadowOffsetY = 3;
  x.fillStyle = '#fff';
  roundRect(x, 8, 8, w + b * 2, h + b * 2, 18); x.fill();
  x.shadowColor = 'transparent';
  x.save();
  roundRect(x, 8 + b, 8 + b, w, h, 10); x.clip();
  x.drawImage(src, 8 + b, 8 + b, w, h);
  x.restore();
  return out;
}

function roundRect(x, l, t, w, h, r) {
  x.beginPath();
  x.moveTo(l + r, t);
  x.arcTo(l + w, t, l + w, t + h, r);
  x.arcTo(l + w, t + h, l, t + h, r);
  x.arcTo(l, t + h, l, t, r);
  x.arcTo(l, t, l + w, t, r);
  x.closePath();
}

export const toBlob = (canvas, type = 'image/png', q) => new Promise((r) => canvas.toBlob(r, type, q));
