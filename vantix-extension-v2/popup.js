// ─── Vantix v2 — Final Clean Popup ───────────────────────────────────────────

const VANTIX_API_BASE = "http://localhost:5000/api";

function showView(viewId) {
  const views = ["entry-view", "org-role-view", "login-view", "register-view", "main-view", "paywall-view"];
  views.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.classList.add("hidden");
  });
  const target = document.getElementById(viewId);
  if (target) target.classList.remove("hidden");
}

function init() {
  console.log("[Vantix] Initializing...");
  
  const btnNext = document.getElementById("btn-login-next");
  if (btnNext) {
    btnNext.onclick = () => {
      const emailInput = document.getElementById("login-email");
      const email = emailInput ? emailInput.value.trim() : "";
      if (!email) return;
      document.getElementById("grp-password").classList.remove("hidden");
      btnNext.classList.add("hidden");
      document.getElementById("btn-login-submit").classList.remove("hidden");
    };
  }

  const btnSubmit = document.getElementById("btn-login-submit");
  if (btnSubmit) {
    btnSubmit.onclick = async () => {
      const email = document.getElementById("login-email").value.trim();
      const password = document.getElementById("login-password").value;
      if (!password) return;

      btnSubmit.textContent = "Logging in...";
      try {
        const res = await fetch(`${VANTIX_API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.success) {
          chrome.storage.local.set({ vantixToken: data.token, vantixEmail: email }, () => {
            window.location.reload();
          });
        } else {
          alert(data.error || "Login failed");
        }
      } catch (err) {
        alert("Backend not reachable at localhost:5000");
      } finally {
        btnSubmit.textContent = "Login";
      }
    };
  }

  chrome.storage.local.get(["vantixToken"], (res) => {
    if (res.vantixToken) {
      showView("main-view");
      loadSettings();
    } else {
      showView("login-view");
    }
  });
}

function loadSettings() {
  const toggles = ["email", "apikey", "cc", "phone", "aadhaar", "pan"];
  chrome.storage.local.get(toggles.map(t => `enable${t.charAt(0).toUpperCase() + t.slice(1)}Detection`), (res) => {
    toggles.forEach(t => {
      const key = `enable${t.charAt(0).toUpperCase() + t.slice(1)}Detection`;
      const el = document.getElementById(`toggle-${t}`);
      if (el) el.checked = res[key] !== false;
      if (el) el.onchange = (e) => chrome.storage.local.set({ [key]: e.target.checked });
    });
  });
}

document.addEventListener("DOMContentLoaded", init);