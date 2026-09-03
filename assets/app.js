/* Dror's Portal — shell: unlock ceremony, key storage, decrypt, router. Phase 1. */
(function () {
'use strict';

var BASE = location.pathname.replace(/[^/]*$/, '');
var $ = function (id) { return document.getElementById(id); };
var state = { key: null, manifest: null, content: {} };

/* ---------- IndexedDB key store (stores a non-extractable CryptoKey) ---------- */
function idb() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open('portal', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
function kvGet(k) {
  return idb().then(function (db) {
    return new Promise(function (res, rej) {
      var t = db.transaction('kv').objectStore('kv').get(k);
      t.onsuccess = function () { res(t.result); };
      t.onerror = function () { rej(t.error); };
    });
  });
}
function kvSet(k, v) {
  return idb().then(function (db) {
    return new Promise(function (res, rej) {
      var t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
      t.onsuccess = function () { res(); };
      t.onerror = function () { rej(t.error); };
    });
  });
}

/* ---------- crypto ---------- */
function b64buf(s) {
  var bin = atob(s), a = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a.buffer;
}
function importPrivate(jwkText) {
  var jwk;
  try { jwk = JSON.parse(jwkText); } catch (e) { return Promise.reject({ step: 'parse' }); }
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
    .catch(function () { throw { step: 'import' }; });
}
function decryptEnvelope(env, key) {
  return crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, b64buf(env.wrapped_key))
    .catch(function () { throw { step: 'unwrap' }; })
    .then(function (raw) {
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    })
    .then(function (aes) {
      return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64buf(env.iv), additionalData: new TextEncoder().encode(env.aad) },
        aes, b64buf(env.ct)
      ).catch(function () { throw { step: 'gcm' }; });
    })
    .then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
}

/* ---------- content ---------- */
function fetchManifest() {
  return fetch(BASE + 'manifest.json?v=' + Date.now(), { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw { step: 'manifest', status: r.status };
    return r.json();
  });
}
function loadBlob(product) {
  if (state.content[product]) return Promise.resolve(state.content[product]);
  var rel = state.manifest.files[product];
  if (!rel) return Promise.reject({ step: 'missing' });
  var ver = encodeURIComponent((state.manifest && state.manifest.generated_at) || Date.now());
  return fetch(BASE + rel + '?v=' + ver, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw { step: 'blob', status: r.status };
    return r.json();
  }).then(function (env) {
    return decryptEnvelope(env, state.key);
  }).then(function (data) {
    state.content[product] = data;
    return data;
  });
}

/* ---------- unlock ceremony ---------- */
var ERR = {
  parse: "That doesn't look like a key file.",
  import: "That doesn't look like a key file.",
  unwrap: "That key doesn't open this edition.",
  gcm: 'This edition arrived damaged — refresh to re-download.',
  manifest: "Today's edition isn't published yet — the presses run at 04:50.",
  blob: 'This edition arrived damaged — refresh to re-download.',
};
function gateError(e) {
  $('gate-err').textContent = ERR[e && e.step] || 'Something failed — try again.';
}
function showGate() {
  $('app').hidden = true;
  $('app').style.display = 'none';
  $('gate').hidden = false;
  $('gate').style.display = 'flex';
  var d = new Date();
  $('gate-date').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
}
function tryUnlock(jwkText, fromStore) {
  $('unlock-btn').disabled = true;
  $('gate-err').textContent = '';
  var imported;
  return importPrivate(jwkText)
    .then(function (key) {
      imported = key;
      state.key = key;
      return fetchManifest();
    })
    .then(function (m) { state.manifest = m; return loadBlob('news'); })
    .then(function () {
      if (!fromStore) { kvSet('pk', imported); $('key-input').value = ''; }
      enter();
    })
    .catch(function (e) {
      $('unlock-btn').disabled = false;
      if (fromStore && e && (e.step === 'parse' || e.step === 'import' || e.step === 'unwrap')) { showGate(); return; }
      if (fromStore) { showGate(); }
      gateError(e);
    });
}

/* stored non-extractable CryptoKey path */
function tryStoredKey() {
  return kvGet('pk').then(function (key) {
    if (!key) { showGate(); return; }
    state.key = key;
    return fetchManifest()
      .then(function (m) { state.manifest = m; return loadBlob('news'); })
      .then(enter)
      .catch(function (e) {
        if (e && e.step === 'manifest') { showGate(); gateError(e); return; }
        showGate();
        if (e && e.step) gateError(e);
      });
  }).catch(showGate);
}

/* ---------- views ---------- */
var NAMES = { news: "Dror's Morning News", stocks: "Dror's Stock Screener", shopping: "Dror's Shopping Scout" };
function parseRoute() {
  var parts = (location.hash.replace(/^#\/?/, '') || 'news').split('/');
  var r = parts[0] || 'news';
  if (!NAMES[r]) r = 'news';
  return { r: r, sub: parts.slice(1).join('/') };
}
function route() {
  var cur = parseRoute();
  document.querySelectorAll('.tabs a').forEach(function (a) {
    a.classList.toggle('on', a.getAttribute('data-r') === cur.r);
  });
  var v = $('view');
  if (cur.r === 'news') {
    if (state.content.news) { v.innerHTML = newsHTML(state.content.news, cur.sub); return; }
    v.innerHTML = '<div class="placeholder"><div class="b">Decrypting today’s edition…</div></div>';
    loadBlob('news').then(function () {
      var now = parseRoute();
      if (now.r === 'news') v.innerHTML = newsHTML(state.content.news, now.sub);
    }).catch(function () {
      v.innerHTML = '<div class="placeholder"><div class="a">No edition yet.</div><div class="b">The presses run at 04:50.</div></div>';
    });
    return;
  }
  if (cur.r === 'stocks' && state.manifest && state.manifest.files && state.manifest.files.stocks) {
    if (state.content.stocks) { v.innerHTML = stocksHTML(state.content.stocks, cur.sub); return; }
    v.innerHTML = '<div class="placeholder"><div class="b">Decrypting today’s board…</div></div>';
    loadBlob('stocks').then(function () {
      var now = parseRoute();
      if (now.r === 'stocks') v.innerHTML = stocksHTML(state.content.stocks, now.sub);
    }).catch(function () {
      v.innerHTML = '<div class="placeholder"><div class="a">No board yet.</div><div class="b">The scan lands around 06:00.</div></div>';
    });
    return;
  }
  if (cur.r === 'shopping' && state.manifest && state.manifest.files && state.manifest.files.shopping) {
    if (state.content.shopping) { v.innerHTML = shoppingHTML(state.content.shopping, cur.sub); return; }
    v.innerHTML = '<div class="placeholder"><div class="b">Decrypting today’s finds…</div></div>';
    loadBlob('shopping').then(function () {
      var now = parseRoute();
      if (now.r === 'shopping') v.innerHTML = shoppingHTML(state.content.shopping, now.sub);
    }).catch(function () {
      v.innerHTML = '<div class="placeholder"><div class="a">No finds yet.</div><div class="b">The hunt runs each morning.</div></div>';
    });
    return;
  }
  v.innerHTML = '<div class="placeholder"><div class="a">' + NAMES[cur.r] + '</div>' +
    '<div class="b">Nothing here yet — the daily job that fills this section hasn’t published.</div></div>';
}

/* ---------- Shopping Scout ---------- */
function savedStore() {
  try { return JSON.parse(localStorage.getItem('shop_saved_v1') || '{}'); } catch (e) { return {}; }
}
function setSavedStore(s) {
  try { localStorage.setItem('shop_saved_v1', JSON.stringify(s)); } catch (e) {}
}
function toggleSaved(id) {
  var s = savedStore();
  if (s[id]) { delete s[id]; } else {
    var items = (state.content.shopping || {}).items || [];
    var it = items.filter(function (x) { return x.id === id; })[0];
    if (it) s[id] = it;
  }
  setSavedStore(s);
}
function costGrid(costs) {
  if (!costs) return '';
  var order = ['IL', 'UK', 'GR', 'US'];
  var fm = function (x, ap) { return (x == null || isNaN(x)) ? '—' : (ap ? '~' : '') + '$' + Math.round(x); };
  var rows = order.map(function (d) {
    var c = costs[d];
    if (!c) return '';
    if (c.na) return '<div class="cg-r"><span class="cg-d">' + d + '</span><span class="cg-na">doesn’t ship</span></div>';
    return '<div class="cg-r"><span class="cg-d">' + d + '</span><span class="num">' + fm(c.ship) + '</span>' +
      '<span class="num">' + fm(c.imp, true) + '</span><b class="num">' + fm(c.tot, true) + '</b></div>';
  }).join('');
  if (!rows) return '';
  return '<div class="costgrid"><div class="cg-r cg-h"><span></span><span>Ship</span><span>Import</span><span>All-in</span></div>' + rows + '</div>';
}
function finGrid(it) {
  var f = it.fin || {};
  var cur = it.cur === 'ILS' ? '₪' : (it.cur === 'EUR' ? '€' : '$');
  var fm = function (x) { return (x == null || isNaN(x)) ? '—' : cur + Math.round(x).toLocaleString('en-US'); };
  var rows = '';
  if (it.price != null) rows += '<div class="cg-r"><span class="cg-d">Price</span><b class="num">' + fm(it.price) + '</b></div>';
  if (f.down != null) rows += '<div class="cg-r"><span class="cg-d">Cash needed</span><b class="num">' + fm(f.down) + '</b><span class="cg-note">incl. purchase costs</span></div>';
  if (f.ltv != null) rows += '<div class="cg-r"><span class="cg-d">Assumed LTV</span><span class="num">' + esc(f.ltv) + '%</span></div>';
  if (f.monthly != null) rows += '<div class="cg-r"><span class="cg-d">Est. monthly</span><span class="num">' + fm(f.monthly) + '</span></div>';
  if (!rows) return '';
  return '<div class="costgrid fingrid">' + rows + (f.note ? '<div class="cg-r cg-fn">' + esc(f.note) + '</div>' : '') + '</div>';
}
function reSpecs(it) {
  var c = [];
  if (it.ptype) c.push(esc(it.ptype));
  if (it.rooms != null) c.push(esc(it.rooms) + ' rooms');
  if (it.m2 != null) c.push(esc(it.m2) + ' m²');
  if (it.plot != null) c.push('plot ' + esc(it.plot) + ' m²');
  if (it.sea_m != null && it.sea_m !== 'n/a') c.push('sea ' + esc(it.sea_m) + ' m');
  if (it.year) c.push('built ' + esc(it.year));
  return c.map(function (x) { return '<span class="schip2">' + x + '</span>'; }).join('');
}
function flagOf(iso) {
  iso = String(iso || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) return '🌐';
  return String.fromCodePoint(0x1F1E6 + iso.charCodeAt(0) - 65, 0x1F1E6 + iso.charCodeAt(1) - 65);
}
function shopCard(it, saved) {
  var img = (it.img && it.img.indexOf('data:image/') === 0) ?
    '<img class="shthumb" src="' + it.img + '" alt="" loading="lazy">' :
    '<div class="shthumb ph">🛍️</div>';
  var flags = (it.flags || []).map(function (f) {
    var cls = /deal/i.test(f) ? ' good' : (/fake|above market|no coa|no longer|unverified/i.test(f) ? ' warn' : '');
    return '<span class="fchip2' + cls + '">' + esc(f) + '</span>';
  }).join('');
  var topFlag = it.ref || (it.flags || [])[0];
  var star = '<button class="savestar num' + (saved ? ' on' : '') + '" data-id="' + esc(it.id) + '" aria-label="Save item" title="' +
    (saved ? 'Remove from saved' : 'Save this item') + '">' + (saved ? '★' : '☆') + '</button>';
  var src = it.src || String(it.origin || it.site || '').replace(/\s*\([^)]*\)\s*$/, '').split(',')[0].trim() || it.site || '';
  var ctry = it.country ? flagOf(it.country) + ' ' + esc(it.countryName || it.country) : '🌐 Ship-from country not stated';
  var isRE = it.kind === 're' || /^re-/.test(it.sid || '');
  var ships = (!isRE && (it.ships || []).length) ? '<span class="schip2">Ships to: ' + it.ships.map(esc).join(' · ') + '</span>' : '';
  if (isRE) ctry = (it.country ? flagOf(it.country) + ' ' : '📍 ') + esc(it.loc || it.countryName || it.country || 'Location not stated');
  return '<details class="shrow" data-pu="' + (it.pu != null ? it.pu : '') + '">' +
    '<summary>' + img +
    '<span class="shmain"><span class="sht">' + esc(it.t) + '</span>' +
    '<span class="shsrc">' + esc(src) + '</span>' +
    '<span class="shctry">' + ctry + '</span></span>' +
    (it.is_new ? '<span class="newbdg2">NEW</span>' : '') +
    (topFlag ? '<span class="fchip2' + (/deal/i.test(topFlag) ? ' good' : (/fake|above market|no coa|no longer|unverified/i.test(topFlag) ? ' warn' : '')) + ' shflag">' + esc(topFlag) + '</span>' : '') +
    '<span class="shp num">' + esc(it.p) + '</span>' + star +
    '</summary>' +
    '<div class="shbody">' +
    '<div class="scmeta">' + (isRE ? reSpecs(it) : ((it.cond ? '<span class="schip2">Condition: ' + esc(it.cond) + '</span>' : '') +
    (it.origin ? '<span class="schip2">' + esc(it.origin) + '</span>' : '') + ships)) + '</div>' +
    (isRE ? finGrid(it) : costGrid(it.costs)) +
    (flags ? '<div class="scmeta">' + flags + '</div>' : '') +
    (it.notes ? '<p class="scnotes">' + esc(it.notes) + '</p>' : '') +
    (it.mkt ? '<p class="scmkt">' + esc(it.mkt) + '</p>' : '') +
    '<div class="scfoot"><span class="scdate num">found ' + esc(it.found || '') +
    (it.chk ? ' · checked ' + esc(it.chk) : '') + '</span>' +
    '<a class="sclink" href="' + esc(it.u) + '" target="_blank" rel="noopener noreferrer">View listing ↗</a></div>' +
    '</div></details>';
}
var SH = { sort: 'best', ref: {} };
var SH_SORTS = [['best', 'Best first'], ['asc', 'Price ↑'], ['desc', 'Price ↓'], ['il', 'All-in to IL ↑']];
function shSort(list) {
  var l = list.slice();
  var ilTot = function (it) { var c = (it.costs || {}).IL; return (c && !c.na && c.tot != null) ? c.tot : Infinity; };
  if (SH.sort === 'asc') l.sort(function (a, b) { return (a.pu || 0) - (b.pu || 0); });
  else if (SH.sort === 'desc') l.sort(function (a, b) { return (b.pu || 0) - (a.pu || 0); });
  else if (SH.sort === 'il') l.sort(function (a, b) { return ilTot(a) - ilTot(b); });
  return l;
}
function shTools(sid, list) {
  var refs = [];
  list.forEach(function (it) { if (it.ref && refs.indexOf(it.ref) < 0) refs.push(it.ref); });
  var cur = SH.ref[sid] || 'all';
  var out = '<div class="shtools">';
  if (refs.length > 1) {
    out += '<div class="shrefs"><button type="button" data-sref="all"' + (cur === 'all' ? ' class="on"' : '') + '>All · ' + list.length + '</button>' +
      refs.map(function (r) {
        var n = list.filter(function (it) { return it.ref === r; }).length;
        return '<button type="button" data-sref="' + esc(r) + '"' + (cur === r ? ' class="on"' : '') + '>' + esc(r) + ' · ' + n + '</button>';
      }).join('') + '</div>';
  }
  out += '<div class="shsort"><span class="shsort-l">Sort</span>' + SH_SORTS.map(function (o) {
    return '<button type="button" data-ssort="' + o[0] + '"' + (SH.sort === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>';
  }).join('') + '</div></div>';
  return out;
}
function shoppingHTML(s, sub) {
  var live = (s.items || []).filter(function (it) { return !it.gone; });
  var bySid = {};
  live.forEach(function (it) { (bySid[it.sid] = bySid[it.sid] || []).push(it); });
  var saved = savedStore();
  var savedIds = Object.keys(saved);
  var first = (s.searches || []).length ? s.searches[0].id : 'saved';
  var known = { saved: 1 };
  (s.searches || []).forEach(function (q) { known[q.id] = 1; });
  if (!known[sub]) sub = first;
  function tab(id, label, cnt) {
    return '<a href="#/shopping/' + id + '"' + (sub === id ? ' class="on"' : '') + '>' + esc(label) +
      (cnt != null ? ' <span class="num">' + cnt + '</span>' : '') + '</a>';
  }
  var subtabs = '<nav class="subtabs">' +
    (s.searches || []).map(function (q) { return tab(q.id, q.name, (bySid[q.id] || []).length); }).join('') +
    tab('saved', '★ Saved', savedIds.length) + '</nav>';
  var body = '';
  function rows(list) { return '<div class="shoplist">' + list.map(function (it) { return shopCard(it, !!saved[it.id]); }).join('') + '</div>'; }
  function grid(list, sid) {
    if (!list.length) return '<p class="scempty">No live finds for this hunt right now — the robot keeps looking every morning.</p>';
    var out = shTools(sid, list);
    var cur = SH.ref[sid] || 'all';
    var hasRefs = list.some(function (it) { return it.ref; });
    if (hasRefs && cur === 'all') {
      var refs = [];
      list.forEach(function (it) { if (it.ref && refs.indexOf(it.ref) < 0) refs.push(it.ref); });
      refs.forEach(function (r) {
        var sub = shSort(list.filter(function (it) { return it.ref === r; }));
        out += '<div class="ngroup"><span>' + esc(r) + ' · ' + sub.length + '</span></div>' + rows(sub);
      });
      var noref = shSort(list.filter(function (it) { return !it.ref; }));
      if (noref.length) out += '<div class="ngroup"><span>Other · ' + noref.length + '</span></div>' + rows(noref);
      return out;
    }
    var flt = hasRefs ? list.filter(function (it) { return it.ref === cur; }) : list;
    return out + (flt.length ? rows(shSort(flt)) : '<p class="scempty">Nothing live for this reference right now.</p>');
  }
  if (sub === 'saved') {
    var liveIds = {};
    live.forEach(function (it) { liveIds[it.id] = 1; });
    var list = savedIds.map(function (id) {
      var it = saved[id];
      if (!liveIds[id]) {
        it = JSON.parse(JSON.stringify(it));
        it.flags = (it.flags || []).concat(['No longer on the daily list']);
        it.is_new = false;
      }
      return it;
    });
    body = list.length ? shTools('saved', list) + '<div class="shoplist">' + shSort(list).map(function (it) { return shopCard(it, true); }).join('') + '</div>' :
      '<p class="scempty">Nothing saved yet — hit the ☆ on any find to keep it here.</p>';
  } else {
    var q = (s.searches || []).filter(function (x) { return x.id === sub; })[0] || {};
    if (q.notes) body += '<p class="scandate">' + esc(q.notes) + '</p>';
    body += grid(bySid[sub] || [], sub);
  }
  return '<article class="paper shop"><div class="edline">SHOPPING SCOUT' +
    (s.built ? ' · UPDATED ' + esc(s.built) : '') + '</div>' + subtabs + body +
    '<div class="caughtup">Every listing was opened and verified live before it entered. Costs are estimates.</div></article>';
}

/* ---------- Stock Screener ---------- */
function fnum(x, dp) {
  if (x == null || isNaN(x)) return '—';
  return Number(x).toFixed(dp == null ? 2 : dp);
}
function fpct(x) {
  if (x == null || isNaN(x)) return '—';
  return (x > 0 ? '+' : '') + Number(x).toFixed(2) + '%';
}
function sparkSVG(closes) {
  if (!closes || closes.length < 2) return '';
  var lo = Math.min.apply(null, closes), hi = Math.max.apply(null, closes);
  var span = (hi - lo) || 1, W = 120, H = 34, PAD = 2;
  var pts = closes.map(function (c, i) {
    var x = PAD + i * (W - 2 * PAD) / (closes.length - 1);
    var y = H - PAD - (c - lo) * (H - 2 * PAD) / span;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  var up = closes[closes.length - 1] >= closes[0];
  return '<svg class="spark2" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<polyline class="' + (up ? 'up' : 'dn') + '" points="' + pts + '"/></svg>';
}
function chgPill(x) {
  if (x == null || isNaN(x)) return '';
  return '<span class="chgp num ' + (x >= 0 ? 'up' : 'dn') + '">' + fpct(x) + '</span>';
}
function meterHTML(label, val, max) {
  var p = Math.max(0, Math.min(100, (val / max) * 100));
  var cls = p >= 70 ? '' : (p >= 40 ? ' warn' : ' bad');
  return '<div class="mtr2"><span class="mtr2-l">' + esc(label) + '</span>' +
    '<span class="mtr2-t"><span class="mtr2-f' + cls + '" style="width:' + p.toFixed(0) + '%"></span></span>' +
    '<span class="mtr2-n num">' + esc(val) + '</span></div>';
}
/* ---- interactive daily chart (candles + volume + MAs + crosshair) ---- */
var KG = { W: 640, H: 340, L: 8, R: 60, T: 8, PB: 226, VT: 238, VB: 318 };
var KR = [['1M', 22], ['3M', 63], ['6M', 126], ['1Y', 9999]];
var K = { range: {}, ma20: true, ma50: true };
function kBars(q) {
  if (!q || !q.ohlc || q.ohlc.length < 5) return null;
  return q.ohlc.map(function (b, i) {
    return { o: b[0], h: b[1], l: b[2], c: b[3], v: (q.v || [])[i] || 0, d: (q.dts || [])[i] || '' };
  });
}
function kGeom(q, t) {
  var all = kBars(q);
  if (!all) return null;
  var key = K.range[t] || '3M';
  var want = (KR.filter(function (r) { return r[0] === key; })[0] || KR[1])[1];
  var start = Math.max(0, all.length - want);
  var bars = all.slice(start), n = bars.length, lo = Infinity, hi = -Infinity, vmax = 0;
  bars.forEach(function (b) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; if (b.v > vmax) vmax = b.v; });
  var span = (hi - lo) || 1, pw = KG.W - KG.L - KG.R, ph = KG.PB - KG.T, step = pw / n;
  return { all: all, bars: bars, start: start, n: n, lo: lo, hi: hi, span: span, vmax: vmax || 1, pw: pw, ph: ph, step: step, key: key,
    y: function (v) { return KG.T + (hi - v) * ph / span; },
    x: function (i) { return KG.L + i * step + step / 2; },
    vy: function (v) { return KG.VB - (v / (vmax || 1)) * (KG.VB - KG.VT); } };
}
function kLegend(b, prev) {
  var chg = (prev && prev.c) ? ((b.c / prev.c - 1) * 100) : null;
  return '<span class="kd num">' + esc(b.d || '') + '</span>' +
    '<span>O <b class="num">' + fnum(b.o) + '</b></span><span>H <b class="num">' + fnum(b.h) + '</b></span>' +
    '<span>L <b class="num">' + fnum(b.l) + '</b></span><span>C <b class="num">' + fnum(b.c) + '</b></span>' +
    '<span>Vol <b class="num">' + fvol(b.v) + '</b></span>' +
    (chg != null ? '<span class="num ' + (chg >= 0 ? 'upc' : 'dnc') + '">' + fpct(chg) + '</span>' : '');
}
function fvol(v) {
  if (v == null) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
}
function candleSVG(t, q) {
  var g = kGeom(q, t);
  if (!g) {
    var cs = (q && q.c && q.c.length > 5) ? q.c.slice(-126) : null;
    if (!cs) return '';
    var lo = Math.min.apply(null, cs), hi = Math.max.apply(null, cs), span = (hi - lo) || 1, pw = KG.W - KG.L - KG.R, step = pw / cs.length;
    var yy = function (v) { return KG.T + (hi - v) * (KG.PB - KG.T) / span; };
    return '<div class="nlabel">DAILY CLOSES · LAST ' + cs.length + ' SESSIONS</div><svg class="kchart" viewBox="0 0 ' + KG.W + ' ' + KG.PB + '">' +
      '<polyline class="kline" points="' + cs.map(function (c, i) { return (KG.L + i * step + step / 2).toFixed(1) + ',' + yy(c).toFixed(1); }).join(' ') + '"/></svg>';
  }
  var out = '<svg class="kchart" viewBox="0 0 ' + KG.W + ' ' + KG.H + '" role="img" aria-label="Daily candles and volume" data-t="' + esc(t) + '">';
  for (var i = 0; i <= 4; i++) {
    var v = g.lo + g.span * i / 4, y = g.y(v).toFixed(1);
    out += '<line class="kg" x1="' + KG.L + '" x2="' + (KG.W - KG.R) + '" y1="' + y + '" y2="' + y + '"/>' +
      '<text class="kl" x="' + (KG.W - KG.R + 6) + '" y="' + (g.y(v) + 4).toFixed(1) + '">' + fnum(v, v >= 100 ? 0 : 2) + '</text>';
  }
  out += '<line class="kg" x1="' + KG.L + '" x2="' + (KG.W - KG.R) + '" y1="' + KG.VB + '" y2="' + KG.VB + '"/>' +
    '<text class="kl" x="' + (KG.W - KG.R + 6) + '" y="' + (KG.VT + 4) + '">' + fvol(g.vmax) + '</text>';
  // month ticks
  var lastMon = '';
  g.bars.forEach(function (b, i) {
    var m = (b.d || '').slice(0, 7);
    if (m && m !== lastMon) {
      if (lastMon) out += '<text class="kl km" x="' + g.x(i).toFixed(1) + '" y="' + (KG.H - 6) + '">' + m.slice(5) + '/' + m.slice(2, 4) + '</text>';
      lastMon = m;
    }
  });
  var bw = Math.max(1.5, g.step * 0.62);
  g.bars.forEach(function (b, i) {
    var x = g.x(i), up = b.c >= b.o, cls = up ? 'up' : 'dn';
    var top = g.y(Math.max(b.o, b.c)), bot = g.y(Math.min(b.o, b.c));
    if (bot - top < 1) bot = top + 1;
    out += '<line class="kw ' + cls + '" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + g.y(b.h).toFixed(1) + '" y2="' + g.y(b.l).toFixed(1) + '"/>' +
      '<rect class="kb ' + cls + '" x="' + (x - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (bot - top).toFixed(1) + '"/>' +
      '<rect class="kv ' + cls + '" x="' + (x - bw / 2).toFixed(1) + '" y="' + g.vy(b.v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (KG.VB - g.vy(b.v)).toFixed(1) + '"/>';
  });
  [[20, K.ma20, 'kma20'], [50, K.ma50, 'kma50']].forEach(function (m) {
    if (!m[1]) return;
    var pts = [];
    for (var i = 0; i < g.n; i++) {
      var ai = g.start + i;
      if (ai + 1 < m[0]) continue;
      var s = 0;
      for (var j = ai - m[0] + 1; j <= ai; j++) s += g.all[j].c;
      pts.push(g.x(i).toFixed(1) + ',' + g.y(s / m[0]).toFixed(1));
    }
    if (pts.length > 1) out += '<polyline class="kma ' + m[2] + '" points="' + pts.join(' ') + '"/>';
  });
  var last = g.bars[g.n - 1].c;
  out += '<line class="kg klast" x1="' + KG.L + '" x2="' + (KG.W - KG.R) + '" y1="' + g.y(last).toFixed(1) + '" y2="' + g.y(last).toFixed(1) + '"/>' +
    '<rect class="kpl klastbox" x="' + (KG.W - KG.R + 2) + '" y="' + (g.y(last) - 8).toFixed(1) + '" width="' + (KG.R - 4) + '" height="16" rx="3"/>' +
    '<text class="kpt" x="' + (KG.W - KG.R + 6) + '" y="' + (g.y(last) + 4).toFixed(1) + '">' + fnum(last, last >= 100 ? 0 : 2) + '</text>';
  out += '<g class="kcross" style="display:none"><line class="kcx" y1="' + KG.T + '" y2="' + KG.VB + '"/><line class="kcy" x1="' + KG.L + '" x2="' + (KG.W - KG.R) + '"/>' +
    '<rect class="kpl" x="' + (KG.W - KG.R + 2) + '" width="' + (KG.R - 4) + '" height="16" rx="3"/><text class="kpt" x="' + (KG.W - KG.R + 6) + '"></text></g></svg>';
  var ctl = '<div class="kctl">' + KR.map(function (r) {
    return '<button type="button" data-kr="' + r[0] + '"' + (r[0] === g.key ? ' class="on"' : '') + '>' + r[0] + '</button>';
  }).join('') + '<span class="ksep"></span>' +
    '<button type="button" data-kma="20"' + (K.ma20 ? ' class="on"' : '') + '><i class="kdot ma20"></i>MA20</button>' +
    '<button type="button" data-kma="50"' + (K.ma50 ? ' class="on"' : '') + '><i class="kdot ma50"></i>MA50</button></div>';
  return '<div class="kwrap" data-t="' + esc(t) + '"><div class="nlabel">DAILY CHART · ' + g.key + ' · ' + g.n + ' SESSIONS</div>' +
    '<div class="klegend">' + kLegend(g.bars[g.n - 1], g.bars[g.n - 2]) + '</div>' + out + ctl + '</div>';
}
function kRedraw(t) {
  var q = ((state.content.stocks || {}).P || {})[t];
  document.querySelectorAll('.kwrap[data-t="' + t + '"]').forEach(function (w) { w.outerHTML = candleSVG(t, q); });
}
function kHover(svg, clientX) {
  var t = svg.getAttribute('data-t'), q = ((state.content.stocks || {}).P || {})[t];
  var g = kGeom(q, t);
  if (!g) return;
  var rect = svg.getBoundingClientRect();
  if (!rect.width) return;
  var x = (clientX - rect.left) / rect.width * KG.W;
  var i = Math.max(0, Math.min(g.n - 1, Math.floor((x - KG.L) / g.step)));
  var b = g.bars[i], cross = svg.querySelector('.kcross');
  if (!b || !cross) return;
  cross.style.display = '';
  var cx = g.x(i).toFixed(1), cy = g.y(b.c).toFixed(1);
  var lx = cross.querySelector('.kcx'), ly = cross.querySelector('.kcy'), box = cross.querySelector('.kpl'), txt = cross.querySelector('.kpt');
  lx.setAttribute('x1', cx); lx.setAttribute('x2', cx);
  ly.setAttribute('y1', cy); ly.setAttribute('y2', cy);
  box.setAttribute('y', (g.y(b.c) - 8).toFixed(1));
  txt.setAttribute('y', (g.y(b.c) + 4).toFixed(1));
  txt.textContent = fnum(b.c, b.c >= 100 ? 0 : 2);
  var legend = svg.parentNode.querySelector('.klegend');
  if (legend) legend.innerHTML = kLegend(b, g.bars[i - 1] || g.all[g.start + i - 1]);
}
function kLeave(svg) {
  var cross = svg.querySelector('.kcross');
  if (cross) cross.style.display = 'none';
  var t = svg.getAttribute('data-t'), q = ((state.content.stocks || {}).P || {})[t], g = kGeom(q, t);
  var legend = svg.parentNode.querySelector('.klegend');
  if (g && legend) legend.innerHTML = kLegend(g.bars[g.n - 1], g.bars[g.n - 2]);
}
function stockRow(e, P) {
  var q = (P || {})[e.t] || {};
  var vlabel = { buy: 'BUY', wait: 'WAIT', refrain: 'REFRAIN' }[e.v] || esc(e.v || '');
  var sincePct = (e.since && e.since.px && q.last) ? ((q.last / e.since.px - 1) * 100) : null;
  var meta = '';
  if (e.cap) meta += '<span class="schip2 num">' + esc(e.cap) + '</span>';
  if (sincePct != null) meta += '<span class="schip2 num ' + (sincePct >= 0 ? 'upc' : 'dnc') + '">' +
    fpct(sincePct) + ' <i>since pick</i></span>';
  if (e.feas && e.feas.p != null) meta += '<span class="schip2 num">FEAS ' + esc(e.feas.p) + '%</span>';
  if (e.tgt != null) meta += '<span class="schip2 tgtc num">TARGET $' + fnum(e.tgt) + (e.tgtPct != null ? ' (' + fpct(e.tgtPct) + ')' : '') + '</span>';
  if (e.conf != null) meta += '<span class="schip2 num">CONF ' + esc(e.conf) + '%</span>';
  if (e.chgTag) meta += '<span class="schip2 chg">' + esc(e.chgTag) + '</span>';

  var inPort = portSet(state.content.stocks || { port: [] }).indexOf(e.t) >= 0;
  var body = '<div class="sact">' + (inPort ?
      '<button type="button" class="rmbtn" data-portrm="' + esc(e.t) + '">\u2212 Remove from portfolio</button>' :
      '<button type="button" class="addbtn" data-portadd-t="' + esc(e.t) + '">+ Add to portfolio</button>') +
    '<button type="button" class="addbtn' + (watchList().indexOf(e.t) >= 0 ? ' on' : '') + '" data-w="' + esc(e.t) + '">' + (watchList().indexOf(e.t) >= 0 ? '\u2605 Watching' : '\u2606 Watch') + '</button></div>' +
    callBox(e, q) + candleSVG(e.t, q);
  if (e.does) body += '<div class="nlabel">WHAT IT DOES</div><p>' + esc(e.does) + '</p>';
  if (e.edge) body += '<div class="nlabel">THE EDGE</div><p>' + esc(e.edge) + '</p>';
  if (e.why) body += '<div class="nlabel">WHY NOW</div><p>' + esc(e.why) + '</p>';
  if (e.ta) body += '<div class="nlabel">THE TAPE</div><p>' + esc(e.ta) + '</p>';
  if (e.fund) body += '<div class="nlabel">THE BOOKS</div><p>' + esc(e.fund) + '</p>';
  if (e.verdict) body += '<div class="nlabel">THE VERDICT</div>' + paras(e.verdict);
  if (e.bear) body += '<div class="nlabel dis">THE BEAR CASE</div><div class="dispbox">' + paras(e.bear) + '</div>';
  if (e.ev) body += '<div class="nlabel">THE EVIDENCE</div>' + paras(e.ev);
  if ((e.sn || []).length) {
    body += '<div class="nlabel">SCENARIOS</div><div class="snbox">' + e.sn.map(function (s) {
      return '<div class="snrow"><span class="snp num">' + Math.round((s[2] || 0) * 100) + '%</span>' +
        '<span class="snl">' + esc(s[0]) + '<span class="snbar"><span style="width:' + Math.round((s[2] || 0) * 100) + '%"></span></span></span>' +
        '<span class="snv num">$' + fnum(s[1]) + '</span></div>';
    }).join('') + '</div>';
  }
  if (e.sc) {
    body += '<div class="nlabel">SCORES</div><div class="meters2">' +
      meterHTML('Tech', e.sc.tech, 10) + meterHTML('Evidence', e.sc.evid, 10) +
      meterHTML('Balance', e.sc.bal, 10) + meterHTML('Value', e.sc.val, 10) +
      (e.up != null ? meterHTML('Upside', e.up, 10) : '') +
      (e.risk != null ? meterHTML('Risk', e.risk, 10) : '') + '</div>';
  }
  var qs = [];
  if (q.chg1m != null) qs.push(['1M', fpct(q.chg1m), q.chg1m]);
  if (q.chg3m != null) qs.push(['3M', fpct(q.chg3m), q.chg3m]);
  if (q.offHi != null) qs.push(['Off 52w high', fpct(q.offHi), q.offHi]);
  if (q.vsSma50 != null) qs.push(['vs SMA50', fpct(q.vsSma50), q.vsSma50]);
  if (q.vsSma200 != null) qs.push(['vs SMA200', fpct(q.vsSma200), q.vsSma200]);
  if (q.volAnn != null) qs.push(['Volatility', fnum(q.volAnn, 1) + '%', 0]);
  if (q.volRel != null) qs.push(['Rel volume', fnum(q.volRel, 2) + 'x', 0]);
  var grid = qs.map(function (p) {
    var cls = p[2] > 0 ? ' upc' : (p[2] < 0 ? ' dnc' : '');
    return '<div><dt>' + esc(p[0]) + '</dt><dd class="num' + cls + '">' + esc(p[1]) + '</dd></div>';
  }).concat((e.stats || []).map(function (p) {
    return '<div><dt>' + esc(p[0]) + '</dt><dd class="num">' + esc(p[1]) + '</dd></div>';
  })).join('');
  if (grid) body += '<div class="nlabel">THE NUMBERS</div><dl class="statgrid">' + grid + '</dl>';
  if ((e.watch || []).length) {
    body += '<div class="nlabel">WATCHING</div><ul class="keypts sm">' +
      e.watch.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
  }
  if (e.drop_reason) body += '<div class="nlabel dis">WHY IT IS NOT A BUY</div><div class="dispbox"><p>' + esc(e.drop_reason) + '</p></div>';
  if (e.note) body += '<p class="snote">' + esc(e.note) + '</p>';

  return '<details class="srow v-' + esc(e.v || '') + '">' +
    '<summary><div class="sr-head">' +
    '<span class="sr-tick num">' + esc(e.t) + '</span>' +
    '<span class="sr-name">' + esc(e.n) + '</span>' +
    '<span class="vpill ' + esc(e.v || '') + '">' + vlabel + '</span>' +
    sparkSVG(q.c) +
    '<span class="sr-px num">' + (q.last != null ? '$' + fnum(q.last) : '') + '</span>' +
    chgPill(q.chg1d) +
    '<button type="button" class="wstar' + (watchList().indexOf(e.t) >= 0 ? ' on' : '') + '" data-w="' + esc(e.t) + '" aria-label="Watch" title="' + (watchList().indexOf(e.t) >= 0 ? 'Remove from watchlist' : 'Add to watchlist') + '">' + (watchList().indexOf(e.t) >= 0 ? '★' : '☆') + '</button></div>' +
    '<div class="sr-meta">' + meta + '</div>' +
    (e.gist ? '<div class="sr-gist">' + esc(e.gist) + '</div>' : '') +
    '</summary><div class="nbody">' + body + '</div></details>';
}
var REPO_ISSUES = 'https://github.com/NoymanDBE/portal/issues/new';
function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function watchList() { return lsGet('watch_v1', []); }
function toggleWatch(t) { var w = watchList(); var i = w.indexOf(t); if (i < 0) w.push(t); else w.splice(i, 1); lsSet('watch_v1', w); }
function portLocal() { var v = lsGet('port_local_v1', {}); return { add: v.add || [], rm: v.rm || [] }; }
function portSet(s) {
  var loc = portLocal(), out = [];
  (s.port || []).concat(loc.add).forEach(function (t) { if (out.indexOf(t) < 0 && loc.rm.indexOf(t) < 0) out.push(t); });
  return out;
}
function portAdd(t) { var loc = portLocal(); t = String(t || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, ''); if (!t) return; loc.rm = loc.rm.filter(function (x) { return x !== t; }); if (loc.add.indexOf(t) < 0) loc.add.push(t); lsSet('port_local_v1', loc); }
function portRemove(t) { var loc = portLocal(); loc.add = loc.add.filter(function (x) { return x !== t; }); if (loc.rm.indexOf(t) < 0) loc.rm.push(t); lsSet('port_local_v1', loc); }
function issueLink(kind, t) {
  var title = kind + ' ' + t;
  var body = (kind === 'ADD' ? 'Please add ' + t + ' to my portfolio and analyze it in the next morning scan.' : 'Please remove ' + t + ' from my portfolio.') + '\n\n(filed from the portal)';
  return REPO_ISSUES + '?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
}
function callBox(e, q) {
  if (e.tgt == null) return '';
  var last = (q || {}).last, up = (last && e.tgt) ? (e.tgt / last - 1) * 100 : e.tgtPct;
  var since = (e.since && e.since.px && last) ? (last / e.since.px - 1) * 100 : null;
  return '<div class="callbox">' +
    '<div><span class="cb-l">Price target</span><b class="num">$' + fnum(e.tgt) + '</b></div>' +
    '<div><span class="cb-l">Upside from here</span><b class="num ' + (up >= 0 ? 'upc' : 'dnc') + '">' + fpct(up) + '</b></div>' +
    (e.tgtH ? '<div><span class="cb-l">Horizon</span><b>' + esc(e.tgtH) + '</b></div>' : '') +
    (e.conf != null ? '<div><span class="cb-l">Conviction</span><b class="num">' + esc(e.conf) + '%</b></div>' : '') +
    (since != null ? '<div><span class="cb-l">Since call ' + esc(e.since.d) + '</span><b class="num ' + (since >= 0 ? 'upc' : 'dnc') + '">' + fpct(since) + '</b></div>' : '') +
    '</div>';
}
function recordHTML(s) {
  var led = (s.ledger || []).slice().reverse(), out = '';
  if ((s.lessons || []).length) {
    out += '<div class="nlabel">LESSONS THE MODEL CARRIES FORWARD</div><ul class="keypts sm">' +
      s.lessons.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>';
  }
  out += '<div class="nlabel">EVERY CALL, SCORED AGAINST THE TAPE</div>';
  if (!led.length) return out + '<p class="scempty">No calls recorded yet.</p>';
  out += '<div class="ledger">' + led.map(function (r) {
    var q = (s.P || {})[r.t] || {};
    var now = r.closed_px != null ? r.closed_px : q.last;
    var mv = (r.px && now) ? (now / r.px - 1) * 100 : null;
    var cls = { buy: 'buy', drop: 'refrain', wait: 'wait', refrain: 'refrain' }[r.call] || 'wait';
    return '<div class="ledrow' + (r.closed ? ' closed' : '') + '">' +
      '<span class="led-d num">' + esc(r.d) + '</span><span class="led-t num">' + esc(r.t) + '</span>' +
      '<span class="vpill ' + cls + '">' + esc(String(r.call || '').toUpperCase()) + '</span>' +
      '<span class="num led-px">$' + fnum(r.px) + (r.tgt ? ' \u2192 $' + fnum(r.tgt) : '') + '</span>' +
      (mv != null ? '<span class="num led-mv ' + (mv >= 0 ? 'upc' : 'dnc') + '">' + fpct(mv) + (r.closed ? ' at close' : ' so far') + '</span>' : '<span></span>') +
      (r.outcome && r.outcome !== 'open' ? '<span class="fchip2' + (r.outcome === 'right' ? ' good' : ' warn') + '">' + esc(r.outcome) + '</span>' : '') +
      (r.note ? '<span class="led-n">' + esc(r.note) + '</span>' : '') + '</div>';
  }).join('') + '</div>';
  return out;
}
function stocksSubtabs(s, sub) {
  var scan = s.C.filter(function (c) { return s.port.indexOf(c.t) < 0; });
  function n(v) { return scan.filter(function (c) { return c.v === v; }).length; }
  function tab(id, label, cnt) {
    return '<a href="#/stocks' + (id ? '/' + id : '') + '"' + (sub === id ? ' class="on"' : '') + '>' + label +
      (cnt != null ? ' <span class="num">' + cnt + '</span>' : '') + '</a>';
  }
  var board = scan.filter(function (c) { return c.v === 'buy' && s.aside.indexOf(c.t) < 0; });
  return '<nav class="subtabs">' + tab('', 'Buy board', board.length) +
    tab('portfolio', 'My Portfolio', portSet(s).length) + tab('watch', '★ Watchlist', watchList().length) +
    tab('dropped', 'Dropped', s.aside.length) + tab('record', 'Record', (s.ledger || []).length) + '</nav>';
}
function stripHTML(s) {
  var tiles = (s.strip || []).map(function (t) {
    var q = s.P[t];
    if (!q) return '';
    return '<div class="mtile2"><span class="mtt num">' + esc(t) + '</span>' +
      '<span class="mtp num">$' + fnum(q.last) + '</span>' +
      '<span class="mtc num ' + (q.chg1d >= 0 ? 'upc' : 'dnc') + '">' + fpct(q.chg1d) + '</span></div>';
  }).join('');
  return tiles ? '<div class="mstrip2">' + tiles + '</div>' : '';
}
function stocksHTML(s, sub) {
  var known = { '': 1, portfolio: 1, watch: 1, dropped: 1, record: 1 };
  if (!known[sub]) sub = '';
  var scan = s.C.filter(function (c) { return s.port.indexOf(c.t) < 0; });
  var byT = {};
  s.C.forEach(function (c) { byT[c.t] = c; });
  var body = stripHTML(s);
  function rows(list) { return list.map(function (e) { return stockRow(e, s.P); }).join(''); }
  function group(v, label) {
    var list = scan.filter(function (c) { return c.v === v; });
    if (!list.length) return '';
    return '<div class="ngroup"><span>' + label + ' · ' + list.length + '</span></div>' + rows(list);
  }
  if (sub === '') {
    if ((s.gist || []).length) {
      body += '<div class="nlabel">THIS MORNING, BRIEFLY</div><ul class="keypts">' +
        s.gist.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>';
    }
    var board = scan.filter(function (c) { return c.v === 'buy' && s.aside.indexOf(c.t) < 0; });
    body += '<div class="ngroup"><span>BUY · ' + board.length + '</span></div>' +
      (board.length ? rows(board) : '<p class="scempty">No Buy-grade company on the board today.</p>');
  } else if (sub === 'portfolio') {
    var pset = portSet(s);
    body += '<form class="portadd" autocomplete="off"><input id="port-q" name="q" list="tick-list" placeholder="Add a ticker \u2014 e.g. NVDA" maxlength="12">' +
      '<datalist id="tick-list">' + s.C.map(function (c) { return '<option value="' + esc(c.t) + '">' + esc(c.n || '') + '</option>'; }).join('') + '</datalist>' +
      '<button type="submit" data-portadd="1">Add</button></form>';
    if (!pset.length) body += '<p class="scempty">Your portfolio is empty \u2014 add a ticker above.</p>';
    var pending = [];
    pset.forEach(function (t) {
      if (byT[t]) body += stockRow(byT[t], s.P);
      else pending.push(t);
    });
    if (pending.length) {
      body += '<div class="nlabel">AWAITING ANALYSIS</div>' + pending.map(function (t) {
        return '<div class="pend"><span class="pend-t num">' + esc(t) + '</span><span class="pend-x">Not on the board yet \u2014 the 06:00 scan analyzes requested tickers. ' +
          '<a href="' + issueLink('ADD', t) + '" target="_blank" rel="noopener noreferrer">Request analysis \u2197</a> (or just tell Claude).</span>' +
          '<button type="button" class="rmbtn" data-portrm="' + esc(t) + '">Remove</button></div>';
      }).join('');
    }
  } else if (sub === 'watch') {
    var wl = watchList().map(function (t) { return byT[t]; }).filter(Boolean);
    body += wl.length ? rows(wl) : '<p class="scempty">Nothing on your watchlist yet \u2014 tap the \u2606 on any company to follow it here.</p>';
  } else if (sub === 'dropped') {
    body += '<div class="nlabel">NOT ON THE BOARD — AND WHY</div>' +
      rows(s.aside.map(function (t) { return byT[t]; }).filter(Boolean));
  } else if (sub === 'record') {
    body += recordHTML(s);
  }
  return '<article class="paper stocks"><div class="edline">' + esc((s.kicker || '').toUpperCase()) +
    (s.built ? ' · UPDATED ' + esc(s.built) : '') + '</div>' +
    '<div class="tallyrow">' +
    '<span class="tly buy num">' + s.C.filter(function (c) { return c.v === 'buy' && s.port.indexOf(c.t) < 0 && s.aside.indexOf(c.t) < 0; }).length + ' BUY</span>' +
    '<span class="tly refrain num">' + (s.aside || []).length + ' DROPPED</span>' +
    '<span class="tly wait num">' + (s.ledger || []).length + ' CALLS ON RECORD</span></div>' +
    (s.dateline ? '<p class="scandate">' + esc(s.dateline) + '</p>' : '') +
    stocksSubtabs(s, sub) + body +
    '<div class="caughtup">Bottom lines are research, not personalized investment advice.</div></article>';
}

/* ---------- Morning News ---------- */
function paras(t) {
  return String(t || '').split(/\n\n+/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
}
function storyHTML(st, secId, groupTitle) {
  var badges = '';
  if (st.disp) badges += '<span class="nbadge contested">CONTESTED</span>';
  if (secId === 'med' && /ophthalm/i.test(groupTitle || '')) badges += '<span class="nbadge spec">SPECIALIST</span>';
  var conf = (st.conf || []).map(function (c) {
    return '<div class="readrow"><span class="pct num">' + esc(c.p) + '%</span><div><div class="claim">' + esc(c.c) + '</div>' +
      (c.w ? '<div class="why">' + esc(c.w) + '</div>' : '') + '</div></div>';
  }).join('');
  var srcs = st.src || [];
  var img = (st.img && /^https:\/\//.test(st.img.u || '')) ? st.img : null;
  var thumb = img ? '<img class="thumb" src="' + esc(img.u) + '" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.style.display=\'none\'">' : '';
  var fig = img ? '<figure class="nfig"><img src="' + esc(img.u) + '" alt="' + esc(img.cap || '') + '" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentNode.style.display=\'none\'">' +
    '<figcaption>' + esc(img.cap || '') + (img.credit ? '<span class="cr">' + esc(img.credit) + '</span>' : '') + '</figcaption></figure>' : '';
  return '<details class="nstory">' +
    '<summary><div class="hwrap"><h3>' + esc(st.h) + '</h3>' + badges + '</div>' + thumb +
    '<div class="blbox"><span class="bl-l">Bottom line</span>' + esc(st.bl) + '</div></summary>' +
    '<div class="nbody">' + fig +
    '<div class="nlabel">THE FACTS</div>' + paras(st.body) +
    (conf ? '<div class="nlabel">OUR READ</div>' + conf : '') +
    (st.disp ? '<div class="nlabel dis">ROOM FOR DISAGREEMENT</div><div class="dispbox">' + paras(st.disp) + '</div>' : '') +
    (srcs.length ? '<details class="allsrc"><summary>ALL SOURCES (' + srcs.length + ')</summary><div class="srclist">' + srcs.map(esc).join(' · ') + '</div></details>' : '') +
    '</div></details>';
}
function secCount(s) {
  return (s.groups || []).reduce(function (a, g) { return a + (g.stories || []).length; }, 0);
}
function newsSubtabs(n, sub) {
  var secs = n.sections || [];
  function tab(id, label, cnt) {
    var href = '#/news' + (id ? '/' + id : '');
    return '<a href="' + href + '"' + (sub === id ? ' class="on"' : '') + '>' + esc(label) +
      (cnt != null ? ' <span class="num">' + cnt + '</span>' : '') + '</a>';
  }
  return '<nav class="subtabs">' + tab('', 'Overview') +
    secs.map(function (s) { return tab(s.id, s.label, secCount(s)); }).join('') + '</nav>';
}
function newsOverviewHTML(n) {
  var out = '<div class="nlabel">THE KEY POINTS</div>';
  out += '<ul class="keypts">' + (n.keys || []).map(function (k) { return '<li>' + esc(k) + '</li>'; }).join('') + '</ul>';
  out += '<div class="ovhint">Everything else lives in the section tabs above.</div>';
  return out;
}
function newsSectionHTML(s) {
  var out = '';
  if ((s.bl || []).length) {
    out += '<div class="nlabel">THE BOTTOM LINES</div><div class="secbl"><ul>' +
      s.bl.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>';
  }
  (s.groups || []).forEach(function (g) {
    if (g.title) out += '<div class="ngroup"><span>' + esc(g.title) + '</span></div>';
    out += (g.stories || []).map(function (st) { return storyHTML(st, s.id, g.title); }).join('');
  });
  return out;
}
function newsHTML(n, sub) {
  var secs = n.sections || [];
  var known = { '': 1 };
  secs.forEach(function (s) { known[s.id] = 1; });
  if (!known[sub]) sub = '';
  var body;
  if (sub === '') body = newsOverviewHTML(n);
  else body = newsSectionHTML(secs.filter(function (s) { return s.id === sub; })[0]);
  return '<article class="paper"><div class="edline">' + esc(n.edition_line || '') + '</div>' +
    newsSubtabs(n, sub) + body + '</article>';
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function enter() {
  $('gate').hidden = true;
  $('gate').style.display = 'none';
  $('app').hidden = false;
  $('app').style.display = '';
  var m = state.manifest || {};
  $('freshline').textContent = m.generated_at ? 'Generated ' + m.generated_at : '';
  route();
}

/* ---------- wiring ---------- */
window.addEventListener('hashchange', route);
$('view').addEventListener('click', function (ev) {
  var el = ev.target && ev.target.closest ? ev.target : null;
  if (!el) return;
  var b = el.closest('.savestar');
  if (b) { ev.preventDefault(); toggleSaved(b.getAttribute('data-id')); route(); return; }
  var kr = el.closest('[data-kr]');
  if (kr) { ev.preventDefault(); var w = kr.closest('.kwrap'); K.range[w.getAttribute('data-t')] = kr.getAttribute('data-kr'); kRedraw(w.getAttribute('data-t')); return; }
  var ws = el.closest('[data-w]');
  if (ws) { ev.preventDefault(); toggleWatch(ws.getAttribute('data-w')); route(); return; }
  var pa = el.closest('[data-portadd-t]');
  if (pa) { ev.preventDefault(); portAdd(pa.getAttribute('data-portadd-t')); route(); return; }
  var pr = el.closest('[data-portrm]');
  if (pr) { ev.preventDefault(); portRemove(pr.getAttribute('data-portrm')); route(); return; }
  var ss = el.closest('[data-ssort]');
  if (ss) { ev.preventDefault(); SH.sort = ss.getAttribute('data-ssort'); route(); return; }
  var sr = el.closest('[data-sref]');
  if (sr) { ev.preventDefault(); var cs = parseRoute().sub || ''; SH.ref[cs] = sr.getAttribute('data-sref'); route(); return; }
  var km = el.closest('[data-kma]');
  if (km) {
    ev.preventDefault();
    if (km.getAttribute('data-kma') === '20') K.ma20 = !K.ma20; else K.ma50 = !K.ma50;
    document.querySelectorAll('.kwrap').forEach(function (w) { kRedraw(w.getAttribute('data-t')); });
  }
});
$('view').addEventListener('submit', function (ev) {
  var f = ev.target && ev.target.closest ? ev.target.closest('form.portadd') : null;
  if (!f) return;
  ev.preventDefault();
  var inp = f.querySelector('input');
  var t = (inp.value || '').trim().toUpperCase();
  if (t) { portAdd(t); inp.value = ''; route(); }
});
$('view').addEventListener('mousemove', function (ev) {
  var svg = ev.target && ev.target.closest ? ev.target.closest('svg.kchart[data-t]') : null;
  if (svg) kHover(svg, ev.clientX);
});
$('view').addEventListener('mouseout', function (ev) {
  var svg = ev.target && ev.target.closest ? ev.target.closest('svg.kchart[data-t]') : null;
  if (svg && !(ev.relatedTarget && svg.contains(ev.relatedTarget))) kLeave(svg);
});
$('view').addEventListener('touchstart', function (ev) {
  var svg = ev.target && ev.target.closest ? ev.target.closest('svg.kchart[data-t]') : null;
  if (svg && ev.touches[0]) kHover(svg, ev.touches[0].clientX);
}, { passive: true });
$('view').addEventListener('touchmove', function (ev) {
  var svg = ev.target && ev.target.closest ? ev.target.closest('svg.kchart[data-t]') : null;
  if (svg && ev.touches[0]) kHover(svg, ev.touches[0].clientX);
}, { passive: true });
$('unlock-btn').addEventListener('click', function () {
  var t = $('key-input').value.trim();
  if (t) tryUnlock(t, false);
});
$('theme-btn').addEventListener('click', function () {
  var cur = document.documentElement.getAttribute('data-theme');
  var next = cur === 'light' ? '' : 'light';
  if (next) document.documentElement.setAttribute('data-theme', next);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('theme', next); } catch (e) {}
});
try {
  var th = localStorage.getItem('theme');
  if (th) document.documentElement.setAttribute('data-theme', th);
} catch (e) {}

tryStoredKey();
})();
