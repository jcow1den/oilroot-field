// ============================================================
// jsa.js — JSA module logic (Session 3: Firestore wired up)
// Session 4 will add individual crew signatures.
// Session 5 will generate audit-ready PDFs.
// ============================================================

import {
  initializeApp, getApps, getApp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// auth.js already initialized Firebase. We just grab the existing app.
const app  = getApps().length ? getApp() : initializeApp({});
const auth = getAuth(app);
const db   = getFirestore(app);

// ============== CURRENT USER (set by auth observer) ==============
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;
  if (user) {
    // Load past JSAs whenever a user is signed in
    loadPastJsas();
  }
});

// ============== JOB TYPES ==============
const JOB_TYPES = [
  { id: "flowback",   name: "Flowback Operations", num: "M-01", ready: true  },
  { id: "swabbing",   name: "Swabbing",            num: "M-02", ready: false },
  { id: "roustabout", name: "Roustabout",          num: "M-03", ready: false },
  { id: "trucking",   name: "Trucking",            num: "M-04", ready: false },
  { id: "frac",       name: "Frac",                num: "M-05", ready: false },
  { id: "workover",   name: "Workover",            num: "M-06", ready: false },
  { id: "production", name: "Production",          num: "M-07", ready: false },
  { id: "pna",        name: "Plug & Abandon",      num: "M-08", ready: false }
];

// ============== FLOWBACK TEMPLATE ==============
const FLOWBACK_TEMPLATE = {
  hazards: [
    "High pressure lines and equipment failure",
    "Trapped pressure / unexpected pressure release",
    "H₂S exposure (sour gas)",
    "Hydrocarbon vapor exposure (LEL / explosive atmosphere)",
    "Fire and explosion (ignition sources, static electricity)",
    "Hot surfaces (separator vessels, flow iron after flow)",
    "Sand erosion and equipment failure",
    "Pinch points (hammer unions, valves, flow iron)",
    "Struck-by (dropped equipment, swinging iron, pressure release)",
    "Slips, trips, falls (icy catwalks, slick surfaces, hoses)",
    "Noise exposure (>85 dB)",
    "Chemical exposure (produced fluids, treatment chemicals)",
    "Spill / environmental release",
    "Heat / cold stress, fatigue (12-hour shifts)"
  ],
  controls: [
    { text: "Pre-job safety meeting completed and documented",            type: "admin" },
    { text: "Stop Work Authority communicated to all crew",               type: "admin" },
    { text: "All non-essential personnel kept clear of pressure work zones", type: "admin" },
    { text: "Pressure verified at zero before any iron disconnection",    type: "admin" },
    { text: "Hammer unions properly seated and pinned",                   type: "eng"   },
    { text: "Lines anchored / chained per operator spec",                 type: "eng"   },
    { text: "Bonding and grounding verified on all tanks",                type: "eng"   },
    { text: "Continuous gas monitoring (4-gas) at work area",             type: "eng"   },
    { text: "Wind direction noted, briefing oriented to upwind muster",   type: "admin" },
    { text: "Spill kit on site and location communicated",                type: "admin" },
    { text: "Berms / secondary containment verified",                     type: "eng"   },
    { text: "Fire extinguishers staged and inspected",                    type: "eng"   },
    { text: "Communication plan (radio, hand signals) confirmed",         type: "admin" }
  ],
  ppe: [
    "Hard hat",
    "Safety glasses (impact-rated)",
    "FR coveralls or FR layered clothing",
    "Steel-toe boots (lace-up, ANSI-rated)",
    "Cut-resistant / impact gloves",
    "Hearing protection (within 50 ft of flow iron)",
    "Personal 4-gas monitor (O₂, LEL, H₂S, CO)",
    "H₂S escape pack / SCBA available on site"
  ],
  routineSteps: [
    {
      title: "Site arrival and pre-job inspection",
      hazards: ["Driving to remote location", "Slips/trips on uneven ground", "Exposure to live equipment", "Working alone at arrival"],
      controls: ["Defensive driving", "Three points of contact entering location", "Verbal check-in with supervisor or crew at arrival", "Walk the location before touching anything", "Verify gas monitor calibration"]
    },
    {
      title: "Equipment inspection and rig-up verification",
      hazards: ["Pinch points on iron and valves", "Residual pressure in lines", "Dropped equipment during inspection", "Slick surfaces", "Leaks"],
      controls: ["Visually inspect all flow iron, hammer unions, and connections", "Verify chains/anchoring on flow lines", "Confirm pressure gauges calibrated", "Check choke for wear", "Hands clear of pinch points"]
    },
    {
      title: "Open well to flow / manage choke and separator",
      hazards: ["Sudden pressure release", "Sand erosion of choke or iron", "Hydrocarbon release if separator dump fails", "H₂S", "Vapor cloud at LEL", "Fire/explosion if ignition source present"],
      controls: ["Verify all valves correctly aligned before opening choke", "Stand clear of pressure work zone during opening", "Continuous gas monitoring", "Adjust choke incrementally", "No hot work, no smoking, no non-rated electronics in work zone", "Wind direction awareness"]
    },
    {
      title: "Routine operation and monitoring (12-hour shift)",
      hazards: ["Fatigue, complacency", "Climbing on tanks", "Slips on catwalks", "Exposure during sample collection", "Noise", "Heat / cold stress"],
      controls: ["Hourly walkarounds with awareness of wind, smell, sound changes", "Three points of contact on any ladder or catwalk", "Sample collection from upwind position with monitor on person", "Stay hydrated", "Rotate tasks if fatigue sets in", "Communicate any abnormal conditions immediately"]
    },
    {
      title: "Shift handoff and end-of-day documentation",
      hazards: ["Incomplete information transfer", "Missed equipment changes", "Environmental hazards if leaving site"],
      controls: ["Walk the location with incoming operator", "Verbally cover pressures, choke setting, sand production, any abnormal observations", "Document hourly readings", "Note any equipment issues for follow-up"]
    }
  ]
};

// ============== TEMPLATE VERSION ==============
// Bump when the template content changes. Stored on every JSA so we know
// which version of the template a record was created against.
const TEMPLATE_VERSION = "flowback-v0.1.0";

// ============== DOM REFS ==============
const backBtn       = document.getElementById("back-btn");
const startJsaBtn   = document.getElementById("start-jsa-btn");
const viewHome      = document.getElementById("view-home");
const viewPicker    = document.getElementById("view-picker");
const viewJsaForm   = document.getElementById("view-jsa-form");
const viewJsaDetail = document.getElementById("view-jsa-detail");
const jobGrid       = document.getElementById("job-grid");
const jsaJobTitle   = document.getElementById("jsa-job-title");

const jsaLocation   = document.getElementById("jsa-location");
const jsaDateInput  = document.getElementById("jsa-date");
const jsaTimeInput  = document.getElementById("jsa-time");
const captureGpsBtn = document.getElementById("capture-gps-btn");
const jsaGpsEl      = document.getElementById("jsa-gps");
const jsaHospital   = document.getElementById("jsa-hospital");
const jsaMuster     = document.getElementById("jsa-muster");

const hazardsList   = document.getElementById("hazards-list");
const controlsList  = document.getElementById("controls-list");
const ppeList       = document.getElementById("ppe-list");
const hazardsLabel  = document.getElementById("hazards-label");
const controlsLabel = document.getElementById("controls-label");
const ppeLabel      = document.getElementById("ppe-label");

const confirmStandardBtn = document.getElementById("confirm-standard-btn");
const exceptionBtn       = document.getElementById("exception-btn");
const exceptionArea      = document.getElementById("exception-area");
const exceptionText      = document.getElementById("exception-text");

const jsaTodayDifferent = document.getElementById("jsa-today-different");
const jsaStopWork       = document.getElementById("jsa-stop-work");
const taskRoutine       = document.getElementById("task-routine");
const addTaskBtn        = document.getElementById("add-task-btn");
const customTasksEl     = document.getElementById("custom-tasks");

const submitJsaBtn  = document.getElementById("submit-jsa-btn");
const submitNote    = document.getElementById("submit-note");
const formModeLabel = document.getElementById("form-mode-label");
const formModeSub   = document.getElementById("form-mode-sub");
const revisionReasonSection = document.getElementById("revision-reason-section");
const revisionReasonInput   = document.getElementById("revision-reason");
const hospitalStatus        = document.getElementById("hospital-status");
const editJsaBtn            = document.getElementById("edit-jsa-btn");

const pastJsasList   = document.getElementById("past-jsas-list");
const pastJsasCount  = document.getElementById("past-jsas-count");

const detailJobTitle = document.getElementById("detail-job-title");
const detailLocation = document.getElementById("detail-location");
const detailContent  = document.getElementById("detail-content");
const detailStatusLabel = document.getElementById("detail-status-label");

const toastEl       = document.getElementById("toast");

// ============== STATE ==============
let currentJob       = null;     // Selected job type when filling out a form
let currentTemplate  = null;     // The template object loaded for that job
let isStandardConfirmed = false; // Has the user tapped the confirm button?
let standardConfirmedAt = null;  // Timestamp when they tapped it
let exceptionFlagged = false;    // Has the user opened the exception path?

// Edit mode tracking
let editMode        = false;     // Are we editing an existing JSA?
let editingDocId    = null;      // Doc ID of the JSA being edited
let editingOriginal = null;      // Original data of the JSA being edited (for revision history)
let detailDocId     = null;      // Currently-viewed JSA in the detail view

// ============== VIEW NAVIGATION ==============
let viewStack = ["home"];

function navigateTo(viewName) {
  viewHome.hidden = true;
  viewPicker.hidden = true;
  viewJsaForm.hidden = true;
  viewJsaDetail.hidden = true;

  if (viewName === "home") {
    viewHome.hidden = false;
    backBtn.hidden = true;
  } else if (viewName === "picker") {
    viewPicker.hidden = false;
    backBtn.hidden = false;
  } else if (viewName === "jsa-form") {
    viewJsaForm.hidden = false;
    backBtn.hidden = false;
  } else if (viewName === "jsa-detail") {
    viewJsaDetail.hidden = false;
    backBtn.hidden = false;
  }

  if (viewStack[viewStack.length - 1] !== viewName) {
    viewStack.push(viewName);
  }

  window.scrollTo(0, 0);
}

function goBack() {
  if (viewStack.length > 1) {
    viewStack.pop();
    const prev = viewStack[viewStack.length - 1];
    viewStack.pop();
    navigateTo(prev);
  } else {
    navigateTo("home");
  }
}

backBtn.addEventListener("click", goBack);
startJsaBtn.addEventListener("click", () => navigateTo("picker"));

// ============== JOB PICKER ==============
function renderJobGrid() {
  jobGrid.innerHTML = "";
  JOB_TYPES.forEach((job) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "job-tile" + (job.ready ? "" : " disabled");
    tile.disabled = !job.ready;
    tile.innerHTML = `
      <span class="job-tile-num">${job.num}</span>
      <h3 class="job-tile-name">${job.name}</h3>
      <span class="job-tile-tag ${job.ready ? "ready" : "coming"}">${job.ready ? "Ready" : "Coming soon"}</span>
    `;
    if (job.ready) {
      tile.addEventListener("click", () => openJsaForm(job));
    }
    jobGrid.appendChild(tile);
  });
}
renderJobGrid();

// ============== JSA FORM ==============
function openJsaForm(job) {
  currentJob = job;
  currentTemplate = (job.id === "flowback") ? FLOWBACK_TEMPLATE : null;

  jsaJobTitle.textContent = job.name;

  // Reset edit mode (this is a fresh new JSA)
  editMode = false;
  editingDocId = null;
  editingOriginal = null;
  revisionReasonSection.hidden = true;
  formModeLabel.textContent = "NEW JSA · STEP 2 OF 2";
  formModeSub.textContent = "Pre-job hazard analysis. Smart defaults pre-loaded. Spend your attention on what's specific to today.";
  submitJsaBtn.querySelector(".btn-label").textContent = "Submit JSA";
  submitNote.textContent = "RECORDS ARE TAMPER-EVIDENT · TIMESTAMPED ON SUBMISSION";

  resetJsaForm();

  if (currentTemplate) {
    populateStandardLists(currentTemplate);
  }

  const now = new Date();
  jsaDateInput.value = now.toISOString().slice(0, 10);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  jsaTimeInput.value = `${hh}:${mm}`;

  navigateTo("jsa-form");

  // Auto-capture GPS in the background after view transition
  setTimeout(autoCaptureGps, 500);
}

function populateStandardLists(template) {
  hazardsLabel.textContent = `Standard hazards (${template.hazards.length})`;
  hazardsList.innerHTML = template.hazards.map(h => `<li>${escapeHtml(h)}</li>`).join("");

  controlsLabel.textContent = `Standard controls (${template.controls.length})`;
  controlsList.innerHTML = template.controls
    .map(c => {
      const tag = c.type === "eng" ? "ENGINEERING" : c.type === "admin" ? "ADMIN" : "PPE";
      return `<li>${escapeHtml(c.text)}<span class="hierarchy-tag">${tag}</span></li>`;
    })
    .join("");

  ppeLabel.textContent = `Standard PPE (${template.ppe.length})`;
  ppeList.innerHTML = template.ppe.map(p => `<li>${escapeHtml(p)}</li>`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  }[m]));
}

document.querySelectorAll(".link-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.toggle;
    const target = document.getElementById(targetId);
    if (target.hidden) {
      target.hidden = false;
      btn.textContent = "Hide list";
    } else {
      target.hidden = true;
      btn.textContent = "View list";
    }
  });
});

confirmStandardBtn.addEventListener("click", () => {
  isStandardConfirmed = !isStandardConfirmed;
  confirmStandardBtn.classList.toggle("confirmed", isStandardConfirmed);
  if (isStandardConfirmed) {
    standardConfirmedAt = new Date().toISOString();
    confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "Confirmed for today's work";
  } else {
    standardConfirmedAt = null;
    confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "I confirm all standard items apply to today's work";
  }
});

exceptionBtn.addEventListener("click", () => {
  exceptionFlagged = exceptionArea.hidden;
  exceptionArea.hidden = !exceptionArea.hidden;
  exceptionBtn.textContent = exceptionArea.hidden ? "Something is different" : "Cancel exception";
});

// ============== GPS ==============
let capturedGps = null;

captureGpsBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showToast("GPS not available on this device", "error");
    return;
  }

  captureGpsBtn.disabled = true;
  captureGpsBtn.textContent = "Capturing...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      capturedGps = { lat, lng, accuracy: pos.coords.accuracy, capturedAt: new Date().toISOString() };
      const accFt = Math.round((pos.coords.accuracy || 0) * 3.281);
      jsaGpsEl.textContent = `${lat.toFixed(5)}°, ${lng.toFixed(5)}° (±${accFt} ft)`;
      jsaGpsEl.classList.add("captured");
      captureGpsBtn.textContent = "Recapture";
      captureGpsBtn.disabled = false;
      // Trigger hospital lookup
      lookupNearestHospital(lat, lng);
    },
    (err) => {
      let msg = "GPS unavailable";
      if (err.code === 1) msg = "GPS permission denied";
      if (err.code === 3) msg = "GPS timed out";
      showToast(msg, "error");
      captureGpsBtn.textContent = "Capture GPS";
      captureGpsBtn.disabled = false;
    },
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    }
  );
});

// Auto-capture GPS silently when the form opens. If permission is denied or
// fails, the manual button stays as fallback.
function autoCaptureGps() {
  if (!navigator.geolocation) return;
  if (capturedGps) return; // Already captured (e.g. in edit mode)

  captureGpsBtn.disabled = true;
  captureGpsBtn.textContent = "Capturing...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      capturedGps = { lat, lng, accuracy: pos.coords.accuracy, capturedAt: new Date().toISOString() };
      const accFt = Math.round((pos.coords.accuracy || 0) * 3.281);
      jsaGpsEl.textContent = `${lat.toFixed(5)}°, ${lng.toFixed(5)}° (±${accFt} ft)`;
      jsaGpsEl.classList.add("captured");
      captureGpsBtn.textContent = "Recapture";
      captureGpsBtn.disabled = false;
      lookupNearestHospital(lat, lng);
    },
    (err) => {
      // Quiet failure for auto-capture; user can still tap the button
      captureGpsBtn.textContent = "Capture GPS";
      captureGpsBtn.disabled = false;
    },
    {
      enableHighAccuracy: true,
      timeout: 20000,    // 20s gives the GPS chip time to lock
      maximumAge: 0      // Never accept a cached fix
    }
  );
}

// Look up nearest hospital from GPS coordinates using OpenStreetMap Overpass API.
// Free, no API key. Search radius starts at 10km and expands to 50km if nothing found.
async function lookupNearestHospital(lat, lng) {
  // Don't overwrite if user has already typed something
  if (jsaHospital.value.trim()) return;

  hospitalStatus.hidden = false;
  hospitalStatus.textContent = "Finding nearest hospital...";

  try {
    const result = await queryOverpassForHospital(lat, lng, 10000)
      || await queryOverpassForHospital(lat, lng, 50000);

    if (!result) {
      hospitalStatus.textContent = "No hospital found nearby. Type one in.";
      return;
    }

    // Don't overwrite if user typed something while we were waiting
    if (jsaHospital.value.trim()) {
      hospitalStatus.hidden = true;
      return;
    }

    jsaHospital.value = result.display;
    hospitalStatus.textContent = `Auto-suggested · ${result.distanceMi.toFixed(1)} mi away. Edit if wrong.`;
  } catch (err) {
    console.warn("Hospital lookup failed:", err);
    hospitalStatus.textContent = "Hospital lookup unavailable. Type one in.";
  }
}

async function queryOverpassForHospital(lat, lng, radiusMeters) {
  // We want full-service hospitals with emergency departments, not specialty
  // clinics. OpenStreetMap data quality varies, so we use multiple signals:
  //   - amenity=hospital is the base tag
  //   - emergency=yes confirms an ER (best signal when present)
  //   - healthcare=hospital is a more rigorous tag than amenity alone
  // We exclude specialty/eye/dental/clinic-style facilities by keyword.
  const overpassQuery = `
    [out:json][timeout:8];
    (
      node["amenity"="hospital"]["emergency"="yes"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"]["emergency"="yes"](around:${radiusMeters},${lat},${lng});
      node["amenity"="hospital"]["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"]["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
      node["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
    );
    out center 25;
  `;
  const url = "https://overpass-api.de/api/interpreter";
  const resp = await fetch(url, {
    method: "POST",
    body: "data=" + encodeURIComponent(overpassQuery)
  });
  if (!resp.ok) throw new Error("Overpass API error: " + resp.status);
  const data = await resp.json();
  if (!data.elements || data.elements.length === 0) return null;

  // Keywords that indicate a specialty clinic, not a full-service hospital
  const SPECIALTY_KEYWORDS = [
    "eye", "vision", "ophthalm", "dental", "orthodont",
    "dermatolog", "fertility", "psychiatric", "behavioral",
    "rehabilitation", "rehab center", "surgery center",
    "outpatient", "urgent care", "veterinary", "animal",
    "children", "pediatric only", "cancer center",
    "cardiac care", "orthopedic only", "physical therapy"
  ];

  function looksLikeSpecialty(name, tags) {
    const lower = (name || "").toLowerCase();
    if (SPECIALTY_KEYWORDS.some(kw => lower.includes(kw))) return true;
    // Tag-based filters
    if (tags?.healthcare === "clinic") return true;
    if (tags?.healthcare === "doctor") return true;
    if (tags?.healthcare === "dentist") return true;
    return false;
  }

  // Build candidate list with distance, separating preferred from fallback
  const preferred = [];   // Has emergency=yes or healthcare=hospital
  const fallback = [];    // Generic amenity=hospital, not specialty

  // Deduplicate by place ID
  const seen = new Set();

  data.elements.forEach(el => {
    const elLat = el.lat ?? el.center?.lat;
    const elLng = el.lon ?? el.center?.lon;
    if (elLat == null || elLng == null) return;
    const name = el.tags?.name;
    if (!name) return;
    const id = `${el.type}-${el.id}`;
    if (seen.has(id)) return;
    seen.add(id);

    if (looksLikeSpecialty(name, el.tags)) return;

    const candidate = {
      name,
      tags: el.tags || {},
      distanceMi: haversineKm(lat, lng, elLat, elLng) * 0.621371
    };

    const hasEr = el.tags?.emergency === "yes";
    const isHospitalHealthcare = el.tags?.healthcare === "hospital";

    if (hasEr || isHospitalHealthcare) {
      preferred.push(candidate);
    } else {
      fallback.push(candidate);
    }
  });

  // Pick from preferred list first; fall back to generic only if nothing better
  const pool = preferred.length ? preferred : fallback;
  if (!pool.length) return null;

  pool.sort((a, b) => a.distanceMi - b.distanceMi);
  const closest = pool[0];

  // Annotate the suggestion if we know it has an ER
  const erSuffix = closest.tags?.emergency === "yes" ? " · ER confirmed" : "";

  return {
    display: `${closest.name} (~${closest.distanceMi.toFixed(1)} mi)${erSuffix}`,
    distanceMi: closest.distanceMi
  };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => d * Math.PI / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============== CUSTOM TASKS ==============
let customTaskCount = 0;

addTaskBtn.addEventListener("click", () => {
  customTaskCount += 1;
  const taskEl = document.createElement("div");
  taskEl.className = "custom-task";
  taskEl.dataset.taskNum = customTaskCount;
  taskEl.innerHTML = `
    <div class="custom-task-head">
      <span class="custom-task-num">NON-ROUTINE TASK #${String(customTaskCount).padStart(2, "0")}</span>
      <button type="button" class="custom-task-remove" data-action="remove">Remove</button>
    </div>
    <label class="field-group">
      <span class="spec-label">Task description</span>
      <input type="text" class="field custom-task-desc" placeholder="e.g., Swap out worn choke insert" />
    </label>
    <label class="field-group">
      <span class="spec-label">Specific hazards for this task</span>
      <textarea class="field textarea custom-task-hazards" rows="2" placeholder="What could go wrong specifically with this task?"></textarea>
    </label>
    <label class="field-group">
      <span class="spec-label">Controls for this task</span>
      <textarea class="field textarea custom-task-controls" rows="2" placeholder="LOTO, depressurize, two-person verification, etc."></textarea>
    </label>
  `;
  taskEl.querySelector("[data-action=remove]").addEventListener("click", () => {
    taskEl.remove();
  });
  customTasksEl.appendChild(taskEl);
});

function gatherCustomTasks() {
  const tasks = [];
  customTasksEl.querySelectorAll(".custom-task").forEach(el => {
    const desc     = el.querySelector(".custom-task-desc").value.trim();
    const hazards  = el.querySelector(".custom-task-hazards").value.trim();
    const controls = el.querySelector(".custom-task-controls").value.trim();
    if (desc || hazards || controls) {
      tasks.push({ description: desc, hazards, controls });
    }
  });
  return tasks;
}

// ============== SUBMIT (handles both create and revise) ==============
submitJsaBtn.addEventListener("click", async () => {
  if (!currentUser) {
    showToast("You must be signed in to submit a JSA", "error");
    return;
  }

  // Validate required fields
  const location = jsaLocation.value.trim();
  if (!location) {
    showToast("Location / pad / well name is required", "error");
    jsaLocation.focus();
    return;
  }
  if (!isStandardConfirmed && !exceptionFlagged) {
    showToast("Confirm standard items, or flag an exception, before submitting", "error");
    return;
  }
  if (exceptionFlagged && !exceptionText.value.trim()) {
    showToast("Describe what's different from standard, or untick the exception", "error");
    exceptionText.focus();
    return;
  }

  // Edit-mode requires a revision reason
  if (editMode) {
    const reason = revisionReasonInput.value.trim();
    if (!reason) {
      showToast("Revision reason is required", "error");
      revisionReasonInput.focus();
      return;
    }
    await saveRevision(reason);
    return;
  }

  // New JSA: build a fresh record
  const record = buildJsaRecord({ location });

  submitJsaBtn.disabled = true;
  submitJsaBtn.querySelector(".btn-label").textContent = "Submitting...";

  try {
    const colRef = collection(db, "users", currentUser.uid, "jsas");
    const docRef = await addDoc(colRef, record);
    showToast("JSA submitted and saved", "success");
    resetJsaForm();
    navigateTo("home");
    await loadPastJsas();
  } catch (err) {
    console.error("JSA submit error:", err);
    showToast("Could not save JSA: " + (err.message || "unknown error"), "error");
  } finally {
    submitJsaBtn.disabled = false;
    submitJsaBtn.querySelector(".btn-label").textContent = "Submit JSA";
  }
});

// Save a revision to an existing JSA. Original record is updated with the new
// field values, and a snapshot of the prior state is appended to the
// `revisions` array. Nothing is overwritten without a preserved copy.
async function saveRevision(reason) {
  submitJsaBtn.disabled = true;
  submitJsaBtn.querySelector(".btn-label").textContent = "Saving revision...";

  try {
    // Build the new field values from the form
    const newValues = buildJsaRecord({ location: jsaLocation.value.trim() });

    // Strip the fields we don't want to overwrite (audit trail stays put)
    delete newValues.createdAt;     // Original creation time stays
    delete newValues.submittedAt;   // Original submission time stays
    delete newValues.revisionCount; // We'll set explicitly below

    // Build the snapshot of the prior state to append to revisions[]
    const priorSnapshot = snapshotPriorState(editingOriginal);

    // The revision record itself
    const revision = {
      revisedAt:        Timestamp.now(),
      revisedByUid:     currentUser.uid,
      revisedByEmail:   currentUser.email,
      revisedByName:    currentUser.displayName || "",
      reason:           reason,
      priorState:       priorSnapshot
    };

    const newRevisionCount = (editingOriginal.revisionCount || 0) + 1;

    const docRef = doc(db, "users", currentUser.uid, "jsas", editingDocId);
    await updateDoc(docRef, {
      ...newValues,
      revisionCount: newRevisionCount,
      revisions: arrayUnion(revision)
    });

    showToast("Revision saved · audit trail updated", "success");
    resetJsaForm();
    // Reload detail view with the updated data
    await openJsaDetail(editingDocId);
    await loadPastJsas();
  } catch (err) {
    console.error("Revision save error:", err);
    showToast("Could not save revision: " + (err.message || "unknown error"), "error");
  } finally {
    submitJsaBtn.disabled = false;
    submitJsaBtn.querySelector(".btn-label").textContent = "Save revision";
  }
}

// Capture the prior state of a JSA so it's preserved when a revision is saved.
// We store the field values that could have changed; the immutable audit
// trail (creation time, submitter identity) doesn't need to be duplicated.
function snapshotPriorState(data) {
  return {
    location:         data.location,
    date:             data.date,
    shiftStart:       data.shiftStart,
    gps:              data.gps,
    nearestHospital:  data.nearestHospital,
    musterPoint:      data.musterPoint,
    standardConfirmed:    data.standardConfirmed,
    standardConfirmedAt:  data.standardConfirmedAt,
    exceptionFlagged:     data.exceptionFlagged,
    exceptionText:        data.exceptionText,
    todayDifferent:       data.todayDifferent,
    stopWork:             data.stopWork,
    routineTaskAcknowledged: data.routineTaskAcknowledged,
    customTasks:          data.customTasks
  };
}

function buildJsaRecord({ location }) {
  // Snapshot the template content as it is at submission time. This is the
  // legal record. Even if the template is updated later, this JSA shows the
  // hazards/controls/PPE the user actually saw and acknowledged.
  const templateSnapshot = currentTemplate ? {
    hazards:  currentTemplate.hazards,
    controls: currentTemplate.controls,
    ppe:      currentTemplate.ppe,
    routineSteps: currentTemplate.routineSteps
  } : null;

  return {
    // Identity
    userId:        currentUser.uid,
    userEmail:     currentUser.email,
    userDisplayName: currentUser.displayName || "",

    // Job info
    jobTypeId:     currentJob.id,
    jobTypeName:   currentJob.name,
    templateVersion: TEMPLATE_VERSION,

    // Job site
    location:      location,
    date:          jsaDateInput.value || null,
    shiftStart:    jsaTimeInput.value || null,
    gps:           capturedGps,
    nearestHospital: jsaHospital.value.trim(),
    musterPoint:     jsaMuster.value.trim(),

    // Standard items
    standardConfirmed:   isStandardConfirmed,
    standardConfirmedAt: standardConfirmedAt,
    exceptionFlagged:    exceptionFlagged,
    exceptionText:       exceptionFlagged ? exceptionText.value.trim() : "",
    templateSnapshot:    templateSnapshot,

    // Today's specifics
    todayDifferent: jsaTodayDifferent.value.trim(),
    stopWork:       jsaStopWork.value.trim(),

    // Tasks
    routineTaskAcknowledged: !!taskRoutine.checked,
    customTasks:    gatherCustomTasks(),

    // Audit trail (server-side, can't be faked client-side)
    createdAt:      serverTimestamp(),
    submittedAt:    serverTimestamp(),
    revisionCount:  0,
    schemaVersion:  1
  };
}

// ============== LOAD PAST JSAs ==============
async function loadPastJsas() {
  if (!currentUser) return;

  pastJsasList.innerHTML = `
    <div class="empty-state">
      <p class="empty-text">Loading past JSAs...</p>
    </div>
  `;

  try {
    const colRef = collection(db, "users", currentUser.uid, "jsas");
    const q = query(colRef, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      pastJsasList.innerHTML = `
        <div class="empty-state">
          <p class="empty-text">No JSAs yet. Your submitted JSAs will appear here.</p>
        </div>
      `;
      pastJsasCount.hidden = true;
      return;
    }

    pastJsasCount.hidden = false;
    pastJsasCount.textContent = `${snap.size} TOTAL`;

    pastJsasList.innerHTML = "";
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const card = renderPastJsaCard(docSnap.id, data);
      pastJsasList.appendChild(card);
    });
  } catch (err) {
    console.error("Past JSAs load error:", err);
    pastJsasList.innerHTML = `
      <div class="empty-state">
        <p class="empty-text">Could not load past JSAs.</p>
        <p class="empty-sub font-mono">${escapeHtml(err.message || "UNKNOWN ERROR")}</p>
      </div>
    `;
  }
}

function renderPastJsaCard(docId, data) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "past-jsa-card";

  const dateLabel = formatDateLabel(data.date, data.createdAt);
  const jobTag = data.jobTypeName || "Unknown job type";

  card.innerHTML = `
    <div class="past-jsa-info">
      <span class="past-jsa-location">${escapeHtml(data.location || "Untitled")}</span>
      <div class="past-jsa-meta">
        <span>${escapeHtml(jobTag)}</span>
        <span class="past-jsa-meta-dot">·</span>
        <span>${escapeHtml(dateLabel)}</span>
      </div>
    </div>
    <svg class="past-jsa-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  card.addEventListener("click", () => openJsaDetail(docId));
  return card;
}

function formatDateLabel(dateStr, createdAtTimestamp) {
  if (dateStr) {
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {}
  }
  if (createdAtTimestamp && createdAtTimestamp.toDate) {
    return createdAtTimestamp.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  return "—";
}

// ============== JSA DETAIL VIEW ==============
async function openJsaDetail(docId) {
  if (!currentUser) return;

  detailDocId = docId;
  detailJobTitle.textContent = "Loading...";
  detailLocation.textContent = "";
  detailContent.innerHTML = "";
  editJsaBtn.hidden = true;
  navigateTo("jsa-detail");

  try {
    const docRef = doc(db, "users", currentUser.uid, "jsas", docId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      detailJobTitle.textContent = "Not found";
      detailContent.innerHTML = `<p class="empty-text">This JSA could not be loaded. It may have been deleted.</p>`;
      return;
    }
    const data = snap.data();
    renderDetailView(data);
    editJsaBtn.hidden = false;
  } catch (err) {
    console.error("Detail load error:", err);
    detailJobTitle.textContent = "Could not load";
    detailContent.innerHTML = `<p class="empty-text">${escapeHtml(err.message || "Unknown error")}</p>`;
  }
}

// Edit button on the detail view: load the JSA into the form for revision
editJsaBtn.addEventListener("click", async () => {
  if (!detailDocId || !currentUser) return;

  try {
    const docRef = doc(db, "users", currentUser.uid, "jsas", detailDocId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      showToast("This JSA no longer exists", "error");
      return;
    }
    openJsaForEdit(detailDocId, snap.data());
  } catch (err) {
    console.error("Edit load error:", err);
    showToast("Could not open for editing: " + (err.message || "unknown error"), "error");
  }
});

// Open the form in edit mode, pre-populated with the existing JSA's values.
function openJsaForEdit(docId, data) {
  // Find the matching job type
  const job = JOB_TYPES.find(j => j.id === data.jobTypeId) || JOB_TYPES[0];
  currentJob = job;
  currentTemplate = (job.id === "flowback") ? FLOWBACK_TEMPLATE : null;

  jsaJobTitle.textContent = job.name;

  // Set edit-mode state BEFORE resetJsaForm (which only clears fields)
  editMode        = true;
  editingDocId    = docId;
  editingOriginal = data;

  resetJsaForm();

  // Show revision reason section, update mode label and button
  revisionReasonSection.hidden = false;
  formModeLabel.textContent = "EDIT JSA · REVISION";
  formModeSub.textContent = "Update what's changed in the field. Original record is preserved as part of the audit trail.";
  submitJsaBtn.querySelector(".btn-label").textContent = "Save revision";
  submitNote.textContent = "PRIOR STATE PRESERVED · ALL REVISIONS TIMESTAMPED";

  if (currentTemplate) populateStandardLists(currentTemplate);

  // Pre-populate fields from existing data
  jsaLocation.value         = data.location || "";
  jsaDateInput.value        = data.date || "";
  jsaTimeInput.value        = data.shiftStart || "";
  jsaHospital.value         = data.nearestHospital || "";
  jsaMuster.value           = data.musterPoint || "";
  jsaTodayDifferent.value   = data.todayDifferent || "";
  jsaStopWork.value         = data.stopWork || "";

  // GPS preserved from prior state
  if (data.gps) {
    capturedGps = data.gps;
    const accFt = Math.round((data.gps.accuracy || 0) * 3.281);
    jsaGpsEl.textContent = `${data.gps.lat.toFixed(5)}°, ${data.gps.lng.toFixed(5)}° (±${accFt} ft)`;
    jsaGpsEl.classList.add("captured");
    captureGpsBtn.textContent = "Recapture";
  }

  // Standard items state
  if (data.standardConfirmed) {
    isStandardConfirmed = true;
    standardConfirmedAt = data.standardConfirmedAt;
    confirmStandardBtn.classList.add("confirmed");
    confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "Confirmed for today's work";
  }
  if (data.exceptionFlagged) {
    exceptionFlagged = true;
    exceptionArea.hidden = false;
    exceptionBtn.textContent = "Cancel exception";
    exceptionText.value = data.exceptionText || "";
  }

  // Routine task acknowledgment
  if (taskRoutine) taskRoutine.checked = !!data.routineTaskAcknowledged;

  // Custom tasks: re-populate
  if (Array.isArray(data.customTasks)) {
    data.customTasks.forEach(t => {
      addTaskBtn.click(); // Adds an empty custom task block
      const lastTask = customTasksEl.lastElementChild;
      if (lastTask) {
        lastTask.querySelector(".custom-task-desc").value     = t.description || "";
        lastTask.querySelector(".custom-task-hazards").value  = t.hazards || "";
        lastTask.querySelector(".custom-task-controls").value = t.controls || "";
      }
    });
  }

  navigateTo("jsa-form");
}

function renderDetailView(data) {
  detailJobTitle.textContent = data.jobTypeName || "Unknown job type";
  detailLocation.textContent = data.location || "—";
  detailStatusLabel.textContent = "SUBMITTED JSA";

  const sections = [];

  // Section 01: Job site
  const dateLabel = data.date
    ? new Date(data.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "—";
  const gpsLabel = data.gps
    ? `${data.gps.lat.toFixed(5)}°, ${data.gps.lng.toFixed(5)}° (±${Math.round((data.gps.accuracy || 0) * 3.281)} ft)`
    : "Not captured";

  sections.push(`
    <div class="detail-section">
      <div class="detail-section-head">
        <span class="detail-section-num">§ 01</span>
        <h3 class="detail-section-title">Job site</h3>
      </div>
      <div class="detail-row">
        <span class="spec-label">Location</span>
        <span class="detail-value">${escapeHtml(data.location || "—")}</span>
      </div>
      <div class="detail-meta-row">
        <div class="detail-row">
          <span class="spec-label">Date</span>
          <span class="detail-value">${escapeHtml(dateLabel)}</span>
        </div>
        <div class="detail-row">
          <span class="spec-label">Shift start</span>
          <span class="detail-value">${escapeHtml(data.shiftStart || "—")}</span>
        </div>
      </div>
      <div class="detail-row">
        <span class="spec-label">GPS coordinates</span>
        <span class="detail-value mono">${escapeHtml(gpsLabel)}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Nearest hospital</span>
        <span class="detail-value ${data.nearestHospital ? "" : "muted"}">${escapeHtml(data.nearestHospital || "Not specified")}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Muster point</span>
        <span class="detail-value ${data.musterPoint ? "" : "muted"}">${escapeHtml(data.musterPoint || "Not specified")}</span>
      </div>
    </div>
  `);

  // Section 02: Standard items
  const tpl = data.templateSnapshot;
  const confirmedAtLabel = data.standardConfirmedAt
    ? new Date(data.standardConfirmedAt).toLocaleString()
    : "—";

  let standardSection = `
    <div class="detail-section">
      <div class="detail-section-head">
        <span class="detail-section-num">§ 02</span>
        <h3 class="detail-section-title">Standard items</h3>
      </div>
  `;

  if (data.standardConfirmed) {
    standardSection += `
      <span class="detail-confirm-pill confirmed">✓ Confirmed at ${escapeHtml(confirmedAtLabel)}</span>
    `;
  }
  if (data.exceptionFlagged) {
    standardSection += `
      <span class="detail-confirm-pill exception">! Exception flagged</span>
      <div class="detail-row">
        <span class="spec-label">What's different</span>
        <span class="detail-value">${escapeHtml(data.exceptionText || "—")}</span>
      </div>
    `;
  }

  if (tpl && tpl.hazards) {
    standardSection += `
      <div class="detail-row">
        <span class="spec-label">Hazards (${tpl.hazards.length})</span>
        <ul class="standard-list">
          ${tpl.hazards.map(h => `<li>${escapeHtml(h)}</li>`).join("")}
        </ul>
      </div>
    `;
  }
  if (tpl && tpl.controls) {
    standardSection += `
      <div class="detail-row">
        <span class="spec-label">Controls (${tpl.controls.length})</span>
        <ul class="standard-list">
          ${tpl.controls.map(c => {
            const tag = c.type === "eng" ? "ENGINEERING" : c.type === "admin" ? "ADMIN" : "PPE";
            return `<li>${escapeHtml(c.text)}<span class="hierarchy-tag">${tag}</span></li>`;
          }).join("")}
        </ul>
      </div>
    `;
  }
  if (tpl && tpl.ppe) {
    standardSection += `
      <div class="detail-row">
        <span class="spec-label">PPE (${tpl.ppe.length})</span>
        <ul class="standard-list">
          ${tpl.ppe.map(p => `<li>${escapeHtml(p)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  standardSection += `</div>`;
  sections.push(standardSection);

  // Section 03: Today's specifics
  sections.push(`
    <div class="detail-section">
      <div class="detail-section-head">
        <span class="detail-section-num">§ 03</span>
        <h3 class="detail-section-title">Today's specifics</h3>
      </div>
      <div class="detail-row">
        <span class="spec-label">What's different about this job today</span>
        <span class="detail-value ${data.todayDifferent ? "" : "muted"}">${escapeHtml(data.todayDifferent || "Nothing noted")}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Stop work conditions for today</span>
        <span class="detail-value ${data.stopWork ? "" : "muted"}">${escapeHtml(data.stopWork || "Nothing noted")}</span>
      </div>
    </div>
  `);

  // Section 04: Tasks (routine steps + custom)
  let tasksSection = `
    <div class="detail-section">
      <div class="detail-section-head">
        <span class="detail-section-num">§ 04</span>
        <h3 class="detail-section-title">Today's tasks</h3>
      </div>
  `;
  if (data.routineTaskAcknowledged && tpl && tpl.routineSteps) {
    tasksSection += `<span class="detail-confirm-pill confirmed">✓ Routine task breakdown acknowledged</span>`;
    tpl.routineSteps.forEach((step, i) => {
      tasksSection += `
        <div class="detail-step">
          <div class="detail-step-head">
            <span class="detail-step-num">STEP ${String(i + 1).padStart(2, "0")}</span>
            <h4 class="detail-step-title">${escapeHtml(step.title)}</h4>
          </div>
          <p class="detail-step-sub">Hazards</p>
          <ul class="detail-step-list">
            ${step.hazards.map(h => `<li>${escapeHtml(h)}</li>`).join("")}
          </ul>
          <p class="detail-step-sub">Controls</p>
          <ul class="detail-step-list">
            ${step.controls.map(c => `<li>${escapeHtml(c)}</li>`).join("")}
          </ul>
        </div>
      `;
    });
  }
  if (Array.isArray(data.customTasks) && data.customTasks.length) {
    data.customTasks.forEach((t, i) => {
      tasksSection += `
        <div class="detail-step">
          <div class="detail-step-head">
            <span class="detail-step-num">NON-ROUTINE #${String(i + 1).padStart(2, "0")}</span>
            <h4 class="detail-step-title">${escapeHtml(t.description || "—")}</h4>
          </div>
          ${t.hazards ? `<p class="detail-step-sub">Hazards</p><div class="detail-value">${escapeHtml(t.hazards)}</div>` : ""}
          ${t.controls ? `<p class="detail-step-sub">Controls</p><div class="detail-value">${escapeHtml(t.controls)}</div>` : ""}
        </div>
      `;
    });
  }
  tasksSection += `</div>`;
  sections.push(tasksSection);

  // Section 05: Audit trail
  const submittedAtLabel = data.submittedAt && data.submittedAt.toDate
    ? data.submittedAt.toDate().toLocaleString()
    : "—";

  let auditSection = `
    <div class="detail-section">
      <div class="detail-section-head">
        <span class="detail-section-num">§ 05</span>
        <h3 class="detail-section-title">Audit trail</h3>
      </div>
      <div class="detail-row">
        <span class="spec-label">Originally submitted</span>
        <span class="detail-value mono">${escapeHtml(submittedAtLabel)}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Submitted by</span>
        <span class="detail-value">${escapeHtml(data.userDisplayName || data.userEmail || "—")}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Template version</span>
        <span class="detail-value mono">${escapeHtml(data.templateVersion || "—")}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Revisions</span>
        <span class="detail-value mono">${data.revisionCount || 0}</span>
      </div>
  `;

  // Revision history
  if (Array.isArray(data.revisions) && data.revisions.length) {
    auditSection += `
      <div class="detail-row">
        <span class="spec-label">Revision history (newest first)</span>
        <ul class="revision-list">
    `;
    // Newest first
    const sortedRevisions = [...data.revisions].sort((a, b) => {
      const at = a.revisedAt && a.revisedAt.toDate ? a.revisedAt.toDate().getTime() : 0;
      const bt = b.revisedAt && b.revisedAt.toDate ? b.revisedAt.toDate().getTime() : 0;
      return bt - at;
    });
    sortedRevisions.forEach((rev, idx) => {
      const num = sortedRevisions.length - idx; // Newest = highest number
      const ts = rev.revisedAt && rev.revisedAt.toDate ? rev.revisedAt.toDate().toLocaleString() : "—";
      const by = rev.revisedByName || rev.revisedByEmail || "—";
      auditSection += `
        <li class="revision-item">
          <div class="revision-head">
            <span class="revision-num">REVISION ${String(num).padStart(2, "0")}</span>
            <span class="revision-time">${escapeHtml(ts)}</span>
          </div>
          <span class="revision-by">By ${escapeHtml(by)}</span>
          <div class="revision-reason">${escapeHtml(rev.reason || "—")}</div>
        </li>
      `;
    });
    // Original at the bottom of the list
    auditSection += `
      <li class="revision-item original">
        <div class="revision-head">
          <span class="revision-num original">ORIGINAL</span>
          <span class="revision-time">${escapeHtml(submittedAtLabel)}</span>
        </div>
        <span class="revision-by">By ${escapeHtml(data.userDisplayName || data.userEmail || "—")}</span>
      </li>
    `;
    auditSection += `</ul></div>`;
  }

  auditSection += `</div>`;
  sections.push(auditSection);

  detailContent.innerHTML = sections.join("");
}

// ============== RESET ==============
function resetJsaForm() {
  viewJsaForm.querySelectorAll("input[type=text], input[type=date], input[type=time], textarea").forEach(el => {
    el.value = "";
  });
  jsaGpsEl.textContent = "Not captured";
  jsaGpsEl.classList.remove("captured");
  capturedGps = null;
  isStandardConfirmed = false;
  standardConfirmedAt = null;
  exceptionFlagged = false;
  confirmStandardBtn.classList.remove("confirmed");
  confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "I confirm all standard items apply to today's work";
  exceptionArea.hidden = true;
  exceptionBtn.textContent = "Something is different";
  ["hazards-list", "controls-list", "ppe-list"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  document.querySelectorAll(".link-toggle").forEach(btn => btn.textContent = "View list");
  if (taskRoutine) taskRoutine.checked = true;
  customTasksEl.innerHTML = "";
  customTaskCount = 0;
  // Hospital lookup status and revision reason
  if (hospitalStatus) {
    hospitalStatus.hidden = true;
    hospitalStatus.textContent = "";
  }
  if (revisionReasonInput) revisionReasonInput.value = "";
}

// ============== TOAST ==============
let toastTimer = null;
function showToast(message, type = "info") {
  toastEl.textContent = message;
  toastEl.className = "toast " + type;
  toastEl.hidden = false;
  void toastEl.offsetWidth;
  toastEl.classList.add("visible");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("visible");
    setTimeout(() => { toastEl.hidden = true; }, 250);
  }, 3500);
}
