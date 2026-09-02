/* ---------- state ---------- */
const state = {
  profile: normalizeProfile(null),
  entries: [],   // [{date:'YYYY-MM-DD', notes:'...'}]
  sha: null,     // GitHub blob sha for data.json, needed to update it
  token: localStorage.getItem("logbook_gh_token") || null
};

const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEKDAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const FULL_DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/* ---------- profile shape ----------
   profile = {
     name, company,
     startDate, endDate,                 // work period (YYYY-MM-DD)
     offPeriods: [                        // off-day schedules, each optionally date-bounded
       { from:'', to:'2026-08-31', days:[ {day:'Saturday',half:true,start:'14:00',end:''},
                                          {day:'Sunday',  half:false} ] },
       { from:'2026-09-01', to:'', days:[ {day:'Friday',  half:false},
                                          {day:'Saturday',half:true,start:'09:00',end:'13:00'} ] }
     ]
   }
   Empty `from` = from the internship start; empty `to` = open-ended.
   Older data.json files (single `offDay` string, or a flat `offDays` array) are upgraded. */
function normalizeDays(arr){
  return (arr || [])
    .filter(o => o && WEEKDAYS.includes(o.day))
    .map(o => ({
      day: o.day,
      half: !!o.half,
      start: o.half ? (o.start || "") : "",
      end: o.half ? (o.end || "") : ""
    }));
}
function normalizeProfile(p){
  const prof = Object.assign(
    { name:"", company:"", startDate:"", endDate:"", offPeriods:[] },
    p || {}
  );
  if((!prof.offPeriods || !prof.offPeriods.length) && p){
    if(Array.isArray(p.offDays) && p.offDays.length){
      prof.offPeriods = [{ from:"", to:"", days: p.offDays }];
    }else if(p.offDay){
      prof.offPeriods = [{ from:"", to:"", days:[{ day:p.offDay, half:false }] }];
    }
  }
  prof.offPeriods = (prof.offPeriods || []).map(period => ({
    from: period.from || "",
    to: period.to || "",
    days: normalizeDays(period.days)
  }));
  delete prof.offDay;
  delete prof.offDays;
  return prof;
}

function offDayRange(o){
  if(!o || !o.half) return "";
  if(o.start && o.end) return `${o.start}–${o.end}`;
  if(o.start) return `from ${o.start}`;
  if(o.end) return `until ${o.end}`;
  return "";
}

function periodMatches(period, dateStr){
  const from = period.from || "0000-01-01";
  const to = period.to || "9999-12-31";
  return dateStr >= from && dateStr <= to;
}

function offDayInfo(dateStr){
  if(!dateStr) return null;
  const name = FULL_DAY_NAMES[toLocalDate(dateStr).getDay()];
  for(const period of state.profile.offPeriods){
    if(!periodMatches(period, dateStr)) continue;
    return period.days.find(o => o.day === name) || null;
  }
  return null;
}

function shortDate(str){
  if(!str) return "";
  const d = toLocalDate(str);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}
function periodLabel(period){
  if(period.from && period.to) return `${shortDate(period.from)}–${shortDate(period.to)}`;
  if(period.from) return `from ${shortDate(period.from)}`;
  if(period.to) return `until ${shortDate(period.to)}`;
  return "";
}
function daysSummary(days){
  if(!days.length) return "none";
  return days
    .map(o => o.half ? `${o.day.slice(0,3)} ½${offDayRange(o) ? " " + offDayRange(o) : ""}` : o.day.slice(0,3))
    .join(", ");
}
function offDaySummary(){
  const periods = state.profile.offPeriods;
  if(!periods.length) return "—";
  if(periods.length === 1 && !periods[0].from && !periods[0].to) return daysSummary(periods[0].days);
  return periods.map(p => {
    const label = periodLabel(p);
    return label ? `${label}: ${daysSummary(p.days)}` : daysSummary(p.days);
  }).join("  ·  ");
}

function periodSummary(){
  if(!state.profile.startDate) return "—";
  const end = state.profile.endDate ? prettyDate(state.profile.endDate) : "…";
  return `${prettyDate(state.profile.startDate)} – ${end}`;
}

/* ---------- date helpers (all local-time, no timezone drift) ---------- */
function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function toLocalDate(str){
  const [y,m,d] = str.split("-").map(Number);
  return new Date(y, m-1, d);
}
function dayName(str){
  if(!str) return "—";
  return DAY_NAMES[toLocalDate(str).getDay()];
}
function prettyDate(str){
  if(!str) return "—";
  const d = toLocalDate(str);
  return `${String(d.getDate()).padStart(2,"0")} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}
function weekNumber(dateStr, startStr){
  if(!startStr || !dateStr) return "—";
  const start = toLocalDate(startStr);
  const cur = toLocalDate(dateStr);
  const diffDays = Math.floor((cur - start) / 86400000);
  if(diffDays < 0) return "—";
  return Math.floor(diffDays/7) + 1;
}
function totalWeeks(startStr, endStr){
  if(!startStr || !endStr) return null;
  const diffDays = Math.floor((toLocalDate(endStr) - toLocalDate(startStr)) / 86400000);
  if(diffDays < 0) return null;
  return Math.floor(diffDays/7) + 1;
}
function currentWeekLabel(){
  const p = state.profile;
  if(!p.startDate) return "—";
  const today = todayStr();
  if(today < p.startDate) return "not started";
  if(p.endDate && today > p.endDate) return "completed";
  const wk = weekNumber(today, p.startDate);
  const total = totalWeeks(p.startDate, p.endDate);
  return total ? `${wk} / ${total}` : String(wk);
}

/* ---------- GitHub sync ---------- */
const API_BASE = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/contents/${CONFIG.DATA_PATH}`;

async function loadData(){
  try{
    const headers = { "Accept": "application/vnd.github+json" };
    if(state.token) headers["Authorization"] = `token ${state.token}`;
    const res = await fetch(`${API_BASE}?ref=${CONFIG.GITHUB_BRANCH}`, { headers });

    if(res.status === 404){
      showSaveStatus("No data.json found yet in the repo — sign in and save an entry to create it.", false);
      return;
    }
    if(!res.ok) throw new Error(`GitHub returned ${res.status}`);

    const json = await res.json();
    state.sha = json.sha;
    const decoded = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ""))));
    const data = JSON.parse(decoded);
    state.profile = normalizeProfile(data.profile);
    state.entries = data.entries || [];
  }catch(e){
    console.error(e);
    showSaveStatus("Could not reach GitHub — check config.js (owner/repo/branch) and your connection.", true);
  }
}

async function persist(){
  if(!state.token){ openSignInModal(); throw new Error("Not signed in"); }
  const payload = { profile: state.profile, entries: state.entries };
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
  const body = {
    message: `Update logbook — ${todayStr()}`,
    content,
    branch: CONFIG.GITHUB_BRANCH
  };
  if(state.sha) body.sha = state.sha;

  const res = await fetch(API_BASE, {
    method: "PUT",
    headers: {
      "Authorization": `token ${state.token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if(!res.ok){
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Save failed (${res.status})`);
  }
  const json = await res.json();
  state.sha = json.content.sha;
}

/* ---------- rendering ---------- */
function sortedEntries(order = "desc"){
  const copy = [...state.entries];
  copy.sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return order === "desc" ? copy.reverse() : copy;
}

function renderProfile(){
  document.getElementById("stubName").textContent = state.profile.name || "—";
  document.getElementById("stubCompany").textContent = state.profile.company || "—";
  document.getElementById("stubPeriod").textContent = periodSummary();
  document.getElementById("stubOffDay").textContent = offDaySummary();
  document.getElementById("statCount").textContent = state.entries.length;
  document.getElementById("statWeek").textContent = currentWeekLabel();
  document.getElementById("coverSubtitle").textContent = state.profile.name
    ? `${state.profile.name}'s daily activity record`
    : "Daily activity record";
}

function renderTable(){
  const body = document.getElementById("logTableBody");
  const rows = sortedEntries("desc");
  if(rows.length === 0){
    body.innerHTML = `<tr class="empty-row"><td colspan="5">No entries yet — log your first day above.</td></tr>`;
    updateExportCount();
    return;
  }
  body.innerHTML = rows.map(entry => `
    <tr data-date="${entry.date}">
      <td class="col-date">${prettyDate(entry.date)}</td>
      <td class="col-day">${dayName(entry.date)}${offTag(entry.date)}</td>
      <td class="col-week">${weekNumber(entry.date, state.profile.startDate)}</td>
      <td class="notes-cell">${escapeHtml(entry.notes)}</td>
      <td class="col-actions">${state.token ? `<button class="row-delete" data-date="${entry.date}">delete</button>` : ""}</td>
    </tr>
  `).join("");

  body.querySelectorAll(".row-delete").forEach(btn => {
    btn.addEventListener("click", () => deleteEntry(btn.dataset.date));
  });

  updateExportCount();
}

function offTag(dateStr){
  const off = offDayInfo(dateStr);
  if(!off) return "";
  const label = off.half ? `½ off${offDayRange(off) ? " · " + offDayRange(off) : ""}` : "off day";
  return ` <span class="off-tag">${label}</span>`;
}

function escapeHtml(str){
  return (str || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

function updateSyncIndicator(){
  const el = document.getElementById("syncIndicator");
  const btn = document.getElementById("signInBtn");
  if(state.token){
    el.textContent = "● signed in — saves to GitHub";
    el.classList.add("editable");
    btn.textContent = "Account";
  }else{
    el.textContent = "● read-only";
    el.classList.remove("editable");
    btn.textContent = "Sign in to edit";
  }
}

function showSaveStatus(msg, isError){
  const el = document.getElementById("saveStatus");
  el.textContent = msg;
  el.style.color = isError ? "#9C4A32" : "#4B5A66";
  if(!isError){ setTimeout(() => { if(el.textContent === msg) el.textContent = ""; }, 4000); }
}

function updateDayWeekReadout(){
  const date = document.getElementById("entryDate").value;
  const el = document.getElementById("dayWeekReadout");
  if(!date){ el.textContent = "—"; return; }
  const wk = weekNumber(date, state.profile.startDate);
  let txt = `${dayName(date)} · Week ${wk}`;
  if(state.profile.startDate && date < state.profile.startDate) txt = `${dayName(date)} · before start`;
  else if(state.profile.endDate && date > state.profile.endDate) txt = `${dayName(date)} · after end`;
  const off = offDayInfo(date);
  if(off) txt += off.half ? `  ·  ½ off day${offDayRange(off) ? " (" + offDayRange(off) + ")" : ""}` : "  ·  off day";
  el.textContent = txt;
}

/* ---------- entry actions ---------- */
async function saveEntry(){
  const date = document.getElementById("entryDate").value;
  const notes = document.getElementById("entryNotes").value.trim();
  if(!date){ showSaveStatus("Pick a date first.", true); return; }
  if(!notes){ showSaveStatus("Write something before saving.", true); return; }

  const existing = state.entries.find(e => e.date === date);
  if(existing){ existing.notes = notes; } else { state.entries.push({ date, notes }); }

  showSaveStatus("Saving…", false);
  try{
    await persist();
    showSaveStatus("Saved ✓", false);
    document.getElementById("entryNotes").value = "";
    renderProfile();
    renderTable();
  }catch(e){
    console.error(e);
    showSaveStatus(e.message || "Save failed.", true);
  }
}

async function deleteEntry(date){
  if(!confirm(`Delete the entry for ${prettyDate(date)}?`)) return;
  state.entries = state.entries.filter(e => e.date !== date);
  try{
    await persist();
    renderProfile();
    renderTable();
  }catch(e){
    showSaveStatus(e.message || "Delete failed.", true);
  }
}

/* ---------- sign-in modal ---------- */
function openSignInModal(){
  const modal = document.getElementById("signInModal");
  document.getElementById("signOutBtn").hidden = !state.token;
  document.getElementById("tokenInput").value = "";
  modal.hidden = false;
}
function closeSignInModal(){ document.getElementById("signInModal").hidden = true; }

/* ---------- profile modal ---------- */
let periodDraft = [];

function openProfileModal(){
  document.getElementById("profileName").value = state.profile.name || "";
  document.getElementById("profileCompany").value = state.profile.company || "";
  document.getElementById("profileStart").value = state.profile.startDate || "";
  document.getElementById("profileEnd").value = state.profile.endDate || "";
  periodDraft = state.profile.offPeriods.length
    ? JSON.parse(JSON.stringify(state.profile.offPeriods))
    : [{ from:"", to:"", days:[] }];
  renderOffPeriods();
  document.getElementById("profileModal").hidden = false;
}
function closeProfileModal(){ document.getElementById("profileModal").hidden = true; }

function offDayRowHtml(day, cur){
  const on = !!cur;
  const half = on && cur.half;
  return `
    <div class="offday-row" data-day="${day}">
      <label class="offday-check">
        <input type="checkbox" class="offday-toggle" ${on ? "checked" : ""}>
        <span>${day}</span>
      </label>
      <select class="offday-type" ${on ? "" : "disabled"}>
        <option value="full" ${half ? "" : "selected"}>Full day</option>
        <option value="half" ${half ? "selected" : ""}>Half day</option>
      </select>
      <span class="offday-times" ${on && half ? "" : "hidden"}>
        <input type="time" class="offday-start" value="${cur ? cur.start : ""}" ${on && half ? "" : "disabled"}>
        <span class="offday-dash">–</span>
        <input type="time" class="offday-end" value="${cur ? cur.end : ""}" ${on && half ? "" : "disabled"}>
      </span>
    </div>`;
}

function renderOffPeriods(){
  const wrap = document.getElementById("offPeriods");
  const multi = periodDraft.length > 1;
  wrap.innerHTML = periodDraft.map((period, idx) => `
    <div class="off-period" data-idx="${idx}">
      <div class="off-period-head">
        <label>From <input type="date" class="op-from" value="${period.from}"></label>
        <label>to <input type="date" class="op-to" value="${period.to}"></label>
        ${multi ? `<button type="button" class="link-btn op-remove">remove</button>` : ""}
      </div>
      <div class="offday-list">
        ${WEEKDAYS.map(day => offDayRowHtml(day, period.days.find(o => o.day === day))).join("")}
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll(".off-period").forEach(block => {
    block.querySelectorAll(".offday-row").forEach(row => {
      const cb = row.querySelector(".offday-toggle");
      const type = row.querySelector(".offday-type");
      const times = row.querySelector(".offday-times");
      const timeInputs = row.querySelectorAll(".offday-start, .offday-end");
      const sync = () => {
        const half = type.value === "half";
        const showTimes = cb.checked && half;
        type.disabled = !cb.checked;
        times.hidden = !showTimes;
        timeInputs.forEach(i => { i.disabled = !showTimes; });
      };
      cb.addEventListener("change", sync);
      type.addEventListener("change", sync);
    });
    const remove = block.querySelector(".op-remove");
    if(remove){
      remove.addEventListener("click", () => {
        snapshotPeriods();
        periodDraft.splice(Number(block.dataset.idx), 1);
        if(!periodDraft.length) periodDraft = [{ from:"", to:"", days:[] }];
        renderOffPeriods();
      });
    }
  });
}

function collectDaysFrom(block){
  const out = [];
  block.querySelectorAll(".offday-row").forEach(row => {
    if(!row.querySelector(".offday-toggle").checked) return;
    const half = row.querySelector(".offday-type").value === "half";
    out.push({
      day: row.dataset.day,
      half,
      start: half ? row.querySelector(".offday-start").value : "",
      end: half ? row.querySelector(".offday-end").value : ""
    });
  });
  return out;
}

function snapshotPeriods(){
  periodDraft = [...document.querySelectorAll("#offPeriods .off-period")].map(block => ({
    from: block.querySelector(".op-from").value,
    to: block.querySelector(".op-to").value,
    days: collectDaysFrom(block)
  }));
}

async function saveProfile(){
  const start = document.getElementById("profileStart").value;
  const end = document.getElementById("profileEnd").value;
  if(start && end && end < start){
    showSaveStatus("Work period end can't be before the start.", true);
    return;
  }
  snapshotPeriods();
  const periods = periodDraft.filter(p => p.days.length || p.from || p.to);
  for(const p of periods){
    if(p.from && p.to && p.to < p.from){
      showSaveStatus("An off-day schedule has its end date before its start date.", true);
      return;
    }
  }
  state.profile = normalizeProfile({
    name: document.getElementById("profileName").value.trim(),
    company: document.getElementById("profileCompany").value.trim(),
    startDate: start,
    endDate: end,
    offPeriods: periods
  });
  try{
    await persist();
    closeProfileModal();
    renderProfile();
    renderTable();
    updateDayWeekReadout();
    showSaveStatus("Details saved ✓", false);
  }catch(e){
    showSaveStatus(e.message || "Save failed.", true);
  }
}

/* ---------- exports ---------- */
const exportState = { mode: "all" };   // all | month | week | custom

function isoOf(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function rangeBounds(){
  const t = new Date();
  if(exportState.mode === "month"){
    const y = t.getFullYear(), m = t.getMonth();
    return [ isoOf(new Date(y, m, 1)), isoOf(new Date(y, m + 1, 0)) ];
  }
  if(exportState.mode === "week"){
    const offset = (t.getDay() + 6) % 7;           // days since Monday
    const mon = new Date(t); mon.setDate(t.getDate() - offset);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return [ isoOf(mon), isoOf(sun) ];
  }
  if(exportState.mode === "custom"){
    return [ document.getElementById("erFrom").value || "",
             document.getElementById("erTo").value || "" ];
  }
  return ["", ""];
}
function entriesInRange(order = "asc"){
  const [from, to] = rangeBounds();
  return sortedEntries(order).filter(e =>
    (!from || e.date >= from) && (!to || e.date <= to)
  );
}
function rangeSuffix(){
  if(exportState.mode === "all") return "";
  const [from, to] = rangeBounds();
  if(exportState.mode === "month") return "-" + from.slice(0, 7);
  if(exportState.mode === "week") return "-week-of-" + from;
  if(from || to) return `-${from || "start"}_to_${to || "end"}`;
  return "";
}
function rangeText(){
  if(exportState.mode === "all") return "All entries";
  const [from, to] = rangeBounds();
  if(from && to) return `${prettyDate(from)} – ${prettyDate(to)}`;
  if(from) return `From ${prettyDate(from)}`;
  if(to) return `Up to ${prettyDate(to)}`;
  return "All entries";
}
function updateExportCount(){
  const el = document.getElementById("erCount");
  if(!el) return;
  const n = entriesInRange().length;
  el.textContent = n === 1 ? "1 entry" : `${n} entries`;
}

function exportRows(){
  const header = ["Date", "Day", "Week", "Notes"];
  const rows = entriesInRange("asc").map(e => [
    prettyDate(e.date), dayName(e.date), String(weekNumber(e.date, state.profile.startDate)), e.notes
  ]);
  return [header, ...rows];
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function exportCSV(){
  const rows = exportRows();
  const csv = rows.map(r => r.map(cell => {
    const v = String(cell).replace(/"/g, '""');
    return /[",\n]/.test(v) ? `"${v}"` : v;
  }).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `logbook${rangeSuffix()}.csv`);
}

function exportXLSX(){
  const rows = exportRows();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{wch:12},{wch:8},{wch:8},{wch:60}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Logbook");
  XLSX.writeFile(wb, `logbook${rangeSuffix()}.xlsx`);
}

function exportPDF(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  const rows = exportRows();
  doc.setFontSize(14);
  doc.text(`${state.profile.name || "Internship"} — Logbook`, 14, 14);
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(rangeText(), 14, 20);
  doc.setTextColor(0);
  doc.autoTable({
    head: [rows[0]],
    body: rows.slice(1),
    startY: 25,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [36, 49, 61] },
    columnStyles: { 3: { cellWidth: 190 } }
  });
  doc.save(`logbook${rangeSuffix()}.pdf`);
}

function exportPNG(){
  const [from, to] = rangeBounds();
  const hidden = [];
  document.querySelectorAll("#logTableBody tr").forEach(tr => {
    const d = tr.dataset.date;
    if(d && ((from && d < from) || (to && d > to))){ tr.style.display = "none"; hidden.push(tr); }
  });
  const restore = () => hidden.forEach(tr => { tr.style.display = ""; });
  html2canvas(document.querySelector(".log-section"), { backgroundColor: "#F5F1E4", scale: 2 })
    .then(canvas => { restore(); canvas.toBlob(blob => downloadBlob(blob, `logbook${rangeSuffix()}.png`)); })
    .catch(err => { restore(); console.error(err); showSaveStatus("Image export failed.", true); });
}

/* ---------- wire up events ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("entryDate").value = todayStr();
  updateDayWeekReadout();
  updateSyncIndicator();

  await loadData();
  renderProfile();
  renderTable();
  updateDayWeekReadout();
  updateExportCount();
  updateSyncIndicator();

  document.getElementById("entryDate").addEventListener("change", updateDayWeekReadout);
  document.getElementById("saveEntryBtn").addEventListener("click", saveEntry);

  document.getElementById("signInBtn").addEventListener("click", openSignInModal);
  document.getElementById("cancelSignIn").addEventListener("click", closeSignInModal);
  document.getElementById("confirmSignIn").addEventListener("click", async () => {
    const val = document.getElementById("tokenInput").value.trim();
    if(!val){ closeSignInModal(); return; }
    state.token = val;
    localStorage.setItem("logbook_gh_token", val);
    closeSignInModal();
    updateSyncIndicator();
    await loadData();
    renderProfile();
    renderTable();
    updateDayWeekReadout();
  });
  document.getElementById("signOutBtn").addEventListener("click", () => {
    state.token = null;
    localStorage.removeItem("logbook_gh_token");
    closeSignInModal();
    updateSyncIndicator();
    renderTable();
  });

  document.getElementById("editProfileBtn").addEventListener("click", openProfileModal);
  document.getElementById("cancelProfile").addEventListener("click", closeProfileModal);
  document.getElementById("saveProfileBtn").addEventListener("click", saveProfile);
  document.getElementById("addPeriodBtn").addEventListener("click", () => {
    snapshotPeriods();
    periodDraft.push({ from:"", to:"", days:[] });
    renderOffPeriods();
  });

  document.querySelectorAll(".er-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      exportState.mode = btn.dataset.range;
      document.querySelectorAll(".er-preset").forEach(b => b.classList.toggle("is-active", b === btn));
      document.getElementById("erCustom").hidden = exportState.mode !== "custom";
      updateExportCount();
    });
  });
  ["erFrom", "erTo"].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("change", updateExportCount);
    el.addEventListener("input", updateExportCount);
  });

  document.querySelectorAll("[data-export]").forEach(btn => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.export;
      if(entriesInRange().length === 0){ showSaveStatus("No entries in the selected range.", true); return; }
      if(kind === "csv") exportCSV();
      if(kind === "xlsx") exportXLSX();
      if(kind === "pdf") exportPDF();
      if(kind === "png") exportPNG();
    });
  });
});
