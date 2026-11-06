// ==========================================
// SCHOLARBRIDGE - SUPABASE CONFIGURATION
// ==========================================

const SUPABASE_URL = "https://vulbvlardmvvxdhqyopn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hve5CvGEO3tyocvupHOv9w_zEVEaN9a";

const sb = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const $ = (id) => document.getElementById(id);

const msg = (message) => {
  if ($("auth-message")) {
    $("auth-message").textContent = message;
  }
};

if ($("year")) {
  $("year").textContent = new Date().getFullYear();
}


// ==========================================
// ADMIN NOTIFICATIONS
// ==========================================

async function callNotify(event, payload = {}) {
  try {
    const { data, error } = await sb.functions.invoke(
      "notify-admin",
      { body: { event, ...payload } }
    );

    if (error) console.warn("Notification failed:", error.message);

    return { data, error };
  } catch (error) {
    console.warn("Notification error:", error);
    return { data: null, error };
  }
}


// ==========================================
// GET LOGGED-IN USER
// ==========================================

async function getCurrentUser() {
  const { data, error } = await sb.auth.getUser();

  if (error) throw error;
  if (!data.user) throw new Error("Please sign in again.");

  return data.user;
}


// ==========================================
// GET PROFILE
// ==========================================

async function currentProfile() {
  const user = await getCurrentUser();

  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, email, role, account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;

  return data;
}


// ==========================================
// GET MEMBER APPLICATION
// ==========================================

async function currentApplication() {
  const user = await getCurrentUser();

  const { data, error } = await sb
    .from("scholarbridge_applications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data;
}


// ==========================================
// ACCOUNT ROUTING
// ==========================================

async function goForStatus() {
  try {
    msg("Checking your account...");

    const profile = await currentProfile();

    // ADMIN REDIRECT ONLY AFTER EXPLICIT SIGN-IN.
    // PUBLIC PAGE LOADS NO LONGER AUTO-REDIRECT ADMINS.

    if (profile) {

      if (profile.role === "admin") {
        location.replace("admin.html");
        return;
      }

      if (profile.account_status === "approved") {
        location.replace("dashboard.html");
        return;
      }

      if (profile.account_status === "suspended") {
        location.replace("suspended.html");
        return;
      }

      if (
        profile.account_status === "pending_approval" ||
        profile.account_status === "payment_review"
      ) {
        location.replace("pending.html");
        return;
      }

      if (profile.account_status === "rejected") {
        location.replace("pending.html");
        return;
      }
    }

    const app = await currentApplication();

    if (!app) {
      location.replace("level.html");
      return;
    }

    switch (app.status) {

      case "approved":
        location.replace("dashboard.html");
        return;

      case "suspended":
        location.replace("suspended.html");
        return;

      case "awaiting_fbk":
        location.replace("fbk.html");
        return;

      case "pending_approval":
      case "rejected":
        location.replace("pending.html");
        return;

      default:
        location.replace("level.html");
        return;
    }

  } catch (error) {
    console.error("Account routing error:", error);
    msg("Unable to check your account: " + error.message);
  }
}


// ==========================================
// AUTHENTICATION
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

  const registerForm = $("register-form");
  const loginForm = $("login-form");

  const registerTab = $("show-register");
  const loginTab = $("show-login");


  function showLogin() {
    registerForm?.classList.add("hidden");
    loginForm?.classList.remove("hidden");

    registerTab?.classList.remove("active");
    loginTab?.classList.add("active");

    msg("");
  }


  function showRegister() {
    loginForm?.classList.add("hidden");
    registerForm?.classList.remove("hidden");

    loginTab?.classList.remove("active");
    registerTab?.classList.add("active");

    msg("");
  }


  loginTab?.addEventListener("click", showLogin);
  registerTab?.addEventListener("click", showRegister);

  $("register-login-link")?.addEventListener("click", e => {
    e.preventDefault();
    showLogin();
  });

  $("login-register-link")?.addEventListener("click", e => {
    e.preventDefault();
    showRegister();
  });


  // ========================================
  // IMPORTANT:
  // DO NOT AUTO-REDIRECT ON PUBLIC PAGE LOAD.
  // VISITORS AND ALREADY-SIGNED-IN ADMINS
  // MUST SEE THE PUBLIC SCHOLARBRIDGE PAGE.
  // ========================================


  // ========================================
  // CREATE ACCOUNT
  // ========================================

  registerForm?.addEventListener("submit", async e => {
    e.preventDefault();

    const name = $("reg-name").value.trim();
    const email = $("reg-email").value.trim();
    const password = $("reg-password").value;
    const whatsapp = $("reg-whatsapp").value.trim();
    const country = $("reg-country").value.trim();

    if (!name || !email || !password) {
      msg("Please complete all required fields.");
      return;
    }

    if (password.length < 8) {
      msg("Password must contain at least 8 characters.");
      return;
    }

    const button = registerForm.querySelector('button[type="submit"]');

    if (button) {
      button.disabled = true;
      button.textContent = "Creating account...";
    }

    msg("Creating your Scholarbridge account...");

    try {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            whatsapp,
            country
          }
        }
      });

      if (error) throw error;

      if (!data.user) {
        throw new Error("Account creation could not be completed.");
      }

      if (!data.session) {
        msg("Account created. Please confirm your email, then sign in.");
        showLogin();
        return;
      }

      location.replace("level.html");

    } catch (error) {
      console.error(error);
      msg(error.message || "Registration failed.");

    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Create account";
      }
    }
  });


  // ========================================
  // MEMBER / ADMIN SIGN IN
  // ========================================

  loginForm?.addEventListener("submit", async e => {
    e.preventDefault();

    const email = $("login-email").value.trim();
    const password = $("login-password").value;

    const button = loginForm.querySelector('button[type="submit"]');

    if (button) {
      button.disabled = true;
      button.textContent = "Signing in...";
    }

    msg("Signing in securely...");

    try {
      const { error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      await goForStatus();

    } catch (error) {
      console.error(error);
      msg(error.message || "Sign in failed.");

    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Sign in securely";
      }
    }
  });

});

