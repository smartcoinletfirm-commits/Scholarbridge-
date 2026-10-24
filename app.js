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
    setText("taskNotice", "Tasks could not load. Check the tasks table and its Supabase read policy, then refresh.");
  }

  async function loadTasks() {
    if (!currentUser || !currentProfile || currentProfile.account_status !== "approved") return;
    ensureTaskContainers();
    const list = $("taskList");
    if (!list) return;
    list.innerHTML = "<p>Loading tasks…</p>";
    const { data: tasks, error } = await requireDatabase().from("tasks")
      .select("id,title,description,task_type,reward_points,reward_kes,is_active,requires_review,created_at")
      .eq("is_active", true).order("created_at", { ascending: false });
    if (error) throw error;
    const { data: submissions, error: subError } = await requireDatabase().from("task_submissions")
      .select("id,task_id,status,submitted_at,reviewed_at,review_reason")
      .eq("user_id", currentUser.id).order("submitted_at", { ascending: false });
    if (subError) console.warn("Could not load task submission history:", subError);
    const latestByTask = new Map();
    (submissions || []).forEach(s => { if (!latestByTask.has(s.task_id)) latestByTask.set(s.task_id, s); });
    const filter = $("taskCentre")?.dataset.filter || "all";
    const filtered = (tasks || []).filter(t => filter === "all" || taskCategory(t.task_type) === filter);
    if (!filtered.length) {
      list.innerHTML = `<div class="task-card"><p>No ${filter === "all" ? "" : safeText(filter) + " "}tasks are available right now. Please check again later.</p></div>`;
      setText("taskNotice", "");
      return;
    }
    list.innerHTML = "";
    filtered.forEach(task => {
      const previous = latestByTask.get(task.id);
      const category = taskCategory(task.task_type);
      const reward = taskReward(task);
      const locked = previous && ["submitted", "pending", "under_review", "approved", "accepted", "completed"].includes(String(previous.status).toLowerCase());
      const card = document.createElement("article");
      card.className = "task-card";
      const statusText = previous ? `Latest submission: ${previous.status}${previous.review_reason ? " — " + previous.review_reason : ""}` : "Not submitted";
      card.innerHTML = `
        <h3>${safeText(task.title || "Task")}</h3>
        <p>${safeText(task.description || "Follow the task instructions and submit the requested evidence.")}</p>
        <p class="task-meta">Category: ${safeText(category === "ads" ? "Ads task" : category === "survey" ? "Survey task" : "Other task")}</p>
        <p class="reward">Reward: ${money(reward)}${category === "ads" || category === "survey" ? " after verification" : ""}</p>
        <p class="task-status">${safeText(statusText)}</p>
        ${locked ? "" : `<label>Evidence / completion details<textarea rows="3" data-evidence placeholder="Describe completion or paste the requested evidence link"></textarea></label>
        <button type="button" data-submit-task="${safeText(task.id)}">Submit for review</button>`}
        ${locked && ["rejected", "declined"].includes(String(previous.status).toLowerCase()) ? `<p>You may contact support if you believe this decision is incorrect.</p>` : ""}`;
      list.appendChild(card);
      card.querySelector("[data-submit-task]")?.addEventListener("click", () => submitTask(task, card));
    });
    setText("taskNotice", "Complete only tasks you are eligible to do. Do not submit false evidence. Rewards are subject to administrator verification.");
    if (currentProfile.role === "admin") loadAdminTaskSubmissions().catch(err => console.warn("Admin task queue:", err));
  }

  async function submitTask(task, card) {
    const evidence = String(card.querySelector("[data-evidence]")?.value || "").trim();
    if (!evidence) return setText("taskNotice", "Add evidence or completion details before submitting.");
    if (evidence.length > 5000) return setText("taskNotice", "Evidence is too long. Keep it under 5,000 characters.");
    const button = card.querySelector("[data-submit-task]");
    try {
      setButtonLoading(button, true);
      // The database must enforce duplicate prevention and permissions; this browser check is not security.
      const { data: prior, error: priorError } = await requireDatabase().from("task_submissions")
        .select("id,status").eq("user_id", currentUser.id).eq("task_id", task.id)
        .in("status", ["submitted", "pending", "under_review", "approved", "accepted", "completed"]).limit(1);
      if (priorError) throw priorError;
      if (prior?.length) throw new Error("You already have a pending or approved submission for this task.");
      const { error } = await requireDatabase().from("task_submissions").insert({
        task_id: task.id, user_id: currentUser.id, evidence, status: "submitted"
      });
      if (error) throw error;
      setText("taskNotice", "Submitted for administrator review. KES 20 is not added to your wallet until the submission is verified.");
      await loadTasks();
    } catch (error) {
      setText("taskNotice", "Submission failed: " + (error.message || "Check the task_submissions table policy."));
    } finally { setButtonLoading(button, false); }
  }

  async function loadAdminTaskSubmissions() {
    if (currentProfile?.role !== "admin") return;
    const panel = $("adminTaskReview"), list = $("adminTaskList");
    if (!panel || !list) return;
    panel.classList.remove("hidden");
    const { data, error } = await requireDatabase().from("task_submissions")
      .select("id,task_id,user_id,evidence,status,submitted_at,review_reason")
      .in("status", ["submitted", "pending", "under_review"]).order("submitted_at", { ascending: true }).limit(100);
    if (error) {
      list.innerHTML = `<p>Admin queue cannot load. Database review permissions or a secure review RPC may be required.</p>`;
      return;
    }
    if (!data?.length) { list.innerHTML = "<p>No task submissions are awaiting review.</p>"; return; }
    list.innerHTML = "";
    data.forEach(item => {
      const row = document.createElement("article");
      row.className = "task-card";
      row.innerHTML = `<p><strong>Task:</strong> ${safeText(item.task_id)}</p>
        <p><strong>User:</strong> ${safeText(item.user_id)}</p>
        <p><strong>Evidence:</strong></p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${safeText(item.evidence)}</pre>
        <p><strong>Status:</strong> ${safeText(item.status)}</p>
        <p>For security, approval and wallet crediting must be performed by a trusted Supabase function, not by direct browser updates.</p>`;
      list.appendChild(row);
    });
  }

  async function loadDashboardData() {
    if (!currentUser) return;
    const requestId = ++dashboardRequest;
    const walletEl = $("walletHeadline") || $("walletBalance") || $("availableBalance") || $("walletAmount");
    try {
      const { data: wallet, error } = await requireDatabase().from("wallets")
        .select("currency,available_balance,reserved_balance,total_withdrawn")
        .eq("user_id", currentUser.id).maybeSingle();
      if (requestId !== dashboardRequest) return;
      if (error) throw error;
      if (wallet) {
        if (walletEl) walletEl.textContent = money(wallet.available_balance);
        setText("reservedBalance", money(wallet.reserved_balance));
        setText("totalWithdrawn", money(wallet.total_withdrawn));
        setText("walletCurrency", wallet.currency || "KES");
      } else if (walletEl) walletEl.textContent = money(0);
    } catch (error) {
      console.warn("Wallet read failed:", error);
      if (walletEl) walletEl.textContent = "Wallet temporarily unavailable";
    }
    try {
      const { data: withdrawals, error } = await requireDatabase().from("withdrawal_requests")
        .select("id,amount,currency,status,created_at,admin_note")
        .eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      const history = $("withdrawalHistory");
      if (history) {
        history.innerHTML = withdrawals?.length ? withdrawals.map(w =>
          `<div class="history-item"><strong>${money(w.amount)}</strong> — ${safeText(w.status)} <small>${safeText(w.created_at ? new Date(w.created_at).toLocaleString() : "")}</small>${w.admin_note ? `<p>${safeText(w.admin_note)}</p>` : ""}</div>`
        ).join("") : "<p>No withdrawal requests yet.</p>";
      }
    } catch (error) { console.warn("Withdrawal history unavailable:", error); }
    try {
      const { count, error } = await requireDatabase().from("profiles")
        .select("id", { count: "exact", head: true }).eq("referred_by", currentProfile?.referral_code || "__no_referral_code__");
      if (!error && count !== null) setText("refCount", String(count));
    } catch (error) { console.warn("Referral count unavailable:", error); }
    await loadTasks().catch(showTaskError);
  }

  async function showDashboard(profile) {
    if (!profile || String(profile.account_status).toLowerCase() !== "approved") {
      showView("pendingView");
      setText("pendingLabel", "Awaiting manual activation approval");
      return;
    }
    showView("dashboardView");
    setText("memberName", profile.full_name || profile.email || "Member");
    setText("dashStatus", "Approved member");
    setText("refCode", profile.referral_code || "Your referral code is being prepared");
    setText("profileEmail", profile.email || currentUser?.email || "");
    if ($("adminActivationPanel")) $("adminActivationPanel").classList.toggle("hidden", profile.role !== "admin");
    if ($("adminSalePanel")) $("adminSalePanel").classList.toggle("hidden", profile.role !== "admin");
    if ($("sellAccountPanel")) $("sellAccountPanel").classList.remove("hidden");
    updateSalePrice();
    if (profile.role === "admin") {
      loadAdminActivationQueue().catch(err => console.warn("Activation queue:", err));
      loadAdminSaleQueue().catch(err => console.warn("Sale queue:", err));
      if (adminQueueTimer) clearInterval(adminQueueTimer);
      adminQueueTimer = setInterval(() => {
        loadAdminActivationQueue().catch(err => console.warn("Activation queue:", err));
        loadAdminSaleQueue().catch(err => console.warn("Sale queue:", err));
      }, 20000);
    } else if (adminQueueTimer) {
      clearInterval(adminQueueTimer); adminQueueTimer = null;
    }
    await loadDashboardData();
  }

  async function loadAdminActivationQueue() {
    if (currentProfile?.role !== "admin" || currentProfile?.account_status !== "approved" || !$("adminActivationPanel")) return;
    const list = $("adminActivationQueue"); if (!list) return;
    const { data, error } = await requireDatabase().from("fbk_code_submissions")
      .select("id,user_id,submitted_code,status,created_at,admin_note")
      .in("status", ["submitted", "reviewed", "rejected", "accepted"])
      .order("created_at", { ascending: true }).limit(100);
    if (error) { list.textContent = "FBK review queue could not load. Check the fbk_code_submissions admin policy."; setText("adminQueueStatus", "Queue unavailable."); return; }
    const waiting = (data || []).filter(item => ["submitted", "reviewed"].includes(String(item.status || "").toLowerCase()));
    setText("adminQueueStatus", `${waiting.length} FBK submission(s) awaiting action.`); list.replaceChildren();
    if (!data?.length) { list.appendChild(createText("No FBK submissions yet.")); return; }
    for (const item of data) {
      const { data: profile } = await requireDatabase().from("profiles").select("full_name,email,phone,account_status").eq("id", item.user_id).maybeSingle();
      const row = document.createElement("article"); row.className = "task-card";
      const title = document.createElement("strong"); title.textContent = `${profile?.full_name || profile?.email || item.user_id} · FBK: ${item.submitted_code}`; row.appendChild(title);
      row.appendChild(createText(`${profile?.phone || "No phone"} · Submitted ${item.created_at ? new Date(item.created_at).toLocaleString() : "date unavailable"} · Status: ${item.status}`));
      if (item.admin_note) row.appendChild(createText(`Previous review note: ${item.admin_note}`));
      const actions = document.createElement("div"); actions.className = "task-review-actions";
      if (["submitted", "reviewed"].includes(String(item.status || "").toLowerCase())) {
        actions.appendChild(createActionButton("Approve account", async () => {
          if (!window.confirm(`Approve ${profile?.full_name || profile?.email || item.user_id} and unlock dashboard access? Only approve after checking the FBK submission.`)) return;
          const note = window.prompt("Optional admin note:", "") || "";
          try { const { data: result, error: rpcError } = await requireDatabase().rpc("scf_review_fbk_activation", { p_submission_id: item.id, p_approve: true, p_admin_note: note }); if (rpcError) throw rpcError; notice("Account approved. Dashboard access is now enabled.", "success"); await loadAdminActivationQueue(); }
          catch (e) { showError("Approval failed: " + (e.message || e)); }
        }));
        actions.appendChild(createActionButton("Reject / request correction", async () => {
          const note = window.prompt("Enter the reason for rejection (required):", ""); if (note === null) return; if (!note.trim()) return showError("Enter a rejection reason.");
          try { const { error: rpcError } = await requireDatabase().rpc("scf_review_fbk_activation", { p_submission_id: item.id, p_approve: false, p_admin_note: note.trim() }); if (rpcError) throw rpcError; notice("FBK submission rejected with a reason. The member can submit a corrected code.", "success"); await loadAdminActivationQueue(); }
          catch (e) { showError("Rejection failed: " + (e.message || e)); }
        }));
      }
      row.appendChild(actions); list.appendChild(row);
    }
  }

  const ACCOUNT_SALE_PRICES = { 4: 4200, 5: 12880, 6: 18000.80 };
  function updateSalePrice() {
    const level = Number($("sellAccountLevel")?.value || 4);
    setText("sellAccountPrice", `Indicative service price: ${money(ACCOUNT_SALE_PRICES[level] || 0)}. Confirm details with support before payment.`);
  }
  async function submitAccountSale(event) {
    event?.preventDefault();
    if (!currentUser) return showError("Please sign in first.");
    const level = Number($("sellAccountLevel")?.value || 4);
    try {
      setText("sellAccountStatus", "Submitting request…");
      const { data, error } = await requireDatabase().functions.invoke("scholarbridge-activation", { body: { action: "sale_request", account_level: level } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setText("sellAccountStatus", "Request submitted for administrator review.");
    } catch (error) { setText("sellAccountStatus", "Request failed: " + (error.message || "Please contact support.")); }
  }
  async function loadAdminSaleQueue() {
    if (currentProfile?.role !== "admin" || !$("adminSalePanel")) return;
    $("adminSalePanel").classList.remove("hidden");
    const list = $("adminSaleQueue"); if (!list) return;
    const { data, error } = await requireDatabase().from("account_sale_requests").select("*").order("created_at", { ascending: false }).limit(50);
    if (error) { list.textContent = "Sale queue could not load. Check table permissions."; return; }
    list.innerHTML = "";
    if (!data?.length) { list.textContent = "No account sale requests."; return; }
    data.forEach(item => { const row = document.createElement("article"); row.className = "task-card"; row.textContent = `Request ${item.id || ""} · Level ${item.level || item.membership_level || "—"} · ${item.status || "pending"} · ${money(item.price || item.amount || 0)}`; list.appendChild(row); });
  }

  async function logout() {
    try { if (db) await db.auth.signOut(); }
    catch (error) { console.warn("Sign out issue:", error); }
    currentUser = null; currentProfile = null;
    if (adminQueueTimer) clearInterval(adminQueueTimer);
    if (reviewTimer) clearInterval(reviewTimer);
    showView($("loginView") ? "loginView" : "authView");
  }

  async function copyReferral() {
    const code = String($("refCode")?.textContent || currentProfile?.referral_code || "").trim();
    if (!code || code.includes("prepared")) return notice("Your referral code is not available yet.", "error");
    const link = `${window.location.origin}${window.location.pathname}?ref=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      notice("Referral link copied. Share it with friends.", "success");
    } catch {
      window.prompt("Copy your referral link:", link);
    }
  }
  async function shareInvite() {
    const code = String($("refCode")?.textContent || currentProfile?.referral_code || "").trim();
    const link = `${window.location.origin}${window.location.pathname}?ref=${encodeURIComponent(code)}`;
    const text = `Join ${BRAND_NAME}. Connect, learn and grow: ${link}`;
    try {
      if (navigator.share) await navigator.share({ title: BRAND_NAME, text, url: link });
      else { await navigator.clipboard.writeText(text); notice("Invite text copied.", "success"); }
    } catch (error) { if (error.name !== "AbortError") notice("Share cancelled or unavailable.", "info"); }
  }

  function applyTheme(theme) {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    THEME_ORDER.forEach(t => document.body?.classList.toggle(t, t === theme));
    try { localStorage.setItem("scholarbrige_theme", theme); } catch {}
  }
  function rotateTheme() {
    try {
      const started = Number(localStorage.getItem(THEME_KEY)) || Date.now();
      if (!localStorage.getItem(THEME_KEY)) localStorage.setItem(THEME_KEY, String(started));
      const index = Math.floor((Date.now() - started) / THEME_INTERVAL) % THEME_ORDER.length;
      applyTheme(THEME_ORDER[index]);
    } catch {}
  }

  function bind(id, event, handler) {
    const el = $(id);
    if (el && !el.dataset.appBound) {
      el.addEventListener(event, handler);
      el.dataset.appBound = "1";
    }
  }
  function bindEvents() {
    bind("signupForm", "submit", signup);
    bind("loginForm", "submit", login);
    bind("activationForm", "submit", requestActivation);
    bind("verificationForm", "submit", verifyActivationCode);
    bind("sellAccountForm", "submit", submitAccountSale);
    bind("refreshSaleQueue", "click", () => loadAdminSaleQueue().catch(showError));
    bind("sellAccountLevel", "change", updateSalePrice);
    bind("resetPassword", "click", resetPassword);
    bind("forgotPassword", "click", () => showView("forgotPasswordView"));
    bind("showSignup", "click", () => showView("signupView"));
    bind("showLogin", "click", () => showView("loginView"));
    bind("checkVerification", "click", refreshActivationStatus);
    bind("refreshActivationQueue", "click", () => loadAdminActivationQueue().catch(showError));
    bind("enableActivationAlerts", "click", async () => {
      try {
        if ("Notification" in window && Notification.permission !== "granted") await Notification.requestPermission();
        notice("Review alerts enabled where your browser permits notifications. Keep this page open to monitor the queue.", "success");
      } catch (e) { notice("Browser notifications are unavailable; the queue can still be refreshed manually.", "info"); }
    });
    bind("checkStatus", "click", refreshActivationStatus);
    bind("checkPending", "click", refreshActivationStatus);
    bind("dashLogout", "click", logout);
    bind("logoutDashboard", "click", logout);
    bind("logoutVerification", "click", logout);
    bind("logoutActivation", "click", logout);
    bind("logoutPending", "click", logout);
    bind("logout", "click", logout);
    bind("copyReferral", "click", copyReferral);
    bind("shareInvite", "click", shareInvite);
    bind("showSupport", "click", contac
