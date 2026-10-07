/* Rend les cartes mortelles du jeu en PNG, pour servir de fond aux croix de
   l'onglet GAMEPLAY du dashboard.

   Ne tourne qu'une fois, hors ligne. Deux precautions de fidelite :
   - les tables d'autotile et les classificateurs de tuiles sont EXTRAITS de
     www/js/rpg_core.js et evalues tels quels, plutot que retranscrits a la main ;
   - la liste des cartes est DERIVEE des donnees (toute carte ou un evenement
     retire des PV), pas ecrite en dur.

   Usage : node tools/render-maps.js [tileSize]
   tileSize doit diviser 48. Le defaut est 48, soit le natif du jeu : aucune
   reduction, donc aucune perte. 24 divise le poids par ~3 si besoin un jour.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const png = require('./png.js');

// dossier www du jeu ; surchargeable par SG_GAME_WWW si l'arborescence bouge
const GAME = process.env.SG_GAME_WWW ||
  path.resolve(__dirname, '../../Succubus Games 0.5.1 - PC/www');
// dossier de sortie : maps/ pour la derniere version ; pour figer une ancienne
// version a part, SG_MAPS_OUT=maps/0.4.1 (voir MAP_SETS dans app.js)
const OUT  = process.env.SG_MAPS_OUT ? path.resolve(__dirname, '..', process.env.SG_MAPS_OUT)
  : path.resolve(__dirname, '../maps');
const ENCRYPTION_KEY = 'd41d8cd98f00b204e9800998ecf8427e';  // MD5 de la chaine vide
const SRC_TILE = 48;                                        // taille native MV
const TILE = parseInt(process.argv[2] || '48', 10);
const HP_VAR = 4;

// ===================================================================
//  Tilemap : on emprunte le moteur du jeu au lieu de le reecrire
// ===================================================================
const Tilemap = (function () {
  const src = fs.readFileSync(path.join(GAME, 'js/rpg_core.js'), 'utf8');
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex(l => l.startsWith('Tilemap.TILE_ID_B'));
  const end   = lines.findIndex(l => l.startsWith('Tilemap.WATERFALL_AUTOTILE_TABLE'));
  if (start < 0 || end < 0) throw new Error('bloc statique Tilemap introuvable dans rpg_core.js');
  // du premier TILE_ID_ jusqu'au ']' qui ferme la derniere table
  let stop = end;
  while (stop < lines.length && !/^\];/.test(lines[stop])) stop++;
  const block = lines.slice(start, stop + 1).join('\n');

  const sandbox = { Tilemap: function () {} };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);
  const T = sandbox.Tilemap;
  if (!T.FLOOR_AUTOTILE_TABLE || !T.WALL_AUTOTILE_TABLE || !T.WATERFALL_AUTOTILE_TABLE) {
    throw new Error('tables d\'autotile absentes apres extraction');
  }
  return T;
})();

// ===================================================================
//  Assets
// ===================================================================
function decrypt(buf) {
  // .rpgmvp = header RPG de 16 octets, puis 16 octets XORes avec la cle
  const body = Buffer.from(buf.slice(16));
  for (let i = 0; i < 16; i++) body[i] ^= parseInt(ENCRYPTION_KEY.substr(i * 2, 2), 16);
  return body;
}

const _imgCache = new Map();
function loadTilesetImage(name) {
  if (!name) return null;
  if (_imgCache.has(name)) return _imgCache.get(name);
  let img = null;
  for (const [file, dec] of [[name + '.rpgmvp', true], [name + '.png', false]]) {
    const p = path.join(GAME, 'img/tilesets', file);
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p);
    img = png.decode(dec ? decrypt(raw) : raw);
    break;
  }
  if (!img) console.warn('  ! tileset introuvable : ' + name);
  _imgCache.set(name, img);
  return img;
}

// ===================================================================
//  Canvas RGBA minimal — juste ce que le rendu de tuiles demande
// ===================================================================
function makeCanvas(w, h) {
  return { width: w, height: h, data: Buffer.alloc(w * h * 4) };
}

// blit avec alpha « source-over », sans redimensionnement (sw/sh == dw/dh en MV)
function blt(dst, src, sx, sy, sw, sh, dx, dy) {
  if (!src) return;
  for (let y = 0; y < sh; y++) {
    const syy = sy + y, dyy = dy + y;
    if (syy < 0 || syy >= src.height || dyy < 0 || dyy >= dst.height) continue;
    for (let x = 0; x < sw; x++) {
      const sxx = sx + x, dxx = dx + x;
      if (sxx < 0 || sxx >= src.width || dxx < 0 || dxx >= dst.width) continue;
      const si = (syy * src.width + sxx) * 4, di = (dyy * dst.width + dxx) * 4;
      const a = src.data[si + 3];
      if (a === 0) continue;
      if (a === 255) {
        src.data.copy(dst.data, di, si, si + 4);
      } else {
        const na = a / 255, ia = 1 - na;
        dst.data[di]     = src.data[si]     * na + dst.data[di]     * ia;
        dst.data[di + 1] = src.data[si + 1] * na + dst.data[di + 1] * ia;
        dst.data[di + 2] = src.data[si + 2] * na + dst.data[di + 2] * ia;
        dst.data[di + 3] = Math.min(255, a + dst.data[di + 3] * ia);
      }
    }
  }
}

function fillRect(dst, x, y, w, h, r, g, b, a) {
  const na = a / 255, ia = 1 - na;
  for (let yy = y; yy < y + h; yy++) {
    if (yy < 0 || yy >= dst.height) continue;
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || xx >= dst.width) continue;
      const i = (yy * dst.width + xx) * 4;
      dst.data[i]     = r * na + dst.data[i]     * ia;
      dst.data[i + 1] = g * na + dst.data[i + 1] * ia;
      dst.data[i + 2] = b * na + dst.data[i + 2] * ia;
      dst.data[i + 3] = Math.min(255, a + dst.data[i + 3] * ia);
    }
  }
}

// ===================================================================
//  Rendu d'une tuile — port direct de Tilemap.prototype._draw*
// ===================================================================
const W = SRC_TILE, H = SRC_TILE, W1 = SRC_TILE / 2, H1 = SRC_TILE / 2;

function drawNormalTile(cv, bitmaps, tileId, dx, dy) {
  const setNumber = Tilemap.isTileA5(tileId) ? 4 : 5 + Math.floor(tileId / 256);
  const sx = (Math.floor(tileId / 128) % 2 * 8 + tileId % 8) * W;
  const sy = (Math.floor(tileId % 256 / 8) % 16) * H;
  blt(cv, bitmaps[setNumber], sx, sy, W, H, dx, dy);
}

function drawAutotile(cv, bitmaps, tileId, dx, dy, isTableTile) {
  let autotileTable = Tilemap.FLOOR_AUTOTILE_TABLE;
  const kind = Tilemap.getAutotileKind(tileId);
  const shape = Tilemap.getAutotileShape(tileId);
  const tx = kind % 8, ty = Math.floor(kind / 8);
  let bx = 0, by = 0, setNumber = 0, isTable = false;
  // animationFrame = 0 : on fige l'eau et les cascades sur leur premiere image
  const waterSurfaceIndex = 0;

  if (Tilemap.isTileA1(tileId)) {
    setNumber = 0;
    if (kind === 0)      { bx = 0; by = 0; }
    else if (kind === 1) { bx = 0; by = 3; }
    else if (kind === 2) { bx = 6; by = 0; }
    else if (kind === 3) { bx = 6; by = 3; }
    else {
      bx = Math.floor(tx / 4) * 8;
      by = ty * 6 + Math.floor(tx / 2) % 2 * 3;
      if (kind % 2 === 0) bx += waterSurfaceIndex * 2;
      else { bx += 6; autotileTable = Tilemap.WATERFALL_AUTOTILE_TABLE; }
    }
  } else if (Tilemap.isTileA2(tileId)) {
    setNumber = 1; bx = tx * 2; by = (ty - 2) * 3;
    isTable = isTableTile(tileId);
  } else if (Tilemap.isTileA3(tileId)) {
    setNumber = 2; bx = tx * 2; by = (ty - 6) * 2;
    autotileTable = Tilemap.WALL_AUTOTILE_TABLE;
  } else if (Tilemap.isTileA4(tileId)) {
    setNumber = 3; bx = tx * 2;
    by = Math.floor((ty - 10) * 2.5 + (ty % 2 === 1 ? 0.5 : 0));
    if (ty % 2 === 1) autotileTable = Tilemap.WALL_AUTOTILE_TABLE;
  }

  const table = autotileTable[shape];
  const source = bitmaps[setNumber];
  if (!table || !source) return;

  for (let i = 0; i < 4; i++) {
    const qsx = table[i][0], qsy = table[i][1];
    const sx1 = (bx * 2 + qsx) * W1, sy1 = (by * 2 + qsy) * H1;
    const dx1 = dx + (i % 2) * W1;
    let dy1 = dy + Math.floor(i / 2) * H1;
    if (isTable && (qsy === 1 || qsy === 5)) {
      const qsx2 = (qsy === 1) ? [0, 3, 2, 1][qsx] : qsx;
      blt(cv, source, (bx * 2 + qsx2) * W1, (by * 2 + 3) * H1, W1, H1, dx1, dy1);
      dy1 += H1 / 2;
      blt(cv, source, sx1, sy1, W1, H1 / 2, dx1, dy1);
    } else {
      blt(cv, source, sx1, sy1, W1, H1, dx1, dy1);
    }
  }
}

function drawTableEdge(cv, bitmaps, tileId, dx, dy) {
  if (!Tilemap.isTileA2(tileId)) return;
  const kind = Tilemap.getAutotileKind(tileId);
  const shape = Tilemap.getAutotileShape(tileId);
  const tx = kind % 8, ty = Math.floor(kind / 8);
  const bx = tx * 2, by = (ty - 2) * 3;
  const table = Tilemap.FLOOR_AUTOTILE_TABLE[shape];
  const source = bitmaps[1];
  if (!table || !source) return;
  for (let i = 0; i < 2; i++) {
    const qsx = table[2 + i][0], qsy = table[2 + i][1];
    blt(cv, source, (bx * 2 + qsx) * W1, (by * 2 + qsy) * H1 + H1 / 2,
        W1, H1 / 2, dx + (i % 2) * W1, dy + Math.floor(i / 2) * H1);
  }
}

function drawShadow(cv, shadowBits, dx, dy) {
  if (!(shadowBits & 0x0f)) return;
  for (let i = 0; i < 4; i++) {
    if (shadowBits & (1 << i)) {
      fillRect(cv, dx + (i % 2) * W1, dy + Math.floor(i / 2) * H1, W1, H1, 0, 0, 0, 128);
    }
  }
}

// ===================================================================
//  Rendu d'une carte entiere
// ===================================================================
function renderMap(mapData, tileset) {
  const { width, height, data } = mapData;
  const flags = tileset.flags;
  const bitmaps = tileset.tilesetNames.map(loadTilesetImage);

  const read = (x, y, z) =>
    (x >= 0 && x < width && y >= 0 && y < height)
      ? data[(z * height + y) * width + x] || 0 : 0;

  // Portage des predicats de Tilemap qui dependent des flags du tileset
  const isHigherTile   = (t) => (flags[t] & 0x10) !== 0;
  const isTableTile    = (t) => Tilemap.isTileA2(t) && (flags[t] & 0x80) !== 0;
  const isOverpassTile = (t) => (flags[t] & 0x10) !== 0 && (flags[t] & 0x08) !== 0;
  const isOverpassPosition = () => false;   // sans OverpassTile plugin, MV renvoie toujours false

  const cv = makeCanvas(width * SRC_TILE, height * SRC_TILE);
  const TABLE_EDGE_VIRTUAL_ID = 10000;

  const drawTile = (tileId, dx, dy) => {
    if (!Tilemap.isVisibleTile(tileId)) return;
    if (Tilemap.isAutotile(tileId)) drawAutotile(cv, bitmaps, tileId, dx, dy, isTableTile);
    else drawNormalTile(cv, bitmaps, tileId, dx, dy);
  };

  /* Meme sequencement que _paintTiles : couche basse d'abord (toutes les cases),
     puis couche haute par-dessus. Faire les deux en une passe donnerait des
     toits qui passent sous le sol de la case suivante. */
  const upperQueue = [];
  for (let my = 0; my < height; my++) {
    for (let mx = 0; mx < width; mx++) {
      const dx = mx * SRC_TILE, dy = my * SRC_TILE;
      const t0 = read(mx, my, 0), t1 = read(mx, my, 1);
      const t2 = read(mx, my, 2), t3 = read(mx, my, 3);
      const shadowBits = read(mx, my, 4);
      const upperTileId1 = read(mx, my - 1, 1);

      const lower = [], upper = [];
      (isHigherTile(t0) ? upper : lower).push(t0);
      (isHigherTile(t1) ? upper : lower).push(t1);
      lower.push(-shadowBits);
      if (isTableTile(upperTileId1) && !isTableTile(t1) && !Tilemap.isShadowingTile(t0)) {
        lower.push(TABLE_EDGE_VIRTUAL_ID + upperTileId1);
      }
      if (isOverpassPosition(mx, my)) { upper.push(t2, t3); }
      else {
        (isHigherTile(t2) ? upper : lower).push(t2);
        (isHigherTile(t3) ? upper : lower).push(t3);
      }

      for (const id of lower) {
        if (id < 0) drawShadow(cv, shadowBits, dx, dy);
        else if (id >= TABLE_EDGE_VIRTUAL_ID) drawTableEdge(cv, bitmaps, upperTileId1, dx, dy);
        else drawTile(id, dx, dy);
      }
      if (upper.length) upperQueue.push([upper, dx, dy]);
    }
  }
  for (const [tiles, dx, dy] of upperQueue) for (const id of tiles) drawTile(id, dx, dy);

  return cv;
}

// ===================================================================
//  Reduction par moyennage de boite
// ===================================================================
function downscale(cv, factor) {
  if (factor === 1) return cv;
  const w = Math.floor(cv.width / factor), h = Math.floor(cv.height / factor);
  const out = makeCanvas(w, h);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * cv.width;
        for (let dx = 0; dx < factor; dx++) {
          const i = (row + x * factor + dx) * 4;
          // premultiplie : sinon les pixels transparents tirent les bords vers le noir
          const al = cv.data[i + 3] / 255;
          r += cv.data[i] * al; g += cv.data[i + 1] * al; b += cv.data[i + 2] * al;
          a += cv.data[i + 3];
        }
      }
      const o = (y * w + x) * 4;
      const am = a / n;
      const un = am > 0 ? 255 / am : 0;
      out.data[o]     = Math.min(255, Math.round(r / n * un));
      out.data[o + 1] = Math.min(255, Math.round(g / n * un));
      out.data[o + 2] = Math.min(255, Math.round(b / n * un));
      out.data[o + 3] = Math.round(am);
    }
  }
  return out;
}

// ===================================================================
//  Selection des cartes : celles ou un evenement retire des PV
// ===================================================================
function deadlyMaps() {
  const infos = JSON.parse(fs.readFileSync(path.join(GAME, 'data/MapInfos.json'), 'utf8'));
  const out = [];
  for (let id = 1; id < infos.length; id++) {
    const file = path.join(GAME, 'data/Map' + String(id).padStart(3, '0') + '.json');
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    let kills = false;
    for (const ev of m.events || []) {
      if (!ev) continue;
      for (const page of ev.pages) for (const c of page.list) {
        // 122 = Control Variables. [start, end, operation, operand, value]
        if (c.code !== 122) continue;
        const p = c.parameters;
        if (p[0] > HP_VAR || HP_VAR > p[1]) continue;
        if (p[3] !== 0) continue;                       // operande = constante
        if (p[2] === 1 || p[2] === 2) kills = true;     // add (valeur negative) ou sub
        if (p[2] === 0 && p[4] <= 0) kills = true;      // mise a zero directe
      }
    }
    if (kills) out.push({ id, name: (infos[id] && infos[id].name) || ('Map ' + id), data: m });
  }
  return out;
}

// ===================================================================
//  Main
// ===================================================================
function main() {
  const tilesets = JSON.parse(fs.readFileSync(path.join(GAME, 'data/Tilesets.json'), 'utf8'));
  const maps = deadlyMaps();
  const factor = SRC_TILE / TILE;
  if (!Number.isInteger(factor)) throw new Error('tileSize doit diviser 48');

  fs.mkdirSync(OUT, { recursive: true });
  const index = { tileSize: TILE, maps: {} };
  let bytes = 0;

  console.log(maps.length + ' cartes mortelles, tuile ' + TILE + 'px\n');
  for (const m of maps) {
    const t0 = Date.now();
    const ts = tilesets[m.data.tilesetId];
    if (!ts) { console.warn('  ! tileset ' + m.data.tilesetId + ' absent pour la map ' + m.id); continue; }
    const full = renderMap(m.data, ts);
    const small = downscale(full, factor);
    const buf = png.encode(small);
    const file = 'map' + m.id + '.png';
    fs.writeFileSync(path.join(OUT, file), buf);
    bytes += buf.length;
    index.maps[m.id] = { name: m.name, width: m.data.width, height: m.data.height, file };
    console.log('  map ' + String(m.id).padStart(2) + '  ' + m.name.padEnd(24) +
      String(m.data.width) + 'x' + m.data.height + '  ' +
      (buf.length / 1024).toFixed(0).padStart(5) + ' KB   ' + (Date.now() - t0) + 'ms');
  }

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));
  console.log('\ntotal : ' + (bytes / 1048576).toFixed(2) + ' Mo');
}

main();
