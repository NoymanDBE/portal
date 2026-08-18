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
function route() {
  var r = (location.hash.replace('#/', '') || 'home').split('/')[0];
  if (!NAMES[r]) r = 'home';
  document.querySelectorAll('.tabs a').forEach(function (a) {
    a.classList.toggle('on', a.getAttribute('data-r') === r);
  });
  var v = $('view');
  if (r === 'home') { v.innerHTML = homeHTML(state.content.home); return; }
  v.innerHTML = '<div class="placeholder"><div class="a">' + NAMES[r] + '</div>' +
    '<div class="b">This section arrives in ' + ({ news: 'Phase 2', stocks: 'Phase 3', shopping: 'Phase 4' })[r] + ' — the pipeline behind it is already being wired.</div></div>';
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
