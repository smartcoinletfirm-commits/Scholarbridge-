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
