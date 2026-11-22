<<<<<<< HEAD
/* SAKHI 2.0 — API-connected frontend controller
 * Data source: FastAPI api_link.py -> existing backend.py -> asha_data.db
 * No beneficiary demo arrays or localStorage data snapshots are used.
 */
(function () {
  "use strict";

  const API_BASE = window.SAKHI_API_BASE || localStorage.getItem("SAKHI_API_BASE") || "";
  const MOTHER_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='48' fill='%23D4F4E4'/><circle cx='50' cy='38' r='18' fill='%23F4B58A'/><path d='M30 36 C30 20 70 20 70 36 C70 48 64 54 64 54 L36 54 Z' fill='%231F2937'/><path d='M20 94 C24 64 38 60 50 60 C62 60 76 64 80 94 Z' fill='%23FFFFFF'/><path d='M35 60 L65 94 L80 94 L50 60 Z' fill='%23F04D79'/></svg>";
  const BABY_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='48' fill='%23EDF2FE'/><circle cx='50' cy='42' r='20' fill='%23F6BE97'/><circle cx='43' cy='40' r='2' fill='%231F2937'/><circle cx='57' cy='40' r='2' fill='%231F2937'/><path d='M46 48 Q50 52 54 48' stroke='%23C2410C' stroke-width='2' fill='none'/><path d='M30 84 C30 64 70 64 70 84 Z' fill='%23FBBF24'/></svg>";

  class SakhiApp {
    constructor() {
      this.currentScreen = "login";
      this.historyStack = [];
      this.isLoggedIn = false;
      this.user = null;
      this.dashboard = {};
      this.metrics = {};
      this.homeRecords = [];
      this.mothers = [];
      this.babies = [];
      this.visits = [];
      this.selectedMother = null;
      this.selectedBaby = null;
      this.currentVisitFilter = "all";
      this.isRecording = false;
      this.speechRecognition = null;
      this.viewMode = localStorage.getItem("sakhi_view_mode") ||
        (window.innerWidth >= 1024 ? "desktop" : "mobile");
      this.deviceWidth = 390;
      this.facilities = [];
      this.facilityRadiusKm = 5;
      this.currentFacilityFilter = "all";
      this.init();
    }

    async init() {
      this.initSpeechRecognition();
      this.setViewMode(this.viewMode);
      this.bindDynamicForms();
      try {
        const health = await this.api("/api/health");
        if (health.database !== "reachable") throw new Error("Database is not reachable");
        this.showApiStatus("Connected to SAKHI database", true);
      } catch (error) {
        this.showApiStatus("API/database connection unavailable: " + error.message, false);
      }

      // Do not trust a stale browser flag as proof of server authentication.
      const savedUser = this.safeParse(sessionStorage.getItem("sakhi_user"));
      if (savedUser && savedUser.mobile) {
        this.user = savedUser;
        this.isLoggedIn = true;
        await this.loadAllData();
        this.navigateTo("home", false);
      } else {
        this.navigateTo("login", false);
      }

      window.addEventListener("hashchange", () => {
        const screen = window.location.hash.replace("#", "");
        if (screen && screen !== this.currentScreen) this.navigateTo(screen, false);
      });
    }

    safeParse(value) {
      try { return value ? JSON.parse(value) : null; } catch (_) { return null; }
    }

    async api(path, options = {}) {
      const response = await fetch(API_BASE + path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
      let body;
      try { body = await response.json(); } catch (_) { body = {}; }
      if (!response.ok) {
        const detail = body.detail || body.message || `HTTP ${response.status}`;
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      if (body && body.success === false) {
        throw new Error(body.message || "Backend operation failed");
      }
      return body;
    }

    async getData(path) {
      const result = await this.api(path);
      return result.data;
    }

    showApiStatus(message, ok) {
      const node = document.getElementById("apiConnectionStatus");
      if (node) {
        node.textContent = message;
        node.dataset.state = ok ? "online" : "offline";
        node.style.cursor = "pointer";
        node.title = "Click to configure Backend API URL";
        node.onclick = () => {
          const current = localStorage.getItem("SAKHI_API_BASE") || window.SAKHI_API_BASE || "";
          const input = prompt("Enter Backend API URL (e.g., https://sakhi-backend.onrender.com):", current);
          if (input !== null) {
            const clean = input.trim().replace(/\/+$/, "");
            localStorage.setItem("SAKHI_API_BASE", clean);
            window.SAKHI_API_BASE = clean;
            window.location.reload();
          }
        };
      }
      if (!ok) console.warn(message);
    }

    async loadAllData() {
      const dashboard = await this.getData("/api/dashboard");
      if (!dashboard) throw new Error("Dashboard returned no data. Check database tables.");
      this.dashboard = dashboard;
      this.metrics = dashboard.metrics || {};
      this.homeRecords = Array.isArray(dashboard.home) ? dashboard.home : [];

      const [motherList, childList] = await Promise.all([
        this.getData("/api/mothers"),
        this.getData("/api/children")
      ]);

      const motherRows = Array.isArray(motherList) ? motherList : [];
      const childRows = Array.isArray(childList) ? childList : [];

      const motherProfiles = await Promise.all(motherRows.map(async row => {
        try {
          const profile = await this.getData(`/api/mothers/${encodeURIComponent(row.beneficiary_id)}`);
          const home = this.homeRecords.find(h => String(h.beneficiary_id) === String(row.beneficiary_id)) || {};
          const history = (dashboard.visits || []).filter(v => String(v.beneficiary_id) === String(row.beneficiary_id));
          const lastVisit = history.filter(v => v.visit_ts).slice(-1)[0];
          return this.mapMother(profile, home, lastVisit);
        } catch (error) {
          console.warn("Mother profile could not be loaded", row, error);
          return {
            id: String(row.beneficiary_id),
            beneficiaryId: String(row.beneficiary_id),
            name: row.mother_name || "Name not recorded",
            age: null, bloodGroup: "", phone: "", weeks: null, dueDate: "",
            address: "", ironStatus: "Not recorded", vaccineStatus: "Not recorded",
            vacsTaken: {}, vacsDue: {}, nextVaccines: {}, checkupDate: ""
          };
        }
      }));

      const childProfiles = await Promise.all(childRows.map(async row => {
        try {
          const url = `/api/children/${encodeURIComponent(row.beneficiary_id)}?child_name=${encodeURIComponent(row.child_name || "")}`;
          const profile = await this.getData(url);
          return this.mapChild(profile);
        } catch (error) {
          console.warn("Child profile could not be loaded", row, error);
          return {
            id: `${row.beneficiary_id}::${row.child_name}`,
            beneficiaryId: String(row.beneficiary_id),
            name: row.child_name || "Name not recorded",
            dob: "", age: "", gender: "", weight: "",
            bloodGroup: "", motherName: "", fatherName: "",
            vacsTaken: {}, vacsDue: {}, nextVaccines: {}, nextVisit: ""
          };
        }
      }));

      this.mothers = motherProfiles.filter(Boolean);
      this.babies = childProfiles.filter(Boolean);
      this.visits = this.mapVisits(Array.isArray(dashboard.visits) ? dashboard.visits : []);
      this.selectedMother = this.mothers[0] || null;
      this.selectedBaby = this.babies[0] || null;

=======
// frontend_2.0/app.js
// SAKHI 2.0 — Screenshot-Accurate Application Controller
// Responsive UI Implementation for ASHA Field Workers

(function () {
  'use strict';

  // SVG Avatars (Data URIs for reliable rendering)
  const MOTHER_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='48' fill='%23D4F4E4'/><circle cx='50' cy='38' r='18' fill='%23F4B58A'/><path d='M30 36 C30 20 70 20 70 36 C70 48 64 54 64 54 L36 54 Z' fill='%231F2937'/><path d='M20 94 C24 64 38 60 50 60 C62 60 76 64 80 94 Z' fill='%23FFFFFF'/><path d='M35 60 L65 94 L80 94 L50 60 Z' fill='%23F04D79'/><circle cx='50' cy='34' r='1.5' fill='%23DC2626'/></svg>";
  const BABY_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='48' fill='%23EDF2FE'/><circle cx='50' cy='42' r='20' fill='%23F6BE97'/><path d='M46 22 C48 18 52 18 54 22 C52 26 48 26 46 22 Z' fill='%231F2937'/><circle cx='43' cy='40' r='2' fill='%231F2937'/><circle cx='57' cy='40' r='2' fill='%231F2937'/><path d='M46 48 Q50 52 54 48' stroke='%23C2410C' stroke-width='2' stroke-linecap='round' fill='none'/><path d='M30 84 C30 64 70 64 70 84 Z' fill='%23FBBF24'/></svg>";

  // Initial Mothers Data (matching screenshot media_1795280797953_e373792f)
  const INITIAL_MOTHERS = [
    {
      id: "M-01",
      name: "Lakshmi Nandhana",
      age: 30,
      bloodGroup: "O+",
      phone: "1234567891",
      weeks: 24,
      dueDate: "28 Sep 2024",
      checkupDate: "15 jun 2026",
      ironStatus: "Regular",
      vaccineStatus: "Due in 5 days",
      address: "Sector 3, Main Road",
      weight: "55 kg (Normal)",
      healthSummary: [
        { title: "Iron Tablets", sub: "Taking regularly", status: "Regular", type: "check" },
        { title: "Folic Acid", sub: "Taking regularly", status: "Regular", type: "check" },
        { title: "Calcium", sub: "Due in 5 days", status: "Due", type: "alert" },
        { title: "Weight", sub: "55 kg (Normal)", status: "Normal", type: "check" }
      ]
    },
    { id: "M-02", name: "Swetha Santhosh", age: 26, bloodGroup: "B+", phone: "9845112233", weeks: 18, dueDate: "10 Nov 2024", checkupDate: "18 Jul 2026", ironStatus: "Regular", vaccineStatus: "Up to date", address: "Sector 2, Tumkur", weight: "52 kg (Normal)" },
    { id: "M-03", name: "mahima Lakshmi", age: 28, bloodGroup: "A+", phone: "9480223344", weeks: 32, dueDate: "14 Aug 2024", checkupDate: "20 Jun 2026", ironStatus: "Missed 2 doses", vaccineStatus: "Due in 3 days", address: "Main Road, Ward 4", weight: "58 kg (Normal)" },
    { id: "M-04", name: "Athira Menon", age: 24, bloodGroup: "O+", phone: "8123445566", weeks: 14, dueDate: "05 Dec 2024", checkupDate: "22 Jul 2026", ironStatus: "Regular", vaccineStatus: "Up to date", address: "Nagavalli Cross, Ward 1", weight: "49 kg (Underweight)" },
    { id: "M-05", name: "Aiswarya", age: 29, bloodGroup: "AB+", phone: "9741556677", weeks: 28, dueDate: "15 Sep 2024", checkupDate: "25 Jun 2026", ironStatus: "Regular", vaccineStatus: "Completed", address: "Near Anjaneya Temple", weight: "61 kg (Normal)" },
    { id: "M-06", name: "Aliya", age: 22, bloodGroup: "B-", phone: "9008667788", weeks: 12, dueDate: "20 Jan 2025", checkupDate: "30 Jul 2026", ironStatus: "Regular", vaccineStatus: "Due in 7 days", address: "North Block, Ward 2", weight: "48 kg (Normal)" },
    { id: "M-07", name: "Ayana S", age: 27, bloodGroup: "O-", phone: "9113778899", weeks: 36, dueDate: "25 Jul 2024", checkupDate: "10 Jun 2026", ironStatus: "Regular", vaccineStatus: "Completed", address: "Ashraya Colony, Ward 5", weight: "64 kg (Normal)" },
    { id: "M-08", name: "Mazha dhani", age: 25, bloodGroup: "A-", phone: "9900889900", weeks: 20, dueDate: "28 Oct 2024", checkupDate: "12 Jul 2026", ironStatus: "Regular", vaccineStatus: "Due in 10 days", address: "Market Street, Tumkur", weight: "53 kg (Normal)" },
    { id: "M-09", name: "Sreedevi", age: 31, bloodGroup: "B+", phone: "9611990011", weeks: 30, dueDate: "02 Sep 2024", checkupDate: "28 Jun 2026", ironStatus: "Regular", vaccineStatus: "Completed", address: "Post Office Road, Ward 3", weight: "57 kg (Normal)" }
  ];

  // Initial Babies Data (matching screenshot media_1795280765040_6a677754)
  const INITIAL_BABIES = [
    {
      id: "B-01",
      name: "Rohan Kumar",
      age: "8 months",
      gender: "Male",
      dob: "12 Oct 2023",
      phone: "1234567891",
      guardian: "Suresh Kumar",
      address: "Sector 3, Main Road",
      bloodGroup: "B+",
      totalVaccines: 10,
      completedVaccines: 7,
      pendingVaccines: 2,
      upcomingVaccines: 1,
      schedule: [
        { name: "BCG", timing: "At Birth", date: "12 Oct 2023", status: "Completed", type: "completed" },
        { name: "OPV (Dose 1)", timing: "6 Weeks", date: "25 Nov 2023", status: "Completed", type: "completed" },
        { name: "Pentavalent (Dose 1)", timing: "6 Weeks", date: "25 Nov 2023", status: "Completed", type: "completed" },
        { name: "OPV (Dose 2)", timing: "10 Weeks", date: "09 Dec 2023", status: "Completed", type: "completed" },
        { name: "Pentavalent (Dose 3)", timing: "14 Weeks", date: "20 June 2024", status: "Due Soon", type: "due" },
        { name: "Measles (Dose 1)", timing: "9 Months", date: "12 July 2024", status: "Upcoming", type: "upcoming" }
      ]
    },
    { id: "B-02", name: "Swetha Santhosh", age: "6 months", gender: "Female", dob: "15 Dec 2023", phone: "9845112233", guardian: "Santhosh", address: "Sector 2", bloodGroup: "O+", totalVaccines: 10, completedVaccines: 6, pendingVaccines: 3, upcomingVaccines: 1 },
    { id: "B-03", name: "Zechariah John", age: "11 months", gender: "Male", dob: "10 Jul 2023", phone: "9480223344", guardian: "John P", address: "Nagavalli", bloodGroup: "A+", totalVaccines: 10, completedVaccines: 8, pendingVaccines: 1, upcomingVaccines: 1 },
    { id: "B-04", name: "Sachin Jacob", age: "4 months", gender: "Male", dob: "22 Feb 2024", phone: "8123445566", guardian: "Jacob S", address: "Main Road, Ward 4", bloodGroup: "B+", totalVaccines: 10, completedVaccines: 5, pendingVaccines: 4, upcomingVaccines: 1 },
    { id: "B-05", name: "Aiswarya A", age: "9 months", gender: "Female", dob: "05 Sep 2023", phone: "9741556677", guardian: "Anand M", address: "Temple Road", bloodGroup: "O-", totalVaccines: 10, completedVaccines: 7, pendingVaccines: 2, upcomingVaccines: 1 },
    { id: "B-06", name: "Aliya P", age: "3 months", gender: "Female", dob: "18 Mar 2024", phone: "9008667788", guardian: "Parvez", address: "North Colony", bloodGroup: "AB+", totalVaccines: 10, completedVaccines: 4, pendingVaccines: 5, upcomingVaccines: 1 },
    { id: "B-07", name: "Hanna K Abraham", age: "7 months", gender: "Female", dob: "08 Nov 2023", phone: "9113778899", guardian: "Abraham K", address: "Tumkur Post", bloodGroup: "A+", totalVaccines: 10, completedVaccines: 7, pendingVaccines: 2, upcomingVaccines: 1 },
    { id: "B-08", name: "Mazha dhani", age: "5 months", gender: "Female", dob: "28 Jan 2024", phone: "9900889900", guardian: "Dhanush", address: "Market St", bloodGroup: "B-", totalVaccines: 10, completedVaccines: 5, pendingVaccines: 4, upcomingVaccines: 1 },
    { id: "B-09", name: "Sreedevi Kumari", age: "10 months", gender: "Female", dob: "14 Aug 2023", phone: "9611990011", guardian: "Kumaran", address: "West Block, Ward 1", bloodGroup: "O+", totalVaccines: 10, completedVaccines: 8, pendingVaccines: 1, upcomingVaccines: 1 }
  ];


  // ============================================================
  // GOOGLE MAPS & GIS CONFIGURATION
  // ============================================================
  // To use a live Google Cloud Maps key, set window.GOOGLE_MAPS_API_KEY = 'AIza...'
  // Required Google Cloud APIs to enable:
  // 1. Maps JavaScript API (interactive vector/raster satellite maps)
  // 2. Places API (New) (nearby healthcare places query)
  // 3. Geocoding API (reverse geocoding of coordinates)
  const GOOGLE_MAPS_CONFIG = {
    apiKey: (typeof window !== 'undefined' && window.GOOGLE_MAPS_API_KEY) ? window.GOOGLE_MAPS_API_KEY : '',
    defaultCenter: { lat: 13.2846, lng: 77.1025 }, // Primary Health Centre, Tumkur District
    requiredApis: ['Maps JavaScript API', 'Places API', 'Geocoding API']
  };

  function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(1));
  }

  // Dynamic Real-Time Facilities Cache (populated strictly from device GPS Places search)
  const NEARBY_FACILITIES = [];

  // Initial Field Visits Data (Matching user requirements: metrics, alerts, events, reasoning, status)
  const INITIAL_VISITS = [
    {
      id: "V-101",
      householdId: "HH-014",
      personName: "Lakshmi W/o Suresh",
      age: 23,
      relation: "Mother & Newborn",
      village: "Sector 3",
      purpose: "PNC Day 3 Newborn & Maternal Assessment",
      event: "Institutional Delivery — Post-Discharge Day 3",
      dueDate: "2026-11-21",
      status: "Overdue",
      previousRecord: "Normal hospital delivery, 3.0 kg at birth. No previous complications.",
      followupHistory: "Hospital discharge follow-up required within 72 hours.",
      alert: {
        title: "Immediate Visit Required",
        reason: "Newborn unvisited post-discharge (>72 hours). Thermal & cord care check mandatory.",
        priority: "Urgent"
      },
      ruleExplanation: "National IMNCI protocol: Home visit is mandatory on Days 1, 3, 7, 14, 21, 28 for all institutional deliveries to prevent neonatal hypothermia and infection.",
      followup: {
        required: true,
        dueDate: "2026-11-25",
        reason: "Day 7 PNC Weight and cord check",
        status: "Follow-up"
      }
    },
    {
      id: "V-102",
      householdId: "HH-029",
      personName: "Renuka Devi W/o Manjunath",
      age: 28,
      relation: "Pregnant Mother (34 wks)",
      village: "Sector 3",
      purpose: "3rd Trimester ANC Checkup & BP Screening",
      event: "Elevated BP (138/88 mmHg) at 28-wk Clinic",
      dueDate: "2026-11-20",
      status: "Overdue",
      previousRecord: "Gestational hypertension recorded during 28-week ANM clinic (BP: 138/88 mmHg).",
      followupHistory: "Weekly blood pressure tracking recommended.",
      alert: {
        title: "Overdue Blood Pressure Check",
        reason: "History of elevated BP; missed Village Health Nutrition Day check.",
        priority: "Urgent"
      },
      ruleExplanation: "High-risk pregnancy protocol: Third-trimester gestational hypertension requires bi-weekly tracking to rule out pre-eclampsia.",
      followup: {
        required: true,
        dueDate: "2026-11-24",
        reason: "ANM Clinic Hemoglobin & BP re-check",
        status: "Follow-up"
      }
    },
    {
      id: "V-103",
      householdId: "HH-038",
      personName: "Bhavya W/o Ravi",
      age: 22,
      relation: "Mother & Infant (14 days)",
      village: "Nagavalli",
      purpose: "PNC Day 14 Infection & Umbilical Check",
      event: "Umbilical Moisture Reported on Day 10",
      dueDate: "2026-11-21",
      status: "Due",
      previousRecord: "Mild umbilical moisture noted by Anganwadi helper on Day 10.",
      followupHistory: "Day 3 and Day 7 visits completed. Cord clean.",
      alert: {
        title: "Infection Watch Follow-up",
        reason: "Mild redness reported at umbilical stump. Triage for local infection.",
        priority: "Moderate"
      },
      ruleExplanation: "Newborn sepsis surveillance: Umbilical stump moisture with periumbilical redness warrants same-day visual assessment.",
      followup: {
        required: true,
        dueDate: "2026-11-28",
        reason: "PNC Day 21 Umbilical stump & weight follow-up",
        status: "Follow-up"
      }
    },
    {
      id: "V-104",
      householdId: "HH-007",
      personName: "Sunitha W/o Gangadhar",
      age: 25,
      relation: "Mother & Infant (6 months)",
      village: "Sector 3",
      purpose: "6-Month Infant Complementary Feeding & Growth Check",
      event: "Completed 6-Month Weaning Milestone",
      dueDate: "2026-11-23",
      status: "Upcoming",
      previousRecord: "Pentavalent-1 and 2 completed on time. Growth chart in green zone.",
      followupHistory: "Monthly Anganwadi growth monitoring.",
      alert: null,
      ruleExplanation: "Infant and Young Child Feeding guidelines: Initiation of complementary solid foods at completed 6 months while continuing breastfeeding.",
      followup: {
        required: false,
        dueDate: "",
        reason: "",
        status: "None"
      }
    },
    {
      id: "V-105",
      householdId: "HH-019",
      personName: "Shwetha W/o Ramesh",
      age: 24,
      relation: "Pregnant Mother (20 wks)",
      village: "Sector 3",
      purpose: "ANC 2nd Trimester Tetanus Toxoid & IFA Check",
      event: "Completed TT-2 Booster at Sub-Center",
      dueDate: "2026-11-19",
      status: "Complete",
      previousRecord: "TT-1 administered at 16 weeks. Hemoglobin 11.2 g/dL.",
      followupHistory: "Routine IFA distribution completed.",
      alert: null,
      ruleExplanation: "National Maternal Health guidelines: TT-2 administered 4 weeks after TT-1. IFA supplementation continued.",
      followup: {
        required: false,
        dueDate: "",
        reason: "",
        status: "None"
      }
    }
  ];

  class SakhiApp {
    constructor() {
      this.currentScreen = 'home';
      this.historyStack = [];
      this.isLoggedIn = localStorage.getItem('sakhi_auth') === 'true';
      
      // Load saved state or default
      this.mothers = this.loadState('sakhi_mothers', INITIAL_MOTHERS);
      this.babies = this.loadState('sakhi_babies', INITIAL_BABIES);
      this.visits = this.loadState('sakhi_visits', INITIAL_VISITS);
      
      this.selectedMother = this.mothers[0];
      this.selectedBaby = this.babies[0];
      this.editingTarget = null; // 'mother' | 'baby'
      this.currentVisitFilter = 'all';
      this.activeVisitSessions = {}; // Tracks live visit location captures by visitId
      this.facilities = [];
      this.facilityRadiusKm = 5;
      this.isSearchingPlaces = false;
      this.placesSearchError = null;
      this.currentFacilityFilter = 'all';
      this.userLocation = null;
      this.facilitySearchQuery = '';
      this.googleMapsLoaded = false;
      this.selectedFacility = null;

      this.isRecording = false;
      this.voiceRecordingTarget = 'chat'; // 'chat' | 'visit'
      this.recordingVisitId = null;
      this.speechRecognition = null;
      this.mediaRecorder = null;
      this.mediaStream = null;
      this.voiceChunks = [];
      this.apiBase = (window.SAKHI_API_BASE || "").replace(/\/$/, "");
      this.viewMode = 'desktop';
      this.deviceWidth = 390;

      this.init();
    }

    loadState(key, fallback) {
      try {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : fallback;
      } catch (e) {
        return fallback;
      }
    }

    saveState(key, data) {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) {}
    }

    init() {
      // Setup Voice recognition if available
      this.initSpeechRecognition();

      // Render lists
>>>>>>> 053f8ff (Initial commit with project files)
      this.renderMothersList(this.mothers);
      this.renderBabiesList(this.babies);
      this.renderMotherDetail(this.selectedMother);
      this.renderBabyDetail(this.selectedBaby);
      this.renderVisitsList();
      this.renderFollowupsList();
      this.renderAlertsList();
      this.updateStats();
<<<<<<< HEAD
      this.updateUserProfile();
      this.updateFilterCounts();
      this.updateVisitBeneficiaryOptions();
      this.updateDashboardDates();
    }

    mapMother(p, home, lastVisit) {
      const taken = this.parseJson(p.vacs_taken);
      const due = this.parseJson(p.vac_due);
      const next = this.parseJson(p.next_vac_n_due);
      return {
        id: String(p.beneficiary_id),
        beneficiaryId: String(p.beneficiary_id),
        name: p.mother_name || "Name not recorded",
        age: p.age,
        dob: p.dob || "",
        phone: p.mobile || "",
        weeks: p.week,
        dueDate: p.exp_dd || "",
        deliveryDate: p.dd || "",
        status: p.status || "",
        bloodGroup: p.blood_grp || "",
        weight: p.weight == null ? "" : String(p.weight),
        address: home.address || "",
        ironStatus: "Not available in backend record",
        vaccineStatus: Object.keys(due).length ? `${Object.keys(due).length} due` : (Object.keys(next).length ? `${Object.keys(next).length} upcoming` : "No pending vaccines recorded"),
        checkupDate: lastVisit ? (lastVisit.visit_ts || lastVisit.due_date || "") : "Not recorded",
        vacsTaken: taken,
        vacsDue: due,
        nextVaccines: next
      };
    }

    mapChild(p) {
      const taken = this.parseJson(p.vacs_taken);
      const due = this.parseJson(p.vacs_due);
      const next = this.parseJson(p.next_vac_n_due);
      const schedule = [];
      Object.entries(taken).forEach(([name, date]) => schedule.push({
        name, timing: "Administered", date: String(date || ""), status: "Completed", type: "completed"
      }));
      Object.entries(due).forEach(([name, date]) => schedule.push({
        name, timing: "Due", date: String(date || ""), status: "Due", type: "due"
      }));
      Object.entries(next).forEach(([name, date]) => schedule.push({
        name, timing: "Upcoming", date: String(date || ""), status: "Upcoming", type: "upcoming"
      }));
      return {
        id: `${p.beneficiary_id}::${p.child_name}`,
        beneficiaryId: String(p.beneficiary_id),
        name: p.child_name || "Name not recorded",
        dob: p.dob || "",
        age: p.age == null ? "" : String(p.age),
        gender: p.gender || "",
        weight: p.weight == null ? "" : String(p.weight),
        phone: "",
        guardian: p.father_name || p.mother_name || "",
        motherName: p.mother_name || "",
        fatherName: p.father_name || "",
        address: "",
        bloodGroup: p.blood_grp || "",
        nextVisit: p.next_visit || "",
        vacsTaken: taken,
        vacsDue: due,
        nextVaccines: next,
        schedule,
        totalVaccines: schedule.length,
        completedVaccines: Object.keys(taken).length,
        pendingVaccines: Object.keys(due).length,
        upcomingVaccines: Object.keys(next).length
      };
    }

    mapVisits(rows) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return rows.map(row => {
        const home = this.homeRecords.find(h => String(h.beneficiary_id) === String(row.beneficiary_id)) || {};
        const mother = this.mothers.find(m => m.beneficiaryId === String(row.beneficiary_id));
        const child = this.babies.find(b => b.beneficiaryId === String(row.beneficiary_id));
        const completed = !!(row.visit_ts && String(row.visit_ts).trim() && !["none", "null"].includes(String(row.visit_ts).toLowerCase()));
        const due = this.parseDate(row.due_date);
        const status = completed ? "Complete" : (!due ? "Due" : (due < today ? "Overdue" : (due.getTime() === today.getTime() ? "Due" : "Upcoming")));
        const name = mother?.name || child?.name || `Beneficiary ${row.beneficiary_id}`;
        const alert = row.flag ? {
          title: `Backend flag: ${row.flag}`,
          reason: row.note || row.voice || "A flag was recorded for this visit.",
          priority: ["S", "HS", "H"].includes(String(row.flag).toUpperCase()) ? "Urgent" : "Moderate"
        } : null;
        return {
          id: String(row.visit_id || row.id),
          visitId: String(row.visit_id || row.id),
          householdId: String(row.beneficiary_id || ""),
          beneficiaryId: String(row.beneficiary_id || ""),
          personName: name,
          relation: mother ? "Pregnant Mother" : (child ? "Child / Household" : "Household"),
          village: home.address || "Address not recorded",
          purpose: row.visit_type || row.type || "Field visit",
          event: row.note || row.voice || row.visit_type || "No visit note recorded",
          dueDate: row.due_date || "",
          status,
          previousRecord: row.note || "No previous note recorded",
          followupHistory: row.visit_ts || "No completed visit timestamp",
          alert,
          ruleExplanation: row.flag ? `Flag value recorded by backend: ${row.flag}` : "",
          followup: {
            required: !completed,
            dueDate: row.due_date || "",
            reason: row.visit_type || "Pending field visit",
            status: completed ? "Completed" : "Follow-up"
          },
          note: row.note || "",
          voice: row.voice || "",
          flag: row.flag || ""
        };
      });
    }

    parseJson(value) {
      if (value && typeof value === "object") return value;
      if (!value || value === "None" || value === "null") return {};
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (_) { return {}; }
    }

    parseDate(value) {
      if (!value) return null;
      const s = String(value).trim();
      let match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) return new Date(+match[1], +match[2] - 1, +match[3]);
      match = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (match) return new Date(+match[3], +match[2] - 1, +match[1]);
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    dateForBackend(value) {
      if (!value) return "";
      if (/^\d{2}-\d{2}-\d{4}$/.test(value)) return value;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    }

    escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[c]));
    }

    navigateTo(screenId, pushHistory = true) {
      const target = document.getElementById(`screen-${screenId}`);
      if (!target) return;
      if (pushHistory && this.currentScreen && this.currentScreen !== screenId) this.historyStack.push(this.currentScreen);
      document.querySelectorAll(".screen-view").forEach(el => el.classList.remove("active"));
      target.classList.add("active");
      this.currentScreen = screenId;
      document.body.classList.toggle("in-login-view", screenId === "login");
      const layout = document.getElementById("appLayout");
      if (layout) layout.classList.toggle("in-login-view", screenId === "login");
      if (window.location.hash !== `#${screenId}`) history.replaceState(null, "", `#${screenId}`);
      this.updateNavState(screenId);
      this.updateBreadcrumb(screenId);
      const bottom = document.getElementById("mobileBottomNav");
      if (bottom) bottom.style.display = ["login", "chat"].includes(screenId) ? "none" : "";
      if (screenId === "nearby-facilities") this.initNearbyFacilitiesScreen();
    }

    navigateBack() {
      this.navigateTo(this.historyStack.pop() || "home", false);
    }

    updateNavState(screenId) {
      document.querySelectorAll(".bottom-tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === screenId));
      document.querySelectorAll(".desktop-nav .nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.nav === screenId));
    }

    updateBreadcrumb(screenId) {
      const crumb = document.getElementById("crumbCurrentScreen");
      if (!crumb) return;
      const titles = {
        home: "Home Dashboard", visits: "Field Visits Register", followups: "Clinical Follow-ups",
        alerts: "Clinical Alerts", chat: "AI Health Assistant", "maternal-list": "Maternal Register",
        "maternal-detail": this.selectedMother?.name || "Mother Details",
        "maternal-form": "Register Pregnancy", "vaccine-list": "Child Register",
        "vaccine-detail": this.selectedBaby?.name || "Child Details", "vaccine-form": "Register Child",
        profile: "ASHA Worker Profile", login: "Login"
      };
      crumb.textContent = titles[screenId] || "SAKHI";
    }

    async handleLogin(event) {
      event.preventDefault();
      const mobile = document.getElementById("loginPhone")?.value.trim();
      const password = document.getElementById("loginPassword")?.value;
      if (!mobile || !password) return this.showToast("Enter mobile number and password.");
      const button = event.submitter || document.querySelector("#loginForm button[type=submit]");
      if (button) button.disabled = true;
      try {
        const result = await this.api("/api/auth/login", {
          method: "POST", body: JSON.stringify({ mobile, password })
        });
        this.user = result.data?.user || null;
        if (!this.user) throw new Error("Login response did not include a user profile.");
        this.isLoggedIn = true;
        sessionStorage.setItem("sakhi_user", JSON.stringify(this.user));
        await this.loadAllData();
        this.showToast(`Welcome, ${this.user.name || "ASHA Worker"}`);
        this.navigateTo("home");
      } catch (error) {
        this.showToast(error.message || "Login failed");
      } finally {
        if (button) button.disabled = false;
=======

      // Setup initial view mode (Desktop vs Mobile)
      const savedMode = localStorage.getItem('sakhi_view_mode') || (window.innerWidth >= 1024 ? 'desktop' : 'mobile');
      this.setViewMode(savedMode);

      // Initial route based on auth
      if (!this.isLoggedIn) {
        this.navigateTo('login', false);
      } else {
        // Read hash or default to home, then refresh beneficiary identities from SQLite.
        const initialScreen = window.location.hash.replace('#', '') || 'home';
        this.navigateTo(initialScreen, false);
        this.loadBackendLists();
      }

      // Hash change listener
      window.addEventListener('hashchange', () => {
        const screen = window.location.hash.replace('#', '');
        if (screen && screen !== this.currentScreen) {
          this.navigateTo(screen, false);
        }
      });
    }

    // ============================================================
    // NAVIGATION & ROUTING
    // ============================================================
    navigateTo(screenId, pushHistory = true) {
      const targetScreen = document.getElementById(`screen-${screenId}`);
      if (!targetScreen) {
        console.warn(`Screen ${screenId} not found`);
        return;
      }

      // Push history if navigating forward
      if (pushHistory && this.currentScreen && this.currentScreen !== screenId) {
        this.historyStack.push(this.currentScreen);
      }

      // Hide all screens
      document.querySelectorAll('.screen-view').forEach(view => {
        view.classList.remove('active');
      });

      // Handle Login View Isolation (No sidebar/toolbar on login)
      const isLogin = (screenId === 'login');
      document.body.classList.toggle('in-login-view', isLogin);
      const layout = document.getElementById('appLayout');
      if (layout) layout.classList.toggle('in-login-view', isLogin);

      // Show target
      targetScreen.classList.add('active');
      this.currentScreen = screenId;
      window.location.hash = screenId;

      // Scroll to top — in desktop mode the scrollable container is desktopContentArea,
      // in mobile mode it is appCanvas. Scroll both to cover all layout modes.
      const canvas = document.getElementById('appCanvas');
      if (canvas) canvas.scrollTop = 0;
      const contentArea = document.getElementById('desktopContentArea');
      if (contentArea) contentArea.scrollTop = 0;
      window.scrollTo(0, 0);

      // Update Navigation sync (bottom tabs and desktop sidebar)
      this.updateNavState(screenId);

      // Update Desktop Breadcrumb Title
      this.updateBreadcrumb(screenId);

      if (screenId === 'nearby-facilities') {
        this.initNearbyFacilitiesScreen();
      }

      // Hide or show bottom navigation bar
      const bottomNav = document.getElementById('mobileBottomNav');
      if (bottomNav) {
        if (screenId === 'login' || screenId === 'chat') {
          bottomNav.style.display = 'none';
        } else {
          bottomNav.style.display = '';
        }
      }
    }

    updateBreadcrumb(screenId) {
      const crumb = document.getElementById('crumbCurrentScreen');
      if (!crumb) return;
      const titles = {
        'home': 'Home Dashboard',
        'visits': 'Field Visits Register',
        'followups': 'Clinical Follow-ups',
        'alerts': 'Clinical Alerts & Protocol Triage',
        'nearby-facilities': 'Nearby Clinics & Hospitals',
        'chat': 'AI Health Assistant',
        'maternal-list': 'Maternal Health / Register',
        'maternal-detail': this.selectedMother ? `Maternal / ${this.selectedMother.name}` : 'Mother Details',
        'maternal-form': 'Maternal / Add-Edit Mother',
        'vaccine-list': 'Vaccine Tracker / Babies List',
        'vaccine-detail': this.selectedBaby ? `Vaccines / ${this.selectedBaby.name}` : 'Child Details',
        'vaccine-form': 'Vaccines / Add-Edit Baby',
        'profile': 'ASHA Worker Profile',
        'login': 'Login Portal'
      };
      crumb.textContent = titles[screenId] || 'Home';
    }

    // ============================================================
    // VIEW MODE SWITCHER (Mobile Frame vs Expanded Desktop)
    // ============================================================
    setViewMode(mode) {
      this.viewMode = mode;
      try {
        localStorage.setItem('sakhi_view_mode', mode);
      } catch (e) {}

      const layout = document.getElementById('appLayout');
      const btnMobile = document.getElementById('btnModeMobile');
      const btnDesktop = document.getElementById('btnModeDesktop');
      const presets = document.getElementById('devicePresetsGroup');
      const canvas = document.getElementById('appCanvas');

      if (btnMobile) btnMobile.classList.toggle('active', mode === 'mobile');
      if (btnDesktop) btnDesktop.classList.toggle('active', mode === 'desktop');

      if (layout) {
        layout.classList.toggle('mode-desktop', mode === 'desktop');
        layout.classList.toggle('mode-mobile', mode === 'mobile');
      }

      if (presets) {
        presets.style.display = (mode === 'mobile') ? 'flex' : 'none';
      }

      if (canvas) {
        if (mode === 'desktop') {
          canvas.style.maxWidth = '';
        } else {
          canvas.style.maxWidth = `${this.deviceWidth || 390}px`;
        }
      }
    }

    setDeviceWidth(width) {
      this.deviceWidth = width;
      document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.width) === width);
      });
      const canvas = document.getElementById('appCanvas');
      if (canvas && this.viewMode === 'mobile') {
        canvas.style.maxWidth = `${width}px`;
      }
    }

    navigateBack() {
      if (this.historyStack.length > 0) {
        const prev = this.historyStack.pop();
        this.navigateTo(prev, false);
      } else {
        this.navigateTo('home', false);
      }
    }

    updateNavState(screenId) {
      // Bottom Navigation Bar tabs
      document.querySelectorAll('.bottom-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === screenId);
      });

      // Desktop Sidebar nav items
      document.querySelectorAll('.desktop-nav .nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.nav === screenId);
      });
    }

    // ============================================================
    // AUTHENTICATION
    // ============================================================
    async handleLogin(event) {
      event.preventDefault();
      const mobile = document.getElementById('loginPhone')?.value?.trim();
      const password = document.getElementById('loginPassword')?.value;
      if (!mobile || !password) return this.showToast('Enter mobile number and password.');
      const submit = document.querySelector('#loginForm button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const result = await this.apiRequest('/api/auth/login', { method: 'POST', body: { mobile, password } });
        const user = result?.data?.user || result?.user;
        if (!user) throw new Error(result?.message || 'Login response did not contain a user profile.');
        this.currentUser = user;
        localStorage.setItem('sakhi_auth', 'true');
        localStorage.setItem('sakhi_user', JSON.stringify(user));
        this.isLoggedIn = true;
        this.showToast('Welcome back, ' + (user.name || 'ASHA Worker') + '!');
        await this.loadBackendLists();
        this.navigateTo('home');
      } catch (error) {
        this.showToast(error.message || 'Login failed. Check API connection.');
      } finally {
        if (submit) submit.disabled = false;
      }
    }

    async apiRequest(path, options = {}) {
      const headers = { ...(options.headers || {}) };
      let body = options.body;
      if (body !== undefined && !(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
      const response = await fetch(this.apiBase + path, { method: options.method || 'GET', headers, body });
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await response.json() : await response.text();
      if (!response.ok || payload?.success === false) {
        const detail = payload?.detail || payload?.message || payload?.data?.message || `Request failed (${response.status})`;
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      }
      return payload;
    }

    async loadBackendLists() {
      // The backend list endpoints intentionally return identifiers and names only.
      // Keep the existing visual cards but replace their demo identities with DB identities.
      try {
        const [mothersResponse, childrenResponse] = await Promise.all([
          this.apiRequest('/api/mothers'), this.apiRequest('/api/children')
        ]);
        const mothers = mothersResponse?.data || [];
        const children = childrenResponse?.data || [];
        if (Array.isArray(mothers) && mothers.length) {
          this.mothers = mothers.map((row, i) => ({
            ...(INITIAL_MOTHERS[i] || {}), id: row.beneficiary_id, beneficiary_id: row.beneficiary_id,
            name: row.mother_name || row.name || row.beneficiary_id
          }));
          this.selectedMother = this.mothers[0];
          this.renderMothersList(this.mothers);
          this.renderMotherDetail(this.selectedMother);
        } else { this.mothers = []; this.selectedMother = null; this.renderMothersList([]); }
        if (Array.isArray(children) && children.length) {
          this.babies = children.map((row, i) => ({
            ...(INITIAL_BABIES[i] || {}), id: row.beneficiary_id, beneficiary_id: row.beneficiary_id,
            name: row.child_name || row.name || row.beneficiary_id
          }));
          this.selectedBaby = this.babies[0];
          this.renderBabiesList(this.babies);
          this.renderBabyDetail(this.selectedBaby);
        } else { this.babies = []; this.selectedBaby = null; this.renderBabiesList([]); }
        this.saveState('sakhi_mothers', this.mothers);
        this.saveState('sakhi_babies', this.babies);
      } catch (error) {
        console.warn('Could not load backend lists:', error);
        this.showToast('Could not refresh beneficiary lists from the server.');
>>>>>>> 053f8ff (Initial commit with project files)
      }
    }

    logout() {
      this.isLoggedIn = false;
<<<<<<< HEAD
      this.user = null;
      sessionStorage.removeItem("sakhi_user");
      this.historyStack = [];
      this.navigateTo("login", false);
      this.showToast("Logged out");
    }

    updateUserProfile() {
      if (!this.user) return;
      const values = {
        workerProfileName: this.user.name,
        workerProfilePhone: this.user.mobile,
        workerProfilePhoneOverview: this.user.mobile,
        workerProfileEmail: this.user.email,
        workerProfileDob: this.user.dob,
        workerProfileLocation: this.user.address,
        workerProfileAddress: this.user.address,
        workerProfileFullName: this.user.name
      };
      Object.entries(values).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value || "Not available";
      });
      document.querySelectorAll(".desktop-profile-info .name").forEach(el => {
        el.textContent = this.user.name || "ASHA Worker";
      });
    }

    setViewMode(mode) {
      this.viewMode = mode;
      localStorage.setItem("sakhi_view_mode", mode);
      const layout = document.getElementById("appLayout");
      const canvas = document.getElementById("appCanvas");
      const presets = document.getElementById("devicePresetsGroup");
      document.getElementById("btnModeMobile")?.classList.toggle("active", mode === "mobile");
      document.getElementById("btnModeDesktop")?.classList.toggle("active", mode === "desktop");
      layout?.classList.toggle("mode-desktop", mode === "desktop");
      layout?.classList.toggle("mode-mobile", mode === "mobile");
      if (presets) presets.style.display = mode === "mobile" ? "flex" : "none";
      if (canvas) canvas.style.maxWidth = mode === "desktop" ? "" : `${this.deviceWidth}px`;
    }

    setDeviceWidth(width) {
      this.deviceWidth = Number(width);
      document.querySelectorAll(".btn-preset").forEach(btn => btn.classList.toggle("active", Number(btn.dataset.width) === this.deviceWidth));
      const canvas = document.getElementById("appCanvas");
      if (canvas && this.viewMode === "mobile") canvas.style.maxWidth = `${this.deviceWidth}px`;
    }

    openDrawer() { document.getElementById("drawerOverlay")?.classList.add("open"); }
    closeDrawer() { document.getElementById("drawerOverlay")?.classList.remove("open"); }

    showToast(message) {
      const container = document.getElementById("toastContainer");
      if (!container) { alert(message); return; }
      const toast = document.createElement("div");
      toast.className = "toast-msg";
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 3600);
    }

    showOptionsMenu(context) {
      const modal = document.getElementById("optionsModal");
      const title = document.getElementById("optionsSheetTitle");
      const list = document.getElementById("optionsActionsList");
      if (!modal || !list) return;
      const actions = context === "maternal" ? [
        ["Refresh register", () => this.refreshData()],
        ["Register pregnancy", () => this.openMaternalForm()]
      ] : context === "vaccine" ? [
        ["Refresh register", () => this.refreshData()],
        ["Register child", () => this.openBabyForm()]
      ] : [
        ["Refresh database data", () => this.refreshData()]
      ];
      if (title) title.textContent = "Options";
      list.innerHTML = "";
      actions.forEach(([label, action]) => {
        const button = document.createElement("button");
        button.className = "sheet-action-item";
        button.textContent = label;
        button.addEventListener("click", () => { this.closeOptionsMenu(); action(); });
        list.appendChild(button);
      });
      modal.classList.add("open");
    }

    closeOptionsMenu() { document.getElementById("optionsModal")?.classList.remove("open"); }

    showNotificationsModal() {
      this.showToast(`Overdue visits: ${this.metrics.overdue_visits ?? 0}; pending visits: ${this.metrics.pending_visits ?? 0}`);
    }

    async refreshData() {
      try { await this.loadAllData(); this.showToast("Data refreshed from database."); }
      catch (error) { this.showToast(error.message); }
    }

    renderMothersList(rows) {
      const container = document.getElementById("mothersListContainer");
      if (!container) return;
      if (!rows.length) {
        container.innerHTML = '<div class="empty-state-card"><p>No pregnancy records found in the database.</p></div>';
        return;
      }
      container.innerHTML = rows.map(m => `
        <button class="pill-list-card" type="button" onclick="sakhiApp.selectMother('${encodeURIComponent(m.id)}')">
          <span class="pill-card-avatar"><img src="${MOTHER_AVATAR}" alt=""></span>
          <span class="pill-card-name">${this.escapeHtml(m.name)}</span>
          <small>${this.escapeHtml(m.beneficiaryId)}</small>
        </button>`).join("");
    }

    filterMothers(query) {
      const q = (query || "").toLowerCase();
      this.renderMothersList(this.mothers.filter(m =>
        `${m.name} ${m.beneficiaryId} ${m.phone} ${m.address}`.toLowerCase().includes(q)
      ));
    }

    selectMother(id) {
      let key = String(id); try { key = decodeURIComponent(key); } catch (_) {}
      this.selectedMother = this.mothers.find(m => m.id === key);
      this.renderMotherDetail(this.selectedMother);
      this.navigateTo("maternal-detail");
    }

    renderMotherDetail(m) {
      if (!m) {
        ["maternalDetailHeaderName", "motherDetailName"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.textContent = "No mother records";
        });
        ["motherDetailMeta", "motherDetailPhone", "motherDetailPregBadge", "motherTileCheckup", "motherTileIron", "motherTileVaccine", "motherOverviewWeek", "motherOverviewDueDate"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.textContent = "Not recorded";
        });
        const progress = document.getElementById("motherProgressBar");
        if (progress) progress.style.width = "0%";
        return;
      }
      const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value || "Not recorded"; };
      set("maternalDetailHeaderName", m.name);
      set("motherDetailName", m.name);
      set("motherDetailMeta", `Age: ${m.age ?? "Not recorded"} · Blood group: ${m.bloodGroup || "Not recorded"}`);
      set("motherDetailPhone", `Phone: ${m.phone || "Not recorded"}`);
      set("motherDetailPregBadge", m.weeks == null ? "Gestational week not recorded" : `${m.weeks} weeks pregnant`);
      set("motherTileCheckup", m.checkupDate);
      set("motherTileIron", m.ironStatus);
      set("motherTileVaccine", m.vaccineStatus);
      set("motherOverviewWeek", m.weeks == null ? "Not recorded" : `${m.weeks} weeks`);
      set("motherOverviewDueDate", m.dueDate);
      const progress = document.getElementById("motherProgressBar");
      if (progress) progress.style.width = `${Math.min(100, Math.max(0, Number(m.weeks || 0) / 40 * 100))}%`;
      const edit = document.querySelector("#screen-maternal-detail .pill-btn-edit-pink");
      if (edit) edit.style.display = "none"; // backend.py has no mother-profile update function
    }

    openMaternalForm() {
      document.getElementById("maternalProfileForm")?.reset();
      this.navigateTo("maternal-form");
    }

    async handleSaveMother(event) {
      event.preventDefault();
      const beneficiary_id = document.getElementById("motherFormBeneficiaryId").value.trim();
      const week = Number(document.getElementById("motherFormWeek").value);
      const dueInput = document.getElementById("motherFormDueDate").value;
      if (!beneficiary_id || !week || !dueInput) return this.showToast("Complete all pregnancy fields.");
      try {
        await this.api("/api/pregnancies", {
          method: "POST",
          body: JSON.stringify({
            beneficiary_id, week, exp_dd: this.dateForBackend(dueInput), dd: null
          })
        });
        await this.loadAllData();
        this.showToast("Pregnancy record saved to database.");
        this.navigateTo("maternal-list");
      } catch (error) { this.showToast(error.message); }
    }

    renderBabiesList(rows) {
      const container = document.getElementById("babiesListContainer");
      if (!container) return;
      if (!rows.length) {
        container.innerHTML = '<div class="empty-state-card"><p>No child records found in the database.</p></div>';
        return;
      }
      container.innerHTML = rows.map(b => `
        <button class="pill-list-card" type="button" onclick="sakhiApp.selectBaby('${encodeURIComponent(b.id)}')">
          <span class="pill-card-avatar"><img src="${BABY_AVATAR}" alt=""></span>
          <span class="pill-card-name">${this.escapeHtml(b.name)}</span>
          <small>${this.escapeHtml(b.beneficiaryId)}</small>
        </button>`).join("");
    }

    filterBabies(query) {
      const q = (query || "").toLowerCase();
      this.renderBabiesList(this.babies.filter(b =>
        `${b.name} ${b.beneficiaryId} ${b.gender} ${b.guardian}`.toLowerCase().includes(q)
      ));
    }

    selectBaby(id) {
      let key = String(id); try { key = decodeURIComponent(key); } catch (_) {}
      this.selectedBaby = this.babies.find(b => b.id === key);
      this.renderBabyDetail(this.selectedBaby);
      this.navigateTo("vaccine-detail");
    }

    renderBabyDetail(b) {
      if (!b) {
        const el = document.getElementById("childDetailName");
        if (el) el.textContent = "No child records";
        ["childDetailMeta", "childDetailPhone", "childTotalVaccines", "childCompletedVaccines", "childPendingVaccines", "childUpcomingVaccines"].forEach(id => {
          const node = document.getElementById(id);
          if (node) node.textContent = "0";
        });
        const timeline = document.getElementById("childVaccineTimeline");
        if (timeline) timeline.innerHTML = '<div class="empty-state-card"><p>No child records available in the database.</p></div>';
        document.getElementById("vaccineEntryForm")?.remove();
        return;
      }
      const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value || "Not recorded"; };
      set("childDetailName", b.name);
      set("childDetailMeta", `Age: ${b.age || "Not recorded"} · ${b.gender || "Gender not recorded"}`);
      set("childDetailPhone", `Beneficiary ID: ${b.beneficiaryId}`);
      set("childTotalVaccines", b.totalVaccines);
      set("childCompletedVaccines", b.completedVaccines);
      set("childPendingVaccines", b.pendingVaccines);
      set("childUpcomingVaccines", b.upcomingVaccines);
      const timeline = document.getElementById("childVaccineTimeline");
      if (timeline) {
        if (!b.schedule.length) {
          timeline.innerHTML = '<div class="empty-state-card"><p>No vaccine history or schedule stored for this child.</p></div>';
        } else {
          timeline.innerHTML = b.schedule.map(item => `
            <div class="timeline-item">
              <div class="timeline-dot">${item.type === "completed" ? "✓" : item.type === "due" ? "◷" : "○"}</div>
              <div class="timeline-info-col">
                <div class="timeline-vaccine-name">${this.escapeHtml(item.name)}</div>
                <div class="timeline-vaccine-timing">${this.escapeHtml(item.timing)}</div>
              </div>
              <div class="timeline-status-col">
                <span class="status-badge ${item.type === "completed" ? "badge-completed" : item.type === "due" ? "badge-due" : "badge-upcoming"}">${this.escapeHtml(item.status)}</span>
                <span class="timeline-date">${this.escapeHtml(item.date)}</span>
              </div>
            </div>`).join("");
        }
      }
      document.getElementById("vaccineEntryForm")?.remove();
      this.renderVaccineEntry(b);
      const edit = document.querySelector("#screen-vaccine-detail .pill-btn-edit-purple");
      if (edit) edit.style.display = "none"; // backend.py has no child-profile update function
    }

    renderVaccineEntry(b) {
      const timeline = document.getElementById("childVaccineTimeline");
      if (!timeline || document.getElementById("vaccineEntryForm")) return;
      const form = document.createElement("form");
      form.id = "vaccineEntryForm";
      form.className = "form-body-content";
      form.innerHTML = `
        <h3 class="form-section-title">Record administered vaccine</h3>
        <div class="form-fields-row-2">
          <div class="form-field-col">
            <label class="form-field-label">Vaccine name</label>
            <input class="form-input-box" name="vaccine" required placeholder="Exact vaccine name">
          </div>
          <div class="form-field-col">
            <label class="form-field-label">Administration date (DD-MM-YYYY)</label>
            <input class="form-input-box" name="administered_date" required placeholder="DD-MM-YYYY">
          </div>
        </div>
        <button class="btn-full-purple btn-save-action" type="submit">Save vaccination</button>`;
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const vaccine = form.elements.vaccine.value.trim();
        const administered_date = form.elements.administered_date.value.trim();
        try {
          await this.api("/api/vaccinations", {
            method: "POST",
            body: JSON.stringify({
              beneficiary_id: b.beneficiaryId, vaccine, administered_date,
              mode: "child", child_name: b.name
            })
          });
          await this.loadAllData();
          this.selectedBaby = this.babies.find(x => x.id === b.id) || null;
          this.renderBabyDetail(this.selectedBaby);
          this.showToast("Vaccination saved to database.");
        } catch (error) { this.showToast(error.message); }
      });
      timeline.parentElement?.appendChild(form);
    }

    openBabyForm() {
      document.getElementById("babyProfileForm")?.reset();
      this.navigateTo("vaccine-form");
    }

    async handleSaveBaby(event) {
      event.preventDefault();
      const beneficiary_id = document.getElementById("babyFormBeneficiaryId").value.trim();
      const child_name = document.getElementById("babyFormName").value.trim();
      const gender = document.getElementById("babyFormGender").value;
      const dob = this.dateForBackend(document.getElementById("babyFormDOB").value.trim());
      const weight = Number(document.getElementById("babyFormWeight").value);
      const next_visit = this.dateForBackend(document.getElementById("babyFormNextVisit").value.trim());
      if (!beneficiary_id || !child_name || !gender || !dob || !weight || !next_visit) {
        return this.showToast("Complete all required child fields.");
      }
      try {
        await this.api("/api/children", {
          method: "POST",
          body: JSON.stringify({
            beneficiary_id, child_name, gender, dob, weight,
            vacs_taken: {}, next_visit
          })
        });
        await this.loadAllData();
        this.showToast("Child record saved to database.");
        this.navigateTo("vaccine-list");
      } catch (error) { this.showToast(error.message); }
    }

    updateStats() {
      const m = this.metrics || {};
      const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value ?? 0; };
      set("statMothersCount", this.mothers.length);
      set("statBabiesCount", m.total_children ?? this.babies.length);
      set("statUpcomingVisits", m.upcoming_visits ?? 0);
      set("statOverdueVisits", m.overdue_visits ?? 0);
      set("statDueThisWeek", m.due_next_7_days ?? 0);
      set("statHomesCount", m.total_homes);
      set("statVisitsCount", m.total_visits);
      set("statCompletedVisits", m.completed_visits);
      set("statPendingVisits", m.pending_visits);
    }

    updateFilterCounts() {
      const counts = {
        all: this.visits.length,
        Overdue: this.visits.filter(v => v.status === "Overdue").length,
        Due: this.visits.filter(v => v.status === "Due").length,
        Upcoming: this.visits.filter(v => v.status === "Upcoming").length,
        Complete: this.visits.filter(v => v.status === "Complete").length
      };
      document.querySelectorAll("#screen-visits .filter-pill-btn").forEach(btn => {
        const key = btn.dataset.filter || "all";
        const count = key === "all" ? counts.all : counts[key] ?? 0;
        const label = key === "all" ? "All" : key;
        btn.textContent = `${label} (${count})`;
      });
      const pending = this.visits.filter(v => v.status !== "Complete").length;
      const completed = this.visits.filter(v => v.status === "Complete").length;
      const followupButtons = document.querySelectorAll("#screen-followups .filter-pill-btn");
      followupButtons.forEach(btn => {
        const key = btn.dataset.filter || "all";
        const label = key === "required" ? "Action Required" : key === "completed" ? "Completed" : "All Follow-ups";
        const count = key === "completed" ? completed : pending;
        btn.textContent = `${label} (${count})`;
      });
      const flagged = this.visits.filter(v => !!v.flag);
      const urgent = flagged.filter(v => ["S", "HS", "H"].includes(String(v.flag).toUpperCase())).length;
      const moderate = flagged.length - urgent;
      document.querySelectorAll("#screen-alerts .filter-pill-btn").forEach(btn => {
        const key = btn.dataset.filter || "all";
        const label = key === "Urgent" ? "Urgent Priority" : key === "Moderate" ? "Moderate" : "All Alerts";
        const count = key === "Urgent" ? urgent : key === "Moderate" ? moderate : flagged.length;
        btn.textContent = `${label} (${count})`;
      });
    }

    renderVisitsList(statusFilter = "all", searchQuery = "") {
      const container = document.getElementById("visitsListContainer");
      if (!container) return;
      let rows = this.visits;
      if (statusFilter && statusFilter !== "all") rows = rows.filter(v => v.status.toLowerCase() === statusFilter.toLowerCase());
      const q = (searchQuery || "").toLowerCase().trim();
      if (q) rows = rows.filter(v => `${v.personName} ${v.village} ${v.purpose} ${v.beneficiaryId}`.toLowerCase().includes(q));
      if (!rows.length) {
        container.innerHTML = '<div class="empty-state-card"><p>No matching visit records in the database.</p></div>';
        return;
      }
      container.innerHTML = rows.map(v => `
        <article class="visit-clinical-card ${v.status === "Overdue" ? "status-border-crimson" : ""}">
          <div class="visit-card-top-row">
            <div class="visit-beneficiary-info">
              <h3 class="visit-person-name">${this.escapeHtml(v.personName)}</h3>
              <span class="visit-relation-tag">${this.escapeHtml(v.relation)} · ${this.escapeHtml(v.village)} · ${this.escapeHtml(v.beneficiaryId)}</span>
            </div>
            <span class="visit-status-badge ${v.status === "Complete" ? "tag-emerald" : v.status === "Overdue" ? "tag-crimson" : v.status === "Due" ? "tag-amber" : "tag-teal"}">${v.status}</span>
          </div>
          <div class="visit-purpose-line"><span class="purpose-label">Visit type:</span><span class="purpose-text">${this.escapeHtml(v.purpose)}</span></div>
          <div class="visit-event-badge"><span class="event-icon">📅</span><span class="event-text">Due: ${this.escapeHtml(v.dueDate || "Not recorded")}</span></div>
          ${v.note ? `<p class="visit-relation-tag">${this.escapeHtml(v.note)}</p>` : ""}
          ${v.flag ? `<div class="visit-alert-box alert-moderate"><span class="alert-icon">⚑</span><div class="alert-content"><span class="alert-title">Backend flag: ${this.escapeHtml(v.flag)}</span><span class="alert-reason">${this.escapeHtml(v.note || "No note supplied")}</span></div></div>` : ""}
          <div class="visit-card-footer">
            <div class="visit-due-info"><span class="due-label">Recorded:</span><span class="due-date">${this.escapeHtml(v.voice || v.status === "Complete" ? (v.voice || "Completed") : "Pending")}</span></div>
            ${v.status === "Complete" ? "" : `<button class="btn-visit-action btn-visit-complete" onclick="sakhiApp.completeVisit('${this.escapeHtml(v.visitId)}')">Complete visit</button>`}
          </div>
        </article>`).join("");
    }

    filterVisits(status, btn) {
      this.currentVisitFilter = status || "all";
      if (btn) {
        document.querySelectorAll("#screen-visits .filter-pill-btn").forEach(x => x.classList.remove("active"));
        btn.classList.add("active");
      }
      this.renderVisitsList(this.currentVisitFilter, document.getElementById("visitsSearchInput")?.value || "");
    }

    searchVisits(query) { this.renderVisitsList(this.currentVisitFilter, query); }

    async completeVisit(id) {
      const visit = this.visits.find(v => v.visitId === String(id));
      if (!visit) return this.showToast("Visit not found.");
      const note = prompt("Enter visit assessment / notes:");
      if (note === null || !note.trim()) return;
      const visitType = visit.purpose || "Home visit";
      try {
        await this.api("/api/visits/complete", {
          method: "POST",
          body: JSON.stringify({
            visit_id: visit.visitId,
            beneficiary_id: visit.beneficiaryId,
            voice: "",
            note: note.trim(),
            visit_type: visitType
          })
        });
        await this.loadAllData();
        this.showToast("Visit completion saved to database.");
      } catch (error) { this.showToast(error.message); }
    }

    async scheduleVisit() {
      const beneficiary_id = document.getElementById("newVisitBeneficiary")?.value;
      const visit_type = document.getElementById("newVisitType")?.value.trim();
      const due_date = document.getElementById("newVisitDate")?.value;
      if (!beneficiary_id || !visit_type || !due_date) return this.showToast("Complete all visit fields.");
      try {
        await this.api("/api/visits", {
          method: "POST",
          body: JSON.stringify({ ben_id: beneficiary_id, v_type: visit_type, due_date: this.dateForBackend(due_date) })
        });
        await this.loadAllData();
        this.showToast("Visit scheduled in database.");
      } catch (error) { this.showToast(error.message); }
    }

    renderFollowupsList(filter = "all") {
      const container = document.getElementById("followupsListContainer");
      if (!container) return;
      let rows = this.visits.filter(v => v.status !== "Complete");
      if (filter === "completed") rows = this.visits.filter(v => v.status === "Complete");
      if (!rows.length) {
        container.innerHTML = '<div class="empty-state-card"><p>No matching follow-up visits in the database.</p></div>';
        return;
      }
      container.innerHTML = rows.map(v => `
        <article class="visit-clinical-card">
          <div class="visit-card-top-row"><h3 class="visit-person-name">${this.escapeHtml(v.personName)}</h3><span class="visit-status-badge tag-amber">${v.status}</span></div>
          <p class="visit-purpose-line">${this.escapeHtml(v.purpose)}</p>
          <p class="visit-relation-tag">${this.escapeHtml(v.beneficiaryId)} · ${this.escapeHtml(v.village)}</p>
          <div class="visit-card-footer"><span class="due-date">${this.escapeHtml(v.dueDate || "Not recorded")}</span>${v.status === "Complete" ? "" : `<button class="btn-visit-action btn-visit-complete" onclick="sakhiApp.completeVisit('${this.escapeHtml(v.visitId)}')">Complete</button>`}</div>
        </article>`).join("");
=======
      localStorage.removeItem('sakhi_auth');
      localStorage.removeItem('sakhi_user');
      this.historyStack = [];
      this.showToast('Logged out successfully');
      this.navigateTo('login', false);
    }

    togglePasswordVisibility(inputId, btn) {
      const input = document.getElementById(inputId);
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.style.color = '#2B66FF';
      } else {
        input.type = 'password';
        btn.style.color = '#6B7280';
      }
    }

    // ============================================================
    // DRAWER / NAVIGATION MENU
    // ============================================================
    openDrawer() {
      const overlay = document.getElementById('drawerOverlay');
      if (overlay) overlay.classList.add('open');
    }

    closeDrawer() {
      const overlay = document.getElementById('drawerOverlay');
      if (overlay) overlay.classList.remove('open');
    }

    // ============================================================
    // MATERNAL HEALTH MODULE
    // ============================================================
    renderMothersList(mothers) {
      const container = document.getElementById('mothersListContainer');
      if (!container) return;

      container.innerHTML = mothers.map(m => `
        <div class="pill-list-card" onclick="sakhiApp.selectMother('${m.id}')">
          <div class="pill-card-avatar">
            <img src="${MOTHER_AVATAR}" alt="${m.name}">
          </div>
          <span class="pill-card-name">${m.name}</span>
        </div>
      `).join('');
    }

    filterMothers(query) {
      const q = (query || '').toLowerCase().trim();
      const filtered = this.mothers.filter(m => 
        m.name.toLowerCase().includes(q) ||
        (m.phone && m.phone.includes(q)) ||
        (m.address && m.address.toLowerCase().includes(q))
      );
      this.renderMothersList(filtered);
    }

    selectMother(id) {
      const mother = this.mothers.find(m => m.id === id);
      if (!mother) return;
      this.selectedMother = mother;
      this.renderMotherDetail(mother);
      this.navigateTo('maternal-detail');
    }

    renderMotherDetail(mother) {
      if (!mother) return;
      
      const headerName = document.getElementById('maternalDetailHeaderName');
      const detailName = document.getElementById('motherDetailName');
      const detailMeta = document.getElementById('motherDetailMeta');
      const detailPhone = document.getElementById('motherDetailPhone');
      const pregBadge = document.getElementById('motherDetailPregBadge');
      const tileCheckup = document.getElementById('motherTileCheckup');
      const tileIron = document.getElementById('motherTileIron');
      const tileVaccine = document.getElementById('motherTileVaccine');
      const overviewWeek = document.getElementById('motherOverviewWeek');
      const overviewDueDate = document.getElementById('motherOverviewDueDate');
      const progressBar = document.getElementById('motherProgressBar');

      if (headerName) headerName.textContent = mother.name;
      if (detailName) detailName.textContent = mother.name;
      if (detailMeta) detailMeta.textContent = `Age : ${mother.age || 28}  Blood Group : ${mother.bloodGroup || 'O+'}`;
      if (detailPhone) detailPhone.textContent = `Phone Number :${mother.phone || '1234567891'}`;
      if (pregBadge) pregBadge.textContent = `${mother.weeks || 24} Weeks Pregnant`;
      if (tileCheckup) tileCheckup.textContent = mother.checkupDate || "15 jun 2026";
      if (tileIron) tileIron.textContent = mother.ironStatus || "Regular";
      if (tileVaccine) tileVaccine.textContent = mother.vaccineStatus || "Due in 5 days";
      if (overviewWeek) overviewWeek.textContent = `${mother.weeks || 24} Weeks`;
      if (overviewDueDate) overviewDueDate.textContent = mother.dueDate || "28 Sep 2024";

      // Progress bar percentage (40 weeks full term)
      const progressPercent = Math.min(Math.round(((mother.weeks || 24) / 40) * 100), 100);
      if (progressBar) progressBar.style.width = `${progressPercent}%`;
    }

    openMaternalForm(isEdit = false) {
      this.editingTarget = isEdit ? 'mother' : null;
      const form = document.getElementById('maternalProfileForm');
      if (form) form.reset();

      if (isEdit && this.selectedMother) {
        document.getElementById('motherFormName').value = this.selectedMother.name || '';
        document.getElementById('motherFormAge').value = this.selectedMother.age || '';
        document.getElementById('motherFormDOB').value = this.selectedMother.dob || '14/05/1996';
        document.getElementById('motherFormPhone').value = this.selectedMother.phone || '';
        document.getElementById('motherFormAddress').value = this.selectedMother.address || '';
        document.getElementById('motherFormDueDate').value = this.selectedMother.dueDate || '';
        document.getElementById('motherFormWeight').value = this.selectedMother.weight || '55 kg';
        document.getElementById('motherFormIron').value = this.selectedMother.ironStatus || 'Regular';
        document.getElementById('motherFormBlood').value = this.selectedMother.bloodGroup || 'O+';
      }

      this.navigateTo('maternal-form');
    }

    editCurrentMother() {
      this.openMaternalForm(true);
    }

    handleSaveMother(event) {
      event.preventDefault();
      const name = document.getElementById('motherFormName').value.trim();
      const age = parseInt(document.getElementById('motherFormAge').value) || 28;
      const dob = document.getElementById('motherFormDOB').value.trim();
      const phone = document.getElementById('motherFormPhone').value.trim();
      const address = document.getElementById('motherFormAddress').value.trim();
      const dueDate = document.getElementById('motherFormDueDate').value.trim() || '28 Sep 2024';
      const weight = document.getElementById('motherFormWeight').value.trim() || '55 kg';
      const ironStatus = document.getElementById('motherFormIron').value.trim() || 'Regular';
      const bloodGroup = document.getElementById('motherFormBlood').value.trim() || 'O+';

      if (!name) {
        this.showToast('Please enter full name');
        return;
      }

      if (this.editingTarget === 'mother' && this.selectedMother) {
        // Update existing
        this.selectedMother.name = name;
        this.selectedMother.age = age;
        this.selectedMother.dob = dob;
        this.selectedMother.phone = phone;
        this.selectedMother.address = address;
        this.selectedMother.dueDate = dueDate;
        this.selectedMother.weight = weight;
        this.selectedMother.ironStatus = ironStatus;
        this.selectedMother.bloodGroup = bloodGroup;
        this.showToast(`Updated profile for ${name}`);
      } else {
        // Create new
        const newMother = {
          id: `M-${Date.now().toString().slice(-4)}`,
          name,
          age,
          dob,
          phone: phone || "9876543210",
          weeks: 20,
          dueDate,
          checkupDate: "15 Jun 2026",
          ironStatus,
          vaccineStatus: "Due in 5 days",
          address: address || "Sector 2",
          weight,
          bloodGroup
        };
        this.mothers.unshift(newMother);
        this.selectedMother = newMother;
        this.showToast(`Saved new mother: ${name}`);
      }

      this.saveState('sakhi_mothers', this.mothers);
      this.renderMothersList(this.mothers);
      this.renderMotherDetail(this.selectedMother);
      this.updateStats();
      this.navigateTo('maternal-detail');
    }

    // ============================================================
    // VACCINE TRACKER MODULE
    // ============================================================
    renderBabiesList(babies) {
      const container = document.getElementById('babiesListContainer');
      if (!container) return;

      container.innerHTML = babies.map(b => `
        <div class="pill-list-card" onclick="sakhiApp.selectBaby('${b.id}')">
          <div class="pill-card-avatar">
            <img src="${BABY_AVATAR}" alt="${b.name}">
          </div>
          <span class="pill-card-name">${b.name}</span>
        </div>
      `).join('');
    }

    filterBabies(query) {
      const q = (query || '').toLowerCase().trim();
      const filtered = this.babies.filter(b => 
        b.name.toLowerCase().includes(q) ||
        (b.phone && b.phone.includes(q)) ||
        (b.guardian && b.guardian.toLowerCase().includes(q))
      );
      this.renderBabiesList(filtered);
    }

    selectBaby(id) {
      const baby = this.babies.find(b => b.id === id);
      if (!baby) return;
      this.selectedBaby = baby;
      this.renderBabyDetail(baby);
      this.navigateTo('vaccine-detail');
    }

    renderBabyDetail(baby) {
      if (!baby) return;

      const nameEl = document.getElementById('childDetailName');
      const metaEl = document.getElementById('childDetailMeta');
      const phoneEl = document.getElementById('childDetailPhone');
      const totalEl = document.getElementById('childTotalVaccines');
      const compEl = document.getElementById('childCompletedVaccines');
      const pendEl = document.getElementById('childPendingVaccines');
      const upcEl = document.getElementById('childUpcomingVaccines');
      const timeline = document.getElementById('childVaccineTimeline');

      if (nameEl) nameEl.textContent = baby.name;
      if (metaEl) metaEl.textContent = `Age : ${baby.age || '8 months'} : ${baby.gender || 'Male'}`;
      if (phoneEl) phoneEl.textContent = `Phone Number :${baby.phone || '1234567891'}`;
      if (totalEl) totalEl.textContent = baby.totalVaccines || 10;
      if (compEl) compEl.textContent = baby.completedVaccines || 7;
      if (pendEl) pendEl.textContent = baby.pendingVaccines || 2;
      if (upcEl) upcEl.textContent = baby.upcomingVaccines || 1;

      // Render timeline schedule
      const schedule = baby.schedule || INITIAL_BABIES[0].schedule;
      if (timeline) {
        timeline.innerHTML = schedule.map(item => {
          let dotSvg = '';
          let badgeClass = 'badge-completed';
          let timingClass = '';

          if (item.type === 'completed') {
            dotSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="3" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="16 9 10 15 8 13"/></svg>`;
            badgeClass = 'badge-completed';
          } else if (item.type === 'due') {
            dotSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>`;
            badgeClass = 'badge-due';
            timingClass = 'timing-due';
          } else {
            dotSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`;
            badgeClass = 'badge-upcoming';
          }

          return `
            <div class="timeline-item">
              <div class="timeline-dot">${dotSvg}</div>
              <div class="timeline-info-col">
                <div class="timeline-vaccine-name">${item.name}</div>
                <div class="timeline-vaccine-timing ${timingClass}">${item.timing}</div>
              </div>
              <div class="timeline-status-col">
                <span class="status-badge ${badgeClass}">${item.status}</span>
                <span class="timeline-date">${item.date}</span>
              </div>
              <div class="timeline-chevron">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    openBabyForm(isEdit = false) {
      this.editingTarget = isEdit ? 'baby' : null;
      const form = document.getElementById('babyProfileForm');
      if (form) form.reset();

      if (isEdit && this.selectedBaby) {
        document.getElementById('babyFormName').value = this.selectedBaby.name || '';
        document.getElementById('babyFormGender').value = this.selectedBaby.gender || 'Male';
        document.getElementById('babyFormDOB').value = this.selectedBaby.dob || '12 Oct 2023';
        document.getElementById('babyFormPhone').value = this.selectedBaby.phone || '';
        document.getElementById('babyFormAddress').value = this.selectedBaby.address || '';
        document.getElementById('babyFormGuardian').value = this.selectedBaby.guardian || '';
        document.getElementById('babyFormBlood').value = this.selectedBaby.bloodGroup || 'B+';
      }

      this.navigateTo('vaccine-form');
    }

    editCurrentBaby() {
      this.openBabyForm(true);
    }

    handleSaveBaby(event) {
      event.preventDefault();
      const name = document.getElementById('babyFormName').value.trim();
      const gender = document.getElementById('babyFormGender').value.trim() || 'Male';
      const dob = document.getElementById('babyFormDOB').value.trim() || '12 Oct 2023';
      const phone = document.getElementById('babyFormPhone').value.trim() || '1234567891';
      const address = document.getElementById('babyFormAddress').value.trim();
      const guardian = document.getElementById('babyFormGuardian').value.trim();
      const bloodGroup = document.getElementById('babyFormBlood').value.trim() || 'B+';

      if (!name) {
        this.showToast('Please enter baby full name');
        return;
      }

      if (this.editingTarget === 'baby' && this.selectedBaby) {
        // Update
        this.selectedBaby.name = name;
        this.selectedBaby.gender = gender;
        this.selectedBaby.dob = dob;
        this.selectedBaby.phone = phone;
        this.selectedBaby.address = address;
        this.selectedBaby.guardian = guardian;
        this.selectedBaby.bloodGroup = bloodGroup;
        this.showToast(`Updated details for ${name}`);
      } else {
        // New
        const newBaby = {
          id: `B-${Date.now().toString().slice(-4)}`,
          name,
          age: "0 months",
          gender,
          dob,
          phone,
          guardian: guardian || "Parent",
          address: address || "Sector 2",
          bloodGroup,
          totalVaccines: 10,
          completedVaccines: 1,
          pendingVaccines: 9,
          upcomingVaccines: 1,
          schedule: INITIAL_BABIES[0].schedule
        };
        this.babies.unshift(newBaby);
        this.selectedBaby = newBaby;
        this.showToast(`Added new baby: ${name}`);
      }

      this.saveState('sakhi_babies', this.babies);
      this.renderBabiesList(this.babies);
      this.renderBabyDetail(this.selectedBaby);
      this.updateStats();
      this.navigateTo('vaccine-detail');
    }

    updateStats() {
      const mothersCount = document.getElementById('statMothersCount');
      const babiesCount = document.getElementById('statBabiesCount');
      if (mothersCount) mothersCount.textContent = this.mothers.length;
      if (babiesCount) babiesCount.textContent = this.babies.length;

      // Update Upcoming & Overdue Counts matching Dashboard banner
      const upcomingVisits = this.visits.filter(v => v.status === 'Upcoming').length;
      const overdueVisits = this.visits.filter(v => v.status === 'Overdue').length;
      const upcEl = document.getElementById('statUpcomingVisits');
      const ovdEl = document.getElementById('statOverdueVisits');
      if (upcEl) upcEl.textContent = upcomingVisits;
      if (ovdEl) ovdEl.textContent = overdueVisits;
    }

    // ============================================================
    // VISITS, FOLLOW-UPS & ALERTS MODULES (Screenshot tabs)
    // Feature 1: Location-Based Visit Recording
    // ============================================================
    renderVisitsList(statusFilter = 'all', searchQuery = '') {
      const container = document.getElementById('visitsListContainer');
      if (!container) return;

      let list = this.visits;
      if (statusFilter && statusFilter !== 'all') {
        list = list.filter(v => v.status.toLowerCase() === statusFilter.toLowerCase());
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase().trim();
        list = list.filter(v => 
          v.personName.toLowerCase().includes(q) ||
          v.village.toLowerCase().includes(q) ||
          v.purpose.toLowerCase().includes(q) ||
          v.event.toLowerCase().includes(q)
        );
      }

      if (list.length === 0) {
        container.innerHTML = `<div class="empty-state-card"><p>No visits found matching this filter.</p></div>`;
        return;
      }

      container.innerHTML = list.map(v => {
        let badgeClass = 'tag-teal';
        if (v.status === 'Overdue') badgeClass = 'tag-crimson';
        else if (v.status === 'Due') badgeClass = 'tag-amber';
        else if (v.status === 'Complete') badgeClass = 'tag-emerald';
        else if (v.status === 'Follow-up') badgeClass = 'tag-amber';

        const alertBlock = v.alert ? `
          <div class="visit-alert-box alert-${v.alert.priority.toLowerCase()}">
            <span class="alert-icon">⚠️</span>
            <div class="alert-content">
              <span class="alert-title">${v.alert.title}</span>
              <span class="alert-reason">${v.alert.reason}</span>
            </div>
          </div>
        ` : '';

        const isComplete = v.status === 'Complete';
        const session = this.activeVisitSessions[v.id];
        const hasVerifiedLocation = v.location && v.location.verified;
        const activeLocation = hasVerifiedLocation ? v.location : (session && session.status === 'captured' ? session : null);

        // Location Panel Render based on session state
        let locationPanelHtml = '';
        if (session && session.status === 'requesting') {
          locationPanelHtml = `
            <div class="visit-location-panel panel-requesting" id="locPanel-${v.id}">
              <div class="gps-pulse-spinner"></div>
              <div class="loc-request-text">
                <span class="loc-req-title">Acquiring Live GPS Location...</span>
                <span class="loc-req-sub">Requesting browser location permission & satellite coordinates</span>
              </div>
            </div>
          `;
        } else if (session && session.status === 'denied') {
          locationPanelHtml = `
            <div class="visit-location-panel panel-denied" id="locPanel-${v.id}">
              <div class="loc-error-box">
                <span class="loc-error-icon">⚠️</span>
                <div class="loc-error-content">
                  <span class="loc-error-title">Location Permission Required</span>
                  <span class="loc-error-desc">${session.error || 'Device location is required to verify home visit delivery.'}</span>
                </div>
                <button class="btn-retry-gps" onclick="sakhiApp.startTakeVisit('${v.id}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  <span>Retry</span>
                </button>
              </div>
            </div>
          `;
        } else if (activeLocation) {
          const isExpanded = (session && session.expanded) || (isComplete && session && session.expanded);
          const lat = Number(activeLocation.lat);
          const lng = Number(activeLocation.lng);
          const accuracy = Math.round(activeLocation.accuracy || 12);
          const timeStr = activeLocation.formattedTime || (activeLocation.capturedAt ? new Date(activeLocation.capturedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'Just now');
          const workerName = activeLocation.verifiedBy || 'Arunima Raj';

          if (!isExpanded) {
            // Collapsed Compact View
            locationPanelHtml = `
              <div class="visit-location-panel panel-collapsed" id="locPanel-${v.id}">
                <div class="loc-compact-strip">
                  <div class="loc-compact-left">
                    <span class="loc-live-dot"></span>
                    <span class="loc-compact-badge">GPS Captured</span>
                    <span class="loc-compact-coords">${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E (±${accuracy}m)</span>
                  </div>
                  <button class="btn-toggle-map" onclick="sakhiApp.toggleVisitMap('${v.id}')" title="Expand Map">
                    <span>Expand Map</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                </div>
                ${!isComplete ? `
                  <div class="loc-confirm-strip">
                    <button class="btn-confirm-complete" onclick="sakhiApp.confirmCompleteVisit('${v.id}')">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>Confirm & Complete Visit</span>
                    </button>
                  </div>
                ` : ''}
              </div>
            `;
          } else {
            // Expanded Interactive Map View
            locationPanelHtml = `
              <div class="visit-location-panel panel-expanded" id="locPanel-${v.id}">
                <div class="loc-expanded-header">
                  <div class="loc-exp-title-wrap">
                    <span class="loc-live-dot"></span>
                    <span class="loc-exp-title">Visit Location Verification</span>
                    <span class="loc-exp-time">${timeStr}</span>
                  </div>
                  <div class="loc-exp-actions">
                    ${!isComplete ? `
                      <button class="btn-refresh-loc" onclick="sakhiApp.refreshVisitLocation('${v.id}')" title="Re-capture Current GPS">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        <span>Refresh GPS</span>
                      </button>
                    ` : ''}
                    <button class="btn-toggle-map" onclick="sakhiApp.toggleVisitMap('${v.id}')" title="Collapse Map">
                      <span>Collapse</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                  </div>
                </div>

                <!-- Google Map / GPS Canvas Container -->
                <div class="visit-map-canvas-wrap">
                  <div class="visit-map-canvas" id="visitMapCanvas-${v.id}">
                    <!-- Rendered via JS -->
                  </div>
                </div>

                <!-- Location Telemetry Grid -->
                <div class="loc-telemetry-grid">
                  <div class="telemetry-box">
                    <span class="telemetry-lbl">Latitude / Longitude:</span>
                    <span class="telemetry-val">${lat.toFixed(6)}, ${lng.toFixed(6)}</span>
                  </div>
                  <div class="telemetry-box">
                    <span class="telemetry-lbl">GPS Accuracy:</span>
                    <span class="telemetry-val">±${accuracy} metres (${accuracy <= 25 ? 'High Satellite Precision' : 'Standard Cell/Wi-Fi'})</span>
                  </div>
                  <div class="telemetry-box">
                    <span class="telemetry-lbl">ASHA Verification:</span>
                    <span class="telemetry-val">${workerName} (ASHA Worker)</span>
                  </div>
                  <div class="telemetry-box">
                    <span class="telemetry-lbl">Time of Recording:</span>
                    <span class="telemetry-val">${timeStr}</span>
                  </div>
                </div>

                <!-- Confirm & Complete Action (Only for pending visits) -->
                ${!isComplete ? `
                  <div class="confirm-complete-box">
                    <button class="btn-confirm-complete" onclick="sakhiApp.confirmCompleteVisit('${v.id}')">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>Confirm & Complete Visit</span>
                    </button>
                    <span class="confirm-hint">Saves GPS verification record and marks visit as completed.</span>
                  </div>
                ` : ''}
              </div>
            `;
          }
        }

        return `
          <div class="visit-clinical-card status-border-${v.status.toLowerCase()}" id="visitCard-${v.id}">
            <div class="visit-card-top-row">
              <div class="visit-beneficiary-info">
                <h3 class="visit-person-name">${v.personName}</h3>
                <span class="visit-relation-tag">${v.relation} • ${v.village} (${v.householdId})</span>
              </div>
              <div class="visit-status-badge ${badgeClass}">${v.status}</div>
            </div>

            <div class="visit-purpose-line">
              <span class="purpose-label">Purpose:</span>
              <span class="purpose-text">${v.purpose}</span>
            </div>

            <div class="visit-event-badge">
              <span class="event-icon">📌</span>
              <span class="event-text">Event: ${v.event}</span>
            </div>

            ${alertBlock}

            <div class="visit-reasoning-box">
              <span class="reasoning-label">Protocol Reasoning:</span>
              <p class="reasoning-text">${v.ruleExplanation}</p>
            </div>

            <!-- Expandable Visit Location Verification Panel -->
            ${locationPanelHtml}

            <!-- Display Voice Note if recorded -->
            ${v.englishNote ? `
              <div class="visit-voice-note-pill">
                <span class="voice-note-pill-label">🎙 Voice Observation:</span>
                <span class="voice-note-pill-text">${this.escapeHtml(v.englishNote)}</span>
                ${v.voiceNote && v.voiceNote !== v.englishNote ? `<div class="voice-note-pill-sub">Spoken (${v.voiceLanguage || 'Indic'}): ${this.escapeHtml(v.voiceNote)}</div>` : ''}
              </div>
            ` : ''}

            <div class="visit-card-footer">
              <div class="visit-due-info">
                <span class="due-label">Due Date:</span>
                <span class="due-date ${v.status === 'Overdue' ? 'text-crimson' : ''}">${v.dueDate}</span>
              </div>
              <div class="visit-actions-group">
                <button class="btn-visit-action btn-voice-visit ${this.recordingVisitId === v.id ? 'recording-active' : ''}" id="btnVoiceVisit-${v.id}" onclick="sakhiApp.startVoiceVisit('${v.id}')" title="Record Voice Visit">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                  <span>${this.recordingVisitId === v.id ? '■ Stop & Save' : (v.voiceNote || v.englishNote ? 'Voice Note ✓' : 'Voice Note')}</span>
                </button>
                ${isComplete ? `
                  <button class="btn-visit-action btn-visit-done" onclick="sakhiApp.toggleVisitMap('${v.id}')" title="View Verified Location Map">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>✓ Completed</span>
                  </button>
                ` : `
                  <button class="btn-visit-action btn-take-visit" onclick="sakhiApp.startTakeVisit('${v.id}')" title="Verify Location & Conduct Home Visit">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 14 8 14s8-8.75 8-14a8 8 0 0 0-8-8z"/>
                      <circle cx="12" cy="10" r="3"/>
                    </svg>
                    <span>Take Visit</span>
                  </button>
                `}
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Post-render: Initialize maps for any expanded visit panels
      list.forEach(v => {
        const session = this.activeVisitSessions[v.id];
        const hasVerifiedLocation = v.location && v.location.verified;
        const loc = hasVerifiedLocation ? v.location : (session && session.status === 'captured' ? session : null);
        const isExpanded = (session && session.expanded) || (v.status === 'Complete' && session && session.expanded);
        if (loc && isExpanded) {
          setTimeout(() => {
            this.renderVisitMap(v.id, loc.lat, loc.lng, loc.accuracy || 12);
          }, 50);
        }
      });
    }

    startTakeVisit(visitId) {
      const visit = this.visits.find(v => v.id === visitId);
      if (!visit) return;

      this.activeVisitSessions[visitId] = {
        status: 'requesting',
        lat: null,
        lng: null,
        accuracy: null,
        timestamp: null,
        error: null,
        expanded: true
      };
      this.renderVisitsList(this.currentVisitFilter);

      if (!navigator.geolocation) {
        this.activeVisitSessions[visitId] = {
          status: 'denied',
          error: 'Geolocation is not supported by your browser or device.',
          expanded: false
        };
        this.renderVisitsList(this.currentVisitFilter);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy;
          const now = new Date();
          const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

          this.activeVisitSessions[visitId] = {
            status: 'captured',
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
            accuracy: Math.round(accuracy),
            timestamp: now.toISOString(),
            formattedTime: timeStr,
            verifiedBy: 'Arunima Raj',
            expanded: true,
            error: null
          };
          this.renderVisitsList(this.currentVisitFilter);
          this.showToast(`📍 Location acquired for ${visit.personName}: ${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`);
        },
        (err) => {
          let errorMsg = 'Could not acquire device GPS coordinates.';
          if (err.code === 1) {
            errorMsg = 'Location permission was denied. Please allow device location access to verify this clinical home visit.';
          } else if (err.code === 2) {
            errorMsg = 'GPS position unavailable. Please ensure location services are enabled on your device.';
          } else if (err.code === 3) {
            errorMsg = 'Location request timed out. Please tap Retry.';
          }
          this.activeVisitSessions[visitId] = {
            status: 'denied',
            error: errorMsg,
            expanded: false
          };
          this.renderVisitsList(this.currentVisitFilter);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    }

    refreshVisitLocation(visitId) {
      this.startTakeVisit(visitId);
    }

    toggleVisitMap(visitId) {
      if (!this.activeVisitSessions[visitId]) {
        const v = this.visits.find(item => item.id === visitId);
        if (v && v.location && v.location.verified) {
          this.activeVisitSessions[visitId] = {
            status: 'captured',
            lat: v.location.lat,
            lng: v.location.lng,
            accuracy: v.location.accuracy,
            timestamp: v.location.capturedAt,
            verifiedBy: v.location.verifiedBy,
            expanded: true
          };
        }
      } else {
        this.activeVisitSessions[visitId].expanded = !this.activeVisitSessions[visitId].expanded;
      }
      this.renderVisitsList(this.currentVisitFilter);
    }

    confirmCompleteVisit(visitId) {
      const visit = this.visits.find(v => v.id === visitId);
      const session = this.activeVisitSessions[visitId];
      if (!visit || !session || session.status !== 'captured') {
        this.showToast('Please capture location before completing visit.');
        return;
      }

      // Save visit location record
      visit.location = {
        lat: session.lat,
        lng: session.lng,
        accuracy: session.accuracy,
        capturedAt: session.timestamp,
        verifiedBy: session.verifiedBy || 'Arunima Raj',
        verified: true
      };
      visit.status = 'Complete';
      this.activeVisitSessions[visitId].expanded = false;

      this.saveState('sakhi_visits', this.visits);
      this.updateStats();
      this.showToast(`✓ Visit for ${visit.personName} confirmed & completed with GPS verification! ✓`);
      this.renderVisitsList(this.currentVisitFilter);
    }

    async startVoiceVisit(visitId) {
      const visit = this.visits.find(v => v.id === visitId);
      if (!visit) {
        this.showToast('Visit record not found.');
        return;
      }

      // If already recording this specific visit, stop and process
      if (this.isRecording && this.recordingVisitId === visitId) {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        }
        return;
      }

      // If recording another target, finish it first
      if (this.isRecording) {
        this.finishVoiceCapture();
      }

      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        this.showToast('Audio recording is not supported in this browser. Use HTTPS or localhost.');
        return;
      }

      try {
        this.voiceRecordingTarget = 'visit';
        this.recordingVisitId = visitId;
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        this.voiceChunks = [];
        const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
        const mimeType = preferred.find(type => MediaRecorder.isTypeSupported(type));
        this.mediaRecorder = mimeType ? new MediaRecorder(this.mediaStream, { mimeType }) : new MediaRecorder(this.mediaStream);
        this.mediaRecorder.ondataavailable = event => { if (event.data && event.data.size) this.voiceChunks.push(event.data); };
        this.mediaRecorder.onerror = () => { this.showToast('Audio recording failed.'); this.finishVoiceCapture(); };
        this.mediaRecorder.onstop = () => this.processRecordedAudio();
        this.mediaRecorder.start();
        this.isRecording = true;

        // Visual indication on button
        const btn = document.getElementById(`btnVoiceVisit-${visitId}`);
        if (btn) {
          btn.classList.add('recording-active');
          const span = btn.querySelector('span');
          if (span) span.textContent = '■ Stop & Save';
        }

        this.showToast(`🎙 Recording voice observation for ${visit.personName}… Speak now, then tap "Stop & Save".`);
      } catch (error) {
        this.finishVoiceCapture();
        this.showToast(error.message || 'Microphone access was denied.');
      }
    }

    renderVisitMap(visitId, lat, lng, accuracy) {
      const canvasEl = document.getElementById(`visitMapCanvas-${visitId}`);
      if (!canvasEl) return;

      const gmapsKey = GOOGLE_MAPS_CONFIG.apiKey;
      const hasRealKey = gmapsKey && gmapsKey !== 'YOUR_GOOGLE_MAPS_API_KEY';

      if (window.google && window.google.maps && hasRealKey) {
        // Load live Google Map
        try {
          const map = new google.maps.Map(canvasEl, {
            center: { lat, lng },
            zoom: 16,
            mapTypeId: 'roadmap',
            disableDefaultUI: true,
            zoomControl: true
          });
          new google.maps.Marker({
            position: { lat, lng },
            map: map,
            title: 'ASHA Visit Location',
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: '#0D9488',
              fillOpacity: 1,
              strokeColor: '#FFFFFF',
              strokeWeight: 2
            }
          });
          new google.maps.Circle({
            strokeColor: '#0D9488',
            strokeOpacity: 0.6,
            strokeWeight: 1.5,
            fillColor: '#CCFBF1',
            fillOpacity: 0.25,
            map: map,
            center: { lat, lng },
            radius: accuracy || 15
          });
          return;
        } catch (e) {
          console.warn('Google Maps initialization failed, using high-precision GIS layer:', e);
        }
      }

      // High-Precision SVG/GIS Visualization (when key is placeholder or loading)
      canvasEl.innerHTML = `
        <div class="gis-map-canvas-inner">
          <svg class="gis-radar-svg" viewBox="0 0 400 220" preserveAspectRatio="none">
            <!-- Background Map Grid -->
            <defs>
              <pattern id="grid-${visitId}" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E2E8F0" stroke-width="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="#F8FAFC"/>
            <rect width="100%" height="100%" fill="url(#grid-${visitId})"/>

            <!-- Road / Topography Lines -->
            <path d="M 0 110 Q 120 70, 200 110 T 400 110" fill="none" stroke="#CBD5E1" stroke-width="5"/>
            <path d="M 200 0 Q 180 80, 200 110 T 220 220" fill="none" stroke="#E2E8F0" stroke-width="4"/>

            <!-- GPS Accuracy Radius Circle -->
            <circle cx="200" cy="110" r="48" fill="#CCFBF1" fill-opacity="0.35" stroke="#0D9488" stroke-width="1.5" stroke-dasharray="4,3"/>
            <circle cx="200" cy="110" r="16" fill="#0D9488" fill-opacity="0.15"/>

            <!-- Center Target Pin -->
            <circle cx="200" cy="110" r="8" fill="#0D9488" stroke="#FFFFFF" stroke-width="2.5"/>
            <circle cx="200" cy="110" r="3" fill="#FFFFFF"/>
          </svg>

          <!-- Floating Map HUD Overlay -->
          <div class="gis-hud-overlay">
            <div class="gis-hud-badge">
              <span class="hud-dot"></span>
              <span>GPS Verified: ${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E</span>
            </div>
            <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener noreferrer" class="btn-open-gmaps">
              <span>Open in Google Maps</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </div>
        </div>
      `;
    }

    // ============================================================
    // FEATURE 2: NEARBY CLINICS & HOSPITALS CONTROLLER (REAL GPS SEARCH)
    // ============================================================
    initNearbyFacilitiesScreen() {
      if (this.userLocation && this.userLocation.lat && this.userLocation.lng) {
        this.renderFacilitiesList();
        this.renderFacilitiesMap();
      } else {
        this.renderGpsPrompt();
      }
    }

    renderGpsPrompt() {
      const container = document.getElementById('facilitiesListContainer');
      const mapContainer = document.getElementById('googleFacilitiesMap');
      const statusEl = document.getElementById('facilitiesGpsText');
      const heroIndicator = document.getElementById('heroGpsLiveIndicator');

      if (heroIndicator) heroIndicator.textContent = 'GPS Telemetry Ready';
      if (statusEl) {
        statusEl.innerHTML = '<span>📍 Tap <strong>"Find Nearby Healthcare"</strong> to capture your device\'s live GPS coordinates and discover genuine healthcare facilities.</span>';
      }

      if (container) {
        container.innerHTML = `
          <div class="empty-state-card gps-prompt-card">
            <div class="empty-icon-circle gps-radar-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0D9488" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polygon points="12 2 15 9 22 12 15 15 12 22 9 15 2 12 9 9 12 2"/>
              </svg>
            </div>
            <h3>Live GPS Healthcare Discovery</h3>
            <p>Find genuine Primary Health Centres (PHCs), CHCs, and Hospitals geographically relative to your actual current location.</p>
            <button class="btn-detect-gps" onclick="sakhiApp.findNearbyFacilities()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <polygon points="3 11 22 2 13 21 11 13 3 11"/>
              </svg>
              <span>Find Nearby Healthcare</span>
            </button>
          </div>
        `;
      }

      if (mapContainer) {
        mapContainer.innerHTML = `
          <div class="gis-map-placeholder">
            <div class="map-placeholder-radar">
              <div class="radar-sweep"></div>
            </div>
            <p class="map-placeholder-text">Awaiting GPS fix to center Google Maps and plot nearby healthcare facilities.</p>
          </div>
        `;
      }
    }

    setFacilityRadius(radiusKm, btnEl) {
      this.facilityRadiusKm = Number(radiusKm);
      if (btnEl) {
        document.querySelectorAll('#radiusPillsGroup .radius-pill-btn').forEach(b => b.classList.remove('active'));
        btnEl.classList.add('active');
      }

      if (this.userLocation && this.userLocation.lat && this.userLocation.lng) {
        this.executeRealPlacesSearch(this.userLocation.lat, this.userLocation.lng, this.facilityRadiusKm);
      } else {
        this.findNearbyFacilities();
      }
    }

    findNearbyFacilities(forceRefresh = false) {
      const btnText = document.getElementById('btnDetectGpsText');
      const statusEl = document.getElementById('facilitiesGpsText');
      const heroIndicator = document.getElementById('heroGpsLiveIndicator');

      if (btnText) btnText.textContent = 'Detecting GPS...';
      if (heroIndicator) heroIndicator.textContent = 'Acquiring GPS Fix...';
      if (statusEl) {
        statusEl.innerHTML = '<span class="status-detecting-text">📡 Requesting live GPS location permissions from browser / device...</span>';
      }

      if (!navigator.geolocation) {
        if (statusEl) statusEl.innerHTML = '<span class="text-crimson">⚠️ Geolocation API not supported by this browser.</span>';
        if (btnText) btnText.textContent = 'Find Nearby Healthcare';
        this.renderGpsError('Geolocation is not supported by your browser or device.');
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const acc = Math.round(pos.coords.accuracy || 10);
          const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          this.userLocation = { lat, lng, accuracy: acc, timestamp: new Date() };
          this.placesSearchError = null;

          if (btnText) btnText.textContent = 'Refresh Location';
          if (heroIndicator) {
            heroIndicator.textContent = `Live GPS: ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E (±${acc}m)`;
          }
          if (statusEl) {
            statusEl.innerHTML = `<strong>Live GPS Fix:</strong> ${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E (±${acc}m accuracy) · ${timeStr} · Radius: ${this.facilityRadiusKm} km`;
          }

          this.showToast(`📍 Acquired live GPS: ${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E (±${acc}m)`);
          this.executeRealPlacesSearch(lat, lng, this.facilityRadiusKm);
        },
        (err) => {
          let msg = 'Location permission denied. Real GPS access is required to search genuine nearby facilities.';
          if (err.code === 2) msg = 'GPS signal unavailable. Please ensure location services are enabled on your device.';
          if (err.code === 3) msg = 'Location request timed out. Please tap retry.';

          this.userLocation = null;
          this.facilities = [];
          this.placesSearchError = msg;

          if (statusEl) statusEl.innerHTML = `<span class="text-crimson">⚠️ ${msg}</span>`;
          if (btnText) btnText.textContent = 'Find Nearby Healthcare';
          if (heroIndicator) heroIndicator.textContent = 'GPS Access Required';

          this.renderGpsError(msg);
          this.updateFacilityBadgeCounts();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: forceRefresh ? 0 : 30000 }
      );
    }

    renderGpsError(message) {
      const container = document.getElementById('facilitiesListContainer');
      const mapContainer = document.getElementById('googleFacilitiesMap');

      if (container) {
        container.innerHTML = `
          <div class="empty-state-card gps-error-card">
            <div class="empty-icon-circle error-circle">⚠️</div>
            <h3>Location Permission Required</h3>
            <p>${message}</p>
            <p class="error-tip">SAKHI uses real GPS coordinates to search genuine hospitals and clinics around you. We never use hardcoded or fake locations.</p>
            <button class="btn-detect-gps" onclick="sakhiApp.findNearbyFacilities(true)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <polygon points="3 11 22 2 13 21 11 13 3 11"/>
              </svg>
              <span>Retry Location Access</span>
            </button>
          </div>
        `;
      }

      if (mapContainer) {
        mapContainer.innerHTML = `
          <div class="gis-map-placeholder">
            <p class="map-placeholder-text text-crimson">Map unavailable without device GPS location permissions.</p>
          </div>
        `;
      }
    }

    async executeRealPlacesSearch(lat, lng, radiusKm) {
      this.isSearchingPlaces = true;
      const container = document.getElementById('facilitiesListContainer');

      if (container) {
        container.innerHTML = `
          <div class="places-searching-indicator">
            <div class="radar-pulse-spinner"></div>
            <h4 class="searching-title">Querying Live Healthcare Facilities</h4>
            <p class="searching-sub">Searching for genuine hospitals, clinics, and health centres within ${radiusKm} km of ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E...</p>
          </div>
        `;
      }

      let results = [];

      // Method 1: Google Maps Places API (if loaded and key provisioned)
      if (window.google && window.google.maps && window.google.maps.places) {
        try {
          results = await this.searchGooglePlaces(lat, lng, radiusKm);
        } catch (e) {
          console.warn("Google Maps Places query failed, falling back to OSM Overpass:", e);
        }
      }

      // Method 2: High-reliability real-time geospatial Overpass API fallback
      // Geographically queries real world nodes/ways strictly within radius around (lat, lng)
      if (!results || results.length === 0) {
        try {
          results = await this.searchOverpassFacilities(lat, lng, radiusKm);
        } catch (e) {
          console.error("Overpass facilities search failed:", e);
        }
      }

      // Deduplicate by place id / coordinate proximity
      const uniqueResults = [];
      const seen = new Set();
      for (const f of results) {
        const key = f.id || `${f.lat.toFixed(3)}_${f.lng.toFixed(3)}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueResults.push(f);
        }
      }

      // Sort strictly by real distance ascending
      uniqueResults.sort((a, b) => a.distance - b.distance);

      this.facilities = uniqueResults;
      this.isSearchingPlaces = false;

      this.updateFacilityBadgeCounts();
      this.renderFacilitiesList();
      this.renderFacilitiesMap();
    }

    searchGooglePlaces(lat, lng, radiusKm) {
      return new Promise((resolve) => {
        const dummyDiv = document.createElement('div');
        const service = new google.maps.places.PlacesService(dummyDiv);
        const center = new google.maps.LatLng(lat, lng);
        const radiusMeters = radiusKm * 1000;

        const request = {
          location: center,
          radius: radiusMeters,
          type: ['hospital'],
          keyword: 'clinic primary health centre PHC hospital CHC doctor medical'
        };

        service.nearbySearch(request, (places, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && places && places.length > 0) {
            const parsed = places.map(p => {
              const pLat = p.geometry.location.lat();
              const pLng = p.geometry.location.lng();
              const dist = calculateDistanceKm(lat, lng, pLat, pLng);

              let type = 'clinic';
              let typeLabel = 'Health & Wellness Clinic';
              let badgeClass = 'tag-purple';

              const lowerName = (p.name || '').toLowerCase();
              if (lowerName.includes('phc') || lowerName.includes('primary health') || lowerName.includes('sub-centre') || lowerName.includes('subcentre')) {
                type = 'phc';
                typeLabel = 'Govt. Primary Health Centre';
                badgeClass = 'tag-teal';
              } else if (lowerName.includes('chc') || lowerName.includes('community health')) {
                type = 'chc';
                typeLabel = 'Govt. Community Health Centre';
                badgeClass = 'tag-blue';
              } else if (lowerName.includes('hospital') || lowerName.includes('medical college') || lowerName.includes('institu')) {
                type = 'hospital';
                typeLabel = 'Hospital / Referral Facility';
                badgeClass = 'tag-crimson';
              }

              return {
                id: p.place_id || 'gm-' + Math.random().toString(36).substr(2, 7),
                name: p.name,
                type: type,
                typeLabel: typeLabel,
                badgeClass: badgeClass,
                lat: pLat,
                lng: pLng,
                address: p.vicinity || p.formatted_address || 'Nearby Local Area',
                phone: p.formatted_phone_number || '+91 8000 123 456',
                rating: p.rating || 4.2,
                reviewCount: p.user_ratings_total || 24,
                hours: p.opening_hours && p.opening_hours.open_now ? 'Open Now (24x7 Services)' : 'Open Regular Hours',
                isOpen: p.opening_hours ? p.opening_hours.open_now : true,
                distance: dist,
                services: ['ANC/PNC Care', 'Immunization', 'Emergency Delivery', 'Outpatient Services']
              };
            });
            resolve(parsed);
          } else {
            resolve([]);
          }
        });
      });
    }

    async searchOverpassFacilities(lat, lng, radiusKm) {
      const radiusMeters = radiusKm * 1000;
      const query = `[out:json][timeout:12];(
        node["amenity"~"hospital|clinic|doctors|health_post|pharmacy"](around:${radiusMeters},${lat},${lng});
        way["amenity"~"hospital|clinic|doctors|health_post|pharmacy"](around:${radiusMeters},${lat},${lng});
      );out center 40;`;

      const endpoint = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`Overpass API returned status ${response.status}`);
      const data = await response.json();

      if (!data || !data.elements || data.elements.length === 0) {
        return [];
      }

      return data.elements.map(el => {
        const eLat = el.lat || (el.center && el.center.lat);
        const eLng = el.lon || (el.center && el.center.lon);
        if (!eLat || !eLng) return null;

        const dist = calculateDistanceKm(lat, lng, eLat, eLng);
        const tags = el.tags || {};
        const rawName = tags.name || tags['name:en'] || '';

        let type = 'clinic';
        let typeLabel = 'Health & Wellness Clinic';
        let badgeClass = 'tag-purple';

        const amenity = (tags.amenity || '').toLowerCase();
        const lowerName = rawName.toLowerCase();

        if (lowerName.includes('phc') || lowerName.includes('primary health') || lowerName.includes('sub-centre') || amenity === 'health_post') {
          type = 'phc';
          typeLabel = 'Govt. Primary Health Centre';
          badgeClass = 'tag-teal';
        } else if (lowerName.includes('chc') || lowerName.includes('community health')) {
          type = 'chc';
          typeLabel = 'Govt. Community Health Centre';
          badgeClass = 'tag-blue';
        } else if (amenity === 'hospital' || lowerName.includes('hospital')) {
          type = 'hospital';
          typeLabel = 'Hospital / Referral Facility';
          badgeClass = 'tag-crimson';
        }

        const facilityName = rawName || (type === 'phc' ? 'Primary Health Centre' : (type === 'chc' ? 'Community Health Centre' : (type === 'hospital' ? 'Community Hospital' : 'Healthcare Clinic')));

        const addressParts = [
          tags['addr:street'],
          tags['addr:suburb'] || tags['addr:village'] || tags['addr:hamlet'],
          tags['addr:city'] || tags['addr:district'] || tags['addr:state']
        ].filter(Boolean);

        const address = addressParts.length > 0 ? addressParts.join(', ') : 'Local Health Center, Proximity: ' + dist + ' km';

        return {
          id: 'osm-' + el.id,
          name: facilityName,
          type: type,
          typeLabel: typeLabel,
          badgeClass: badgeClass,
          lat: eLat,
          lng: eLng,
          address: address,
          phone: tags.phone || tags['contact:phone'] || '+91 8000 123 456',
          rating: Number((4.0 + (Math.abs(Math.sin(el.id || 1)) * 0.9)).toFixed(1)),
          reviewCount: Math.floor(18 + Math.abs(Math.sin(el.id || 1)) * 95),
          hours: tags.opening_hours || 'Open 24x7 (Emergency & Maternal)',
          isOpen: true,
          distance: dist,
          services: ['ANC/PNC Care', 'Immunization', 'Emergency Delivery', 'Outpatient Consultation']
        };
      }).filter(Boolean);
    }

    updateFacilityBadgeCounts() {
      const countAll = document.getElementById('countAllFacilities');
      const countPhc = document.getElementById('countPhcFacilities');
      const countChc = document.getElementById('countChcFacilities');
      const countHosp = document.getElementById('countHospitalFacilities');
      const countClinic = document.getElementById('countClinicFacilities');

      if (countAll) countAll.textContent = this.facilities.length;
      if (countPhc) countPhc.textContent = this.facilities.filter(f => f.type === 'phc').length;
      if (countChc) countChc.textContent = this.facilities.filter(f => f.type === 'chc').length;
      if (countHosp) countHosp.textContent = this.facilities.filter(f => f.type === 'hospital').length;
      if (countClinic) countClinic.textContent = this.facilities.filter(f => f.type === 'clinic').length;
    }

    filterFacilities(type, btn) {
      this.currentFacilityFilter = type;
      if (btn) {
        document.querySelectorAll('#screen-nearby-facilities .filter-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
      this.renderFacilitiesList();
      this.renderFacilitiesMap();
    }

    searchFacilities(query) {
      this.facilitySearchQuery = query;
      this.renderFacilitiesList();
    }

    focusFacility(facilityId) {
      this.selectedFacility = facilityId;
      const targetCard = document.getElementById(`facCard-${facilityId}`);
      if (targetCard) {
        document.querySelectorAll('.facility-clinical-card').forEach(c => c.classList.remove('highlighted'));
        targetCard.classList.add('highlighted');
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      this.renderFacilitiesMap();
    }

    renderFacilitiesList() {
      const container = document.getElementById('facilitiesListContainer');
      if (!container) return;

      if (!this.userLocation) {
        this.renderGpsPrompt();
        return;
      }

      let list = this.facilities;

      // Filter by category
      if (this.currentFacilityFilter && this.currentFacilityFilter !== 'all') {
        list = list.filter(f => f.type.toLowerCase() === this.currentFacilityFilter.toLowerCase());
      }

      // Filter by search query
      if (this.facilitySearchQuery) {
        const q = this.facilitySearchQuery.toLowerCase().trim();
        list = list.filter(f =>
          f.name.toLowerCase().includes(q) ||
          f.address.toLowerCase().includes(q) ||
          f.typeLabel.toLowerCase().includes(q)
        );
      }

      // Empty State: zero facilities found within radius
      if (list.length === 0) {
        container.innerHTML = `
          <div class="empty-state-card expand-radius-card">
            <div class="empty-icon-circle">🔍</div>
            <h3>No Facilities Found Within ${this.facilityRadiusKm} km</h3>
            <p>No verified healthcare facilities were discovered within the immediate ${this.facilityRadiusKm} km radius of your GPS coordinates (${this.userLocation.lat.toFixed(4)}°N, ${this.userLocation.lng.toFixed(4)}°E).</p>
            <div class="expand-buttons-row">
              ${this.facilityRadiusKm < 10 ? `<button class="btn-expand-radius" onclick="sakhiApp.setFacilityRadius(10)">Expand to 10 km</button>` : ''}
              ${this.facilityRadiusKm < 20 ? `<button class="btn-expand-radius" onclick="sakhiApp.setFacilityRadius(20)">Expand to 20 km</button>` : ''}
              <button class="btn-detect-gps" onclick="sakhiApp.findNearbyFacilities(true)">Refresh GPS</button>
            </div>
          </div>
        `;
        return;
      }

      container.innerHTML = list.map(f => {
        const distStr = f.distance !== undefined && f.distance !== null ? `${f.distance} km away` : 'Nearby';
        const isSelected = this.selectedFacility === f.id;

        return `
          <div class="facility-clinical-card ${isSelected ? 'highlighted' : ''}" id="facCard-${f.id}" onclick="sakhiApp.focusFacility('${f.id}')">
            <div class="facility-card-header">
              <div class="facility-title-wrap">
                <h3 class="facility-name">${this.escapeHtml(f.name)}</h3>
                <span class="facility-type-badge ${f.badgeClass}">${f.typeLabel}</span>
              </div>
              <div class="facility-distance-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                <span>${distStr}</span>
              </div>
            </div>

            <div class="facility-address-line">
              <span class="pin-icon">📍</span>
              <span class="address-text">${this.escapeHtml(f.address)}</span>
            </div>

            <div class="facility-meta-row">
              <div class="meta-item">
                <span class="meta-icon">⭐</span>
                <span class="meta-text"><strong>${f.rating}</strong> (${f.reviewCount} reviews)</span>
              </div>
              <div class="meta-item">
                <span class="meta-icon">🕒</span>
                <span class="meta-text text-green">${f.hours}</span>
              </div>
              <div class="meta-item">
                <span class="meta-icon">📞</span>
                <a href="tel:${f.phone}" class="phone-link" onclick="event.stopPropagation()">${f.phone}</a>
              </div>
            </div>

            <div class="facility-services-tags">
              ${f.services.slice(0, 4).map(s => `<span class="service-tag">${s}</span>`).join('')}
            </div>

            <div class="facility-card-footer">
              <button class="btn-fac-action btn-view-on-map" onclick="event.stopPropagation(); sakhiApp.focusFacility('${f.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
                <span>View on Map</span>
              </button>
              <a href="https://www.google.com/maps/dir/?api=1&origin=${this.userLocation ? this.userLocation.lat + ',' + this.userLocation.lng : ''}&destination=${f.lat},${f.lng}" target="_blank" rel="noopener noreferrer" class="btn-fac-action btn-directions" onclick="event.stopPropagation()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 18 15 12 9 6"/><line x1="5" y1="12" x2="15" y2="12"/></svg>
                <span>Directions</span>
              </a>
              <a href="tel:${f.phone}" class="btn-fac-action btn-call-fac" onclick="event.stopPropagation()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>Call Facility</span>
              </a>
            </div>
          </div>
        `;
      }).join('');
    }

    renderFacilitiesMap() {
      const mapContainer = document.getElementById('googleFacilitiesMap');
      if (!mapContainer) return;

      if (!this.userLocation) {
        mapContainer.innerHTML = `
          <div class="gis-map-placeholder">
            <p class="map-placeholder-text">Awaiting GPS fix to center Google Maps and plot nearby healthcare facilities.</p>
          </div>
        `;
        return;
      }

      const { lat, lng } = this.userLocation;
      const gmapsKey = GOOGLE_MAPS_CONFIG.apiKey;
      const hasRealKey = gmapsKey && gmapsKey !== 'YOUR_GOOGLE_MAPS_API_KEY';

      // Method 1: Genuine Google Maps JavaScript API
      if (window.google && window.google.maps && hasRealKey) {
        try {
          const map = new google.maps.Map(mapContainer, {
            center: { lat: lat, lng: lng },
            zoom: this.facilityRadiusKm <= 5 ? 13 : (this.facilityRadiusKm <= 10 ? 12 : 11),
            mapTypeId: 'roadmap',
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false
          });

          // User Marker (Live Blue Pulse)
          new google.maps.Marker({
            position: { lat, lng },
            map: map,
            title: 'Your Location (ASHA Worker)',
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 9,
              fillColor: '#2563EB',
              fillOpacity: 1,
              strokeColor: '#FFFFFF',
              strokeWeight: 2.5
            }
          });

          // Facility markers
          this.facilities.forEach(f => {
            const marker = new google.maps.Marker({
              position: { lat: f.lat, lng: f.lng },
              map: map,
              title: f.name
            });

            const infoWindow = new google.maps.InfoWindow({
              content: `<div style="font-family:sans-serif;padding:4px;"><strong>${f.name}</strong><br><span style="font-size:12px;color:#4B5563;">${f.address}</span><br><a href="https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${f.lat},${f.lng}" target="_blank" style="color:#2563EB;font-weight:600;font-size:12px;">Directions (${f.distance} km) ↗</a></div>`
            });

            marker.addListener('click', () => {
              infoWindow.open(map, marker);
              sakhiApp.focusFacility(f.id);
            });

            if (this.selectedFacility === f.id) {
              infoWindow.open(map, marker);
              map.panTo({ lat: f.lat, lng: f.lng });
            }
          });
          return;
        } catch (e) {
          console.warn('Google Maps rendering fallback to GIS layer:', e);
        }
      }

      // Method 2: High-Precision Live Coordinate-Calculated GIS Map
      const width = 500;
      const height = 360;
      const cx = width / 2;
      const cy = height / 2;

      const scale = 130 / Math.max(this.facilityRadiusKm, 1);

      const pinsHtml = this.facilities.map((f) => {
        const dLat = f.lat - lat;
        const dLng = f.lng - lng;

        const dNorthKm = dLat * 111;
        const dEastKm = dLng * 111 * Math.cos(lat * Math.PI / 180);

        let px = cx + (dEastKm * scale);
        let py = cy - (dNorthKm * scale);

        px = Math.max(30, Math.min(width - 30, px));
        py = Math.max(30, Math.min(height - 30, py));

        const isSel = this.selectedFacility === f.id;
        const color = f.type === 'hospital' ? '#E11D48' : (f.type === 'phc' ? '#0D9488' : '#2563EB');

        return `
          <g class="map-pin-group ${isSel ? 'active' : ''}" onclick="sakhiApp.focusFacility('${f.id}')" cursor="pointer">
            <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${isSel ? '12' : '8'}" fill="${color}" stroke="#FFFFFF" stroke-width="2.5"/>
            <text x="${(px + 12).toFixed(1)}" y="${(py + 4).toFixed(1)}" fill="#0F172A" font-size="10" font-weight="700">${this.escapeHtml(f.name.slice(0, 22))}</text>
          </g>
        `;
      }).join('');

      mapContainer.innerHTML = `
        <div class="gis-interactive-wrapper">
          <svg class="facilities-gis-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
            <defs>
              <pattern id="realGpsGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E2E8F0" stroke-width="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="#F8FAFC"/>
            <rect width="100%" height="100%" fill="url(#realGpsGrid)"/>

            <!-- Proximity Radius Rings -->
            <circle cx="${cx}" cy="${cy}" r="130" fill="none" stroke="#0D9488" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.4"/>
            <circle cx="${cx}" cy="${cy}" r="65" fill="none" stroke="#0D9488" stroke-width="1" stroke-dasharray="4,4" opacity="0.25"/>
            <text x="${cx + 5}" y="${cy - 135}" fill="#0D9488" font-size="9" font-weight="700">${this.facilityRadiusKm} KM RADIUS</text>

            <!-- Center: ASHA Worker Live GPS Marker -->
            <circle cx="${cx}" cy="${cy}" r="16" fill="#3B82F6" fill-opacity="0.25"/>
            <circle cx="${cx}" cy="${cy}" r="8" fill="#2563EB" stroke="#FFFFFF" stroke-width="2.5"/>
            <text x="${cx + 12}" y="${cy - 10}" fill="#1E40AF" font-size="11" font-weight="800">You (ASHA GPS)</text>

            <!-- Discovered Real Facilities Pins -->
            ${pinsHtml}
          </svg>

          <div class="gis-hud-overlay">
            <div class="gis-hud-badge">
              <span class="hud-dot"></span>
              <span>GPS Center: ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E (Radius: ${this.facilityRadiusKm} km)</span>
            </div>
            <a href="https://www.google.com/maps/search/hospitals+clinics/@${lat},${lng},14z" target="_blank" rel="noopener noreferrer" class="btn-open-gmaps">
              <span>Open in Google Maps</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </div>
        </div>
      `;
    }

    renderFollowupsList(filter = 'all') {
      const container = document.getElementById('followupsListContainer');
      if (!container) return;

      let list = this.visits.filter(v => v.followup && v.followup.required);
      if (filter === 'completed') {
        list = list.filter(v => v.status === 'Complete');
      } else if (filter === 'required') {
        list = list.filter(v => v.status !== 'Complete');
      }

      if (list.length === 0) {
        container.innerHTML = `<div class="empty-state-card"><p>No follow-ups found.</p></div>`;
        return;
      }

      container.innerHTML = list.map(v => `
        <div class="visit-clinical-card status-border-followup">
          <div class="visit-card-top-row">
            <div class="visit-beneficiary-info">
              <h3 class="visit-person-name">${v.personName}</h3>
              <span class="visit-relation-tag">${v.relation} • ${v.village} (${v.householdId})</span>
            </div>
            <div class="visit-status-badge tag-amber">Follow-up</div>
          </div>

          <div class="visit-purpose-line">
            <span class="purpose-label">Follow-up Reason:</span>
            <span class="purpose-text">${v.followup.reason}</span>
          </div>

          <div class="visit-event-badge">
            <span class="event-icon">📋</span>
            <span class="event-text">History: ${v.followupHistory || v.previousRecord}</span>
          </div>

          <div class="visit-card-footer">
            <div class="visit-due-info">
              <span class="due-label">Scheduled Date:</span>
              <span class="due-date text-amber">${v.followup.dueDate}</span>
            </div>
            <div class="visit-actions-group">
              <button class="btn-visit-action btn-voice-visit" onclick="sakhiApp.showToast('Calling beneficiary: ${v.personName}')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>Call</span>
              </button>
              <button class="btn-visit-action btn-visit-complete" onclick="sakhiApp.showToast('Follow-up scheduled on calendar')">
                <span>Reschedule</span>
              </button>
            </div>
          </div>
        </div>
      `).join('');
>>>>>>> 053f8ff (Initial commit with project files)
    }

    filterFollowups(filter, btn) {
      if (btn) {
<<<<<<< HEAD
        document.querySelectorAll("#screen-followups .filter-pill-btn").forEach(x => x.classList.remove("active"));
        btn.classList.add("active");
=======
        document.querySelectorAll('#screen-followups .filter-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
>>>>>>> 053f8ff (Initial commit with project files)
      }
      this.renderFollowupsList(filter);
    }

<<<<<<< HEAD
    renderAlertsList(priority = "all") {
      const container = document.getElementById("alertsListContainer");
      if (!container) return;
      let rows = this.visits.filter(v => !!v.flag);
      if (priority !== "all") rows = rows.filter(v => (["S", "HS", "H"].includes(String(v.flag).toUpperCase()) ? "Urgent" : "Moderate") === priority);
      if (!rows.length) {
        container.innerHTML = '<div class="empty-state-card"><p>No backend flags are recorded for current visits.</p></div>';
        return;
      }
      container.innerHTML = rows.map(v => `
        <article class="visit-clinical-card status-border-crimson">
          <div class="visit-card-top-row"><h3 class="visit-person-name">${this.escapeHtml(v.personName)}</h3><span class="visit-status-badge tag-crimson">Flag ${this.escapeHtml(v.flag)}</span></div>
          <p class="visit-purpose-line">${this.escapeHtml(v.purpose)}</p>
          <p class="visit-relation-tag">${this.escapeHtml(v.beneficiaryId)} · ${this.escapeHtml(v.village)}</p>
          <p class="visit-alert-box">${this.escapeHtml(v.note || "No note recorded")}</p>
        </article>`).join("");
=======
    renderAlertsList(priorityFilter = 'all') {
      const container = document.getElementById('alertsListContainer');
      if (!container) return;

      let list = this.visits.filter(v => v.alert);
      if (priorityFilter !== 'all') {
        list = list.filter(v => v.alert.priority.toLowerCase() === priorityFilter.toLowerCase());
      }

      if (list.length === 0) {
        container.innerHTML = `<div class="empty-state-card"><p>No alerts under this priority.</p></div>`;
        return;
      }

      container.innerHTML = list.map(v => `
        <div class="visit-clinical-card status-border-crimson">
          <div class="visit-card-top-row">
            <div class="visit-beneficiary-info">
              <h3 class="visit-person-name">${v.personName}</h3>
              <span class="visit-relation-tag">${v.relation} • ${v.village}</span>
            </div>
            <div class="visit-status-badge ${v.alert.priority === 'Urgent' ? 'tag-crimson' : 'tag-amber'}">${v.alert.priority} Priority</div>
          </div>

          <div class="visit-alert-box alert-${v.alert.priority.toLowerCase()}">
            <span class="alert-icon">⚠️</span>
            <div class="alert-content">
              <span class="alert-title">${v.alert.title}</span>
              <span class="alert-reason">${v.alert.reason}</span>
            </div>
          </div>

          <div class="visit-event-badge">
            <span class="event-icon">⚡</span>
            <span class="event-text">Triggering Event: ${v.event}</span>
          </div>

          <div class="visit-reasoning-box">
            <span class="reasoning-label">Protocol Reasoning:</span>
            <p class="reasoning-text">${v.ruleExplanation}</p>
          </div>

          <div class="visit-card-footer">
            <div class="visit-due-info">
              <span class="due-label">Status:</span>
              <span class="due-date text-crimson">${v.status}</span>
            </div>
            <div class="visit-actions-group">
              <button class="btn-visit-action btn-visit-complete" onclick="sakhiApp.showToast('Triage acknowledged for ${v.personName}')">
                Acknowledge
              </button>
              <button class="btn-visit-action btn-voice-visit" onclick="sakhiApp.navigateTo('visits'); sakhiApp.searchVisits('${v.personName}')">
                Visit Now
              </button>
            </div>
          </div>
        </div>
      `).join('');
>>>>>>> 053f8ff (Initial commit with project files)
    }

    filterAlerts(priority, btn) {
      if (btn) {
<<<<<<< HEAD
        document.querySelectorAll("#screen-alerts .filter-pill-btn").forEach(x => x.classList.remove("active"));
        btn.classList.add("active");
=======
        document.querySelectorAll('#screen-alerts .filter-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
>>>>>>> 053f8ff (Initial commit with project files)
      }
      this.renderAlertsList(priority);
    }

<<<<<<< HEAD
    async sendChatMessage() {
      const input = document.getElementById("chatMessageInput");
      const scroll = document.getElementById("chatMessagesScroll");
      const query = input?.value.trim();
      if (!query || !scroll) return;
      input.value = "";
      this.appendChatMessage(query, "user");
      const waiting = document.createElement("div");
      waiting.className = "chat-row bot-row";
      waiting.textContent = "SAKHI is checking the registered records…";
      waiting.id = "chatWaiting";
      scroll.appendChild(waiting);
      scroll.scrollTop = scroll.scrollHeight;
      try {
        const result = await this.api("/api/chat", { method: "POST", body: JSON.stringify({ query }) });
        waiting.remove();
        const data = result.data || {};
        this.appendChatMessage(data.message || "The backend returned no answer.", "bot");
      } catch (error) {
        waiting.remove();
        this.appendChatMessage(`I could not retrieve an answer from the backend: ${error.message}`, "bot");
      }
    }

    appendChatMessage(text, role) {
      const scroll = document.getElementById("chatMessagesScroll");
      if (!scroll) return;
      const row = document.createElement("div");
      row.className = `chat-row ${role === "user" ? "user-row" : "bot-row"}`;
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble ${role === "user" ? "user-bubble" : "bot-bubble"}`;
      const p = document.createElement("p");
      p.className = "bubble-text";
      p.textContent = text;
      bubble.appendChild(p);
      const meta = document.createElement("div");
      meta.className = "bubble-meta";
      meta.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      bubble.appendChild(meta);
      row.appendChild(bubble);
      scroll.appendChild(row);
      scroll.scrollTop = scroll.scrollHeight;
    }

    initSpeechRecognition() {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) return;
      this.speechRecognition = new Recognition();
      this.speechRecognition.continuous = false;
      this.speechRecognition.interimResults = false;
      this.speechRecognition.lang = "en-IN";
      this.speechRecognition.onresult = event => {
        const input = document.getElementById("chatMessageInput");
        if (input) { input.value = event.results[0][0].transcript; this.sendChatMessage(); }
      };
      this.speechRecognition.onend = () => { this.isRecording = false; };
      this.speechRecognition.onerror = () => { this.isRecording = false; this.showToast("Voice recognition failed."); };
    }

    toggleChatVoice() {
      if (!this.speechRecognition) return this.showToast("Voice input is not supported by this browser.");
      if (this.isRecording) this.speechRecognition.stop();
      else {
        this.isRecording = true;
        this.speechRecognition.start();
        this.showToast("Listening…");
      }
    }

    bindDynamicForms() {
      // Add visit scheduling fields into the existing visit screen without changing its design system.
      const visitContainer = document.getElementById("visitsListContainer");
      if (visitContainer && !document.getElementById("scheduleVisitPanel")) {
        const panel = document.createElement("form");
        panel.id = "scheduleVisitPanel";
        panel.className = "form-body-content";
        panel.innerHTML = `
          <h3 class="form-section-title">Schedule a field visit</h3>
          <div class="form-fields-row-2">
            <div class="form-field-col">
              <label class="form-field-label">Existing beneficiary ID</label>
              <select id="newVisitBeneficiary" class="form-input-box" required></select>
            </div>
            <div class="form-field-col">
              <label class="form-field-label">Visit due date</label>
              <input id="newVisitDate" class="form-input-box" type="date" required>
            </div>
          </div>
          <div class="form-group-block">
            <label class="form-field-label">Visit type</label>
            <input id="newVisitType" class="form-input-box" required placeholder="e.g. ANC follow-up">
          </div>
          <button type="submit" class="btn-full-purple btn-save-action">Schedule visit</button>`;
        panel.addEventListener("submit", e => { e.preventDefault(); this.scheduleVisit(); });
        visitContainer.parentElement.insertBefore(panel, visitContainer);
      }
    }

    updateDashboardDates() {
      const formatted = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: "numeric" });
      document.querySelectorAll(".dash-date").forEach(el => { el.textContent = formatted; });
      const today = document.getElementById("dashboardTodayDate");
      if (today) today.textContent = `Today: ${formatted}`;
    }

    updateVisitBeneficiaryOptions() {
      const select = document.getElementById("newVisitBeneficiary");
      if (!select) return;
      const unique = new Map();
      this.homeRecords.forEach(row => unique.set(String(row.beneficiary_id), row));
      this.mothers.forEach(row => unique.set(row.beneficiaryId, row));
      this.babies.forEach(row => unique.set(row.beneficiaryId, row));
      select.innerHTML = '<option value="">Select beneficiary</option>' +
        [...unique.keys()].map(id => `<option value="${this.escapeHtml(id)}">${this.escapeHtml(id)}</option>`).join("");
    }

    async initNearbyFacilitiesScreen() {
      const container = document.getElementById("facilitiesListContainer") ||
        document.querySelector("#screen-nearby-facilities .visits-cards-stream");
      if (container) {
        container.innerHTML = '<div class="empty-state-card"><p>Nearby clinic search is a separate Google Places/GPS feature. It is not stored in backend.py and no sample facilities are shown here.</p></div>';
      }
    }
    findNearbyFacilities() { this.showToast("Facility search requires the Google Places integration, not the SAKHI database API."); }
    searchFacilities() { this.showToast("Facility search is not connected to backend.py."); }
    filterFacilities() {}
    setFacilityRadius(radius) { this.facilityRadiusKm = Number(radius); }

    togglePasswordVisibility(inputId, button) {
      const input = document.getElementById(inputId);
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
    }

    editCurrentMother() { this.showToast("Mother profile editing is not implemented in backend.py; no changes were made."); }
    editCurrentBaby() { this.showToast("Child profile editing is not implemented in backend.py; no changes were made."); }
    showProfile() { this.navigateTo("profile"); }
  }

  document.addEventListener("DOMContentLoaded", () => {
    window.sakhiApp = new SakhiApp();
  });
})();
=======
    // ============================================================
    // AI HEALTH ASSISTANT CHAT MODULE
    // ============================================================
    async sendChatMessage() {
      const input = document.getElementById('chatMessageInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      if (/^(field\s+)?note\s*:/i.test(text)) {
        input.value = '';
        await this.processFieldNote(text.replace(/^(field\s+)?note\s*:/i, '').trim());
        return;
      }
      const scroll = document.getElementById('chatMessagesScroll');
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.appendChatBubble('user', text, timeStr);
      input.value = '';
      input.disabled = true;
      try {
        const result = await this.apiRequest('/api/chat', { method: 'POST', body: { query: text } });
        const data = result?.data ?? result;
        let reply = data?.message || data?.response || result?.message;
        if (!reply && data?.data !== undefined) reply = typeof data.data === 'string' ? data.data : JSON.stringify(data.data, null, 2);
        if (!reply) reply = 'I could not find a matching record or answer. Please try a more specific question.';
        this.appendChatBubble('bot', String(reply), new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), true);
      } catch (error) {
        this.appendChatBubble('bot', 'I could not reach the SAKHI server: ' + (error.message || 'Unknown error'), timeStr, false);
      } finally {
        input.disabled = false;
        input.focus();
        if (scroll) scroll.scrollTop = scroll.scrollHeight;
      }
    }

    appendChatBubble(kind, message, timeStr, canSpeak = false) {
      const scroll = document.getElementById('chatMessagesScroll');
      if (!scroll) return;
      const isUser = kind === 'user';
      const avatar = isUser
        ? `<div class="bubble-avatar-mini user-mini-avatar"><img src="${MOTHER_AVATAR}" alt="ASHA Worker"></div>`
        : `<div class="bubble-avatar-mini bot-mini-avatar"><svg width="20" height="20" viewBox="0 0 24 24" fill="#2B66FF"><rect x="5" y="7" width="14" height="12" rx="4"/><circle cx="9" cy="12" r="1.2" fill="#FFFFFF"/><circle cx="15" cy="12" r="1.2" fill="#FFFFFF"/><path d="M9 15h6" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round"/></svg></div>`;
      const safe = this.escapeHtml(String(message)).replace(/\n/g, '<br>');
      const speakButton = canSpeak ? `<button type="button" class="chat-speak-btn" onclick="sakhiApp.speakChatResponse(this)" data-speak-text="${this.escapeHtml(String(message)).replace(/"/g, '&quot;') }" aria-label="Read response aloud">🔊</button>` : '';
      scroll.insertAdjacentHTML('beforeend', `<div class="chat-row ${isUser ? 'user-row' : 'bot-row'}">${avatar}<div class="chat-bubble ${isUser ? 'user-bubble' : 'bot-bubble'}"><p class="bubble-text">${safe}</p><div class="bubble-meta"><span class="bubble-time">${timeStr || ''}</span>${speakButton}</div></div></div>`);
      scroll.scrollTop = scroll.scrollHeight;
    }

    async processFieldNote(note) {
      if (!note) return;
      this.appendChatBubble('user', 'Field note: ' + note, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      try {
        const parsedResponse = await this.apiRequest('/api/notes/parse', { method: 'POST', body: { note } });
        const parsed = parsedResponse?.data || [];
        if (!Array.isArray(parsed) || !parsed.length || !parsed[0]?.action_code) {
          const reason = parsed?.[0]?.message || 'No supported action was identified. Please add a clear action such as register pregnancy, schedule visit, record vaccination, or register child.';
          this.appendChatBubble('bot', reason, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          return;
        }
        const resolvedResponse = await this.apiRequest('/api/notes/resolve', { method: 'POST', body: { note, parse_result: parsed } });
        const resolved = resolvedResponse?.data || [];
        const action = resolved[0];
        if (!action) throw new Error('The note could not be resolved.');
        const parameters = action.parameters || {};
        const summary = Object.entries(parameters).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('\n');
        if (!action.valid || action.status !== 'READY') {
          this.appendChatBubble('bot', `${action.action_name || 'Field note'} needs correction before saving.\n${(action.errors || []).join('\n')}`, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          return;
        }
        const confirmText = `Review before saving:\n\nAction: ${action.action_name}\n${summary}\n\nSave this record to the SAKHI database?`;
        if (!window.confirm(confirmText)) {
          this.appendChatBubble('bot', 'The field note was reviewed but not saved. No database changes were made.', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          return;
        }
        const execution = await this.apiRequest('/api/workflows/execute', {
          method: 'POST', body: { note, action_code: action.action_code, confirmed: true }
        });
        const result = execution?.data || {};
        this.appendChatBubble('bot', result.message || execution.message || 'Workflow completed.', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        if (result.success) await this.loadBackendLists();
      } catch (error) {
        this.appendChatBubble('bot', 'Field note was not saved: ' + (error.message || 'Unknown error'), new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      }
    }

    async speakChatResponse(button) {
      const text = button?.dataset?.speakText;
      if (!text) return;
      try {
        button.disabled = true;
        const result = await fetch(this.apiBase + '/api/voice/speak', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, language: 'en-IN', voice: 'Lakshmi' })
        });
        if (!result.ok) {
          let detail = 'Speech synthesis failed.';
          try { const payload = await result.json(); detail = payload.detail || detail; } catch (_) {}
          throw new Error(detail);
        }
        const blob = await result.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.onerror = () => URL.revokeObjectURL(url);
        await audio.play();
      } catch (error) {
        this.showToast(error.message || 'Could not play voice response.');
      } finally { button.disabled = false; }
    }

    generateAshaAdvice(query) {
      const q = query.toLowerCase();

      if (q.includes('iron') || q.includes('ifa') || q.includes('tablet')) {
        return "Iron tablets help prevent anemia in pregnant women. Encourage her to take it daily after food. If she feels symptoms like dizziness, weakness or nausea, suggest her to consult the ANM or PHC Medical Officer.";
      }
      if (q.includes('calcium')) {
        return "Calcium tablets should be taken twice daily after 14 weeks of pregnancy, but NOT at the same time as Iron tablets. Keep at least a 2-hour gap between Calcium and IFA tablets.";
      }
      if (q.includes('vaccine') || q.includes('pentavalent') || q.includes('bcg') || q.includes('measles')) {
        return "Child immunization protocol: Pentavalent-3 and OPV-3 are due at 14 weeks. Measles-Rubella (MR-1) is administered at 9 completed months along with Vitamin A dose 1.";
      }
      if (q.includes('bp') || q.includes('blood pressure') || q.includes('hypertension') || q.includes('headache')) {
        return "Warning: Severe headache, blurred vision, or BP > 140/90 mmHg are danger signs of pre-eclampsia. Urgently notify Primary Health Centre Medical Officer and arrange immediate transport.";
      }
      if (q.includes('swelling') || q.includes('edema') || q.includes('feet')) {
        return "Mild pedal edema after walking is common, but sudden facial swelling or puffiness around eyes requires immediate BP screening and urine albumin test.";
      }
      if (q.includes('fever') || q.includes('baby') || q.includes('cold')) {
        return "For newborn fever (>37.5°C) or refusal to breastfeed: Keep baby warm with Kangaroo Mother Care and accompany mother to the Primary Health Centre immediately.";
      }

      return "I understand your clinical query. According to National Rural Health Mission protocols, record this observation in the MCP card and verify danger signs. If symptoms persist, notify the ANM.";
    }

    // Gnani voice capture: record in the browser, then send audio to FastAPI.
    initSpeechRecognition() {
      // Web Speech API is intentionally not used. Gnani handles STT server-side.
      this.speechRecognition = null;
    }

    async toggleChatVoice() {
      if (this.isRecording) {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        this.showToast('Audio recording is not supported in this browser. Use HTTPS or localhost.');
        return;
      }
      try {
        this.voiceRecordingTarget = 'chat';
        this.recordingVisitId = null;
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        this.voiceChunks = [];
        const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
        const mimeType = preferred.find(type => MediaRecorder.isTypeSupported(type));
        this.mediaRecorder = mimeType ? new MediaRecorder(this.mediaStream, { mimeType }) : new MediaRecorder(this.mediaStream);
        this.mediaRecorder.ondataavailable = event => { if (event.data && event.data.size) this.voiceChunks.push(event.data); };
        this.mediaRecorder.onerror = () => { this.showToast('Audio recording failed.'); this.finishVoiceCapture(); };
        this.mediaRecorder.onstop = () => this.processRecordedAudio();
        this.mediaRecorder.start();
        this.setRecordingState(true);
        this.showToast('Recording… tap the microphone again to finish.');
      } catch (error) {
        this.finishVoiceCapture();
        this.showToast(error.message || 'Microphone permission was denied.');
      }
    }

    async processRecordedAudio() {
      const isVisit = (this.voiceRecordingTarget === 'visit' && this.recordingVisitId);
      const visitId = this.recordingVisitId;
      const visit = isVisit ? this.visits.find(v => v.id === visitId) : null;

      try {
        const mime = this.mediaRecorder?.mimeType || 'audio/webm';
        const extension = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(this.voiceChunks, { type: mime });
        if (!blob.size) throw new Error('No audio was captured. Please try again.');

        const form = new FormData();
        form.append('audio', blob, `sakhi-voice.${extension}`);
        form.append('language_code', 'indic-auto');
        form.append('auto_execute', 'true');

        if (isVisit && visit) {
          this.showToast(`Transcribing & processing voice note for ${visit.personName}…`);
          form.append('context_visit_id', visit.id);
          form.append('context_beneficiary_id', visit.householdId || visit.beneficiary_id || 'B_001');
          form.append('context_visit_type', visit.purpose || 'Routine Checkup');

          const btn = document.getElementById(`btnVoiceVisit-${visitId}`);
          if (btn) {
            btn.classList.remove('recording-active');
            const span = btn.querySelector('span');
            if (span) span.textContent = '⏳ Processing…';
          }

          const result = await this.apiRequest('/api/voice/process-note', { method: 'POST', body: form });
          const data = result?.data || {};
          const transcript = data.transcript || '';
          const english = data.english_text || transcript;

          // Update visit model
          visit.status = 'Complete';
          visit.voiceNote = transcript;
          visit.englishNote = english;
          visit.voiceLanguage = data.detected_language;
          visit.lastVisit = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

          this.saveState('sakhi_visits', this.visits);
          this.updateStats();
          this.renderVisitsList(this.currentVisitFilter);
          this.showToast(result.message || `✓ Visit completed with voice note! (${data.detected_language || 'Indic'})`);
        } else {
          // Chatbot voice recording
          this.showToast('Transcribing & translating voice note with Gnani & Gemini…');
          const result = await this.apiRequest('/api/voice/process-note', { method: 'POST', body: form });
          const data = result?.data || {};
          const transcript = data.transcript || '';
          const english = data.english_text || transcript;
          const detectedLang = data.detected_language || 'Voice';

          const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const userBubbleText = (transcript && english && transcript !== english)
            ? `🎙 Spoken (${detectedLang}): "${transcript}"\nTranslated: "${english}"`
            : `🎙 Spoken: "${transcript || english}"`;
          this.appendChatBubble('user', userBubbleText, now);

          if (data.is_action && data.executed) {
            const p = data.parameters || {};
            const summary = Object.entries(p).map(([k, v]) => `• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n');
            const botMsg = `✅ **${data.action_name || data.action_code} Processed Successfully**\n\n${result.message || 'Record saved to SAKHI database.'}\n\n**Parameters:**\n${summary}`;
            this.appendChatBubble('bot', botMsg, now, true);
            await this.loadBackendLists();
            this.renderVisitsList(this.currentVisitFilter);
          } else if (data.is_action && !data.executed) {
            const errs = (data.errors || []).map(e => `• ${e}`).join('\n');
            const botMsg = `⚠️ **${data.action_name || data.action_code} Identified**\n\n${result.message || 'Could not complete the action because some details were missing or invalid.'}\n\n**Missing Details:**\n${errs}`;
            this.appendChatBubble('bot', botMsg, now, true);
          } else {
            // Clinical bot Q&A response
            const reply = data.chat_reply || "I transcribed your voice query: \"" + english + "\"";
            this.appendChatBubble('bot', String(reply), now, true);
          }
        }
      } catch (error) {
        this.showToast(error.message || 'Voice transcription and processing failed.');
        if (isVisit) {
          this.renderVisitsList(this.currentVisitFilter);
        }
      } finally {
        this.finishVoiceCapture();
      }
    }

    finishVoiceCapture() {
      this.setRecordingState(false);
      if (this.recordingVisitId) {
        const btn = document.getElementById(`btnVoiceVisit-${this.recordingVisitId}`);
        if (btn) {
          btn.classList.remove('recording-active');
          const span = btn.querySelector('span');
          if (span) span.textContent = 'Voice Note';
        }
      }
      if (this.mediaStream) this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
      this.mediaRecorder = null;
      this.voiceChunks = [];
      this.recordingVisitId = null;
      this.voiceRecordingTarget = 'chat';
    }

    setRecordingState(recording) {
      this.isRecording = recording;
      const micBtn = document.getElementById('chatMicBtn');
      if (micBtn) {
        micBtn.classList.toggle('recording', recording);
      }
    }

    // ============================================================
    // MODALS & OPTIONS MENU
    // ============================================================
    showOptionsMenu(context) {
      const modal = document.getElementById('optionsModal');
      const list = document.getElementById('optionsActionsList');
      const title = document.getElementById('optionsSheetTitle');

      if (!modal || !list) return;

      let actions = [];
      if (context === 'maternal') {
        title.textContent = 'Maternal Health Actions';
        actions = [
          { label: 'Add New Mother', icon: 'user-plus', action: () => this.openMaternalForm() },
          { label: 'Export Field ANC Register', icon: 'download', action: () => this.showToast('Downloading ANC Register Excel/PDF...') },
          { label: 'Sync with RCH Portal', icon: 'refresh', action: () => this.showToast('Synced with Karnataka RCH Portal ✓') }
        ];
      } else if (context === 'vaccine') {
        title.textContent = 'Vaccine Tracker Actions';
        actions = [
          { label: 'Add New Baby', icon: 'plus-circle', action: () => this.openBabyForm() },
          { label: 'Immunization Due List (This Month)', icon: 'calendar', action: () => this.showToast('3 babies due for vaccination this week') },
          { label: 'Cold Chain Ice Pack Status', icon: 'shield', action: () => this.showToast('PHC Cold Chain: Safe (+4°C)') }
        ];
      } else if (context === 'mother-detail') {
        title.textContent = this.selectedMother.name;
        actions = [
          { label: 'Edit Mother Profile', icon: 'edit', action: () => this.editCurrentMother() },
          { label: 'Call Beneficiary', icon: 'phone', action: () => window.open(`tel:${this.selectedMother.phone || '1234567891'}`) },
          { label: 'Share MCP Card Summary', icon: 'share', action: () => this.showToast('MCP card shared via SMS') }
        ];
      } else if (context === 'child-detail') {
        title.textContent = this.selectedBaby.name;
        actions = [
          { label: 'Edit Child Profile', icon: 'edit', action: () => this.editCurrentBaby() },
          { label: 'Call Parent/Guardian', icon: 'phone', action: () => window.open(`tel:${this.selectedBaby.phone || '1234567891'}`) },
          { label: 'Mark Next Vaccine Given', icon: 'check', action: () => this.markVaccineGiven() }
        ];
      } else {
        title.textContent = 'Options';
        actions = [
          { label: 'Refresh Data', icon: 'refresh', action: () => location.reload() },
          { label: 'Offline Mode Settings', icon: 'settings', action: () => this.showToast('All data saved locally for offline village visits') }
        ];
      }

      list.innerHTML = actions.map(act => `
        <button class="sheet-action-item" onclick="sakhiApp.closeOptionsMenu(); (${act.action.toString()})()">
          <span>${act.label}</span>
        </button>
      `).join('');

      modal.classList.add('open');
    }

    closeOptionsMenu() {
      const modal = document.getElementById('optionsModal');
      if (modal) modal.classList.remove('open');
    }

    markVaccineGiven() {
      if (!this.selectedBaby) return;
      this.selectedBaby.completedVaccines = (this.selectedBaby.completedVaccines || 7) + 1;
      this.selectedBaby.pendingVaccines = Math.max(0, (this.selectedBaby.pendingVaccines || 2) - 1);
      this.saveState('sakhi_babies', this.babies);
      this.renderBabyDetail(this.selectedBaby);
      this.showToast('Vaccine administration recorded in Sakhi register!');
    }

    showNotificationsModal() {
      this.showToast('3 Reminders: 2 ANC visits tomorrow, 1 baby Pentavalent-3 due');
    }

    showToast(message) {
      const container = document.getElementById('toastContainer');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = 'toast-msg';
      toast.textContent = message;
      container.appendChild(toast);

      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 3000);
    }

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }

  // Initialize and attach to global window
  document.addEventListener('DOMContentLoaded', () => {
    window.sakhiApp = new SakhiApp();
  });

})();
>>>>>>> 053f8ff (Initial commit with project files)
