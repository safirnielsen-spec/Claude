// Domænelogik: kategorier, frister, prioritering, omkostningsfordeling og konsolidering.
// Rene funktioner uden DOM-afhængigheder, så de kan testes isoleret.
(function (global) {
  'use strict';

  // potential = typisk besparelse i % ved genudbud/genforhandling (erfaringstal, kan overskrives pr. aftale)
  const CATEGORIES = [
    { key: 'insurance',   label: 'Forsikring',             icon: 'fa-shield-halved',   potential: 15 },
    { key: 'cleaning',    label: 'Rengøring',              icon: 'fa-broom',           potential: 15 },
    { key: 'caretaker',   label: 'Ejendomsservice',        icon: 'fa-screwdriver-wrench', potential: 12 },
    { key: 'elevator',    label: 'Elevatorservice',        icon: 'fa-elevator',        potential: 20 },
    { key: 'ventilation', label: 'Ventilation/CTS',        icon: 'fa-fan',             potential: 12 },
    { key: 'fire',        label: 'Brand/ADK/sikring',      icon: 'fa-fire-extinguisher', potential: 12 },
    { key: 'waste',       label: 'Affald',                 icon: 'fa-recycle',         potential: 10 },
    { key: 'winter',      label: 'Vintertjeneste',         icon: 'fa-snowflake',       potential: 10 },
    { key: 'green',       label: 'Grønne områder',         icon: 'fa-seedling',        potential: 10 },
    { key: 'energy',      label: 'Energi',                 icon: 'fa-bolt',            potential: 6 },
    { key: 'it',          label: 'IT/tele/internet',       icon: 'fa-wifi',            potential: 15 },
    { key: 'admin',       label: 'Administration',         icon: 'fa-briefcase',       potential: 10 },
    { key: 'other',       label: 'Andet',                  icon: 'fa-file',            potential: 8 }
  ];
  const CAT = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

  const SCOPES = {
    property:  { label: 'Ejendomsspecifik', short: 'Ejendom' },
    portfolio: { label: 'Porteføljeaftale', short: 'Portefølje' },
    framework: { label: 'Regional rammeaftale', short: 'Rammeaftale' }
  };

  const STATUSES = {
    active:     { label: 'Aktiv',            tag: 'ok' },
    in_review:  { label: 'Under vurdering',  tag: 'info' },
    in_tender:  { label: 'I udbud',          tag: 'warn' },
    terminated: { label: 'Opsagt',           tag: '' },
    expired:    { label: 'Udløbet',          tag: '' }
  };

  const REGIONS = ['Region Hovedstaden', 'Region Sjælland', 'Region Syddanmark', 'Region Midtjylland', 'Region Nordjylland'];

  const TENDER_STATUSES = [
    { key: 'planning',    label: 'Planlægning' },
    { key: 'material',    label: 'Udbudsmateriale' },
    { key: 'out',         label: 'I udbud' },
    { key: 'evaluation',  label: 'Evaluering' },
    { key: 'negotiation', label: 'Forhandling' },
    { key: 'awarded',     label: 'Tildelt' },
    { key: 'cancelled',   label: 'Annulleret' }
  ];

  const CHECKLIST = [
    { key: 'prep', label: 'Forberedelse (6–9 mdr. før frist)', items: [
      ['contract_found', 'Kontrakt fundet og sidste opsigelsesdag beregnet'],
      ['spend_data', 'Faktiske udgifter for 12–24 måneder samlet (inkl. tillægsydelser)'],
      ['legal', 'Afklaret om udbudsloven/tilbudsloven gælder (almene/offentlige ejere) og om tærskelværdier rammes'],
      ['scope', 'Besluttet: ejendomsspecifik aftale, porteføljeaftale eller regional rammeaftale'],
      ['stakeholders', 'Drift, administrator og bestyrelse/ejer inddraget']
    ]},
    { key: 'material', label: 'Udbudsmateriale', items: [
      ['spec', 'Ydelsesbeskrivelse: omfang, frekvens, serviceniveau og responstider'],
      ['quantities', 'Mængdegrundlag pr. ejendom (m², anlæg, elevatorer, affaldsfraktioner mv.)'],
      ['pricelist', 'Sammenlignelig tilbudsliste med faste priser og enhedspriser for tillæg'],
      ['terms', 'Kontraktvilkår: løbetid, opsigelse, indeksregulering, bod, KPI’er og rapportering'],
      ['criteria', 'Tildelingskriterier og vægtning mellem pris og kvalitet fastlagt'],
      ['requirements', 'Krav til forsikring, miljø, arbejdsklausuler og sikkerhedsstillelse']
    ]},
    { key: 'execution', label: 'Gennemførelse', items: [
      ['invited', 'Mindst 3–5 relevante leverandører inviteret'],
      ['site_visit', 'Besigtigelse og spørgsmål/svar gennemført'],
      ['evaluated', 'Tilbud evalueret i en ensartet matrix'],
      ['negotiated', 'Forhandling med de 1–2 bedste tilbudsgivere'],
      ['terminated', 'Eksisterende aftale opsagt skriftligt inden fristen (kvittering gemt)']
    ]},
    { key: 'handover', label: 'Implementering', items: [
      ['signed', 'Ny kontrakt underskrevet og uploadet'],
      ['handover', 'Overdragelse til ny leverandør planlagt'],
      ['followup', 'Opfølgning efter 3 måneder på kvalitet og fakturering']
    ]}
  ];
  const CHECKLIST_COUNT = CHECKLIST.reduce((n, p) => n + p.items.length, 0);

  // ---------- datoer
  const pad = n => String(n).padStart(2, '0');
  function parseDate(s) {
    if (!s) return null;
    if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const isoDate = d => d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
  function todayDate() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function addMonths(d, m) {
    const y = d.getFullYear(), mo = d.getMonth() + m, day = d.getDate();
    const last = new Date(y, mo + 1, 0).getDate();
    return new Date(y, mo, Math.min(day, last));
  }
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);
  const isClosed = a => a.status === 'terminated' || a.status === 'expired';

  /**
   * Beregner næste relevante frister for en aftale.
   * kind: 'fixed' (fast udløb), 'renewing' (auto-forlængelse), 'binding' (løbende efter binding), 'running' (løbende uden udløb),
   *       'expired' (udløbet uden forlængelse), 'closed' (opsagt/udløbet status)
   */
  function agreementDates(a, today, leadMonths) {
    today = today || todayDate();
    leadMonths = leadMonths || 6;
    const notice = Number(a.notice_months) || 0;
    const binding = parseDate(a.binding_until);
    const end = parseDate(a.end_date);
    const res = { kind: 'fixed', termEnd: null, noticeDeadline: null, tenderStart: null, daysToNotice: null, missedCurrent: false };
    if (isClosed(a)) { res.kind = 'closed'; res.termEnd = end; return res; }

    if (!end) {
      if (binding && addMonths(binding, -notice) >= today) {
        res.kind = 'binding';
        res.termEnd = binding;
        res.noticeDeadline = addMonths(binding, -notice);
      } else {
        // Løbende aftale: kan opsiges når som helst med X måneders varsel.
        res.kind = 'running';
        res.termEnd = addMonths(today, notice);
      }
    } else {
      let termEnd = end;
      if (a.auto_renew && Number(a.renewal_months) > 0) {
        res.kind = 'renewing';
        let guard = 0;
        while (addMonths(termEnd, -notice) < today && guard++ < 200) {
          if (termEnd >= today) res.missedCurrent = true;
          termEnd = addMonths(termEnd, Number(a.renewal_months));
        }
        if (guard > 0 && termEnd > end) res.rolledFrom = end;
      } else if (termEnd < today) {
        res.kind = 'expired';
        res.termEnd = termEnd;
        return res;
      }
      if (binding && binding > termEnd) termEnd = binding;
      res.termEnd = termEnd;
      // Uden automatisk forlængelse er fristen selve udløbet: ny aftale skal være på plads.
      res.noticeDeadline = res.kind === 'fixed' ? termEnd : addMonths(termEnd, -notice);
    }
    res.deadlineLabel = res.kind === 'fixed' ? 'Aftalen udløber' : 'Sidste opsigelsesdag';
    if (res.noticeDeadline) {
      res.daysToNotice = daysBetween(today, res.noticeDeadline);
      res.tenderStart = addMonths(res.noticeDeadline, -leadMonths);
    }
    return res;
  }

  function nextIndexation(a, today) {
    const d = parseDate(a.indexation_date);
    if (!d) return null;
    let n = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    if (n < today) n = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
    return n;
  }

  function urgencyOf(dates) {
    if (dates.kind === 'running') return { f: 0.8, label: 'Kan opsiges løbende' };
    if (dates.kind === 'expired') return { f: 1, label: 'Udløbet – kører uden aftale' };
    const d = dates.daysToNotice;
    if (d == null) return { f: 0.3, label: 'Ingen frist registreret' };
    if (d < 0) return { f: 0.3, label: 'Frist overskredet' };
    if (d <= 90) return { f: 1, label: 'Frist inden for 3 mdr.' };
    if (d <= 180) return { f: 0.95, label: 'Frist inden for 6 mdr.' };
    if (d <= 365) return { f: 0.75, label: 'Frist inden for 12 mdr.' };
    if (d <= 548) return { f: 0.5, label: 'Frist inden for 18 mdr.' };
    return { f: 0.25, label: 'Frist om mere end 18 mdr.' };
  }

  function ageOf(a, today) {
    const ref = parseDate(a.last_tendered) || parseDate(a.start_date);
    if (!ref) return { f: 1, years: null, label: 'Aldrig udbudt/ukendt' };
    const years = daysBetween(ref, today) / 365.25;
    const label = a.last_tendered ? `Udbudt for ${Math.floor(years)} år siden` : `Uændret i ${Math.floor(years)} år`;
    if (years >= 3) return { f: 1, years, label };
    if (years >= 2) return { f: 0.85, years, label };
    if (years >= 1) return { f: 0.6, years, label };
    return { f: 0.35, years, label: 'Nyligt udbudt' };
  }

  // Aftaler under en rammeaftale bærer selv omkostningen, så rammeaftalens egen pris tælles ikke med.
  function hasChildren(a, D) { return D.agreements.some(c => c.parent_agreement_id === a.id && !isClosed(c)); }
  function countedCost(a, D) { return isClosed(a) || hasChildren(a, D) ? 0 : (Number(a.annual_cost) || 0); }
  function potentialPct(a) {
    return a.savings_potential_pct != null && a.savings_potential_pct !== '' ? Number(a.savings_potential_pct) : (CAT[a.category] || CAT.other).potential;
  }

  function coveredPropertyIds(a, D) {
    const ids = new Set(D.links.filter(l => l.agreement_id === a.id).map(l => l.property_id));
    if (a.scope === 'portfolio' && a.portfolio_id) D.properties.filter(p => p.portfolio_id === a.portfolio_id).forEach(p => ids.add(p.id));
    return [...ids].filter(id => D.properties.some(p => p.id === id));
  }

  /** Map property_id → kr./år. Faste andele bruges først, resten fordeles efter m² (eller ligeligt). */
  function allocation(a, D) {
    const out = new Map();
    const cost = countedCost(a, D);
    const ids = coveredPropertyIds(a, D);
    if (!ids.length || !cost) return out;
    const shares = new Map(D.links.filter(l => l.agreement_id === a.id && l.cost_share != null && l.cost_share !== '').map(l => [l.property_id, Number(l.cost_share)]));
    let rest = cost;
    shares.forEach((v, id) => { if (ids.includes(id)) { out.set(id, v); rest -= v; } });
    const open = ids.filter(id => !shares.has(id));
    if (open.length && rest > 0) {
      const w = open.map(id => Number((D.properties.find(p => p.id === id) || {}).area_m2) || 0);
      const tot = w.reduce((s, x) => s + x, 0);
      open.forEach((id, i) => out.set(id, rest * (tot > 0 ? w[i] / tot : 1 / open.length)));
    }
    return out;
  }

  function regionsOf(a, D) {
    if (a.region) return [a.region];
    const r = new Set(coveredPropertyIds(a, D).map(id => (D.properties.find(p => p.id === id) || {}).region).filter(Boolean));
    return [...r];
  }

  function priority(a, D, today, leadMonths) {
    const dates = agreementDates(a, today, leadMonths);
    const cost = countedCost(a, D);
    const pct = potentialPct(a);
    const est = cost * pct / 100;
    const u = urgencyOf(dates);
    const age = ageOf(a, today);
    const reasons = [u.label, age.label];
    if (a.indexation && age.years != null && age.years >= 2) reasons.push('Indeksreguleret uden genforhandling');
    if (a.status === 'in_tender') reasons.push('I udbud');
    const score = est * u.f * age.f;
    return { a, dates, cost, pct, est, score, reasons, urgency: u, age };
  }

  function priorities(D, today, leadMonths) {
    return D.agreements
      .filter(a => !isClosed(a) && a.status !== 'in_tender' && countedCost(a, D) > 0)
      .map(a => priority(a, D, today, leadMonths))
      .sort((x, y) => y.score - x.score);
  }

  /** Flere separate aftaler om samme ydelse i samme region → kandidat til rammeaftale. */
  function consolidation(D) {
    const groups = new Map();
    D.agreements.filter(a => !isClosed(a) && a.scope !== 'framework' && !a.parent_agreement_id).forEach(a => {
      regionsOf(a, D).forEach(r => {
        const k = a.category + '|' + r;
        if (!groups.has(k)) groups.set(k, { category: a.category, region: r, items: [] });
        groups.get(k).items.push(a);
      });
    });
    return [...groups.values()].filter(g => g.items.length >= 2).map(g => {
      const suppliers = new Set(g.items.map(a => (a.supplier || '').trim().toLowerCase()).filter(Boolean));
      const total = g.items.reduce((s, a) => s + countedCost(a, D), 0);
      return { ...g, suppliers: suppliers.size, total, est: total * 0.05 };
    }).sort((x, y) => y.total - x.total);
  }

  function timelineEvents(D, today, months, leadMonths) {
    const until = addMonths(today, months);
    const ev = [];
    D.agreements.filter(a => !isClosed(a)).forEach(a => {
      const d = agreementDates(a, today, leadMonths);
      const push = (date, type, label) => { if (date && date >= today && date <= until) ev.push({ date, type, label, a }); };
      if (d.tenderStart && a.status !== 'in_tender') push(d.tenderStart, 'tender', 'Anbefalet udbudsstart');
      if (d.kind === 'fixed') push(d.termEnd, 'notice', 'Aftalen udløber – ny aftale skal være på plads');
      else {
        push(d.noticeDeadline, 'notice', 'Sidste opsigelsesdag');
        if (d.kind !== 'running') push(d.termEnd, 'end', d.kind === 'renewing' ? 'Periode slutter (forlænges ellers)' : 'Binding udløber');
      }
      push(nextIndexation(a, today), 'index', 'Indeksregulering');
    });
    return ev.sort((x, y) => x.date - y.date);
  }

  function tenderScore(t) {
    const bids = (t.bids || []).filter(b => Number(b.price) > 0);
    if (!bids.length) return [];
    const min = Math.min(...bids.map(b => Number(b.price)));
    const pw = (Number(t.price_weight) || 60) / 100;
    return bids.map(b => {
      const priceScore = min / Number(b.price) * 10;
      const q = Number(b.quality) || 0;
      return { ...b, priceScore, total: priceScore * pw + q * (1 - pw) };
    }).sort((x, y) => y.total - x.total);
  }

  // ---------- CSV
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const nonEmpty = rows.filter(r => r.some(c => c.trim() !== ''));
    if (!nonEmpty.length) return [];
    const head = nonEmpty[0].map(h => h.trim().toLowerCase());
    return nonEmpty.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }
  function toCSV(rows, cols) {
    const q = v => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + [cols.map(c => q(c[0])).join(';'), ...rows.map(r => cols.map(c => q(c[1](r))).join(';'))].join('\r\n');
  }
  function parseNumber(s) {
    if (s == null) return null;
    s = String(s).trim().replace(/\s|kr\.?|dkk/gi, '');
    if (!s) return null;
    if (/,\d{1,2}$/.test(s) || (s.includes(',') && s.includes('.'))) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    else s = s.replace(',', '.');
    const n = Number(s);
    return isFinite(n) ? n : null;
  }
  function parseDateLoose(s) {
    if (!s) return null;
    s = String(s).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) return isoDate(new Date(+m[1], +m[2] - 1, +m[3]));
    m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/.exec(s);
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return isoDate(new Date(y, +m[2] - 1, +m[1])); }
    return null;
  }

  global.CPCore = {
    CATEGORIES, CAT, SCOPES, STATUSES, REGIONS, TENDER_STATUSES, CHECKLIST, CHECKLIST_COUNT,
    parseDate, isoDate, todayDate, addMonths, daysBetween, isClosed,
    agreementDates, nextIndexation, urgencyOf, ageOf, hasChildren, countedCost, potentialPct,
    coveredPropertyIds, allocation, regionsOf, priority, priorities, consolidation, timelineEvents, tenderScore,
    parseCSV, toCSV, parseNumber, parseDateLoose
  };
})(typeof window !== 'undefined' ? window : globalThis);
