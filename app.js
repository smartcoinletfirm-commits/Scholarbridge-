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
      {
        body: {
          event,
          ...payload
        }
      }
    );

    if (error) {
      console.warn("Notification failed:", error.message);
    }

    return { data, error };

  } catch (error) {
    console.warn("Notification error:", error);
    return { data: null, error };
  }
}


// ==========================================
// GET CURRENT APPLICATION
// ==========================================

async function currentApplication() {

  const {
    data: { user },
    error: authError
  } = await sb.auth.getUser();

  if (authError || !user) return null;

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
// GET EXISTING MEMBER PROFILE
// ==========================================

async function currentProfile() {

  const {
    data: { user },
    error: authError
  } = await sb.auth.getUser();

  if (authError || !user) return null;

  const { data, error } = await sb
    .from("profiles")
    .select("status, account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;

  return data;
}


// ==========================================
// ACCOUNT STATUS ROUTING
// ==========================================

async function goForStatus() {

  try {

    msg("Checking your account...");

    // FIRST: CHECK THE EXISTING PROFILE.
    // THIS TAKES PRIORITY FOR OLD MEMBERS.

    const profile = await currentProfile();

    if (profile) {

      const profileStatus =
        profile.account_status || profile.status;

      if (
        profile.account_status === "approved" ||
        profile.status === "approved"
      ) {
        location.replace("dashboard.html");
        return;
      }

      if (profileStatus === "suspended") {
        location.replace("suspended.html");
        return;
      }

      if (
        profileStatus === "pending_approval" ||
        profileStatus === "payment_review"
      ) {
        location.replace("pending.html");
        return;
      }

      if (profileStatus === "rejected") {
        location.replace("pending.html");
        return;
      }
    }


    // SECOND: CHECK THE NEW APPLICATION TABLE.

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

    msg(
      "Unable to check your account. Please refresh and try again."
    );

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


  // ========================================
  // SHOW SIGN IN
  // ========================================

  function showLogin() {

    registerForm?.classList.add("hidden");
    loginForm?.classList.remove("hidden");

    registerTab?.classList.remove("active");
    loginTab?.classList.add("active");

    msg("");
  }


  // ========================================
  // SHOW CREATE ACCOUNT
  // ========================================

  function showRegister() {

    loginForm?.classList.add("hidden");
    registerForm?.classList.remove("hidden");

    loginTab?.classList.remove("active");
    registerTab?.classList.add("active");

    msg("");
  }


  loginTab?.addEventListener("click", showLogin);

  registerTab?.addEventListener("click", showRegister);

  $("register-login-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    showLogin();
  });

  $("login-register-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    showRegister();
  });


  // ========================================
  // AUTOMATIC REDIRECT FOR SIGNED-IN MEMBERS
  // ========================================

  if (registerForm || loginForm) {

    sb.auth.getSession().then(({ data, error }) => {

      if (error) {
        console.error(error);
        return;
      }

      if (data.session) {
        goForStatus();
      }

    });

  }


  // ========================================
  // CREATE NEW MEMBER ACCOUNT
  // ========================================

  registerForm?.addEventListener("submit", async (e) => {

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

    const submitButton = registerForm.querySelector(
      'button[type="submit"]'
    );

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Creating account...";
    }

    msg("Creating your Scholarbridge account...");

    try {

      const { data, error } = await sb.auth.signUp({

        email,
        password,

        options: {
          data: {
            full_name: name,
            whatsapp: whatsapp,
            country: country
          }
        }

      });

      if (error) throw error;

      if (!data.user) {
        throw new Error("Account creation could not be completed.");
      }

      // EMAIL CONFIRMATION REQUIRED

      if (!data.session) {

        msg(
          "Account created successfully. Confirm your email, then sign in."
        );

        showLogin();
        return;
      }

      // NEW MEMBERS START THE APPLICATION PROCESS.

      location.replace("level.html");

    } catch (error) {

      console.error(error);

      msg(error.message || "Registration failed.");

    } finally {

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Create account";
      }

    }

  });


  // ========================================
  // MEMBER SIGN IN
  // ========================================

  loginForm?.addEventListener("submit", async (e) => {

    e.preventDefault();

    const email = $("login-email").value.trim();
    const password = $("login-password").value;

    const submitButton = loginForm.querySelector(
      'button[type="submit"]'
    );

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Signing in...";
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

      msg(error.message || "Sign in failed. Please try again.");

    } finally {

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Sign in securely";
      }

    }

  });

});
          
