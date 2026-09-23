// Datalag med samme interface for demo-tilstand (localStorage) og Supabase.
(function (global) {
  'use strict';
  const { isoDate, addMonths, todayDate } = global.CPCore;

  const ORG_TABLES = ['portfolios', 'properties', 'agreements', 'agreement_properties', 'tenders', 'documents', 'review_requests'];
  const uuid = () => (global.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });

  function emptyBag() {
    return { portfolios: [], properties: [], agreements: [], links: [], tenders: [], documents: [], requests: [], members: [], invitations: [] };
  }
  function toBag(rows) {
    return {
      portfolios: rows.portfolios || [], properties: rows.properties || [], agreements: rows.agreements || [],
      links: rows.agreement_properties || [], tenders: rows.tenders || [], documents: rows.documents || [],
      requests: rows.review_requests || [], members: rows.members || [], invitations: rows.invitations || []
    };
  }

  // =========================================================================
  // Demo
  // =========================================================================
  const LS_KEY = 'cp_platform_demo_v1';

  function seed() {
    const t = todayDate();
    const d = (m, day) => { const x = addMonths(t, m); if (day) x.setDate(day); return isoDate(x); };
    const org = { id: uuid(), name: 'Demo Ejendomme A/S', cvr: '12345678', tender_lead_months: 6, created_at: new Date().toISOString() };
    const o = org.id;
    const pf = (name, description) => ({ id: uuid(), org_id: o, name, description });
    const pOst = pf('Bolig Øst', 'Boligejendomme i Storkøbenhavn');
    const pJyl = pf('Erhverv Jylland', 'Kontor- og lagerejendomme i Jylland');
    const pr = (portfolio, name, address, postal_code, city, region, property_type, area_m2, units) =>
      ({ id: uuid(), org_id: o, portfolio_id: portfolio && portfolio.id, name, address, postal_code, city, region, property_type, area_m2, units });
    const P = [
      pr(pOst, 'Havnegade 12', 'Havnegade 12', '2300', 'København S', 'Region Hovedstaden', 'Bolig', 6400, 72),
      pr(pOst, 'Parkvej 4', 'Parkvej 4', '2800', 'Kongens Lyngby', 'Region Hovedstaden', 'Bolig', 4100, 44),
      pr(pOst, 'Søborg Hovedgade 88', 'Søborg Hovedgade 88', '2860', 'Søborg', 'Region Hovedstaden', 'Blandet', 3200, 28),
      pr(pJyl, 'Åboulevarden 20', 'Åboulevarden 20', '8000', 'Aarhus C', 'Region Midtjylland', 'Kontor', 5200, 14),
      pr(pJyl, 'Industrivej 7', 'Industrivej 7', '8600', 'Silkeborg', 'Region Midtjylland', 'Lager', 8800, 3),
      pr(pJyl, 'Vesterbro 101', 'Vesterbro 101', '9000', 'Aalborg', 'Region Nordjylland', 'Kontor', 2600, 9)
    ];
    const ag = x => Object.assign({ id: uuid(), org_id: o, scope: 'property', auto_renew: true, renewal_months: 12, notice_months: 3,
      status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, x);
    const A = {
      ins: ag({ title: 'Ejendomsforsikring Bolig Øst', category: 'insurance', supplier: 'Nordisk Ejendomsforsikring', scope: 'portfolio', portfolio_id: pOst.id,
        annual_cost: 612000, start_date: d(-50, 1), end_date: d(4, 1), notice_months: 3, indexation: 'Byggeomkostningsindeks', indexation_date: d(4, 1) }),
      insJ: ag({ title: 'Erhvervsforsikring Jylland', category: 'insurance', supplier: 'Vestjysk Forsikring', scope: 'portfolio', portfolio_id: pJyl.id,
        annual_cost: 388000, start_date: d(-20, 1), end_date: d(16, 1), notice_months: 3, last_tendered: d(-20, 1) }),
      clean: ag({ title: 'Rammeaftale rengøring Hovedstaden', category: 'cleaning', supplier: 'CleanCity ApS', scope: 'framework', region: 'Region Hovedstaden',
        annual_cost: 486000, start_date: d(-30, 1), end_date: d(6, 1), notice_months: 6, auto_renew: true, indexation: 'Nettoprisindeks', indexation_date: d(-9, 1) }),
      cleanA: ag({ title: 'Rengøring Åboulevarden', category: 'cleaning', supplier: 'Aarhus Rent', annual_cost: 214000, start_date: d(-44, 1), notice_months: 3, auto_renew: false }),
      cleanS: ag({ title: 'Rengøring Industrivej', category: 'cleaning', supplier: 'Midtjysk Service', annual_cost: 96000, start_date: d(-26, 1), end_date: d(-2, 1), notice_months: 3 }),
      el1: ag({ title: 'Elevatorservice Havnegade', category: 'elevator', supplier: 'LiftTeknik A/S', annual_cost: 142000, start_date: d(-60, 1), end_date: d(8, 1), notice_months: 6, indexation: 'Lønindeks', indexation_date: d(2, 1), status: 'in_tender' }),
      el2: ag({ title: 'Elevatorservice Parkvej', category: 'elevator', supplier: 'Nordic Elevator', annual_cost: 68000, start_date: d(-38, 1), end_date: d(10, 1), notice_months: 6 }),
      el3: ag({ title: 'Elevatorservice Søborg', category: 'elevator', supplier: 'LiftTeknik A/S', annual_cost: 54000, start_date: d(-14, 1), end_date: d(22, 1), notice_months: 6, auto_renew: false }),
      care: ag({ title: 'Ejendomsservice Bolig Øst', category: 'caretaker', supplier: 'Byens Vicevært', scope: 'portfolio', portfolio_id: pOst.id,
        annual_cost: 940000, start_date: d(-72, 1), end_date: d(12, 1), notice_months: 6, renewal_months: 24, indexation: 'Lønindeks', indexation_date: d(3, 1) }),
      winter: ag({ title: 'Rammeaftale vintertjeneste Midtjylland', category: 'winter', supplier: 'Jysk Snerydning', scope: 'framework', region: 'Region Midtjylland',
        annual_cost: 118000, start_date: d(-8, 1), end_date: d(28, 1), notice_months: 3, last_tendered: d(-8, 1), auto_renew: false }),
      waste: ag({ title: 'Affaldshåndtering Aalborg', category: 'waste', supplier: 'Nordjysk Genbrug', annual_cost: 58000, start_date: d(-30, 1), end_date: d(1, 15), notice_months: 1 }),
      vent: ag({ title: 'Ventilationsservice Åboulevarden', category: 'ventilation', supplier: 'Klimaservice Øst', annual_cost: 76000, start_date: d(-26, 1), binding_until: d(7, 1), notice_months: 3, auto_renew: false }),
      fire: ag({ title: 'ABA/ADK serviceaftale', category: 'fire', supplier: 'Sikring Danmark', scope: 'portfolio', portfolio_id: pOst.id, annual_cost: 84000, start_date: d(-48, 1), end_date: d(5, 1), notice_months: 3 }),
      it: ag({ title: 'Internet og fællesantenne', category: 'it', supplier: 'Bredbånd Nord', annual_cost: 132000, start_date: d(-54, 1), end_date: d(2, 1), notice_months: 1, renewal_months: 12 }),
      energy: ag({ title: 'Elaftale fastpris', category: 'energy', supplier: 'Grøn Strøm A/S', annual_cost: 720000, start_date: d(-6, 1), end_date: d(30, 1), notice_months: 3, auto_renew: false, last_tendered: d(-6, 1) }),
      green: ag({ title: 'Grønne områder Havnegade', category: 'green', supplier: 'Havemanden', annual_cost: 64000, start_date: d(-36, 1), end_date: d(-1, 1), notice_months: 3, status: 'terminated' })
    };
    // Leveranceaftaler under vinterrammen
    const wA = ag({ title: 'Vintertjeneste Åboulevarden', category: 'winter', supplier: 'Jysk Snerydning', parent_agreement_id: A.winter.id, annual_cost: 42000, start_date: d(-8, 1), end_date: d(28, 1), notice_months: 3, auto_renew: false, last_tendered: d(-8, 1) });
    const wI = ag({ title: 'Vintertjeneste Industrivej', category: 'winter', supplier: 'Jysk Snerydning', parent_agreement_id: A.winter.id, annual_cost: 76000, start_date: d(-8, 1), end_date: d(28, 1), notice_months: 3, auto_renew: false, last_tendered: d(-8, 1) });
    const agreements = [...Object.values(A), wA, wI];
    const link = (a, p, cost_share) => ({ agreement_id: a.id, property_id: p.id, org_id: o, cost_share: cost_share == null ? null : cost_share });
    const links = [
      link(A.clean, P[0], 228000), link(A.clean, P[1], 146000), link(A.clean, P[2], 112000),
      link(A.cleanA, P[3]), link(A.cleanS, P[4]), link(A.el1, P[0]), link(A.el2, P[1]), link(A.el3, P[2]),
      link(A.winter, P[3]), link(A.winter, P[4]), link(wA, P[3]), link(wI, P[4]),
      link(A.waste, P[5]), link(A.vent, P[3]), link(A.it, P[0], 70000), link(A.it, P[1], 38000), link(A.it, P[2], 24000),
      link(A.energy, P[0]), link(A.energy, P[1]), link(A.energy, P[2]), link(A.energy, P[3]), link(A.energy, P[4]), link(A.energy, P[5]),
      link(A.green, P[0])
    ];
    const tenders = [{
      id: uuid(), org_id: o, agreement_id: A.el1.id, title: 'Udbud: elevatorservice Hovedstaden', status: 'out',
      planned_start: d(-2, 1), bid_deadline: d(0, 28), decision_date: d(1, 20), price_weight: 60, baseline_cost: 264000,
      checklist: { contract_found: true, spend_data: true, legal: true, scope: true, stakeholders: true, spec: true, quantities: true, pricelist: true, terms: true, criteria: true, invited: true },
      bids: [
        { id: uuid(), supplier: 'LiftTeknik A/S', price: 238000, quality: 7, note: 'Nuværende leverandør' },
        { id: uuid(), supplier: 'Nordic Elevator', price: 204000, quality: 8, note: '' },
        { id: uuid(), supplier: 'Elevatorgruppen', price: 196000, quality: 6, note: 'Længere responstid' }
      ],
      notes: 'Samler de tre elevatoraftaler i Bolig Øst i ét udbud.', created_at: new Date().toISOString()
    }];
    const requests = [{ id: uuid(), org_id: o, agreement_id: A.care.id, message: 'Kan I se på ejendomsservice inden fristen?', status: 'new', created_at: new Date().toISOString() }];
    return {
      orgs: [org],
      rows: { [o]: { portfolios: [pOst, pJyl], properties: P, agreements, agreement_properties: links, tenders, documents: [], review_requests: requests } }
    };
  }

  class LocalStore {
    constructor() { this.mode = 'demo'; }
    _load() {
      try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && s.orgs) return s; } catch (e) { /* tomt eller blokeret */ }
      const s = seed(); this._save(s); return s;
    }
    _save(s) { this._mem = s; try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* kun i hukommelsen */ } }
    _db() { if (!this._mem) this._mem = this._load(); return this._mem; }
    async init() {
      let admin = false;
      try { admin = localStorage.getItem('cp_demo_admin') === '1'; } catch (e) { /* ignore */ }
      return { user: { id: 'demo-user', email: 'demo@kunde.dk' }, profile: { id: 'demo-user', email: 'demo@kunde.dk', is_cp_admin: admin } };
    }
    setDemoAdmin(on) { try { localStorage.setItem('cp_demo_admin', on ? '1' : '0'); } catch (e) { /* ignore */ } }
    reset() { try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ } this._mem = null; }
    async listOrgs() { return this._db().orgs.map(o => ({ ...o, role: 'owner' })); }
    async createOrg(name, cvr) {
      const db = this._db(); const org = { id: uuid(), name, cvr, tender_lead_months: 6, created_at: new Date().toISOString() };
      db.orgs.push(org); db.rows[org.id] = Object.fromEntries(ORG_TABLES.map(t => [t, []])); this._save(db); return org.id;
    }
    async updateOrg(org) { const db = this._db(); const i = db.orgs.findIndex(o => o.id === org.id); db.orgs[i] = { ...db.orgs[i], ...org }; this._save(db); }
    async loadOrg(orgId) {
      const rows = JSON.parse(JSON.stringify(this._db().rows[orgId] || {}));
      rows.members = [{ user_id: 'demo-user', email: 'demo@kunde.dk', role: 'owner' }];
      rows.invitations = [];
      return toBag(rows);
    }
    async loadAll() {
      const db = this._db();
      return db.orgs.map(o => ({ org: o, D: toBag(JSON.parse(JSON.stringify(db.rows[o.id] || {}))) }));
    }
    _rows(table, orgId) { const db = this._db(); db.rows[orgId] = db.rows[orgId] || {}; return (db.rows[orgId][table] = db.rows[orgId][table] || []); }
    async upsert(table, row) {
      const db = this._db(); const list = this._rows(table, row.org_id);
      if (!row.id) row.id = uuid();
      if (table === 'agreements') row.updated_at = new Date().toISOString();
      if (!row.created_at) row.created_at = new Date().toISOString();
      const i = list.findIndex(r => r.id === row.id);
      if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
      this._save(db); return row;
    }
    async upsertMany(table, rows) { for (const r of rows) await this.upsert(table, r); }
    async remove(table, row) {
      const db = this._db(); const list = this._rows(table, row.org_id);
      const i = list.findIndex(r => r.id === row.id); if (i >= 0) list.splice(i, 1);
      if (table === 'agreements') {
        db.rows[row.org_id].agreement_properties = this._rows('agreement_properties', row.org_id).filter(l => l.agreement_id !== row.id);
        this._rows('agreements', row.org_id).forEach(a => { if (a.parent_agreement_id === row.id) a.parent_agreement_id = null; });
        db.rows[row.org_id].documents = this._rows('documents', row.org_id).filter(x => x.agreement_id !== row.id);
        db.rows[row.org_id].review_requests = this._rows('review_requests', row.org_id).filter(x => x.agreement_id !== row.id);
        this._rows('tenders', row.org_id).forEach(t => { if (t.agreement_id === row.id) t.agreement_id = null; });
      }
      if (table === 'properties') {
        db.rows[row.org_id].agreement_properties = this._rows('agreement_properties', row.org_id).filter(l => l.property_id !== row.id);
      }
      if (table === 'portfolios') {
        this._rows('properties', row.org_id).forEach(p => { if (p.portfolio_id === row.id) p.portfolio_id = null; });
        this._rows('agreements', row.org_id).forEach(a => { if (a.portfolio_id === row.id) a.portfolio_id = null; });
      }
      this._save(db);
    }
    async replaceLinks(orgId, agreementId, links) {
      const db = this._db();
      db.rows[orgId].agreement_properties = this._rows('agreement_properties', orgId).filter(l => l.agreement_id !== agreementId).concat(links);
      this._save(db);
    }
    async restore(orgId, bag) {
      const db = this._db();
      db.rows[orgId] = { portfolios: bag.portfolios, properties: bag.properties, agreements: bag.agreements, agreement_properties: bag.links,
        tenders: bag.tenders, documents: [], review_requests: bag.requests || [] };
      ORG_TABLES.forEach(t => (db.rows[orgId][t] || []).forEach(r => { r.org_id = orgId; }));
      this._save(db);
    }
    async invite() { throw new Error('Invitationer kræver at platformen er forbundet til Supabase.'); }
    async removeMember() { throw new Error('Ikke tilgængelig i demo-tilstand.'); }
    async uploadDocument() { throw new Error('Upload af dokumenter kræver at platformen er forbundet til Supabase.'); }
    async documentUrl() { return null; }
    async signOut() { /* demo */ }
  }

  // =========================================================================
  // Supabase
  // =========================================================================
  class SupabaseStore {
    constructor(sb) { this.sb = sb; this.mode = 'cloud'; }
    _chk({ data, error }) { if (error) throw new Error(error.message); return data; }
    async init() {
      const { data: { session } } = await this.sb.auth.getSession();
      if (!session) return null;
      this.user = session.user;
      await this.sb.rpc('accept_invitations');
      let profile = this._chk(await this.sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
      if (!profile) profile = { id: session.user.id, email: session.user.email, is_cp_admin: false };
      return { user: session.user, profile };
    }
    async listOrgs() {
      const orgs = this._chk(await this.sb.from('organizations').select('*').order('name'));
      const mem = this._chk(await this.sb.from('memberships').select('org_id, role').eq('user_id', this.user.id));
      return orgs.map(o => ({ ...o, role: (mem.find(m => m.org_id === o.id) || {}).role || 'admin' }));
    }
    async createOrg(name, cvr) { return this._chk(await this.sb.rpc('create_organization', { p_name: name, p_cvr: cvr || null })); }
    async updateOrg(org) { this._chk(await this.sb.from('organizations').update({ name: org.name, cvr: org.cvr, tender_lead_months: org.tender_lead_months }).eq('id', org.id)); }
    async _fetch(table, orgId) {
      const all = []; const size = 1000;
      for (let from = 0; ; from += size) {
        let q = this.sb.from(table).select('*').range(from, from + size - 1);
        if (orgId) q = q.eq('org_id', orgId);
        const rows = this._chk(await q);
        all.push(...rows);
        if (rows.length < size) break;
      }
      return all;
    }
    async loadOrg(orgId) {
      const res = await Promise.all(ORG_TABLES.map(t => this._fetch(t, orgId)));
      const rows = Object.fromEntries(ORG_TABLES.map((t, i) => [t, res[i]]));
      const mem = this._chk(await this.sb.from('memberships').select('user_id, role').eq('org_id', orgId));
      const ids = mem.map(m => m.user_id);
      const profs = ids.length ? this._chk(await this.sb.from('profiles').select('id, email, full_name').in('id', ids)) : [];
      rows.members = mem.map(m => ({ ...m, email: (profs.find(p => p.id === m.user_id) || {}).email || '(ukendt)' }));
      const inv = await this.sb.from('invitations').select('*').eq('org_id', orgId);
      rows.invitations = inv.error ? [] : inv.data;
      return toBag(rows);
    }
    async loadAll() {
      const orgs = this._chk(await this.sb.from('organizations').select('*').order('name'));
      const res = await Promise.all(ORG_TABLES.map(t => this._fetch(t)));
      return orgs.map(o => {
        const rows = Object.fromEntries(ORG_TABLES.map((t, i) => [t, res[i].filter(r => r.org_id === o.id)]));
        return { org: o, D: toBag(rows) };
      });
    }
    _clean(row) {
      const r = { ...row };
      ['created_at', 'updated_at'].forEach(k => { if (r[k] == null) delete r[k]; });
      return r;
    }
    async upsert(table, row) {
      if (!row.id) row.id = uuid();
      return this._chk(await this.sb.from(table).upsert(this._clean(row)).select().single());
    }
    async upsertMany(table, rows) {
      if (!rows.length) return;
      rows.forEach(r => { if (!r.id && table !== 'agreement_properties') r.id = uuid(); });
      for (let i = 0; i < rows.length; i += 500) this._chk(await this.sb.from(table).upsert(rows.slice(i, i + 500).map(r => this._clean(r))));
    }
    async remove(table, row) {
      if (table === 'documents' && row.storage_path) await this.sb.storage.from('documents').remove([row.storage_path]);
      this._chk(await this.sb.from(table).delete().eq('id', row.id));
    }
    async replaceLinks(orgId, agreementId, links) {
      this._chk(await this.sb.from('agreement_properties').delete().eq('agreement_id', agreementId));
      if (links.length) this._chk(await this.sb.from('agreement_properties').insert(links));
    }
    async restore() { throw new Error('Gendannelse fra backup er kun tilgængelig i demo-tilstand. Brug CSV-import.'); }
    async invite(orgId, email, role) {
      this._chk(await this.sb.from('invitations').upsert({ org_id: orgId, email: email.toLowerCase(), role }, { onConflict: 'org_id,email' }));
      // Sender et login-link til den inviterede; invitationen accepteres automatisk ved første login.
      const r = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
      if (r.error) throw new Error('Invitation gemt, men e-mail kunne ikke sendes: ' + r.error.message);
    }
    async removeInvitation(id) { this._chk(await this.sb.from('invitations').delete().eq('id', id)); }
    async removeMember(orgId, userId) { this._chk(await this.sb.from('memberships').delete().eq('org_id', orgId).eq('user_id', userId)); }
    async setMemberRole(orgId, userId, role) { this._chk(await this.sb.from('memberships').update({ role }).eq('org_id', orgId).eq('user_id', userId)); }
    async uploadDocument(orgId, agreementId, file) {
      const safe = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `${orgId}/${agreementId}/${Date.now()}_${safe}`;
      this._chk(await this.sb.storage.from('documents').upload(path, file, { upsert: false }));
      return this.upsert('documents', { org_id: orgId, agreement_id: agreementId, name: file.name, storage_path: path, size: file.size, uploaded_by: this.user.id });
    }
    async documentUrl(doc) {
      const { data, error } = await this.sb.storage.from('documents').createSignedUrl(doc.storage_path, 300);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    }
    async signOut() { await this.sb.auth.signOut(); }
  }

  global.CPStore = { LocalStore, SupabaseStore, emptyBag, uuid };
})(window);
