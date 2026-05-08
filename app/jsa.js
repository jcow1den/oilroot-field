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
  Timestamp,
  setDoc
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
  // Each hazard: short tap-line + a longer "what can actually happen" elaboration.
  // Elaborations are plain-spoken, no scare tactics, no romanticizing.
  hazards: [
    {
      text: "High pressure lines and equipment failure",
      elaboration: "A 2-inch flow line at 5,000 psi has roughly the kinetic energy of a small car at highway speed. When iron lets go, it doesn't drift, it whips. People standing in the wrong spot don't get a second chance to move. That's why we anchor lines, pin hammer unions, and clear the work zone before opening choke."
    },
    {
      text: "Trapped pressure / unexpected pressure release",
      elaboration: "Pressure doesn't disappear when you close a valve. It sits there, stored in fluid and gas, waiting. Disconnecting iron with even a few hundred psi behind it will turn a hammer union into a projectile. Always verify zero on a gauge, then bleed it down, then verify again."
    },
    {
      text: "H2S exposure (sour gas)",
      elaboration: "100 ppm causes immediate unconsciousness. 500 ppm kills in 3 minutes. You won't smell it past 100 ppm because it kills your sense of smell first. The wind carries it. The person downwind dies. That's the whole story behind every gas monitor, every wind direction briefing, every muster point."
    },
    {
      text: "Hydrocarbon vapor exposure (LEL / explosive atmosphere)",
      elaboration: "The lower explosive limit is the percentage of hydrocarbon vapor in air below which there's not enough fuel to ignite. Hit 10% of LEL on the monitor and you're at the threshold of trouble. Hit 100% LEL and one spark is all it takes. The cell phone in your back pocket is a spark."
    },
    {
      text: "Fire and explosion (ignition sources, static electricity)",
      elaboration: "Static electricity from your boots scuffing the catwalk in dry weather is enough to ignite hydrocarbon vapor. So is a non-rated phone, a worn-out extension cord, hot work without a permit, or the alternator on a truck idling next to a leak. Bonding and grounding aren't decorative."
    },
    {
      text: "Hot surfaces (separator vessels, flow iron after flow)",
      elaboration: "Flow iron doesn't visibly glow when it's 200 degrees and ready to put a third-degree burn through your glove. Same with separator vessels after the well's been flowing for hours. Touch with the back of a gloved hand first, or use IR thermometer."
    },
    {
      text: "Sand erosion and equipment failure",
      elaboration: "Sand at flowback velocity erodes tungsten carbide chokes in days, not months. It also erodes the inside of flow iron, valve bodies, and separator dump valves. A sand cut on the inside of a 90-degree bend has zero outward signs until the iron lets go. That's why we monitor sand cutters and inspect."
    },
    {
      text: "Pinch points (hammer unions, valves, flow iron)",
      elaboration: "Hammer unions don't seat smoothly. They jump, snap, and pinch fingers between the lugs and the body. Same with valve handles, choke wrenches, and the underside of separator skids. Hands stay clear, gloves stay on, and we use the right tool every time."
    },
    {
      text: "Struck-by (dropped equipment, swinging iron, pressure release)",
      elaboration: "Dropped tools fall straight down. Swinging iron has reach. Pressure release goes wherever the iron points it. The work zone gets cleared for a reason: the people who get hurt are usually the ones who shouldn't have been there in the first place."
    },
    {
      text: "Slips, trips, falls (icy catwalks, slick surfaces, hoses)",
      elaboration: "More oilfield injuries come from slips and falls than from any pressure incident. Catwalks ice up overnight. Hoses snake across the ground and grab boots. Three points of contact isn't a rule for greenhats, it's the only thing keeping you on the catwalk when the next gust hits."
    },
    {
      text: "Noise exposure (over 85 dB)",
      elaboration: "OSHA's action level is 85 dB averaged over 8 hours. Flowback equipment routinely runs above 95 dB at the work zone. Hearing loss from long shifts isn't dramatic, you just slowly stop hearing things and don't notice until your kid asks why you keep saying 'what.'"
    },
    {
      text: "Chemical exposure (produced fluids, treatment chemicals)",
      elaboration: "Produced water can carry NORM (naturally occurring radioactive material), benzene, and concentrated brines. Treatment chemicals like H2S scavengers and corrosion inhibitors are caustic and stain skin permanently. SDS sheets aren't decorative wallpaper, they tell you what's actually in the bucket."
    },
    {
      text: "Spill / environmental release",
      elaboration: "A spill that hits the ground is one problem. A spill that hits a waterway is a different problem entirely, and the operator (and you) get to spend months explaining it. Berms, secondary containment, and spill kits aren't there for the auditor, they're there because cleanup costs orders of magnitude more than prevention."
    },
    {
      text: "Heat / cold stress, fatigue (12-hour shifts)",
      elaboration: "Heat exhaustion sneaks up. By the time you're cramping, you're already dehydrated. Cold doesn't sneak, it just kills you faster. And fatigue at the end of hour 11 of a 12 is when the dumb mistake happens. Hydrate before you're thirsty, eat before you're hungry, and tell someone if you're cooked."
    }
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
    { text: "Hard hat", core: true },
    { text: "Safety glasses (impact-rated)", core: true },
    { text: "FR coveralls or FR layered clothing", core: true },
    { text: "Steel-toe boots (lace-up, ANSI-rated)", core: true },
    { text: "Cut-resistant / impact gloves", core: true },
    { text: "Hearing protection (within 50 ft of flow iron)", core: false },
    { text: "Personal 4-gas monitor (O2, LEL, H2S, CO)", core: true },
    { text: "H2S escape pack / SCBA available on site", core: false }
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
      hazards: ["Sudden pressure release", "Sand erosion of choke or iron", "Hydrocarbon release if separator dump fails", "H2S", "Vapor cloud at LEL", "Fire/explosion if ignition source present"],
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

// ============== FACTS LIBRARY ==============
// Mix of OSHA stats, oilfield history, equipment specs, scale numbers, and
// dry humor. No "you're walking in their footsteps" romanticizing. Just facts.
// New facts get added in updates. The picker avoids repeating until the user
// has seen most of them.
const FACTS = [
  // Sober stats
  "489 oil and gas extraction workers were killed on the job between 2013 and 2017. Most by hazards on this list.",
  "Roughly 4 of every 10 oilfield worker fatalities are highway vehicle incidents. The drive home matters more than people think.",
  "OSHA's noise action level is 85 dB averaged over 8 hours. Most flowback equipment runs above 95 dB at the work zone.",
  "Slips, trips, and falls cause more oilfield injuries than any other category. Three points of contact wasn't invented for greenhats.",
  "H2S at 100 ppm causes immediate unconsciousness. At 500 ppm, you have about 3 minutes. The wind decides who lives.",
  "OSHA fines for serious violations average $14,502 per incident. The hospital bill is bigger.",
  "Most oilfield fatalities happen to workers with less than 5 years of experience. Pair the new guy with someone who's been there.",
  "Dehydration is measurable on a chemistry panel hours before you feel thirsty. Drink before the cramps.",

  // Equipment respect
  "A 2-inch flow line at 5,000 psi has roughly the kinetic energy of a small car at highway speed. That's why we anchor it.",
  "Tungsten carbide chokes erode visibly in days during sand-heavy flowback. The inside of the iron erodes the same way, just where you can't see it.",
  "Hammer unions are designed for 15,000 psi. The hammer is rated for 75 lbs of swing force. Your shoulder isn't.",
  "Flow iron stays hot to the touch for 30+ minutes after a well shuts in. The back of a gloved hand is the test, not the palm.",
  "A standard separator dump valve cycles 3,000+ times per day during early flowback. Inspection isn't optional.",
  "BOPs are pressure-tested to 1.5x working pressure. The well doesn't care what they're rated for if the test was skipped.",
  "Static electricity from boots scuffing a dry catwalk can produce a 25,000-volt spark. That's well above the ignition energy of methane.",

  // History
  "The first commercial U.S. oil well opened in Titusville, Pennsylvania in 1859. Edwin Drake drilled it 69.5 feet deep.",
  "Spindletop blew in 1901, producing 100,000 barrels per day. It killed three men in the first week. Safety took a while to catch up.",
  "The Lucas Gusher at Spindletop launched the modern oil industry. It also launched the term 'wildcatter.'",
  "OSHA was created in 1970 after years of lobbying. Before that, the federal worker fatality count for oil and gas was just an estimate.",
  "The Macondo blowout in 2010 killed 11 men and changed BOP regulations across the industry. Engineering controls only work if they work.",
  "Hydraulic fracturing as a stimulation technique was first used in 1947 in Kansas. The horizontal version that changed everything came in the late 1990s.",
  "The roughneck who never made a mistake never worked a day. The roughneck who never learned from one is the one we worry about.",

  // Scale
  "The Bakken produces enough oil daily to fill roughly 740 Olympic swimming pools.",
  "The Permian Basin alone produces more oil per day than most OPEC countries.",
  "A modern horizontal well drains rock that 1980s technology couldn't reach with three vertical wells side by side.",
  "Frac jobs use enough sand per stage to fill a backyard swimming pool. The well takes 30+ stages.",
  "A typical pad in the Bakken has 4 to 8 wells. Some have 16. The footprint per barrel produced is a fraction of what it was 30 years ago.",
  "U.S. oil and gas production today exceeds Saudi Arabia and Russia combined. Most of that came online after 2010.",
  "The deepest well ever drilled hit 40,318 feet. That's about 7.6 miles down.",

  // Dry humor / culture
  "Every roughneck has at least one shirt that was new before the welding sparks got it.",
  "If your truck doesn't have at least one boot footprint on the dashboard, you haven't worked a real job.",
  "The new guy is always the one who finds the bee's nest. It's tradition.",
  "There's no such thing as too many fire extinguishers staged. There is such a thing as one not where you needed it.",
  "The supervisor who shows up clean at end-of-shift either delegated well or didn't do anything.",
  "Coffee is PPE. Fight me.",
  "If the tool bag is organized, someone with a clipboard is on location.",
  "Every wellsite has exactly one porta-john. It is always at the worst possible spot for the wind.",
  "The shortest distance between two points on a pad is never the path the hose actually takes.",
  "If the radio works, the gas monitor doesn't. If the gas monitor works, the radio doesn't. This is physics.",

  // Hazard-specific reminders
  "Methane is lighter than air and rises. Hydrogen sulfide is heavier and pools. Wind direction tells you which one you're more worried about today.",
  "The lower explosive limit for methane in air is 5%. We start sweating at 10% of LEL on the monitor. There's a reason.",
  "Cold stress kills faster than heat stress. Wet plus wind plus 40 degrees is more dangerous than 95 in the sun, and people underestimate it every year.",
  "NORM (naturally occurring radioactive material) shows up in produced water and scale. It's not enough to glow but it's enough to flag.",
  "Benzene exposure has no safe lower limit in OSHA's view. Long careers around produced water mean wearing the right respirator when it counts.",

  // Practical wisdom
  "If you're tired, say it. The crew won't think less of you. They'll think less of you when you make the mistake.",
  "The supervisor who stops a job because something feels off is rarely wrong about the feeling.",
  "Stop Work Authority isn't about stopping the job, it's about not being the person who didn't.",
  "If the JSA you're filling out is identical to yesterday's, you didn't read it. Read it.",
  "Wind direction is the cheapest piece of safety equipment on location. Look at the flag.",
  "The crew that talks to each other on the radio every 30 minutes is the crew that makes it home.",

  // Equipment / process trivia
  "API gravity higher than 10 means oil floats on water. Lower than 10 means it sinks. Most U.S. crude is between 30 and 45.",
  "A barrel of oil is 42 U.S. gallons. The number comes from old whiskey barrels, since that's what early oilmen had on hand.",
  "Crude oil contains thousands of distinct hydrocarbons. The refinery's job is sorting them by boiling point.",
  "A 'dog leg' in directional drilling is when the wellbore changes angle too sharply. They get named for what they look like, not what they cause.",
  "The kelly bushing on a rig predates rotary drilling itself. It's one of the oldest pieces of equipment still in use.",
  "Mud weight is measured in pounds per gallon. Heavier mud holds back more pressure. Too heavy fractures the formation.",

  // Regional scale (no romanticizing)
  "North Dakota went from producing 80,000 barrels per day in 2005 to over 1.4 million by 2014. The infrastructure didn't keep up. People learned a lot.",
  "The Eagle Ford in South Texas was barely on the map until 2008. Now it's one of the largest producing regions in the country.",
  "Oklahoma had over 200,000 active wells at one point. The state has more well pluggings on record than most countries have wells.",
  "The Permian Basin spans 75,000 square miles across Texas and New Mexico. You could fit South Carolina inside it.",

  // Misc
  "OSHA's General Duty Clause is one sentence long. It says employers must provide a workplace free of recognized hazards. Most citations come from that sentence.",
  "JSAs aren't required by a specific OSHA standard. They're required by what happens if you don't have one when the inspector asks.",
  "Permit-to-work systems didn't exist on most U.S. land rigs until major incidents made operators adopt them. They work.",
  "Most modern hydraulic fracturing pumps are rated for 2,500 horsepower per unit. A typical frac job uses 16 of them.",
  "Frac sand mining is itself a multi-billion-dollar industry. The sand has to be the right grain shape or it doesn't prop the fracture.",
  "Most produced water is reinjected into disposal wells. The cost of disposal is one of the biggest line items on a flowback AFE.",
  "Oilfield slang for a hand who shows up early, works hard, and shuts up: a hand. That's it. There's no higher compliment."
];

// Track which facts have been seen (in localStorage so it persists across sessions).
const FACTS_SEEN_KEY = "oilroot_facts_seen";

function pickRandomFact() {
  let seen = [];
  try {
    seen = JSON.parse(localStorage.getItem(FACTS_SEEN_KEY) || "[]");
  } catch {
    seen = [];
  }

  // If user has seen 80%+ of the library, reset so we can shuffle through again
  if (seen.length >= Math.floor(FACTS.length * 0.8)) {
    seen = [];
  }

  // Pick from facts not yet seen
  const unseen = FACTS.map((_, idx) => idx).filter(idx => !seen.includes(idx));
  const pool = unseen.length ? unseen : FACTS.map((_, idx) => idx);
  const pickedIdx = pool[Math.floor(Math.random() * pool.length)];

  // Record it as seen
  seen.push(pickedIdx);
  try {
    localStorage.setItem(FACTS_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // localStorage failures are non-fatal; the user just sees more repeats
  }

  return FACTS[pickedIdx];
}

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
const routineStepsList = document.getElementById("routine-steps-list");
const factText      = document.getElementById("fact-text");
const factShuffleBtn = document.getElementById("fact-shuffle");

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
const interviewDifferent    = document.getElementById("interview-different");
const ppeOverrideModal      = document.getElementById("ppe-override-modal");
const ppeOverrideTitle      = document.getElementById("ppe-override-title");
const ppeOverrideReason     = document.getElementById("ppe-override-reason");
const ppeOverrideCancel     = document.getElementById("ppe-override-cancel");
const ppeOverrideConfirm    = document.getElementById("ppe-override-confirm");

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

// Interview question answers
let interviewAnswers = {
  h2s: null,           // "known" | "suspected" | "none"
  newcrew: null,       // "yes" | "no"
  weather: [],         // array of "cold" | "heat" | "wind" | "lightning" | "none"
  different: ""        // free text
};

// PPE & controls checkbox state.
// Maps item index to {checked: bool, overrideReason: string|null}
let ppeState = {};      // {0: {checked: true, overrideReason: null}, ...}
let controlsState = {}; // same shape

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

  // Fresh fact for every JSA
  if (factText) {
    factText.textContent = pickRandomFact();
  }

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
  // Render hazards as tappable items with elaboration
  hazardsList.innerHTML = "";
  template.hazards.forEach((hazard, idx) => {
    const li = document.createElement("li");
    li.className = "hazard-item";
    li.innerHTML = `
      <button type="button" class="hazard-head" aria-expanded="false">
        <svg class="hazard-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="hazard-text">${escapeHtml(hazard.text)}</span>
      </button>
      <div class="hazard-elaboration" hidden>
        <span class="elaboration-label">What can actually happen</span>
        ${escapeHtml(hazard.elaboration)}
      </div>
    `;
    const head = li.querySelector(".hazard-head");
    const elab = li.querySelector(".hazard-elaboration");
    head.addEventListener("click", () => {
      const expanded = li.classList.toggle("expanded");
      elab.hidden = !expanded;
      head.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
    hazardsList.appendChild(li);
  });

  // Render controls as checkboxes (all start checked)
  controlsList.className = "checkbox-list";
  controlsList.innerHTML = "";
  template.controls.forEach((c, idx) => {
    if (!(idx in controlsState)) {
      controlsState[idx] = { checked: true, overrideReason: null };
    }
    const tag = c.type === "eng" ? "ENGINEERING" : c.type === "admin" ? "ADMIN" : "PPE";
    const li = document.createElement("li");
    li.className = "checkbox-item" + (controlsState[idx].checked ? "" : " unchecked");
    li.innerHTML = `
      <input type="checkbox" ${controlsState[idx].checked ? "checked" : ""} />
      <span class="checkbox-item-text">${escapeHtml(c.text)}<span class="hierarchy-tag">${tag}</span></span>
    `;
    const cb = li.querySelector("input");
    cb.addEventListener("change", () => {
      controlsState[idx].checked = cb.checked;
      li.classList.toggle("unchecked", !cb.checked);
    });
    controlsList.appendChild(li);
  });

  // Render PPE as checkboxes. Core items show a soft floor: unchecking
  // them prompts for a justification reason.
  ppeList.className = "checkbox-list";
  ppeList.innerHTML = "";
  template.ppe.forEach((p, idx) => {
    if (!(idx in ppeState)) {
      ppeState[idx] = { checked: true, overrideReason: null };
    }
    const isCore = !!p.core;
    const li = document.createElement("li");
    li.className = "checkbox-item" + (isCore ? " core-required" : "") + (ppeState[idx].checked ? "" : " unchecked");
    li.innerHTML = `
      <input type="checkbox" ${ppeState[idx].checked ? "checked" : ""} />
      <span class="checkbox-item-text">${escapeHtml(p.text)}${isCore ? '<span class="core-required-tag">CORE</span>' : ''}</span>
    `;
    const cb = li.querySelector("input");
    cb.addEventListener("change", () => {
      if (!cb.checked && isCore && !ppeState[idx].overrideReason) {
        // Open the soft-floor override modal
        cb.checked = true; // revert until they confirm
        openPpeOverrideModal(idx, p.text, () => {
          ppeState[idx].checked = false;
          cb.checked = false;
          li.classList.add("unchecked");
          renderOverrideReasonOnItem(li, ppeState[idx].overrideReason);
        });
        return;
      }
      ppeState[idx].checked = cb.checked;
      li.classList.toggle("unchecked", !cb.checked);
      // If re-checking a core item, clear any override reason
      if (cb.checked && ppeState[idx].overrideReason) {
        ppeState[idx].overrideReason = null;
        const r = li.querySelector(".override-reason-display");
        if (r) r.remove();
      }
    });
    if (ppeState[idx].overrideReason) {
      renderOverrideReasonOnItem(li, ppeState[idx].overrideReason);
    }
    ppeList.appendChild(li);
  });

  // Render routine steps (always visible)
  if (routineStepsList) {
    routineStepsList.innerHTML = template.routineSteps.map((step, i) => {
      const num = String(i + 1).padStart(2, "0");
      return `
        <div class="routine-step">
          <div class="routine-step-head">
            <span class="routine-step-num">STEP ${num}</span>
            <h3 class="routine-step-title">${escapeHtml(step.title)}</h3>
          </div>
          <div class="routine-step-block">
            <span class="routine-step-block-label">Hazards</span>
            <ul class="routine-step-block-list">
              ${step.hazards.map(h => `<li>${escapeHtml(h)}</li>`).join("")}
            </ul>
          </div>
          <div class="routine-step-block">
            <span class="routine-step-block-label">Controls</span>
            <ul class="routine-step-block-list">
              ${step.controls.map(c => `<li>${escapeHtml(c)}</li>`).join("")}
            </ul>
          </div>
        </div>
      `;
    }).join("");
  }
}

// Render the override reason inside the checkbox item
function renderOverrideReasonOnItem(li, reason) {
  const existing = li.querySelector(".override-reason-display");
  if (existing) existing.remove();
  if (!reason) return;
  const div = document.createElement("div");
  div.className = "override-reason-display";
  div.textContent = `Override reason: ${reason}`;
  li.appendChild(div);
}

// ============== PPE OVERRIDE MODAL ==============
let pendingOverrideIdx = null;
let pendingOverrideOnConfirm = null;

function openPpeOverrideModal(idx, itemText, onConfirm) {
  pendingOverrideIdx = idx;
  pendingOverrideOnConfirm = onConfirm;
  ppeOverrideTitle.textContent = `${itemText} is required for flowback work`;
  ppeOverrideReason.value = "";
  ppeOverrideModal.hidden = false;
  setTimeout(() => ppeOverrideReason.focus(), 50);
}

function closePpeOverrideModal() {
  ppeOverrideModal.hidden = true;
  pendingOverrideIdx = null;
  pendingOverrideOnConfirm = null;
}

if (ppeOverrideCancel) {
  ppeOverrideCancel.addEventListener("click", closePpeOverrideModal);
}

if (ppeOverrideConfirm) {
  ppeOverrideConfirm.addEventListener("click", () => {
    const reason = ppeOverrideReason.value.trim();
    if (!reason) {
      ppeOverrideReason.focus();
      return;
    }
    if (pendingOverrideIdx !== null) {
      ppeState[pendingOverrideIdx].overrideReason = reason;
    }
    if (pendingOverrideOnConfirm) {
      pendingOverrideOnConfirm();
    }
    closePpeOverrideModal();
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  }[m]));
}

// Fact banner shuffle button
if (factShuffleBtn) {
  factShuffleBtn.addEventListener("click", () => {
    factText.textContent = pickRandomFact();
  });
}

// Interview question chip handlers (single-select and multi-select)
document.querySelectorAll(".interview-options").forEach(group => {
  const isMulti = group.classList.contains("interview-multi");
  const question = group.dataset.question;
  group.querySelectorAll(".interview-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const value = chip.dataset.value;
      if (isMulti) {
        // Toggle the chip
        chip.classList.toggle("selected");
        // "None" is exclusive: tapping it deselects others, and tapping others deselects "None"
        if (value === "none" && chip.classList.contains("selected")) {
          group.querySelectorAll(".interview-chip").forEach(c => {
            if (c !== chip) c.classList.remove("selected");
          });
        } else if (value !== "none") {
          const noneChip = group.querySelector('[data-value="none"]');
          if (noneChip) noneChip.classList.remove("selected");
        }
        // Update state
        const selected = [...group.querySelectorAll(".interview-chip.selected")].map(c => c.dataset.value);
        interviewAnswers[question] = selected;
      } else {
        // Single select
        group.querySelectorAll(".interview-chip").forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
        interviewAnswers[question] = value;
      }
    });
  });
});

// Free-text interview answer
if (interviewDifferent) {
  interviewDifferent.addEventListener("input", () => {
    interviewAnswers.different = interviewDifferent.value;
  });
}

confirmStandardBtn.addEventListener("click", () => {
  isStandardConfirmed = !isStandardConfirmed;
  confirmStandardBtn.classList.toggle("confirmed", isStandardConfirmed);
  if (isStandardConfirmed) {
    standardConfirmedAt = new Date().toISOString();
    confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "Confirmed for today's work";
  } else {
    standardConfirmedAt = null;
    confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "I've reviewed everything above and it applies to today's work";
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
  // Reset and run the multi-source auto-capture
  capturedGps = null;
  jsaGpsEl.textContent = "Capturing...";
  jsaGpsEl.classList.remove("captured");
  autoCaptureGps();
});

// Auto-capture GPS when the form opens. Uses three sources in parallel:
// 1. Browser geolocation (great on phones, often wildly off on laptops)
// 2. iplocate.io network-based lookup (better than browser fallback for cell hotspots)
// 3. Cached "last good location" from Firestore (saved by any device that previously
//    got a high-accuracy GPS fix on this user's account)
// Whichever returns the most accurate result wins. If we get a high-accuracy fix
// from the device, we save it to Firestore so other devices on this account benefit.
const IPLOCATE_API_KEY = "6186e45569220b16fb537bd3056600eb";
const HIGH_ACCURACY_THRESHOLD_M = 300;  // ~1000 ft, phone-GPS quality

function autoCaptureGps() {
  if (capturedGps) return; // Already captured (e.g. in edit mode)

  captureGpsBtn.disabled = true;
  captureGpsBtn.textContent = "Capturing...";

  // Fire all three location sources in parallel
  const browserPromise = getBrowserLocation();
  const iplocatePromise = getIplocateLocation();
  const cachedPromise = getCachedLocation();

  Promise.allSettled([browserPromise, iplocatePromise, cachedPromise]).then(results => {
    const [browserR, iplocateR, cachedR] = results;

    // Collect successful results with their source
    const candidates = [];
    if (browserR.status === "fulfilled" && browserR.value) {
      candidates.push({ ...browserR.value, source: "browser" });
    }
    if (iplocateR.status === "fulfilled" && iplocateR.value) {
      candidates.push({ ...iplocateR.value, source: "iplocate" });
    }
    if (cachedR.status === "fulfilled" && cachedR.value) {
      candidates.push({ ...cachedR.value, source: "cached" });
    }

    if (!candidates.length) {
      captureGpsBtn.textContent = "Capture GPS";
      captureGpsBtn.disabled = false;
      return;
    }

    // If the browser fix is high-accuracy (real GPS), it wins outright.
    // Save it to Firestore so other devices on this account can use it later.
    const browserFix = candidates.find(c => c.source === "browser");
    if (browserFix && browserFix.accuracy <= HIGH_ACCURACY_THRESHOLD_M) {
      applyLocation(browserFix);
      saveLocationToCache(browserFix);
      return;
    }

    // No high-accuracy device fix. Prefer cached (real prior GPS) over network
    // estimates (iplocate or browser-IP-fallback), since the cached value came
    // from an actual GPS chip at some point.
    const cached = candidates.find(c => c.source === "cached");
    if (cached) {
      applyLocation(cached);
      return;
    }

    // No high-accuracy fix and no cache. Fall back to whichever wide source
    // returned the smallest accuracy radius.
    candidates.sort((a, b) => (a.accuracy || Infinity) - (b.accuracy || Infinity));
    applyLocation(candidates[0]);
  });
}

// Apply a location result to the form
function applyLocation(loc) {
  capturedGps = {
    lat: loc.lat,
    lng: loc.lng,
    accuracy: loc.accuracy,
    source: loc.source,
    capturedAt: new Date().toISOString()
  };
  jsaGpsEl.textContent = `${loc.lat.toFixed(5)}°, ${loc.lng.toFixed(5)}° ${formatAccuracy(loc.accuracy, loc.source)}`;
  jsaGpsEl.classList.add("captured");
  captureGpsBtn.textContent = "Recapture";
  captureGpsBtn.disabled = false;
  lookupNearestHospital(loc.lat, loc.lng);
}

// Save a high-accuracy location to Firestore so other devices on this account
// can use it as a fallback when they can't get a good fix locally.
async function saveLocationToCache(loc) {
  if (!currentUser) return;
  try {
    const ref = doc(db, "users", currentUser.uid);
    await setDoc(ref, {
      lastGoodLocation: {
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        capturedAt: serverTimestamp()
      }
    }, { merge: true });
  } catch (err) {
    // Non-fatal; the user just doesn't get cross-device sync this time
    console.warn("Could not cache location:", err);
  }
}

// Read the cached "last good location" from Firestore. Returns {lat, lng, accuracy}
// or null if there's no cached location or the user isn't signed in.
async function getCachedLocation() {
  if (!currentUser) return null;
  try {
    const ref = doc(db, "users", currentUser.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data.lastGoodLocation) return null;
    const cached = data.lastGoodLocation;
    if (typeof cached.lat !== "number" || typeof cached.lng !== "number") return null;
    return {
      lat: cached.lat,
      lng: cached.lng,
      accuracy: cached.accuracy || HIGH_ACCURACY_THRESHOLD_M
    };
  } catch (err) {
    console.warn("Could not read cached location:", err);
    return null;
  }
}

// Browser geolocation as a Promise. Uses watchPosition (not getCurrentPosition)
// so the browser has a chance to refine the fix over time. Returns the best
// (smallest accuracy radius) fix it sees within the watch window.
//
// Why this matters: getCurrentPosition often returns a fast, low-accuracy
// WiFi/IP estimate and stops. watchPosition keeps firing as the browser
// refines its fix from satellite, WiFi, cell, etc. KPA does it this way.
function getBrowserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    let bestFix = null;
    let watchId = null;
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (watchId !== null) {
        try { navigator.geolocation.clearWatch(watchId); } catch {}
      }
      resolve(bestFix);
    };

    const onSuccess = (pos) => {
      const fix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
      // Keep the smallest accuracy radius we've seen
      if (!bestFix || fix.accuracy < bestFix.accuracy) {
        bestFix = fix;
      }
      // If we got a high-accuracy fix, no need to keep watching
      if (fix.accuracy <= HIGH_ACCURACY_THRESHOLD_M) {
        finish();
      }
    };

    const onError = () => {
      // Don't resolve immediately on a single error; the watch may still produce a fix
      // The overall timeout below handles the case where nothing comes in
    };

    try {
      watchId = navigator.geolocation.watchPosition(onSuccess, onError, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      });
    } catch {
      resolve(null);
      return;
    }

    // Hard cap: stop watching after 12 seconds and return whatever's best so far
    setTimeout(finish, 12000);
  });
}

// iplocate.io network-based location. Resolves with {lat, lng, accuracy} or null.
// Free tier allows commercial use; 1,000 lookups/day.
async function getIplocateLocation() {
  try {
    const resp = await fetch(`https://iplocate.io/api/lookup/?apikey=${IPLOCATE_API_KEY}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;
    // iplocate doesn't return an accuracy radius. Network/IP-based lookups are
    // typically accurate to city level; estimate 5 mi (~8000 m) as a baseline.
    return {
      lat: data.latitude,
      lng: data.longitude,
      accuracy: 8000
    };
  } catch {
    return null;
  }
}

// Format GPS accuracy for display. Uses feet for tight fixes, miles for wide.
// Adds a source label so the user knows where the location came from.
function formatAccuracy(accuracyMeters, source) {
  if (!accuracyMeters || accuracyMeters <= 0) return "";
  const accFt = accuracyMeters * 3.281;
  const accMi = accuracyMeters * 0.000621371;
  let sourceLabel = "";
  if (source === "iplocate") sourceLabel = " · network estimate";
  else if (source === "cached") sourceLabel = " · last known good";
  else if (accMi >= 0.5) sourceLabel = " · WiFi/IP estimate";
  if (accMi >= 0.5) {
    return `(±${accMi.toFixed(1)} mi${sourceLabel})`;
  }
  return `(±${Math.round(accFt)} ft${sourceLabel})`;
}

// Tracks whether the hospital field was auto-set by our lookup (true) or
// typed/edited by the user (false). When location improves later, we only
// overwrite an auto-set value, never a user-edited one.
let hospitalAutoSet = false;

if (jsaHospital) {
  jsaHospital.addEventListener("input", () => {
    hospitalAutoSet = false;
  });
}

// Look up nearest hospital from GPS coordinates using OpenStreetMap Overpass API.
// Free, no API key. Tiered behavior based on GPS accuracy:
//   - High accuracy (under 1000 ft): trust the fix, search small radius first
//   - Medium accuracy (1000 ft - 10 mi): warn user, search wider radius
//   - Low accuracy (over 10 mi): too unreliable to suggest, just offer search
async function lookupNearestHospital(lat, lng) {
  // Don't overwrite if user has typed/edited something. Auto-set values are
  // safe to overwrite (e.g. when location refines to a better fix).
  if (jsaHospital.value.trim() && !hospitalAutoSet) return;

  const accuracyMeters = capturedGps?.accuracy || 0;
  const accuracyMiles = accuracyMeters * 0.000621371;

  // If accuracy is over 10 miles, the fix is so wide that auto-suggesting
  // a specific hospital would be misleading. Just hint that they can type.
  if (accuracyMiles > 10) {
    hospitalStatus.hidden = false;
    hospitalStatus.textContent = `GPS too imprecise for auto-suggest (±${accuracyMiles.toFixed(0)} mi). Type your hospital.`;
    return;
  }

  hospitalStatus.hidden = false;
  hospitalStatus.textContent = "Finding nearest hospital...";

  // Pick search radius based on how confident we are in the location
  let searchRadiusMeters;
  if (accuracyMiles <= 0.2) {
    searchRadiusMeters = 16000;  // ~10 mi for accurate fixes
  } else if (accuracyMiles <= 2) {
    searchRadiusMeters = 32000;  // ~20 mi for medium accuracy
  } else {
    searchRadiusMeters = 80000;  // ~50 mi for low accuracy
  }

  try {
    let result = await queryOverpassForHospital(lat, lng, searchRadiusMeters);
    // If nothing found in initial search, try a wider radius
    if (!result && searchRadiusMeters < 80000) {
      result = await queryOverpassForHospital(lat, lng, 80000);
    }

    if (!result) {
      hospitalStatus.textContent = "No hospital found nearby. Type one in.";
      return;
    }

    // Don't overwrite if user typed something while we were waiting (and it
    // wasn't us that auto-set it)
    if (jsaHospital.value.trim() && !hospitalAutoSet) {
      hospitalStatus.hidden = true;
      return;
    }

    jsaHospital.value = result.display;
    hospitalAutoSet = true;  // Mark as auto-set so future location updates can overwrite

    // Calibrate the message to GPS confidence
    if (accuracyMiles <= 0.2) {
      hospitalStatus.textContent = `Auto-suggested · ${result.distanceMi.toFixed(1)} mi away. Edit if wrong.`;
    } else {
      hospitalStatus.textContent = `Best guess based on imprecise location (±${accuracyMiles.toFixed(1)} mi). Verify.`;
    }
  } catch (err) {
    console.warn("Hospital lookup failed:", err);
    hospitalStatus.textContent = "Hospital lookup unavailable. Type one in.";
  }
}

async function queryOverpassForHospital(lat, lng, radiusMeters) {
  // We want full-service hospitals with emergency departments, not specialty
  // clinics, dental offices, or anything else that someone tagged amenity=hospital.
  // Require either emergency=yes (best signal) OR healthcare=hospital (rigorous tag).
  // We deliberately do NOT fall back to generic amenity=hospital, since that tag
  // is unreliable in OSM and includes everything from eye clinics to (yes, really)
  // miscategorized car dealerships.
  const overpassQuery = `
    [out:json][timeout:8];
    (
      node["amenity"="hospital"]["emergency"="yes"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"]["emergency"="yes"](around:${radiusMeters},${lat},${lng});
      node["amenity"="hospital"]["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"]["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
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

  // Even within tagged hospitals, exclude obvious specialty facilities
  const SPECIALTY_KEYWORDS = [
    "eye", "vision", "ophthalm", "dental", "orthodont",
    "dermatolog", "fertility", "psychiatric", "behavioral",
    "rehabilitation", "rehab center", "surgery center",
    "outpatient", "urgent care", "veterinary", "animal",
    "cancer center", "cardiac care only", "physical therapy",
    "chevrolet", "ford", "toyota", "dealership", "auto"
  ];

  function looksLikeSpecialty(name, tags) {
    const lower = (name || "").toLowerCase();
    if (SPECIALTY_KEYWORDS.some(kw => lower.includes(kw))) return true;
    if (tags?.healthcare === "clinic") return true;
    if (tags?.healthcare === "doctor") return true;
    if (tags?.healthcare === "dentist") return true;
    return false;
  }

  // All results passed the tag filter. Now build distance-sorted list.
  const candidates = [];
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

    candidates.push({
      name,
      tags: el.tags || {},
      distanceMi: haversineKm(lat, lng, elLat, elLng) * 0.621371
    });
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => a.distanceMi - b.distanceMi);
  const closest = candidates[0];

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
  const muster = jsaMuster.value.trim();
  if (!muster) {
    showToast("Muster point is required", "error");
    jsaMuster.focus();
    return;
  }
  if (!interviewAnswers.h2s) {
    showToast("Answer the H2S question in Today's conditions", "error");
    document.getElementById("conditions-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (!interviewAnswers.newcrew) {
    showToast("Answer the new crew question in Today's conditions", "error");
    document.getElementById("conditions-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (!Array.isArray(interviewAnswers.weather) || interviewAnswers.weather.length === 0) {
    showToast("Answer the weather question in Today's conditions", "error");
    document.getElementById("conditions-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    conditions:           data.conditions || null,
    controlsState:        data.controlsState || null,
    ppeState:             data.ppeState || null,
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

    // Today's conditions (interview answers)
    conditions: {
      h2s:       interviewAnswers.h2s,
      newCrew:   interviewAnswers.newcrew,
      weather:   interviewAnswers.weather,
      different: interviewAnswers.different || ""
    },

    // Per-item state for controls and PPE: which items the user confirmed
    // applicable, and any override reasons for unchecked core PPE.
    controlsState: { ...controlsState },
    ppeState:      { ...ppeState },

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
    schemaVersion:  2
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

  // Restore controls/PPE state BEFORE populateStandardLists so the rendered
  // checkboxes reflect the saved state from the prior submission
  if (data.controlsState && typeof data.controlsState === "object") {
    controlsState = { ...data.controlsState };
  }
  if (data.ppeState && typeof data.ppeState === "object") {
    ppeState = { ...data.ppeState };
  }

  if (currentTemplate) populateStandardLists(currentTemplate);

  // Restore interview answers
  if (data.conditions) {
    interviewAnswers.h2s = data.conditions.h2s || null;
    interviewAnswers.newcrew = data.conditions.newCrew || null;
    interviewAnswers.weather = Array.isArray(data.conditions.weather) ? [...data.conditions.weather] : [];
    interviewAnswers.different = data.conditions.different || "";

    // Reflect in UI
    document.querySelectorAll(".interview-options").forEach(group => {
      const q = group.dataset.question;
      const isMulti = group.classList.contains("interview-multi");
      group.querySelectorAll(".interview-chip").forEach(chip => {
        const v = chip.dataset.value;
        if (isMulti) {
          if (interviewAnswers[q] && interviewAnswers[q].includes(v)) chip.classList.add("selected");
        } else {
          if (interviewAnswers[q] === v) chip.classList.add("selected");
        }
      });
    });
    if (interviewDifferent) interviewDifferent.value = interviewAnswers.different;
  }

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
    jsaGpsEl.textContent = `${data.gps.lat.toFixed(5)}°, ${data.gps.lng.toFixed(5)}° ${formatAccuracy(data.gps.accuracy, data.gps.source)}`;
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
    ? `${data.gps.lat.toFixed(5)}°, ${data.gps.lng.toFixed(5)}° ${formatAccuracy(data.gps.accuracy, data.gps.source)}`
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

  // Section: Today's conditions (interview answers)
  if (data.conditions) {
    const c = data.conditions;
    const h2sLabel = c.h2s === "known" ? "Known present"
                    : c.h2s === "suspected" ? "Suspected"
                    : c.h2s === "none" ? "Not present"
                    : "—";
    const newCrewLabel = c.newCrew === "yes" ? "Yes"
                       : c.newCrew === "no" ? "No"
                       : "—";
    const weatherLabel = Array.isArray(c.weather) && c.weather.length
      ? c.weather.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(", ")
      : "—";
    sections.push(`
      <div class="detail-section">
        <div class="detail-section-head">
          <span class="detail-section-num">§ 00</span>
          <h3 class="detail-section-title">Today's conditions</h3>
        </div>
        <div class="detail-row">
          <span class="spec-label">H2S potential</span>
          <span class="detail-value">${escapeHtml(h2sLabel)}</span>
        </div>
        <div class="detail-row">
          <span class="spec-label">New crew member on location</span>
          <span class="detail-value">${escapeHtml(newCrewLabel)}</span>
        </div>
        <div class="detail-row">
          <span class="spec-label">Weather concerns</span>
          <span class="detail-value">${escapeHtml(weatherLabel)}</span>
        </div>
        ${c.different ? `
        <div class="detail-row">
          <span class="spec-label">Different from last shift</span>
          <span class="detail-value">${escapeHtml(c.different)}</span>
        </div>
        ` : ""}
      </div>
    `);
  }

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
          ${tpl.hazards.map(h => {
            const text = typeof h === "string" ? h : (h.text || "");
            return `<li>${escapeHtml(text)}</li>`;
          }).join("")}
        </ul>
      </div>
    `;
  }
  if (tpl && tpl.controls) {
    const cState = data.controlsState || {};
    standardSection += `
      <div class="detail-row">
        <span class="spec-label">Controls (${tpl.controls.length})</span>
        <ul class="standard-list">
          ${tpl.controls.map((c, idx) => {
            const tag = c.type === "eng" ? "ENGINEERING" : c.type === "admin" ? "ADMIN" : "PPE";
            const stateForItem = cState[idx];
            const checked = stateForItem ? stateForItem.checked !== false : true;
            const status = checked ? "✓" : "—";
            const lineClass = checked ? "" : ' style="opacity:0.5;text-decoration:line-through"';
            return `<li${lineClass}>${status} ${escapeHtml(c.text)}<span class="hierarchy-tag">${tag}</span></li>`;
          }).join("")}
        </ul>
      </div>
    `;
  }
  if (tpl && tpl.ppe) {
    const pState = data.ppeState || {};
    standardSection += `
      <div class="detail-row">
        <span class="spec-label">PPE (${tpl.ppe.length})</span>
        <ul class="standard-list">
          ${tpl.ppe.map((p, idx) => {
            const text = typeof p === "string" ? p : (p.text || "");
            const isCore = typeof p === "object" && p.core;
            const stateForItem = pState[idx];
            const checked = stateForItem ? stateForItem.checked !== false : true;
            const status = checked ? "✓" : "—";
            const lineClass = checked ? "" : ' style="opacity:0.5;text-decoration:line-through"';
            const reason = stateForItem && stateForItem.overrideReason
              ? `<div style="font-size:11px;color:var(--amber);margin-top:4px;font-style:italic">Override: ${escapeHtml(stateForItem.overrideReason)}</div>`
              : '';
            const coreTag = isCore ? '<span class="core-required-tag">CORE</span>' : '';
            return `<li${lineClass}>${status} ${escapeHtml(text)}${coreTag}${reason}</li>`;
          }).join("")}
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
  confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "I've reviewed everything above and it applies to today's work";
  exceptionArea.hidden = true;
  exceptionBtn.textContent = "Something is different";
  // Collapse any expanded hazard items
  document.querySelectorAll(".hazard-item.expanded").forEach(el => {
    el.classList.remove("expanded");
    const head = el.querySelector(".hazard-head");
    const elab = el.querySelector(".hazard-elaboration");
    if (head) head.setAttribute("aria-expanded", "false");
    if (elab) elab.hidden = true;
  });
  if (taskRoutine) taskRoutine.checked = true;
  customTasksEl.innerHTML = "";
  customTaskCount = 0;
  if (hospitalStatus) {
    hospitalStatus.hidden = true;
    hospitalStatus.textContent = "";
  }
  hospitalAutoSet = false;
  if (revisionReasonInput) revisionReasonInput.value = "";

  // Reset interview answers
  interviewAnswers = {
    h2s: null,
    newcrew: null,
    weather: [],
    different: ""
  };
  document.querySelectorAll(".interview-chip.selected").forEach(c => c.classList.remove("selected"));

  // Reset PPE/controls state (will be re-initialized by populateStandardLists)
  ppeState = {};
  controlsState = {};
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
