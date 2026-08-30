// PNG minimal : decode -> RGBA8 plat, encode <- RGBA8 plat.
// zlib natif de Node, aucune dependance npm.
'use strict';
const zlib = require('zlib');

// ---------- CRC32 (table PNG standard) ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ---------- Decode ----------
function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('signature PNG absente');
  let pos = 8, ihdr = null, idat = [], palette = null, trns = null;

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        depth: data[8], colorType: data[9], interlace: data[12]
      };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error('IHDR manquant');
  if (ihdr.interlace !== 0) throw new Error('PNG entrelace non gere');
  if (ihdr.depth !== 8) throw new Error('profondeur ' + ihdr.depth + ' non geree');

  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const ch = CHANNELS[ihdr.colorType];
  if (!ch) throw new Error('colorType ' + ihdr.colorType + ' non gere');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width, height } = ihdr;
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);

  // defiltrage ligne par ligne (types 0..4 de la spec PNG)
  let ip = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[ip++];
    const line = raw.slice(ip, ip + stride); ip += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = (prev && i >= ch) ? prev[i - ch] : 0;
      let v = line[i];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error('filtre PNG inconnu ' + filter);
      }
      cur[i] = v & 0xff;
    }
  }

  // normalisation en RGBA8
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    let r, g, b, a = 255;
    switch (ihdr.colorType) {
      case 0: r = g = b = out[i]; break;
      case 2: r = out[i*3]; g = out[i*3+1]; b = out[i*3+2]; break;
      case 3: {
        const idx = out[i];
        r = palette[idx*3]; g = palette[idx*3+1]; b = palette[idx*3+2];
        if (trns && idx < trns.length) a = trns[idx];
        break;
      }
      case 4: r = g = b = out[i*2]; a = out[i*2+1]; break;
      case 6: r = out[i*4]; g = out[i*4+1]; b = out[i*4+2]; a = out[i*4+3]; break;
    }
    rgba[i*4] = r; rgba[i*4+1] = g; rgba[i*4+2] = b; rgba[i*4+3] = a;
  }
  return { width, height, data: rgba };
}

// ---------- Encode ----------
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encode({ width, height, data }, opts) {
  opts = opts || {};
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  /* Filtre 1 (Sub) sur toute l'image : sur du pixel art avec de longues plages
     identiques il compresse nettement mieux que le filtre 0, pour trois lignes
     de code. Un choix par ligne facon libpng n'apporterait presque rien ici. */
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 1;
    const src = y * stride;
    for (let i = 0; i < stride; i++) {
      raw[o + 1 + i] = (data[src + i] - (i >= 4 ? data[src + i - 4] : 0)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const deflated = zlib.deflateSync(raw, { level: opts.level == null ? 9 : opts.level });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflated), chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { decode, encode };
