// Supabase Edge Function: sender e-mailpåmindelser om kommende opsigelsesfrister.
// Køres dagligt via pg_cron (se supabase/schema.sql). Hver frist mailes højst én gang pr. tærskel.
//
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY   – API-nøgle til Resend (https://resend.com)
//   FROM_EMAIL       – afsender, f.eks. "Core Partners <frister@corepartners.dk>"
//   APP_URL          – adressen på platformen, f.eks. https://www.corepartners.dk/platform/
//   CP_ADMIN_EMAIL   – (valgfri) modtager af en samlet oversigt til Core Partners
// SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY sættes automatisk af Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const THRESHOLDS = [180, 90, 30, 7];

const parseDate = (s: string | null) => {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (d: Date, m: number) => {
  const y = d.getUTCFullYear(), mo = d.getUTCMonth() + m, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo, Math.min(day, last)));
};
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
const kr = (n: number) => new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 }).format(n) + " kr.";
const fmt = (d: Date) => d.toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// Samme regler som platform/core.js → agreementDates
function deadlineOf(a: any, today: Date): { date: Date; label: string } | null {
  if (a.status === "terminated" || a.status === "expired") return null;
  const notice = Number(a.notice_months) || 0;
  const binding = parseDate(a.binding_until);
  const end = parseDate(a.end_date);
  if (!end) {
    if (binding && addMonths(binding, -notice) >= today) return { date: addMonths(binding, -notice), label: "Sidste opsigelsesdag" };
    return null;
  }
  let termEnd = end;
  if (a.auto_renew && Number(a.renewal_months) > 0) {
    let guard = 0;
    while (addMonths(termEnd, -notice) < today && guard++ < 200) termEnd = addMonths(termEnd, Number(a.renewal_months));
    if (binding && binding > termEnd) termEnd = binding;
    return { date: addMonths(termEnd, -notice), label: "Sidste opsigelsesdag" };
  }
  if (termEnd < today) return null;
  if (binding && binding > termEnd) termEnd = binding;
  return { date: termEnd, label: "Aftalen udløber" };
}

async function sendMail(to: string[], subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("FROM_EMAIL"), to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (auth !== `Bearer ${serviceKey}`) return new Response("Unauthorized", { status: 401 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const appUrl = Deno.env.get("APP_URL") ?? "";
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [{ data: orgs }, { data: agreements }, { data: members }, { data: profiles }, { data: sent }] = await Promise.all([
    sb.from("organizations").select("id, name"),
    sb.from("agreements").select("*").not("status", "in", "(terminated,expired)"),
    sb.from("memberships").select("org_id, user_id, role").in("role", ["owner", "editor"]),
    sb.from("profiles").select("id, email"),
    sb.from("reminders_sent").select("agreement_id, deadline, threshold_days"),
  ]);

  const sentKey = new Set((sent ?? []).map((r: any) => `${r.agreement_id}|${r.deadline}|${r.threshold_days}`));
  const emailOf = new Map((profiles ?? []).map((p: any) => [p.id, p.email]));
  const perOrg = new Map<string, any[]>();

  for (const a of agreements ?? []) {
    const d = deadlineOf(a, today);
    if (!d) continue;
    const left = days(today, d.date);
    if (left < 0) continue;
    // Mindste tærskel vi er inden for og ikke har sendt endnu
    const th = [...THRESHOLDS].sort((x, y) => x - y).find((t) => left <= t);
    if (th == null || sentKey.has(`${a.id}|${iso(d.date)}|${th}`)) continue;
    if (!perOrg.has(a.org_id)) perOrg.set(a.org_id, []);
    perOrg.get(a.org_id)!.push({ a, d, left, th });
  }

  const summary: string[] = [];
  let mails = 0;
  for (const [orgId, items] of perOrg) {
    const org = (orgs ?? []).find((o: any) => o.id === orgId);
    const to = (members ?? []).filter((m: any) => m.org_id === orgId).map((m: any) => emailOf.get(m.user_id)).filter(Boolean) as string[];
    items.sort((x, y) => x.left - y.left);
    const rows = items.map(({ a, d, left }) =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><strong>${esc(a.title)}</strong><br><span style="color:#777">${esc(a.supplier ?? "")} · ${kr(Number(a.annual_cost) || 0)}/år</span></td>` +
      `<td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(d.label)}<br><strong>${fmt(d.date)}</strong> (om ${left} dage)</td></tr>`
    ).join("");
    const html = `<div style="font-family:Arial,sans-serif;color:#221c14;max-width:640px">
      <h2 style="font-weight:normal">Kommende frister for ${esc(org?.name)}</h2>
      <p>Følgende driftsaftaler har frister, I bør forholde jer til. Hvis en aftale ikke opsiges til tiden, forlænges den typisk automatisk.</p>
      <table style="border-collapse:collapse;width:100%">${rows}</table>
      <p style="margin-top:20px"><a href="${esc(appUrl)}" style="background:#4d4640;color:#f4ede0;padding:10px 18px;text-decoration:none;border-radius:4px">Åbn aftaleoverblikket</a></p>
      <p style="color:#777;font-size:12px">Core Partners kan vurdere aftalerne for jer efter No Cure No Pay-princippet: I betaler kun ved en dokumenteret besparelse.</p></div>`;
    if (to.length) {
      await sendMail(to, `Aftalefrister: ${items.length} aftale${items.length === 1 ? "" : "r"} kræver handling`, html);
      mails++;
    }
    await sb.from("reminders_sent").upsert(items.map(({ a, d, th }) => ({ agreement_id: a.id, deadline: iso(d.date), threshold_days: th })));
    summary.push(`<h3>${esc(org?.name)}</h3><table style="border-collapse:collapse;width:100%">${rows}</table>`);
  }

  const admin = Deno.env.get("CP_ADMIN_EMAIL");
  if (admin && summary.length) {
    await sendMail([admin], `Kundefrister i dag: ${summary.length} kunde${summary.length === 1 ? "" : "r"}`,
      `<div style="font-family:Arial,sans-serif;max-width:720px"><h2 style="font-weight:normal">Nye påmindelser sendt til kunder</h2>${summary.join("")}</div>`);
  }

  return Response.json({ organizations: perOrg.size, mails });
});
