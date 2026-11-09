// =============================================================================
//  meter/core.mjs - the money rules for the "Playtime & money" page AND the app.
//  Pure JavaScript (no Node, no browser APIs), so both use exactly the same maths:
//    * meter/build-page.mjs (GitHub Actions) builds meter/README.md with it
//    * meter-app/ (the iPad / laptop app) imports a copy of this file
//
//  Billing (data.billing):
//    { "SomePlayer123": { "type": "monthly", "fee": 30 } }
//    * £fee is charged for every month from the month the player FIRST played
//      (a month with no play before that is never charged), due on the 1st.
//    * Anything not paid keeps adding up, month after month, until it is paid.
//      Payments come off the total; paying too much = credit.
//    * Players with no billing entry are only shown (usage), never charged.
//  All money is worked out in whole pence. Dates are UK dates (YYYY-MM-DD).
// =============================================================================

export const REPO = "Reality-Realms/world-firewall";

// -----------------------------------------------------------------------------
//  Small helpers
// -----------------------------------------------------------------------------
/** A date in the UK, as YYYY-MM-DD. */
export function ukDate(d = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** The time in the UK, as HH:MM. */
export function ukTime(d = new Date()) {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(d);
}
export const money = (pence) => `${pence < 0 ? "-" : ""}£${(Math.abs(pence) / 100).toFixed(2)}`;
export const hm = (mins) => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
export const monthName = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
export const shortMonth = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
export const daysIn = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
/** "2026-11" + n months. */
export function addMonths(m, n) {
    const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** Whole months from a to b ("2026-11" -> "2027-01" = 2). */
export const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));

/**
 * Reads an amount typed by a person: "5", "£5.50", "5,50", "50p", "£1,000".
 * A minus sign fixes a mistake ("-5"). Returns pence, or NaN if unreadable.
 */
export function parsePence(text) {
    let t = String(text ?? "").trim().toLowerCase().replace(/£|gbp|\s/g, "");
    let sign = 1;
    if (/^[-−–]/.test(t)) {
        sign = -1;
        t = t.slice(1);
    }
    if (/^\d+p$/.test(t)) return sign * Number(t.slice(0, -1));
    if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
    else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) t = t.split(",").join("");
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
    return sign * Math.round(Number(t) * 100);
}

/** Reads a date typed by a person: "2026-11-09", "9/11/2026", "09/11/26". Returns YYYY-MM-DD or "". */
export function parseDate(text) {
    const t = String(text ?? "").trim();
    if (!t) return "";
    if (isDate(t)) return t;
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
    if (!m) return "invalid";
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const s = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isDate(s) && new Date(s).getUTCDate() === +m[1] ? s : "invalid";
}

// -----------------------------------------------------------------------------
//  Data
// -----------------------------------------------------------------------------
/** Makes data.json safe to use, whatever is in it. */
export function normalize(raw) {
    const d = raw && typeof raw === "object" ? raw : {};
    const players = Array.isArray(d.players) ? [...new Set(d.players.filter((p) => typeof p === "string" && p.trim()).map((p) => p.trim()))] : [];
    const billing = {};
    const rawBilling = d.billing && typeof d.billing === "object" ? d.billing : {};
    for (const p of players) {
        const b = rawBilling[p];
        if (b && b.type === "monthly" && Number.isFinite(b.fee) && b.fee > 0) billing[p] = { type: "monthly", fee: Math.round(b.fee * 100) / 100 };
    }
    return {
        billing,
        players,
        playtime: (Array.isArray(d.playtime) ? d.playtime : []).filter((e) => e && players.includes(e.player) && isDate(e.date) && Number.isFinite(e.minutes)),
        payments: (Array.isArray(d.payments) ? d.payments : []).filter((e) => e && players.includes(e.player) && isDate(e.date) && Number.isFinite(e.amount)),
    };
}

// -----------------------------------------------------------------------------
//  Adding entries (from the app or from the workflow's boxes)
// -----------------------------------------------------------------------------
/**
 * Adds one entry. what = "sync" | "playtime" | "payment".
 * fields: { player, minutes, amount, date }  (strings, as typed)
 * Returns a short message, or throws an Error saying what is wrong (nothing is changed then).
 */
export function addEntry(data, what, fields, today) {
    const player = String(fields.player ?? "").trim();
    if (!data.players.includes(player)) throw new Error(`"${player}" isn't one of the players (${data.players.join(", ")}).`);
    const minutesText = String(fields.minutes ?? "").trim();
    const amountText = String(fields.amount ?? "").trim();
    const dateText = String(fields.date ?? "").trim();

    if (what === "sync") return syncFromGame(data, player, minutesText, amountText, dateText, today);

    const date = parseDate(dateText) || today;
    if (date === "invalid") throw new Error(`The date "${dateText}" must look like ${today} or ${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}.`);
    if (date > today) throw new Error(`${date} is in the future.`);

    if (what === "playtime") {
        const m = /\d/.test(minutesText) ? Math.round(Number(minutesText.replace(/[−–]/, "-").replace(/[^\d.-]/g, ""))) : NaN;
        if (!Number.isFinite(m) || m === 0 || Math.abs(m) > 24 * 60) throw new Error(`"${minutesText}" isn't a number of minutes (1 to 1440, or with a minus sign to fix a mistake).`);
        data.playtime.push({ player, date, minutes: m });
        return m > 0 ? `Added ${hm(m)} for ${player} on ${date}.` : `Took ${hm(-m)} off ${player} on ${date}.`;
    }
    if (what === "payment") {
        const pence = parsePence(amountText);
        if (!Number.isFinite(pence) || pence === 0 || Math.abs(pence) > 100000) throw new Error(`"${amountText}" isn't an amount (for example 30, £30.00, 5,50 or 50p).`);
        data.payments.push({ player, date, amount: pence / 100 });
        return pence > 0 ? `Saved a payment of ${money(pence)} from ${player} on ${date}.` : `Took ${money(-pence)} off ${player}'s payments on ${date}.`;
    }
    throw new Error(`Unknown kind of entry "${what}".`);
}

/**
 * "Sync from game": a player's minutes and money paid in ONE month, exactly as
 * /meter:menu shows them ("For the page"). The difference is recorded, so
 * sending the same numbers twice changes nothing. month = "" (this month) or "2026-10".
 */
function syncFromGame(data, player, minutesText, amountText, monthText, today) {
    const month = monthText ? (/^\d{4}-\d{2}/.test(monthText) ? monthText.slice(0, 7) : "invalid") : today.slice(0, 7);
    if (month === "invalid" || month > today.slice(0, 7)) throw new Error(`For a sync, leave the date empty or type the month the game shows, like ${today.slice(0, 7)}.`);
    // Entries for an earlier month go on its last day; this month's go on today.
    const date = month === today.slice(0, 7) ? today : `${month}-${String(daysIn(month)).padStart(2, "0")}`;
    const now = monthTotals(data, player, month);
    const done = [];
    let addMin = 0;
    let addPaid = 0;
    if (minutesText) {
        const m = /\d/.test(minutesText) ? Math.round(Number(minutesText.replace(/[^\d.]/g, ""))) : NaN;
        if (!Number.isFinite(m) || m < 0 || m > 31 * 1440) throw new Error(`"${minutesText}" isn't a number of minutes for ${player}.`);
        addMin = m - now.minutes;
        done.push(`${hm(m)} played${addMin ? ` (${addMin > 0 ? "+" : ""}${addMin} min)` : ""}`);
    }
    if (amountText) {
        const pence = parsePence(amountText);
        if (!Number.isFinite(pence) || pence < 0 || pence > 1000000) throw new Error(`"${amountText}" isn't an amount for ${player}.`);
        addPaid = pence - now.paid;
        done.push(`paid ${money(pence)}${addPaid ? ` (${addPaid > 0 ? "+" : "-"}${money(Math.abs(addPaid))})` : ""}`);
    }
    if (!done.length) throw new Error("Fill in the minutes or the money from /meter:menu.");
    if (addMin) data.playtime.push({ player, date, minutes: addMin });
    if (addPaid) data.payments.push({ player, date, amount: addPaid / 100 });
    return `Synced ${player} for ${monthName(month)}: ${done.join(", ")}.`;
}

// -----------------------------------------------------------------------------
//  The numbers
// -----------------------------------------------------------------------------
/** Minutes per day and money paid for one player in one month. */
export function monthTotals(data, player, month) {
    const perDay = new Array(daysIn(month)).fill(0);
    for (const e of data.playtime) if (e.player === player && e.date.startsWith(month)) perDay[+e.date.slice(8, 10) - 1] += Math.round(e.minutes);
    for (let i = 0; i < perDay.length; i++) perDay[i] = Math.max(0, perDay[i]);
    const paid = data.payments.filter((p) => p.player === player && p.date.startsWith(month)).reduce((s, p) => s + Math.round(p.amount * 100), 0);
    return { perDay, minutes: perDay.reduce((a, b) => a + b, 0), paid };
}

/** The first month a player played (any day with minutes > 0 after corrections), or null. */
export function firstPlayedMonth(data, player) {
    const byDay = {};
    for (const e of data.playtime) if (e.player === player) byDay[e.date] = (byDay[e.date] ?? 0) + Math.round(e.minutes);
    const days = Object.keys(byDay).filter((d) => byDay[d] > 0).sort();
    return days.length ? days[0].slice(0, 7) : null;
}

/** Everything about one player, as of `today` (YYYY-MM-DD). */
export function playerSummary(data, player, today) {
    const month = today.slice(0, 7);
    const t = monthTotals(data, player, month);
    const bill = data.billing[player] ?? null;
    const feePence = bill ? Math.round(bill.fee * 100) : 0;
    const start = bill ? firstPlayedMonth(data, player) : null;
    const monthsCharged = start && start <= month ? monthsBetween(start, month) + 1 : 0;
    const charged = feePence * monthsCharged;
    const paidTotal = data.payments.filter((p) => p.player === player).reduce((s, p) => s + Math.round(p.amount * 100), 0);
    const balance = charged - paidTotal; // > 0 owed, < 0 credit
    const chargedBefore = feePence * Math.max(0, monthsCharged - 1);
    const earlierOwed = Math.max(0, chargedBefore - paidTotal);
    const unpaidMonths = feePence ? Math.min(monthsCharged, Math.ceil(Math.max(0, balance) / feePence)) : 0;
    const played = data.playtime.filter((e) => e.player === player);
    const lastPlayed = Object.entries(played.reduce((m, e) => ((m[e.date] = (m[e.date] ?? 0) + e.minutes), m), {}))
        .filter(([, v]) => v > 0)
        .map(([d]) => d)
        .sort()
        .pop() ?? null;
    const lastPayment = data.payments.filter((p) => p.player === player && p.amount > 0).sort((a, b) => (a.date < b.date ? -1 : 1)).pop() ?? null;
    const dayIndex = +today.slice(8, 10) - 1;
    const last7 = (() => {
        let sum = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(Date.parse(today) - i * 86400000).toISOString().slice(0, 10);
            sum += Math.max(0, data.playtime.filter((e) => e.player === player && e.date === d).reduce((s, e) => s + e.minutes, 0));
        }
        return sum;
    })();
    return {
        player,
        billed: !!bill,
        feePence,
        startMonth: start,
        monthsCharged,
        chargedPence: charged,
        paidTotalPence: Math.max(0, paidTotal),
        paidThisMonthPence: t.paid,
        owedPence: Math.max(0, balance),
        creditPence: Math.max(0, -balance),
        earlierOwedPence: earlierOwed,
        unpaidMonths,
        nextDue: addMonths(month, 1) + "-01",
        perDay: t.perDay,
        minutesThisMonth: t.minutes,
        minutesToday: t.perDay[dayIndex] ?? 0,
        minutesLast7: last7,
        minutesAllTime: Math.max(0, played.reduce((s, e) => s + e.minutes, 0)),
        lastPlayed,
        lastPayment,
    };
}

/** History for the last `count` months (oldest first): minutes, fee charged and paid per player. */
export function monthHistory(data, today, count = 12) {
    const month = today.slice(0, 7);
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
        const m = addMonths(month, -i);
        const row = { month: m, players: {} };
        for (const p of data.players) {
            const t = monthTotals(data, p, m);
            const bill = data.billing[p];
            const start = bill ? firstPlayedMonth(data, p) : null;
            const fee = bill && start && start <= m ? Math.round(bill.fee * 100) : 0;
            row.players[p] = { minutes: t.minutes, fee, paid: t.paid };
        }
        out.push(row);
    }
    return out;
}

/** Everything the page and the app show. */
export function summary(rawData, now = new Date()) {
    const today = ukDate(now);
    const data = normalize(rawData);
    // Nothing dated after today counts yet.
    data.playtime = data.playtime.filter((e) => e.date <= today);
    data.payments = data.payments.filter((e) => e.date <= today);
    const players = data.players.map((p) => playerSummary(data, p, today));
    return {
        today,
        time: ukTime(now),
        month: today.slice(0, 7),
        players,
        history: monthHistory(data, today, 12),
        owedTotalPence: players.reduce((s, p) => s + p.owedPence, 0),
        paidTotalPence: players.reduce((s, p) => s + p.paidTotalPence, 0),
        recent: [
            ...data.playtime.map((e) => ({ kind: "playtime", ...e })),
            ...data.payments.map((e) => ({ kind: "payment", ...e })),
        ]
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
            .slice(0, 30),
    };
}
