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
  return fetch(BASE + rel).then(function (r) {
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
function shopCard(it, saved) {
  var img = (it.img && it.img.indexOf('data:image/') === 0) ?
    '<img class="scimg" src="' + it.img + '" alt="" loading="lazy">' :
    '<div class="scimg ph">🛍️</div>';
  var flags = (it.flags || []).map(function (f) {
    var cls = /deal/i.test(f) ? ' good' : (/fake|above market|no coa|no longer|unverified/i.test(f) ? ' warn' : '');
    return '<span class="fchip2' + cls + '">' + esc(f) + '</span>';
  }).join('');
  return '<div class="scard3">' +
    (it.is_new ? '<span class="newbdg">NEW</span>' : '') +
    '<button class="savestar num' + (saved ? ' on' : '') + '" data-id="' + esc(it.id) + '" aria-label="Save item" title="' +
    (saved ? 'Remove from saved' : 'Save this item') + '">' + (saved ? '★' : '☆') + '</button>' + img +
    '<div class="scb">' +
    '<div class="sct">' + esc(it.t) + '</div>' +
    '<div class="scp num">' + esc(it.p) + '</div>' +
    '<div class="scmeta"><span class="schip2">From: ' + esc(it.origin || it.site) + '</span>' +
    (it.cond ? '<span class="schip2">' + esc(it.cond) + '</span>' : '') + '</div>' +
    costGrid(it.costs) +
    (flags ? '<div class="scmeta">' + flags + '</div>' : '') +
    (it.notes ? '<p class="scnotes">' + esc(it.notes) + '</p>' : '') +
    (it.mkt ? '<p class="scmkt">' + esc(it.mkt) + '</p>' : '') +
    '<div class="scfoot"><span class="scdate num">found ' + esc(it.found || '') +
    (it.chk ? ' · checked ' + esc(it.chk) : '') + '</span>' +
    '<a class="sclink" href="' + esc(it.u) + '" target="_blank" rel="noopener noreferrer">View listing ↗</a></div>' +
    '</div></div>';
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
  function grid(list) {
    return list.length ? '<div class="shopgrid">' + list.map(function (it) { return shopCard(it, !!saved[it.id]); }).join('') + '</div>' :
      '<p class="scempty">No live finds for this hunt right now — the robot keeps looking every morning.</p>';
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
    body = list.length ? '<div class="shopgrid">' + list.map(function (it) { return shopCard(it, true); }).join('') + '</div>' :
      '<p class="scempty">Nothing saved yet — hit the ☆ on any find to keep it here.</p>';
  } else {
    var q = (s.searches || []).filter(function (x) { return x.id === sub; })[0] || {};
    if (q.notes) body += '<p class="scandate">' + esc(q.notes) + '</p>';
    body += grid(bySid[sub] || []);
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
function stockRow(e, P) {
  var q = (P || {})[e.t] || {};
  var vlabel = { buy: 'BUY', wait: 'WAIT', refrain: 'REFRAIN' }[e.v] || esc(e.v || '');
  var sincePct = (e.since && e.since.px && q.last) ? ((q.last / e.since.px - 1) * 100) : null;
  var meta = '';
  if (e.cap) meta += '<span class="schip2 num">' + esc(e.cap) + '</span>';
  if (sincePct != null) meta += '<span class="schip2 num ' + (sincePct >= 0 ? 'upc' : 'dnc') + '">' +
    fpct(sincePct) + ' <i>since pick</i></span>';
  if (e.feas && e.feas.p != null) meta += '<span class="schip2 num">FEAS ' + esc(e.feas.p) + '%</span>';
  if (e.tgt != null) meta += '<span class="schip2 num">EV $' + fnum(e.tgt) + (e.tgtPct != null ? ' (' + fpct(e.tgtPct) + ')' : '') + '</span>';
  if (e.conf != null) meta += '<span class="schip2 num">CONF ' + esc(e.conf) + '%</span>';
  if (e.chgTag) meta += '<span class="schip2 chg">' + esc(e.chgTag) + '</span>';

  var body = '';
  if (e.does) body += '<div class="nlabel">WHAT IT DOES</div><p>' + esc(e.does) + '</p>';
  if (e.edge) body += '<div class="nlabel">THE EDGE</div><p>' + esc(e.edge) + '</p>';
  if (e.why) body += '<div class="nlabel">WHY NOW</div><p>' + esc(e.why) + '</p>';
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
  if (e.note) body += '<p class="snote">' + esc(e.note) + '</p>';

  return '<details class="srow v-' + esc(e.v || '') + '">' +
    '<summary><div class="sr-head">' +
    '<span class="sr-tick num">' + esc(e.t) + '</span>' +
    '<span class="sr-name">' + esc(e.n) + '</span>' +
    '<span class="vpill ' + esc(e.v || '') + '">' + vlabel + '</span>' +
    sparkSVG(q.c) +
    '<span class="sr-px num">' + (q.last != null ? '$' + fnum(q.last) : '') + '</span>' +
    chgPill(q.chg1d) + '</div>' +
    '<div class="sr-meta">' + meta + '</div>' +
    (e.gist ? '<div class="sr-gist">' + esc(e.gist) + '</div>' : '') +
    '</summary><div class="nbody">' + body + '</div></details>';
}
function stocksSubtabs(s, sub) {
  var scan = s.C.filter(function (c) { return s.port.indexOf(c.t) < 0; });
  function n(v) { return scan.filter(function (c) { return c.v === v; }).length; }
  function tab(id, label, cnt) {
    return '<a href="#/stocks' + (id ? '/' + id : '') + '"' + (sub === id ? ' class="on"' : '') + '>' + label +
      (cnt != null ? ' <span class="num">' + cnt + '</span>' : '') + '</a>';
  }
  return '<nav class="subtabs">' + tab('', 'Board', scan.length) +
    tab('buy', 'Buy', n('buy')) + tab('wait', 'Wait', n('wait')) + tab('refrain', 'Refrain', n('refrain')) +
    tab('portfolio', 'My Portfolio', s.port.length) + tab('dropped', 'Dropped', s.aside.length) + '</nav>';
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
  var known = { '': 1, buy: 1, wait: 1, refrain: 1, portfolio: 1, dropped: 1 };
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
    body += group('buy', 'BUY') + group('wait', 'WAIT') + group('refrain', 'REFRAIN');
  } else if (sub === 'portfolio') {
    body += rows(s.port.map(function (t) { return byT[t]; }).filter(Boolean));
  } else if (sub === 'dropped') {
    body += '<div class="nlabel">DROPPED FROM THE BOARD</div>' +
      rows(s.aside.map(function (t) { return byT[t]; }).filter(Boolean));
  } else {
    body += rows(scan.filter(function (c) { return c.v === sub; }));
  }
  return '<article class="paper stocks"><div class="edline">' + esc((s.kicker || '').toUpperCase()) +
    (s.built ? ' · UPDATED ' + esc(s.built) : '') + '</div>' +
    '<div class="tallyrow">' +
    '<span class="tly buy num">' + (s.tally || {}).buy + ' BUY</span>' +
    '<span class="tly wait num">' + (s.tally || {}).wait + ' WAIT</span>' +
    '<span class="tly refrain num">' + (s.tally || {}).refrain + ' REFRAIN</span></div>' +
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
    secs.map(function (s) { return tab(s.id, s.label, secCount(s)); }).join('') +
    tab('markets', 'Markets') + tab('briefs', 'Briefs') + '</nav>';
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
function newsMarketsHTML(n) {
  var out = '<div class="nlabel">MARKETS</div><div class="mtable">';
  out += (n.markets || []).map(function (m) {
    var dir = /^-|down/i.test(m.c || '') ? 'dn' : (/^\+|up/i.test(m.c || '') ? 'up' : '');
    return '<div class="mrow"><span class="mrn">' + esc(m.n) + '</span><span class="mrv num">' + esc(m.v) + '</span>' +
      '<span class="mrc num ' + dir + '">' + esc(m.c) + '</span><span class="mrd num">' + esc(m.d || '') + '</span></div>';
  }).join('');
  out += '</div>';
  if (n.mktNote) out += '<div class="nlabel">ABOUT THESE NUMBERS</div><p class="mnotep">' + esc(n.mktNote) + '</p>';
  return out;
}
function newsBriefsHTML(n) {
  var out = '<div class="nlabel">IN ONE LINE</div><ul class="briefs">' +
    (n.brief || []).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>';
  if ((n.archive || []).length) {
    out += '<details class="allsrc arch"><summary>PAST EDITIONS (' + n.archive.length + ')</summary>' +
      n.archive.map(function (d) {
        return '<div class="archday"><b>' + esc(d.d) + '</b><ul>' + (d.top || []).map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul></div>';
      }).join('') + '</details>';
  }
  out += '<div class="caughtup">You’re caught up. Next edition ~04:50.</div>';
  return out;
}
function newsHTML(n, sub) {
  var secs = n.sections || [];
  var known = { '': 1, markets: 1, briefs: 1 };
  secs.forEach(function (s) { known[s.id] = 1; });
  if (!known[sub]) sub = '';
  var body;
  if (sub === '') body = newsOverviewHTML(n);
  else if (sub === 'markets') body = newsMarketsHTML(n);
  else if (sub === 'briefs') body = newsBriefsHTML(n);
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
  var b = ev.target && ev.target.closest ? ev.target.closest('.savestar') : null;
  if (!b) return;
  ev.preventDefault();
  toggleSaved(b.getAttribute('data-id'));
  route();
});
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
