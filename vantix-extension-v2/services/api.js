// ─── Vantix API Service ───────────────────────────────────────────────────────
// Purpose : Talk to the Chrome Background script to bypass CORS
// ─────────────────────────────────────────────────────────────────────────────

async function fetchCompanyRules() {
  const stored = await new Promise((res) =>
    chrome.storage.local.get(["vantixToken"], res)
  );

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "FETCH_RULES",
        token: stored.vantixToken
      },
      (response) => {
        if (response && response.success) {
          console.log("Rules from background:", response);
          resolve({
            companyRules: response.companyRules || {},
            generalRules: response.generalRules || {}
          });
        } else {
          console.warn("Using fallback rules");
          resolve({ companyRules: {}, generalRules: {} });
        }
      }
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function logViolation(matches, pageUrl) {
  if (!matches || matches.length === 0) return;

  const stored = await new Promise((res) =>
    chrome.storage.local.get(["vantixToken", "vantixUserType", "vantixScanCount"], res)
  );

  if (stored.vantixUserType === "individual") {
    const newCount = (stored.vantixScanCount || 0) + 1;

    await new Promise(res =>
      chrome.storage.local.set({ vantixScanCount: newCount }, res)
    );
  }

  const payload = {
    url: pageUrl || window.location.href,
    matches: matches.map((m) => ({ type: m.type })),
    timestamp: new Date().toISOString(),
  };

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "LOG_VIOLATION",
        token: stored.vantixToken,
        payload
      },
      (response) => {
        if (response && response.success) {
          console.log("[Vantix] Violation logged via background ✓", payload);
        } else {
          console.warn("[Vantix] Log failed via background");
        }
        resolve();
      }
    );
  });
}