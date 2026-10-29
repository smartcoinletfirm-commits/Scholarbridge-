/* Scholarbrige Academic Hub — complete replacement app.js
   Uses the existing HTML IDs and Supabase project.
   Important:
   - Keep the Supabase publishable/anon key here; never put a service-role key in browser code.
   - Account approval is manual. A countdown never approves an account.
   - Admin-only data is still protected by Supabase RLS; hiding a panel is not security.
*/
(() => {
  "use strict";

  const SUPABASE_URL = "https://vulbvlardmvvxdhqyopn.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hve5CvGEO3tyocvupHOv9w_zEVEaN9a";
  const SUPPORT_EMAIL = "smart@gmail.com";
  const BRAND_NAME = "Scholarbrige Academic Hub";
  const REVIEW_DURATION_MS = 6 * 60 * 60 * 1000;
  const REVIEW_KEY_PREFIX = "scholarbridge_review_started_v1:";
  const CODE_DELAY_KEY_PREFIX = "scholarbridge_code_processing_";
  const THEME_ORDER = ["sky-blue", "lavender", "forest-green", "rose-pink", "light-mode"];
  const THEME_INTERVAL = 40 * 60 * 1000;
  const THEME_KEY = "scholarbrige_theme_rotation_started_v1";
  const ACTIVATION_FEES = { 1: 500, 2: 1005, 3: 1780, 4: 2670 };
  const $ = id => document.getElementById(id);

  let db = null;
  let currentUser = null;
  let currentProfile = null;
  let currentActivationRequest = null;
  let adminQueueTimer = null;
  let notificationTimer = null;
  let reviewTimer = null;
  let dashboardRequest = 0;
  let authListenerRegistered = false;
  let notificationAudio = null;
  let notificationSoundEnabled = false;
  let newestNotificationId = null;

  try {
    if (window.supabase && typeof window.supabase.createClient === "function") {
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    }
  } catch (error) {
    console.error("Supabase setup failed:", error);
  }

  function requireDatabase() {
    if (!db) throw new Error("Supabase did not load. Check your internet connection and the Supabase script in index.html.");
    return db;
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value == null ? "" : String(value);
  }

  function showNotice(message, type = "info", target = "globalMessage") {
    const element = $(target) || $("globalMessage");
    if (!element) return;
    element.textContent = message;
    element.classList.remove("hidden", "success", "error", "warning");
    if (type === "success") element.classList.add("success");
    if (type === "error") element.classList.add("error");
    if (type === "warning") element.classList.add("warning");
    element.setAttribute("role", "status");
  }

  function notice(message, type = "info") {
    showNotice(message, type);
  }

  function showError(message) {
    showNotice(message, "error", $("authView") && !$("authView").classList.contains("hidden") ? "authNotice" : "globalMessage");
  }

  function hideNotices() {
    ["globalMessage", "authNotice"].forEach(id => {
      const el = $(id);
      if (el) el.classList.add("hidden");
    });
  }

  function cleanPhone(value) {
    return String(value || "").trim().replace(/[^\d+]/g, "").slice(0, 30);
  }

  function formatMoney(value) {
    const amount = Number(value || 0);
    return "KES " + amount.toLocaleString("en-KE", { maximumFractionDigits: 2 });
  }

  // Wallet records remain stored and processed in KES. This formatter only
  // converts the displayed estimate for the member's selected country.
  const COUNTRY_CURRENCY = {
    Kenya:    { code: "KES", symbol: "KES", perKes: 1,      locale: "en-KE", decimals: 2 },
    Uganda:   { code: "UGX", symbol: "UGX", perKes: 33.50, locale: "en-UG", decimals: 0 },
    Tanzania: { code: "TZS", symbol: "TZS", perKes: 20.34, locale: "en-TZ", decimals: 0 },
    Ghana:    { code: "GHS", symbol: "GH₵", perKes: 0.0899,locale: "en-GH", decimals: 2 },
    Nigeria:  { code: "NGN", symbol: "₦",   perKes: 10.35, locale: "en-NG", decimals: 2 }
  };

  function getMemberCurrency() {
    const country = currentProfile?.country || $("countrySelect")?.value || "Kenya";
    return COUNTRY_CURRENCY[country] || COUNTRY_CURRENCY.Kenya;
  }

  function formatBalanceMoney(value) {
    const currency = getMemberCurrency();
    const amount = Number(value || 0) * currency.perKes;
    return `${currency.symbol} ${amount.toLocaleString(currency.locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: currency.decimals
    })}`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function setButtonLoading(button, loading, busyText = "Please wait…") {
    if (!button) return;
    if (loading) {
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = busyText;
    } else {
      button.disabled = false;
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    }
  }

  function showView(id) {
    const views = ["authView", "activationView", "verificationView", "pendingView", "dashboardView", "supportView"];
    views.forEach(viewId => {
      const element = $(viewId);
      if (element) element.classList.toggle("hidden", viewId !== id);
    });
    hideNotices();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bind(id, eventName, handler) {
    const element = $(id);
    if (!element || element.dataset.appBound === "true") return;
    element.addEventListener(eventName, handler);
    element.dataset.appBound = "true";
  }

  async function loadProfile(user = currentUser) {
    if (!user) return null;
    const client = requireDatabase();
    const { data, error } = await client
      .from("profiles")
      .select("id,full_name,username,email,phone,education_level,country,age_confirmed,referral_code,referred_by,avatar_path,theme,role,account_status,created_at,updated_at")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;
    currentProfile = data || null;
    return currentProfile;
  }

  async function latestActivationRequest(userId = currentUser?.id) {
    if (!userId) return null;
    const { data, error } = await requireDatabase()
      .from("activation_requests")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.warn("Could not read activation request:", error.message);
      return null;
    }
    currentActivationRequest = data?.[0] || null;
    return currentActivationRequest;
  }

  async function latestFbkSubmission(userId = currentUser?.id) {
    if (!userId) return null;
    const { data, error } = await requireDatabase()
      .from("fbk_code_submissions")
      .select("id,user_id,submitted_code,status,admin_note,created_at,reviewed_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.warn("Could not read FBK submission:", error.message);
      return null;
    }
    return data?.[0] || null;
  }

  async function sendAdminAlert(eventType, code = null) {
    try {
      const { error } = await requireDatabase().rpc("scholarbrige_create_admin_notification", {
        p_event_type: eventType,
        p_submitted_fbk_code: code
      });
      if (error) throw error;
    } catch (error) {
      // Notifications must never prevent a member's main action from completing.
      console.error("Admin notification failed:", error);
    }
  }

  function showPersonalReminder() {
    const name = currentProfile?.full_name || "scholar";
    notice(`Hello ${name} 👋 Please use the same WhatsApp-connected phone number for your FBK process. Submit only the correct details.`, "info");
  }

  function startReviewCountdown(startedAt) {
    const countdown = $("reviewCountdown");
    if (reviewTimer) clearInterval(reviewTimer);

    const start = Number(startedAt) || Date.now();
    const endAt = start + REVIEW_DURATION_MS;

    const update = () => {
      const remaining = Math.max(0, endAt - Date.now());
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      if (countdown) {
        countdown.textContent = [hours, minutes, seconds]
          .map(number => String(number).padStart(2, "0")).join(":");
      }
      if (remaining <= 0) {
        if (reviewTimer) clearInterval(reviewTimer);
        reviewTimer = null;
        setText("reviewMessage", "The estimated review window has ended. Your account still requires a manual administrator decision.");
        const expired = $("reviewExpired");
        if (expired) {
          expired.textContent = "The estimated time has passed. Refresh your status to check for an administrator decision.";
          expired.classList.remove("hidden");
        }
      }
    };

    update();
    reviewTimer = setInterval(update, 1000);
  }

  function startPendingView() {
    const key = REVIEW_KEY_PREFIX + (currentUser?.id || "unknown");
    let started = Number(localStorage.getItem(key));
    if (!started || !Number.isFinite(started)) {
      started = Date.now();
      localStorage.setItem(key, String(started));
    }
    showView("pendingView");
    setText("pendingLabel", "Your FBK submission is waiting for a manual administrator decision.");
    setText("reviewMessage", "Processing may take up to six hours. This countdown is an estimate and does not approve your account.");
    const expired = $("reviewExpired");
    if (expired) expired.classList.add("hidden");
    startReviewCountdown(started);
  }

  function ensureActivationView() {
    const form = $("activationForm");
    if (!form) return;
    if (currentProfile) {
      const fullName = form.querySelector('[name="full_name"]');
      const phone = form.querySelector('[name="phone"]');
      if (fullName && !fullName.value) fullName.value = currentProfile.full_name || "";
      if (phone && !phone.value) phone.value = currentProfile.phone || "";
    }
    const select = $("membershipLevel");
    if (select && currentActivationRequest?.membership_level) {
      select.value = String(currentActivationRequest.membership_level);
    }
  }

  function ensureVerificationView() {
    const form = $("verificationForm");
    if (form) {
      const input = form.querySelector('[name="position_number"], [name="submitted_code"], [name="fbk_code"]');
      if (input) input.autocomplete = "off";
    }
  }

  async function routeUser(user = currentUser) {
    if (!user) {
      if (reviewTimer) clearInterval(reviewTimer);
      showView("authView");
      return;
    }

    const requestNumber = ++dashboardRequest;
    try {
      const profile = await loadProfile(user);
      if (requestNumber !== dashboardRequest) return;

      if (!profile) {
        showView("authView");
        showError("Your account profile could not be found. Please contact support.");
        return;
      }

      if (profile.account_status === "approved") {
        if (reviewTimer) clearInterval(reviewTimer);
        const pendingKey = REVIEW_KEY_PREFIX + user.id;
        localStorage.removeItem(pendingKey);
        localStorage.removeItem(CODE_DELAY_KEY_PREFIX + user.id);
        await showDashboard(profile);
        return;
      }

      if (profile.account_status === "rejected" || profile.account_status === "suspended") {
        showView("pendingView");
        setText("pendingLabel", profile.account_status === "rejected"
          ? "Your application was rejected. Contact support or follow the administrator's instructions before resubmitting."
          : "Your account is suspended. Contact support for assistance.");
        setText("reviewMessage", "This account status can only be changed by an authorized administrator.");
        if ($("reviewCountdown")) $("reviewCountdown").textContent = "--:--:--";
        return;
      }

      const activation = await latestActivationRequest(user.id);
      if (requestNumber !== dashboardRequest) return;

      const fbk = await latestFbkSubmission(user.id);
      if (requestNumber !== dashboardRequest) return;

      if (fbk && ["submitted", "reviewed"].includes(fbk.status)) {
        startPendingView();
        return;
      }

      if (activation && ["requested", "position_issued", "position_submitted", "position_accepted"].includes(activation.status)) {
        ensureVerificationView();
        showView("verificationView");
        setText("verificationStatus", fbk?.status === "rejected"
          ? `Your previous FBK submission was rejected. ${fbk.admin_note ? "Admin note: " + fbk.admin_note + " " : ""}Enter the corrected FBK code and submit it again.`
          : "Enter and submit your FBK code. After submission, your account waits for one manual administrator decision.");
        const form = $("verificationForm");
        if (form) form.classList.remove("hidden");

        const pageAlertKey = "scholarbrige_fbk_page_alert_" + user.id;
        if (!sessionStorage.getItem(pageAlertKey)) {
          sessionStorage.setItem(pageAlertKey, "sent");
          await sendAdminAlert("fbk_page_opened");
        }
        return;
      }

      ensureActivationView();
      showView("activationView");
      setText("activationStatus", "Choose a membership level and confirm your phone number to continue.");
    } catch (error) {
      console.error("Account routing failed:", error);
      showView("authView");
      showError("Could not load your account. Please refresh and try again.");
    }
  }

  async function signup(event) {
    event?.preventDefault();
    hideNotices();

    const form = $("signupForm");
    if (!form || !form.reportValidity()) return;

    const values = new FormData(form);
    const fullName = String(values.get("full_name") || "").trim();
    const email = String(values.get("email") || "").trim().toLowerCase();
    const phone = cleanPhone(values.get("phone"));
    const country = String(values.get("country") || "").trim();
    const educationLevel = String(values.get("education_level") || "").trim();
    const password = String(values.get("password") || "");
    const referralCode = String(values.get("referral_code") || "").trim() || null;
    const ageConfirmed = values.get("age_confirmed") === "on";
    const button = form.querySelector('[type="submit"]');

    if (!ageConfirmed) return showError("Please confirm that you are 18 years old or above.");
    if (!phone) return showError("Enter a valid phone number.");

    try {
      setButtonLoading(button, true, "Creating account…");
      const { data, error } = await requireDatabase().auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone,
            country,
            education_level: educationLevel,
            referral_code: referralCode,
            age_confirmed: ageConfirmed
          }
        }
      });
      if (error) throw error;

      if (data?.user && data.session) {
        currentUser = data.user;
        await loadProfile(currentUser);
        notice("Account created. Continue to membership activation.", "success");
        await routeUser(currentUser);
      } else {
        notice("Your sign-up was received. If email confirmation is enabled in Supabase, complete that step before logging in.", "success");
        const loginForm = $("loginForm");
        if (loginForm) {
          const emailInput = loginForm.querySelector('[name="email"]');
          if (emailInput) emailInput.value = email;
        }
        activateTab("loginForm");
      }
    } catch (error) {
      console.error("Signup error:", error);
      showError("Could not create account: " + (error.message || "Please check your details and try again."));
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function login(event) {
    event?.preventDefault();
    hideNotices();

    const form = $("loginForm");
    if (!form || !form.reportValidity()) return;
    const values = new FormData(form);
    const email = String(values.get("email") || "").trim().toLowerCase();
    const password = String(values.get("password") || "");
    const button = form.querySelector('[type="submit"]');

    try {
      setButtonLoading(button, true, "Signing in…");
      const { data, error } = await requireDatabase().auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user;
      await routeUser(currentUser);
    } catch (error) {
      console.error("Login error:", error);
      showError("Login failed: " + (error.message || "Check your email and password."));
    } finally {
      setButtonLoading(button, false);
    }
  }
async function resetPassword() {
    const email = String($("loginForm")?.querySelector('[name="email"]')?.value || "").trim().toLowerCase();
    if (!email) {
      notice("Enter your email address in the login form first.", "warning");
      return;
    }
    try {
      const { error } = await requireDatabase().auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (error) throw error;
      notice("If password recovery is enabled, a reset link will be sent to your email.", "success");
    } catch (error) {
      console.error("Password reset error:", error);
      showError("Could not request a password reset: " + (error.message || "Please try again."));
    }
  }

  async function requestActivation(event) {
    event?.preventDefault();
    if (!currentUser) return showError("Please sign in first.");

    const form = $("activationForm");
    if (!form || !form.reportValidity()) return;
    const levelInput = form.querySelector('[name="membership_level"]') || $("membershipLevel");
    const level = Number(levelInput?.value || 1);
    const phone = cleanPhone(form.querySelector('[name="phone"]')?.value || currentProfile?.phone);
    const fullName = String(form.querySelector('[name="full_name"]')?.value || currentProfile?.full_name || "").trim();
    const button = form.querySelector('[type="submit"]');

    if (!phone) return showError("Enter your phone number.");
    if (!ACTIVATION_FEES[level]) return showError("Choose a valid membership level.");

    try {
      setButtonLoading(button, true, "Saving request…");
      const { data, error } = await requireDatabase().rpc("scf_submit_activation", {
        p_full_name: fullName,
        p_phone: phone,
        p_membership_level: level
      });
      if (error) throw error;

      currentActivationRequest = data && typeof data === "object" ? data : null;
      await sendAdminAlert("activation_requested");

      // If the RPC does not return a row, re-read the saved request.
      if (!currentActivationRequest) await latestActivationRequest(currentUser.id);
      notice("Activation request saved. Continue to submit your FBK code.", "success");
      await routeUser(currentUser);
    } catch (error) {
      console.error("Activation request error:", error);
      showError("Activation request failed: " + (error.message || "Please try again."));
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function verifyActivationCode(event) {
    event?.preventDefault();
    if (!currentUser) return showError("Please sign in first.");

    const form = $("verificationForm");
    if (!form || !form.reportValidity()) return;
    const input = form.querySelector('[name="position_number"], [name="submitted_code"], [name="fbk_code"]');
    const code = String(input?.value || "").trim();
    if (!/^[A-Za-z0-9-]{2,80}$/.test(code)) return showError("Enter a valid FBK code.");

    const button = form.querySelector('[type="submit"]');
    const client = requireDatabase();

    try {
      setButtonLoading(button, true, "Submitting code…");
      const { data: previous, error: lookupError } = await client
        .from("fbk_code_submissions")
        .select("id,status")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (lookupError) throw lookupError;

      const latest = previous?.[0];
      if (latest && ["submitted", "reviewed"].includes(latest.status)) {
        return showError("Your FBK code is already under review. Wait for the administrator's decision.");
      }

      if (latest && latest.status === "rejected") {
        const { error } = await client
          .from("fbk_code_submissions")
          .update({
            submitted_code: code,
            status: "submitted",
            admin_note: null,
            reviewed_at: null
          })
          .eq("id", latest.id)
          .eq("user_id", currentUser.id);
        if (error) throw error;
      } else {
        const { error } = await client
          .from("fbk_code_submissions")
          .insert({
            user_id: currentUser.id,
            submitted_code: code,
            status: "submitted"
          });
        if (error) throw error;
      }

      await sendAdminAlert("fbk_submitted", code);
      upgradeMode = false;

      const key = CODE_DELAY_KEY_PREFIX + currentUser.id;
      const started = Date.now();
      localStorage.setItem(key, String(started));
      localStorage.setItem(REVIEW_KEY_PREFIX + currentUser.id, String(started));
      if (input) input.value = "";

      setText("verificationStatus", "Your FBK code has been received and is awaiting a manual administrator decision.");
      notice("Your FBK code was submitted. Your account will not activate automatically.", "success");
      startPendingView();
    } catch (error) {
      console.error("FBK submission error:", error);
      showError("Could not submit your FBK code: " + (error.message || "Please try again."));
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function refreshStatus() {
    if (!currentUser) return showError("Please sign in first.");
    await routeUser(currentUser);
    notice("Account status refreshed.", "success");
  }

  async function logout() {
    try {
      if (notificationTimer) clearInterval(notificationTimer);
      if (adminQueueTimer) clearInterval(adminQueueTimer);
      if (reviewTimer) clearInterval(reviewTimer);
      if (chatRefreshTimer) clearInterval(chatRefreshTimer);
      notificationTimer = adminQueueTimer = reviewTimer = chatRefreshTimer = null;
      const { error } = await requireDatabase().auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      currentUser = null;
      currentProfile = null;
      currentActivationRequest = null;
      showView("authView");
      notice("You have signed out.", "success");
    }
  }

  function activateTab(formId) {
    document.querySelectorAll("[data-tab]").forEach(button => {
      const active = button.dataset.tab === formId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    ["loginForm", "signupForm"].forEach(id => {
      const form = $(id);
      if (form) form.classList.toggle("hidden", id !== formId);
    });
  }

  async function contactSupport() {
    const subject = encodeURIComponent(BRAND_NAME + " support request");
    const body = encodeURIComponent("Hello Scholarbrige Support,\n\nI need help with my account.\n\nName: " + (currentProfile?.full_name || "") + "\nEmail: " + (currentUser?.email || "") + "\n");
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  }

  async function loadDashboardData() {
    if (!currentUser || !currentProfile) return;
    setText("memberName", currentProfile.full_name || currentProfile.username || "Scholar");
    setText("dashStatus", "Your Scholarbrige space is ready.");
    setText("refCode", currentProfile.referral_code || "Not available");
    const statusWord = document.querySelector(".status-word");
    if (statusWord) statusWord.textContent = currentProfile.account_status === "approved" ? "Active" : currentProfile.account_status || "Pending";

    const client = requireDatabase();
    try {
      const { data: referrals, error } = await client
        .from("referrals")
        .select("id")
        .eq("referrer_id", currentUser.id);
      if (error) throw error;
      setText("refCount", referrals?.length || 0);
    } catch (error) {
      console.warn("Referral count unavailable:", error.message);
      setText("refCount", "—");
    }

    try {
      const { data: wallet, error } = await client
        .from("wallets")
        .select("*")
        .eq("user_id", currentUser.id)
        .maybeSingle();
      if (error) throw error;
      setText("walletHeadline", formatBalanceMoney(wallet?.balance ?? wallet?.available_balance ?? 0));
      setText("reservedBalance", formatBalanceMoney(wallet?.reserved_balance ?? 0));
      setText("totalWithdrawn", formatBalanceMoney(wallet?.total_withdrawn ?? 0));
      const walletNote = document.querySelector("#walletHeadline")?.closest(".wallet-metric")?.querySelector(".wallet-currency-note");
      if (walletNote) walletNote.textContent = `Approximate ${getMemberCurrency().code} display. Official wallet records remain in KES.`;
    } catch (error) {
      console.warn("Wallet information unavailable:", error.message);
      setText("walletHeadline", `${getMemberCurrency().symbol} —`);
      setText("reservedBalance", `${getMemberCurrency().symbol} —`);
      setText("totalWithdrawn", `${getMemberCurrency().symbol} —`);
    }

    await loadTasks();
  }

  async function showDashboard(profile) {
    currentProfile = profile || currentProfile;
    showView("dashboardView");

    const isAdmin = currentProfile?.role === "admin" && currentProfile?.account_status === "approved";
    ["adminActivationPanel", "adminSalePanel", "adminTaskReview", "scholarbrigeAdminPanel"].forEach(id => {
      const element = $(id);
      if (element) element.classList.toggle("hidden", !isAdmin);
    });

    if (isAdmin) {
      loadAdminActivationQueue().catch(error => console.warn("Activation queue:", error));
      loadAdminSaleQueue().catch(error => console.warn("Sale queue:", error));
      loadAdminTaskSubmissions().catch(error => console.warn("Task review:", error));
      loadScholarbrigeAdminPanel().catch(error => console.warn("Admin notifications:", error));

      if (adminQueueTimer) clearInterval(adminQueueTimer);
      adminQueueTimer = setInterval(() => {
        loadAdminActivationQueue().catch(error => console.warn("Activation queue:", error));
        loadAdminSaleQueue().catch(error => console.warn("Sale queue:", error));
      }, 20000);
    } else {
      if (adminQueueTimer) clearInterval(adminQueueTimer);
      if (notificationTimer) clearInterval(notificationTimer);
      adminQueueTimer = notificationTimer = null;
    }

    await latestActivationRequest(currentUser.id);
    updateUpgradeOptions();
    if (currentProfile?.avatar_path) {
      const { data: avatarData } = requireDatabase().storage.from("scholarbrige-avatars").getPublicUrl(currentProfile.avatar_path);
      if (avatarData?.publicUrl && $("memberAvatar")) $("memberAvatar").src = avatarData.publicUrl;
    }
    await loadWithdrawalHistory();
    await loadDashboardData();
  }

  async function loadTasks() {
    if (!currentUser || !currentProfile || currentProfile.account_status !== "approved") return;
    const list = $("taskList");
    if (!list) return;
    list.textContent = "Loading available tasks…";
    try {
      const { data, error } = await requireDatabase()
        .from("tasks")
        .select("id,title,description,reward_kes,reward_points,is_active,created_at")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      list.replaceChildren();
      if (!data?.length) {
        list.textContent = "No active tasks are available right now.";
        setText("taskNotice", "");
        return;
      }
      data.forEach(task => {
        const card = document.createElement("article");
        card.className = "task-card";
        const title = document.createElement("h3");
        title.textContent = task.title || "Learning task";
        const description = document.createElement("p");
        description.textContent = task.description || "Open this task and follow its instructions.";
        const reward = document.createElement("p");
        reward.textContent = "Reward: " + formatMoney(task.reward_kes ?? 20);
        const form = document.createElement("form");
        form.className = "form";
        const label = document.createElement("label");
        label.textContent = "Your response";
        const textarea = document.createElement("textarea");
        textarea.name = "response";
        textarea.required = true;
        textarea.rows = 3;
        textarea.placeholder = "Enter your completed work or submission link";
        label.appendChild(textarea);
        const submit = document.createElement("button");
        submit.type = "submit";
        submit.className = "primary";
        submit.textContent = "Submit task";
        form.append(label, submit);
        form.addEventListener("submit", event => submitTask(event, task.id, textarea, submit));
        card.append(title, description, reward, form);
        list.appendChild(card);
      });
      setText("taskNotice", "Task rewards remain pending until reviewed.");
    } catch (error) {
      console.error("Task loading error:", error);
      list.textContent = "Tasks could not load. Check the tasks table and its Supabase read policy, then refresh.";
    }
  }

  async function submitTask(event, taskId, textarea, button) {
    event.preventDefault();
    const response = String(textarea.value || "").trim();
    if (!response) return;
    try {
      setButtonLoading(button, true, "Submitting…");
      const { error } = await requireDatabase().from("task_submissions").insert({
        task_id: taskId,
        user_id: currentUser.id,
        submission_text: response,
        status: "submitted"
      });
      if (error) throw error;
      textarea.value = "";
      notice("Task submitted for review. Any reward remains pending until approval.", "success");
    } catch (error) {
      console.error("Task submission error:", error);
      notice("Could not submit task: " + (error.message || "Please try again."), "error");
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function loadAdminActivationQueue() {
    if (!currentUser || currentProfile?.role !== "admin" || currentProfile?.account_status !== "approved") return;
    const root = $("adminActivationQueue");
    if (!root) return;
    setText("adminQueueStatus", "Loading FBK submissions…");

    try {
      const { data, error } = await requireDatabase()
        .from("fbk_code_submissions")
        .select("id,user_id,submitted_code,status,admin_note,created_at,reviewed_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;

      const rows = data || [];
      const userIds = [...new Set(rows.map(row => row.user_id).filter(Boolean))];
      let profiles = [];
      if (userIds.length) {
        const result = await requireDatabase()
          .from("profiles")
          .select("id,full_name,email,phone,country,account_status,role")
          .in("id", userIds);
        if (result.error) throw result.error;
        profiles = result.data || [];
      }
      const profileMap = new Map(profiles.map(profile => [profile.id, profile]));
      root.replaceChildren();

      if (!rows.length) {
        root.textContent = "No FBK submissions yet.";
        setText("adminQueueStatus", "No submissions are waiting.");
        return;
      }

      rows.forEach(row => {
        const profile = profileMap.get(row.user_id) || {};
        const card = document.createElement("article");
        card.className = "task-card";
        const heading = document.createElement("h3");
        heading.textContent = `${profile.full_name || "Member"} — ${row.status || "submitted"}`;
        const details = document.createElement("p");
        details.textContent = `Phone: ${profile.phone || "—"} · Email: ${profile.email || "—"} · Country: ${profile.country || "—"}`;
        const code = document.createElement("p");
        code.textContent = "FBK number: " + (row.submitted_code || "—");
        const date = document.createElement("p");
        date.textContent = "Submitted: " + (row.created_at ? new Date(row.created_at).toLocaleString() : "—");
        const note = document.createElement("p");
        note.textContent = "Admin note: " + (row.admin_note || "—");
        card.append(heading, details, code, date, note);

        if (row.status === "submitted" || row.status === "reviewed") {
          const actions = document.createElement("div");
          actions.className = "sb-admin-actions";
          const approve = document.createElement("button");
          approve.type = "button";
          approve.className = "primary";
          approve.textContent = "Approve account";
          approve.addEventListener("click", () => reviewFbkSubmission(row, "approved", profile, approve));
          const reject = document.createElement("button");
          reject.type = "button";
          reject.className = "secondary";
          reject.textContent = "Reject / request correction";
          reject.addEventListener("click", () => reviewFbkSubmission(row, "rejected", profile, reject));
          actions.append(approve, reject);
          card.appendChild(actions);
        }
        root.appendChild(card);
      });
      setText("adminQueueStatus", `${rows.length} FBK submission(s) loaded. Approvals are manual.`);
    } catch (error) {
      console.error("Admin FBK queue error:", error);
      setText("adminQueueStatus", "Could not load FBK submissions. Check admin RLS policies and table columns.");
    }
 }
         
async function reviewFbkSubmission(row, decision, profile, button) {
    if (!currentUser || currentProfile?.role !== "admin" || currentProfile?.account_status !== "approved") {
      return notice("Only an approved administrator can review submissions.", "error");
    }
    let adminNote = "";
    if (decision === "rejected") {
      adminNote = window.prompt("Reason or instructions for the member (optional):", "") || "";
    }
    try {
      setButtonLoading(button, true, "Saving decision…");
      const client = requireDatabase();
      let isUpgradeReview = false;
      if (row.user_id) {
        const { data: pendingUpgrade, error: upgradeLookupError } = await client
          .from("scholarbrige_upgrade_requests")
          .select("id")
          .eq("user_id", row.user_id)
          .eq("status", "awaiting_fbk")
          .limit(1);
        if (!upgradeLookupError && pendingUpgrade?.length) isUpgradeReview = true;
      }
      const { error: submissionError } = await client
        .from("fbk_code_submissions")
        .update({
          status: decision === "approved" ? "accepted" : "rejected",
          admin_note: adminNote || null,
          reviewed_at: new Date().toISOString()
        })
        .eq("id", row.id);
      if (submissionError) throw submissionError;

      if (row.user_id && !isUpgradeReview) {
        const newStatus = decision === "approved" ? "approved" : "awaiting_activation";
        const { error: profileError } = await client
          .from("profiles")
          .update({ account_status: newStatus })
          .eq("id", row.user_id);
        if (profileError) throw profileError;
      }

      notice(isUpgradeReview
        ? (decision === "approved" ? "Upgrade FBK submission accepted. The upgrade request has been updated; the member remains approved." : "Upgrade FBK submission rejected. The member remains approved and may submit a corrected code.")
        : (decision === "approved" ? "Account approved. The member can now sign in to the dashboard." : "Submission rejected. The member can submit a corrected FBK code."), "success");
      await loadAdminActivationQueue();
      await loadScholarbrigeAdminPanel();
    } catch (error) {
      console.error("FBK review failed:", error);
      notice("Could not save the decision: " + (error.message || "Check the admin policies and status constraints."), "error");
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function loadAdminSaleQueue() {
    if (!currentUser || currentProfile?.role !== "admin" || currentProfile?.account_status !== "approved") return;
    const root = $("adminSaleQueue");
    if (!root) return;
    root.textContent = "Account sale requests may be unavailable if the table has not been configured.";
    try {
      const { data, error } = await requireDatabase()
        .from("account_sale_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      root.replaceChildren();
      if (!data?.length) {
        root.textContent = "No account sale requests.";
        return;
      }
      data.forEach(item => {
        const card = document.createElement("article");
        card.className = "task-card";
        const title = document.createElement("h3");
        title.textContent = `Account sale request · Level ${item.level ?? item.membership_level ?? "—"}`;
        const details = document.createElement("p");
        details.textContent = `Status: ${item.status || "submitted"} · Price: ${formatMoney(item.price ?? item.sale_price ?? 0)}`;
        card.append(title, details);
        root.appendChild(card);
      });
    } catch (error) {
      console.warn("Sale queue unavailable:", error.message);
      root.textContent = "Sale requests could not load. Confirm the account_sale_requests columns and admin read policy.";
    }
  }

  async function loadAdminTaskSubmissions() {
    if (!currentUser || currentProfile?.role !== "admin" || currentProfile?.account_status !== "approved") return;
    const root = $("adminTaskList");
    if (!root) return;
    try {
      const { data, error } = await requireDatabase()
        .from("task_submissions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      root.replaceChildren();
      if (!data?.length) {
        root.textContent = "No task submissions yet.";
        return;
      }
      data.forEach(item => {
        const card = document.createElement("article");
        card.className = "task-card";
        const title = document.createElement("h3");
        title.textContent = `Task submission · ${item.status || "submitted"}`;
        const details = document.createElement("p");
        details.textContent = String(item.submission_text || item.answer_text || item.content || "No text response provided");
        card.append(title, details);
        root.appendChild(card);
      });
    } catch (error) {
      console.warn("Task submissions unavailable:", error.message);
      root.textContent = "Task submissions could not load. Check task_submissions columns and admin RLS policies.";
    }
  }

  // Public Hall of Fame: reads only rows allowed by Supabase RLS.
  async function loadPublicHallOfFame() {
    const publicRoot = $("publicHallOfFame");
    if (!publicRoot || !db) return;
    try {
      const client = requireDatabase();
      const [postsResult, scholarsResult] = await Promise.all([
        client.from("scholarbrige_leaderposts")
          .select("id,title,message,created_at")
          .eq("is_published", true)
          .order("created_at", { ascending: false }).limit(10),
        client.from("scholarbrige_scholar_spotlights")
          .select("id,display_name,achievement,verified_earnings,currency,is_featured,created_at")
          .eq("is_published", true).eq("consent_confirmed", true)
          .order("is_featured", { ascending: false })
          .order("verified_earnings", { ascending: false }).limit(50)
      ]);
      if (postsResult.error) throw postsResult.error;
      if (scholarsResult.error) throw scholarsResult.error;
      const posts = postsResult.data || [];
      const scholars = scholarsResult.data || [];
      const latest = posts[0];
      setText("leaderpostTitle", latest?.title || "Scholarbrige Community Highlights");
      setText("leaderpostText", latest?.message || "Our community achievements will appear here when published by an administrator.");
      setText("leaderpostDate", latest?.created_at ? new Date(latest.created_at).toLocaleDateString() : "");
      const featured = scholars.find(row => row.is_featured) || scholars[0];
      setText("hallFeaturedName", featured?.display_name || "Featured Scholar");
      setText("hallFeaturedAchievement", featured?.achievement || "A scholar achievement will appear here when approved for public display.");
      setText("hallFeaturedEarnings", featured ? `${featured.currency || "KES"} ${Number(featured.verified_earnings || 0).toLocaleString("en-KE", {maximumFractionDigits:2})}` : "Earnings shown only for published, consented records");
      const list = $("publicScholarList");
      if (list) {
        list.replaceChildren();
        if (!scholars.length) {
          list.textContent = "No scholars have been featured publicly yet.";
        } else {
          scholars.forEach((scholar, index) => {
            const card = document.createElement("article");
            card.className = "hall-scholar-card";
            const title = document.createElement("h3");
            title.textContent = `${index + 1}. ${scholar.display_name}`;
            const achievement = document.createElement("p");
            achievement.textContent = scholar.achievement;
            const earnings = document.createElement("p");
            earnings.textContent = `Reported verified earnings: ${scholar.currency || "KES"} ${Number(scholar.verified_earnings || 0).toLocaleString("en-KE", {maximumFractionDigits:2})}`;
            card.append(title, achievement, earnings);
            list.appendChild(card);
          });
        }
      }
    } catch (error) {
      console.warn("Public Hall of Fame could not load:", error);
      const list = $("publicScholarList");
      if (list) list.textContent = "The Hall of Fame is temporarily unavailable. Please try again later.";
    }
  }

  function bindHallOfFameAdmin() {
    const postForm = $("hallLeaderpostForm");
    const scholarForm = $("hallScholarForm");
    if (!postForm || postForm.dataset.bound === "true") return;
    postForm.dataset.bound = "true";
    scholarForm.dataset.bound = "true";
    postForm.addEventListener("submit", saveHallLeaderpost);
    scholarForm.addEventListener("submit", saveHallScholar);
    $("hallPostReset")?.addEventListener("click", () => {
      postForm.reset(); $("hallPostId").value = ""; setText("hallPostStatus", "");
    });
    $("hallScholarReset")?.addEventListener("click", () => {
      scholarForm.reset(); $("hallScholarId").value = ""; $("hallScholarEarnings").value = "0"; setText("hallScholarStatus", "");
    });
  }

  async function loadHallOfFameAdmin() {
    if (!currentUser || currentProfile?.role !== "admin" || currentProfile?.account_status !== "approved") return;
    const client = requireDatabase();
    const postRoot = $("hallPostAdminList");
    const scholarRoot = $("hallScholarAdminList");
    if (!postRoot || !scholarRoot) return;
    postRoot.textContent = "Loading announcements…";
    scholarRoot.textContent = "Loading scholars…";
    try {
      const [postsResult, scholarsResult] = await Promise.all([
        client.from("scholarbrige_leaderposts").select("id,title,message,is_published,created_at").order("created_at", {ascending:false}).limit(100),
        client.from("scholarbrige_scholar_spotlights").select("id,display_name,achievement,verified_earnings,currency,is_featured,is_published,consent_confirmed,created_at").order("created_at", {ascending:false}).limit(100)
      ]);
      if (postsResult.error) throw postsResult.error;
      if (scholarsResult.error) throw scholarsResult.error;
      postRoot.replaceChildren(); scholarRoot.replaceChildren();
      if (!postsResult.data?.length) postRoot.textContent = "No announcements yet. Use the form above to add one.";
      (postsResult.data || []).forEach(row => {
        const card = document.createElement("article"); card.className = "task-card";
        const h = document.createElement("h4"); h.textContent = `${row.title} · ${row.is_published ? "Published" : "Draft"}`;
        const p = document.createElement("p"); p.textContent = row.message;
        const actions = document.createElement("div"); actions.className = "sb-admin-actions";
        const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Edit";
        edit.addEventListener("click", () => { $("hallPostId").value=row.id; $("hallPostTitle").value=row.title; $("hallPostMessage").value=row.message; $("hallPostPublished").checked=!!row.is_published; $("hallPostTitle").focus(); });
        const del = document.createElement("button"); del.type="button"; del.textContent="Delete";
        del.addEventListener("click", async () => { if (!window.confirm("Delete this announcement?")) return; const {error}=await requireDatabase().from("scholarbrige_leaderposts").delete().eq("id",row.id); if(error){setText("hallPostStatus","Delete failed: "+error.message);return;} await loadHallOfFameAdmin(); await loadPublicHallOfFame(); });
        actions.append(edit,del); card.append(h,p,actions); postRoot.appendChild(card);
      });
      if (!scholarsResult.data?.length) scholarRoot.textContent = "No scholars yet. Add a scholar above when the achievement and earnings are verified.";
      (scholarsResult.data || []).forEach(row => {
        const card=document.createElement("article"); card.className="task-card";
        const h=document.createElement("h4"); h.textContent=`${row.display_name}${row.is_featured ? " · Featured" : ""}`;
        const p=document.createElement("p"); p.textContent=`${row.achievement} · ${row.currency || "KES"} ${Number(row.verified_earnings||0).toLocaleString("en-KE")} · ${row.is_published ? "Published" : "Draft"} · Consent: ${row.consent_confirmed ? "confirmed" : "not confirmed"}`;
        const actions=document.createElement("div"); actions.className="sb-admin-actions";
        const edit=document.createElement("button"); edit.type="button"; edit.textContent="Edit";
        edit.addEventListener("click",()=>{ $("hallScholarId").value=row.id; $("hallScholarName").value=row.display_name; $("hallScholarAchievement").value=row.achievement; $("hallScholarEarnings").value=row.verified_earnings; $("hallScholarConsent").checked=!!row.consent_confirmed; $("hallScholarFeatured").checked=!!row.is_featured; $("hallScholarPublished").checked=!!row.is_published; $("hallScholarName").focus(); });
        const del=document.createElement("button"); del.type="button"; del.textContent="Delete";
        del.addEventListener("click",async()=>{if(!window.confirm("Delete this scholar entry?"))return;const {error}=await requireDatabase().from("scholarbrige_scholar_spotlights").delete().eq("id",row.id);if(error){setText("hallScholarStatus","Delete failed: "+error.message);return;}await loadHallOfFameAdmin();await loadPublicHallOfFame();});
        actions.append(edit,del); card.append(h,p,actions); scholarRoot.appendChild(card);
      });
    } catch(error) {
      console.error("Hall of Fame admin load error:",error);
      setText("hallPostStatus","Could not load entries: "+(error.message||"Check table permissions."));
      setText("hallScholarStatus","Could not load entries. Check that the Hall of Fame SQL ran successfully and the current user is an approved admin.");
    }
               }
async function saveHallLeaderpost(event) {
    event.preventDefault();
    if (!currentUser || currentProfile?.role !== "admin" || currentProfile?.account_status !== "approved") return notice("Only an approved administrator can edit the Hall of Fame.","error");
    const id=$("hallPostId").value;
    const payload={title:$("hallPostTitle").value.trim(), message:$("hallPostMessage").value.trim(), is_published:$("hallPostPublished").checked, updated_at:new Date().toISOString()};
    if (!payload.title || !payload.message) return setText("hallPostStatus","Enter both a title and a message.");
    try { const q=id ? requireDatabase().from("scholarbrige_leaderposts").update(payload).eq("id",id) : requireDatabase().from("scholarbrige_leaderposts").insert(payload); const {error}=await q; if(error)throw error; $("hallLeaderpostForm").reset(); $("hallPostId").value=""; setText("hallPostStatus","Announcement saved."); await loadHallOfFameAdmin(); await loadPublicHallOfFame(); }
    catch(error){setText("hallPostStatus","Could not save announcement: "+(error.message||"Please try again."));}
  }

  async function saveHallScholar(event) {
    event.preventDefault();
    if (!currentUser || currentProfile?.role !== "admin" || currentProfile?.account_status !== "approved") return notice("Only an approved administrator can edit the Hall of Fame.","error");
    const id=$("hallScholarId").value;
    const featured=$("hallScholarFeatured").checked;
    const payload={display_name:$("hallScholarName").value.trim(), achievement:$("hallScholarAchievement").value.trim(), verified_earnings:Number($("hallScholarEarnings").value), currency:"KES", is_featured:featured, is_published:$("hallScholarPublished").checked, consent_confirmed:$("hallScholarConsent").checked, updated_at:new Date().toISOString()};
    if(!payload.display_name||!payload.achievement||!Number.isFinite(payload.verified_earnings)||payload.verified_earnings<0)return setText("hallScholarStatus","Enter a name, achievement, and valid non-negative earnings amount.");
    if(payload.is_published&&!payload.consent_confirmed)return setText("hallScholarStatus","Confirm the scholar's consent before publishing this entry.");
    try {
      if(featured){const {error:clearError}=await requireDatabase().from("scholarbrige_scholar_spotlights").update({is_featured:false,updated_at:new Date().toISOString()}).neq("id",id||"00000000-0000-0000-0000-000000000000");if(clearError)throw clearError;}
      const q=id ? requireDatabase().from("scholarbrige_scholar_spotlights").update(payload).eq("id",id) : requireDatabase().from("scholarbrige_scholar_spotlights").insert(payload);
      const {error}=await q;if(error)throw error;
      $("hallScholarForm").reset(); $("hallScholarId").value=""; $("hallScholarEarnings").value="0"; setText("hallScholarStatus","Scholar entry saved."); await loadHallOfFameAdmin(); await loadPublicHallOfFame();
    } catch(error){setText("hallScholarStatus","Could not save scholar: "+(error.message||"Please try again."));}
  }

  async function loadScholarbrigeAdminPanel() {
    const root = $("scholarbrigeAdminPanel");
    if (!root) return;
    const isAdmin = currentUser && currentProfile?.role === "admin" && currentProfile?.account_status === "approved";
    if (!isAdmin) {
      root.classList.add("hidden");
      return;
    }

    root.classList.remove("hidden");
    root.innerHTML = `
      <div class="sb-admin">
        <h2>Scholarbrige Admin Management</h2>
        <p>Activation alerts and member submissions.</p>
        <div class="sb-admin-actions">
          <button type="button" id="sbEnableSound">Enable alarm sound</button>
          <button type="button" id="sbEnableBrowserAlerts">Enable browser alerts</button>
          <button type="button" id="sbRefreshAlerts">Refresh alerts</button>
        </div>
        <p id="sbAlertStatus" role="status">Loading administrator notifications…</p>
        <div id="sbAlertList" aria-live="polite"></div>
      </div>
      <section class="sb-admin hall-admin" style="margin-top:24px">
        <h2>Public Hall of Fame Manager</h2>
        <p>Only publish achievements and earnings you have checked and have permission to share. Public earnings are not automatically verified by this website.</p>
        <h3>Leaderpost / announcement</h3>
        <form id="hallLeaderpostForm" class="form">
          <input type="hidden" name="id" id="hallPostId">
          <label for="hallPostTitle">Title</label><input id="hallPostTitle" name="title" required maxlength="160" placeholder="e.g. Scholar achievement of the week">
          <label for="hallPostMessage">Message</label><textarea id="hallPostMessage" name="message" required rows="3" maxlength="3000" placeholder="Write the announcement for visitors"></textarea>
          <label><input type="checkbox" id="hallPostPublished" name="published"> Publish this announcement publicly</label>
          <div class="sb-admin-actions"><button type="submit" class="primary" id="hallPostSave">Save announcement</button><button type="button" id="hallPostReset">Clear form</button></div>
        </form>
        <p id="hallPostStatus" role="status"></p><div id="hallPostAdminList"></div>
        <hr>
        <h3>Scholar spotlight / earnings</h3>
        <form id="hallScholarForm" class="form">
          <input type="hidden" name="id" id="hallScholarId">
          <label for="hallScholarName">Public display name</label><input id="hallScholarName" name="display_name" required maxlength="100" placeholder="Scholar name or approved public alias">
          <label for="hallScholarAchievement">Achievement</label><textarea id="hallScholarAchievement" name="achievement" required rows="3" maxlength="2000" placeholder="Describe the achievement"></textarea>
          <label for="hallScholarEarnings">Verified earnings amount (KES)</label><input id="hallScholarEarnings" name="verified_earnings" type="number" min="0" step="0.01" required value="0">
          <label><input type="checkbox" id="hallScholarConsent" name="consent"> I confirm the scholar consented to public display</label>
          <label><input type="checkbox" id="hallScholarFeatured" name="featured"> Feature this scholar at the top</label>
          <label><input type="checkbox" id="hallScholarPublished" name="published"> Publish this scholar publicly</label>
          <div class="sb-admin-actions"><button type="submit" class="primary" id="hallScholarSave">Save scholar</button><button type="button" id="hallScholarReset">Clear form</button></div>
        </form>
        <p id="hallScholarStatus" role="status"></p><div id="hallScholarAdminList"></div>
      </section>
    `;

    bindHallOfFameAdmin();
    loadHallOfFameAdmin().catch(error => console.warn("Hall of Fame admin loading:", error));

    const status = $("sbAlertStatus");
    const list = $("sbAlertList");
    const soundButton = $("sbEnableSound");
    const browserButton = $("sbEnableBrowserAlerts");
    const refreshButton = $("sbRefreshAlerts");

    function playAlarm() {
      if (!notificationSoundEnabled) return;
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        notificationAudio ||= new AudioContextClass();
        if (notificationAudio.state === "suspended") notificationAudio.resume();
        const oscillator = notificationAudio.createOscillator();
        const gain = notificationAudio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 880;
        gain.gain.value = 0.13;
        oscillator.connect(gain);
        gain.connect(notificationAudio.destination);
        oscillator.start();
        oscillator.stop(notificationAudio.currentTime + 0.4);
      } catch (error) {
        console.warn("Alarm sound unavailable:", error);
      }
    }

    soundButton.addEventListener("click", async () => {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("Audio is not supported.");
        notificationAudio ||= new AudioContextClass();
        if (notificationAudio.state === "suspended") await notificationAudio.resume();
        notificationSoundEnabled = true;
        soundButton.textContent = "Alarm sound enabled";
        playAlarm();
      } catch (error) {
        status.textContent = "Sound could not start. Check your phone's sound settings and try again.";
      }
    });

    browserButton.addEventListener("click", async () => {
      if (!("Notification" in window)) {
        status.textContent = "Browser notifications are not supported on this device.";
        return;
      }
      const permission = await Notification.requestPermission();
      status.textContent = permission === "granted"
        ? "Browser alerts enabled while this page is running."
        : "Browser alerts were not enabled. Check your browser's site permissions.";
    });
async function refreshAlerts() {
      if (!currentUser || currentProfile?.role !== "admin" || currentProfile?.account_status !== "approved") {
        root.classList.add("hidden");
        return;
      }
      refreshButton.disabled = true;
      try {
        const { data, error } = await requireDatabase()
          .from("admin_notifications")
          .select("id,user_id,event_type,membership_level,phone,message,submitted_fbk_code,is_read,created_at")
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;

        const notifications = data || [];
        const newest = notifications[0];
        if (newest && newestNotificationId && newest.id !== newestNotificationId && newest.event_type === "fbk_submitted") {
          playAlarm();
          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification("Scholarbrige: FBK submitted", {
                body: "A member submitted an FBK number. Open the admin panel to review it."
              });
            } catch (_) {}
          }
        }
        if (newest) newestNotificationId = newest.id;

        status.textContent = `${notifications.filter(item => !item.is_read).length} unread notification(s).`;
        list.replaceChildren();
        if (!notifications.length) {
          list.textContent = "No notifications yet.";
          return;
        }

        notifications.forEach(item => {
          const card = document.createElement("article");
          card.className = "task-card";
          const heading = document.createElement("h3");
          heading.textContent = item.event_type === "activation_requested"
            ? "New activation request"
            : item.event_type === "fbk_page_opened"
              ? "Member reached FBK page"
              : item.event_type === "upgrade_requested"
                ? "Account upgrade requested"
                : item.event_type === "withdrawal_requested"
                  ? "Withdrawal request received"
                  : "FBK number submitted";
          const message = document.createElement("p");
          message.textContent = item.message || "Administrator notification";
          const details = document.createElement("p");
          details.textContent = `Phone: ${item.phone || "—"} · Level: ${item.membership_level ?? "—"} · ${item.created_at ? new Date(item.created_at).toLocaleString() : ""}`;
          card.append(heading, message, details);

          if (item.event_type === "fbk_submitted" && item.submitted_fbk_code) {
            const code = document.createElement("p");
            code.textContent = "Submitted FBK number: " + item.submitted_fbk_code;
            card.appendChild(code);
          }

          if (!item.is_read) {
            const readButton = document.createElement("button");
            readButton.type = "button";
            readButton.textContent = "Mark as read";
            readButton.addEventListener("click", async () => {
              const { error: updateError } = await requireDatabase()
                .from("admin_notifications")
                .update({ is_read: true })
                .eq("id", item.id);
              if (updateError) {
                status.textContent = "Could not mark notification as read: " + updateError.message;
                return;
              }
              refreshAlerts();
            });
            card.appendChild(readButton);
          }
          list.appendChild(card);
        });
      } catch (error) {
        console.error("Admin notification error:", error);
        status.textContent = "Notifications could not load. Check the admin_notifications table, its columns, and approved-admin RLS policies.";
      } finally {
        refreshButton.disabled = false;
      }
    }

    refreshButton.addEventListener("click", refreshAlerts);

    // Establish the current newest notification without sounding for old alerts.
    try {
      const { data, error } = await requireDatabase()
        .from("admin_notifications")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1);
      if (!error && data?.length) newestNotificationId = data[0].id;
    } catch (error) {
      console.warn("Could not initialise notification polling:", error);
    }

    await refreshAlerts();
    if (notificationTimer) clearInterval(notificationTimer);
    notificationTimer = setInterval(refreshAlerts, 8000);
  }

  async function updateSalePrice() {
    const level = Number($("sellAccountLevel")?.value || 4);
    const prices = { 1: 0, 2: 0, 3: 0, 4: 4200, 5: 12880, 6: 18000.8 };
    setText("sellAccountPrice", "Estimated display price: " + formatMoney(prices[level] || 0) + ". Final requests require manual review.");
  }

  async function submitAccountSale(event) {
    event.preventDefault();
    if (!currentUser || currentProfile?.account_status !== "approved") {
      return notice("Only approved members can submit an account service request.", "error");
    }
    const level = Number($("sellAccountLevel")?.value || 4);
    const prices = { 4: 4200, 5: 12880, 6: 18000.8 };
    const price = prices[level];
    if (!price) return notice("Choose a valid account level.", "error");

    try {
      const { error } = await requireDatabase().from("account_sale_requests").insert({
        user_id: currentUser.id,
        level,
        price,
        status: "submitted"
      });
      if (error) throw error;
      notice("Your account service request was submitted for manual review.", "success");
    } catch (error) {
      console.error("Account sale request failed:", error);
      notice("Could not submit request: " + (error.message || "Confirm the account_sale_requests table columns."), "error");
    }
  }

  async function copyReferral() {
    const code = String($("refCode")?.value || $("refCode")?.textContent || currentProfile?.referral_code || "").trim();
    if (!code || code.includes("Not available")) return notice("Your referral code is not available yet.", "warning");
    try {
      await navigator.clipboard.writeText(code);
      notice("Referral code copied.", "success");
    } catch (_) {
      window.prompt("Copy your referral code:", code);
    }
  }

  async function shareInvite() {
    const code = String(currentProfile?.referral_code || $("refCode")?.value || "").trim();
    if (!code) return notice("Your referral code is not available yet.", "warning");
    const link = "https://tinyurl.com/yc5svrvs";
    const text = `Join me on Scholarbrige Academic Hub. Use my referral code ${code}: ${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: BRAND_NAME, text, url: link });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        notice("Your referral message was copied. Share it with your friends.", "success");
      } else {
        window.prompt("Copy and share this invitation:", text);
      }
    } catch (error) {
      if (error?.name !== "AbortError") window.prompt("Copy and share this invitation:", text);
    }
  }

  function applyTheme(theme) {
    const valid = THEME_ORDER.includes(theme) ? theme : "forest-green";
    document.documentElement.dataset.theme = valid;
    document.body.dataset.theme = valid;
    try { localStorage.setItem("scholarbrige_theme", valid); } catch (_) {}
  }

  function rotateTheme() {
    let started = Number(localStorage.getItem(THEME_KEY)) || Date.now();
    if (Date.now() - started >= THEME_INTERVAL) {
      const current = document.documentElement.dataset.theme || "forest-green";
      const index = THEME_ORDER.indexOf(current);
      applyTheme(THEME_ORDER[(index + 1) % THEME_ORDER.length]);
      started = Date.now();
      localStorage.setItem(THEME_KEY, String(started));
    } else {
      const saved = localStorage.getItem("scholarbrige_theme");
      if (saved && THEME_ORDER.includes(saved)) applyTheme(saved);
      else applyTheme("forest-green");
    }
  }

  function updateCelestialMark() {
    const mark = $("celestialMark");
    const hour = new Date().getHours();
    const night = hour >= 18 || hour < 6;
    document.body.dataset.timephase = night ? "night" : "day";
    if (mark) {
      mark.textContent = night ? "☾" : "☀";
      mark.setAttribute("aria-label", night ? "Night theme" : "Day theme");
      mark.title = night ? "Night sky" : "Daylight";
    }
  }

  function updateActivationCurrency() {
    const note = $("activationCurrencyNote");
    if (!note) return;
    const country = currentProfile?.country || $("countrySelect")?.value || "Kenya";
    const currency = COUNTRY_CURRENCY[country] || COUNTRY_CURRENCY.Kenya;
    const levels = Object.entries(ACTIVATION_FEES).map(([level, fee]) => {
      const amount = fee * currency.perKes;
      return `L${level}: ${currency.symbol} ${amount.toLocaleString(currency.locale, { maximumFractionDigits: currency.decimals })}`;
    });
    note.textContent = country === "Kenya"
      ? `Base activation fees: ${levels.join(" · ")}.`
      : `Indicative ${currency.code} equivalents from the same KES base: ${levels.join(" · ")}. Estimates only; confirm the final amount through the official payment instructions.`;
  }

  function updateCountryWelcome() {
    const select = $("countrySelect");
    const welcome = $("countryWelcome");
    if (!select || !welcome) { updateActivationCurrency(); return; }
    const greetings = {
      Kenya: "🇰🇪 Karibu to Scholarbrige!",
      Uganda: "🇺🇬 Tukusanyukidde to Scholarbrige!",
      Tanzania: "🇹🇿 Karibu Scholarbrige!",
      Ghana: "🇬🇭 Akwaaba to Scholarbrige!",
      Nigeria: "🇳🇬 Welcome to Scholarbrige!"
    };
    if (greetings[select.value]) {
      welcome.textContent = greetings[select.value];
      welcome.classList.remove("hidden");
    } else {
      welcome.classList.add("hidden");
      welcome.textContent = "";
    }
  }


  // Requested member tools. Database structures and policies are supplied in setup.sql.
  const UPGRADE_FEES = { 2: 700, 3: 1400, 4: 2000, 5: 2780, 6: 3500, 7: 4200 };
  let activeChatMember = null;
  let chatRefreshTimer = null;
  let upgradeMode = false;

  function memberLevel() {
    return Number(currentActivationRequest?.membership_level || currentProfile?.membership_level || 1);
  }

  function updateUpgradeOptions() {
    const current = memberLevel();
    setText("profileDisplayName", currentProfile?.full_name || currentProfile?.username || "Scholar");
    setText("profileMemberLevel", `Current membership level: ${current}`);
    setText("upgradeCurrentLevel", `Current membership level: ${current}`);
    const select = $("upgradeNextLevel");
    if (!select) return;
    const available = Object.keys(UPGRADE_FEES).map(Number).filter(level => level === current + 1);
    select.replaceChildren();
    if (!available.length) {
      const option = document.createElement("option"); option.value = ""; option.textContent = "You are at the highest listed level"; select.appendChild(option); select.disabled = true;
      setText("upgradeFeeText", "No next-level upgrade is available.");
      return;
    }
    select.disabled = false;
    const next = available[0];
    const option = document.createElement("option"); option.value = String(next); option.textContent = `Level ${current} → ${next} · ${formatMoney(UPGRADE_FEES[next])}`; select.appendChild(option);
    setText("upgradeFeeText", `Upgrade fee: ${formatMoney(UPGRADE_FEES[next])}`);
  }

  async function submitUpgrade(event) {
    event.preventDefault();
    if (!currentUser || currentProfile?.account_status !== "approved") return notice("Only approved members can request an upgrade.", "error");
    const nextLevel = Number($("upgradeNextLevel")?.value);
    const currentLevel = memberLevel();
    const fee = UPGRADE_FEES[nextLevel];
    if (nextLevel !== currentLevel + 1 || !fee) return notice("Choose the next available membership level.", "error");
    const button = event.currentTarget.querySelector('[type="submit"]');
    try {
      setButtonLoading(button, true, "Preparing FBK step…");
      const { data, error } = await requireDatabase().from("scholarbrige_upgrade_requests").insert({
        user_id: currentUser.id, current_level: currentLevel, next_level: nextLevel, fee, status: "awaiting_fbk"
      }).select("id").single();
      if (error) throw error;
      const { error: notifyError } = await requireDatabase().rpc("scholarbrige_notify_upgrade_request", { p_upgrade_request_id: data.id });
      if (notifyError) console.warn("Upgrade admin notification failed:", notifyError.message);
      upgradeMode = true;
      setText("verificationStatus", `Upgrade request for Level ${currentLevel} → ${nextLevel} (${formatMoney(fee)}) is ready. Submit your FBK reference code below. An administrator must manually review it.`);
      await sendAdminAlert("fbk_page_opened");
      showView("verificationView");
      notice("Upgrade request created. Continue with the existing FBK submission page.", "success");
    } catch (error) {
      console.error("Upgrade request failed:", error);
      notice("Could not start the upgrade: " + (error.message || "Check the setup SQL and try again."), "error");
    } finally { setButtonLoading(button, false); }
  }

  async function uploadMemberAvatar(event) {
    const file = event.target.files?.[0];
    if (!file || !currentUser) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 3 * 1024 * 1024) {
      notice("Choose a JPG, PNG or WebP image under 3 MB.", "error"); event.target.value = ""; return;
    }
    try {
      const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
      const path = `${currentUser.id}/avatar-${Date.now()}.${extension}`;
      const client = requireDatabase();
      const { error: uploadError } = await client.storage.from("scholarbrige-avatars").upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: publicData } = client.storage.from("scholarbrige-avatars").getPublicUrl(path);
      const avatarUrl = publicData?.publicUrl;
      const { error: profileError } = await client.from("profiles").update({ avatar_path: path }).eq("id", currentUser.id);
      if (profileError) throw profileError;
      currentProfile.avatar_path = path;
      const img = $("memberAvatar"); if (img && avatarUrl) img.src = avatarUrl;
      notice("Profile photo uploaded.", "success");
    } catch (error) {
      console.error("Avatar upload failed:", error);
      notice("Could not upload the photo. Run setup.sql and check Storage/profile permissions.", "error");
    } finally { event.target.value = ""; }
       }
async function submitWithdrawal(event) {
    event.preventDefault();
    if (!currentUser || currentProfile?.account_status !== "approved") return notice("Only approved members can request withdrawals.", "error");
    const amount = Number($("withdrawAmount")?.value);
    const phone = cleanPhone($("withdrawPhone")?.value || currentProfile?.phone);
    if (!Number.isFinite(amount) || amount < 2000) return notice("The minimum withdrawal is KES 2,000.", "error");
    if (!phone) return notice("Enter a valid M-Pesa phone number.", "error");
    const button = event.currentTarget.querySelector('[type="submit"]');
    try {
      setButtonLoading(button, true, "Submitting request…");
      const { error } = await requireDatabase().rpc("scholarbrige_request_withdrawal", { p_amount: amount, p_phone: phone });
      if (error) throw error;
      event.currentTarget.reset();
      setText("withdrawNotice", "Withdrawal request submitted for manual review. No money has been sent yet.");
      await loadWithdrawalHistory();
    } catch (error) {
      console.error("Withdrawal request failed:", error);
      setText("withdrawNotice", "Could not submit: " + (error.message || "Check wallet balance and setup.sql."));
    } finally { setButtonLoading(button, false); }
  }

  async function loadWithdrawalHistory() {
    if (!currentUser || !$("withdrawHistory")) return;
    const root = $("withdrawHistory"); root.textContent = "Loading requests…";
    try {
      const { data, error } = await requireDatabase().from("scholarbrige_withdrawal_requests").select("id,amount,phone,status,created_at").eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      root.replaceChildren();
      if (!data?.length) { root.textContent = "No withdrawal requests yet."; return; }
      data.forEach(row => { const item = document.createElement("div"); item.className = "history-item"; const left = document.createElement("span"); left.textContent = formatBalanceMoney(row.amount); const right = document.createElement("small"); right.textContent = `${row.status} · ${new Date(row.created_at).toLocaleDateString()}`; item.append(left, right); root.appendChild(item); });
    } catch (error) { root.textContent = "Withdrawal history unavailable until setup.sql is applied."; console.warn(error); }
  }

  let memberSearchDelay = null;
  async function searchMembers() {
    const query = String($("memberSearchInput")?.value || "").trim();
    const root = $("memberSearchResults"); if (!root) return;
    if (query.length < 2) { root.textContent = "Type at least two characters to search."; return; }
    root.textContent = "Searching approved members…";
    try {
      const { data, error } = await requireDatabase().rpc("scholarbrige_search_members", { p_query: query });
      if (error) throw error;
      root.replaceChildren();
      if (!data?.length) { root.textContent = "No matching approved members found."; return; }
      data.forEach(member => {
        if (member.id === currentUser?.id) return;
        const row = document.createElement("div"); row.className = "member-result";
        const img = document.createElement("img"); img.alt = "";
        const avatarPath = member.avatar_path;
        const avatarUrl = avatarPath ? requireDatabase().storage.from("scholarbrige-avatars").getPublicUrl(avatarPath).data?.publicUrl : null;
        img.src = avatarUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' rx='40' fill='%23e9f7d1'/%3E%3Ctext x='40' y='50' font-size='32' text-anchor='middle' fill='%23073b2b'%3ES%3C/text%3E%3C/svg%3E";
        const info = document.createElement("div"); info.className = "member-result-info"; const name = document.createElement("b"); name.textContent = member.full_name || member.username || "Scholar"; const small = document.createElement("small"); small.textContent = member.username ? `@${member.username}` : "Scholarbrige member"; info.append(name, small);
        const button = document.createElement("button"); button.className = "secondary"; button.type = "button"; button.textContent = "Message"; button.addEventListener("click", () => openPrivateChat(member)); row.append(img, info, button); root.appendChild(row);
      });
    } catch (error) { console.error("Member search failed:", error); root.textContent = "Member search is not ready. Apply setup.sql and confirm RPC permissions."; }
  }

  async function openPrivateChat(member) {
    activeChatMember = member;
    setText("chatHeading", `Chat with ${member.full_name || member.username || "Scholar"}`);
    $("chatForm")?.classList.remove("hidden");
    await loadPrivateMessages();
    if (chatRefreshTimer) clearInterval(chatRefreshTimer);
    chatRefreshTimer = setInterval(loadPrivateMessages, 7000);
  }

  async function loadPrivateMessages() {
    if (!activeChatMember || !currentUser || !$("chatMessages")) return;
    const root = $("chatMessages");
    try {
      const client = requireDatabase();
      const { data, error } = await client.from("scholarbrige_private_messages").select("id,sender_id,recipient_id,body,created_at,read_at").or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${activeChatMember.id}),and(sender_id.eq.${activeChatMember.id},recipient_id.eq.${currentUser.id})`).order("created_at", { ascending: true }).limit(100);
      if (error) throw error;
      root.replaceChildren();
      if (!data?.length) { root.textContent = "No messages yet. Start the conversation below."; return; }
      data.forEach(message => { const bubble = document.createElement("article"); bubble.className = "chat-message" + (message.sender_id === currentUser.id ? " mine" : ""); const body = document.createElement("p"); body.textContent = message.body; const time = document.createElement("time"); time.dateTime = message.created_at; time.textContent = new Date(message.created_at).toLocaleString(); bubble.append(body, time); root.appendChild(bubble); });
      root.scrollTop = root.scrollHeight;
      await client.from("scholarbrige_private_messages").update({ read_at: new Date().toISOString() }).eq("sender_id", activeChatMember.id).eq("recipient_id", currentUser.id).is("read_at", null);
    } catch (error) { console.error("Private messages failed:", error); root.textContent = "Private chat is unavailable until setup.sql and its RLS policies are applied."; }
  }

  async function sendPrivateMessage(event) {
    event.preventDefault();
    const body = String($("chatMessageInput")?.value || "").trim();
    if (!body || !activeChatMember || !currentUser) return;
    try {
      const { error } = await requireDatabase().from("scholarbrige_private_messages").insert({ sender_id: currentUser.id, recipient_id: activeChatMember.id, body });
      if (error) throw error;
      $("chatMessageInput").value = "";
      setText("chatNotice", "Message sent.");
      await loadPrivateMessages();
    } catch (error) { console.error("Message send failed:", error); setText("chatNotice", "Could not send message. Check chat table permissions and setup.sql."); }
  }

  function bindMemberTools() {
    bind("withdrawForm", "submit", submitWithdrawal);
    bind("upgradeForm", "submit", submitUpgrade);
    bind("avatarUpload", "change", uploadMemberAvatar);
    bind("chatForm", "submit", sendPrivateMessage);
    bind("upgradeNextLevel", "change", () => { const fee = UPGRADE_FEES[Number($("upgradeNextLevel")?.value)]; setText("upgradeFeeText", fee ? `Upgrade fee: ${formatMoney(fee)}` : "No upgrade fee available."); });
    bind("memberSearchInput", "input", () => { if (memberSearchDelay) clearTimeout(memberSearchDelay); memberSearchDelay = setTimeout(searchMembers, 350); });
  }

  function bindEvents() {
    // Bind authentication first so optional dashboard features cannot block login/signup.
    bind("loginForm", "submit", login);
    bind("signupForm", "submit", signup);
    bind("activationForm", "submit", requestActivation);
    bind("verificationForm", "submit", verifyActivationCode);
    bind("resetPassword", "click", resetPassword);
    bind("checkVerification", "click", refreshStatus);
    bind("checkPending", "click", refreshStatus);
    ["logoutActivation", "logoutVerification", "logoutPending", "logoutDashboard", "dashLogout"].forEach(id => bind(id, "click", logout));
    bind("showSupport", "click", () => showView("supportView"));
    bind("supportButton", "click", contactSupport);
    bind("closeSupport", "click", () => showView("dashboardView"));
    bind("copyReferral", "click", copyReferral);
    bind("shareInvite", "click", shareInvite);
    bind("refreshTasks", "click", loadTasks);
    bind("refreshActivationQueue", "click", loadAdminActivationQueue);
    bind("refreshSaleQueue", "click", loadAdminSaleQueue);
    bind("enableActivationAlerts", "click", async () => {
      if (!("Notification" in window)) return notice("Browser notifications are not supported here.", "warning");
      const permission = await Notification.requestPermission();
      notice(permission === "granted" ? "Browser notifications enabled while the admin page is running." : "Notification permission was not granted.", permission === "granted" ? "success" : "warning");
    });
    bind("sellAccountForm", "submit", submitAccountSale);
    bind("sellAccountLevel", "change", updateSalePrice);
    bind("countrySelect", "change", updateCountryWelcome);
    bind("membershipLevel", "change", updateActivationCurrency);

    // Bind optional member tools only after core authentication controls are connected.
    try {
      bindMemberTools();
    } catch (error) {
      console.error("Optional member tools could not be initialized:", error);
    }

    document.querySelectorAll("[data-tab]").forEach(button => {
      if (button.dataset.appTabBound === "true") return;
      button.addEventListener("click", () => activateTab(button.dataset.tab));
      button.dataset.appTabBound = "true";
    });
  }

  async function startApp() {
    bindEvents();
    rotateTheme();
    setInterval(rotateTheme, 60 * 1000); // Checks the 40-minute theme interval without changing it every minute.
    updateCelestialMark();
    setInterval(updateCelestialMark, 60 * 1000);
    updateCountryWelcome();
    updateActivationCurrency();
    updateSalePrice();
    loadPublicHallOfFame();

    if (!db) {
      showView("authView");
      showError("The sign-in service did not load. Check your internet connection and reload the page.");
      return;
    }

    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      currentUser = data?.session?.user || null;
      if (currentUser) {
        await routeUser(currentUser);
      } else {
        showView("authView");
      }
    } catch (error) {
      console.error("Startup error:", error);
      showView("authView");
      showError("Scholarbrige could not start: " + (error.message || "Refresh and try again."));
    }

    if (!authListenerRegistered) {
      authListenerRegistered = true;
      db.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user || null;
        if (event === "SIGNED_OUT") {
          currentProfile = null;
          showView("authView");
          return;
        }
        if (currentUser && ["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
          // Defer to avoid running database calls inside the auth event callback.
          setTimeout(() => routeUser(currentUser), 0);
        }
      });
    }
  }

  function safeStartApp() {
    try {
      const result = startApp();
      if (result && typeof result.catch === "function") {
        result.catch(error => {
          console.error("Unexpected Scholarbrige startup error:", error);
          showView("authView");
          showError("Scholarbrige could not start: " + (error?.message || "Please reload and try again."));
        });
      }
    } catch (error) {
      console.error("Unexpected Scholarbrige startup error:", error);
      showView("authView");
      showError("Scholarbrige could not start: " + (error?.message || "Please reload and try again."));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", safeStartApp, { once: true });
  } else {
    safeStartApp();
  }
})();
         
