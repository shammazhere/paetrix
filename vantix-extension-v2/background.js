chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Fetch rules — returns { companyRules, generalRules } ──────────────────
  if (message.type === "FETCH_RULES") {
    fetch("http://localhost:5000/api/rules", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: message.token ? `Bearer ${message.token}` : "",
      },
    })
      .then((res) => res.json())
      .then((data) => {
        // Backend now returns { companyRules, generalRules }
        // Fall back gracefully if old shape arrives
        const companyRules = data.companyRules || data.data || data || {};
        const generalRules = data.generalRules || {};
        sendResponse({ success: true, companyRules, generalRules });
      })
      .catch((err) => {
        console.error("[Vantix BG] Fetch rules error:", err);
        sendResponse({ success: false });
      });

    return true; // keep channel open for async response
  }

  // ── Audit logging ─────────────────────────────────────────────────────────
  if (message.type === "LOG_AUDIT") {
    fetch("http://localhost:5000/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload)
    })
    .catch(async () => {
      const data = await chrome.storage.local.get(["vantixOfflineAuditLogs"]);
      const logs = data.vantixOfflineAuditLogs || [];
      logs.push(message.payload);
      await chrome.storage.local.set({ vantixOfflineAuditLogs: logs });
    });
  }

  // ── Log violation ─────────────────────────────────────────────────────────
  if (message.type === "LOG_VIOLATION") {
    fetch("http://localhost:5000/api/violations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: message.token ? `Bearer ${message.token}` : "",
      },
      body: JSON.stringify(message.payload),
    })
      .then((res) => res.json())
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => {
        console.error("[Vantix BG] Log violation error:", err);
        sendResponse({ success: false });
      });

    return true;
  }

  // ── Heartbeat Ping ────────────────────────────────────────────────────────
  if (message.type === "PING_HEARTBEAT") {
    const platform = message.platform || "Unknown";
    const storageKey = `vantixLastHeartbeat_${platform}`;
    
    chrome.storage.local.get([storageKey], (res) => {
      const now = Date.now();
      const last = res[storageKey] || 0;
      // Send once a day (24 hours) per platform
      if (now - last > 24 * 60 * 60 * 1000) {
        fetch("http://localhost:5000/api/activity", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: message.token ? `Bearer ${message.token}` : "",
          },
          body: JSON.stringify({ platform }),
        })
          .then((res) => res.json())
          .then(() => chrome.storage.local.set({ [storageKey]: now }))
          .catch((err) => console.error("[Vantix BG] Heartbeat error:", err));
      }
    });
    return true;
  }
});