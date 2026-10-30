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
