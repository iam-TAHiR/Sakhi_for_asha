(() => {
  "use strict";

  const DB_NAME = "sakhi-field-notes";
  const DB_VERSION = 2;
  const STORE_NAME = "visits";
  const ACCOUNTS_KEY = "sakhi-local-accounts";
  const SESSION_KEY = "sakhi-current-user";
  const ACCOUNT_HASH_ITERATIONS = 120000;
  const EMERGENCY_TERMS = [
    "emergency",
    "unconscious",
    "not breathing",
    "difficulty breathing",
    "trouble breathing",
    "severe bleeding",
    "heavy bleeding",
    "chest pain",
    "seizure",
    "convulsion",
    "immediate help",
    "urgent help",
  ];

  const form = document.querySelector("#visit-form");
  const transcript = document.querySelector("#transcript");
  const recordButton = document.querySelector("#record-button");
  const saveButton = document.querySelector("#save-button");
  const locationButton = document.querySelector("#location-button");
  const locationLabel = document.querySelector("#location-label");
  const locationDetail = document.querySelector("#location-detail");
  const emergencyCheckbox = document.querySelector("#emergency-checkbox");
  const audioPlayer = document.querySelector("#audio-player");
  const audioPlayback = document.querySelector("#audio-playback");
  const toastRegion = document.querySelector("#toast-region");
  const recordDialog = document.querySelector("#record-dialog");
  const authScreen = document.querySelector("#auth-screen");
  const appShell = document.querySelector("#app-shell");
  const authMessage = document.querySelector("#auth-message");

  let databasePromise;
  let currentUser = null;
  let activeFilter = "all";
  let locationData = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let audioBlob = null;
  let audioUrl = null;
  let recognition = null;
  let recordingSeconds = 0;
  let recordingInterval = null;
  let alertAudioContext = null;
  let currentDialogUrl = null;
  let alertedForCurrentNote = false;
  let automaticEmergency = false;
  let records = [];

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("This browser does not support local visit storage."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("emergency", "emergency");
          store.createIndex("userId", "userId");
        } else {
          const store = request.transaction.objectStore(STORE_NAME);
          if (!store.indexNames.contains("userId")) store.createIndex("userId", "userId");
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          databasePromise = null;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(request.error || new Error("Could not open visit storage."));
      };
      request.onblocked = () => reject(new Error("Visit storage is blocked by another open Sakhi tab."));
    });
    return databasePromise;
  }

  async function getAllRecords() {
    if (!currentUser) throw new Error("Sign in to open visit records.");
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result
        .filter((record) => record.userId === currentUser.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      request.onerror = () => reject(request.error || new Error("Could not load visit records."));
    });
  }

  async function saveRecord(record) {
    if (!currentUser) throw new Error("Sign in to save a visit.");
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save this visit."));
      transaction.onabort = () => reject(transaction.error || new Error("Saving this visit was cancelled."));
    });
  }

  async function deleteRecord(id) {
    if (!currentUser) throw new Error("Sign in to delete a visit.");
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result?.userId === currentUser.id) store.delete(id);
        else transaction.abort();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not delete this visit."));
      transaction.onabort = () => reject(transaction.error || new Error("This visit does not belong to the signed-in account."));
    });
  }

  function readAccounts() {
    const storedAccounts = localStorage.getItem(ACCOUNTS_KEY);
    if (!storedAccounts) return [];
    const accounts = JSON.parse(storedAccounts);
    if (!Array.isArray(accounts)) throw new Error("Saved accounts could not be read. Clear this browser's Sakhi account data and sign up again.");
    return accounts;
  }

  function toBase64(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }

  function fromBase64(value) {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  }

  async function hashPassword(password, salt) {
    if (!globalThis.crypto?.subtle) throw new Error("Account sign-in requires a secure browser context. Open Sakhi through localhost or HTTPS.");
    const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt,
      iterations: ACCOUNT_HASH_ITERATIONS,
      hash: "SHA-256",
    }, keyMaterial, 256);
    return new Uint8Array(bits);
  }

  function accountInitial(name) {
    return (name.trim().charAt(0) || "A").toLocaleUpperCase();
  }

  async function startSession(account) {
    currentUser = { id: account.id, name: account.name, email: account.email };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    authScreen.hidden = true;
    appShell.hidden = false;
    authMessage.textContent = "";
    document.querySelector("#worker-name").textContent = account.name;
    document.querySelector("#welcome-name").textContent = account.name;
    document.querySelector("#worker-avatar").textContent = accountInitial(account.name);
    document.querySelector("#top-avatar").textContent = accountInitial(account.name);
    document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date());
    switchPage("dashboard");
    await refreshRecords();
  }

  function showAuthMessage(message, isError = true) {
    authMessage.textContent = message;
    authMessage.classList.toggle("error", isError);
  }

  function switchPage(page) {
    const pages = {
      dashboard: "Dashboard",
      "new-visit": "New visit",
      "voice-notes": "Voice notes",
      "visit-records": "Visit records",
      "emergency-records": "Emergency flags",
    };
    if (!pages[page]) return;
    document.querySelectorAll("[data-page-view]").forEach((view) => {
      view.hidden = view.dataset.pageView !== page;
    });
    document.querySelectorAll(".nav-link[data-page]").forEach((link) => {
      const selected = link.dataset.page === page;
      link.classList.toggle("active", selected);
      if (selected) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    document.querySelector("#page-title").textContent = pages[page];
    document.querySelector(".main-content").scrollIntoView({ block: "start" });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function formatDate(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " error" : ""}`;
    toast.textContent = message;
    toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 4800);
  }

  function playAlert() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        showToast("Emergency flagged. This browser cannot play an audio alert.", "error");
        return;
      }
      alertAudioContext ||= new AudioContext();
      if (alertAudioContext.state === "suspended") void alertAudioContext.resume();
      const now = alertAudioContext.currentTime;
      [0, 0.24, 0.52].forEach((offset, index) => {
        const oscillator = alertAudioContext.createOscillator();
        const gain = alertAudioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = index === 1 ? 740 : 880;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.15, now + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
        oscillator.connect(gain);
        gain.connect(alertAudioContext.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.2);
      });
    } catch (error) {
      console.error("Could not play the emergency alert.", error);
      showToast("Emergency flagged, but the audio alert could not be played.", "error");
    }
  }

  function setEmergency(isEmergency, shouldAlert = true) {
    if (isEmergency) {
      if (!emergencyCheckbox.checked) automaticEmergency = true;
      emergencyCheckbox.checked = true;
      if (!alertedForCurrentNote && shouldAlert) {
        alertedForCurrentNote = true;
        playAlert();
        showToast("Emergency phrase detected — this visit will be flagged and highlighted.");
      }
    } else if (automaticEmergency) {
      emergencyCheckbox.checked = false;
      automaticEmergency = false;
      alertedForCurrentNote = false;
    }
  }

  function checkEmergency(text) {
    const normalized = text.toLocaleLowerCase();
    return EMERGENCY_TERMS.some((term) => normalized.includes(term));
  }

  function onTranscriptChanged() {
    document.querySelector("#transcript-count").textContent = `${transcript.value.length} characters`;
    const matchesEmergency = checkEmergency(transcript.value);
    if (matchesEmergency) {
      setEmergency(true);
    } else if (automaticEmergency) {
      setEmergency(false, false);
    }
  }

  function updateStats() {
    const now = new Date();
    const currentMonthRecords = records.filter((record) => {
      const date = new Date(record.createdAt);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
    const emergencyRecords = records.filter((record) => record.emergency);
    document.querySelector("#total-visits").textContent = records.length;
    document.querySelector("#month-visits").textContent = currentMonthRecords.length;
    document.querySelector("#emergency-visits").textContent = emergencyRecords.length;
    document.querySelector("#banner-emergency-count").textContent = emergencyRecords.length;
    document.querySelector("#sidebar-alert-count").textContent = emergencyRecords.length;
    document.querySelector("#record-count-label").textContent = `${records.length} ${records.length === 1 ? "record" : "records"}`;
  }

  function visibleRecords() {
    const query = document.querySelector("#search-records").value.trim().toLocaleLowerCase();
    return records.filter((record) => {
      if (activeFilter === "emergency" && !record.emergency) return false;
      return !query || [record.personName, record.householdId, record.village]
        .some((value) => String(value || "").toLocaleLowerCase().includes(query));
    });
  }

  function renderRecordList(listId, filteredRecords, limit = Number.POSITIVE_INFINITY) {
    const list = document.querySelector(`#${listId}`);
    if (filteredRecords.length === 0) {
      const emptyMessage = listId === "dashboard-recent-list"
        ? "No visits yet. Start a new visit to add your first field note."
        : records.length
          ? "No visits match your search."
          : "No visits saved yet. Start a new visit to create your first field note.";
      list.innerHTML = `<div class="records-empty">${escapeHtml(emptyMessage)}</div>`;
      return;
    }
    list.innerHTML = filteredRecords.slice(0, limit).map((record) => {
      const initial = escapeHtml((record.personName || "?").trim().charAt(0).toUpperCase());
      const meta = [escapeHtml(record.householdId), formatDate(record.createdAt)].filter(Boolean).join(" · ");
      return `<article class="record-item${record.emergency ? " emergency" : ""}" data-record-id="${escapeHtml(record.id)}" tabindex="0" role="button" aria-label="View visit for ${escapeHtml(record.personName)}">
        <span class="record-avatar" aria-hidden="true">${initial}</span>
        <span class="record-main"><strong class="record-name">${escapeHtml(record.personName)}</strong><span class="record-meta">${meta}</span></span>
        ${record.emergency ? '<span class="record-flag">⚑ Urgent</span>' : ""}
      </article>`;
    }).join("");
    list.querySelectorAll(".record-item").forEach(bindRecordItem);
  }

  function bindRecordItem(item) {
    item.addEventListener("click", () => showRecord(item.dataset.recordId));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showRecord(item.dataset.recordId);
      }
    });
  }

  function renderRecords() {
    const filteredRecords = visibleRecords();
    renderRecordList("records-list", filteredRecords);
    renderRecordList("dashboard-recent-list", records, 5);
  }

  function renderEmergencyList() {
    const emergencyRecords = records.filter((record) => record.emergency);
    const list = document.querySelector("#emergency-list");
    if (emergencyRecords.length === 0) {
      list.innerHTML = '<div class="emergency-empty">No urgent records right now. Flagged visits will appear here.</div>';
      return;
    }
    list.innerHTML = emergencyRecords.map((record) => `
      <div class="emergency-item" data-record-id="${escapeHtml(record.id)}" tabindex="0" role="button" aria-label="View flagged visit for ${escapeHtml(record.personName)}">
        <span><strong class="emergency-item-name">${escapeHtml(record.personName)}</strong><span class="emergency-item-meta">${escapeHtml(record.householdId)} · ${formatDate(record.createdAt)}</span></span>
        <span class="emergency-item-badge">FLAGGED</span>
      </div>`).join("");
    list.querySelectorAll(".emergency-item").forEach((item) => {
      item.addEventListener("click", () => showRecord(item.dataset.recordId));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showRecord(item.dataset.recordId);
        }
      });
    });
  }

  async function refreshRecords() {
    if (!currentUser) return;
    try {
      records = await getAllRecords();
      updateStats();
      renderRecords();
      renderEmergencyList();
    } catch (error) {
      console.error("Could not load saved visits.", error);
      showToast(error.message || "Could not load saved visit records.", "error");
    }
  }

  function showRecord(id) {
    const record = records.find((item) => item.id === id);
    if (!record) return;
    const detail = document.querySelector("#dialog-content");
    const location = record.location
      ? `${record.location.latitude.toFixed(5)}, ${record.location.longitude.toFixed(5)}`
      : "Not captured";
    detail.innerHTML = `
      ${record.emergency ? '<div class="dialog-emergency">⚑ Emergency flagged${record.alerted ? " · Audio alert played" : ""}</div>' : ""}
      <div class="dialog-fields">
        <div class="dialog-field"><span>Person</span><strong>${escapeHtml(record.personName)}</strong></div>
        <div class="dialog-field"><span>Household / ID</span><strong>${escapeHtml(record.householdId)}</strong></div>
        <div class="dialog-field"><span>Village / area</span><strong>${escapeHtml(record.village || "Not provided")}</strong></div>
        <div class="dialog-field"><span>Phone</span><strong>${escapeHtml(record.phone || "Not provided")}</strong></div>
        <div class="dialog-field"><span>Date &amp; time</span><strong>${formatDate(record.createdAt)}</strong></div>
        <div class="dialog-field"><span>Location (latitude, longitude)</span><strong>${location}</strong></div>
      </div>
      <div class="dialog-field"><span>Visit note</span><div class="dialog-note">${escapeHtml(record.transcript || "No written note.")}</div></div>
      ${record.audio ? '<div class="dialog-field"><span>Voice recording</span><audio class="dialog-audio" controls></audio></div>' : ""}
      <div class="dialog-actions"><button class="button delete-button" id="delete-record" type="button">Delete record</button><button class="button button-primary" id="dialog-done" type="button">Done</button></div>`;
    if (record.audio) {
      currentDialogUrl = URL.createObjectURL(record.audio);
      detail.querySelector("audio").src = currentDialogUrl;
    }
    detail.querySelector("#dialog-done").addEventListener("click", () => recordDialog.close());
    detail.querySelector("#delete-record").addEventListener("click", async () => {
      if (!window.confirm(`Delete the visit record for ${record.personName}? This also deletes its recording.`)) return;
      try {
        await deleteRecord(record.id);
        recordDialog.close();
        await refreshRecords();
        showToast("Visit record deleted from this device.");
      } catch (error) {
        console.error("Could not delete visit.", error);
        showToast(error.message || "Could not delete this visit.", "error");
      }
    });
    recordDialog.showModal();
  }

  function createSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;
    const instance = new SpeechRecognition();
    instance.lang = document.querySelector("#language-select").value;
    instance.continuous = true;
    instance.interimResults = true;
    instance.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalText += text;
        else interimText += text;
      }
      if (finalText) {
        transcript.value = `${transcript.value}${transcript.value ? " " : ""}${finalText.trim()}`;
        onTranscriptChanged();
      }
      if (interimText) {
        document.querySelector("#recording-status").textContent = `Hearing: ${interimText}`;
      } else if (mediaRecorder?.state === "recording") {
        document.querySelector("#recording-status").textContent = "Recording and transcribing…";
      }
    };
    instance.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        document.querySelector("#recording-status").textContent = "Recording — transcription unavailable";
      }
    };
    return instance;
  }

  function setRecordingUI(isRecording, status) {
    recordButton.classList.toggle("is-recording", isRecording);
    recordButton.setAttribute("aria-label", isRecording ? "Stop recording" : "Start recording");
    document.querySelector("#record-button-label").textContent = isRecording ? "Stop recording" : "Start recording";
    document.querySelector("#recording-status").textContent = status;
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast("Audio recording is not supported in this browser. You can still type a visit note.", "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) audioChunks.push(event.data);
      });
      mediaRecorder.addEventListener("stop", () => {
        audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioUrl = URL.createObjectURL(audioBlob);
        audioPlayer.src = audioUrl;
        audioPlayback.hidden = false;
        stream.getTracks().forEach((track) => track.stop());
        if (recognition) {
          try { recognition.stop(); } catch (error) {
            if (error.name !== "InvalidStateError") console.error("Could not stop speech recognition.", error);
          }
        }
        clearInterval(recordingInterval);
        setRecordingUI(false, "Recording ready to review");
      }, { once: true });
      mediaRecorder.start();
      recognition = createSpeechRecognition();
      if (recognition) {
        try {
          recognition.start();
          setRecordingUI(true, "Recording and transcribing…");
        } catch (error) {
          console.error("Could not start speech recognition.", error);
          setRecordingUI(true, "Recording — transcription unavailable");
        }
      } else {
        setRecordingUI(true, "Recording — type your note below");
      }
      recordingSeconds = 0;
      document.querySelector("#recording-timer").textContent = "00:00";
      recordingInterval = window.setInterval(() => {
        recordingSeconds += 1;
        const minutes = String(Math.floor(recordingSeconds / 60)).padStart(2, "0");
        const seconds = String(recordingSeconds % 60).padStart(2, "0");
        document.querySelector("#recording-timer").textContent = `${minutes}:${seconds}`;
      }, 1000);
    } catch (error) {
      console.error("Could not access the microphone.", error);
      const message = error.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access in browser settings to record."
        : "Could not access the microphone. Check the device connection and try again.";
      setRecordingUI(false, "Ready to record");
      showToast(message, "error");
    }
  }

  function stopRecording() {
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
  }

  function captureLocation() {
    if (!navigator.geolocation) {
      showToast("Location is not supported by this browser. You can still save the visit.", "error");
      return;
    }
    locationButton.disabled = true;
    locationButton.textContent = "Finding…";
    navigator.geolocation.getCurrentPosition((position) => {
      locationData = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      locationLabel.textContent = "Location captured";
      locationDetail.textContent = `${locationData.latitude.toFixed(5)}, ${locationData.longitude.toFixed(5)} · ±${Math.round(locationData.accuracy)}m`;
      locationButton.disabled = false;
      locationButton.textContent = "Update location";
    }, (error) => {
      console.warn("Could not capture location.", error);
      locationButton.disabled = false;
      locationButton.textContent = locationData ? "Update location" : "Capture location";
      const reason = error.code === error.PERMISSION_DENIED
        ? "Location permission was denied."
        : error.code === error.POSITION_UNAVAILABLE
          ? "Location is unavailable."
          : "Location request timed out.";
      showToast(`${reason} You can still save the visit without it.`, "error");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  function clearForm() {
    if (mediaRecorder?.state === "recording") stopRecording();
    form.reset();
    locationData = null;
    audioBlob = null;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    audioPlayback.hidden = true;
    document.querySelector("#recording-timer").textContent = "00:00";
    document.querySelector("#transcript-count").textContent = "0 characters";
    locationLabel.textContent = "Location not captured";
    locationDetail.textContent = "Add your current location to this visit";
    locationButton.textContent = "Capture location";
    setRecordingUI(false, "Ready to record");
    automaticEmergency = false;
    alertedForCurrentNote = false;
  }

  async function submitVisit(event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (mediaRecorder?.state === "recording") {
      showToast("Stop the recording before saving this visit.", "error");
      return;
    }
    const transcriptIsEmergency = checkEmergency(transcript.value);
    const emergency = emergencyCheckbox.checked || transcriptIsEmergency;
    if (emergency && !alertedForCurrentNote) {
      alertedForCurrentNote = true;
      playAlert();
    }
    const record = {
      id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId: currentUser.id,
      personName: document.querySelector("#person-name").value.trim(),
      householdId: document.querySelector("#household-id").value.trim(),
      village: document.querySelector("#village").value.trim(),
      phone: document.querySelector("#phone").value.trim(),
      transcript: transcript.value.trim(),
      location: locationData,
      createdAt: new Date().toISOString(),
      emergency,
      alerted: emergency && alertedForCurrentNote,
      audio: audioBlob,
    };
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    try {
      await saveRecord(record);
      await refreshRecords();
      clearForm();
      showToast(emergency
        ? "Visit saved and flagged for emergency attention."
        : "Visit note saved on this device.");
    } catch (error) {
      console.error("Could not save visit.", error);
      showToast(error.message || "Could not save this visit. Your note is still in the form.", "error");
    } finally {
      saveButton.disabled = false;
      saveButton.innerHTML = '<span aria-hidden="true">▣</span> Save visit note';
    }
  }

  function initialize() {
    const loginTab = document.querySelector("#login-tab");
    const signupTab = document.querySelector("#signup-tab");
    const loginForm = document.querySelector("#login-form");
    const signupForm = document.querySelector("#signup-form");
    const changeAuthTab = (showSignup) => {
      loginForm.hidden = showSignup;
      signupForm.hidden = !showSignup;
      loginTab.classList.toggle("active", !showSignup);
      signupTab.classList.toggle("active", showSignup);
      loginTab.setAttribute("aria-selected", String(!showSignup));
      signupTab.setAttribute("aria-selected", String(showSignup));
      authMessage.textContent = "";
      authMessage.classList.remove("error");
    };
    loginTab.addEventListener("click", () => changeAuthTab(false));
    signupTab.addEventListener("click", () => changeAuthTab(true));
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!loginForm.reportValidity()) return;
      showAuthMessage("Checking your account…", false);
      try {
        const email = document.querySelector("#login-email").value.trim().toLocaleLowerCase();
        const password = document.querySelector("#login-password").value;
        const account = readAccounts().find((item) => item.email === email);
        if (!account) {
          showAuthMessage("We couldn't find an account with that email. Check it or create an account.");
          return;
        }
        const passwordHash = await hashPassword(password, fromBase64(account.salt));
        if (toBase64(passwordHash) !== account.passwordHash) {
          showAuthMessage("That password doesn't match this account. Please try again.");
          return;
        }
        loginForm.reset();
        await startSession(account);
      } catch (error) {
        console.error("Could not sign in.", error);
        showAuthMessage(error.message || "Could not sign in. Please try again.");
      }
    });
    signupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!signupForm.reportValidity()) return;
      showAuthMessage("Creating your account…", false);
      try {
        const name = document.querySelector("#signup-name").value.trim();
        const email = document.querySelector("#signup-email").value.trim().toLocaleLowerCase();
        const accounts = readAccounts();
        if (accounts.some((account) => account.email === email)) {
          showAuthMessage("An account with that email already exists. Sign in instead.");
          return;
        }
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const passwordHash = await hashPassword(document.querySelector("#signup-password").value, salt);
        const account = {
          id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name,
          email,
          salt: toBase64(salt),
          passwordHash: toBase64(passwordHash),
        };
        accounts.push(account);
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
        signupForm.reset();
        await startSession(account);
        showToast("Your local Sakhi account is ready.");
      } catch (error) {
        console.error("Could not create an account.", error);
        showAuthMessage(error.message || "Could not create an account. Check your browser storage and try again.");
      }
    });
    document.querySelectorAll(".nav-link[data-page], [data-go]").forEach((button) => {
      button.addEventListener("click", () => switchPage(button.dataset.page || button.dataset.go));
    });
    document.querySelector(".brand[aria-label='Sakhi dashboard']").addEventListener("click", (event) => {
      event.preventDefault();
      switchPage("dashboard");
    });
    document.querySelector("#signout-button").addEventListener("click", () => {
      const hasDraft = document.querySelector("#person-name").value.trim()
        || document.querySelector("#household-id").value.trim()
        || transcript.value.trim()
        || audioBlob;
      if (hasDraft && !window.confirm("Sign out and discard this unsaved visit?")) return;
      if (mediaRecorder?.state === "recording") stopRecording();
      clearForm();
      currentUser = null;
      records = [];
      sessionStorage.removeItem(SESSION_KEY);
      appShell.hidden = true;
      authScreen.hidden = false;
      changeAuthTab(false);
    });
    recordButton.addEventListener("click", () => {
      if (mediaRecorder?.state === "recording") stopRecording();
      else void startRecording();
    });
    transcript.addEventListener("input", onTranscriptChanged);
    emergencyCheckbox.addEventListener("change", () => {
      if (emergencyCheckbox.checked && !alertedForCurrentNote) {
        automaticEmergency = false;
        alertedForCurrentNote = true;
        playAlert();
      } else if (!emergencyCheckbox.checked) {
        if (checkEmergency(transcript.value)) {
          automaticEmergency = true;
          emergencyCheckbox.checked = true;
        } else {
          automaticEmergency = false;
          alertedForCurrentNote = false;
        }
      }
    });
    locationButton.addEventListener("click", captureLocation);
    form.addEventListener("submit", (event) => void submitVisit(event));
    document.querySelector("#clear-button").addEventListener("click", () => {
      if (form.querySelector('input[name="personName"]').value || transcript.value || audioBlob) {
        if (!window.confirm("Clear this visit form? Unsaved notes and recording will be lost.")) return;
      }
      clearForm();
    });
    document.querySelector("#search-records").addEventListener("input", renderRecords);
    document.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        activeFilter = chip.dataset.filter;
        document.querySelectorAll(".filter-chip").forEach((item) => item.classList.toggle("selected", item === chip));
        renderRecords();
      });
    });
    document.querySelector("#close-dialog").addEventListener("click", () => recordDialog.close());
    recordDialog.addEventListener("close", () => {
      if (currentDialogUrl) URL.revokeObjectURL(currentDialogUrl);
      currentDialogUrl = null;
    });
    try {
      const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (session?.id && session?.name && session?.email) {
        void startSession(session).catch((error) => {
          console.error("Could not restore the signed-in session.", error);
          sessionStorage.removeItem(SESSION_KEY);
          appShell.hidden = true;
          authScreen.hidden = false;
          showAuthMessage("Could not load your field workspace. Please sign in again.");
        });
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch (error) {
      console.error("Could not read the signed-in session.", error);
      sessionStorage.removeItem(SESSION_KEY);
      showAuthMessage("Could not restore your sign-in. Please sign in again.");
    }
  }

  initialize();
})();
