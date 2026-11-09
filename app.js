// =============================================================================
//  meter-app/app.js - Money Meter app (iPad, laptop, phone).
//  * Reads meter/data.json from the PRIVATE repo with the owner's own GitHub
//    key (kept only on this device), and shows it with the same money rules as
//    the GitHub page (core.mjs).
//  * Adding playtime / payments runs the "Meter page" workflow, which saves the
//    entry and rebuilds the page. Running a workflow emails nobody.
// =============================================================================
import { REPO, addEntry, normalize, summary, ukDate } from "./core.mjs";
import { dashboard, esc } from "./view.mjs";

const API = "https://api.github.com";
const WHAT = {
    sync: "Sync from game (numbers from /meter:menu)",
    playtime: "Add playtime (minutes)",
    payment: "Add a payment",
};
const $ = (sel) => document.querySelector(sel);
const store = {
    get token() {
        return localStorage.getItem("mm.token") || "";
    },
    set token(v) {
        v ? localStorage.setItem("mm.token", v) : localStorage.removeItem("mm.token");
    },
    get data() {
        try {
            return JSON.parse(localStorage.getItem("mm.data") || "null");
        } catch {
            return null;
        }
    },
    set data(v) {
        localStorage.setItem("mm.data", JSON.stringify(v));
    },
};
let current = store.data; // the last data.json we saw
let currentSha = localStorage.getItem("mm.sha") || "";
let pending = []; // entries sent but not on GitHub yet

// -----------------------------------------------------------------------------
//  GitHub
// -----------------------------------------------------------------------------
async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
        ...opts,
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${store.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
        cache: "no-store",
    });
    if (res.status === 401) throw new Error("Your GitHub key doesn't work any more. Open ⚙️ and paste a new one.");
    if (res.status === 404) throw new Error("GitHub says it can't find the money data. Check that your key can see Reality-Realms/world-firewall (⚙️).");
    if (res.status === 403) throw new Error("Your GitHub key isn't allowed to do that. Check its permissions (⚙️).");
    if (!res.ok) throw new Error(`GitHub problem (${res.status}). Try again in a minute.`);
    return res.status === 204 ? null : res.json();
}

async function loadData() {
    const file = await gh(`/repos/${REPO}/contents/meter/data.json?ref=main`);
    const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    current = data;
    store.data = data;
    if (file.sha !== currentSha) pending = []; // the workflow saved them
    currentSha = file.sha;
    localStorage.setItem("mm.sha", file.sha);
    localStorage.setItem("mm.when", String(Date.now()));
    return data;
}

async function sendEntry(what, fields) {
    await gh(`/repos/${REPO}/actions/workflows/meter.yml/dispatches`, {
        method: "POST",
        body: JSON.stringify({ ref: "main", inputs: { what: WHAT[what], player: fields.player, minutes: fields.minutes || "", amount: fields.amount || "", date: fields.date || "" } }),
    });
}

// -----------------------------------------------------------------------------
//  Screen
// -----------------------------------------------------------------------------
function render() {
    const main = $("#main");
    if (!store.token) {
        main.innerHTML = setupHtml();
        $("#addBtn").hidden = true;
        return;
    }
    $("#addBtn").hidden = !current;
    if (!current) {
        main.innerHTML = `<div class="loading">Loading…</div>`;
        return;
    }
    // Show entries that are on their way as if they were saved already.
    const view = JSON.parse(JSON.stringify(current));
    for (const p of pending) {
        if (p.kind === "playtime") view.playtime.push(p.entry);
        else view.payments.push(p.entry);
    }
    const s = summary(view, new Date());
    main.innerHTML = (pending.length ? `<div class="banner">⏳ Saving ${pending.length} entr${pending.length === 1 ? "y" : "ies"} to GitHub… (about a minute)</div>` : "") + dashboard(s);
    const when = +localStorage.getItem("mm.when") || 0;
    $("#updated").textContent = when ? `Updated ${new Date(when).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "";
}

function setupHtml() {
    return `
<section class="card setup">
  <h2>👋 Set up the app (once)</h2>
  <p>The money numbers are private, so the app needs a <b>GitHub key</b> that only you have. It stays on this device.</p>
  <ol>
    <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → New fine-grained token</a> (log in as yourself).</li>
    <li><b>Token name:</b> Money Meter. <b>Expiration:</b> 1 year.</li>
    <li><b>Resource owner:</b> Reality-Realms. <b>Repository access:</b> Only select repositories → <b>world-firewall</b>.</li>
    <li><b>Permissions → Repository:</b> <b>Contents: Read-only</b> and <b>Actions: Read and write</b>.</li>
    <li>Tap <b>Generate token</b>, copy it, and paste it here:</li>
  </ol>
  <input id="tokenInput" type="password" autocomplete="off" placeholder="github_pat_…" />
  <button id="saveToken" class="primary">Save and open</button>
  <p class="small">If Reality-Realms isn't in the list, use a classic token instead (<a href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=Money%20Meter" target="_blank" rel="noopener">this link</a> ticks the right boxes).</p>
</section>`;
}

function toast(text, bad = false) {
    const t = $("#toast");
    t.textContent = text;
    t.className = bad ? "show bad" : "show";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.className = ""), bad ? 6000 : 3500);
}

async function refresh(quiet = false) {
    if (!store.token) return render();
    try {
        $("#refresh").classList.add("spin");
        await loadData();
        render();
        if (!quiet) toast("Up to date ✓");
    } catch (e) {
        render();
        toast(e.message, true);
    } finally {
        $("#refresh").classList.remove("spin");
    }
}

// Wait for the workflow to save (data.json changes), checking every 6 seconds for up to 3 minutes.
async function waitForSave() {
    const start = currentSha;
    for (let i = 0; i < 30 && pending.length; i++) {
        await new Promise((r) => setTimeout(r, 6000));
        try {
            await loadData();
        } catch {}
        if (currentSha !== start) {
            render();
            return toast("Saved ✓");
        }
    }
    if (pending.length) toast("Still saving… pull down or tap ⟳ in a minute.", true);
}

// -----------------------------------------------------------------------------
//  The "+" sheet
// -----------------------------------------------------------------------------
function openSheet(kind = "playtime") {
    const players = current?.players ?? [];
    const payer = Object.keys(current?.billing ?? {})[0] ?? players[0];
    const today = ukDate();
    $("#sheet").innerHTML = `
<div class="sheet-inner">
  <div class="tabs">
    <button data-kind="playtime" class="${kind === "playtime" ? "on" : ""}">🎮 Playtime</button>
    <button data-kind="payment" class="${kind === "payment" ? "on" : ""}">💷 Payment</button>
    <button data-kind="sync" class="${kind === "sync" ? "on" : ""}">⚡ Sync from game</button>
  </div>
  <label>Player
    <select id="fPlayer">${players.map((p) => `<option ${kind === "payment" && p === payer ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
  </label>
  ${
      kind === "playtime"
          ? `<label>Minutes played <input id="fMinutes" inputmode="numeric" placeholder="45" /></label>
             <div class="quick">${[15, 30, 60, 90, 120].map((m) => `<button data-min="${m}">${m < 60 ? `${m}m` : `${m / 60}h`}</button>`).join("")}</div>
             <label>Date <input id="fDate" type="date" value="${today}" max="${today}" /></label>`
          : kind === "payment"
            ? `<label>Amount (£) <input id="fAmount" inputmode="decimal" placeholder="30" /></label>
               <div class="quick">${[5, 10, 20, 30, 60].map((a) => `<button data-amt="${a}">£${a}</button>`).join("")}</div>
               <label>Date <input id="fDate" type="date" value="${today}" max="${today}" /></label>`
            : `<p class="small">In the world, open <b>/meter:menu</b>. At the bottom, under <b>For the page</b>, copy this player's numbers. Only the difference is added, so sending the same numbers twice changes nothing.</p>
               <label>Minutes this month <input id="fMinutes" inputmode="numeric" placeholder="135" /></label>
               <label>Paid this month (£) <input id="fAmount" inputmode="decimal" placeholder="optional" /></label>`
  }
  <p class="small">Typed a mistake before? Add it again with a minus sign (−30 minutes or −5 pounds).</p>
  <div id="fError" class="error"></div>
  <div class="row"><button id="cancel">Cancel</button><button id="send" class="primary">Save</button></div>
</div>`;
    $("#sheet").dataset.kind = kind;
    $("#sheet").classList.add("open");
    $("#shade").classList.add("open");
}
function closeSheet() {
    $("#sheet").classList.remove("open");
    $("#shade").classList.remove("open");
}

async function submitSheet() {
    const kind = $("#sheet").dataset.kind;
    const fields = {
        player: $("#fPlayer").value,
        minutes: $("#fMinutes")?.value ?? "",
        amount: $("#fAmount")?.value ?? "",
        date: kind === "sync" ? "" : ($("#fDate")?.value ?? ""),
    };
    // Check it with the SAME rules the workflow uses, so mistakes show at once.
    const copy = normalize(JSON.parse(JSON.stringify(current)));
    const before = { p: copy.playtime.length, m: copy.payments.length };
    let msg;
    try {
        msg = addEntry(copy, kind, fields, ukDate());
    } catch (e) {
        $("#fError").textContent = e.message;
        return;
    }
    const added = [...copy.playtime.slice(before.p).map((entry) => ({ kind: "playtime", entry })), ...copy.payments.slice(before.m).map((entry) => ({ kind: "payment", entry }))];
    $("#send").disabled = true;
    $("#send").textContent = "Sending…";
    try {
        await sendEntry(kind, fields);
    } catch (e) {
        $("#fError").textContent = e.message;
        $("#send").disabled = false;
        $("#send").textContent = "Save";
        return;
    }
    pending.push(...added);
    closeSheet();
    render();
    toast(msg.replace(/\.$/, "") + " – saving…");
    waitForSave();
}

// -----------------------------------------------------------------------------
//  Settings
// -----------------------------------------------------------------------------
function openSettings() {
    $("#sheet").innerHTML = `
<div class="sheet-inner">
  <h2>⚙️ Settings</h2>
  <p class="small">Your GitHub key is saved only on this device.</p>
  <label>GitHub key <input id="newToken" type="password" placeholder="paste a new key to change it" /></label>
  <div class="row"><button id="forget" class="danger">Sign out on this device</button><button id="saveNew" class="primary">Save key</button></div>
  <p class="small">The page on GitHub: <a href="https://github.com/${REPO}/blob/main/meter/README.md" target="_blank" rel="noopener">Playtime &amp; money</a></p>
  <div class="row"><button id="cancel">Close</button></div>
</div>`;
    $("#sheet").dataset.kind = "settings";
    $("#sheet").classList.add("open");
    $("#shade").classList.add("open");
}

// -----------------------------------------------------------------------------
//  Events
// -----------------------------------------------------------------------------
document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.id === "saveToken") {
        const v = $("#tokenInput").value.trim();
        if (!v) return toast("Paste your GitHub key first.", true);
        store.token = v;
        current = null;
        render();
        await refresh(true);
        if (!current) store.token = ""; // didn't work: ask again
        render();
    }
    if (b.id === "addBtn") openSheet("playtime");
    if (b.dataset.kind && $("#sheet").classList.contains("open")) openSheet(b.dataset.kind);
    if (b.dataset.min) $("#fMinutes").value = b.dataset.min;
    if (b.dataset.amt) $("#fAmount").value = b.dataset.amt;
    if (b.id === "cancel") closeSheet();
    if (b.id === "send") submitSheet();
    if (b.id === "refresh") refresh();
    if (b.id === "settings") openSettings();
    if (b.id === "forget") {
        store.token = "";
        localStorage.removeItem("mm.data");
        current = null;
        closeSheet();
        render();
    }
    if (b.id === "saveNew") {
        const v = $("#newToken").value.trim();
        if (v) store.token = v;
        closeSheet();
        refresh();
    }
});
$("#shade").addEventListener("click", closeSheet);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && store.token && refresh(true));

// Pull down to refresh (touch screens).
let pullStart = null;
window.addEventListener("touchstart", (e) => (pullStart = window.scrollY === 0 ? e.touches[0].clientY : null), { passive: true });
window.addEventListener("touchend", (e) => {
    if (pullStart !== null && e.changedTouches[0].clientY - pullStart > 90) refresh();
    pullStart = null;
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
render();
refresh(true);
setInterval(() => document.visibilityState === "visible" && store.token && !pending.length && refresh(true), 5 * 60 * 1000);
