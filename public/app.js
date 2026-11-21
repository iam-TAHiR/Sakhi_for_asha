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

      this.renderMothersList(this.mothers);
      this.renderBabiesList(this.babies);
      this.renderMotherDetail(this.selectedMother);
      this.renderBabyDetail(this.selectedBaby);
      this.renderVisitsList();
      this.renderFollowupsList();
      this.renderAlertsList();
      this.updateStats();
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
      }
    }

    logout() {
      this.isLoggedIn = false;
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
    }

    filterFollowups(filter, btn) {
      if (btn) {
        document.querySelectorAll("#screen-followups .filter-pill-btn").forEach(x => x.classList.remove("active"));
        btn.classList.add("active");
      }
      this.renderFollowupsList(filter);
    }

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
    }

    filterAlerts(priority, btn) {
      if (btn) {
        document.querySelectorAll("#screen-alerts .filter-pill-btn").forEach(x => x.classList.remove("active"));
        btn.classList.add("active");
      }
      this.renderAlertsList(priority);
    }

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