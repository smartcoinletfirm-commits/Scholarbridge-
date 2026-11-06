
let all = [];
let activeFilter = "all";
let adminVerified = false;
let loading = false;

// Existing authorized administrator emails
const ADMIN_EMAILS = [
  "amosi254@gmail.com",
  "testtwo450@gmail.com"
];

const el = id => document.getElementById(id);

function adminMessage(message) {
  if (el("message")) {
    el("message").textContent = message;
  }
}


// ==========================================
// ADMIN VERIFICATION
// Uses existing profiles table
// ==========================================

async function verifyAdmin() {
  const {
    data: { user },
    error: authError
  } = await sb.auth.getUser();

  if (authError || !user) {
    location.replace("index.html");
    return false;
  }

  const email = (user.email || "").toLowerCase();

  const emailAllowed = ADMIN_EMAILS.includes(email);

  const { data: profile, error } = await sb
    .from("profiles")
    .select("id, email, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error && !emailAllowed) {
    throw new Error(
      "Could not verify administrator: " + error.message
    );
  }

  const roleAllowed =
    profile?.role?.toLowerCase() === "admin";

  if (!emailAllowed && !roleAllowed) {
    adminMessage("Administrator access required.");

    await sb.auth.signOut({ scope: "local" });

    location.replace("index.html");
    return false;
  }

  adminVerified = true;
  return true;
}


// ==========================================
// SIGN OUT
// ==========================================

async function adminSignOut() {
  const button =
    el("logout-btn") ||
    el("sign-out-btn") ||
    el("signout-btn");

  if (button) {
    button.disabled = true;
    button.textContent = "Signing out...";
  }

  adminVerified = false;

  try {
    const { error } = await sb.auth.signOut({
      scope: "local"
    });

    if (error) throw error;

    location.replace("index.html");

  } catch (error) {
    console.error(error);

    adminMessage("Sign out failed: " + error.message);

    if (button) {
      button.disabled = false;
      button.textContent = "Sign out";
    }
  }
}


// ==========================================
// STATUS HELPER
// ==========================================

function memberStatus(member) {
  return (
    member.application?.status ||
    member.account_status ||
    "unknown"
  );
}


// ==========================================
// LOAD ALL MEMBERS
// PROFILES IS THE MAIN SOURCE
// ==========================================

async function adminLoad() {
  if (loading) return;

  loading = true;

  const host = el("applications");

  if (host) {
    host.textContent = "Loading members...";
  }

  adminMessage("Verifying administrator...");

  try {
    const allowed = await verifyAdmin();

    if (!allowed) return;

    // Load every member profile.
    const { data: profiles, error: profileError } = await sb
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (profileError) throw profileError;

    // Load available applications separately.
    const { data: applications, error: applicationError } =
      await sb
        .from("scholarbridge_applications")
        .select("*")
        .order("created_at", { ascending: false });

    if (applicationError) throw applicationError;

    // Match applications to profiles using user_id.
    const applicationMap = new Map();

    (applications || []).forEach(application => {
      if (!applicationMap.has(application.user_id)) {
        applicationMap.set(
          application.user_id,
          application
        );
      }
    });

    // Every non-admin profile appears, even without an application.
    all = (profiles || [])
      .filter(profile =>
        (profile.role || "").toLowerCase() !== "admin"
      )
      .map(profile => ({
        ...profile,
        application:
          applicationMap.get(profile.id) || null
      }));

    updateStatistics();
    render();

    adminMessage(
      `${all.length} registered members loaded successfully.`
    );

  } catch (error) {
    console.error("Admin loading error:", error);

    adminMessage(
      "Unable to load members: " + error.message
    );

    if (host) {
      host.textContent =
        "Could not load members. Check administrator permissions and database policies.";
    }

  } finally {
    loading = false;
  }
}


// ==========================================
// STATISTICS
// ==========================================

function updateStatistics() {
  const count = status =>
    all.filter(member =>
      memberStatus(member) === status
    ).length;

  if (el("stat-total")) {
    el("stat-total").textContent = all.length;
  }

  if (el("stat-pending")) {
    el("stat-pending").textContent =
      all.filter(member =>
        [
          "pending_approval",
          "awaiting_activation",
          "awaiting_fbk"
        ].includes(memberStatus(member))
      ).length;
  }

  if (el("stat-approved")) {
    el("stat-approved").textContent =
      count("approved");
  }

  if (el("stat-suspended")) {
    el("stat-suspended").textContent =
      count("suspended");
  }
}


// ==========================================
// RENDER ALL MEMBERS
// ==========================================

function render() {
  if (!adminVerified) return;

  const host = el("applications");

  if (!host) return;

  host.replaceChildren();

  const query = (
    el("search")?.value || ""
  ).toLowerCase();

  const filtered = all.filter(member => {
    const application = member.application || {};

    const searchText = [
      member.full_name,
      member.username,
      member.email,
      member.phone,
      member.country,
      member.id,
      application.fbk_number,
      application.level,
      memberStatus(member)
    ].join(" ").toLowerCase();

    const matchesSearch = searchText.includes(query);

    const status = memberStatus(member);

    const matchesFilter =
      activeFilter === "all" ||
      (
        activeFilter === "pending_approval"
          ? [
              "pending_approval",
              "awaiting_activation",
              "awaiting_fbk"
            ].includes(status)
          : status === activeFilter
      );

    return matchesSearch && matchesFilter;
  });

  if (!filtered.length) {
    const empty = document.createElement("div");

    empty.className = "admin-empty";
    empty.textContent = "No matching members found.";

    host.appendChild(empty);
    return;
  }

  filtered.forEach(member => {
    const application = member.application || {};

    const row = document.createElement("article");
    row.className = "admin-row";

    const details = document.createElement("div");

    const name = document.createElement("h3");
    name.textContent =
      member.full_name || member.username || "Unnamed member";

    const email = document.createElement("p");
    email.textContent =
      "Email: " + (member.email || "Not provided");

    const phone = document.createElement("p");
    phone.textContent =
      "Phone: " +
      (application.phone || member.phone || "Not provided");

    const level = document.createElement("p");
    level.textContent =
      "Member level: " +
      (application.level ?? "Not submitted");

    const fbk = document.createElement("p");
    fbk.textContent =
      "FBK number: " +
      (application.fbk_number || "Not submitted");

    const registered = document.createElement("p");
    registered.textContent =
      "Registered: " +
      (
        member.created_at
          ? new Date(member.created_at).toLocaleString()
          : "Unknown"
      );

    const status = document.createElement("span");
    status.className = "admin-status";
    status.textContent =
      memberStatus(member).replaceAll("_", " ").toUpperCase();

    details.append(
      name,
      email,
      phone,
      level,
      fbk,
      registered,
      status
    );

    const actions = document.createElement("div");
    actions.className = "admin-row-actions";

    const currentStatus = memberStatus(member);

    if (currentStatus !== "approved") {
      addAction(actions, "Approve", () =>
        changeStatus(member, "approved")
      );
    }

    if (currentStatus !== "rejected") {
      addAction(actions, "Reject", () =>
        changeStatus(member, "rejected"), true
      );
    }

    if (
      application.id &&
      currentStatus !== "awaiting_fbk"
    ) {
      addAction(actions, "Return to FBK", () =>
        changeStatus(member, "awaiting_fbk")
      );
    }

    if (currentStatus !== "suspended") {
      addAction(actions, "Suspend", () =>
        changeStatus(member, "suspended"), true
      );
    } else {
      addAction(actions, "Restore", () =>
        changeStatus(member, "approved")
      );
    }

    row.append(details, actions);
    host.appendChild(row);
  });
}


// ==========================================
// ACTION BUTTON CREATOR
// ==========================================

function addAction(host, label, callback, danger = false) {
  const button = document.createElement("button");

  button.type = "button";

  button.className = danger
    ? "secondary admin-danger"
    : "secondary";

  button.textContent = label;

  button.addEventListener("click", callback);

  host.appendChild(button);
}


// ==========================================
// UPDATE MEMBER STATUS
// UPDATES APPLICATION WHEN ONE EXISTS
// ALWAYS SYNCHRONIZES PROFILE
// ==========================================

async function changeStatus(member, newStatus) {
  if (!adminVerified) {
    adminMessage("Administrator access required.");
    return;
  }

  const application = member.application;

  if (newStatus === "awaiting_fbk" && !application?.id) {
    adminMessage(
      "This member has no application to return to FBK."
    );
    return;
  }

  let reason = "";

  if (
    newStatus === "rejected" ||
    newStatus === "awaiting_fbk" ||
    newStatus === "suspended"
  ) {
    reason = prompt(
      "Enter the reason for this action:"
    ) || "";

    if (!reason.trim()) return;
  }

  if (!confirm(
    "Confirm changing this member's status to " +
    newStatus.replaceAll("_", " ") + "?"
  )) return;

  adminMessage("Updating member account...");

  try {
    const allowed = await verifyAdmin();

    if (!allowed) return;

    // Update application only if it exists.
    if (application?.id) {
      const applicationUpdate = {
        status: newStatus,
        rejection_reason:
          ["rejected", "awaiting_fbk", "suspended"]
            .includes(newStatus)
            ? reason.trim()
            : null,
        updated_at: new Date().toISOString()
      };

      const { error } = await sb
        .from("scholarbridge_applications")
        .update(applicationUpdate)
        .eq("id", application.id);

      if (error) throw error;
    }

    // Update the main member profile.
    const profileStatus = {
      approved: "approved",
      rejected: "rejected",
      suspended: "suspended",
      awaiting_fbk: "awaiting_activation"
    }[newStatus];

    const { error: profileError } = await sb
      .from("profiles")
      .update({
        account_status: profileStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", member.id);

    if (profileError) throw profileError;

    adminMessage("Member account updated successfully.");

    await adminLoad();

  } catch (error) {
    console.error("Status update error:", error);

    adminMessage(
      "Could not update member: " + error.message
    );
  }
}


// ==========================================
// EVENT LISTENERS
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

  const logoutButton =
    el("logout-btn") ||
    el("sign-out-btn") ||
    el("signout-btn");

  logoutButton?.addEventListener(
    "click",
    adminSignOut
  );

  el("search")?.addEventListener(
    "input",
    render
  );

  el("refresh")?.addEventListener(
    "click",
    adminLoad
  );

  document.querySelectorAll("[data-filter]")
    .forEach(button => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter;

        document.querySelectorAll("[data-filter]")
          .forEach(item => {
            item.classList.toggle(
              "active",
              item === button
            );
          });

        render();
      });
    });

  adminLoad();
});
      
