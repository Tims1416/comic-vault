const sb = supabase.createClient(CFG.url, CFG.key);
const $ = (s, r = document) => r.querySelector(s), app = $('#app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null || n === '' ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toast = t => { let e = $('#toast'); if (!e) { e = document.createElement('div'); e.id = 'toast'; document.body.append(e) } e.textContent = t; e.hidden = !t; if (t) setTimeout(() => e.hidden = true, 3500) };
const KINDS = ['purchase', 'shipping', 'grading', 'grading_shipping', 'pressing', 'signing', 'commission', 'other'];
const VENUES = ['eBay', 'MyComicShop', 'Heritage', 'ComicLink', 'GoCollect', 'Other'];
const FIELDS = [
  ['title', 'Title / series'], ['issue_number', 'Issue #'], ['description', 'Description', 'text', 'full'],
  ['grader', 'Grader', ['CGC', 'CBCS', 'PGX', 'Other']], ['cert_number', 'Verification (cert) #'],
  ['grade', 'Grade', 'number'], ['page_color', 'Page color', ['White', 'OW-W', 'OW', 'CR-OW', 'CR', 'LT-CR', 'Tan']],
  ['book_type', 'Type', ['Universal', 'Signature Series', 'Restored']], ['purchase_date', 'Purchase date', 'date'],
  ['pop_universal', 'Census: Universal at this grade', 'number'], ['pop_sig_series', 'Census: Sig Series at this grade', 'number'],
  ['pop_higher', 'Census: higher grades', 'number'], ['fmv', 'FMV ($)', 'number'],
  ['mcs_url', 'MyComicShop sales URL', 'text', 'full'], ['artist', 'Artist (commissions)'], ['event', 'Event (commissions)'],
  ['notes', 'Notes', 'area', 'full']];
let books = null, uid = null, filt = { q: '', grader: '', type: '' };
const invested = b => (b.costs || []).reduce((a, c) => a + Number(c.amount), 0);
const med = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 };

/* ---------- routing & auth ---------- */
async function route() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { uid = null; books = null; return authView() }
  uid = session.user.id;
  const h = location.hash;
  if (h.startsWith('#book/')) return bookView(h.slice(6));
  if (h === '#new') return bookView(null);
  return listView();
}
addEventListener('hashchange', route);
sb.auth.onAuthStateChange((ev, s) => { if (ev === 'PASSWORD_RECOVERY') return recoveryView(); const id = s?.user?.id || null; if (id !== uid) route() });
route();

function authView() {
  app.innerHTML = `<main class="card narrow"><h1>Comic Vault</h1><p class="muted">Sign in to open your collection</p>
  <input id="em" type="email" placeholder="Email" autocomplete="email"><input id="pw" type="password" placeholder="Password (8+ characters)" autocomplete="current-password">
  <button id="in">Sign in</button><button id="up" class="ghost">Create account</button><button id="rs" class="link">Forgot password?</button><p id="am" class="muted"></p></main>`;
  const v = () => [$('#em').value.trim(), $('#pw').value], say = t => $('#am').textContent = t;
  $('#in').onclick = async () => { const [e, p] = v(); const { error } = await sb.auth.signInWithPassword({ email: e, password: p }); if (error) say(error.message) };
  $('#up').onclick = async () => { const [e, p] = v(); if (p.length < 8) return say('Use at least 8 characters.'); const { data, error } = await sb.auth.signUp({ email: e, password: p }); say(error ? error.message : data.session ? '' : 'Check your email to confirm your account, then sign in.') };
  $('#rs').onclick = async () => { const [e] = v(); if (!e) return say('Enter your email first.'); const { error } = await sb.auth.resetPasswordForEmail(e, { redirectTo: location.origin + location.pathname }); say(error ? error.message : 'Reset link sent. Check your email.') };
}
function recoveryView() {
  app.innerHTML = `<main class="card narrow"><h1>Set a new password</h1><input id="np" type="password" placeholder="New password (8+ characters)"><button id="go">Update password</button><p id="am" class="muted"></p></main>`;
  $('#go').onclick = async () => { const p = $('#np').value; if (p.length < 8) return $('#am').textContent = 'Use at least 8 characters.'; const { error } = await sb.auth.updateUser({ password: p }); if (error) $('#am').textContent = error.message; else { location.hash = ''; route() } };
}

/* ---------- inventory list ---------- */
async function fetchAll(sel) {
  let all = [], from = 0;
  for (; ;) { const { data, error } = await sb.from('books').select(sel).order('created_at').range(from, from + 499); if (error) { toast(error.message); break } all.push(...data); if (data.length < 500) break; from += 500 }
  return all;
}
async function loadBooks() {
  if (books) return;
  books = (await fetchAll('*,costs(amount)')).sort((a, b) => a.title.localeCompare(b.title) || String(a.issue_number ?? '').localeCompare(String(b.issue_number ?? ''), undefined, { numeric: true }));
}
async function listView() {
  app.innerHTML = '<p class="muted pad">Loading…</p>'; await loadBooks();
  const opt = (a, all) => `<option value="">${all}</option>` + a.map(x => `<option>${x}</option>`).join('');
  app.innerHTML = `<header class="bar"><h1>Comic Vault</h1><span><button id="imp" class="ghost">Import</button><button id="exp" class="ghost">Export</button><button id="out" class="ghost">Sign out</button></span></header>
  <section id="sum" class="sum"></section>
  <section class="ctl"><input id="q" type="search" placeholder="Search title, issue, cert #, artist" value="${esc(filt.q)}">
  <select id="fg">${opt(['CGC', 'CBCS', 'PGX'], 'All graders')}</select><select id="ft">${opt(['Universal', 'Signature Series', 'Restored', 'Commission'], 'All types')}</select><a class="btn" href="#new">+ Add</a></section>
  <div id="rows"></div><input id="file" type="file" accept=".json" hidden>`;
  $('#fg').value = filt.grader; $('#ft').value = filt.type;
  $('#q').oninput = e => { filt.q = e.target.value; paint() }; $('#fg').onchange = e => { filt.grader = e.target.value; paint() }; $('#ft').onchange = e => { filt.type = e.target.value; paint() };
  $('#out').onclick = () => sb.auth.signOut();
  $('#imp').onclick = () => { if (!books.length || confirm('You already have books saved. Importing again will add duplicates. Continue?')) $('#file').click() };
  $('#file').onchange = e => e.target.files[0] && doImport(e.target.files[0]);
  $('#exp').onclick = doExport; paint();
}
function paint() {
  const q = filt.q.toLowerCase();
  const rows = books.filter(b => (!filt.grader || b.grader === filt.grader) && (!filt.type || (filt.type === 'Commission' ? b.is_commission : b.book_type === filt.type)) && (!q || [b.title, b.issue_number, b.description, b.cert_number, b.artist].join(' ').toLowerCase().includes(q)));
  const inv = rows.reduce((a, b) => a + invested(b), 0), priced = rows.filter(b => b.fmv != null);
  const val = priced.reduce((a, b) => a + +b.fmv, 0), pinv = priced.reduce((a, b) => a + invested(b), 0);
  $('#sum').innerHTML = `<div><small>Books</small><b>${rows.length}</b></div><div><small>Invested</small><b>${money(inv)}</b></div><div><small>Est. value (${priced.length} priced)</small><b>${money(val)}</b></div><div><small>Gain / loss on priced</small><b>${money(val - pinv)}</b></div>`;
  $('#rows').innerHTML = rows.map(b => `<a class="row" href="#book/${b.id}"><div><b>${esc(b.title)} #${esc(b.issue_number)}</b><small>${esc(b.description || b.artist || '')}</small></div>
  <div class="r"><span class="tag">${esc(b.grader || 'Raw')} ${b.grade ?? ''}</span><small>${esc(b.is_commission ? 'Commission' : b.book_type || '')}</small><small>${money(invested(b))} → ${money(b.fmv)}</small></div></a>`).join('') || '<p class="muted pad">No books match.</p>';
}

/* ---------- import / export ---------- */
async function doImport(file) {
  let arr; try { arr = JSON.parse(await file.text()) } catch { return toast('That file is not valid JSON') }
  for (let i = 0; i < arr.length; i += 100) {
    const chunk = arr.slice(i, i + 100), rows = chunk.map(({ costs, ...b }) => b);
    const { data, error } = await sb.from('books').insert(rows).select('id'); if (error) return toast(error.message);
    const cs = []; data.forEach((r, j) => (chunk[j].costs || []).forEach(c => cs.push({ ...c, book_id: r.id })));
    if (cs.length) { const e = (await sb.from('costs').insert(cs)).error; if (e) return toast(e.message) }
    toast(`Imported ${Math.min(i + 100, arr.length)} of ${arr.length}`);
  }
  books = null; route();
}
async function doExport() {
  toast('Preparing backup…'); const data = await fetchAll('*,costs(*),comps(*)');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `comic-vault-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); toast('');
}

/* ---------- FMV estimate: recency-weighted (90-day half-life), outliers trimmed, 24-month window ---------- */
function est(comps) {
  const now = Date.now();
  let c = comps.map(x => ({ p: +x.price, a: (now - new Date(x.sale_date)) / 864e5 })).filter(x => x.a <= 730 && x.p > 0);
  if (!c.length) return null;
  if (c.length >= 4) { const m = med(c.map(x => x.p)); c = c.filter(x => x.p >= m * .5 && x.p <= m * 2) }
  let w = 0, t = 0; c.forEach(x => { const k = Math.pow(.5, Math.max(0, x.a) / 90); w += k; t += k * x.p });
  return { fmv: t / w, lo: Math.min(...c.map(x => x.p)), hi: Math.max(...c.map(x => x.p)), n: c.length, conf: c.length >= 5 ? 'high' : c.length >= 3 ? 'medium' : 'low' };
}

/* ---------- book detail ---------- */
const get = () => { const o = {}; FIELDS.forEach(([k, , t]) => { const e = $('#f_' + k); const v = e.value.trim(); o[k] = v === '' ? null : t === 'number' ? Number(v) : v }); o.is_commission = $('#f_is_commission').checked; return o };
async function save(b, silent) {
  const o = get(); if (!o.title) { toast('Title is required'); return null }
  const { data, error } = await (b.id ? sb.from('books').update(o).eq('id', b.id) : sb.from('books').insert(o)).select('id').single();
  if (error) { toast(error.message); return null } books = null; if (!silent) toast('Saved'); return data.id;
}
async function shrink(file, max = 1800) {
  const bmp = await createImageBitmap(file), k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', .88));
}
async function bookView(id) {
  app.innerHTML = '<p class="muted pad">Loading…</p>';
  let b = { is_commission: false, costs: [], comps: [], prior_slabs: [] };
  if (id) { const { data, error } = await sb.from('books').select('*,costs(*),comps(*)').eq('id', id).single(); if (error) { toast(error.message); return location.hash = '' } b = data }
  const urls = {};
  for (const s of ['front', 'back']) if (b[s + '_path']) { const { data } = await sb.storage.from('covers').createSignedUrl(b[s + '_path'], 3600); urls[s] = data?.signedUrl }
  const input = ([k, l, t, w]) => {
    const v = b[k] ?? '', cls = w === 'full' ? ' class="full"' : '';
    if (Array.isArray(t)) return `<label${cls}>${l}<select id="f_${k}"><option value=""></option>${[...new Set([...t, ...(v ? [v] : [])])].map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    if (t === 'area') return `<label${cls}>${l}<textarea id="f_${k}" rows="3">${esc(v)}</textarea></label>`;
    return `<label${cls}>${l}<input id="f_${k}" type="${t === 'number' ? 'number' : t === 'date' ? 'date' : 'text'}" ${t === 'number' ? 'step="any"' : ''} value="${esc(v)}"></label>`;
  };
  const total = invested(b), e = est(b.comps || []);
  const q = encodeURIComponent([b.title, '#' + (b.issue_number || ''), b.grader, b.grade].filter(Boolean).join(' '));
  const links = [b.grader === 'CGC' && b.cert_number && `<a target="_blank" rel="noopener" href="https://www.cgccomics.com/certlookup/${esc(b.cert_number)}/">Verify at CGC (census)</a>`,
  b.mcs_url && `<a target="_blank" rel="noopener" href="${esc(b.mcs_url)}">MyComicShop sales</a>`,
  b.title && `<a target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1">eBay sold</a>`].filter(Boolean).join('');
  const side = s => urls[s] ? `<div><img src="${urls[s]}" alt="${s} cover"><label class="btn ghost" style="margin-top:.4rem">Replace ${s}<input type="file" accept="image/*" data-up="${s}" hidden></label></div>`
    : `<div><div class="ph">No ${s} scan</div><label class="btn ghost" style="margin-top:.4rem">Upload ${s}<input type="file" accept="image/*" data-up="${s}" hidden></label></div>`;
  const prior = (b.prior_slabs || []).map(p => `${esc(p.grader)} ${esc(p.grade || '')} ${esc(p.color || '')} ${esc(p.cert || '')}`).join(' · ');
  app.innerHTML = `<header class="bar"><a href="#">← Collection</a><b>${esc(b.title || 'New book')}</b><button id="sv">Save</button></header><div class="wrap">
  <div class="grid">${FIELDS.map(input).join('')}<label class="full" style="display:flex;gap:.5rem;align-items:center;flex-direction:row"><input id="f_is_commission" type="checkbox" style="width:auto" ${b.is_commission ? 'checked' : ''}> Commission / original sketch cover</label></div>
  ${prior ? `<h2>Prior slabs</h2><p class="muted">${prior}</p>` : ''}
  <div class="links">${links}</div>
  ${id ? `<h2>Cover scans</h2><div class="imgs">${side('front')}${side('back')}</div>
  <h2>Investment: ${money(total)}</h2><table>${b.costs.map(c => `<tr><td>${esc(c.kind.replace('_', ' '))}</td><td>${esc(c.note || '')}</td><td class="n">${money(c.amount)}</td><td><button class="x ghost" data-dc="${c.id}">×</button></td></tr>`).join('')}</table>
  <div class="add"><select id="ck">${KINDS.map(k => `<option>${k}</option>`).join('')}</select><input id="ca" type="number" step="0.01" placeholder="Amount"><input id="cn" placeholder="Note (optional)"><button id="cadd">Add cost</button></div>
  <h2>Sales comps &amp; FMV</h2>
  ${e ? `<div class="card"><b>${money(e.fmv)}</b> estimated · range ${money(e.lo)}–${money(e.hi)} · ${e.n} sale${e.n > 1 ? 's' : ''} used · confidence ${e.conf}<br><small>Recent sales weigh more; sales over 24 months old are ignored.</small><br><button id="usef" style="margin-top:.5rem">Use as FMV</button></div>` : '<p class="muted">Add recent sales of this grade and type to estimate FMV.</p>'}
  <table>${[...b.comps].sort((x, y) => y.sale_date.localeCompare(x.sale_date)).map(c => `<tr><td>${esc(c.sale_date)}</td><td>${esc(c.venue || '')}</td><td class="n">${money(c.price)}</td><td><button class="x ghost" data-dm="${c.id}">×</button></td></tr>`).join('')}</table>
  <div class="add"><input id="md" type="date" value="${new Date().toISOString().slice(0, 10)}"><input id="mp" type="number" step="0.01" placeholder="Sale price"><select id="mv">${VENUES.map(v => `<option>${v}</option>`).join('')}</select><button id="madd">Add sale</button></div>
  <p><button id="del" class="ghost" style="margin-top:1.5rem">Delete this book</button></p>` : '<p class="muted">Save the book first to add costs, scans, and sales comps.</p>'}</div>`;
  const refresh = async () => { if (await save(b, true) !== null) bookView(id) };
  $('#sv').onclick = async () => { const n = await save(b); if (n) { if (!b.id) location.hash = '#book/' + n; else bookView(n) } };
  if (!id) return;
  app.querySelectorAll('[data-up]').forEach(i => i.onchange = async ev => { const f = ev.target.files[0]; if (!f) return; const s = ev.target.dataset.up; toast('Uploading…'); const path = `${uid}/${b.id}/${s}.jpg`;
    const { error } = await sb.storage.from('covers').upload(path, await shrink(f), { upsert: true, contentType: 'image/jpeg' }); if (error) return toast(error.message);
    await sb.from('books').update({ [s + '_path']: path }).eq('id', b.id); books = null; bookView(id) });
  app.querySelectorAll('[data-dc]').forEach(x => x.onclick = async () => { await sb.from('costs').delete().eq('id', x.dataset.dc); books = null; refresh() });
  app.querySelectorAll('[data-dm]').forEach(x => x.onclick = async () => { await sb.from('comps').delete().eq('id', x.dataset.dm); refresh() });
  $('#cadd').onclick = async () => { const a = parseFloat($('#ca').value); if (!a) return toast('Enter an amount'); const { error } = await sb.from('costs').insert({ book_id: id, kind: $('#ck').value, amount: a, note: $('#cn').value.trim() || null }); if (error) return toast(error.message); books = null; refresh() };
  $('#madd').onclick = async () => { const p = parseFloat($('#mp').value); if (!p || !$('#md').value) return toast('Enter a date and price'); const { error } = await sb.from('comps').insert({ book_id: id, sale_date: $('#md').value, price: p, venue: $('#mv').value }); if (error) return toast(error.message); refresh() };
  if (e) $('#usef').onclick = async () => { await sb.from('books').update({ fmv: Math.round(e.fmv * 100) / 100, fmv_date: new Date().toISOString().slice(0, 10) }).eq('id', id); books = null; bookView(id) };
  $('#del').onclick = async () => { if (!confirm('Delete this book and its costs and comps?')) return; await sb.from('books').delete().eq('id', id); books = null; location.hash = '' };
}
