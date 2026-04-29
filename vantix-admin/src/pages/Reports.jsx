import React, { useState, useEffect, useRef } from "react";
import api from "../utils/api";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";

/* ── Shared report HTML builder for PDF/DOCX ─────────────────────────────── */
function buildReportHTML(report, period) {
  const fromDate = report.dateRange?.from?.split("T")[0] || "—";
  const toDate   = report.dateRange?.to?.split("T")[0]   || "—";
  const total    = report.org?.totalEmployees ?? 0;
  const adminEmail = report.org?.adminEmail || "—";
  const generated  = new Date(report.generatedAt).toLocaleString();

  const coverageTotal = (report.coverage?.active || 0) + (report.coverage?.inactive || 0) + (report.coverage?.notInstalled || 0);
  const coveragePct   = coverageTotal > 0 ? Math.round(((report.coverage?.active || 0) / coverageTotal) * 100) : 0;

  const platformRows = (report.platformUsage || [])
    .map(p => `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${p.platform}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${p.count}</td></tr>`)
    .join("") || `<tr><td colspan="2" style="padding:16px;color:#999;text-align:center;">No platform activity recorded</td></tr>`;

  const employeeRows = (report.topActiveEmployees || [])
    .map(e => `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${e.email}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${e.daysActive}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${e.platforms.join(", ")}</td></tr>`)
    .join("") || `<tr><td colspan="3" style="padding:16px;color:#999;text-align:center;">No employee activity recorded in this period</td></tr>`;

  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;max-width:800px;margin:0 auto;padding:40px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a1a2e;padding-bottom:16px;margin-bottom:24px;">
        <div>
          <h1 style="margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Vantix</h1>
          <p style="margin:4px 0 0;font-size:12px;color:#666;letter-spacing:1px;text-transform:uppercase;">Data Loss Prevention Report</p>
        </div>
        <div style="text-align:right;font-size:12px;color:#555;">
          <div><strong>Period:</strong> ${period.charAt(0).toUpperCase() + period.slice(1)}</div>
          <div><strong>Range:</strong> ${fromDate} — ${toDate}</div>
          <div><strong>Generated:</strong> ${generated}</div>
          <div><strong>Admin:</strong> ${adminEmail}</div>
        </div>
      </div>

      <!-- Executive Summary -->
      <h2 style="font-size:16px;font-weight:600;margin:24px 0 12px;color:#1a1a2e;border-left:4px solid #25e6d9;padding-left:10px;">Executive Summary</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:12px;background:#f8f9fa;border:1px solid #e5e7eb;text-align:center;width:25%;">
            <div style="font-size:28px;font-weight:700;color:#1a1a2e;">${total}</div>
            <div style="font-size:11px;color:#666;margin-top:4px;">Total Employees</div>
          </td>
          <td style="padding:12px;background:#f8f9fa;border:1px solid #e5e7eb;text-align:center;width:25%;">
            <div style="font-size:28px;font-weight:700;color:#0d9488;">${report.coverage?.active || 0}</div>
            <div style="font-size:11px;color:#666;margin-top:4px;">Active (Extension On)</div>
          </td>
          <td style="padding:12px;background:#f8f9fa;border:1px solid #e5e7eb;text-align:center;width:25%;">
            <div style="font-size:28px;font-weight:700;color:#d97706;">${report.coverage?.inactive || 0}</div>
            <div style="font-size:11px;color:#666;margin-top:4px;">Inactive</div>
          </td>
          <td style="padding:12px;background:#f8f9fa;border:1px solid #e5e7eb;text-align:center;width:25%;">
            <div style="font-size:28px;font-weight:700;color:#dc2626;">${report.coverage?.notInstalled || 0}</div>
            <div style="font-size:11px;color:#666;margin-top:4px;">Not Installed</div>
          </td>
        </tr>
      </table>
      <p style="font-size:13px;color:#555;line-height:1.6;margin-bottom:24px;">
        Extension coverage stands at <strong>${coveragePct}%</strong> across ${total} registered employee${total !== 1 ? "s" : ""}.
        ${report.coverage?.notInstalled > 0 ? `${report.coverage.notInstalled} employee${report.coverage.notInstalled > 1 ? "s have" : " has"} not yet installed the Vantix extension.` : "All employees have the extension installed."}
        ${report.coverage?.inactive > 0 ? ` ${report.coverage.inactive} employee${report.coverage.inactive > 1 ? "s are" : " is"} currently inactive.` : ""}
      </p>

      <!-- Platform Usage -->
      <h2 style="font-size:16px;font-weight:600;margin:24px 0 12px;color:#1a1a2e;border-left:4px solid #25e6d9;padding-left:10px;">AI Platform Usage</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
        <thead>
          <tr style="background:#1a1a2e;color:#fff;">
            <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;">Platform</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;font-weight:600;">Sessions</th>
          </tr>
        </thead>
        <tbody>${platformRows}</tbody>
      </table>
      ${(report.platformUsage || []).length > 0 ? `<p style="font-size:12px;color:#888;margin-bottom:24px;">Sessions represent individual heartbeat pings from the extension during active monitoring.</p>` : ""}

      <!-- Most Active Employees -->
      <h2 style="font-size:16px;font-weight:600;margin:24px 0 12px;color:#1a1a2e;border-left:4px solid #25e6d9;padding-left:10px;">Most Active Employees</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#1a1a2e;color:#fff;">
            <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;">Email</th>
            <th style="padding:8px 12px;text-align:center;font-size:12px;font-weight:600;">Days Active</th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;">Platforms Used</th>
          </tr>
        </thead>
        <tbody>${employeeRows}</tbody>
      </table>

      <!-- Violations Summary -->
      <h2 style="font-size:16px;font-weight:600;margin:24px 0 12px;color:#1a1a2e;border-left:4px solid #25e6d9;padding-left:10px;">Violation Summary</h2>
      <p style="font-size:13px;color:#555;margin-bottom:12px;">Total violations in period: <strong>${report.totalViolations ?? 0}</strong></p>
      ${(report.violationsByType || []).length > 0 ? `
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead><tr style="background:#1a1a2e;color:#fff;"><th style="padding:8px 12px;text-align:left;font-size:12px;">Type</th><th style="padding:8px 12px;text-align:right;font-size:12px;">Count</th></tr></thead>
          <tbody>${(report.violationsByType || []).map(v => `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${v.type}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${v.count}</td></tr>`).join("")}</tbody>
        </table>` : `<p style="font-size:12px;color:#999;">No violations recorded.</p>`}

      <!-- Top Offenders -->
      <h2 style="font-size:16px;font-weight:600;margin:24px 0 12px;color:#1a1a2e;border-left:4px solid #25e6d9;padding-left:10px;">Top Offenders</h2>
      ${(report.topOffenders || []).length > 0 ? `
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead><tr style="background:#1a1a2e;color:#fff;"><th style="padding:8px 12px;text-align:left;font-size:12px;">Employee</th><th style="padding:8px 12px;text-align:right;font-size:12px;">Violations</th></tr></thead>
          <tbody>${(report.topOffenders || []).map(o => `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${o.email}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${o.count}</td></tr>`).join("")}</tbody>
        </table>` : `<p style="font-size:12px;color:#999;">No offender data.</p>`}

      <!-- Recent Violations -->
      <h2 style="font-size:16px;font-weight:600;margin:24px 0 12px;color:#1a1a2e;border-left:4px solid #25e6d9;padding-left:10px;">Recent Violations</h2>
      ${(report.recentViolations || []).length > 0 ? `
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead><tr style="background:#1a1a2e;color:#fff;"><th style="padding:8px 12px;text-align:left;font-size:12px;">Date</th><th style="padding:8px 12px;text-align:left;font-size:12px;">URL</th><th style="padding:8px 12px;text-align:left;font-size:12px;">Types</th></tr></thead>
          <tbody>${(report.recentViolations || []).map(v => `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${new Date(v.timestamp).toLocaleDateString()}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${v.url || "—"}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${(v.types || []).join(", ")}</td></tr>`).join("")}</tbody>
        </table>` : `<p style="font-size:12px;color:#999;">No recent violations.</p>`}

      <!-- Footer -->
      <div style="border-top:2px solid #e5e7eb;padding-top:14px;margin-top:32px;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:11px;color:#999;">
          Vantix — Data Loss Prevention &middot; Confidential
        </div>
        <div style="font-size:11px;color:#999;">
          Generated on ${generated}
        </div>
      </div>
    </div>
  `;
}

/* ── Export helpers ───────────────────────────────────────────────────────── */

async function exportPDF(period) {
  try {
    const token = sessionStorage.getItem('vantixAdminToken');
    const res = await fetch(`http://localhost:5000/api/reports/download?period=${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vantix-report-${period}-${new Date().toISOString().split("T")[0]}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("PDF download error", err);
    // Fallback to browser print
    window.print();
  }
}

function exportCSV(report, period) {
  if (!report) return;
  const rows = [];
  rows.push(["Vantix DLP Report"]);
  rows.push(["Period", period]);
  rows.push(["Generated", report.generatedAt]);
  rows.push(["Date Range", `${report.dateRange?.from?.split("T")[0] || ""} to ${report.dateRange?.to?.split("T")[0] || ""}`]);
  rows.push([]);
  rows.push(["Coverage"]);
  rows.push(["Active", report.coverage?.active || 0]);
  rows.push(["Inactive", report.coverage?.inactive || 0]);
  rows.push(["Not Installed", report.coverage?.notInstalled || 0]);
  rows.push([]);
  rows.push(["Platform", "Sessions"]);
  (report.platformUsage || []).forEach(p => rows.push([p.platform, p.count]));
  rows.push([]);
  rows.push(["Email", "Days Active", "Platforms"]);
  (report.topActiveEmployees || []).forEach(e => rows.push([e.email, e.daysActive, e.platforms.join("; ")]));
  rows.push([]);
  rows.push(["Violations Summary"]);
  rows.push(["Total Violations", report.totalViolations ?? 0]);
  rows.push([]);
  rows.push(["Violation Type", "Count"]);
  (report.violationsByType || []).forEach(v => rows.push([v.type, v.count]));
  rows.push([]);
  rows.push(["Top Offender Email", "Violation Count"]);
  (report.topOffenders || []).forEach(o => rows.push([o.email, o.count]));

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadBlob(csv, "text/csv;charset=utf-8;", `vantix-report-${period}-${new Date().toISOString().split("T")[0]}.csv`);
}

function exportDOCX(report, period) {
  if (!report) return;
  const html = buildReportHTML(report, period);
  // Word-compatible HTML with page setup
  const docContent = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>Vantix Report</title>
    <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
    </head><body>${html}</body></html>`;
  downloadBlob(docContent, "application/msword", `vantix-report-${period}-${new Date().toISOString().split("T")[0]}.doc`);
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Component ───────────────────────────────────────────────────────────── */

const Reports = () => {
  const [period, setPeriod] = useState("monthly");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const fetchReport = async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await api.get(`/reports/generate?period=${period}`);
        if (res.data.success) {
          setReport(res.data);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error("Report generation error", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
    const interval = setInterval(() => {
      api.get(`/reports/generate?period=${period}`).then(res => {
        if (res.data.success) setReport(res.data);
      }).catch(err => console.error(err));
    }, 5000);

    return () => clearInterval(interval);
  }, [period]);

  // Close menu on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleExport = (format) => {
    setShowExportMenu(false);
    if (format === "pdf")  return exportPDF(period);
    if (format === "docx") return exportDOCX(report, period);
  };

  const COLORS = ["#25e6d9", "rgba(255,176,32,0.8)", "rgba(255,77,77,0.7)"];

  return (
    <div className="grid" style={{ gap: 14 }}>
      <style>
        {`
          @media print {
            .sidebar, .topbar, .period-selector-section, .export-btn-section, .app-shell > .main > .content > .grid > .grid {
              display: none !important;
            }
            body {
              background: #fff !important;
              color: #000 !important;
            }
            .content {
              padding: 0 !important;
            }
            .card {
              border: 1px solid #ddd !important;
              background: #fff !important;
              box-shadow: none !important;
              color: #000 !important;
            }
            .card__title, .metric .value, .metric .hint, .table th, .table td {
              color: #000 !important;
            }
            .recharts-text {
              fill: #000 !important;
            }
            .recharts-cartesian-grid-line {
              stroke: #ddd !important;
            }
            #vantix-print-report {
              display: block !important;
            }
          }
        `}
      </style>

      {/* Hidden print-only professional report */}
      <div id="vantix-print-report" style={{ display: "none" }}>
        {report && <div dangerouslySetInnerHTML={{ __html: buildReportHTML(report, period) }} />}
      </div>

      {/* SECTION 1 — Period selector + Export dropdown */}
      <section className="card period-selector-section" style={{ overflow: "visible", position: "relative", zIndex: 50 }}>
        <div className="card__body" style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", overflow: "visible" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {["weekly", "monthly", "yearly"].map((p) => (
              <button
                key={p}
                className="btn"
                style={{
                  textTransform: "capitalize",
                  borderColor: period === p ? "rgba(37,230,217,0.8)" : "var(--border-color)",
                }}
                onClick={() => setPeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Export dropdown */}
          <div ref={menuRef} style={{ position: "relative" }}>
            <button
              className="btn btn--ghost export-btn-section"
              style={{ borderColor: "#25e6d9", display: "flex", alignItems: "center", gap: 6 }}
              onClick={() => setShowExportMenu(!showExportMenu)}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download Report
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2 }}><polyline points="2 4 5 7 8 4"/></svg>
            </button>

            {showExportMenu && (
              <div style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                background: "var(--dropdown-bg)",
                border: "1px solid var(--dropdown-border)",
                borderRadius: 8,
                padding: "4px 0",
                zIndex: 9999,
                minWidth: 210,
                boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              }}>
                {[
                  { key: "pdf",  label: "PDF Document",  icon: "\uD83D\uDCC4", desc: "Print-ready format" },
                  { key: "docx", label: "Word Document",  icon: "\uD83D\uDCDD", desc: "Editable .doc file" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => handleExport(opt.key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "10px 14px",
                      background: "transparent",
                      border: "none",
                      color: "var(--dropdown-item-color)",
                      cursor: "pointer",
                      fontSize: 13,
                      textAlign: "left",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--dropdown-item-hover)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontSize: 16 }}>{opt.icon}</span>
                    <div>
                      <div style={{ fontWeight: 500 }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: "var(--dropdown-item-sub)", marginTop: 1 }}>{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Error state */}
      {error && (
        <section className="card">
          <div className="card__body" style={{ padding: "40px", textAlign: "center", color: "var(--empty-state-text)" }}>
            Could not load report. Please try again.
          </div>
        </section>
      )}

      {/* SECTION 2 — Report panels */}
      {!error && report && (
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 0.2s" }} className="grid grid--2">
          
          {/* Panel A — Coverage */}
          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="card__head">
              <p className="card__title">Coverage</p>
            </div>
            <div className="card__body">
              <div className="grid grid--3" style={{ marginBottom: 20 }}>
                <div className="metric">
                  <div>
                    <div className="value">{report.coverage.active}</div>
                    <div className="hint">Active employees</div>
                  </div>
                </div>
                <div className="metric">
                  <div>
                    <div className="value">{report.coverage.inactive}</div>
                    <div className="hint">Inactive employees</div>
                  </div>
                </div>
                <div className="metric">
                  <div>
                    <div className="value">{report.coverage.notInstalled}</div>
                    <div className="hint">Not installed</div>
                  </div>
                </div>
              </div>
              
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Active", value: report.coverage.active },
                        { name: "Inactive", value: report.coverage.inactive },
                        { name: "Not Installed", value: report.coverage.notInstalled }
                      ]}
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {
                        [
                          { name: "Active", value: report.coverage.active },
                          { name: "Inactive", value: report.coverage.inactive },
                          { name: "Not Installed", value: report.coverage.notInstalled }
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))
                      }
                    </Pie>
                    <Legend verticalAlign="bottom" height={36} wrapperStyle={{ color: "var(--chart-tick)", fontSize: 12 }} />
                    <Tooltip contentStyle={{ backgroundColor: "var(--dropdown-bg)", borderColor: "var(--dropdown-border)", color: "var(--text-primary)", borderRadius: 8 }} itemStyle={{ color: "var(--text-primary)" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Panel B — Platform Usage */}
          <section className="card">
            <div className="card__head">
              <p className="card__title">AI Platforms in Use</p>
            </div>
            <div className="card__body" style={{ height: 260 }}>
              {report.platformUsage && report.platformUsage.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={report.platformUsage} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-axis)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} axisLine={{ stroke: "var(--chart-axis)" }} tickLine={false} />
                    <YAxis dataKey="platform" type="category" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} axisLine={{ stroke: "var(--chart-axis)" }} tickLine={false} width={80} />
                    <Tooltip cursor={{ fill: "var(--panel)" }} contentStyle={{ backgroundColor: "var(--dropdown-bg)", borderColor: "var(--dropdown-border)", color: "var(--text-primary)", borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#25e6d9" fillOpacity={0.85} radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ textAlign: "center", padding: "80px 0", color: "var(--empty-state-text)", fontSize: 13 }}>No platform usage data</div>
              )}
            </div>
          </section>

          {/* Panel C — Activity Timeline */}
          <section className="card">
            <div className="card__head">
              <p className="card__title">Daily Active Users</p>
            </div>
            <div className="card__body" style={{ height: 260 }}>
              {report.activityTimeline && report.activityTimeline.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={report.activityTimeline.map(d => ({ ...d, shortDate: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }))} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-axis)" vertical={false} />
                    <XAxis dataKey="shortDate" tick={{ fill: "var(--chart-tick)", fontSize: 11 }} axisLine={{ stroke: "var(--chart-axis)" }} tickLine={false} />
                    <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: "var(--dropdown-bg)", borderColor: "var(--dropdown-border)", color: "var(--text-primary)", borderRadius: 8 }} />
                    <Line type="monotone" dataKey="activeUsers" stroke="#25e6d9" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#25e6d9", stroke: "#12122a" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ textAlign: "center", padding: "80px 0", color: "var(--empty-state-text)", fontSize: 13 }}>No timeline data</div>
              )}
            </div>
          </section>

          {/* Panel D — Top Active Employees */}
          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="card__head">
              <p className="card__title">Most Active Employees</p>
            </div>
            <div className="card__body">
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Days Active</th>
                    <th>Platforms</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topActiveEmployees && report.topActiveEmployees.map((emp, idx) => (
                    <tr key={idx}>
                      <td>{emp.email}</td>
                      <td>{emp.daysActive}</td>
                      <td style={{ color: "rgba(124,243,255,.92)" }}>{emp.platforms.join(", ")}</td>
                    </tr>
                  ))}
                  {(!report.topActiveEmployees || report.topActiveEmployees.length === 0) && (
                    <tr>
                      <td colSpan={3} style={{ textAlign: "center", padding: "40px 0", color: "var(--empty-state-text)" }}>
                        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, marginBottom: 8 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        <br/>
                        No active employees found in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

        </div>
      )}
    </div>
  );
};

export default Reports;
