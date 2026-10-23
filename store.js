// Shared by the page and the service worker. IndexedDB keeps queued visits (with photos) and the session.
(function (g) {
  const DB = "tapsurvey", VER = 1;
  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("queue")) d.createObjectStore("queue", { keyPath: "visitId" });
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => { d.close(); res(out); };
      t.onerror = t.onabort = () => { d.close(); rej(t.error); };
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const Store = {
    get: k => tx("kv", "readonly", s => req(s.get(k))),
    set: (k, v) => tx("kv", "readwrite", s => req(s.put(v, k))),
    del: k => tx("kv", "readwrite", s => req(s.delete(k))),
    queueAdd: v => tx("queue", "readwrite", s => req(s.put(v))),
    queueAll: () => tx("queue", "readonly", s => req(s.getAll())),
    queueDel: id => tx("queue", "readwrite", s => req(s.delete(id))),
    queueCount: () => tx("queue", "readonly", s => req(s.count()))
  };

  // Send every queued visit. Returns {sent, left, needLogin, deviceRevoked}.
  let flushing = null;
  Store.flush = function () {
    if (flushing) return flushing;
    flushing = (async () => {
      const cfg = g.TAP_CONFIG;
      const session = await Store.get("session"), device = (await Store.get("device")) || {};
      const items = (await Store.queueAll()).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
      let sent = 0, needLogin = false, deviceRevoked = false;
      if (!session || !session.token) return { sent, left: items.length, needLogin: items.length > 0 };
      for (const v of items) {
        try {
          const body = Object.assign({}, v.payload, { token: session.token, deviceId: device.deviceId, deviceKey: device.deviceKey });
          const r = await fetch(cfg.SUBMIT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          let j = {};
          try { j = await r.json(); } catch (e) {}
          if (r.ok && j.ok) { await Store.queueDel(v.visitId); sent++; continue; }
          if (r.status === 401) { if (j.error === "device") deviceRevoked = true; else needLogin = true; break; }
          if (r.status === 403) {
            // Not allowed (stop not on route / access off). Keep it but mark so the user sees it.
            v.error = j.message || "Not allowed"; await Store.queueAdd(v); continue;
          }
          break; // server error: try again later
        } catch (e) { break; } // offline
      }
      const left = await Store.queueCount();
      return { sent, left, needLogin, deviceRevoked };
    })().finally(() => { flushing = null; });
    return flushing;
  };

  g.TapStore = Store;
})(typeof self !== "undefined" ? self : window);
