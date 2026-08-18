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
    .then(function (m) { state.manifest = m; return loadBlob('home'); })
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
      .then(function (m) { state.manifest = m; return loadBlob('home'); })
      .then(enter)
      .catch(function (e) {
        if (e && e.step === 'manifest') { showGate(); gateError(e); return; }
        showGate();
        if (e && e.step) gateError(e);
      });
  }).catch(showGate);
}

/* ---------- views ---------- */
var NAMES = { home: 'Home', news: "Dror's Morning News", stocks: "Dror's Stock Screener", shopping: "Dror's Shopping Scout" };
function parseRoute() {
  var parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  var r = parts[0] || 'home';
  if (!NAMES[r]) r = 'home';
  return { r: r, sub: parts.slice(1).join('/') };
}
function route() {
  var cur = parseRoute();
  document.querySelectorAll('.tabs a').forEach(function (a) {
    a.classList.toggle('on', a.getAttribute('data-r') === cur.r);
  });
  var v = $('view');
  if (cur.r === 'home') { v.innerHTML = homeHTML(state.content.home); return; }
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
  v.innerHTML = '<div class="placeholder"><div class="a">' + NAMES[cur.r] + '</div>' +
    '<div class="b">This section arrives in ' + ({ stocks: 'Phase 3', shopping: 'Phase 4' })[cur.r] + ' — the pipeline behind it is already being wired.</div></div>';
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
  return '<details class="nstory">' +
    '<summary><h3>' + esc(st.h) + '</h3>' + badges +
    '<div class="blbox"><span class="bl-l">Bottom line</span>' + esc(st.bl) + '</div></summary>' +
    '<div class="nbody">' +
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
function homeHTML(h) {
  h = h || {};
  return '<div class="edline">' + esc(h.edition_line || '') + '</div>' +
    '<div class="hero-num">' + esc(h.lead || 'Welcome.') + '</div>' +
    '<span class="okchip">✓ Decryption verified — this content was unreadable without your key</span>' +
    '<div class="mods">' +
    mod('news', 'Dror\'s Morning News', h.news_status || 'Verified stories with confidence scores.', 'Phase 2') +
    mod('stocks', 'Dror\'s Stock Screener', h.stocks_status || 'Feasibility-first small-cap research.', 'Phase 3') +
    mod('shopping', 'Dror\'s Shopping Scout', h.shopping_status || 'Daily verified hunts for what you want.', 'Phase 4') +
    '</div>';
}
function mod(slug, name, desc, phase) {
  var color = { news: 'var(--news)', stocks: 'var(--stocks)', shopping: 'var(--shop)' }[slug];
  return '<a class="mod" href="#/' + slug + '"><span class="dot" style="background:' + color + '"></span><h3>' + name + '</h3>' +
    '<p>' + esc(desc) + '</p><div class="st"><span class="phase">' + phase + '</span></div></a>';
}
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
