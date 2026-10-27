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
  const ACTIVATION_FEES = { 1: 500, 2: 1000, 3: 1780, 4: 2670 };
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
