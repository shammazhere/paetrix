"""
Vantix — Windows Clipboard Monitoring Agent
============================================
Monitors the system clipboard every second.

Detection tiers (in order):
  1. Company rules from DB  (employees/admins only)
  2. Critical patterns       (auto-mask silently)
  3. Moderate patterns       (popup — user chooses)

Install deps:
    pip install pyperclip requests win10toast

Run:
    python agent.py
"""

import time
import re
import threading
import pyperclip
import requests
import json
import os

# --- Linux Notification Support ---
class LinuxToaster:
    def show_toast(self, title, msg, **kwargs):
        print(f"[Notification] {title}: {msg}")
        os.system(f'notify-send "{title}" "{msg}"')

try:
    from win10toast import ToastNotifier
    toaster = ToastNotifier()
except ImportError:
    toaster = LinuxToaster()

last_clip = ""
popup_open = False          # only one popup at a time
BACKEND = "http://localhost:5000/api"

# ─── Pattern Tiers ────────────────────────────────────────────────────────────

CRITICAL_PATTERNS = {
    "PAN":            r'[A-Z]{5}[0-9]{4}[A-Z]',
    "Aadhaar":        r'\d{4}\s\d{4}\s\d{4}',
    "Credit Card":    r'\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b',
    "OpenAI Key":     r'sk-[a-zA-Z0-9]{48}',
    "AWS Key":        r'AKIA[0-9A-Z]{16}',
    "GitHub Token":   r'ghp_[a-zA-Z0-9]{36}',
    "Google API Key": r'AIza[0-9A-Za-z\-_]{35}',
    "Stripe Key":     r'sk_live_[0-9a-zA-Z]{24,}',
    "JWT Token":      r'eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+',
    "DB String":      r'(mongodb|mysql|postgresql|redis):\/\/[^\s"\']+',
    "Private IP":     r'\b(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)\d+\.\d+\b',
    "IFSC Code":      r'[A-Z]{4}0[A-Z0-9]{6}',
    "Bank Account":   r'\b\d{9,18}\b',
}

MODERATE_PATTERNS = {
    "Email":        r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
    "Phone Number": r'(\+91[\s-]?)?[6-9]\d{9}|\+\d{1,3}[\s-]?\d{6,14}',
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_token():
    """Read token saved by extension on login."""
    config_path = os.path.expanduser("~/.vantix/config.json")
    try:
        with open(config_path) as f:
            return json.load(f).get("token", "")
    except Exception:
        return ""


def get_user_info():
    """
    Identify who is using the agent.
    - No token → general user, no company rules.
    - Token exists → decode JWT for role, then fetch company rules from backend.
    """
    token = get_token()
    if not token:
        return {"role": "general", "company_id": None, "rules": []}

    # Decode JWT payload (base64) locally — no backend call needed for identity
    try:
        import base64
        payload_b64 = token.split(".")[1]
        # Fix padding
        payload_b64 += "=" * (4 - len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        role = payload.get("role", "employee")
        org_id = payload.get("orgId", "")
    except Exception:
        return {"role": "general", "company_id": None, "rules": []}

    # Fetch company rules from GET /api/rules
    rules = []
    try:
        res = requests.get(
            f"{BACKEND}/rules",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            timeout=3,
        )
        if res.status_code == 200:
            data = res.json()
            company_rules = data.get("companyRules", {})
            general_rules = data.get("generalRules", {})

            # Collect custom regex patterns (label + pattern)
            for p in company_rules.get("customPatterns", []):
                if p.get("label") and p.get("pattern"):
                    rules.append({"name": p["label"], "pattern": p["pattern"], "source": "company"})
            for p in general_rules.get("customPatterns", []):
                if p.get("label") and p.get("pattern"):
                    rules.append({"name": p["label"], "pattern": p["pattern"], "source": "general"})

            # Keywords → treat as literal substring matches
            for kw in company_rules.get("keywords", []):
                if kw:
                    rules.append({"name": f"Keyword: {kw}", "pattern": re.escape(kw), "source": "company"})

            # API key hashes — can't regex match these, but store for reference
            # (hash-based matching would need the raw values which aren't sent)

    except Exception:
        pass  # Backend down — proceed without company rules

    return {"role": role, "company_id": org_id, "rules": rules}


def analyze(text):
    """Send clipboard text to backend for Presidio analysis."""
    token = get_token()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        endpoint = f"{BACKEND}/check"
    else:
        endpoint = f"{BACKEND}/check/open"

    try:
        res = requests.post(
            endpoint,
            json={"text": text, "source": "clipboard"},
            headers=headers,
            timeout=2,
        )
        return res.json()
    except Exception:
        return {"blocked": False}


def log_violation(types):
    """Log the violation to the backend (best-effort)."""
    token = get_token()
    if not token:
        return
    try:
        requests.post(
            f"{BACKEND}/violations",
            json={
                "url": "clipboard",
                "matches": [{"type": t} for t in types],
            },
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
            timeout=2,
        )
    except Exception:
        pass


def mask_value(val):
    """Partially mask a single value for display."""
    val = str(val).strip()
    if len(val) <= 4:
        return '*' * len(val)
    return val[:2] + '•' * (len(val) - 4) + val[-2:]


def mask_text(text):
    """Replace sensitive patterns in text with partially masked versions."""
    masked = text
    patterns = [
        r'sk-proj-[a-zA-Z0-9_-]{50,}',                         # OpenAI project key
        r'sk-[a-zA-Z0-9]{48,}',                                 # OpenAI key
        r'AKIA[0-9A-Z]{16}',                                     # AWS key
        r'ghp_[a-zA-Z0-9]{36}',                                 # GitHub token
        r'eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+', # JWT
        r'sk_live_[0-9a-zA-Z]{24,}',                            # Stripe live
        r'AIza[0-9A-Za-z\-_]{35}',                              # Google API key
        r'[A-Z]{5}[0-9]{4}[A-Z]',                              # PAN
        r'\d{4}\s\d{4}\s\d{4}',                                 # Aadhaar
        r'(mongodb|mysql|postgresql|redis):\/\/[^\s"\']+',       # DB string
        r'\b(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)\d+\.\d+\b', # Private IP
        r'[A-Z]{4}0[A-Z0-9]{6}',                                # IFSC
        r'\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b',            # Credit card
        r'\d{9,18}',                                             # Bank account
        r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',    # Email
        r'(\+91[\s-]?)?[6-9]\d{9}',                             # Phone
    ]
    for pattern in patterns:
        def replacer(m):
            val = m.group()
            if len(val) <= 4:
                return '*' * len(val)
            return val[:2] + '*' * (len(val) - 4) + val[-2:]
        masked = re.sub(pattern, replacer, masked)
    return masked


def detect_locally(text):
    """Detect sensitive data using local regex patterns (no backend needed)."""
    PATTERNS = [
        ("PAN",            r'[A-Z]{5}[0-9]{4}[A-Z]'),
        ("Aadhaar",        r'\d{4}\s\d{4}\s\d{4}'),
        ("OpenAI Key",     r'sk-[a-zA-Z0-9]{48}'),
        ("AWS Key",        r'AKIA[0-9A-Z]{16}'),
        ("GitHub Token",   r'ghp_[a-zA-Z0-9]{36}'),
        ("Google API Key", r'AIza[0-9A-Za-z\-_]{35}'),
        ("Stripe Key",     r'sk_live_[0-9a-zA-Z]{24,}'),
        ("JWT Token",      r'eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+'),
        ("DB String",      r'(mongodb|mysql|postgresql|redis):\/\/[^\s"\']+'),
        ("Private IP",     r'\b(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)\d+\.\d+\b'),
        ("IFSC Code",      r'[A-Z]{4}0[A-Z0-9]{6}'),
        ("Credit Card",    r'\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b'),
    ]
    found = []
    for name, pattern in PATTERNS:
        if re.search(pattern, text):
            found.append(name)
    return found


# ─── Detection helpers ────────────────────────────────────────────────────────

def check_company_rules(text, rules):
    """
    Check clipboard against company-specific rules from the DB.
    Returns list of matched rule names, or empty list.
    """
    matched = []
    for rule in rules:
        try:
            if re.search(rule["pattern"], text):
                matched.append(rule["name"])
        except re.error:
            pass  # skip invalid regex from DB
    return matched


def check_critical(text):
    """Check clipboard against CRITICAL_PATTERNS. Returns matched names."""
    matched = []
    for name, pattern in CRITICAL_PATTERNS.items():
        if re.search(pattern, text):
            matched.append(name)
    return matched


def check_moderate(text):
    """
    Check clipboard against MODERATE_PATTERNS.
    Returns list of dicts: [{"type": "Email", "value": "found@text.com"}, ...]
    """
    detections = []
    for name, pattern in MODERATE_PATTERNS.items():
        for m in re.finditer(pattern, text):
            detections.append({"type": name, "value": m.group()})
    return detections


# ─── Tkinter popup ────────────────────────────────────────────────────────────

def show_popup(detections, original_clip, token=None):
    """
    Show a tkinter popup for MODERATE detections.
    User can choose: Mask selected / Redact all / Send anyway.
    """
    global popup_open, last_clip

    if popup_open:
        return
    popup_open = True

    try:
        import tkinter as tk
    except ImportError:
        print("[Vantix] tkinter not available — auto-masking moderate items instead")
        masked = mask_text(original_clip)
        pyperclip.copy(masked)
        last_clip = masked
        popup_open = False
        return

    # ─── Badge color map ────
    BADGE_COLORS = {
        "Email":        ("#6c63ff", "#ffffff"),
        "Phone Number": ("#0099ff", "#ffffff"),
        "PAN":          ("#ffaa00", "#000000"),
        "Aadhaar":      ("#ffaa00", "#000000"),
        "Credit Card":  ("#ffaa00", "#000000"),
        "IFSC Code":    ("#ffaa00", "#000000"),
        "Bank Account": ("#ffaa00", "#000000"),
    }
    API_KEY_TYPES = {"OpenAI Key", "AWS Key", "GitHub Token", "Google API Key", "Stripe Key", "JWT Token", "DB String"}

    def get_badge_color(type_name):
        if type_name in BADGE_COLORS:
            return BADGE_COLORS[type_name]
        if type_name in API_KEY_TYPES:
            return ("#00d4aa", "#000000")
        return ("#6c63ff", "#ffffff")  # default

    BG       = "#0d1117"
    ROW_BG   = "#0f1520"
    BORDER   = "#1e2530"
    TEAL     = "#00d4aa"
    TEXT     = "#f0f6ff"
    SUBTLE   = "#4a5568"
    MUTED    = "#8899aa"
    DARK_NOTE = "#2d3a4a"

    root = tk.Tk()
    root.title("Vantix \u2014 Sensitive Data Detected")
    root.configure(bg=BG)
    root.resizable(False, False)
    root.attributes("-topmost", True)
    root.overrideredirect(False)

    # Center on screen
    root.update_idletasks()
    w = 500
    h = 560
    x = (root.winfo_screenwidth() // 2) - (w // 2)
    y = (root.winfo_screenheight() // 2) - (h // 2)
    root.geometry(f"{w}x{h}+{x}+{y}")

    def on_close():
        global popup_open
        popup_open = False
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)

    # ─── Header section ────
    header = tk.Frame(root, bg=BG)
    header.pack(fill="x", padx=24, pady=(18, 0))

    tk.Label(
        header, text="\U0001f6e1",
        bg=BG, fg=TEAL,
        font=("Segoe UI", 20),
    ).pack(anchor="w")

    tk.Label(
        header, text="Warning: Sensitive data detected",
        bg=BG, fg=TEXT,
        font=("Segoe UI", 14, "bold"),
    ).pack(anchor="w", pady=(4, 0))

    tk.Label(
        header, text="Select items to mask inline, or redact all with [REDACTED]",
        bg=BG, fg=SUBTLE,
        font=("Segoe UI", 10),
    ).pack(anchor="w", pady=(2, 0))

    # Separator
    tk.Frame(root, bg=BORDER, height=1).pack(fill="x", padx=24, pady=(12, 0))

    # Items count row + Select all button
    count_row = tk.Frame(root, bg=BG)
    count_row.pack(fill="x", padx=24, pady=(10, 6))

    tk.Label(
        count_row, text=f"{len(detections)} items found",
        bg=BG, fg=SUBTLE,
        font=("Segoe UI", 10),
    ).pack(side="left")

    # ─── Scrollable detection list ────
    list_container = tk.Frame(root, bg=BG)
    list_container.pack(fill="both", expand=True, padx=24)

    canvas = tk.Canvas(list_container, bg=BG, highlightthickness=0, bd=0)
    scrollbar = tk.Scrollbar(list_container, orient="vertical", command=canvas.yview)
    frame = tk.Frame(canvas, bg=BG)

    frame.bind(
        "<Configure>",
        lambda e: canvas.configure(scrollregion=canvas.bbox("all")),
    )
    canvas_frame = canvas.create_window((0, 0), window=frame, anchor="nw")

    def on_canvas_configure(e):
        canvas.itemconfig(canvas_frame, width=e.width)
    canvas.bind("<Configure>", on_canvas_configure)

    canvas.configure(yscrollcommand=scrollbar.set)
    canvas.pack(side="left", fill="both", expand=True)

    # Show scrollbar only when needed
    def update_scrollbar(*args):
        scrollbar.set(*args)
        if float(args[0]) <= 0.0 and float(args[1]) >= 1.0:
            scrollbar.pack_forget()
        else:
            scrollbar.pack(side="right", fill="y")
    canvas.configure(yscrollcommand=update_scrollbar)

    # Mouse wheel scrolling
    def on_mousewheel(event):
        canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
    canvas.bind_all("<MouseWheel>", on_mousewheel)

    checkboxes = []
    for idx, item in enumerate(detections):
        # Row container
        row = tk.Frame(frame, bg=ROW_BG, pady=8)
        row.pack(fill="x", pady=0)

        var = tk.BooleanVar(value=True)
        cb = tk.Checkbutton(
            row, variable=var, bg=ROW_BG,
            activebackground=ROW_BG,
            selectcolor=BG,
            fg="#ffffff",
            highlightthickness=0,
            bd=0,
        )
        cb.pack(side="left", padx=(10, 6))

        # Type badge with color
        badge_bg, badge_fg = get_badge_color(item["type"])
        badge = tk.Label(
            row, text=item["type"],
            bg=badge_bg, fg=badge_fg,
            font=("Segoe UI", 9, "bold"),
            padx=10, pady=3,
        )
        badge.pack(side="left", padx=(0, 8))

        # Masked value
        tk.Label(
            row, text=mask_value(item["value"]),
            bg=ROW_BG, fg=MUTED,
            font=("Courier New", 11),
        ).pack(side="left", padx=(0, 10))

        checkboxes.append((var, item))

        # Bottom border separator (skip last item)
        if idx < len(detections) - 1:
            tk.Frame(frame, bg="#1a2030", height=1).pack(fill="x")

    # Select all button (placed after checkboxes are created)
    def select_all():
        for var, _ in checkboxes:
            var.set(True)

    select_all_btn = tk.Button(
        count_row, text="Select all",
        bg=BG, fg=TEAL,
        font=("Segoe UI", 10),
        relief="flat", bd=0,
        activebackground=BG, activeforeground=TEAL,
        cursor="hand2",
        command=select_all,
    )
    select_all_btn.pack(side="right")

    # ─── Button actions (logic unchanged) ────
    def mask_selected():
        global last_clip
        masked = original_clip
        for var, item in checkboxes:
            if var.get():
                masked = masked.replace(item["value"], mask_value(item["value"]))
        pyperclip.copy(masked)
        last_clip = masked
        if token:
            try:
                log_violation([i["type"] for i in detections])
            except Exception:
                pass
        print(f"[Vantix] Popup: user chose MASK SELECTED")
        on_close()

    def redact_all():
        global last_clip
        masked = original_clip
        for _, item in checkboxes:
            masked = masked.replace(item["value"], "[REDACTED]")
        pyperclip.copy(masked)
        last_clip = masked
        if token:
            try:
                log_violation([i["type"] for i in detections])
            except Exception:
                pass
        print(f"[Vantix] Popup: user chose REDACT ALL")
        on_close()

    def send_anyway():
        if token:
            try:
                log_violation([i["type"] for i in detections])
            except Exception:
                pass
        print(f"[Vantix] Popup: user chose SEND ANYWAY (warning logged)")
        on_close()

    # ─── Bottom section ────
    tk.Frame(root, bg=BORDER, height=1).pack(fill="x", padx=24, pady=(8, 0))

    btn_frame = tk.Frame(root, bg=BG)
    btn_frame.pack(fill="x", padx=24, pady=(14, 0))

    # Mask selected — primary teal button
    mask_btn = tk.Button(
        btn_frame, text="Mask selected",
        bg=TEAL, fg="#021a14",
        font=("Segoe UI", 10, "bold"),
        command=mask_selected,
        relief="flat", padx=16, pady=8,
        activebackground="#00f0c0", activeforeground="#021a14",
        cursor="hand2",
    )
    mask_btn.pack(side="left", padx=(0, 6))

    def mask_enter(e):
        mask_btn.configure(bg="#00f0c0")
    def mask_leave(e):
        mask_btn.configure(bg=TEAL)
    mask_btn.bind("<Enter>", mask_enter)
    mask_btn.bind("<Leave>", mask_leave)

    # Redact all — secondary dark button
    redact_btn = tk.Button(
        btn_frame, text="Redact all",
        bg=BORDER, fg="#c8d6e8",
        font=("Segoe UI", 10),
        command=redact_all,
        relief="flat", padx=16, pady=8,
        activebackground="#2a3540", activeforeground="#c8d6e8",
        cursor="hand2",
    )
    redact_btn.pack(side="left", padx=(0, 6))

    def redact_enter(e):
        redact_btn.configure(bg="#2a3540")
    def redact_leave(e):
        redact_btn.configure(bg=BORDER)
    redact_btn.bind("<Enter>", redact_enter)
    redact_btn.bind("<Leave>", redact_leave)

    # Send anyway — ghost red button with underline
    send_btn = tk.Button(
        btn_frame, text="Send anyway",
        bg=BG, fg="#ff4444",
        font=("Segoe UI", 10, "underline"),
        command=send_anyway,
        relief="flat", padx=16, pady=8,
        activebackground="#161b22", activeforeground="#ff6666",
        cursor="hand2",
    )
    send_btn.pack(side="left", padx=(0, 0))

    def send_enter(e):
        send_btn.configure(bg="#161b22", fg="#ff6666")
    def send_leave(e):
        send_btn.configure(bg=BG, fg="#ff4444")
    send_btn.bind("<Enter>", send_enter)
    send_btn.bind("<Leave>", send_leave)

    # Footer note
    tk.Label(
        root, text="Send anyway will log this as a violation",
        bg=BG, fg=DARK_NOTE,
        font=("Segoe UI", 9),
    ).pack(padx=24, pady=(6, 14), anchor="w")

    root.mainloop()


# ─── Main loop ────────────────────────────────────────────────────────────────

def main():
    global last_clip

    print("─────────────────────────────────────────")
    print("  Vantix Clipboard Agent running")
    print("  Monitoring clipboard for sensitive data...")
    print("─────────────────────────────────────────")

    # Initial user identification
    user_info = get_user_info()
    role = user_info["role"]
    print(f"  Role detected: {role}")
    if role in ("employee", "admin"):
        print(f"  Company rules loaded: {len(user_info['rules'])}")
    print("─────────────────────────────────────────")

    last_refresh = time.time()
    REFRESH_INTERVAL = 300  # refresh user_info every 5 minutes

    while True:
        try:
            # Refresh user_info periodically
            now = time.time()
            if now - last_refresh >= REFRESH_INTERVAL:
                user_info = get_user_info()
                role = user_info["role"]
                last_refresh = now
                print(f"[Vantix] Refreshed user info — role: {role}, rules: {len(user_info['rules'])}")

            clip = pyperclip.paste()
            if clip and clip != last_clip and len(clip.strip()) > 5:
                last_clip = clip
                token = get_token()

                # ─────────────────────────────────────
                # EMPLOYEE / ADMIN flow
                # ─────────────────────────────────────
                if role in ("employee", "admin"):

                    # CHECK 1 — Company rules from DB
                    if user_info["rules"]:
                        company_matches = check_company_rules(clip, user_info["rules"])
                        if company_matches:
                            masked = mask_text(clip)
                            pyperclip.copy(masked)
                            last_clip = masked
                            toaster.show_toast(
                                "Vantix \u2014 Clipboard Masked",
                                f"{', '.join(company_matches[:3])} auto-masked",
                                duration=5,
                                threaded=True,
                            )
                            try:
                                log_violation(company_matches)
                            except Exception:
                                pass
                            print(f"[Vantix] MASKED (company rule): {company_matches}")
                            time.sleep(1)
                            continue

                    # CHECK 2 — Critical patterns
                    critical_matches = check_critical(clip)
                    if critical_matches:
                        masked = mask_text(clip)
                        pyperclip.copy(masked)
                        last_clip = masked
                        toaster.show_toast(
                            "Vantix \u2014 Clipboard Masked",
                            f"{', '.join(critical_matches[:3])} masked",
                            duration=5,
                            threaded=True,
                        )
                        try:
                            log_violation(critical_matches)
                        except Exception:
                            pass
                        print(f"[Vantix] MASKED (critical): {critical_matches}")
                        time.sleep(1)
                        continue

                    # CHECK 3 — Moderate patterns → popup
                    moderate_detections = check_moderate(clip)
                    if moderate_detections and not popup_open:
                        print(f"[Vantix] Moderate data detected: {[d['type'] for d in moderate_detections]}")
                        popup_thread = threading.Thread(
                            target=show_popup,
                            args=(moderate_detections, clip, token),
                            daemon=True,
                        )
                        popup_thread.start()
                        time.sleep(1)
                        continue

                    print(f"[Vantix] Clipboard OK ({len(clip)} chars)")

                # ─────────────────────────────────────
                # GENERAL user flow (no token)
                # ─────────────────────────────────────
                else:

                    # CHECK 1 — Critical patterns
                    critical_matches = check_critical(clip)
                    if critical_matches:
                        masked = mask_text(clip)
                        pyperclip.copy(masked)
                        last_clip = masked
                        toaster.show_toast(
                            "Vantix \u2014 Sensitive data masked",
                            f"{', '.join(critical_matches[:3])} was masked. Safe to paste now.",
                            duration=5,
                            threaded=True,
                        )
                        print(f"[Vantix] MASKED (critical): {critical_matches}")
                        time.sleep(1)
                        continue

                    # CHECK 2 — Moderate patterns → popup
                    moderate_detections = check_moderate(clip)
                    if moderate_detections and not popup_open:
                        print(f"[Vantix] Moderate data detected: {[d['type'] for d in moderate_detections]}")
                        popup_thread = threading.Thread(
                            target=show_popup,
                            args=(moderate_detections, clip, None),
                            daemon=True,
                        )
                        popup_thread.start()
                        time.sleep(1)
                        continue

                    print(f"[Vantix] Clipboard OK ({len(clip)} chars)")

        except Exception as e:
            print(f"[Vantix] Error: {e}")

        time.sleep(1)


if __name__ == "__main__":
    main()
