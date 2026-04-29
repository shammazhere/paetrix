// ─── Vantix Content Script ────────────────────────────────────────────────────
// Load order: services/api.js → utils/redactor.js → detector.js → content.js
(function () {
  "use strict";

  if (window.location.protocol === "chrome:" || window.location.href.startsWith("chrome://")) {
    console.warn("[Vantix] Skipping chrome internal page");
    return;
  }

  console.log("[Vantix] Running on:", window.location.href);

  // ── Selectors ──────────────────────────────────────────────────────────────
  const INPUT_SELECTORS = [
    "#prompt-textarea",
    "div[contenteditable='true']",
    "textarea",
  ];
  const SEND_BUTTON_SELECTORS = [
    "button[data-testid='send-button']",
    "button[aria-label='Send message']",
    "button[aria-label='Send Message']",
    "button[aria-label='Submit message']",
    "button[type='submit']",
  ];

  // ── State ──────────────────────────────────────────────────────────────────
  let lastText       = "";
  let warningVisible = false;
  let currentMatches = [];
  let sendBlocked    = false;
  let toastShown     = false;
  let isProtectionEnabled = true;

  // ── Hash-based detection state ─────────────────────────────────────────────
  let companyApiKeyHashes    = [];  // [{ hash, label }, ...]
  let companySensitiveHashes = [];  // [{ hash, label, type }, ...]

  // ── Settings defaults (kept in sync via storage listener) ─────────────────
  const SETTINGS_DEFAULTS = {
    enableEmailDetection:      true,
    enableApiKeyDetection:     true,
    enableCreditCardDetection: true,
    enablePhoneDetection:      true,
    enableAadhaarDetection:    true,
    enablePanDetection:        true,
    sensitiveKeywords:         [],
  };

  // ── Startup ────────────────────────────────────────────────────────────────
  let scanInterval = null;

  async function startDetection() {
    const { vantixToken, vantixIndividualToken, vantixUserType } = await new Promise((res) =>
      chrome.storage.local.get(["vantixToken", "vantixIndividualToken", "vantixUserType"], res)
    );

    if (!vantixToken && !vantixIndividualToken) {
      console.warn("[Vantix] Not logged in — detection halted.");
      return;
    }

    chrome.storage.local.get(["isProtectionEnabled"], (res) => {
      isProtectionEnabled = res.isProtectionEnabled ?? true;
    });

    chrome.storage.local.get(SETTINGS_DEFAULTS, (settings) => {
      applyStorageSettings(settings);
      console.log("[Vantix] Storage settings applied ✓");
    });

    if (vantixUserType !== "individual") {
      chrome.runtime.sendMessage(
        { type: "FETCH_RULES", token: vantixToken },
        (response) => {
          if (response?.success) {
            loadBackendRules({
              companyRules: response.companyRules,
              generalRules: response.generalRules,
            });

            // ── Populate hash arrays for encrypted field detection ──────────
            companyApiKeyHashes    = (response.companyRules?.apiKeys          || []).map((k) => ({ hash: k.hash, label: k.label }));
            companySensitiveHashes = (response.companyRules?.sensitiveNumbers || []).map((n) => ({ hash: n.hash, label: n.label, type: n.type }));
            console.log(`[Vantix] Loaded ${companyApiKeyHashes.length} API key hashes, ${companySensitiveHashes.length} number hashes`);
          } else {
            console.warn("[Vantix] Could not load backend rules — using local fallback.");
          }
        }
      );
    }

    let platform = "Unknown";
    const hostname = window.location.hostname;
    if (hostname.includes("chatgpt.com")) platform = "ChatGPT";
    else if (hostname.includes("gemini.google.com")) platform = "Gemini";
    else if (hostname.includes("claude.ai")) platform = "Claude";
    else if (hostname.includes("copilot.microsoft.com")) platform = "Copilot";
    else if (hostname.includes("perplexity.ai")) platform = "Perplexity";
    else if (hostname.includes("chat.deepseek.com")) platform = "DeepSeek";
    else if (hostname.includes("grok.com")) platform = "Grok";
    else if (hostname.includes("meta.ai")) platform = "Meta AI";
    else if (hostname.includes("huggingface.co")) platform = "HuggingChat";
    else if (hostname.includes("chat.mistral.ai")) platform = "Mistral";
    else platform = hostname;

    chrome.runtime.sendMessage({ type: "PING_HEARTBEAT", token: vantixToken, platform });

    if (!scanInterval) {
      scanInterval = setInterval(scan, 500);
      document.addEventListener("input", scan, { passive: true });
    }
    console.log("[Vantix] v2 detection started ✓");
  }

  // ── Storage change listener ────────────────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.vantixToken || changes.vantixIndividualToken) {
      startDetection();
    }

    if (changes.isProtectionEnabled) {
      isProtectionEnabled = changes.isProtectionEnabled.newValue;
      if (!isProtectionEnabled) {
        hideWarning();
        unblockSendButton();
        currentMatches = [];
        lastText = "";
        scan();
        return;
      }
    }

    const relevantKeys = [
      "enableEmailDetection",
      "enableApiKeyDetection",
      "enableCreditCardDetection",
      "enablePhoneDetection",
      "enableAadhaarDetection",
      "enablePanDetection",
      "sensitiveKeywords",
    ];

    const hasRelevantChange = relevantKeys.some((key) => key in changes);
    if (!hasRelevantChange) return;

    const updated = {};
    relevantKeys.forEach((key) => {
      if (changes[key] !== undefined) updated[key] = changes[key].newValue;
    });

    applyStorageSettings(updated);
    console.log("[Vantix] Settings updated from popup:", updated);

    lastText = "";
    scan();
  });

  startDetection();

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function getInputBox() {
    for (const sel of INPUT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function getSendButton() {
    for (const sel of SEND_BUTTON_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function getText(el) {
    if (!el) return "";
    return el.value !== undefined && el.value !== null ? el.value : (el.innerText || "");
  }

  function setText(el, text) {
    if (!el) return;
    if (el.value !== undefined && el.value !== null) {
      const setter =
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set ||
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,    "value")?.set;
      setter ? setter.call(el, text) : (el.value = text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.innerText = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }

  // ── Masking helpers ────────────────────────────────────────────────────────
  function maskValue(value) {
    if (!value || value.length <= 6) return "••••••";
    return value.slice(0, 3) + "•".repeat(Math.min(value.length - 6, 8)) + value.slice(-3);
  }

  function applyMaskInField(field, originalValue) {
    const current = getText(field);
    // Use the requested '***' format for the middle portion
    const masked  = originalValue.length > 4 
      ? originalValue.slice(0, 1) + "***" + originalValue.slice(-1)
      : "***";
    const regex   = new RegExp(originalValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    setText(field, current.replace(regex, masked));
  }

  // ── Company toast ──────────────────────────────────────────────────────────
  function showCompanyToast(count) {
    if (toastShown) return;
    toastShown = true;

    const toast = document.createElement("div");
    toast.id = "vantix-toast";
    Object.assign(toast.style, {
      position:     "fixed",
      bottom:       "24px",
      right:        "24px",
      background:   "#1a1a2e",
      color:        "#e0e0e0",
      padding:      "10px 18px",
      borderRadius: "8px",
      fontSize:     "13px",
      zIndex:       "2147483647",
      boxShadow:    "0 4px 20px rgba(0,0,0,0.45)",
      transition:   "opacity 0.4s ease",
      opacity:      "1",
      fontFamily:   "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      maxWidth:     "320px",
      lineHeight:   "1.4",
    });
    toast.textContent = `Masking ${count} sensitive item${count > 1 ? "s" : ""} per company policy`;
    document.body.appendChild(toast);

    setTimeout(() => { toast.style.opacity = "0"; }, 3000);
    setTimeout(() => { toast.remove(); toastShown = false; }, 3400);
  }

  // ── Enter key interceptor ──────────────────────────────────────────────────
  function interceptEnter(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      const generalMatches = currentMatches.filter((m) => m.source === "general");
      if (generalMatches.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showModal(generalMatches);
      }
    }
  }

  // ── Send button blocking ───────────────────────────────────────────────────
  function blockSendButton() {
    if (sendBlocked) return;
    const btn = getSendButton();
    if (btn) {
      btn.dataset.vantixBlocked   = "true";
      btn.dataset.vantixOrigTitle = btn.title || "";
      btn.addEventListener("click", interceptSend, { capture: true });
      btn.style.opacity = "0.45";
      btn.style.cursor  = "not-allowed";
      btn.title = "Vantix: sensitive data detected — review before sending";
    }
    const input = getInputBox();
    if (input) input.addEventListener("keydown", interceptEnter, { capture: true });
    sendBlocked = true;
  }

  function unblockSendButton() {
    if (!sendBlocked) return;
    const btn = getSendButton();
    if (btn) {
      btn.removeEventListener("click", interceptSend, { capture: true });
      btn.style.opacity = "";
      btn.style.cursor  = "";
      btn.title = btn.dataset.vantixOrigTitle || "";
      delete btn.dataset.vantixBlocked;
      delete btn.dataset.vantixOrigTitle;
    }
    const input = getInputBox();
    if (input) input.removeEventListener("keydown", interceptEnter, { capture: true });
    sendBlocked = false;
  }

  function interceptSend(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const generalMatches = currentMatches.filter((m) => m.source === "general");
    if (generalMatches.length > 0) showModal(generalMatches);
  }

  // ── SHA-256 via SubtleCrypto (no library needed) ───────────────────────────
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ── Hash-based detection for API keys and sensitive numbers ────────────────
  async function detectHashedValues(text) {
    const matches = [];
    if (!companyApiKeyHashes.length && !companySensitiveHashes.length) return matches;

    // Try full text (direct paste) + individual tokens (typed/partial)
    const tokens = [...new Set([
      text.trim(),
      ...text.split(/[\s,;\n]+/).map((t) => t.trim()).filter((t) => t.length >= 8),
    ])];

    for (const token of tokens) {
      const h = await sha256(token);

      for (const k of companyApiKeyHashes) {
        if (k.hash === h) {
          matches.push({ type: "API Key", subtype: k.label, value: token, source: "company" });
        }
      }
      for (const n of companySensitiveHashes) {
        if (n.hash === h) {
          matches.push({ type: n.type, subtype: n.label, value: token, source: "company" });
        }
      }
    }

    return matches;
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  function showModal(matches) {
    const existing = document.getElementById("vantix-modal");
    if (existing) existing.remove();

    const rows = matches.map((m, i) => `
      <li style="display:flex;align-items:center;gap:10px;padding:8px 0;
        border-bottom:0.5px solid #2a2a4a;">
        <input type="checkbox" id="vantix-chk-${i}" data-index="${i}"
          style="width:15px;height:15px;accent-color:#7c6af7;cursor:pointer;flex-shrink:0;">
        <label for="vantix-chk-${i}"
          style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;min-width:0;">
          <span style="background:#2a1f6e;color:#a09af5;font-size:11px;font-weight:600;
            padding:2px 8px;border-radius:4px;white-space:nowrap;flex-shrink:0;">${m.type}</span>
          <code style="font-family:monospace;font-size:12px;color:#c8c8e0;
            word-break:break-all;">${maskValue(m.value)}</code>
        </label>
      </li>`).join("");

    const modal = document.createElement("div");
    modal.id = "vantix-modal";
    Object.assign(modal.style, {
      position:       "fixed",
      inset:          "0",
      background:     "rgba(0,0,0,0.55)",
      zIndex:         "2147483647",
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
    });

    modal.innerHTML = `
      <div id="vantix-modal-box" style="background:#12122a;border:1px solid #2a2a4a;
        border-radius:12px;padding:22px 24px;width:400px;max-width:92vw;max-height:80vh;
        overflow-y:auto;color:#e0e0f0;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="font-size:15px;font-weight:600;margin-bottom:4px;">
          Warning: Sensitive data detected
        </div>
        <div style="font-size:12px;color:#8888aa;margin-bottom:14px;">
          Select items to mask inline in your message, or redact all with [REDACTED].
        </div>
        <div style="font-size:12px;color:#8888aa;margin-bottom:6px;
          display:flex;justify-content:space-between;align-items:center;">
          <span>${matches.length} item${matches.length > 1 ? "s" : ""} found</span>
          <span id="vantix-select-all"
            style="color:#7c6af7;cursor:pointer;text-decoration:underline;">
            Select all
          </span>
        </div>
        <ul id="vantix-match-list" style="list-style:none;margin:0 0 14px;padding:0;">
          ${rows}
        </ul>
        <div style="font-size:11px;color:#666688;margin-bottom:16px;line-height:1.6;">
          <b style="color:#9090b8;">Mask selected</b> — replaces chosen values with
          <code style="font-size:11px;background:#1e1e3a;padding:1px 4px;
            border-radius:3px;">***</code> inline in your message.<br>
          <b style="color:#9090b8;">Send with [REDACTED]</b> — replaces all remaining
          items before sending.<br>
          <b style="color:#e05555;">Send anyway</b> — sends your message as-is without
          any masking (violation will be logged).
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button id="vantix-btn-mask-selected"
            style="flex:1;min-width:120px;padding:8px 12px;background:#2a1f6e;
            color:#a09af5;border:1px solid #4a3fae;border-radius:7px;font-size:13px;
            cursor:pointer;font-weight:500;">
            Mask selected
          </button>
          <button id="vantix-btn-redact"
            style="flex:1;min-width:120px;padding:8px 12px;background:#1e1e3a;
            color:#c0c0e0;border:1px solid #3a3a5a;border-radius:7px;font-size:13px;
            cursor:pointer;">
            Send with [REDACTED]
          </button>
          <button id="vantix-btn-send-anyway"
            style="padding:8px 16px;background:transparent;color:#e05555;
            border:1px solid #5a2a2a;border-radius:7px;font-size:13px;cursor:pointer;"
            title="Send message without any masking or redaction">
            Send anyway
          </button>
          <button id="vantix-btn-cancel"
            style="padding:8px 16px;background:transparent;color:#666688;
            border:1px solid #2a2a4a;border-radius:7px;font-size:13px;cursor:pointer;">
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    let allSelected = false;
    document.getElementById("vantix-select-all").addEventListener("click", () => {
      allSelected = !allSelected;
      modal.querySelectorAll("input[type=checkbox]").forEach((cb) => { cb.checked = allSelected; });
      document.getElementById("vantix-select-all").textContent = allSelected ? "Deselect all" : "Select all";
      updateMaskBtnLabel();
    });

    function updateMaskBtnLabel() {
      const count = modal.querySelectorAll("input[type=checkbox]:checked").length;
      document.getElementById("vantix-btn-mask-selected").textContent =
        count > 0 ? `Mask selected (${count})` : "Mask selected";
    }
    modal.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", updateMaskBtnLabel);
    });

    document.getElementById("vantix-btn-mask-selected").addEventListener("click", () => {
      const input   = getInputBox();
      const checked = [...modal.querySelectorAll("input[type=checkbox]:checked")]
        .map((cb) => parseInt(cb.dataset.index));

      if (checked.length === 0) {
        const btn = document.getElementById("vantix-btn-mask-selected");
        btn.textContent = "Select at least one";
        setTimeout(() => { btn.textContent = "Mask selected"; }, 1500);
        return;
      }

      checked.forEach((i) => { if (input) applyMaskInField(input, matches[i].value); });

      const remaining = matches.filter((_, i) => !checked.includes(i));
      if (remaining.length === 0) {
        modal.remove();
        unblockSendButton();
        hideWarning();
        currentMatches = [];
      } else {
        currentMatches = remaining;
        modal.remove();
        showModal(remaining);
      }
    });

    document.getElementById("vantix-btn-redact").addEventListener("click", async () => {
      const input = getInputBox();
      if (input) {
        const original = getText(input);
        const redacted = redactText(original, matches);
        setText(input, redacted);
      }
      await logViolation(matches, window.location.href);
      modal.remove();
      unblockSendButton();
      hideWarning();
      lastText = ""; currentMatches = [];
      setTimeout(() => { const btn = getSendButton(); if (btn) btn.click(); }, 80);
    });

    document.getElementById("vantix-btn-send-anyway").addEventListener("click", async () => {
      await logViolation(matches, window.location.href);
      modal.remove();
      unblockSendButton();
      hideWarning();
      lastText = ""; currentMatches = [];
      setTimeout(() => { const btn = getSendButton(); if (btn) btn.click(); }, 80);
    });

    document.getElementById("vantix-btn-cancel").addEventListener("click", () => { modal.remove(); });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  }

  // ── Warning banner ─────────────────────────────────────────────────────────
  function showWarning(matches) {
    let banner = document.getElementById("vantix-warning");

    if (!banner) {
      banner = document.createElement("div");
      banner.id = "vantix-warning";

      const closeBtn = document.createElement("button");
      closeBtn.id = "vantix-close";
      closeBtn.innerHTML = "✕";
      closeBtn.title = "Dismiss";
      closeBtn.addEventListener("click", () => {
        banner.classList.remove("vantix-visible");
        warningVisible = false;
      });

      const icon = document.createElement("span");
      icon.id = "vantix-icon";
      icon.innerHTML = "!";

      const body = document.createElement("div");
      body.id = "vantix-body";

      banner.appendChild(closeBtn);
      banner.appendChild(icon);
      banner.appendChild(body);
      document.body.appendChild(banner);
    }

    document.getElementById("vantix-body").innerHTML = `
      <div class="vantix-title" style="display:flex; justify-content:space-between; align-items:center;">
        <span>${matches.length} sensitive item${matches.length > 1 ? "s" : ""} detected</span>
        <button id="vantix-mask-all-btn" style="background:#7c6af7; color:white; border:none; border-radius:4px; padding:2px 8px; font-size:10px; cursor:pointer; font-weight:bold;">MASK ALL</button>
      </div>
      <ul class="vantix-list">
        ${matches.map((m) => `
          <li>
            <span class="vantix-tag ${m.source === "company" ? "vantix-tag-company" : ""}">${m.type}</span>
            <code>${maskValue(m.value)}</code>
            ${m.source === "company" ? '<span class="vantix-auto-label">auto-masked</span>' : ""}
          </li>`).join("")}
      </ul>
    `;

    document.getElementById("vantix-mask-all-btn").addEventListener("click", () => {
      const input = getInputBox();
      if (input) {
        matches.forEach(m => applyMaskInField(input, m.value));
        hideWarning();
        unblockSendButton();
        currentMatches = [];
      }
    });

    if (!warningVisible) {
      banner.classList.add("vantix-visible");
      warningVisible = true;
    }
  }

  function hideWarning() {
    const banner = document.getElementById("vantix-warning");
    if (banner && warningVisible) {
      banner.classList.remove("vantix-visible");
      warningVisible = false;
    }
  }

  // ── Main scan loop ─────────────────────────────────────────────────────────
  async function scan() {
    if (!isProtectionEnabled) {
      hideWarning();
      unblockSendButton();
      currentMatches = [];
      return;
    }

    const input = getInputBox();
    if (!input) return;

    const text = getText(input);
    if (text === lastText) return;

    const { vantixUserType, vantixTrialExpiry, vantixScanCount } = await new Promise(res =>
      chrome.storage.local.get(["vantixUserType", "vantixTrialExpiry", "vantixScanCount"], res)
    );

    if (
      vantixUserType === "individual" &&
      (Date.now() > Date.parse(vantixTrialExpiry || 0) || (vantixScanCount || 0) >= 50)
    ) {
      return;
    }

    lastText = text;

    if (!text || !text.trim()) {
      hideWarning();
      unblockSendButton();
      currentMatches = [];
      return;
    }

    // ── Sync regex/keyword detection ──────────────────────────────────────
    const syncMatches = detectSensitiveData(text);

    // ── Async hash detection for API keys and sensitive numbers ───────────
    const hashedMatches = await detectHashedValues(text);

    // ── Async Presidio detection (Backend) ────────────────────────────────
    let presidioMatches = [];
    try {
      const { vantixToken, vantixIndividualToken } = await new Promise((res) =>
        chrome.storage.local.get(["vantixToken", "vantixIndividualToken"], res)
      );
      const token = vantixToken || vantixIndividualToken;
      if (token) {
        const presidioRes = await fetch("http://localhost:5000/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ text })
        });
        const presidioData = await presidioRes.json();
        if (presidioData.success && presidioData.matches) {
          presidioMatches = presidioData.matches;
        }
      }
    } catch (e) {
      // Fail silently if backend is unreachable
    }

    // ── Merge, deduplicate by value ───────────────────────────────────────
    const seen = new Set(syncMatches.map((m) => m.value));
    const mergedSyncAndHash = [...syncMatches, ...hashedMatches.filter((m) => !seen.has(m.value))];
    
    // Add Presidio matches to the deduplicated set
    const matches = [...mergedSyncAndHash];
    for (const pm of presidioMatches) {
      const existing = matches.find((m) => m.value === pm.value);
      if (!existing) {
        matches.push(pm);
      } else {
        // If Presidio detected the same string but with a different entity type, we can optionally append the type
        if (!existing.type.includes(pm.type)) {
          existing.type = `${existing.type} / ${pm.type}`;
        }
      }
    }

    currentMatches = matches;

    if (!matches.length) {
      hideWarning();
      unblockSendButton();
      return;
    }

    const companyMatches = matches.filter((m) => m.source === "company");
    const companyValues  = new Set(companyMatches.map((m) => m.value));
    const generalMatches = matches.filter(
      (m) => m.source === "general" && !companyValues.has(m.value)
    );

    if (companyMatches.length) {
      companyMatches.forEach((m) => applyMaskInField(input, m.value));
      showCompanyToast(companyMatches.length);
      currentMatches = generalMatches;
    }

    if (generalMatches.length) {
      showWarning(generalMatches);
      blockSendButton();
    } else {
      hideWarning();
      unblockSendButton();
    }
  }
})();