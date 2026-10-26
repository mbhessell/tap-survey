/* Tap Survey: line cleaner field app (installable web app). */
(function () {
  "use strict";
  const CFG = window.TAP_CONFIG, Store = window.TapStore;
  const STEPS = ["Taps", "Photo", "Cleaning", "Sign-off", "Review"];
  const $ = s => document.querySelector(s);
  const app = $("#app");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = s => String(s || "").replace(/["\\]/g, "").trim().toUpperCase();
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const fmtDate = d => { if (!d) return ""; const x = new Date(d); return isNaN(x) ? "" : (x.getUTCMonth() + 1) + "/" + x.getUTCDate() + "/" + x.getUTCFullYear(); };
  const todayLocal = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  let session = null;      // {token, expiresAt, name, routeNum, employeeId}
  let route = null;        // last route response
  let offlineRoute = false;
  let V = null;            // visit in progress
  let queueCount = 0;
  let device = null;       // {deviceId, deviceKey, employeeId, name}: this phone's registration
  const pick = { route: (function () { try { return localStorage.getItem("tap_admin_route") || ""; } catch (e) { return ""; } })(), date: "" }; // admin route/date choice

  /* ---------- device registration ---------- */
  function randomKey(bytes) {
    const a = new Uint8Array(bytes); crypto.getRandomValues(a);
    return btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const creds = () => device ? { deviceId: device.deviceId, deviceKey: device.deviceKey } : {};
  // Removes everything the app stored on this phone (used when the phone is revoked or a different cleaner takes over).
  async function wipePhone() {
    try {
      for (const v of await Store.queueAll()) await Store.queueDel(v.visitId);
      for (const k of ["session", "route", "draft", "device"]) await Store.del(k);
    } catch (e) {}
    try { Object.keys(localStorage).filter(k => k.indexOf("tap_") === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    device = null; session = null; route = null; V = null; queueCount = 0;
  }
  async function deviceRevoked() {
    await wipePhone();
    toRegister("This phone is no longer registered. Ask the office for a new activation code.");
  }

  /* ---------- network + queue status ---------- */
  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let j = {};
    try { j = await r.json(); } catch (e) {}
    return { status: r.status, ok: r.ok && j.ok !== false, data: j };
  }

  async function refreshQueue() {
    try { queueCount = await Store.queueCount(); } catch (e) { queueCount = 0; }
    renderNet();
  }
  function renderNet() {
    const el = $("#netinfo"); if (!el) return;
    let h = "";
    if (queueCount > 0) h += `<div class="queue"><span><b>${queueCount}</b> visit${queueCount > 1 ? "s" : ""} waiting to send</span><button class="linkbtn" id="sendnow">Send now</button></div>`;
    if (!navigator.onLine) h += `<div class="offline">No signal. Keep working; visits send automatically when signal returns.</div>`;
    el.innerHTML = h;
    const b = $("#sendnow"); if (b) b.onclick = () => flush(true);
  }
  async function flush(manual) {
    const res = await Store.flush().catch(() => ({ sent: 0, left: queueCount }));
    if (res.deviceRevoked) return deviceRevoked(), res;
    await refreshQueue();
    if (res.needLogin && queueCount > 0 && manual) toLogin("Your sign-in expired. Sign in to send waiting visits.");
    if (res.sent && route) markDoneFromQueue();
    return res;
  }
  function registerSync() {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(reg => { if (reg.sync) reg.sync.register("send-visits").catch(() => {}); }).catch(() => {});
    }
  }

  /* ---------- header ---------- */
  function header(step) {
    const bar = $("#bar"); bar.hidden = !session;
    if (!session) return;
    $("#who").innerHTML = `${esc(session.name || "")}<br><span class="mono">Route ${esc((route && route.routeNum) || session.routeNum || "")}${route && route.admin ? " · admin" : ""}</span>`;
    const st = $("#steps"), lab = $("#steplabel");
    if (step == null) { st.innerHTML = ""; lab.textContent = ""; }
    else {
      st.innerHTML = STEPS.map((s, i) => `<span class="${i <= step ? "on" : ""}"></span>`).join("");
      lab.textContent = `${V.stop.name} · Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`;
    }
    renderNet();
  }
  function show(html, step) { header(step); app.innerHTML = html; window.scrollTo(0, 0); }
  async function saveDraft() { if (V) { try { await Store.set("draft", V); } catch (e) {} } }

  /* ---------- register this phone (first time) ---------- */
  function toRegister(msg) {
    session = null;
    if (isIOS() && !isStandalone() && !/[?&]dev=1/.test(location.search)) {
      // On iPhone, Safari and the Home Screen app keep separate storage. Register inside the installed app only.
      return show(`<div class="screen">
        <div><h1>Install Tap Survey first</h1><p class="sub">Your phone gets registered inside the app, so install it before you sign in.</p></div>
        <div class="card"><ol class="steps-list">
          <li>Tap the <b>Share</b> button at the bottom of Safari (square with an arrow).</li>
          <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li>Close Safari and open <b>Tap Survey</b> from your Home Screen.</li></ol></div>
        ${msg ? `<div class="err">${esc(msg)}</div>` : ""}
      </div>`, null);
    }
    show(`<div class="screen">
      <div><h1>Set up this phone</h1><p class="sub">You only do this once. Get an activation code from the office.</p></div>
      <div class="card screen">
        <div><label for="eid">Employee ID</label><input id="eid" type="tel" inputmode="numeric" autocomplete="username"></div>
        <div><label for="code">Activation code</label><input id="code" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="8" class="mono" style="font-size:20px;letter-spacing:.15em"></div>
        <div><label for="pin">PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="12"></div>
        <div class="err" id="lerr" ${msg ? "" : "hidden"}>${esc(msg || "")}</div>
        <button class="btn" id="go">Register this phone</button>
      </div>
      <p class="hint">Tap Survey keeps your visits on this phone only until they're sent to the office, then removes the photos and signatures. Use it for F.E.B. work only.</p>
      ${isStandalone() ? "" : installHint()}
    </div>`, null);
    const code = $("#code");
    code.oninput = () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };
    const go = async () => {
      const eid = $("#eid").value.trim(), c = code.value.trim(), pin = $("#pin").value.trim(), e = $("#lerr");
      if (!eid || c.length !== 8 || !pin) { e.hidden = false; e.textContent = "Enter your employee ID, the 8-character code, and your PIN."; return; }
      const b = $("#go"); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
      const dev = { deviceId: "D-" + randomKey(9), deviceKey: randomKey(32) };
      try {
        const r = await post(CFG.LOGIN_URL, { action: "register", employeeId: eid, code: c, pin, deviceId: dev.deviceId, deviceKey: dev.deviceKey,
          deviceName: (navigator.userAgentData && navigator.userAgentData.platform) || (isIOS() ? "iPhone" : /android/i.test(navigator.userAgent) ? "Android" : "Other") });
        if (r.ok && r.data.token) {
          device = Object.assign(dev, { employeeId: eid, name: r.data.name || "" });
          await Store.set("device", device);
          return startSession(r.data);
        }
        e.hidden = false; e.textContent = loginMessage(r);
      } catch (err) { e.hidden = false; e.textContent = "No signal. You need signal to register."; }
      b.disabled = false; b.textContent = "Register this phone";
    };
    $("#go").onclick = go;
    $("#pin").onkeydown = ev => { if (ev.key === "Enter") go(); };
  }

  /* ---------- PIN sign-in (every 7 days) ---------- */
  function toLogin(msg) {
    if (!device) return toRegister(msg);
    session = null;
    const first = (device.name || "").split(" ")[0];
    show(`<div class="screen">
      <div><h1>Welcome back${first ? ", " + esc(first) : ""}</h1><p class="sub">Enter your PIN to continue.</p></div>
      <div class="card screen">
        <div class="hint">Employee ID <span class="mono">${esc(device.employeeId)}</span> · <button class="linkbtn" id="switch">Not you?</button></div>
        <div><label for="pin">PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="12"></div>
        <div class="err" id="lerr" ${msg ? "" : "hidden"}>${esc(msg || "")}</div>
        <button class="btn" id="go">Sign in</button>
      </div>
    </div>`, null);
    $("#switch").onclick = async () => {
      const e = $("#lerr"); e.hidden = false;
      if (await Store.queueCount() > 0) { e.textContent = "This phone still has visits waiting to send. Sign in and send them before anyone else uses it."; return; }
      if (!confirm("Remove " + (device.name || "this cleaner") + " from this phone? Someone else will need a new activation code to use it.")) return;
      await wipePhone(); toRegister();
    };
    const go = async () => {
      const pin = $("#pin").value.trim(), e = $("#lerr");
      if (!pin) { e.hidden = false; e.textContent = "Enter your PIN."; return; }
      const b = $("#go"); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
      try {
        const r = await post(CFG.LOGIN_URL, Object.assign({ action: "login", employeeId: device.employeeId, pin }, creds()));
        if (r.ok && r.data.token) return startSession(r.data);
        if (r.data && r.data.error === "device") return deviceRevoked();
        e.hidden = false; e.textContent = loginMessage(r);
      } catch (err) { e.hidden = false; e.textContent = "No signal. You need signal to sign in."; }
      b.disabled = false; b.textContent = "Sign in"; $("#pin").value = "";
    };
    $("#go").onclick = go;
    $("#pin").onkeydown = ev => { if (ev.key === "Enter") go(); };
    $("#pin").focus();
  }
  function loginMessage(r) {
    const d = r.data || {};
    const at = d.retryAfter ? new Date(d.retryAfter).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    switch (d.error) {
      case "invalid": return "Wrong PIN." + (d.next === "wait10" ? " One more wrong PIN means a 10-minute wait." : d.next === "wait60" ? " One more wrong PIN means a 1-hour wait." : d.next === "lock" ? " One more wrong PIN locks your account." : "");
      case "wait": return `Too many wrong PINs. Try again after ${at}, or ask the office to unlock you.`;
      case "locked": return "Your account is locked. Ask the office to unlock it.";
      case "code": return "That activation code is wrong or expired. Ask the office for a new one.";
      case "inactive": return "Your access is turned off. Talk to the office.";
      default: return d.message || "Sign-in failed. Try again.";
    }
  }
  async function startSession(data) {
    session = { token: data.token, expiresAt: data.expiresAt, name: data.name, routeNum: data.routeNum, employeeId: device.employeeId };
    await Store.set("session", session);
    if (data.name && data.name !== device.name) { device.name = data.name; await Store.set("device", device); }
    flush(); loadRoute();
  }
  function installHint() {
    if (isStandalone()) return "";
    return `<div class="install"><b>Install on your phone:</b> ${isIOS() ? "tap the Share button in Safari, then <b>Add to Home Screen</b>." : "open the browser menu (⋮), then <b>Install app</b> or <b>Add to Home screen</b>."} Then always open Tap Survey from that icon.</div>`;
  }

  /* ---------- route ---------- */
  async function loadRoute() {
    show(`<div class="screen center"><span class="spin"></span><p class="sub">Loading stops…</p></div>`, null);
    offlineRoute = false;
    try {
      const r = await post(CFG.ROUTE_URL, Object.assign({ token: session.token }, creds(), pick.route ? { routeNum: pick.route } : {}, pick.date ? { date: pick.date } : {}));
      if (r.data && r.data.error === "device") return deviceRevoked();
      if (r.status === 401) { await Store.del("session"); return toLogin("Please enter your PIN again."); }
      if (r.status === 403) return show(`<div class="screen"><h1>Access turned off</h1><p class="sub">${esc(r.data.message || "Talk to the office.")}</p></div>`, null);
      if (!r.ok) throw new Error((r.data && r.data.message) || "Could not load route");
      route = r.data; if (route.date === todayLocal()) await Store.set("route", route);
    } catch (e) {
      if (pick.date) { pick.date = ""; return show(`<div class="screen"><h1>No signal</h1><p class="sub">Looking ahead at another day needs signal.</p><button class="btn" id="retry">Back to today</button></div>`, null), ($("#retry").onclick = loadRoute); }
      const cached = await Store.get("route");
      if (cached && cached.date === todayLocal()) { route = cached; offlineRoute = true; }
      else if (cached) { route = cached; offlineRoute = true; }
      else return show(`<div class="screen"><h1>Can't load your route</h1><p class="sub">You need signal the first time you open the app each day.</p><button class="btn" id="retry">Try again</button></div>`, null), ($("#retry").onclick = loadRoute);
    }
    markDoneFromQueue();
    const draft = await Store.get("draft");
    if (draft && draft.stop) return resumeDraft(draft);
    renderRoute();
  }
  async function markDoneFromQueue() {
    if (!route) return;
    const localDone = JSON.parse(ls.get("tap_done_" + route.date) || "[]");
    route.stops.forEach(s => { if (localDone.includes(s.customerId)) s.done = true; });
  }
  function renderRoute() {
    const stops = route.stops || [];
    const n = stops.filter(s => s.done).length;
    const last = id => (route.lastVisits || []).find(l => l.customerId === id);
    const dayLabel = route.day + ", " + fmtDate(route.date + "T12:00:00Z");
    const isToday = route.date === todayLocal();
    show(`<div class="screen">
      ${route.admin ? adminPicker() : dayStrip()}
      <div><h1>${isToday ? "Today's stops" : esc(route.day) + "'s stops"}${route.admin ? " · Route " + esc(route.routeNum) : ""}</h1><p class="sub">${esc(dayLabel)} · Phase ${esc(route.phase)} · ${n} of ${stops.length} done</p>
      ${isToday ? "" : `<div class="offline">Planning view. Visits can only be recorded on the day itself.</div>`}
      ${offlineRoute ? `<div class="offline">No signal. Showing the route saved on this phone${route.date !== todayLocal() ? " from " + esc(fmtDate(route.date + "T12:00:00Z")) : ""}.</div>` : ""}</div>
      ${stops.length ? `<div class="list">${stops.map((s, i) => {
        const l = last(s.customerId);
        const pill = s.done ? '<span class="pill done">Done</span>' : l ? `<span class="pill todo">Last ${esc(fmtDate(l.lastVisitDate))}</span>` : '<span class="pill new">First visit</span>';
        const inner = `<div class="meta"><div class="num">#${esc(s.customerId)}</div><div class="name">${esc(s.name)}</div><div class="addr">${esc(s.location || "")}</div></div>${pill}`;
        return isToday ? `<button class="stop" data-i="${i}">${inner}</button>` : `<div class="stop plan">${inner}</div>`;
      }).join("")}</div>` : `<div class="card"><p>No stops are scheduled on ${isToday ? "your route today" : "this day"}.</p></div>`}
      <button class="btn ghost" id="reload">Refresh stops</button>
      <button class="btn ghost" id="out">Lock app</button>
    </div>`, null);
    app.querySelectorAll("button.stop").forEach(b => b.onclick = () => startVisit(stops[+b.dataset.i]));
    app.querySelectorAll(".day").forEach(b => b.onclick = () => { pick.date = b.dataset.d === todayLocal() ? "" : b.dataset.d; loadRoute(); });
    $("#reload").onclick = loadRoute;
    if (route.admin) { const sel = $("#aroute"); const want = String(route.routeNum || "").trim(); if ([...sel.options].some(o => o.value.trim() === want)) sel.value = [...sel.options].find(o => o.value.trim() === want).value; }
    if (route.admin) $("#ashow").onclick = () => {
      pick.route = $("#aroute").value; pick.date = $("#adate").value === todayLocal() ? "" : $("#adate").value;
      try { localStorage.setItem("tap_admin_route", pick.route); } catch (e) {}
      loadRoute();
    };
    $("#out").onclick = async () => {
      await refreshQueue();
      await Store.del("session"); session = null; toLogin();
    };
  }

  // Today plus the next 6 days, so cleaners can plan ahead (e.g. the night before).
  function dayStrip() {
    const days = [];
    for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() + i); days.push(d); }
    const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return `<div class="days" role="group" aria-label="Pick a day">${days.map((d, i) => {
      const v = iso(d), lab = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "short" });
      return `<button class="day" data-d="${v}" aria-pressed="${v === route.date}"><b>${lab}</b><span>${d.getMonth() + 1}/${d.getDate()}</span></button>`;
    }).join("")}</div>`;
  }

  function adminPicker() {
    const opts = (route.routes || []).slice().sort((x, y) => String(x.routeNum).localeCompare(String(y.routeNum)));
    return `<div class="card screen"><div class="hint" style="margin:0"><b>Admin view.</b> Pick any route and day. Visits you submit are recorded under your name.</div>
      <div><label for="aroute">Route</label><select id="aroute">${opts.map(o => `<option value="${esc(o.routeNum)}" ${String(o.routeNum) === String(route.routeNum) ? "selected" : ""}>${esc(o.routeNum)} · ${esc(o.name || "")}</option>`).join("")}</select></div>
      <div><label for="adate">Day</label><input type="date" id="adate" value="${esc(route.date)}"></div>
      <button class="btn small" id="ashow">Show stops</button></div>`;
  }

  /* ---------- visit ---------- */
  function newVisitId(cust) {
    const d = todayLocal().replace(/-/g, "");
    const r = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `DV-${d}-${cust}-${r}`;
  }
  function startVisit(stop) {
    const l = (route.lastVisits || []).find(x => x.customerId === stop.customerId);
    const prev = l ? (l.taps || []).slice().sort((a, b) => (a.tap || 0) - (b.tap || 0)).map(t => ({ brand: t.brand, pending: t.status === "Pending" })) : [];
    V = { visitId: newVisitId(stop.customerId), stop, prev: prev.map(p => p.brand), lastDate: l ? l.lastVisitDate : null,
      taps: prev.length ? prev : [{ brand: "", pending: false }], removed: [], photo: null, answers: {}, sig: null,
      mgrName: "", noMgr: false, noMgrReason: "" };
    saveDraft(); taps();
  }
  function resumeDraft(d) {
    show(`<div class="screen"><h1>Unfinished visit</h1><p class="sub">You started a visit at <b>${esc(d.stop.name)}</b> that wasn't submitted.</p>
      <button class="btn" id="resume">Continue that visit</button><button class="btn ghost" id="discard">Discard it</button></div>`, null);
    $("#resume").onclick = () => { V = d; taps(); };
    $("#discard").onclick = async () => { if (confirm("Discard the unfinished visit?")) { await Store.del("draft"); V = null; renderRoute(); } };
  }
  const brandList = () => route.brands || [];
  const brandInfo = name => brandList().find(b => norm(b.name) === norm(name));

  function taps() {
    const st = V.stop;
    show(`<div class="screen">
      <div><h1>${esc(st.name)}</h1><p class="sub">${V.prev.length ? `Filled in from the last visit on ${esc(fmtDate(V.lastDate))}. Change anything that's different today.` : "First visit. Add every brand on draft."}</p></div>
      <div class="summary" id="sum"></div>
      <div class="list" id="taplist"></div>
      <div id="rem"></div>
      <button class="btn ghost" id="add">+ Add tap</button>
      <div class="err" id="terr" hidden></div>
      <div class="actions"><button class="btn ghost small" id="back">Stops</button><button class="btn" id="next">Next: photo</button></div>
    </div>`, 0);
    renderTaps();
    $("#add").onclick = () => { V.taps.push({ brand: "", pending: false }); renderTaps(); const ins = app.querySelectorAll(".tapin input"); ins[ins.length - 1].focus(); };
    $("#back").onclick = async () => { await saveDraft(); V = null; await Store.del("draft"); renderRoute(); };
    $("#next").onclick = () => {
      V.taps = V.taps.filter(t => t.brand && t.brand.trim());
      const names = V.taps.map(t => norm(t.brand)), dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) { V.taps.push({ brand: "", pending: false }); renderTaps(); const e = $("#terr"); e.hidden = false; e.textContent = "The same brand is on two taps. Remove the duplicate."; return; }
      if (!V.taps.length && !confirm("No taps entered. Does this account have no draft right now?")) { V.taps = [{ brand: "", pending: false }]; renderTaps(); return; }
      saveDraft(); photo();
    };
  }
  function renderTaps() {
    const L = $("#taplist"), prev = V.prev.map(norm);
    L.innerHTML = V.taps.map((t, i) => {
      const isNew = t.brand && prev.length && !prev.includes(norm(t.brand));
      const tag = t.pending ? '<span class="pill wait tag">Not listed</span>' : isNew ? '<span class="pill new tag">New</span>' : "";
      return `<div class="tap"><div class="tapno">${i + 1}</div><div class="tapin"><input type="text" aria-label="Tap ${i + 1} brand" placeholder="Type a brand" class="${tag ? "tagged" : ""}" value="${esc(t.brand)}" autocomplete="off" autocapitalize="characters" data-i="${i}">${tag}</div><button class="x" data-i="${i}" aria-label="Remove tap ${i + 1}">×</button></div>`;
    }).join("");
    L.querySelectorAll(".x").forEach(b => b.onclick = () => {
      const i = +b.dataset.i, t = V.taps[i]; V.taps.splice(i, 1);
      if (t.brand && prev.includes(norm(t.brand))) V.removed.push(t.brand);
      if (!V.taps.length) V.taps = [{ brand: "", pending: false }];
      saveDraft(); renderTaps();
    });
    L.querySelectorAll(".tapin input").forEach(wireSearch);
    const filled = V.taps.filter(t => t.brand);
    const added = prev.length ? filled.filter(t => !prev.includes(norm(t.brand))).length : 0;
    $("#sum").innerHTML = `<div class="stat"><b>${filled.length}</b><span>Taps</span></div><div class="stat"><b>${added}</b><span>Added</span></div><div class="stat"><b>${V.removed.length}</b><span>Removed</span></div>`;
    $("#rem").innerHTML = V.removed.length ? `<div class="removed"><strong>Removed since last visit</strong>${V.removed.map((r, i) => `<div><span>${esc(r)}</span><button class="linkbtn" data-i="${i}">Undo</button></div>`).join("")}</div>` : "";
    $("#rem").querySelectorAll(".linkbtn").forEach(b => b.onclick = () => {
      const name = V.removed.splice(+b.dataset.i, 1)[0];
      const blank = V.taps.findIndex(t => !t.brand);
      const info = brandInfo(name);
      const tap = { brand: info ? info.name : name, pending: !info };
      if (blank > -1) V.taps[blank] = tap; else V.taps.push(tap);
      saveDraft(); renderTaps();
    });
  }
  function wireSearch(inp) {
    const box = inp.parentElement; let hl = -1, items = [];
    const close = () => { const s = box.querySelector(".sugg"); if (s) s.remove(); hl = -1; };
    const pick = (name, pending) => {
      const i = +inp.dataset.i;
      const other = V.taps.findIndex((t, j) => j !== i && norm(t.brand) === norm(name));
      if (other > -1) { inp.value = ""; inp.placeholder = `${name} is already on tap ${other + 1}`; close(); return; }
      V.taps[i] = { brand: name, pending: !!pending };
      V.removed = V.removed.filter(r => norm(r) !== norm(name));
      close(); saveDraft(); renderTaps();
    };
    const draw = () => {
      close();
      const q = inp.value.trim(); if (!q) return;
      const words = q.toUpperCase().split(/\s+/);
      items = brandList().filter(b => { const n = b.name.toUpperCase(); return words.every(w => n.includes(w)); }).slice(0, 7);
      const exact = items.some(b => norm(b.name) === norm(q));
      const d = document.createElement("div"); d.className = "sugg";
      d.innerHTML = items.map((b, j) => `<button type="button" class="${j === hl ? "hl" : ""}" data-n="${esc(b.name)}"><span>${esc(b.name)}</span><small>${esc(b.supplier || "")}</small></button>`).join("")
        + (exact ? "" : `<button type="button" class="addnew" data-new="1"><span>Not listed? Add “${esc(q)}”</span><small>Office will review</small></button>`);
      d.querySelectorAll("button[data-n]").forEach(b => b.onpointerdown = e => { e.preventDefault(); pick(b.dataset.n, false); });
      const nb = d.querySelector("button[data-new]");
      if (nb) nb.onpointerdown = e => { e.preventDefault(); if (confirm(`Add “${q}” as a brand that isn't on the list? The office will match it to the right brand.`)) pick(q.toUpperCase(), true); };
      box.appendChild(d);
    };
    inp.oninput = () => { hl = -1; draw(); };
    inp.onkeydown = e => {
      if (!items.length) return;
      if (e.key === "ArrowDown") { hl = Math.min(hl + 1, items.length - 1); draw(); e.preventDefault(); }
      if (e.key === "ArrowUp") { hl = Math.max(hl - 1, 0); draw(); e.preventDefault(); }
      if (e.key === "Enter" && hl > -1) { pick(items[hl].name, false); e.preventDefault(); }
    };
    inp.onblur = () => setTimeout(() => { close(); const i = +inp.dataset.i; if (V && V.taps[i] && inp.value !== V.taps[i].brand) inp.value = V.taps[i].brand || ""; }, 150);
  }

  function photo() {
    show(`<div class="screen">
      <div><h1>Photo of the taps</h1><p class="sub">One clear photo of all the tap handles.</p></div>
      <input type="file" id="ph" accept="image/*" capture="environment" hidden>
      <label class="photo-drop" for="ph">${V.photo ? `<img class="photo-prev" src="${V.photo}" alt="Tap handle photo">` : "<strong>Take photo</strong><br>or choose one from your phone"}</label>
      ${V.photo ? '<button class="btn ghost" id="retake">Retake photo</button>' : ""}
      <div class="err" id="perr" hidden></div>
      <div class="actions"><button class="btn ghost small" id="back">Back</button><button class="btn" id="next" ${V.photo || !CFG.PHOTO_REQUIRED ? "" : "disabled"}>Next: cleaning</button></div>
    </div>`, 1);
    $("#ph").onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      compress(f).then(u => { V.photo = u; saveDraft(); photo(); }).catch(() => { const p = $("#perr"); p.hidden = false; p.textContent = "Couldn't read that photo. Try again."; });
    };
    if ($("#retake")) $("#retake").onclick = () => $("#ph").click();
    $("#back").onclick = taps; $("#next").onclick = cleaning;
  }
  function compress(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, CFG.PHOTO_MAX_PX / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = rej; img.src = url;
    });
  }

  function cleaning() {
    CFG.QUESTIONS.forEach(q => { if (q.prefillTapCount && V.answers[q.id] == null) V.answers[q.id] = String(V.taps.length); });
    show(`<div class="screen">
      <div><h1>Line cleaning</h1><p class="sub">${esc(V.stop.name)}</p></div>
      <div class="card">${CFG.QUESTIONS.map((q, i) => `<div class="q"><span class="qn">Question ${i + 1}${q.required ? "" : " (optional)"}</span><label for="${q.id}">${esc(q.text)}</label>${qInput(q)}</div>`).join("")}</div>
      <div class="err" id="qerr" hidden>Answer every required question to continue.</div>
      <div class="actions"><button class="btn ghost small" id="back">Back</button><button class="btn" id="next">Next: sign-off</button></div>
    </div>`, 2);
    app.querySelectorAll(".seg").forEach(g => g.querySelectorAll("button").forEach(b => b.onclick = () => {
      V.answers[g.dataset.q] = b.dataset.v; g.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); saveDraft();
    }));
    app.querySelectorAll("[data-qin]").forEach(el => el.oninput = () => { V.answers[el.id] = el.value; saveDraft(); });
    $("#back").onclick = photo;
    $("#next").onclick = () => {
      const miss = CFG.QUESTIONS.some(q => q.required && (V.answers[q.id] == null || String(V.answers[q.id]).trim() === ""));
      $("#qerr").hidden = !miss; if (!miss) signoff();
    };
  }
  function qInput(q) {
    const v = V.answers[q.id];
    if (q.type === "yn" || q.type === "pick") {
      const opts = q.type === "yn" ? ["Yes", "No"] : q.opts;
      return `<div class="seg" data-q="${q.id}" id="${q.id}">${opts.map(o => `<button type="button" data-v="${esc(o)}" aria-pressed="${v === o}">${esc(o)}</button>`).join("")}</div>`;
    }
    if (q.type === "num") return `<input type="number" inputmode="decimal" id="${q.id}" data-qin value="${esc(v == null ? "" : v)}">`;
    return `<textarea id="${q.id}" data-qin>${esc(v || "")}</textarea>`;
  }

  function signoff() {
    show(`<div class="screen">
      <div><h1>Manager sign-off</h1><p class="sub">Hand the phone to the manager on duty.</p></div>
      <div class="card screen" id="mgrcard" ${V.noMgr ? "hidden" : ""}>
        <div><label for="mgr">Manager's printed name</label><input type="text" id="mgr" value="${esc(V.mgrName)}" autocomplete="off" autocapitalize="words"></div>
        <div><label>Signature</label>
          <div class="sigbox"><canvas class="sig" id="sig" aria-label="Signature pad"></canvas><div class="sigline"></div></div>
          <div class="hint">I confirm the draft lines at ${esc(V.stop.name)} were cleaned today. <button class="linkbtn" id="clear">Clear</button></div></div>
      </div>
      <div class="card screen">
        <label class="check"><input type="checkbox" id="nomgr" ${V.noMgr ? "checked" : ""}> Manager unavailable</label>
        <div id="whybox" ${V.noMgr ? "" : "hidden"}><label for="why">Reason</label><input type="text" id="why" placeholder="e.g. Manager off site, bartender only" value="${esc(V.noMgrReason)}"></div>
      </div>
      <div class="err" id="serr" hidden></div>
      <div class="actions"><button class="btn ghost small" id="back">Back</button><button class="btn" id="next">Review</button></div>
    </div>`, 3);
    const cv = $("#sig"); let ctx = null, drawing = false;
    const setup = () => {
      const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      cv.width = r.width * d; cv.height = r.height * d;
      const c = cv.getContext("2d"); c.scale(d, d); c.lineWidth = 2.4; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "#111";
      c.fillStyle = "#fff"; c.fillRect(0, 0, r.width, r.height);
      if (V.sig) { const im = new Image(); im.onload = () => c.drawImage(im, 0, 0, r.width, r.height); im.src = V.sig; }
      return c;
    };
    if (!V.noMgr) ctx = setup();
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.onpointerdown = e => { drawing = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); };
    cv.onpointermove = e => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); };
    cv.onpointerup = () => { if (!drawing) return; drawing = false; V.sig = cv.toDataURL("image/png"); saveDraft(); };
    $("#clear").onclick = () => { V.sig = null; ctx = setup(); saveDraft(); };
    $("#mgr").oninput = e => { V.mgrName = e.target.value; saveDraft(); };
    $("#why").oninput = e => { V.noMgrReason = e.target.value; saveDraft(); };
    $("#nomgr").onchange = e => { V.noMgr = e.target.checked; $("#mgrcard").hidden = V.noMgr; $("#whybox").hidden = !V.noMgr; if (!V.noMgr && !ctx) ctx = setup(); saveDraft(); };
    $("#back").onclick = cleaning;
    $("#next").onclick = () => {
      let msg = "";
      if (V.noMgr) { if (!V.noMgrReason.trim()) msg = "Enter why no manager could sign."; }
      else if (!V.mgrName.trim()) msg = "Enter the manager's printed name.";
      else if (!V.sig) msg = "The manager needs to sign in the box.";
      const e = $("#serr"); e.hidden = !msg; e.textContent = msg; if (!msg) review();
    };
  }

  function review() {
    const prev = V.prev.map(norm);
    show(`<div class="screen">
      <div><h1>Review visit</h1><p class="sub">Check everything, then submit. With no signal, the visit is saved on this phone and sent automatically later.</p></div>
      <div class="card"><h2>Taps (${V.taps.length})</h2><dl>${V.taps.map((t, i) => `<dt class="mono">${i + 1}</dt><dd>${esc(t.brand)}${t.pending ? ' <span class="pill wait">Not listed</span>' : prev.length && !prev.includes(norm(t.brand)) ? ' <span class="pill new">New</span>' : ""}</dd>`).join("")}</dl>
        ${V.removed.length ? `<p class="hint">Removed: ${V.removed.map(esc).join(", ")}</p>` : ""}</div>
      ${V.photo ? `<div class="card"><h2>Photo</h2><img class="photo-prev" src="${V.photo}" alt="Tap handle photo"></div>` : ""}
      <div class="card"><h2>Line cleaning</h2><dl>${CFG.QUESTIONS.map((q, i) => `<dt class="mono">Q${i + 1}</dt><dd>${esc(V.answers[q.id] || "—")}</dd>`).join("")}</dl></div>
      <div class="card"><h2>Sign-off</h2>${V.noMgr ? `<p>Manager unavailable: ${esc(V.noMgrReason)}</p>` : `<p>${esc(V.mgrName)}</p><img class="photo-prev" src="${V.sig}" alt="Manager signature" style="background:#fff;border:1px solid var(--line)">`}</div>
      <div class="actions"><button class="btn ghost small" id="back">Back</button><button class="btn" id="submit">Submit visit</button></div>
    </div>`, 4);
    $("#back").onclick = signoff;
    $("#submit").onclick = submit;
  }

  async function submit() {
    const b = $("#submit"); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    const cleaning = {};
    CFG.QUESTIONS.forEach((q, i) => { cleaning["q" + (i + 1)] = V.answers[q.id] == null ? "" : String(V.answers[q.id]); });
    const pq = CFG.QUESTIONS.find(q => q.problemFlag);
    cleaning.problem = !!(pq && String(V.answers[pq.id] || "").trim());
    const payload = {
      visitId: V.visitId, customerId: V.stop.customerId,
      taps: V.taps.map((t, i) => ({ tap: i + 1, brand: t.brand, status: t.pending ? "Pending" : "OK" })),
      photo: V.photo || "", cleaning,
      manager: { name: V.noMgr ? "" : V.mgrName.trim(), signature: V.noMgr ? "" : (V.sig || ""), unavailable: V.noMgr, reason: V.noMgr ? V.noMgrReason.trim() : "" }
    };
    await Store.queueAdd({ visitId: V.visitId, payload, savedAt: Date.now(), customerName: V.stop.name });
    const doneKey = "tap_done_" + (route.date || todayLocal());
    const done = JSON.parse(ls.get(doneKey) || "[]"); if (!done.includes(V.stop.customerId)) done.push(V.stop.customerId); ls.set(doneKey, JSON.stringify(done));
    V.stop.done = true;
    const stopName = V.stop.name, tapCount = V.taps.length;
    await Store.del("draft"); V = null;
    registerSync();
    const res = await flush();
    const sent = res.left === 0 || !(await Store.queueAll()).some(q => q.payload && q.payload.visitId === payload.visitId);
    show(`<div class="screen center">
      <div class="done-mark" aria-hidden="true">${sent ? "✓" : "⇡"}</div>
      <div><h1>${sent ? "Visit submitted" : "Visit saved"}</h1><p class="sub">${esc(stopName)} · ${tapCount} taps</p>
      <p>${sent ? '<span class="ok">Sent to the office.</span>' : "Saved on this phone. It will send automatically when you have signal."}</p></div>
      <button class="btn" id="next">Back to today's stops</button>
    </div>`, null);
    $("#next").onclick = () => renderRoute();
  }

  /* ---------- start up ---------- */
  async function boot() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
      navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.type === "flushed") refreshQueue(); });
      navigator.serviceWorker.ready.then(reg => { if (reg.periodicSync) reg.periodicSync.register("send-visits", { minInterval: 15 * 60 * 1000 }).catch(() => {}); }).catch(() => {});
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    window.addEventListener("online", () => { renderNet(); flush(); });
    window.addEventListener("offline", renderNet);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") flush(); });
    setInterval(() => { if (navigator.onLine) flush(); }, (CFG.RETRY_SECONDS || 60) * 1000);

    await refreshQueue();
    try { device = await Store.get("device"); session = await Store.get("session"); } catch (e) { session = null; }
    if (!device) { session = null; return toRegister(); }
    if (session && session.expiresAt && new Date(session.expiresAt) > new Date()) { flush(); loadRoute(); }
    else { session = null; toLogin(queueCount ? "Sign in to send the visits waiting on this phone." : ""); }
  }
  boot();
})();
