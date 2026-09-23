(function () {
  'use strict';
  const C = window.CPCore;
  const CFG = window.CP_CONFIG || {};
  const { LocalStore, SupabaseStore, emptyBag, uuid } = window.CPStore;

  const S = {
    store: null, user: null, profile: null, orgs: [], org: null, D: emptyBag(), starting: false,
    f: { q: '', cat: '', scope: '', status: 'open', pf: '', prop: '' },
    sort: { key: 'deadline', dir: 1 },
    tlMonths: 12, prioPf: ''
  };

  // ======================================================================
  // Hjælpere
  // ======================================================================
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });
  const kr = n => nf.format(Math.round(Number(n) || 0)) + ' kr.';
  const krShort = n => { n = Number(n) || 0; return Math.abs(n) >= 1e6 ? (n / 1e6).toLocaleString('da-DK', { maximumFractionDigits: 1 }) + ' mio. kr.' : kr(n); };
  const fmtDate = d => { d = C.parseDate(d); return d ? d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  const today = () => C.todayDate();
  const lead = () => Number(S.org && S.org.tender_lead_months) || 6;
  const datesOf = a => C.agreementDates(a, today(), lead());
  const agr = id => S.D.agreements.find(a => a.id === id);
  const prop = id => S.D.properties.find(p => p.id === id);
  const pfById = id => S.D.portfolios.find(p => p.id === id);
  const cat = k => C.CAT[k] || C.CAT.other;
  const canEdit = () => S.store.mode === 'demo' || (S.profile && S.profile.is_cp_admin) || (S.org && ['owner', 'editor'].includes(S.org.role));
  const isOwner = () => S.store.mode === 'demo' || (S.profile && S.profile.is_cp_admin) || (S.org && S.org.role === 'owner');
  const num = v => { const n = C.parseNumber(v); return n == null ? null : n; };
  const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);

  function daysText(n) {
    if (n == null) return '';
    if (n < 0) return `${-n} dage siden`;
    if (n === 0) return 'i dag';
    if (n < 60) return `om ${n} dage`;
    return `om ${Math.round(n / 30.44)} mdr.`;
  }
  function deadlineCell(a) {
    const d = datesOf(a);
    if (d.kind === 'closed') return '<span class="muted">—</span>';
    if (d.kind === 'running') return `<span class="tag info">Løbende · ${a.notice_months || 0} mdr. varsel</span>`;
    if (d.kind === 'expired') return `<span class="tag danger">Udløbet ${fmtDate(d.termEnd)}</span>`;
    const n = d.daysToNotice;
    const cls = n <= 90 ? 'danger' : n <= 180 ? 'warn' : '';
    return `<div class="nowrap">${fmtDate(d.noticeDeadline)}</div><span class="tag ${cls}">${esc(daysText(n))}</span>`;
  }
  function statusTag(a) { const s = C.STATUSES[a.status] || C.STATUSES.active; return `<span class="tag ${s.tag}">${s.label}</span>`; }
  function scopeTag(a) {
    const cls = a.scope === 'framework' ? 'dark' : a.scope === 'portfolio' ? 'info' : '';
    return `<span class="tag ${cls}">${C.SCOPES[a.scope] ? C.SCOPES[a.scope].short : a.scope}</span>`;
  }
  function coverageText(a) {
    const ids = C.coveredPropertyIds(a, S.D);
    if (a.scope === 'portfolio') { const p = pfById(a.portfolio_id); return `${p ? esc(p.name) : 'Portefølje'} · ${ids.length} ejendomme`; }
    if (a.scope === 'framework') return `${esc(a.region || 'Region')} · ${ids.length} ejendomme`;
    if (ids.length === 1) return esc((prop(ids[0]) || {}).name);
    return ids.length ? `${ids.length} ejendomme` : '<span class="muted">Ingen ejendom</span>';
  }

  function toast(msg, isErr) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (isErr ? ' error' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, isErr ? 5000 : 2600);
  }
  async function guard(fn) {
    try { return await fn(); } catch (e) { console.error(e); toast(e.message || String(e), true); }
  }

  let modalSubmit = null;
  function openModal(title, html, onSubmit) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modal').hidden = false;
    modalSubmit = onSubmit || null;
    const f = $('#modalBody input:not([type=hidden]), #modalBody select, #modalBody textarea');
    if (f) setTimeout(() => f.focus(), 30);
  }
  function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; modalSubmit = null; }
  function formObj(form) { const o = {}; new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; }); return o; }

  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Kunne ikke hente ' + src)); document.head.appendChild(s); });
  }
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

  const opt = (v, label, sel) => `<option value="${esc(v)}"${String(sel) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
  const catOptions = sel => C.CATEGORIES.map(c => opt(c.key, c.label, sel)).join('');
  const regionOptions = (sel, blank) => (blank ? opt('', blank, sel) : '') + C.REGIONS.map(r => opt(r, r, sel)).join('');
  const pfOptions = (sel, blank) => (blank != null ? opt('', blank, sel) : '') + S.D.portfolios.map(p => opt(p.id, p.name, sel)).join('');

  // ======================================================================
  // Opstart og login
  // ======================================================================
  function showScreen(name) {
    $('#boot').hidden = true;
    ['login', 'onboarding', 'app'].forEach(s => { $('#' + s).hidden = s !== name; });
  }

  async function boot() {
    try {
      if (CFG.supabaseUrl && CFG.supabaseAnonKey) {
        await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
        const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
          auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
        });
        S.store = new SupabaseStore(sb);
        sb.auth.onAuthStateChange(ev => {
          if (ev === 'SIGNED_OUT') location.reload();
          if (ev === 'SIGNED_IN' && !S.user) setTimeout(start, 0);
        });
      } else {
        S.store = new LocalStore();
      }
      await start();
    } catch (e) {
      console.error(e);
      showScreen('login');
      $('#loginMsg').textContent = 'Fejl ved opstart: ' + e.message;
    }
  }

  async function start() {
    if (S.starting) return; S.starting = true;
    try {
      const who = await S.store.init();
      if (!who) { showScreen('login'); return; }
      S.user = who.user; S.profile = who.profile;
      S.orgs = await S.store.listOrgs();
      if (!S.orgs.length) { showScreen('onboarding'); return; }
      S.org = S.orgs.find(o => o.id === lsGet('cp_org')) || S.orgs[0];
      await loadOrg();
      showScreen('app');
      renderChrome();
      route(true);
    } finally { S.starting = false; }
  }

  async function loadOrg() { S.D = await S.store.loadOrg(S.org.id); }
  async function reload() { await loadOrg(); route(false); }

  function renderChrome() {
    $('#orgSwitch').innerHTML = S.orgs.length > 1
      ? `<select id="orgSelect" aria-label="Vælg organisation">${S.orgs.map(o => opt(o.id, o.name, S.org.id)).join('')}</select>`
      : `<div class="org-name">${esc(S.org.name)}</div>`;
    $('#adminLink').hidden = !(S.profile && S.profile.is_cp_admin);
    $('#userBox').innerHTML = `<div class="who">${esc(S.user.email)}</div>` +
      (S.store.mode === 'cloud' ? '<button data-action="logout">Log ud</button>' : '');
    const b = $('#demoBanner');
    if (S.store.mode === 'demo') {
      b.hidden = false;
      b.innerHTML = '<span><strong>Demo-tilstand</strong>: data gemmes kun i denne browser. Forbind Supabase i <code>config.js</code> for at gå i drift.</span><button data-action="resetDemo">Nulstil demodata</button>';
    } else b.hidden = true;
  }

  // ======================================================================
  // Router
  // ======================================================================
  const ROUTES = [
    [/^\/overblik$/, viewDashboard], [/^\/prioritering$/, viewPriorities],
    [/^\/aftaler$/, viewAgreements], [/^\/aftaler\/([\w-]+)$/, viewAgreement],
    [/^\/tidslinje$/, viewTimeline],
    [/^\/ejendomme$/, viewProperties], [/^\/ejendomme\/([\w-]+)$/, viewProperty],
    [/^\/portefoljer$/, viewPortfolios], [/^\/portefoljer\/([\w-]+)$/, viewPortfolio],
    [/^\/udbud$/, viewTenders], [/^\/udbud\/([\w-]+)$/, viewTender],
    [/^\/data$/, viewData], [/^\/indstillinger$/, viewSettings], [/^\/admin$/, viewAdmin]
  ];
  async function route(scroll) {
    if (!S.org) return;
    const path = location.hash.replace(/^#/, '') || '/overblik';
    let fn = viewDashboard, params = [];
    for (const [re, f] of ROUTES) { const m = re.exec(path); if (m) { fn = f; params = m.slice(1); break; } }
    const top = '/' + (path.split('/')[1] || 'overblik');
    document.querySelectorAll('#menu a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + top));
    const view = $('#view');
    try {
      const html = await fn(...params);
      view.innerHTML = html;
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="card"><h2>Noget gik galt</h2><p class="muted">${esc(e.message)}</p></div>`;
    }
    if (scroll) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => route(true));

  function pageHead(title, sub, actions, crumb) {
    return `<div class="page-head"><div>${crumb ? `<div class="crumb">${crumb}</div>` : ''}<h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
  }
  const notFound = what => `<div class="card"><h2>${what} findes ikke</h2><p class="muted">Den er måske slettet.</p></div>`;

  // ======================================================================
  // Overblik
  // ======================================================================
  function viewDashboard() {
    const D = S.D, t = today();
    const open = D.agreements.filter(a => !C.isClosed(a));
    const spend = sum(open, a => C.countedCost(a, D));
    const prios = C.priorities(D, t, lead());
    const potential = sum(prios, p => p.est);
    const in6 = open.filter(a => { const d = datesOf(a); return d.daysToNotice != null && d.daysToNotice >= 0 && d.daysToNotice <= 183; });
    const realized = sum(D.tenders.filter(x => x.status === 'awarded' && x.baseline_cost && x.new_annual_cost), x => x.baseline_cost - x.new_annual_cost);
    const events = C.timelineEvents(D, t, 12, lead()).filter(e => e.type === 'notice' || e.type === 'tender').slice(0, 8);
    const byCat = C.CATEGORIES.map(c => {
      const list = open.filter(a => a.category === c.key);
      const s = sum(list, a => C.countedCost(a, D));
      return { c, s, pot: sum(list, a => C.countedCost(a, D) * C.potentialPct(a) / 100) };
    }).filter(x => x.s > 0).sort((x, y) => y.s - x.s);
    const maxCat = Math.max(1, ...byCat.map(x => x.s));
    const cons = C.consolidation(D);

    if (!D.agreements.length) {
      return pageHead('Overblik', `${esc(S.org.name)}`) + `<div class="card"><h2>Kom i gang</h2>
        <p class="muted" style="margin-bottom:14px">Registrér jeres ejendomme og driftsaftaler. Platformen beregner selv opsigelsesfrister, anbefalet udbudsstart og hvilke aftaler der bedst kan betale sig at se på først.</p>
        <div class="actions"><button class="btn btn-primary" data-action="newProperty"><i class="fa-solid fa-building"></i> Tilføj ejendom</button>
        <button class="btn" data-action="newAgreement"><i class="fa-solid fa-file-contract"></i> Tilføj aftale</button>
        <a class="btn" href="#/data"><i class="fa-solid fa-file-import"></i> Importér fra Excel/CSV</a></div></div>`;
    }

    return pageHead('Overblik', esc(S.org.name), canEdit() ? '<button class="btn btn-primary" data-action="newAgreement"><i class="fa-solid fa-plus"></i> Ny aftale</button>' : '') + `
    <div class="grid g4" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Årlige driftsudgifter</div><div class="val">${krShort(spend)}</div><div class="sub">${open.length} aktive aftaler · ${D.properties.length} ejendomme</div></div>
      <div class="kpi accent"><div class="lbl">Besparelsespotentiale</div><div class="val">${krShort(potential)}</div><div class="sub">estimeret pr. år ved genudbud</div></div>
      <div class="kpi"><div class="lbl">Frister næste 6 mdr.</div><div class="val">${in6.length}</div><div class="sub">${in6.length ? 'opsigelse eller udløb' : 'ingen akutte frister'}</div></div>
      <div class="kpi"><div class="lbl">Realiseret besparelse</div><div class="val">${krShort(realized)}</div><div class="sub">pr. år fra afsluttede udbud</div></div>
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-head"><h2>Se på disse først</h2><a class="btn btn-sm" href="#/prioritering">Hele listen</a></div>
        ${prios.length ? `<table><tbody>${prios.slice(0, 5).map((p, i) => `<tr class="link" data-href="#/aftaler/${p.a.id}">
          <td style="width:28px;color:var(--terracotta);font-family:'Cormorant Garamond',serif;font-size:20px">${i + 1}</td>
          <td><div class="title">${esc(p.a.title)}</div><div class="sub">${esc(p.urgency.label)} · ${esc(p.age.label)}</div></td>
          <td class="num"><div>${kr(p.est)}</div><div class="sub">potentiale/år</div></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Ingen aktive aftaler med pris.</p>'}
      </div>
      <div class="card"><div class="card-head"><h2>Kommende frister</h2><a class="btn btn-sm" href="#/tidslinje">Tidslinje</a></div>
        ${events.length ? `<table><tbody>${events.map(e => `<tr class="link" data-href="#/aftaler/${e.a.id}">
          <td class="nowrap" style="width:110px">${fmtDate(e.date)}<div class="sub">${esc(daysText(C.daysBetween(t, e.date)))}</div></td>
          <td><div class="title">${esc(e.a.title)}</div><div class="sub">${esc(e.label)}</div></td>
          <td><span class="tag ${e.type === 'notice' ? 'danger' : 'warn'}">${e.type === 'notice' ? 'Frist' : 'Start udbud'}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Ingen frister de næste 12 måneder.</p>'}
      </div>
      <div class="card"><h2>Udgifter pr. kategori</h2>
        <div class="bars">${byCat.map(x => `<div class="bar-row"><span>${esc(x.c.label)}</span>
          <div class="bar-track" title="Guld = estimeret besparelsespotentiale"><div class="bar-fill" style="width:${(x.s / maxCat * 100).toFixed(1)}%;position:relative"><div class="bar-fill pot" style="position:absolute;right:0;top:0;width:${(x.pot / x.s * 100).toFixed(1)}%"></div></div></div>
          <span class="num">${krShort(x.s)}</span></div>`).join('')}</div>
        <p class="small muted" style="margin-top:10px">Den gyldne del af søjlen er det estimerede besparelsespotentiale.</p>
      </div>
      <div class="card"><div class="card-head"><h2>Muligheder for samling</h2><a class="btn btn-sm" href="#/portefoljer">Porteføljer</a></div>
        ${cons.length ? cons.slice(0, 3).map(consolidationHtml).join('') : '<p class="muted">Ingen oplagte muligheder for at samle aftaler i rammeaftaler lige nu.</p>'}
      </div>
    </div>
    <div class="card" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;background:var(--bg-warm)">
      <div><h2 style="margin-bottom:4px">Lad Core Partners gennemgå aftalerne</h2><p class="muted">No Cure No Pay: I betaler kun 20 % af første års dokumenterede besparelse.</p></div>
      <button class="btn btn-accent" data-action="requestReview"><i class="fa-solid fa-handshake"></i> Bed om gennemgang</button>
    </div>`;
  }

  function consolidationHtml(g) {
    return `<div class="suggest"><div><strong>${g.items.length} aftaler om ${esc(cat(g.category).label.toLowerCase())}</strong> i ${esc(g.region)} med ${g.suppliers} leverandør${g.suppliers === 1 ? '' : 'er'}, samlet ${kr(g.total)}/år.</div>
      <div class="small muted" style="margin:4px 0 6px">Overvej en regional rammeaftale. Samling giver typisk 3–8 % ekstra i pris og færre kontrakter at administrere (ca. ${kr(g.est)}/år).</div>
      <div class="small">${g.items.map(a => `<a href="#/aftaler/${a.id}">${esc(a.title)}</a>`).join(' · ')}</div></div>`;
  }

  // ======================================================================
  // Prioritering
  // ======================================================================
  function viewPriorities() {
    const t = today();
    let list = C.priorities(S.D, t, lead());
    if (S.prioPf) {
      const ids = new Set(S.D.properties.filter(p => p.portfolio_id === S.prioPf).map(p => p.id));
      list = list.filter(p => p.a.portfolio_id === S.prioPf || C.coveredPropertyIds(p.a, S.D).some(id => ids.has(id)));
    }
    const max = Math.max(1, ...list.map(p => p.score));
    const inTender = S.D.agreements.filter(a => a.status === 'in_tender');
    return pageHead('Prioritering', 'Aftalerne rangeret efter hvad det bedst kan betale sig at se på først: årlig pris × typisk besparelse for kategorien × hvor tæt fristen er × hvor længe siden aftalen er udbudt.',
      `<select class="btn" data-change="prioPf" aria-label="Portefølje">${pfOptions(S.prioPf, 'Alle porteføljer')}</select>`) +
      (list.length ? `<div class="prio-list">${list.map((p, i) => `<div class="prio" data-href="#/aftaler/${p.a.id}" tabindex="0">
        <div class="rank">${i + 1}</div>
        <div><div class="title"><i class="fa-solid ${cat(p.a.category).icon}" style="color:var(--slate-l);margin-right:6px"></i><strong>${esc(p.a.title)}</strong></div>
          <div class="small muted">${esc(cat(p.a.category).label)} · ${esc(p.a.supplier || 'Ukendt leverandør')} · ${kr(p.cost)}/år · ${p.dates.noticeDeadline ? esc(p.dates.deadlineLabel) + ' ' + fmtDate(p.dates.noticeDeadline) : 'ingen frist'}</div>
          <div class="reasons">${p.reasons.map(r => `<span class="tag">${esc(r)}</span>`).join('')}<span class="tag info">${p.pct} % typisk besparelse</span></div></div>
        <div class="save"><div class="v">${kr(p.est)}</div><div class="small muted">estimeret pr. år</div><div class="meter" title="Prioritetsscore"><div style="width:${(p.score / max * 100).toFixed(0)}%"></div></div></div>
      </div>`).join('')}</div>` : '<div class="card empty">Ingen aktive aftaler med registreret pris.</div>') +
      (inTender.length ? `<div class="card" style="margin-top:16px"><h2>I udbud nu</h2>${inTender.map(a => `<div><a href="#/aftaler/${a.id}">${esc(a.title)}</a></div>`).join('')}</div>` : '') +
      `<div class="card" style="margin-top:16px"><h3>Sådan beregnes scoren</h3><p class="small muted">
        <strong>Potentiale</strong> = årlig pris × typisk besparelse for kategorien (kan overskrives pr. aftale).
        <strong>Hastegrad</strong>: 100 % ved frist inden for 3 mdr., 95 % inden for 6 mdr., 75 % inden for 12 mdr., 50 % inden for 18 mdr. og ellers 25 %. Løbende aftaler tæller 80 %.
        <strong>Alder</strong>: 100 % hvis aftalen ikke er udbudt i 3 år eller mere, 85 % ved 2 år, 60 % ved 1 år og 35 % hvis den er nyligt udbudt.
        Aftaler under en rammeaftale vurderes enkeltvis. Rammeaftalens egen pris tælles ikke med to gange.</p></div>`;
  }

  // ======================================================================
  // Aftaler
  // ======================================================================
  function filteredAgreements() {
    const f = S.f, q = f.q.toLowerCase();
    let list = S.D.agreements.filter(a => {
      if (f.status === 'open' && C.isClosed(a)) return false;
      if (f.status && f.status !== 'open' && a.status !== f.status) return false;
      if (f.cat && a.category !== f.cat) return false;
      if (f.scope && a.scope !== f.scope) return false;
      if (f.pf) {
        const ids = new Set(S.D.properties.filter(p => p.portfolio_id === f.pf).map(p => p.id));
        if (a.portfolio_id !== f.pf && !C.coveredPropertyIds(a, S.D).some(id => ids.has(id))) return false;
      }
      if (f.prop && !C.coveredPropertyIds(a, S.D).includes(f.prop)) return false;
      if (q && !`${a.title} ${a.supplier} ${cat(a.category).label} ${a.notes || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const k = S.sort.key, dir = S.sort.dir;
    const val = a => {
      if (k === 'title') return a.title.toLowerCase();
      if (k === 'cost') return Number(a.annual_cost) || 0;
      if (k === 'category') return cat(a.category).label;
      const d = datesOf(a);
      return d.noticeDeadline ? d.noticeDeadline.getTime() : (d.kind === 'running' ? 8e15 : 9e15);
    };
    return list.sort((x, y) => { const a = val(x), b = val(y); return (a < b ? -1 : a > b ? 1 : 0) * dir; });
  }

  function viewAgreements() {
    const list = filteredAgreements(), f = S.f;
    const th = (k, l, cls) => `<th class="sortable ${cls || ''}" data-action="sort" data-key="${k}">${l}${S.sort.key === k ? (S.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
    return pageHead('Aftaler', `${list.length} aftaler · ${kr(sum(list, a => C.countedCost(a, S.D)))}/år`,
      (canEdit() ? '<button class="btn btn-primary" data-action="newAgreement"><i class="fa-solid fa-plus"></i> Ny aftale</button>' : '') +
      '<button class="btn" data-action="exportAgreements"><i class="fa-solid fa-file-csv"></i> Eksportér</button>') + `
    <div class="filters">
      <input type="search" placeholder="Søg i titel, leverandør, noter …" value="${esc(f.q)}" data-filter="q" aria-label="Søg">
      <select data-filter="cat" aria-label="Kategori">${opt('', 'Alle kategorier', f.cat)}${catOptions(f.cat)}</select>
      <select data-filter="scope" aria-label="Omfang">${opt('', 'Alle typer', f.scope)}${Object.entries(C.SCOPES).map(([k, v]) => opt(k, v.label, f.scope)).join('')}</select>
      <select data-filter="pf" aria-label="Portefølje">${pfOptions(f.pf, 'Alle porteføljer')}</select>
      <select data-filter="prop" aria-label="Ejendom">${opt('', 'Alle ejendomme', f.prop)}${S.D.properties.map(p => opt(p.id, p.name, f.prop)).join('')}</select>
      <select data-filter="status" aria-label="Status">${opt('open', 'Aktive', f.status)}${opt('', 'Alle', f.status)}${Object.entries(C.STATUSES).map(([k, v]) => opt(k, v.label, f.status)).join('')}</select>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>${th('title', 'Aftale')}${th('category', 'Kategori')}<th>Omfang</th>${th('cost', 'Årlig pris', 'num')}${th('deadline', 'Næste frist')}<th>Status</th></tr></thead>
      <tbody>${list.length ? list.map(a => `<tr class="link" data-href="#/aftaler/${a.id}">
        <td><div class="title">${esc(a.title)}</div><div class="sub">${esc(a.supplier || '—')}${a.parent_agreement_id && agr(a.parent_agreement_id) ? ' · under ' + esc(agr(a.parent_agreement_id).title) : ''}</div></td>
        <td class="nowrap"><i class="fa-solid ${cat(a.category).icon}" style="color:var(--slate-l);width:16px"></i> ${esc(cat(a.category).label)}</td>
        <td>${scopeTag(a)}<div class="sub">${coverageText(a)}</div></td>
        <td class="num">${kr(a.annual_cost)}${C.hasChildren(a, S.D) ? '<div class="sub">fordelt på leveranceaftaler</div>' : ''}</td>
        <td>${deadlineCell(a)}</td><td>${statusTag(a)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Ingen aftaler matcher filteret.</td></tr>'}</tbody>
    </table></div>`;
  }

  function viewAgreement(id) {
    const a = agr(id); if (!a) return notFound('Aftalen');
    const D = S.D, d = datesOf(a), t = today();
    const p = C.priority(a, D, t, lead());
    const alloc = C.allocation(a, D);
    const covered = C.coveredPropertyIds(a, D).map(prop).filter(Boolean);
    const children = D.agreements.filter(c => c.parent_agreement_id === a.id);
    const parent = a.parent_agreement_id && agr(a.parent_agreement_id);
    const tenders = D.tenders.filter(x => x.agreement_id === a.id);
    const openTender = tenders.find(x => !['awarded', 'cancelled'].includes(x.status));
    const docs = D.documents.filter(x => x.agreement_id === a.id);
    const reqs = D.requests.filter(x => x.agreement_id === a.id);

    let box;
    if (d.kind === 'closed') box = `<div class="deadline-box"><div class="lbl">Status</div><div class="big">${C.STATUSES[a.status].label}</div></div>`;
    else if (d.kind === 'running') box = `<div class="deadline-box ok"><div class="lbl">Løbende aftale</div><div class="big">${a.notice_months || 0} måneders opsigelse</div><p class="small">Kan opsiges når som helst. Tidligste ophør ved opsigelse i dag: ${fmtDate(d.termEnd)}.</p></div>`;
    else if (d.kind === 'expired') box = `<div class="deadline-box danger"><div class="lbl">Aftalen er udløbet</div><div class="big">${fmtDate(d.termEnd)}</div><p class="small">Aftalen forlænges ikke automatisk. Opdatér datoerne eller markér den som udløbet.</p></div>`;
    else {
      const n = d.daysToNotice, cls = n <= 90 ? 'danger' : n <= 180 ? 'warn' : 'ok';
      box = `<div class="deadline-box ${cls}"><div class="lbl">${esc(d.deadlineLabel)}</div><div class="big">${fmtDate(d.noticeDeadline)}</div>
        <p class="small">${esc(daysText(n))}${d.kind !== 'fixed' ? ` · periode slutter ${fmtDate(d.termEnd)}` : ''}${d.kind === 'renewing' ? ` · forlænges ellers med ${a.renewal_months} mdr.` : ''}</p>
        ${d.tenderStart ? `<p class="small" style="margin-top:6px"><i class="fa-solid fa-flag"></i> Anbefalet udbudsstart: <strong>${fmtDate(d.tenderStart)}</strong> (${lead()} mdr. før fristen)</p>` : ''}
        ${d.missedCurrent ? `<p class="small" style="margin-top:6px;color:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i> Fristen for den nuværende periode er overskredet. Aftalen er forlænget, og næste mulighed er vist ovenfor.</p>` : ''}</div>`;
    }

    return pageHead(esc(a.title), `${scopeTag(a)} ${statusTag(a)} <span class="tag"><i class="fa-solid ${cat(a.category).icon}"></i> ${esc(cat(a.category).label)}</span>`,
      (canEdit() ? `<button class="btn" data-action="editAgreement" data-id="${a.id}"><i class="fa-solid fa-pen"></i> Redigér</button>` : '') +
      (canEdit() && !openTender && !C.isClosed(a) ? `<button class="btn btn-primary" data-action="startTender" data-id="${a.id}"><i class="fa-solid fa-list-check"></i> Start udbud</button>` : '') +
      `<button class="btn btn-accent" data-action="requestReview" data-id="${a.id}"><i class="fa-solid fa-handshake"></i> Bed Core Partners vurdere</button>`,
      '<a href="#/aftaler">Aftaler</a> /') + `
    <div class="grid g2">
      <div class="stack">
        ${box}
        <div class="card"><h2>Detaljer</h2><dl class="dl">
          <dt>Leverandør</dt><dd>${esc(a.supplier || '—')}</dd>
          ${a.supplier_contact ? `<dt>Kontakt</dt><dd>${esc(a.supplier_contact)}</dd>` : ''}
          <dt>Omfang</dt><dd>${esc(C.SCOPES[a.scope].label)}${a.scope === 'portfolio' && pfById(a.portfolio_id) ? ` · <a href="#/portefoljer/${a.portfolio_id}">${esc(pfById(a.portfolio_id).name)}</a>` : ''}${a.region ? ' · ' + esc(a.region) : ''}</dd>
          ${parent ? `<dt>Under rammeaftale</dt><dd><a href="#/aftaler/${parent.id}">${esc(parent.title)}</a></dd>` : ''}
          <dt>Årlig pris</dt><dd>${kr(a.annual_cost)}</dd>
          <dt>Periode</dt><dd>${fmtDate(a.start_date)} – ${a.end_date ? fmtDate(a.end_date) : 'løbende'}</dd>
          ${a.binding_until ? `<dt>Binding til</dt><dd>${fmtDate(a.binding_until)}</dd>` : ''}
          <dt>Opsigelsesvarsel</dt><dd>${a.notice_months || 0} mdr.</dd>
          <dt>Forlængelse</dt><dd>${a.auto_renew ? `Automatisk med ${a.renewal_months} mdr.` : 'Ingen automatisk forlængelse'}</dd>
          <dt>Indeksregulering</dt><dd>${esc(a.indexation || '—')}${a.indexation_date ? ' · ' + fmtDate(C.nextIndexation(a, t)) : ''}</dd>
          <dt>Sidst udbudt</dt><dd>${a.last_tendered ? fmtDate(a.last_tendered) : 'Ukendt'}</dd>
          ${a.notes ? `<dt>Noter</dt><dd style="white-space:pre-wrap">${esc(a.notes)}</dd>` : ''}
        </dl></div>
        <div class="card"><h2>Besparelsespotentiale</h2>
          <div class="grid g2"><div class="kpi"><div class="lbl">Estimeret pr. år</div><div class="val">${kr(p.est)}</div><div class="sub">${p.pct} % af ${kr(p.cost)}</div></div>
          <div class="kpi"><div class="lbl">Core Partners honorar</div><div class="val">${kr(p.est * 0.2)}</div><div class="sub">20 % af første års besparelse</div></div></div>
          <div class="reasons" style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${p.reasons.map(r => `<span class="tag">${esc(r)}</span>`).join('')}</div>
        </div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Ejendomme (${covered.length})</h2></div>
          ${covered.length ? `<table><thead><tr><th>Ejendom</th><th class="num">Andel/år</th><th class="num">kr./m²</th></tr></thead><tbody>${covered.map(pp => { const v = alloc.get(pp.id) || 0; return `<tr class="link" data-href="#/ejendomme/${pp.id}"><td>${esc(pp.name)}<div class="sub">${esc(pp.city || '')}</div></td><td class="num">${kr(v)}</td><td class="num">${pp.area_m2 ? (v / pp.area_m2).toLocaleString('da-DK', { maximumFractionDigits: 1 }) : '—'}</td></tr>`; }).join('')}</tbody></table>
          <p class="small muted" style="margin-top:8px">Ejendomme uden fast andel får deres del fordelt efter m².</p>` : '<p class="muted">Ingen ejendomme tilknyttet.</p>'}
        </div>
        ${a.scope === 'framework' || children.length ? `<div class="card"><div class="card-head"><h2>Leveranceaftaler under rammen</h2>${canEdit() ? `<button class="btn btn-sm" data-action="newAgreement" data-parent="${a.id}"><i class="fa-solid fa-plus"></i> Tilføj</button>` : ''}</div>
          ${children.length ? `<table><tbody>${children.map(c => `<tr class="link" data-href="#/aftaler/${c.id}"><td>${esc(c.title)}<div class="sub">${coverageText(c)}</div></td><td class="num">${kr(c.annual_cost)}</td><td>${deadlineCell(c)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Ingen leveranceaftaler registreret. Ejendommene under rammen fremgår ovenfor.</p>'}</div>` : ''}
        <div class="card"><div class="card-head"><h2>Udbud</h2></div>
          ${tenders.length ? tenders.map(x => `<div class="doc-row"><a href="#/udbud/${x.id}">${esc(x.title)}</a><span class="tag">${esc(tenderStatusLabel(x.status))}</span></div>`).join('') : '<p class="muted small">Ingen udbud endnu.</p>'}
        </div>
        <div class="card"><div class="card-head"><h2>Dokumenter</h2></div>
          ${docs.map(x => `<div class="doc-row"><span><i class="fa-regular fa-file-lines"></i> ${esc(x.name)} <span class="small muted">${fmtDate(x.created_at)}</span></span><span class="actions"><button class="btn btn-sm" data-action="openDoc" data-id="${x.id}">Åbn</button>${canEdit() ? `<button class="icon-btn" data-action="deleteDoc" data-id="${x.id}" aria-label="Slet dokument"><i class="fa-regular fa-trash-can"></i></button>` : ''}</span></div>`).join('')}
          ${canEdit() ? (S.store.mode === 'cloud' ? `<label class="drop" style="display:block;margin-top:8px;cursor:pointer"><i class="fa-solid fa-upload"></i> Upload kontrakt eller bilag<input type="file" data-upload="${a.id}" hidden multiple></label>` : '<p class="small muted">Upload af kontrakter kræver at platformen er forbundet til Supabase.</p>') : ''}
        </div>
        ${reqs.length ? `<div class="card"><h2>Henvendelser til Core Partners</h2>${reqs.map(r => `<div class="doc-row"><span>${esc(r.message || 'Vurdering ønsket')}<div class="small muted">${fmtDate(r.created_at)}</div></span><span class="tag ${r.status === 'done' ? 'ok' : 'info'}">${reqStatus(r.status)}</span></div>`).join('')}</div>` : ''}
        ${canEdit() ? `<div><button class="btn btn-danger btn-sm" data-action="deleteAgreement" data-id="${a.id}"><i class="fa-regular fa-trash-can"></i> Slet aftale</button></div>` : ''}
      </div>
    </div>`;
  }
  const reqStatus = s => ({ new: 'Modtaget', in_progress: 'Under behandling', done: 'Afsluttet' }[s] || s);
  const tenderStatusLabel = s => (C.TENDER_STATUSES.find(x => x.key === s) || { label: s }).label;

  function agreementForm(a, parentId) {
    a = a || { scope: 'property', category: 'other', auto_renew: true, renewal_months: 12, notice_months: 3, status: 'active' };
    if (parentId && !a.id) { const par = agr(parentId); a.parent_agreement_id = parentId; a.category = par.category; a.supplier = par.supplier; a.end_date = par.end_date; a.notice_months = par.notice_months; a.auto_renew = par.auto_renew; a.renewal_months = par.renewal_months; }
    const links = new Map(S.D.links.filter(l => l.agreement_id === a.id).map(l => [l.property_id, l]));
    const frameworks = S.D.agreements.filter(x => x.scope === 'framework' && x.id !== a.id);
    const v = k => esc(a[k] == null ? '' : a[k]);
    const html = `<form id="mform" class="form-grid">
      <label class="field full"><span>Titel *</span><input name="title" required value="${v('title')}" placeholder="F.eks. Rengøring Havnegade"></label>
      <label class="field"><span>Kategori</span><select name="category" data-change="catHint">${catOptions(a.category)}</select></label>
      <label class="field"><span>Status</span><select name="status">${Object.entries(C.STATUSES).map(([k, s]) => opt(k, s.label, a.status)).join('')}</select></label>
      <label class="field"><span>Leverandør</span><input name="supplier" value="${v('supplier')}"></label>
      <label class="field"><span>Kontaktperson</span><input name="supplier_contact" value="${v('supplier_contact')}" placeholder="Navn, telefon, e-mail"></label>

      <div class="form-section">Omfang</div>
      <label class="field"><span>Aftaletype</span><select name="scope" data-change="scopeFields">${Object.entries(C.SCOPES).map(([k, s]) => opt(k, s.label, a.scope)).join('')}</select></label>
      <label class="field" data-scope="portfolio"><span>Portefølje</span><select name="portfolio_id">${pfOptions(a.portfolio_id, '— vælg —')}</select></label>
      <label class="field" data-scope="framework portfolio property"><span>Region</span><select name="region">${regionOptions(a.region, '— ingen —')}</select></label>
      <label class="field" data-scope="property portfolio"><span>Under rammeaftale</span><select name="parent_agreement_id">${opt('', '— ingen —', a.parent_agreement_id)}${frameworks.map(x => opt(x.id, x.title, a.parent_agreement_id)).join('')}</select></label>
      <div class="field full"><span>Ejendomme og fordeling af pris</span>
        ${S.D.properties.length ? `<div class="link-list">${S.D.properties.map(pp => { const l = links.get(pp.id); return `<div class="link-row">
          <input type="checkbox" name="lp_${pp.id}" ${l ? 'checked' : ''} aria-label="${esc(pp.name)}">
          <div>${esc(pp.name)}<div class="sub">${esc([pp.city, pfById(pp.portfolio_id) && pfById(pp.portfolio_id).name].filter(Boolean).join(' · '))}${pp.area_m2 ? ' · ' + nf.format(pp.area_m2) + ' m²' : ''}</div></div>
          <input type="number" name="ls_${pp.id}" min="0" step="1" placeholder="kr./år (valgfri)" value="${l && l.cost_share != null ? esc(l.cost_share) : ''}" aria-label="Andel for ${esc(pp.name)}">
        </div>`; }).join('')}</div>` : '<p class="small muted">Opret ejendomme først for at knytte dem til aftalen.</p>'}
        <span class="hint">Ved porteføljeaftaler er alle porteføljens ejendomme automatisk omfattet. Uden faste andele fordeles prisen efter m².</span></div>

      <div class="form-section">Økonomi</div>
      <label class="field"><span>Årlig pris (kr. ekskl. moms)</span><input name="annual_cost" inputmode="decimal" value="${v('annual_cost')}"></label>
      <label class="field"><span>Besparelsespotentiale %</span><input name="savings_potential_pct" inputmode="decimal" value="${v('savings_potential_pct')}" placeholder="Standard: ${cat(a.category).potential} %" id="potInput"><span class="hint">Tom = kategoriens erfaringstal</span></label>
      <label class="field"><span>Indeksregulering</span><input name="indexation" value="${v('indexation')}" placeholder="F.eks. nettoprisindeks"></label>
      <label class="field"><span>Dato for indeksregulering</span><input type="date" name="indexation_date" value="${v('indexation_date')}"></label>

      <div class="form-section">Datoer og opsigelse</div>
      <label class="field"><span>Startdato</span><input type="date" name="start_date" value="${v('start_date')}"></label>
      <label class="field"><span>Udløb / periodens slut</span><input type="date" name="end_date" value="${v('end_date')}"><span class="hint">Tom = løbende aftale</span></label>
      <label class="field"><span>Opsigelsesvarsel (mdr.)</span><input type="number" min="0" name="notice_months" value="${v('notice_months')}"></label>
      <label class="field"><span>Bindingsperiode til</span><input type="date" name="binding_until" value="${v('binding_until')}"></label>
      <label class="check"><input type="checkbox" name="auto_renew" ${a.auto_renew ? 'checked' : ''}> Forlænges automatisk</label>
      <label class="field"><span>Forlænges med (mdr.)</span><input type="number" min="0" name="renewal_months" value="${v('renewal_months')}"></label>
      <label class="field"><span>Sidst udbudt</span><input type="date" name="last_tendered" value="${v('last_tendered')}"></label>
      <label class="field full"><span>Noter</span><textarea name="notes">${v('notes')}</textarea></label>
      <div class="form-actions full"><div class="right"><button type="button" class="btn" data-action="closeModal">Annullér</button><button class="btn btn-primary" type="submit">Gem aftale</button></div></div>
    </form>`;
    openModal(a.id ? 'Redigér aftale' : 'Ny aftale', html, async (o, form) => {
      const row = {
        id: a.id || uuid(), org_id: S.org.id, title: o.title, category: o.category, status: o.status,
        supplier: o.supplier || null, supplier_contact: o.supplier_contact || null, scope: o.scope,
        portfolio_id: o.scope === 'portfolio' ? (o.portfolio_id || null) : null,
        region: o.region || null,
        parent_agreement_id: o.scope !== 'framework' ? (o.parent_agreement_id || null) : null,
        annual_cost: num(o.annual_cost) || 0, savings_potential_pct: num(o.savings_potential_pct),
        indexation: o.indexation || null, indexation_date: o.indexation_date || null,
        start_date: o.start_date || null, end_date: o.end_date || null, binding_until: o.binding_until || null,
        notice_months: parseInt(o.notice_months, 10) || 0, auto_renew: !!form.auto_renew.checked,
        renewal_months: parseInt(o.renewal_months, 10) || 0, last_tendered: o.last_tendered || null, notes: o.notes || null
      };
      if (row.scope === 'portfolio' && !row.portfolio_id) throw new Error('Vælg den portefølje, aftalen gælder for.');
      const newLinks = S.D.properties.filter(pp => form['lp_' + pp.id] && form['lp_' + pp.id].checked)
        .map(pp => ({ agreement_id: row.id, property_id: pp.id, org_id: S.org.id, cost_share: num(form['ls_' + pp.id].value) }));
      await S.store.upsert('agreements', row);
      await S.store.replaceLinks(S.org.id, row.id, newLinks);
      closeModal(); toast('Aftalen er gemt');
      await loadOrg();
      if (location.hash !== '#/aftaler/' + row.id) location.hash = '#/aftaler/' + row.id; else route(false);
    });
    scopeFields();
  }
  function scopeFields() {
    const f = $('#mform'); if (!f || !f.scope) return;
    f.querySelectorAll('[data-scope]').forEach(el => { el.hidden = !el.dataset.scope.split(' ').includes(f.scope.value); });
  }

  // ======================================================================
  // Tidslinje
  // ======================================================================
  function viewTimeline() {
    const t = today();
    const ev = C.timelineEvents(S.D, t, S.tlMonths, lead());
    const months = new Map();
    ev.forEach(e => { const k = e.date.getFullYear() + '-' + e.date.getMonth(); if (!months.has(k)) months.set(k, { d: e.date, items: [] }); months.get(k).items.push(e); });
    const lbl = { notice: 'Frist', tender: 'Start udbud', end: 'Periodeslut', index: 'Indeksregulering' };
    return pageHead('Tidslinje', 'Opsigelsesfrister, anbefalet udbudsstart, periodeslut og indeksreguleringer.',
      `<select class="btn" data-change="tlMonths" aria-label="Periode">${[6, 12, 24, 36].map(m => opt(m, `Næste ${m} mdr.`, S.tlMonths)).join('')}</select>
       <button class="btn" data-action="exportIcs"><i class="fa-regular fa-calendar-plus"></i> Tilføj til kalender (.ics)</button>`) +
      `<div class="legend"><span style="--c:var(--danger)">Opsigelsesfrist/udløb</span><span style="--c:var(--gold)">Anbefalet udbudsstart</span><span style="--c:var(--slate)">Periodeslut</span><span style="--c:var(--beige-d)">Indeksregulering</span></div>` +
      (months.size ? [...months.values()].map(m => `<div class="tl-month"><h3>${m.d.toLocaleDateString('da-DK', { month: 'long', year: 'numeric' })}</h3>
        ${m.items.map(e => `<div class="tl-item ${e.type}" data-href="#/aftaler/${e.a.id}" tabindex="0"><span class="d">${e.date.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}</span>
          <div><strong>${esc(e.a.title)}</strong><div class="small muted">${esc(e.label)} · ${esc(e.a.supplier || '')} · ${kr(e.a.annual_cost)}/år</div></div>
          <span class="tag ${e.type === 'notice' ? 'danger' : e.type === 'tender' ? 'warn' : ''}">${lbl[e.type]}</span></div>`).join('')}</div>`).join('')
        : '<div class="card empty">Ingen hændelser i perioden.</div>');
  }

  function icsExport() {
    const t = today();
    const ev = C.timelineEvents(S.D, t, 36, lead()).filter(e => e.type === 'notice' || e.type === 'tender');
    const ie = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const ymd = d => C.isoDate(d).replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const fold = line => { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); } out.push(line); return out.join('\r\n'); };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Core Partners//Aftaleoverblik//DA', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Aftalefrister ' + ie(S.org.name)];
    ev.forEach(e => {
      const next = new Date(e.date); next.setDate(next.getDate() + 1);
      const title = (e.type === 'notice' ? 'FRIST: ' : 'Start udbud: ') + e.a.title;
      lines.push('BEGIN:VEVENT', `UID:${e.a.id}-${e.type}-${ymd(e.date)}@corepartners.dk`, 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + ymd(e.date), 'DTEND;VALUE=DATE:' + ymd(next), 'SUMMARY:' + ie(title),
        'DESCRIPTION:' + ie(`${e.label}\nLeverandør: ${e.a.supplier || '-'}\nÅrlig pris: ${kr(e.a.annual_cost)}`),
        'BEGIN:VALARM', 'TRIGGER:-P14D', 'ACTION:DISPLAY', 'DESCRIPTION:' + ie(title), 'END:VALARM', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    download('aftalefrister.ics', lines.map(fold).join('\r\n'), 'text/calendar;charset=utf-8');
  }

  // ======================================================================
  // Ejendomme
  // ======================================================================
  function propertyCosts() {
    const m = new Map(S.D.properties.map(p => [p.id, { cost: 0, count: 0 }]));
    S.D.agreements.filter(a => !C.isClosed(a)).forEach(a => {
      C.coveredPropertyIds(a, S.D).forEach(id => { if (m.has(id)) m.get(id).count++; });
      C.allocation(a, S.D).forEach((v, id) => { if (m.has(id)) m.get(id).cost += v; });
    });
    return m;
  }
  function viewProperties() {
    const costs = propertyCosts();
    const list = S.D.properties.slice().sort((a, b) => a.name.localeCompare(b.name, 'da'));
    return pageHead('Ejendomme', `${list.length} ejendomme · ${nf.format(sum(list, p => Number(p.area_m2) || 0))} m²`,
      canEdit() ? '<button class="btn btn-primary" data-action="newProperty"><i class="fa-solid fa-plus"></i> Ny ejendom</button>' : '') +
      `<div class="table-wrap"><table><thead><tr><th>Ejendom</th><th>Portefølje</th><th>Region</th><th class="num">m²</th><th class="num">Aftaler</th><th class="num">Driftsudgift/år</th><th class="num">kr./m²</th></tr></thead>
      <tbody>${list.length ? list.map(p => { const c = costs.get(p.id); return `<tr class="link" data-href="#/ejendomme/${p.id}">
        <td><div class="title">${esc(p.name)}</div><div class="sub">${esc([p.address, [p.postal_code, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</div></td>
        <td>${esc((pfById(p.portfolio_id) || {}).name || '—')}</td><td class="nowrap">${esc(p.region || '—')}</td>
        <td class="num">${p.area_m2 ? nf.format(p.area_m2) : '—'}</td><td class="num">${c.count}</td><td class="num">${kr(c.cost)}</td>
        <td class="num">${p.area_m2 ? (c.cost / p.area_m2).toLocaleString('da-DK', { maximumFractionDigits: 0 }) : '—'}</td></tr>`; }).join('') : '<tr><td colspan="7" class="empty">Ingen ejendomme endnu.</td></tr>'}</tbody></table></div>`;
  }

  function viewProperty(id) {
    const p = prop(id); if (!p) return notFound('Ejendommen');
    const rows = S.D.agreements.filter(a => C.coveredPropertyIds(a, S.D).includes(id))
      .map(a => ({ a, cost: C.allocation(a, S.D).get(id) || 0 }));
    const active = rows.filter(r => !C.isClosed(r.a));
    const total = sum(active, r => r.cost);
    const missing = C.CATEGORIES.filter(c => ['insurance', 'cleaning', 'caretaker', 'waste'].includes(c.key) && !active.some(r => r.a.category === c.key));
    return pageHead(esc(p.name), esc([p.address, [p.postal_code, p.city].filter(Boolean).join(' '), p.region].filter(Boolean).join(' · ')),
      canEdit() ? `<button class="btn" data-action="editProperty" data-id="${p.id}"><i class="fa-solid fa-pen"></i> Redigér</button><button class="btn btn-primary" data-action="newAgreement" data-prop="${p.id}"><i class="fa-solid fa-plus"></i> Ny aftale</button>` : '',
      '<a href="#/ejendomme">Ejendomme</a> /') + `
    <div class="grid g4" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Driftsudgift/år</div><div class="val">${krShort(total)}</div></div>
      <div class="kpi"><div class="lbl">kr. pr. m²</div><div class="val">${p.area_m2 ? nf.format(total / p.area_m2) : '—'}</div></div>
      <div class="kpi"><div class="lbl">Areal</div><div class="val">${p.area_m2 ? nf.format(p.area_m2) + ' m²' : '—'}</div><div class="sub">${p.units ? p.units + ' lejemål' : ''} ${esc(p.property_type || '')}</div></div>
      <div class="kpi"><div class="lbl">Portefølje</div><div class="val" style="font-size:22px">${pfById(p.portfolio_id) ? `<a href="#/portefoljer/${p.portfolio_id}">${esc(pfById(p.portfolio_id).name)}</a>` : '—'}</div></div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Aftale</th><th>Via</th><th class="num">Andel/år</th><th>Næste frist</th><th>Status</th></tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr class="link" data-href="#/aftaler/${r.a.id}"><td><div class="title">${esc(r.a.title)}</div><div class="sub">${esc(cat(r.a.category).label)} · ${esc(r.a.supplier || '')}</div></td>
      <td>${scopeTag(r.a)}</td><td class="num">${kr(r.cost)}</td><td>${deadlineCell(r.a)}</td><td>${statusTag(r.a)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">Ingen aftaler omfatter ejendommen.</td></tr>'}
    </tbody></table></div>
    ${missing.length && rows.length ? `<p class="small muted" style="margin-top:10px"><i class="fa-solid fa-circle-info"></i> Ingen registreret aftale for: ${missing.map(c => esc(c.label.toLowerCase())).join(', ')}.</p>` : ''}
    ${p.notes ? `<div class="card" style="margin-top:16px"><h3>Noter</h3><p style="white-space:pre-wrap">${esc(p.notes)}</p></div>` : ''}
    ${canEdit() ? `<div style="margin-top:16px"><button class="btn btn-danger btn-sm" data-action="deleteProperty" data-id="${p.id}"><i class="fa-regular fa-trash-can"></i> Slet ejendom</button></div>` : ''}`;
  }

  function propertyForm(p) {
    p = p || {};
    const v = k => esc(p[k] == null ? '' : p[k]);
    openModal(p.id ? 'Redigér ejendom' : 'Ny ejendom', `<form id="mform" class="form-grid">
      <label class="field full"><span>Navn *</span><input name="name" required value="${v('name')}"></label>
      <label class="field full"><span>Adresse</span><input name="address" value="${v('address')}"></label>
      <label class="field"><span>Postnr.</span><input name="postal_code" value="${v('postal_code')}" inputmode="numeric"></label>
      <label class="field"><span>By</span><input name="city" value="${v('city')}"></label>
      <label class="field"><span>Region</span><select name="region">${regionOptions(p.region, '— vælg —')}</select></label>
      <label class="field"><span>Portefølje</span><select name="portfolio_id">${pfOptions(p.portfolio_id, '— ingen —')}</select></label>
      <label class="field"><span>Type</span><input name="property_type" value="${v('property_type')}" list="ptypes" placeholder="Bolig, kontor, lager …"><datalist id="ptypes"><option>Bolig</option><option>Kontor</option><option>Butik</option><option>Lager</option><option>Blandet</option><option>Andelsbolig</option><option>Ejerforening</option></datalist></label>
      <label class="field"><span>Areal (m²)</span><input name="area_m2" inputmode="decimal" value="${v('area_m2')}"></label>
      <label class="field"><span>Lejemål</span><input name="units" inputmode="numeric" value="${v('units')}"></label>
      <label class="field full"><span>Noter</span><textarea name="notes">${v('notes')}</textarea></label>
      <div class="form-actions full"><div class="right"><button type="button" class="btn" data-action="closeModal">Annullér</button><button class="btn btn-primary" type="submit">Gem</button></div></div>
    </form>`, async o => {
      const row = { id: p.id || uuid(), org_id: S.org.id, name: o.name, address: o.address || null, postal_code: o.postal_code || null, city: o.city || null,
        region: o.region || null, portfolio_id: o.portfolio_id || null, property_type: o.property_type || null,
        area_m2: num(o.area_m2), units: o.units ? parseInt(o.units, 10) : null, notes: o.notes || null };
      await S.store.upsert('properties', row);
      closeModal(); toast('Ejendommen er gemt'); await loadOrg();
      if (location.hash !== '#/ejendomme/' + row.id) location.hash = '#/ejendomme/' + row.id; else route(false);
    });
  }

  // ======================================================================
  // Porteføljer
  // ======================================================================
  function portfolioStats(pfId) {
    const props = S.D.properties.filter(p => (pfId ? p.portfolio_id === pfId : !p.portfolio_id));
    const ids = new Set(props.map(p => p.id));
    let cost = 0, pot = 0, next = null;
    S.D.agreements.filter(a => !C.isClosed(a)).forEach(a => {
      let share = 0;
      C.allocation(a, S.D).forEach((v, id) => { if (ids.has(id)) share += v; });
      if (!share && pfId && a.portfolio_id === pfId) share = C.countedCost(a, S.D);
      if (!share && !(pfId && a.portfolio_id === pfId) && !C.coveredPropertyIds(a, S.D).some(id => ids.has(id))) return;
      cost += share; pot += share * C.potentialPct(a) / 100;
      const d = datesOf(a);
      if (d.noticeDeadline && d.daysToNotice >= 0 && (!next || d.noticeDeadline < next.date)) next = { date: d.noticeDeadline, a };
    });
    return { props, cost, pot, next, area: sum(props, p => Number(p.area_m2) || 0) };
  }
  function viewPortfolios() {
    const cons = C.consolidation(S.D);
    const cards = S.D.portfolios.map(p => ({ p, s: portfolioStats(p.id) }));
    const loose = portfolioStats(null);
    const frameworks = S.D.agreements.filter(a => a.scope === 'framework' && !C.isClosed(a));
    return pageHead('Porteføljer', 'Samlet overblik pr. portefølje og forslag til regionale rammeaftaler.',
      canEdit() ? '<button class="btn btn-primary" data-action="newPortfolio"><i class="fa-solid fa-plus"></i> Ny portefølje</button>' : '') +
      `<div class="grid g3" style="margin-bottom:20px">${cards.map(({ p, s }) => `<div class="card" style="cursor:pointer" data-href="#/portefoljer/${p.id}">
        <h2>${esc(p.name)}</h2><p class="small muted" style="margin:-6px 0 10px">${esc(p.description || '')}</p>
        <dl class="dl"><dt>Ejendomme</dt><dd>${s.props.length} · ${nf.format(s.area)} m²</dd><dt>Driftsudgift</dt><dd>${kr(s.cost)}/år</dd>
        <dt>Potentiale</dt><dd>${kr(s.pot)}/år</dd><dt>Næste frist</dt><dd>${s.next ? fmtDate(s.next.date) + ' · ' + esc(s.next.a.title) : '—'}</dd></dl></div>`).join('')}
        ${loose.props.length ? `<div class="card"><h2>Uden portefølje</h2><dl class="dl"><dt>Ejendomme</dt><dd>${loose.props.length}</dd><dt>Driftsudgift</dt><dd>${kr(loose.cost)}/år</dd></dl></div>` : ''}
        ${!cards.length && !loose.props.length ? '<div class="card empty">Ingen porteføljer endnu.</div>' : ''}</div>
      <div class="grid g2">
        <div class="card"><h2>Forslag til rammeaftaler</h2>${cons.length ? cons.map(consolidationHtml).join('') : '<p class="muted">Ingen kategorier med flere separate aftaler i samme region.</p>'}</div>
        <div class="card"><h2>Eksisterende rammeaftaler</h2>${frameworks.length ? `<table><tbody>${frameworks.map(a => `<tr class="link" data-href="#/aftaler/${a.id}"><td>${esc(a.title)}<div class="sub">${esc(a.region || '')} · ${C.coveredPropertyIds(a, S.D).length} ejendomme</div></td><td>${deadlineCell(a)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Ingen registrerede rammeaftaler.</p>'}</div>
      </div>`;
  }
  function viewPortfolio(id) {
    const p = pfById(id); if (!p) return notFound('Porteføljen');
    const s = portfolioStats(id);
    const ids = new Set(s.props.map(x => x.id));
    const ags = S.D.agreements.filter(a => a.portfolio_id === id || C.coveredPropertyIds(a, S.D).some(x => ids.has(x)));
    const costs = propertyCosts();
    return pageHead(esc(p.name), esc(p.description || ''),
      canEdit() ? `<button class="btn" data-action="editPortfolio" data-id="${p.id}"><i class="fa-solid fa-pen"></i> Redigér</button><button class="btn btn-danger" data-action="deletePortfolio" data-id="${p.id}"><i class="fa-regular fa-trash-can"></i></button>` : '',
      '<a href="#/portefoljer">Porteføljer</a> /') + `
    <div class="grid g4" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Ejendomme</div><div class="val">${s.props.length}</div><div class="sub">${nf.format(s.area)} m²</div></div>
      <div class="kpi"><div class="lbl">Driftsudgift/år</div><div class="val">${krShort(s.cost)}</div></div>
      <div class="kpi accent"><div class="lbl">Potentiale/år</div><div class="val">${krShort(s.pot)}</div></div>
      <div class="kpi"><div class="lbl">Næste frist</div><div class="val" style="font-size:22px">${s.next ? fmtDate(s.next.date) : '—'}</div><div class="sub">${s.next ? esc(s.next.a.title) : ''}</div></div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Ejendomme</h2><table><tbody>${s.props.map(x => `<tr class="link" data-href="#/ejendomme/${x.id}"><td>${esc(x.name)}<div class="sub">${esc(x.city || '')}</div></td><td class="num">${kr(costs.get(x.id).cost)}</td></tr>`).join('') || '<tr><td class="empty">Ingen ejendomme.</td></tr>'}</tbody></table></div>
      <div class="card"><h2>Aftaler</h2><table><tbody>${ags.map(a => `<tr class="link" data-href="#/aftaler/${a.id}"><td>${esc(a.title)}<div class="sub">${scopeTag(a)} ${esc(a.supplier || '')}</div></td><td>${deadlineCell(a)}</td></tr>`).join('') || '<tr><td class="empty">Ingen aftaler.</td></tr>'}</tbody></table></div>
    </div>`;
  }
  function portfolioForm(p) {
    p = p || {};
    openModal(p.id ? 'Redigér portefølje' : 'Ny portefølje', `<form id="mform">
      <label class="field"><span>Navn *</span><input name="name" required value="${esc(p.name || '')}"></label>
      <label class="field"><span>Beskrivelse</span><input name="description" value="${esc(p.description || '')}"></label>
      <div class="field"><span>Ejendomme</span><div class="link-list">${S.D.properties.map(x => `<label class="link-row" style="grid-template-columns:auto 1fr"><input type="checkbox" name="pp_${x.id}" ${p.id && x.portfolio_id === p.id ? 'checked' : ''}><div>${esc(x.name)}<div class="sub">${esc((pfById(x.portfolio_id) || {}).name || 'Ingen portefølje')}</div></div></label>`).join('') || '<p class="small muted" style="padding:10px">Ingen ejendomme endnu.</p>'}</div></div>
      <div class="form-actions"><div class="right"><button type="button" class="btn" data-action="closeModal">Annullér</button><button class="btn btn-primary" type="submit">Gem</button></div></div>
    </form>`, async (o, form) => {
      const row = { id: p.id || uuid(), org_id: S.org.id, name: o.name, description: o.description || null };
      await S.store.upsert('portfolios', row);
      const changed = [];
      S.D.properties.forEach(x => {
        const on = form['pp_' + x.id].checked;
        if (on && x.portfolio_id !== row.id) changed.push({ ...x, portfolio_id: row.id });
        if (!on && x.portfolio_id === row.id) changed.push({ ...x, portfolio_id: null });
      });
      await S.store.upsertMany('properties', changed);
      closeModal(); toast('Porteføljen er gemt'); await loadOrg();
      if (location.hash !== '#/portefoljer/' + row.id) location.hash = '#/portefoljer/' + row.id; else route(false);
    });
  }

  // ======================================================================
  // Udbud
  // ======================================================================
  const checklistDone = x => C.CHECKLIST.reduce((n, p) => n + p.items.filter(([k]) => x.checklist && x.checklist[k]).length, 0);
  function viewTenders() {
    const list = S.D.tenders.slice().sort((a, b) => (a.status === 'awarded' || a.status === 'cancelled') - (b.status === 'awarded' || b.status === 'cancelled') || String(b.created_at).localeCompare(String(a.created_at)));
    return pageHead('Udbud', 'Styr udbud med tjekliste, tilbudsevaluering og beregning af besparelsen.',
      canEdit() ? '<button class="btn btn-primary" data-action="newTender"><i class="fa-solid fa-plus"></i> Nyt udbud</button>' : '') +
      `<div class="table-wrap"><table><thead><tr><th>Udbud</th><th>Status</th><th>Tjekliste</th><th>Tilbudsfrist</th><th class="num">Nuværende pris</th><th class="num">Bedste tilbud</th></tr></thead><tbody>
      ${list.length ? list.map(x => { const done = checklistDone(x); const ranked = C.tenderScore(x); const best = x.new_annual_cost || (ranked[0] && ranked[0].price); return `<tr class="link" data-href="#/udbud/${x.id}">
        <td><div class="title">${esc(x.title)}</div><div class="sub">${x.agreement_id && agr(x.agreement_id) ? esc(agr(x.agreement_id).title) : 'Ikke knyttet til aftale'}</div></td>
        <td><span class="tag ${x.status === 'awarded' ? 'ok' : x.status === 'cancelled' ? '' : 'warn'}">${esc(tenderStatusLabel(x.status))}</span></td>
        <td style="min-width:120px"><div class="progress"><div style="width:${done / C.CHECKLIST_COUNT * 100}%"></div></div><div class="sub">${done}/${C.CHECKLIST_COUNT}</div></td>
        <td class="nowrap">${fmtDate(x.bid_deadline)}</td><td class="num">${x.baseline_cost ? kr(x.baseline_cost) : '—'}</td>
        <td class="num">${best ? kr(best) : '—'}${best && x.baseline_cost ? `<div class="sub" style="color:var(--ok)">${kr(x.baseline_cost - best)} sparet</div>` : ''}</td></tr>`; }).join('') : '<tr><td colspan="6" class="empty">Ingen udbud endnu. Start et udbud fra en aftale eller opret et nyt.</td></tr>'}
      </tbody></table></div>
      <div class="card" style="margin-top:16px"><h2>Tjekliste til udbud</h2><p class="small muted" style="margin-bottom:10px">Følges automatisk i hvert udbud.</p>
        <div class="grid g2">${C.CHECKLIST.map(p => `<div><h3>${esc(p.label)}</h3><ul style="padding-left:18px" class="small">${p.items.map(([, l]) => `<li>${esc(l)}</li>`).join('')}</ul></div>`).join('')}</div></div>`;
  }

  function viewTender(id) {
    const x = S.D.tenders.find(t => t.id === id); if (!x) return notFound('Udbuddet');
    const a = x.agreement_id && agr(x.agreement_id);
    const done = checklistDone(x);
    const ranked = C.tenderScore(x);
    const idx = C.TENDER_STATUSES.findIndex(s => s.key === x.status);
    const ed = canEdit();
    return pageHead(esc(x.title), a ? `Aftale: <a href="#/aftaler/${a.id}">${esc(a.title)}</a> · ${deadlineCell(a).replace(/<div[^>]*>|<\/div>/g, ' ')}` : '',
      ed ? `<button class="btn" data-action="editTender" data-id="${x.id}"><i class="fa-solid fa-pen"></i> Redigér</button>` : '', '<a href="#/udbud">Udbud</a> /') + `
    <div class="card" style="margin-bottom:16px"><div class="steps">${C.TENDER_STATUSES.map((s, i) => `<button ${ed ? `data-action="tenderStatus" data-id="${x.id}" data-status="${s.key}"` : 'disabled'} class="${s.key === x.status ? 'on' : i < idx && x.status !== 'cancelled' ? 'past' : ''}">${esc(s.label)}</button>`).join('')}</div>
      <dl class="dl" style="margin-top:12px"><dt>Planlagt start</dt><dd>${fmtDate(x.planned_start)}</dd><dt>Tilbudsfrist</dt><dd>${fmtDate(x.bid_deadline)}</dd><dt>Beslutning</dt><dd>${fmtDate(x.decision_date)}</dd>
      <dt>Nuværende pris</dt><dd>${x.baseline_cost ? kr(x.baseline_cost) + '/år' : '—'}</dd><dt>Vægtning</dt><dd>Pris ${x.price_weight}% · kvalitet ${100 - x.price_weight}%</dd>
      ${x.status === 'awarded' ? `<dt>Tildelt</dt><dd><strong>${esc(x.awarded_supplier)}</strong> · ${kr(x.new_annual_cost)}/år${x.baseline_cost ? ` · <span style="color:var(--ok)">besparelse ${kr(x.baseline_cost - x.new_annual_cost)}/år</span>` : ''}</dd>` : ''}
      ${x.notes ? `<dt>Noter</dt><dd style="white-space:pre-wrap">${esc(x.notes)}</dd>` : ''}</dl></div>
    <div class="stack">
      <div class="card"><div class="card-head"><h2>Tjekliste</h2><span class="small muted">${done}/${C.CHECKLIST_COUNT}</span></div>
        <div class="progress" style="margin-bottom:14px"><div style="width:${done / C.CHECKLIST_COUNT * 100}%"></div></div>
        <div class="phases">${C.CHECKLIST.map(p => `<div class="phase"><h3><span>${esc(p.label)}</span><span class="small muted">${p.items.filter(([k]) => x.checklist[k]).length}/${p.items.length}</span></h3>
          ${p.items.map(([k, l]) => `<label class="chk ${x.checklist[k] ? 'done' : ''}"><input type="checkbox" ${x.checklist[k] ? 'checked' : ''} ${ed ? '' : 'disabled'} data-check="${k}" data-tender="${x.id}"><span>${esc(l)}</span></label>`).join('')}</div>`).join('')}</div>
      </div>
        <div class="card"><div class="card-head"><h2>Tilbud</h2>${ed ? `<button class="btn btn-sm" data-action="addBid" data-id="${x.id}"><i class="fa-solid fa-plus"></i> Tilføj tilbud</button>` : ''}</div>
          ${ranked.length ? `<div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Leverandør</th><th class="num">Pris/år</th><th class="num">Pris</th><th class="num">Kvalitet</th><th class="num">Samlet</th><th></th></tr></thead><tbody>
          ${ranked.map((b, i) => `<tr><td>${i + 1}</td><td>${esc(b.supplier)}${b.note ? `<div class="sub">${esc(b.note)}</div>` : ''}</td><td class="num">${kr(b.price)}${x.baseline_cost ? `<div class="sub" style="color:${x.baseline_cost - b.price >= 0 ? 'var(--ok)' : 'var(--danger)'}">${x.baseline_cost - b.price >= 0 ? '−' : '+'}${kr(Math.abs(x.baseline_cost - b.price))}</div>` : ''}</td>
            <td class="num">${b.priceScore.toFixed(1)}</td><td class="num">${(Number(b.quality) || 0).toFixed(1)}</td><td class="num"><strong>${b.total.toFixed(2)}</strong></td>
            <td class="nowrap">${ed && x.status !== 'awarded' ? `<button class="btn btn-sm btn-primary" data-action="award" data-id="${x.id}" data-bid="${b.id}">Tildel</button> <button class="icon-btn" data-action="removeBid" data-id="${x.id}" data-bid="${b.id}" aria-label="Fjern tilbud"><i class="fa-regular fa-trash-can"></i></button>` : ''}</td></tr>`).join('')}
          </tbody></table></div><p class="small muted" style="margin-top:8px">Pris-score: laveste pris = 10, øvrige forholdsmæssigt. Kvalitet vurderes 0–10.</p>` : '<p class="muted small">Ingen tilbud registreret endnu.</p>'}
        </div>
        ${ed ? `<div><button class="btn btn-danger btn-sm" data-action="deleteTender" data-id="${x.id}"><i class="fa-regular fa-trash-can"></i> Slet udbud</button></div>` : ''}
    </div>`;
  }

  function tenderForm(x, agreementId) {
    const a = agreementId && agr(agreementId);
    x = x || { status: 'planning', price_weight: 60, checklist: {}, bids: [], agreement_id: agreementId || null,
      title: a ? 'Udbud: ' + a.title : '', baseline_cost: a ? a.annual_cost : null,
      planned_start: a ? (C.isoDate(datesOf(a).tenderStart && datesOf(a).tenderStart > today() ? datesOf(a).tenderStart : today())) : C.isoDate(today()) };
    const v = k => esc(x[k] == null ? '' : x[k]);
    openModal(x.id ? 'Redigér udbud' : 'Nyt udbud', `<form id="mform" class="form-grid">
      <label class="field full"><span>Titel *</span><input name="title" required value="${v('title')}"></label>
      <label class="field full"><span>Aftale der udbydes</span><select name="agreement_id">${opt('', '— ingen —', x.agreement_id)}${S.D.agreements.filter(y => !C.isClosed(y)).map(y => opt(y.id, y.title, x.agreement_id)).join('')}</select></label>
      <label class="field"><span>Planlagt start</span><input type="date" name="planned_start" value="${v('planned_start')}"></label>
      <label class="field"><span>Tilbudsfrist</span><input type="date" name="bid_deadline" value="${v('bid_deadline')}"></label>
      <label class="field"><span>Beslutningsdato</span><input type="date" name="decision_date" value="${v('decision_date')}"></label>
      <label class="field"><span>Nuværende pris (kr./år)</span><input name="baseline_cost" inputmode="decimal" value="${v('baseline_cost')}"></label>
      <label class="field"><span>Vægt på pris (%)</span><input type="number" min="0" max="100" name="price_weight" value="${v('price_weight')}"><span class="hint">Resten vægtes på kvalitet</span></label>
      <label class="field full"><span>Noter</span><textarea name="notes">${v('notes')}</textarea></label>
      <div class="form-actions full"><div class="right"><button type="button" class="btn" data-action="closeModal">Annullér</button><button class="btn btn-primary" type="submit">Gem</button></div></div>
    </form>`, async o => {
      const row = { ...x, id: x.id || uuid(), org_id: S.org.id, title: o.title, agreement_id: o.agreement_id || null,
        planned_start: o.planned_start || null, bid_deadline: o.bid_deadline || null, decision_date: o.decision_date || null,
        baseline_cost: num(o.baseline_cost), price_weight: Math.min(100, Math.max(0, parseInt(o.price_weight, 10) || 60)), notes: o.notes || null };
      await S.store.upsert('tenders', row);
      const ag = row.agreement_id && agr(row.agreement_id);
      if (!x.id && ag && !['awarded', 'cancelled'].includes(row.status)) await S.store.upsert('agreements', { ...ag, status: 'in_tender' });
      closeModal(); toast('Udbuddet er gemt'); await loadOrg();
      if (location.hash !== '#/udbud/' + row.id) location.hash = '#/udbud/' + row.id; else route(false);
    });
  }

  function bidForm(x) {
    openModal('Tilføj tilbud', `<form id="mform" class="form-grid">
      <label class="field full"><span>Leverandør *</span><input name="supplier" required></label>
      <label class="field"><span>Pris pr. år (kr.) *</span><input name="price" required inputmode="decimal"></label>
      <label class="field"><span>Kvalitet (0–10)</span><input type="number" name="quality" min="0" max="10" step="0.5" value="5"></label>
      <label class="field full"><span>Note</span><input name="note"></label>
      <div class="form-actions full"><div class="right"><button type="button" class="btn" data-action="closeModal">Annullér</button><button class="btn btn-primary" type="submit">Tilføj</button></div></div>
    </form>`, async o => {
      const price = num(o.price); if (!price) throw new Error('Angiv en pris.');
      const bids = (x.bids || []).concat([{ id: uuid(), supplier: o.supplier, price, quality: Number(o.quality) || 0, note: o.note || '' }]);
      await S.store.upsert('tenders', { ...x, bids });
      closeModal(); await reload();
    });
  }

  function awardForm(x, bid) {
    const a = x.agreement_id && agr(x.agreement_id);
    const t = today();
    openModal('Tildel kontrakt', `<form id="mform" class="form-grid">
      <p class="full" style="margin-bottom:12px">Tildel til <strong>${esc(bid.supplier)}</strong> for <strong>${kr(bid.price)}/år</strong>${x.baseline_cost ? `, en besparelse på <strong style="color:var(--ok)">${kr(x.baseline_cost - bid.price)}/år</strong>` : ''}.</p>
      ${a ? `<p class="full small muted" style="margin-bottom:12px">Aftalen „${esc(a.title)}“ opdateres med ny leverandør, pris og datoer.</p>
      <label class="field"><span>Ny startdato</span><input type="date" name="start_date" value="${esc(C.isoDate(a.end_date && C.parseDate(a.end_date) > t ? C.parseDate(a.end_date) : t))}"></label>
      <label class="field"><span>Nyt udløb</span><input type="date" name="end_date" value="${esc(C.isoDate(C.addMonths(a.end_date && C.parseDate(a.end_date) > t ? C.parseDate(a.end_date) : t, 36)))}"></label>
      <label class="field"><span>Opsigelsesvarsel (mdr.)</span><input type="number" name="notice_months" min="0" value="${esc(a.notice_months)}"></label>` : ''}
      <div class="form-actions full"><div class="right"><button type="button" class="btn" data-action="closeModal">Annullér</button><button class="btn btn-primary" type="submit">Tildel</button></div></div>
    </form>`, async o => {
      await S.store.upsert('tenders', { ...x, status: 'awarded', awarded_supplier: bid.supplier, new_annual_cost: bid.price, awarded_at: C.isoDate(t) });
      if (a) {
        await S.store.upsert('agreements', { ...a, supplier: bid.supplier, annual_cost: bid.price, start_date: o.start_date || a.start_date,
          end_date: o.end_date || null, notice_months: parseInt(o.notice_months, 10) || 0, last_tendered: C.isoDate(t), status: 'active' });
      }
      closeModal(); toast('Kontrakten er tildelt'); await reload();
    });
  }

  // ======================================================================
  // Import / eksport
  // ======================================================================
  const AG_COLS = [
    ['titel', a => a.title], ['kategori', a => cat(a.category).label], ['leverandør', a => a.supplier], ['kontakt', a => a.supplier_contact],
    ['omfang', a => C.SCOPES[a.scope].short], ['portefølje', a => (pfById(a.portfolio_id) || {}).name], ['region', a => a.region],
    ['ejendomme', a => S.D.links.filter(l => l.agreement_id === a.id).map(l => (prop(l.property_id) || {}).name).filter(Boolean).join(' | ')],
    ['rammeaftale', a => (agr(a.parent_agreement_id) || {}).title],
    ['årlig_pris', a => a.annual_cost], ['start', a => a.start_date], ['udløb', a => a.end_date], ['binding_til', a => a.binding_until],
    ['opsigelse_mdr', a => a.notice_months], ['auto_forlængelse', a => a.auto_renew ? 'ja' : 'nej'], ['forlængelse_mdr', a => a.renewal_months],
    ['indeksregulering', a => a.indexation], ['indeks_dato', a => a.indexation_date], ['sidst_udbudt', a => a.last_tendered],
    ['status', a => (C.STATUSES[a.status] || {}).label], ['noter', a => a.notes]
  ];
  const PROP_COLS = [
    ['navn', p => p.name], ['adresse', p => p.address], ['postnr', p => p.postal_code], ['by', p => p.city], ['region', p => p.region],
    ['type', p => p.property_type], ['m2', p => p.area_m2], ['lejemål', p => p.units], ['portefølje', p => (pfById(p.portfolio_id) || {}).name], ['noter', p => p.notes]
  ];

  function viewData() {
    const cloud = S.store.mode === 'cloud';
    return pageHead('Import og eksport', 'Flyt data ind og ud via Excel/CSV, kalender og backup.') + `
    <div class="grid g2">
      <div class="card"><h2>Importér fra Excel</h2>
        <p class="small muted" style="margin-bottom:12px">Hent skabelonen, udfyld den i Excel og gem som <strong>CSV (semikolonsepareret)</strong>. Importér ejendomme før aftaler, så aftalerne kan knyttes til ejendommene via navn. Flere ejendomme adskilles med <code>|</code>.</p>
        <div class="actions" style="margin-bottom:14px"><button class="btn btn-sm" data-action="template" data-type="properties"><i class="fa-solid fa-download"></i> Skabelon: ejendomme</button>
        <button class="btn btn-sm" data-action="template" data-type="agreements"><i class="fa-solid fa-download"></i> Skabelon: aftaler</button></div>
        ${canEdit() ? `<label class="field"><span>Importér ejendomme (CSV)</span><input type="file" accept=".csv,text/csv" data-import="properties"></label>
        <label class="field"><span>Importér aftaler (CSV)</span><input type="file" accept=".csv,text/csv" data-import="agreements"></label>` : '<p class="muted small">Du har kun læseadgang.</p>'}
      </div>
      <div class="card"><h2>Eksportér</h2>
        <div class="stack" style="gap:8px">
          <button class="btn" data-action="exportAgreements"><i class="fa-solid fa-file-csv"></i> Aftaler (CSV til Excel)</button>
          <button class="btn" data-action="exportProperties"><i class="fa-solid fa-file-csv"></i> Ejendomme (CSV til Excel)</button>
          <button class="btn" data-action="exportIcs"><i class="fa-regular fa-calendar-plus"></i> Frister som kalender (.ics)</button>
          <button class="btn" data-action="exportJson"><i class="fa-solid fa-box-archive"></i> Fuld backup (JSON)</button>
        </div>
        ${!cloud && canEdit() ? `<label class="field" style="margin-top:14px"><span>Gendan backup (JSON). Erstatter alle data</span><input type="file" accept=".json,application/json" data-import="json"></label>` : ''}
      </div>
    </div>`;
  }

  function findCat(s) {
    s = (s || '').toLowerCase().trim(); if (!s) return 'other';
    const c = C.CATEGORIES.find(c => c.key === s || c.label.toLowerCase() === s) || C.CATEGORIES.find(c => c.label.toLowerCase().startsWith(s) || s.startsWith(c.label.toLowerCase().split(/[\/ ]/)[0]));
    return c ? c.key : 'other';
  }
  function findScope(s) {
    s = (s || '').toLowerCase();
    if (s.startsWith('ramme') || s === 'framework') return 'framework';
    if (s.startsWith('portef') || s === 'portfolio') return 'portfolio';
    return 'property';
  }
  function findStatus(s) {
    s = (s || '').toLowerCase(); if (!s) return 'active';
    const e = Object.entries(C.STATUSES).find(([k, v]) => k === s || v.label.toLowerCase() === s);
    return e ? e[0] : 'active';
  }
  const yes = s => /^(ja|j|yes|y|true|1|x)$/i.test(String(s || '').trim());

  async function importCsv(type, file) {
    const rows = C.parseCSV(await file.text());
    if (!rows.length) throw new Error('Filen indeholder ingen rækker.');
    const pfByName = new Map(S.D.portfolios.map(p => [p.name.toLowerCase(), p]));
    const newPfs = [];
    const getPf = name => {
      if (!name) return null; const k = name.toLowerCase();
      if (!pfByName.has(k)) { const p = { id: uuid(), org_id: S.org.id, name }; pfByName.set(k, p); newPfs.push(p); }
      return pfByName.get(k).id;
    };
    const warnings = [];
    if (type === 'properties') {
      const byName = new Map(S.D.properties.map(p => [p.name.toLowerCase(), p]));
      const out = [];
      rows.forEach((r, i) => {
        if (!r['navn']) { warnings.push(`Række ${i + 2}: mangler navn`); return; }
        const ex = byName.get(r['navn'].toLowerCase());
        out.push({ id: ex ? ex.id : uuid(), org_id: S.org.id, name: r['navn'], address: r['adresse'] || null, postal_code: r['postnr'] || null, city: r['by'] || null,
          region: C.REGIONS.find(x => x.toLowerCase() === (r['region'] || '').toLowerCase() || x.toLowerCase() === ('region ' + (r['region'] || '')).toLowerCase()) || r['region'] || null,
          property_type: r['type'] || null, area_m2: num(r['m2']), units: r['lejemål'] ? parseInt(r['lejemål'], 10) : null, portfolio_id: getPf(r['portefølje']), notes: r['noter'] || null });
      });
      await S.store.upsertMany('portfolios', newPfs);
      await S.store.upsertMany('properties', out);
      return `${out.length} ejendomme importeret` + (warnings.length ? ` · ${warnings.length} rækker sprunget over` : '');
    }
    const propByName = new Map(S.D.properties.map(p => [p.name.toLowerCase(), p]));
    const agByTitle = new Map(S.D.agreements.map(a => [a.title.toLowerCase(), a]));
    const newProps = [], ags = [], links = new Map();
    rows.forEach((r, i) => {
      if (!r['titel']) { warnings.push(`Række ${i + 2}: mangler titel`); return; }
      const ex = agByTitle.get(r['titel'].toLowerCase());
      const a = { id: ex ? ex.id : uuid(), org_id: S.org.id, title: r['titel'], category: findCat(r['kategori']), supplier: r['leverandør'] || null, supplier_contact: r['kontakt'] || null,
        scope: findScope(r['omfang']), region: C.REGIONS.find(x => x.toLowerCase() === (r['region'] || '').toLowerCase()) || r['region'] || null,
        annual_cost: num(r['årlig_pris']) || 0, start_date: C.parseDateLoose(r['start']), end_date: C.parseDateLoose(r['udløb']), binding_until: C.parseDateLoose(r['binding_til']),
        notice_months: parseInt(r['opsigelse_mdr'], 10) || 0, auto_renew: r['auto_forlængelse'] ? yes(r['auto_forlængelse']) : true,
        renewal_months: r['forlængelse_mdr'] ? parseInt(r['forlængelse_mdr'], 10) || 0 : 12, indexation: r['indeksregulering'] || null,
        indexation_date: C.parseDateLoose(r['indeks_dato']), last_tendered: C.parseDateLoose(r['sidst_udbudt']), status: findStatus(r['status']), notes: r['noter'] || null,
        portfolio_id: null, parent_agreement_id: null, _parent: r['rammeaftale'] };
      if (a.scope === 'portfolio') a.portfolio_id = getPf(r['portefølje']);
      ags.push(a); agByTitle.set(a.title.toLowerCase(), a);
      const names = (r['ejendomme'] || '').split('|').map(s => s.trim()).filter(Boolean);
      links.set(a.id, names.map(n => {
        let p = propByName.get(n.toLowerCase());
        if (!p) { p = { id: uuid(), org_id: S.org.id, name: n }; propByName.set(n.toLowerCase(), p); newProps.push(p); }
        return { agreement_id: a.id, property_id: p.id, org_id: S.org.id, cost_share: null };
      }));
    });
    ags.forEach(a => { if (a._parent) { const par = agByTitle.get(a._parent.toLowerCase()); a.parent_agreement_id = par && par.id !== a.id ? par.id : null; } delete a._parent; });
    await S.store.upsertMany('portfolios', newPfs);
    await S.store.upsertMany('properties', newProps);
    // Rammeaftaler først, så leveranceaftaler kan pege på dem.
    ags.sort((x, y) => (x.parent_agreement_id ? 1 : 0) - (y.parent_agreement_id ? 1 : 0));
    await S.store.upsertMany('agreements', ags);
    for (const [aid, ls] of links) if (ls.length) await S.store.replaceLinks(S.org.id, aid, ls);
    return `${ags.length} aftaler importeret` + (newProps.length ? ` · ${newProps.length} nye ejendomme oprettet` : '') + (warnings.length ? ` · ${warnings.length} rækker sprunget over` : '');
  }

  // ======================================================================
  // Indstillinger
  // ======================================================================
  function viewSettings() {
    const o = S.org, cloud = S.store.mode === 'cloud', own = isOwner();
    return pageHead('Indstillinger', esc(o.name)) + `<div class="grid g2">
      <div class="card"><h2>Organisation</h2><form data-form="org">
        <label class="field"><span>Navn</span><input name="name" value="${esc(o.name)}" ${own ? '' : 'disabled'} required></label>
        <label class="field"><span>CVR</span><input name="cvr" value="${esc(o.cvr || '')}" ${own ? '' : 'disabled'}></label>
        <label class="field"><span>Start udbud (mdr. før frist)</span><input type="number" min="1" max="24" name="tender_lead_months" value="${esc(o.tender_lead_months || 6)}" ${own ? '' : 'disabled'}><span class="hint">Bruges til "anbefalet udbudsstart" og påmindelser.</span></label>
        ${own ? '<button class="btn btn-primary" type="submit">Gem</button>' : ''}
      </form></div>
      <div class="card"><h2>Brugere</h2>
        ${S.D.members.map(m => `<div class="doc-row"><span>${esc(m.email)}</span><span class="actions">${own && cloud && m.user_id !== S.user.id
          ? `<select data-role="${m.user_id}" aria-label="Rolle">${['owner', 'editor', 'viewer'].map(r => opt(r, roleLabel(r), m.role)).join('')}</select><button class="icon-btn" data-action="removeMember" data-id="${m.user_id}" aria-label="Fjern bruger"><i class="fa-solid fa-user-minus"></i></button>`
          : `<span class="tag">${roleLabel(m.role)}</span>`}</span></div>`).join('')}
        ${S.D.invitations.map(i => `<div class="doc-row"><span>${esc(i.email)} <span class="small muted">inviteret</span></span><span class="actions"><span class="tag">${roleLabel(i.role)}</span>${own ? `<button class="icon-btn" data-action="removeInvite" data-id="${i.id}" aria-label="Annullér invitation"><i class="fa-solid fa-xmark"></i></button>` : ''}</span></div>`).join('')}
        ${own ? (cloud ? `<form data-form="invite" style="margin-top:14px" class="form-grid">
          <label class="field"><span>Invitér e-mail</span><input type="email" name="email" required></label>
          <label class="field"><span>Rolle</span><select name="role">${opt('editor', 'Redaktør', 'editor')}${opt('viewer', 'Læser')}${opt('owner', 'Ejer')}</select></label>
          <div class="full"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-paper-plane"></i> Send invitation</button></div></form>`
          : '<p class="small muted" style="margin-top:10px">Invitationer kræver at platformen er forbundet til Supabase.</p>') : ''}
      </div>
      ${cloud ? '' : `<div class="card"><h2>Demo</h2>
        <label class="check"><input type="checkbox" data-change="demoAdmin" ${S.profile.is_cp_admin ? 'checked' : ''}> Vis Core Partners-adminvisning</label>
        <button class="btn btn-danger" data-action="resetDemo">Nulstil demodata</button></div>`}
      ${cloud ? `<div class="card"><h2>Ny organisation</h2><p class="small muted" style="margin-bottom:10px">F.eks. et andet selskab eller en forening, I administrerer.</p><form data-form="newOrg">
        <label class="field"><span>Navn</span><input name="name" required></label><label class="field"><span>CVR</span><input name="cvr"></label>
        <button class="btn" type="submit">Opret</button></form></div>` : ''}
    </div>`;
  }
  const roleLabel = r => ({ owner: 'Ejer', editor: 'Redaktør', viewer: 'Læser', admin: 'Core Partners' }[r] || r);

  // ======================================================================
  // Core Partners admin
  // ======================================================================
  async function viewAdmin() {
    if (!(S.profile && S.profile.is_cp_admin)) return '<div class="card">Kun for Core Partners.</div>';
    const all = await S.store.loadAll();
    const t = today();
    const customers = all.map(({ org, D }) => {
      const L = org.tender_lead_months || 6;
      const open = D.agreements.filter(a => !C.isClosed(a));
      const prios = C.priorities(D, t, L);
      const soon = prios.filter(p => p.dates.daysToNotice != null && p.dates.daysToNotice >= 0 && p.dates.daysToNotice <= 270);
      return { org, D, spend: sum(open, a => C.countedCost(a, D)), pot: sum(prios, p => p.est), soon, reqs: D.requests.filter(r => r.status !== 'done') };
    }).sort((a, b) => b.pot - a.pot);
    const pipeline = customers.flatMap(c => c.soon.map(p => ({ c, p }))).sort((x, y) => x.p.dates.noticeDeadline - y.p.dates.noticeDeadline);
    const reqs = customers.flatMap(c => c.D.requests.map(r => ({ c, r }))).sort((x, y) => String(y.r.created_at).localeCompare(String(x.r.created_at)));
    return pageHead('Core Partners', 'Kundeoverblik, pipeline af kommende frister og henvendelser på tværs af alle kunder.') + `
    <div class="grid g4" style="margin-bottom:16px">
      <div class="kpi"><div class="lbl">Kunder</div><div class="val">${customers.length}</div></div>
      <div class="kpi"><div class="lbl">Driftsudgifter i alt</div><div class="val">${krShort(sum(customers, c => c.spend))}</div></div>
      <div class="kpi accent"><div class="lbl">Potentiale i pipeline (9 mdr.)</div><div class="val">${krShort(sum(pipeline, x => x.p.est))}</div><div class="sub">honorar ca. ${krShort(sum(pipeline, x => x.p.est) * 0.2)}</div></div>
      <div class="kpi"><div class="lbl">Åbne henvendelser</div><div class="val">${sum(customers, c => c.reqs.length)}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><h2>Henvendelser</h2>${reqs.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Kunde</th><th>Aftale</th><th>Besked</th><th>Modtaget</th><th>Status</th></tr></thead><tbody>
      ${reqs.map(({ c, r }) => { const a = c.D.agreements.find(x => x.id === r.agreement_id); return `<tr><td>${esc(c.org.name)}</td><td>${a ? esc(a.title) : '<span class="muted">Generel gennemgang</span>'}</td><td>${esc(r.message || '')}</td><td class="nowrap">${fmtDate(r.created_at)}</td>
      <td><select data-req="${r.id}" data-org="${c.org.id}" aria-label="Status">${['new', 'in_progress', 'done'].map(s => opt(s, reqStatus(s), r.status)).join('')}</select></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">Ingen henvendelser.</p>'}</div>
    <div class="card" style="margin-bottom:16px"><h2>Pipeline: frister de næste 9 måneder</h2>${pipeline.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Frist</th><th>Kunde</th><th>Aftale</th><th class="num">Årlig pris</th><th class="num">Potentiale</th><th class="num">Honorar (20 %)</th></tr></thead><tbody>
      ${pipeline.map(({ c, p }) => `<tr class="link" data-org-open="${c.org.id}" data-href="#/aftaler/${p.a.id}"><td class="nowrap">${fmtDate(p.dates.noticeDeadline)}<div class="sub">${esc(daysText(p.dates.daysToNotice))}</div></td><td>${esc(c.org.name)}</td><td>${esc(p.a.title)}<div class="sub">${esc(cat(p.a.category).label)}</div></td>
      <td class="num">${kr(p.cost)}</td><td class="num">${kr(p.est)}</td><td class="num">${kr(p.est * 0.2)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Ingen frister i perioden.</p>'}</div>
    <div class="card"><h2>Kunder</h2><div style="overflow-x:auto"><table><thead><tr><th>Kunde</th><th class="num">Aftaler</th><th class="num">Driftsudgift/år</th><th class="num">Potentiale/år</th><th class="num">Frister ≤ 9 mdr.</th><th></th></tr></thead><tbody>
      ${customers.map(c => `<tr><td>${esc(c.org.name)}<div class="sub">${esc(c.org.cvr || '')}</div></td><td class="num">${c.D.agreements.length}</td><td class="num">${kr(c.spend)}</td><td class="num">${kr(c.pot)}</td><td class="num">${c.soon.length}</td>
      <td><button class="btn btn-sm" data-action="openOrg" data-id="${c.org.id}">Åbn</button></td></tr>`).join('')}</tbody></table></div></div>`;
  }

  async function switchOrg(id, hash) {
    if (!S.orgs.some(o => o.id === id)) S.orgs = await S.store.listOrgs();
    S.org = S.orgs.find(o => o.id === id) || S.org;
    lsSet('cp_org', S.org.id);
    await loadOrg(); renderChrome();
    if (hash && location.hash !== hash) location.hash = hash; else route(true);
  }

  function requestForm(agreementId) {
    const a = agreementId && agr(agreementId);
    openModal('Bed Core Partners om en vurdering', `<form id="mform">
      <p class="small muted" style="margin-bottom:12px">${a ? `Vi kigger på „${esc(a.title)}“ og vender tilbage med en vurdering af besparelsespotentialet.` : 'Vi gennemgår jeres aftaleportefølje og vender tilbage med de største besparelsesmuligheder.'} No Cure No Pay: I betaler kun 20 % af første års dokumenterede besparelse.</p>
      <label class="field"><span>Besked (valgfri)</span><textarea name="message" placeholder="F.eks. ønsket tidspunkt, kontaktperson eller særlige forhold"></textarea></label>
      <div class="form-actions"><div class="right"><button type="button" class="btn" data-action="closeModal">Annullér</button><button class="btn btn-accent" type="submit">Send</button></div></div>
    </form>`, async o => {
      await S.store.upsert('review_requests', { id: uuid(), org_id: S.org.id, agreement_id: agreementId || null, message: o.message || null, status: 'new',
        created_by: S.store.mode === 'cloud' ? S.user.id : null });
      if (a && a.status === 'active') await S.store.upsert('agreements', { ...a, status: 'in_review' });
      closeModal(); toast('Tak! Core Partners vender tilbage.'); await reload();
    });
  }

  // ======================================================================
  // Handlinger
  // ======================================================================
  function confirmModal(title, text, label, fn) {
    openModal(title, `<form id="mform"><p style="margin-bottom:16px">${text}</p><div class="form-actions"><div class="right"><button type="button" class="btn" data-action="closeModal">Annullér</button><button class="btn btn-danger" type="submit">${label}</button></div></div></form>`,
      async () => { await fn(); closeModal(); });
  }

  const ACT = {
    closeModal,
    logout: async () => { await S.store.signOut(); location.reload(); },
    resetDemo: () => confirmModal('Nulstil demodata', 'Alle ændringer i demoen slettes og eksempeldata genindlæses.', 'Nulstil', async () => { S.store.reset(); S.orgs = await S.store.listOrgs(); S.org = S.orgs[0]; await loadOrg(); renderChrome(); location.hash = '#/overblik'; route(true); }),
    newAgreement: d => { if (d.prop) { agreementForm({ scope: 'property', category: 'other', auto_renew: true, renewal_months: 12, notice_months: 3, status: 'active' }); const cb = $(`[name="lp_${d.prop}"]`); if (cb) cb.checked = true; } else agreementForm(null, d.parent); },
    editAgreement: d => agreementForm(agr(d.id)),
    deleteAgreement: d => confirmModal('Slet aftale', `Vil du slette „${esc(agr(d.id).title)}“? Tilknyttede dokumenter slettes også.`, 'Slet', async () => {
      const a = agr(d.id);
      for (const doc of S.D.documents.filter(x => x.agreement_id === a.id)) await S.store.remove('documents', doc);
      await S.store.remove('agreements', a); await loadOrg(); location.hash = '#/aftaler'; toast('Aftalen er slettet');
    }),
    newProperty: () => propertyForm(),
    editProperty: d => propertyForm(prop(d.id)),
    deleteProperty: d => confirmModal('Slet ejendom', `Vil du slette „${esc(prop(d.id).name)}“? Aftalerne bevares, men mister koblingen til ejendommen.`, 'Slet', async () => {
      await S.store.remove('properties', prop(d.id)); await loadOrg(); location.hash = '#/ejendomme'; toast('Ejendommen er slettet');
    }),
    newPortfolio: () => portfolioForm(),
    editPortfolio: d => portfolioForm(pfById(d.id)),
    deletePortfolio: d => confirmModal('Slet portefølje', `Vil du slette „${esc(pfById(d.id).name)}“? Ejendomme og aftaler bevares.`, 'Slet', async () => {
      await S.store.remove('portfolios', pfById(d.id)); await loadOrg(); location.hash = '#/portefoljer';
    }),
    startTender: d => tenderForm(null, d.id),
    newTender: () => tenderForm(),
    editTender: d => tenderForm(S.D.tenders.find(x => x.id === d.id)),
    deleteTender: d => confirmModal('Slet udbud', 'Vil du slette udbuddet med tjekliste og tilbud?', 'Slet', async () => {
      const x = S.D.tenders.find(t => t.id === d.id); const a = x.agreement_id && agr(x.agreement_id);
      await S.store.remove('tenders', x);
      if (a && a.status === 'in_tender') await S.store.upsert('agreements', { ...a, status: 'active' });
      await loadOrg(); location.hash = '#/udbud';
    }),
    tenderStatus: async d => {
      const x = S.D.tenders.find(t => t.id === d.id);
      if (d.status === 'awarded') { toast('Tildel via knappen ved det valgte tilbud.'); return; }
      await S.store.upsert('tenders', { ...x, status: d.status });
      const a = x.agreement_id && agr(x.agreement_id);
      if (a && d.status === 'cancelled' && a.status === 'in_tender') await S.store.upsert('agreements', { ...a, status: 'active' });
      if (a && d.status !== 'cancelled' && a.status !== 'in_tender' && x.status === 'cancelled') await S.store.upsert('agreements', { ...a, status: 'in_tender' });
      await reload();
    },
    addBid: d => bidForm(S.D.tenders.find(t => t.id === d.id)),
    removeBid: async d => { const x = S.D.tenders.find(t => t.id === d.id); await S.store.upsert('tenders', { ...x, bids: x.bids.filter(b => b.id !== d.bid) }); await reload(); },
    award: d => { const x = S.D.tenders.find(t => t.id === d.id); awardForm(x, x.bids.find(b => b.id === d.bid)); },
    requestReview: d => requestForm(d.id),
    sort: d => { if (S.sort.key === d.key) S.sort.dir *= -1; else S.sort = { key: d.key, dir: d.key === 'cost' ? -1 : 1 }; route(false); },
    exportAgreements: () => download('aftaler.csv', C.toCSV(S.D.agreements, AG_COLS.concat([
      ['næste_frist', a => C.isoDate(datesOf(a).noticeDeadline)], ['anbefalet_udbudsstart', a => C.isoDate(datesOf(a).tenderStart)],
      ['estimeret_besparelse', a => Math.round(C.countedCost(a, S.D) * C.potentialPct(a) / 100)]])), 'text/csv;charset=utf-8'),
    exportProperties: () => download('ejendomme.csv', C.toCSV(S.D.properties, PROP_COLS), 'text/csv;charset=utf-8'),
    template: d => {
      if (d.type === 'properties') download('skabelon_ejendomme.csv', C.toCSV([{ name: 'Havnegade 12', address: 'Havnegade 12', postal_code: '2300', city: 'København S', region: 'Region Hovedstaden', property_type: 'Bolig', area_m2: 6400, units: 72, _pf: 'Bolig Øst' }],
        PROP_COLS.map(c => c[0] === 'portefølje' ? [c[0], r => r._pf] : c)), 'text/csv;charset=utf-8');
      else download('skabelon_aftaler.csv', '\uFEFF' + AG_COLS.map(c => c[0]).join(';') + '\r\n' +
        'Rengøring Havnegade;Rengøring;CleanCity ApS;Jens Hansen 12345678;Ejendom;;Region Hovedstaden;Havnegade 12;;185000;01-01-2023;31-12-2025;;3;ja;12;Nettoprisindeks;01-01-2024;01-10-2022;Aktiv;\r\n' +
        'Forsikring Bolig Øst;Forsikring;Nordisk Forsikring;;Portefølje;Bolig Øst;;;;612000;01-01-2021;31-12-2025;;3;ja;12;;;;Aktiv;\r\n', 'text/csv;charset=utf-8');
    },
    exportIcs: icsExport,
    exportJson: () => download(`aftaleoverblik-${C.isoDate(today())}.json`, JSON.stringify({ version: 1, exported_at: new Date().toISOString(), org: S.org, data: S.D }, null, 2), 'application/json'),
    openDoc: async d => { const doc = S.D.documents.find(x => x.id === d.id); const url = await S.store.documentUrl(doc); if (url) window.open(url, '_blank', 'noopener'); },
    deleteDoc: d => confirmModal('Slet dokument', 'Vil du slette dokumentet?', 'Slet', async () => { await S.store.remove('documents', S.D.documents.find(x => x.id === d.id)); await reload(); }),
    removeMember: d => confirmModal('Fjern bruger', 'Brugeren mister adgangen til organisationen.', 'Fjern', async () => { await S.store.removeMember(S.org.id, d.id); await reload(); }),
    removeInvite: async d => { await S.store.removeInvitation(d.id); await reload(); },
    openOrg: d => switchOrg(d.id, '#/overblik')
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el) {
      if (el.tagName === 'A') e.preventDefault();
      const fn = ACT[el.dataset.action];
      if (fn) guard(() => fn({ ...el.dataset }, el));
      return;
    }
    const row = e.target.closest('[data-href]');
    if (row && !e.target.closest('a,button,input,select,label')) {
      if (row.dataset.orgOpen && row.dataset.orgOpen !== S.org.id) { guard(() => switchOrg(row.dataset.orgOpen, row.dataset.href)); return; }
      location.hash = row.dataset.href;
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
    if (e.key === 'Enter' && e.target.matches('[data-href][tabindex]')) location.hash = e.target.dataset.href;
  });

  let qTimer;
  document.addEventListener('input', e => {
    const f = e.target.dataset && e.target.dataset.filter;
    if (f === 'q') {
      S.f.q = e.target.value; clearTimeout(qTimer);
      qTimer = setTimeout(() => { const pos = e.target.selectionStart; route(false).then(() => { const i = $('[data-filter="q"]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }); }, 180);
    }
  });
  document.addEventListener('change', e => {
    const t = e.target, ds = t.dataset || {};
    if (ds.filter && ds.filter !== 'q') { S.f[ds.filter] = t.value; route(false); return; }
    if (ds.change === 'scopeFields') return scopeFields();
    if (ds.change === 'catHint') { const i = $('#potInput'); if (i) i.placeholder = `Standard: ${cat(t.value).potential} %`; return; }
    if (ds.change === 'tlMonths') { S.tlMonths = Number(t.value); route(false); return; }
    if (ds.change === 'prioPf') { S.prioPf = t.value; route(false); return; }
    if (ds.change === 'demoAdmin') { S.store.setDemoAdmin(t.checked); S.profile.is_cp_admin = t.checked; renderChrome(); return; }
    if (t.id === 'orgSelect') return guard(() => switchOrg(t.value, '#/overblik'));
    if (ds.check) return guard(async () => {
      const x = S.D.tenders.find(y => y.id === ds.tender);
      await S.store.upsert('tenders', { ...x, checklist: { ...x.checklist, [ds.check]: t.checked } });
      await reload();
    });
    if (ds.role) return guard(async () => { await S.store.setMemberRole(S.org.id, ds.role, t.value); toast('Rolle opdateret'); await reload(); });
    if (ds.req) return guard(async () => {
      const all = await S.store.loadAll(); const c = all.find(x => x.org.id === ds.org); const r = c && c.D.requests.find(x => x.id === ds.req);
      if (r) { await S.store.upsert('review_requests', { ...r, status: t.value }); toast('Status opdateret'); }
    });
    if (ds.upload) return guard(async () => {
      for (const file of t.files) await S.store.uploadDocument(S.org.id, ds.upload, file);
      toast('Dokument uploadet'); await reload();
    });
    if (ds.import) return guard(async () => {
      const file = t.files[0]; if (!file) return;
      if (ds.import === 'json') {
        const j = JSON.parse(await file.text());
        if (!j.data || !Array.isArray(j.data.agreements)) throw new Error('Ugyldig backupfil.');
        await S.store.restore(S.org.id, j.data); await reload(); toast('Backup gendannet'); return;
      }
      const msg = await importCsv(ds.import, file);
      t.value = ''; await reload(); toast(msg);
    });
  });
  document.addEventListener('submit', e => {
    const form = e.target;
    e.preventDefault();
    if (form.id === 'mform' && modalSubmit) {
      const btn = form.querySelector('[type=submit]'); if (btn) btn.disabled = true;
      guard(() => modalSubmit(formObj(form), form)).finally(() => { if (btn && document.contains(btn)) btn.disabled = false; });
      return;
    }
    const o = formObj(form);
    if (form.id === 'loginForm') return guard(async () => {
      const { error } = await S.store.sb.auth.signInWithOtp({ email: o.email, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw new Error(error.message);
      $('#loginMsg').textContent = `Vi har sendt et login-link til ${o.email}. Åbn det i denne browser.`;
    });
    if (form.id === 'orgForm') return guard(async () => { const id = await S.store.createOrg(o.name, o.cvr); lsSet('cp_org', id); await start(); });
    if (form.dataset.form === 'org') return guard(async () => {
      const upd = { ...S.org, name: o.name, cvr: o.cvr || null, tender_lead_months: Math.min(24, Math.max(1, parseInt(o.tender_lead_months, 10) || 6)) };
      await S.store.updateOrg(upd); Object.assign(S.org, upd); renderChrome(); toast('Gemt'); route(false);
    });
    if (form.dataset.form === 'invite') return guard(async () => { await S.store.invite(S.org.id, o.email, o.role); toast('Invitation sendt til ' + o.email); await reload(); });
    if (form.dataset.form === 'newOrg') return guard(async () => { const id = await S.store.createOrg(o.name, o.cvr); S.orgs = await S.store.listOrgs(); await switchOrg(id, '#/overblik'); });
  });

  boot();
})();
