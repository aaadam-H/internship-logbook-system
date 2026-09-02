/* ---------- state ---------- */
const state = {
  profile: { name: "", company: "", startDate: "", offDay: "Sunday" },
  entries: [],   // [{date:'YYYY-MM-DD', notes:'...'}]
  sha: null,     // GitHub blob sha for data.json, needed to update it
  token: localStorage.getItem("logbook_gh_token") || null
};

const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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
    state.profile = Object.assign({ name:"", company:"", startDate:"", offDay:"Sunday" }, data.profile || {});
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
  document.getElementById("stubStart").textContent = state.profile.startDate ? prettyDate(state.profile.startDate) : "—";
  document.getElementById("stubOffDay").textContent = state.profile.offDay || "—";
  document.getElementById("statCount").textContent = state.entries.length;
  document.getElementById("statWeek").textContent = weekNumber(todayStr(), state.profile.startDate);
  document.getElementById("coverSubtitle").textContent = state.profile.name
    ? `${state.profile.name}'s daily activity record`
    : "Daily activity record";
}

function renderTable(){
  const body = document.getElementById("logTableBody");
  const rows = sortedEntries("desc");
  if(rows.length === 0){
    body.innerHTML = `<tr class="empty-row"><td colspan="5">No entries yet — log your first day above.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(entry => `
    <tr data-date="${entry.date}">
      <td class="col-date">${prettyDate(entry.date)}</td>
      <td class="col-day">${dayName(entry.date)}</td>
      <td class="col-week">${weekNumber(entry.date, state.profile.startDate)}</td>
      <td class="notes-cell">${escapeHtml(entry.notes)}</td>
      <td class="col-actions">${state.token ? `<button class="row-delete" data-date="${entry.date}">delete</button>` : ""}</td>
    </tr>
  `).join("");

  body.querySelectorAll(".row-delete").forEach(btn => {
    btn.addEventListener("click", () => deleteEntry(btn.dataset.date));
  });
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
  document.getElementById("dayWeekReadout").textContent =
    date ? `${dayName(date)} · Week ${weekNumber(date, state.profile.startDate)}` : "—";
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
function openProfileModal(){
  document.getElementById("profileName").value = state.profile.name || "";
  document.getElementById("profileCompany").value = state.profile.company || "";
  document.getElementById("profileStart").value = state.profile.startDate || "";
  document.getElementById("profileOffDay").value = state.profile.offDay || "Sunday";
  document.getElementById("profileModal").hidden = false;
}
function closeProfileModal(){ document.getElementById("profileModal").hidden = true; }

async function saveProfile(){
  state.profile = {
    name: document.getElementById("profileName").value.trim(),
    company: document.getElementById("profileCompany").value.trim(),
    startDate: document.getElementById("profileStart").value,
    offDay: document.getElementById("profileOffDay").value
  };
  try{
    await persist();
    closeProfileModal();
    renderProfile();
    renderTable();
    showSaveStatus("Details saved ✓", false);
  }catch(e){
    showSaveStatus(e.message || "Save failed.", true);
  }
}

/* ---------- exports ---------- */
function exportRows(){
  const header = ["Date", "Day", "Week", "Notes"];
  const rows = sortedEntries("asc").map(e => [
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
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "logbook.csv");
}

function exportXLSX(){
  const rows = exportRows();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{wch:12},{wch:8},{wch:8},{wch:60}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Logbook");
  XLSX.writeFile(wb, "logbook.xlsx");
}

function exportPDF(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  const rows = exportRows();
  doc.setFontSize(14);
  doc.text(`${state.profile.name || "Internship"} — Logbook`, 14, 14);
  doc.autoTable({
    head: [rows[0]],
    body: rows.slice(1),
    startY: 20,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [36, 49, 61] },
    columnStyles: { 3: { cellWidth: 190 } }
  });
  doc.save("logbook.pdf");
}

function exportPNG(){
  html2canvas(document.querySelector(".log-section"), { backgroundColor: "#F5F1E4", scale: 2 }).then(canvas => {
    canvas.toBlob(blob => downloadBlob(blob, "logbook.png"));
  });
}

/* ---------- wire up events ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("entryDate").value = todayStr();
  updateDayWeekReadout();
  updateSyncIndicator();

  await loadData();
  renderProfile();
  renderTable();
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

  document.querySelectorAll("[data-export]").forEach(btn => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.export;
      if(state.entries.length === 0){ showSaveStatus("Nothing to export yet.", true); return; }
      if(kind === "csv") exportCSV();
      if(kind === "xlsx") exportXLSX();
      if(kind === "pdf") exportPDF();
      if(kind === "png") exportPNG();
    });
  });
});
