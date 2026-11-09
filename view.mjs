// =============================================================================
//  meter-app/view.mjs - turns the numbers (core.mjs summary) into the app's
//  screen. Pure functions that return HTML strings, so they can be tested
//  without a browser (tests/meterapp.test.mjs).
// =============================================================================
import { hm, money, monthName, shortMonth } from "./core.mjs";

export const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const COLORS = ["#4ade80", "#c084fc", "#38bdf8", "#fb923c", "#f472b6"];
export const colorOf = (i) => COLORS[i % COLORS.length];

const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const daysUntil = (today, d) => Math.round((Date.parse(d) - Date.parse(today)) / 86400000);

/** The big card for a player who pays. */
export function moneyCard(p, s) {
    if (!p.billed) return "";
    let status;
    let tone;
    if (!p.startMonth) {
        status = `Starts the month ${esc(p.player)} first plays`;
        tone = "calm";
    } else if (p.creditPence) {
        status = `Paid up ✅ · in credit ${money(p.creditPence)}`;
        tone = "good";
    } else if (!p.owedPence) {
        status = "Paid up ✅";
        tone = "good";
    } else {
        status = `${p.unpaidMonths} month${p.unpaidMonths === 1 ? "" : "s"} not paid`;
        tone = p.unpaidMonths > 1 ? "bad" : "warn";
    }
    const due = daysUntil(s.today, p.nextDue);
    return `
<section class="card money ${tone}">
  <div class="who">${esc(p.player)}</div>
  <div class="label">Still owed</div>
  <div class="big">${money(p.owedPence)}</div>
  <div class="pill ${tone}">${status}</div>
  <div class="facts">
    <div><span>Price</span><b>${money(p.feePence)} / month</b></div>
    <div><span>Paid in total</span><b>${money(p.paidTotalPence)}</b></div>
    <div><span>Paid this month</span><b>${money(p.paidThisMonthPence)}</b></div>
    <div><span>Next ${money(p.feePence)}</span><b>${p.startMonth ? `${longDate(p.nextDue)} (${due} day${due === 1 ? "" : "s"})` : "—"}</b></div>
  </div>
  ${p.lastPayment ? `<div class="small">Last payment: ${money(Math.round(p.lastPayment.amount * 100))} on ${longDate(p.lastPayment.date)}</div>` : `<div class="small">No payments yet.</div>`}
</section>`;
}

/** A small card with one player's playtime. */
export function playCard(p, i) {
    return `
<section class="card play">
  <div class="who"><i style="background:${colorOf(i)}"></i>${esc(p.player)}${p.billed ? "" : ` <span class="tag">free</span>`}</div>
  <div class="stats">
    <div><b>${hm(p.minutesToday)}</b><span>today</span></div>
    <div><b>${hm(p.minutesLast7)}</b><span>last 7 days</span></div>
    <div><b>${hm(p.minutesThisMonth)}</b><span>this month</span></div>
    <div><b>${hm(p.minutesAllTime)}</b><span>all time</span></div>
  </div>
  <div class="small">${p.lastPlayed ? `Last played ${longDate(p.lastPlayed)}` : "Hasn't played yet"}</div>
</section>`;
}

/** Bar chart: minutes per day this month, one colour per player, today marked. */
export function dailyChart(s) {
    const days = s.players[0]?.perDay.length ?? 30;
    const W = 640;
    const H = 200;
    const pad = { l: 34, r: 8, t: 10, b: 22 };
    const top = Math.max(60, ...s.players.flatMap((p) => p.perDay));
    const niceTop = Math.ceil(top / 30) * 30;
    const cw = (W - pad.l - pad.r) / days;
    const n = Math.max(1, s.players.length);
    const bw = Math.max(2, (cw - 3) / n);
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / niceTop);
    const todayIdx = +s.today.slice(8, 10) - 1;
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Minutes played per day">`;
    for (let k = 0; k <= 3; k++) {
        const v = Math.round((niceTop / 3) * k);
        svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 4}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`;
    }
    svg += `<rect x="${pad.l + cw * todayIdx}" y="${pad.t}" width="${cw}" height="${H - pad.t - pad.b}" class="today"/>`;
    s.players.forEach((p, pi) =>
        p.perDay.forEach((m, d) => {
            if (!m) return;
            const x = pad.l + cw * d + 1.5 + bw * pi;
            svg += `<rect x="${x.toFixed(1)}" y="${y(m).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad.b - y(m)).toFixed(1)}" rx="2" fill="${colorOf(pi)}"><title>${esc(p.player)}: ${m} min on day ${d + 1}</title></rect>`;
        })
    );
    for (let d = 0; d < days; d += d < 28 ? 7 : 3) svg += `<text x="${pad.l + cw * d + cw / 2}" y="${H - 6}" class="axis" text-anchor="middle">${d + 1}</text>`;
    return svg + "</svg>";
}

/** Money over the last 12 months: fee charged (bars), paid (bars), still owed (line). */
export function moneyChart(s, player) {
    const rows = s.history;
    const W = 640;
    const H = 210;
    const pad = { l: 40, r: 8, t: 12, b: 24 };
    let running = 0;
    const owedLine = rows.map((h) => {
        const x = h.players[player] ?? { fee: 0, paid: 0 };
        running += x.fee - x.paid;
        return Math.max(0, running);
    });
    // The line starts from what was owed before these 12 months.
    const shift = Math.max(0, s.players.find((p) => p.player === player)?.owedPence ?? 0) - (owedLine.at(-1) ?? 0);
    const line = owedLine.map((v) => Math.max(0, v + shift));
    const top = Math.max(3000, ...rows.map((h) => Math.max(h.players[player]?.fee ?? 0, h.players[player]?.paid ?? 0)), ...line);
    const niceTop = Math.ceil(top / 1000) * 1000;
    const cw = (W - pad.l - pad.r) / rows.length;
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / niceTop);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Money per month">`;
    for (let k = 0; k <= 4; k++) {
        const v = (niceTop / 4) * k;
        svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 4}" y="${y(v) + 4}" class="axis" text-anchor="end">£${Math.round(v / 100)}</text>`;
    }
    rows.forEach((h, i) => {
        const x = h.players[player] ?? { fee: 0, paid: 0 };
        const bx = pad.l + cw * i;
        const bw = (cw - 6) / 2;
        if (x.fee) svg += `<rect x="${(bx + 3).toFixed(1)}" y="${y(x.fee).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad.b - y(x.fee)).toFixed(1)}" rx="2" class="fee"><title>${monthName(h.month)}: ${money(x.fee)} charged</title></rect>`;
        if (x.paid > 0) svg += `<rect x="${(bx + 3 + bw).toFixed(1)}" y="${y(x.paid).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad.b - y(x.paid)).toFixed(1)}" rx="2" class="paid"><title>${monthName(h.month)}: ${money(x.paid)} paid</title></rect>`;
        svg += `<text x="${bx + cw / 2}" y="${H - 7}" class="axis" text-anchor="middle">${shortMonth(h.month)}</text>`;
    });
    const pts = line.map((v, i) => `${(pad.l + cw * i + cw / 2).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    svg += `<polyline points="${pts}" class="owedline"/>`;
    line.forEach((v, i) => (svg += `<circle cx="${(pad.l + cw * i + cw / 2).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" class="owedpt"><title>${monthName(rows[i].month)}: ${money(v)} still owed</title></circle>`));
    return svg + "</svg>";
}

/** The list of the latest entries. */
export function recentList(s) {
    if (!s.recent.length) return `<p class="empty">Nothing added yet. Tap <b>＋</b> to add playtime or a payment.</p>`;
    return `<ul class="recent">${s.recent
        .slice(0, 15)
        .map((e) =>
            e.kind === "payment"
                ? `<li><span class="ic pay">£</span><div><b>${e.amount < 0 ? "Payment taken off" : "Payment"}: ${money(Math.round(Math.abs(e.amount) * 100))}</b><small>${esc(e.player)} · ${longDate(e.date)}</small></div></li>`
                : `<li><span class="ic play">▶</span><div><b>${e.minutes < 0 ? "Taken off" : "Played"}: ${hm(Math.abs(e.minutes))}</b><small>${esc(e.player)} · ${longDate(e.date)}</small></div></li>`
        )
        .join("")}</ul>`;
}

/** The whole dashboard. */
export function dashboard(s) {
    const payers = s.players.filter((p) => p.billed);
    let html = `<div class="month">${monthName(s.month)}</div>`;
    html += payers.map((p) => moneyCard(p, s)).join("");
    for (const p of payers)
        html += `<section class="card"><h2>Money, month by month · ${esc(p.player)}</h2>${moneyChart(s, p.player)}<div class="legend"><span><i class="fee"></i>charged</span><span><i class="paid"></i>paid</span><span><i class="owed"></i>still owed</span></div></section>`;
    html += `<div class="grid2">${s.players.map((p, i) => playCard(p, i)).join("")}</div>`;
    html += `<section class="card"><h2>Minutes per day · ${monthName(s.month)}</h2>${dailyChart(s)}<div class="legend">${s.players.map((p, i) => `<span><i style="background:${colorOf(i)}"></i>${esc(p.player)}</span>`).join("")}</div></section>`;
    html += `<section class="card"><h2>Latest</h2>${recentList(s)}</section>`;
    return html;
}
