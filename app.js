/* Scholarbrige Academic Hub — replacement app.js
   Uses the existing Supabase project and the existing HTML IDs where available.
   IMPORTANT: KES task rewards are displayed as pending until a trusted Supabase-side
   review process approves them. Never credit wallets from browser JavaScript.
*/
(() => {
  "use strict";

  const SUPABASE_URL = "https://vulbvlardmvvxdhqyopn.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hve5CvGEO3tyocvupHOv9w_zEVEaN9a";
  const SUPPORT_EMAIL = "smart@gmail.com";
  const BRAND_NAME = "Scholarbrige Academic Hub";
  const REVIEW_DURATION_MS = 6 * 60 * 60 * 1000;
  const REVIEW_KEY_PREFIX = "scholarbridge_review_started_v1:";
  const THEME_ORDER = ["sky-blue", "lavender", "forest-green", "rose-pink", "light-mode"];
  const THEME_INTERVAL = 40 * 60 * 1000;
  const THEME_KEY = "scf_theme_rotation_started_v1";
  const ACTIVATION_FEES = { 1: 500, 2: 1000, 3: 1780, 4: 2670 };
  const $ = id => document.getElementById(id);

  let db = null, currentUser = null, currentProfile = null;
  let currentActivationRequest = null, adminQueueTimer = null, reviewTimer = null;
  let dashboardRequest = 0, busy = false, authListenerRegistered = false;

  try {
    if (window.supabase && window.supabase.createClient) {
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    }
  } catch (e) { console.error("Supabase setup failed:", e); }

  function notice(message, type = "info") {
    const el = $("globalMessage") || $("notice") || $("globalNotice") || $("authNotice");
    if (!el) { console.log(message); return; }
    el.textContent = message;
    el.className = "notice " + type;
    el.classList.remove("hidden");
  }
  function clearNotice() {
    ["globalMessage", "notice", "globalNotice", "authNotice"].forEach(id => {
      const el = $(id);
      if (el) { el.textContent = ""; el.classList.add("hidden"); }
    });
  }
  function showError(message) { notice(message, "error"); }
  function requireDatabase() {
    if (!db) throw new Error("Supabase client did not load. Check that the Supabase script is included before app.js.");
    return db;
  }
  function showView(id) {
    const views = ["authView", "activationView", "verificationView", "pendingView", "dashboardView", "supportView"];
    views.forEach(v => { if ($(v)) $(v).classList.toggle("hidden", v !== id); });
    if (["loginView", "signupView", "forgotPasswordView"].includes(id)) {
      $("authView")?.classList.remove("hidden");
      switchMode(id === "signupView" ? "signup" : "login");
      return;
    }
    $(id)?.classList.remove("hidden");
    clearNotice();
  }
  function switchMode(mode) {
    const signup = mode === "signup";
    document.querySelectorAll(".tab[data-tab]").forEach(tab => {
      const active = signup ? tab.dataset.tab === "signupForm" : tab.dataset.tab === "loginForm";
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    $("signupForm")?.classList.toggle("hidden", !signup);
    $("loginForm")?.classList.toggle("hidden", signup);
    clearNotice();
  }
  function ensureActivationView() {
    if ($("activationView")) return $("activationView");
    const view = document.createElement("section");
    view.id = "activationView";
    view.className = "panel page-panel hidden";
    view.innerHTML = `<p class="eyebrow">MEMBERSHIP ACTIVATION</p><h1>Request activation</h1>
      <p>Choose your membership level. The administrator will issue your FBK reference number. Your account is not approved automatically.</p>
      <form id="activationForm" class="form">
      <label>Full name<input name="full_name" required></label>
      <label>Phone number<input name="phone" required></label>
      <label>Membership level<select name="membership_level" required>
      <option value="1">Level 1 — KES 500</option><option value="2">Level 2 — KES 1,000</option>
      <option value="3">Level 3 — KES 1,780</option><option value="4">Level 4 — KES 2,670</option></select></label>
      <button class="primary full" type="submit">Request activation</button></form>
      <p id="activationStatus" class="small-note"></p><button id="logoutActivation" class="text-button" type="button">Log out</button>`;
    const pending = $("pendingView"), auth = $("authView");
    if (pending?.parentNode) pending.parentNode.insertBefore(view, pending);
    else if (auth?.parentNode) auth.parentNode.insertBefore(view, auth.nextSibling);
    bind("activationForm", "submit", requestActivation);
    bind("logoutActivation", "click", logout);
    return view;
  }
  function setBusy(value, button) {
    busy = value;
    if (button) {
      button.disabled = value;
      if (value) {
        button.dataset.oldText = button.textContent;
        button.textContent = "Please wait…";
      } else {
        button.textContent = button.dataset.oldText || button.textContent;
      }
    }
  }
  function money(value) {
    const n = Number(value || 0);
    return "KES " + n.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function cleanPhone(value) { return String(value || "").replace(/[^\d+]/g, "").trim(); }
  function safeText(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
  function createText(value) {
    const p = document.createElement("p");
    p.textContent = String(value ?? "");
    return p;
  }
  function createActionButton(label, callback) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = label;
    button.addEventListener("click", callback);
    return button;
  }
  function setText(id, value) { if ($(id)) $(id).textContent = value ?? ""; }
  function setMessage(id, value) { if ($(id)) { $(id).textContent = value; $(id).classList.remove("hidden"); } }
  function hide(id) { if ($(id)) $(id).classList.add("hidden"); }
  function reveal(id) { if ($(id)) $(id).classList.remove("hidden"); }
  function getReferral() {
    const u = new URL(window.location.href);
    return (u.searchParams.get("ref") || u.searchParams.get("referral") || "").trim().toUpperCase();
  }
  function setButtonLoading(button, value) { setBusy(value, button); }

  async function loadProfile(user) {
    const { data, error } = await requireDatabase().from("profiles")
      .select("id,full_name,email,phone,role,account_status,referral_code,referred_by,country,education_level")
      .eq("id", user.id).maybeSingle();
    if (error) throw error;
    currentProfile = data;
    return data;
  }

  async function latestActivationRequest(userId) {
    const { data, error } = await requireDatabase().from("activation_requests")
      .select("id,user_id,phone,membership_level,status,created_at,verified_at,full_name,email")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
    if (error && !/does not exist|schema cache/i.test(error.message || "")) throw error;
    currentActivationRequest = data && data[0] ? data[0] : null;
    return currentActivationRequest;
  }

  function startReviewCountdown(startAt) {
    if (reviewTimer) clearInterval(reviewTimer);
    const start = Number(startAt) || Date.now();
    const tick = () => {
      const remaining = Math.max(0, REVIEW_DURATION_MS - (Date.now() - start));
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      const value = `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
      ["reviewCountdown", "pendingCountdown", "countdown"].forEach(id => setText(id, value));
      if (remaining <= 0) {
        if (reviewTimer) clearInterval(reviewTimer);
        setText("reviewExpired", "The six-hour review window has elapsed. Your account still requires manual approval.");
        setText("reviewMessage", `Your account is still under system checks. If six hours have passed, contact ${SUPPORT_EMAIL}.`);
      }
    };
    tick();
    reviewTimer = setInterval(tick, 1000);
  }

  async function hasFbkSubmission(userId) {
    const { data, error } = await requireDatabase().from("fbk_code_submissions")
      .select("id,status,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
    if (error) {
      if (/does not exist|schema cache/i.test(error.message || "")) return null;
      throw error;
    }
    return data && data[0] ? data[0] : null;
  }

  async function routeUser(user) {
    currentUser = user || null;
    if (reviewTimer) { clearInterval(reviewTimer); reviewTimer = null; }
    if (!user) {
      currentProfile = null; currentActivationRequest = null;
      showView($("loginView") ? "loginView" : "authView"); return;
    }
    try {
      const profile = await loadProfile(user);
      if (!profile) {
        showError("Your profile is still being created. Refresh in a moment or contact support.");
        showView("pendingView"); return;
      }
      if (String(profile.account_status || "").toLowerCase() === "approved") {
        await showDashboard(profile); return;
      }
      const fbk = await hasFbkSubmission(user.id).catch(err => {
        console.warn("Could not check FBK submission:", err); return null;
      });
      if (fbk && ["submitted", "reviewed"].includes(String(fbk.status || "").toLowerCase())) {
        showView("pendingView");
        setText("pendingLabel", "Awaiting manual activation approval");
        setText("reviewMessage", `Your FBK code is under system checks and administrator review. Processing may take up to six hours. The countdown is an estimate and does not approve your account. If it elapses, contact ${SUPPORT_EMAIL}.`);
        let started = Number(localStorage.getItem(REVIEW_KEY_PREFIX + user.id));
        if (!started) { started = fbk.created_at ? new Date(fbk.created_at).getTime() : Date.now(); localStorage.setItem(REVIEW_KEY_PREFIX + user.id, String(started)); }
        startReviewCountdown(started); return;
      }
      if (fbk && String(fbk.status || "").toLowerCase() === "rejected") {
        ensureVerificationView(); showView("verificationView");
        setText("verificationStatus", `Your previous FBK submission was rejected${fbk.admin_note ? ": " + fbk.admin_note : "."} You may submit a corrected code.`);
        if ($("verificationForm")) $("verificationForm").classList.remove("hidden");
        return;
      }
      const activation = await latestActivationRequest(user.id).catch(err => { console.warn("Could not read activation request:", err); return null; });
      if (activation && ["requested", "position_issued", "position_submitted", "position_accepted"].includes(activation.status)) {
        ensureVerificationView(); showView("verificationView");
        setText("verificationStatus", "Enter and submit your FBK code. After submission, your account will wait for one manual administrator decision.");
        if ($("verificationForm")) $("verificationForm").classList.remove("hidden");
        return;
      }
      ensureActivationView(); showView("activationView");
      const name = $("activationForm")?.querySelector('[name="full_name"]');
      const phone = $("activationForm")?.querySelector('[name="phone"]');
      if (name && !name.value) name.value = profile.full_name || "";
      if (phone && !phone.value) phone.value = profile.phone || "";
    } catch (error) {
      console.error("Routing error:", error);
      showError("Could not load your account status. Please refresh or contact support.");
    }
  }

  function ensureVerificationView() {
    if ($("verificationView") && $("verificationForm")) return $("verificationView");
    let view = $("verificationView");
    if (!view) {
      view = document.createElement("section"); view.id = "verificationView"; view.className = "panel page-panel hidden";
      view.innerHTML = '<p class="eyebrow">FBK SUBMISSION</p><h1>Submit your FBK code</h1><p id="verificationStatus">Submit your code for manual review.</p><form id="verificationForm" class="form"><label>FBK code<input name="fbk_code" autocomplete="off" required maxlength="80"></label><button class="primary full" type="submit">Submit FBK code</button></form><button id="logoutVerification" class="text-button" type="button">Log out</button>';
      const pending = $("pendingView"); if (pending?.parentNode) pending.parentNode.insertBefore(view, pending); else document.body.appendChild(view);
      bind("verificationForm", "submit", verifyActivationCode); bind("logoutVerification", "click", logout);
    }
    return view;
  }

  async function resetPassword() {
    const email = String($("resetEmail")?.value || $("loginForm")?.querySelector('[name="email"]')?.value || "").trim();
    if (!email) return showError("Enter your email address first.");
    try {
      const { error } = await requireDatabase().auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (error) throw error;
      notice("If the email is registered, a password-reset link will be sent.", "success");
    } catch (error) { showError(error.message || "Could not request password reset."); }
  }

  async function requestActivation(event) {
    event?.preventDefault();
    if (!currentUser) return showError("Please sign in first.");
    const form = $("activationForm");
    const levelInput = form?.querySelector('[name="membership_level"]') || $("membershipLevel");
    const level = Number(levelInput?.value || 1);
    const phone = cleanPhone(form?.querySelector('[name="phone"]')?.value || currentProfile?.phone);
    const fullName = String(form?.querySelector('[name="full_name"]')?.value || currentProfile?.full_name || "").trim();
    if (!phone) return showError("Enter your phone number.");
    const button = form?.querySelector('[type="submit"]');
    try {
      setButtonLoading(button, true);
      const { data, error } = await requireDatabase().rpc("scf_submit_activation", {
        p_full_name: fullName, p_phone: phone, p_membership_level: level
      });
      if (error) throw error;
      currentActivationRequest = data && typeof data === "object" ? data : null;
      notice("Activation request saved. Submit your FBK code for the single manual approval process.", "success");
      await routeUser(currentUser);
    } catch (error) {
      showError("Activation request failed: " + (error.message || "Please try again."));
    } finally { setButtonLoading(button, false); }
  }

  async function verifyActivationCode(event) {
    event?.preventDefault();
    if (!currentUser) return showError("Please sign in first.");
    const form = $("verificationForm");
    const input = form?.querySelector('[name="position_number"], [name="submitted_code"], [name="fbk_code"]');
    const code = String(input?.value || "").trim();
    if (!/^[A-Za-z0-9-]{2,80}$/.test(code)) return showError("Enter a valid FBK code.");
    const button = form?.querySelector('[type="submit"]');
    try {
      setButtonLoading(button, true);
      const { error } = await requireDatabase().from("fbk_code_submissions").insert({ user_id: currentUser.id, submitted_code: code, status: "submitted" });
      if (error) throw error;
      const started = Date.now(); localStorage.setItem(REVIEW_KEY_PREFIX + currentUser.id, String(started));
      if (input) input.value = "";
      notice("FBK code submitted. Your account is awaiting one manual administrator decision.", "success");
      showView("pendingView"); setText("pendingLabel", "Awaiting manual activation approval");
      setText("reviewMessage", `Your FBK code is under system checks and administrator review. Processing may take up to six hours. The countdown is an estimate only; it will not approve your account. Contact ${SUPPORT_EMAIL} if the time elapses.`);
      startReviewCountdown(started);
    } catch (error) { showError("Could not submit the FBK code: " + (error.message || "Please try again.")); }
    finally { setButtonLoading(button, false); }
  }

  async function refreshActivationStatus() {
    if (!currentUser) return;
    await routeUser(currentUser);
    notice("Account status refreshed.", "success");
  }

  async function contactSupport() {
    const subject = encodeURIComponent(`${BRAND_NAME} support`);
    const body = encodeURIComponent(`Hello Scholarbrige support,\n\nI need help with my account.\nAccount email: ${currentUser?.email || ""}\n`);
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  }

  function ensureTaskContainers() {
    const dashboard = $("dashboardView");
    if (!dashboard) return;
    let root = $("taskCentre");
    if (!root) {
      root = document.createElement("section");
      root.id = "taskCentre";
      root.className = "task-centre";
      root.innerHTML = `
        <div class="task-centre-heading"><h2>Earn by completing tasks</h2>
        <p>Ads and surveys pay KES 20 per approved task. Rewards remain pending until verified.</p></div>
        <div class="task-tabs" role="tablist">
          <button type="button" data-task-filter="all">All tasks</button>
          <button type="button" data-task-filter="ads">Ads tasks</button>
          <button type="button" data-task-filter="survey">Survey tasks</button>
          <button type="button" data-task-filter="other">Other tasks</button>
          <button type="button" id="refreshTasks">Refresh tasks</button>
        </div>
        <p id="taskNotice" role="status"></p><div id="taskList"></div>
        <section id="adminTaskReview" class="hidden"><h3>Task submissions for review</h3><div id="adminTaskList"></div></section>`;
      dashboard.appendChild(root);
    }
    if (!document.getElementById("scfTaskStyles")) {
      const style = document.createElement("style");
      style.id = "scfTaskStyles";
      style.textContent = `
        .task-centre{margin:24px 0;padding:18px;border:1px solid #b7d8ff;border-radius:16px;background:var(--surface,#fff);color:var(--text,#172033)}
        .task-centre h2,.task-centre h3{margin:0 0 8px}.task-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}
        .task-tabs button,.task-card button,.task-review-actions button{border:1px solid #8bbcff;border-radius:9px;padding:9px 12px;cursor:pointer}
        .task-card{border:1px solid #d8e3ef;border-radius:12px;padding:14px;margin:10px 0;background:rgba(120,160,200,.06)}
        .task-card h3{margin:0 0 6px}.task-meta{font-size:.9rem;opacity:.8}.task-card textarea,.task-card input{width:100%;box-sizing:border-box;margin:8px 0;padding:10px;border:1px solid #cbd5e1;border-radius:8px}
        .task-card button{margin:4px 5px 4px 0}.task-status{font-weight:600}.task-card .reward{font-weight:700}
        .task-centre .hidden{display:none!important}`;
      document.head.appendChild(style);
    }
    root.querySelectorAll("[data-task-filter]").forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => { root.dataset.filter = btn.dataset.taskFilter; loadTasks().catch(showTaskError); });
    });
    $("refreshTasks")?.addEventListener("click", () => loadTasks().catch(showTaskError));
  }

  function taskCategory(type) {
    const t = String(type || "").toLowerCase();
    if (["ad", "ads", "advert", "advertisement", "advertisements"].includes(t)) return "ads";
    if (["survey", "surveys", "questionnaire"].includes(t)) return "survey";
    return "other";
  }
  function taskReward(task) {
    const category = taskCategory(task.task_type);
    return category === "ads" || category === "survey" ? 20 : Number(task.reward_kes || 0);
  }
  function showTaskError(error) {
    console.error("Task loading error:", error);
    setText("taskNotice", "Tasks could not load. Check the tasks table and its Supabase r
