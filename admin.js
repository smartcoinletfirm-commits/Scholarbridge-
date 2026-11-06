
let all = [];
let activeFilter = "all";

const el = id => document.getElementById(id);

function adminMessage(message) {
  if (el("message")) el("message").textContent = message;
}


// ==========================================
// VERIFY ADMIN USING EXISTING PROFILES TABLE
// ==========================================

async function verifyAdmin() {
  const { data: { user }, error: authError } = await sb.auth.getUser();

  if (authError || !user) {
    location.replace("index.html");
    return false;
  }

  const { data: profile, error } = await sb
    .from("profiles")
    .select("id, role, account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error("Could not verify administrator: " + error.message);
  }

  if (!profile || profile.role !== "admin") {
    adminMessage("Administrator access required.");
    return false;
  }

  return true;
}


// ==========================================
// LOAD APPLICATIONS
// ==========================================

async function adminLoad() {
  const host = el("applications");

  if (host) host.textContent = "Loading applications...";
  adminMessage("Checking administrator access...");

  try {
    const allowed = await verifyAdmin();

    if (!allowed) return;

    const { data, error } = await sb
      .from("scholarbridge_applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    all = data || [];

    updateStatistics();
    render();

    adminMessage("Applications loaded successfully.");

  } catch (error) {
    console.error("Admin loading error:", error);
    adminMessage(error.message);
  }
}


// ==========================================
// STATISTICS
// ==========================================

function updateStatistics() {
  const count = status =>
    all.filter(a => a.status === status).length;

  if (el("stat-total")) {
    el("stat-total").textContent = all.length;
  }

  if (el("stat-pending")) {
    el("stat-pending").textContent = count("pending_approval");
  }

  if (el("stat-approved")) {
    el("stat-approved").textContent = count("approved");
  }

  if (el("stat-suspended")) {
    el("stat-suspended").textContent = count("suspended");
  }
}


// ==========================================
// RENDER APPLICATIONS
// ==========================================

function render() {
  const host = el("applications");
  if (!host) return;

  host.replaceChildren();

  const query = (el("search")?.value || "").toLowerCase();

  const filtered = all.filter(a => {
    const matchesSearch = [
      a.full_name,
      a.phone,
      a.fbk_number,
      a.status,
      a.level
    ].join(" ").toLowerCase().includes(query);

    const matchesFilter =
      activeFilter === "all" || a.status === activeFilter;

    return matchesSearch && matchesFilter;
  });

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "admin-empty";
    empty.textContent = "No matching applications found.";
    host.appendChild(empty);
    return;
  }

  filtered.forEach(a => {
    const row = document.createElement("article");
    row.className = "admin-row";

    const details = document.createElement("div");

    const name = document.createElement("h3");
    name.textContent = a.full_name || "Unnamed member";

    const phone = document.createElement("p");
    phone.textContent = "Phone: " + (a.phone || "Not provided");

    const level = document.createElement("p");
    level.textContent = "Member level: " + (a.level ?? "—");

    const fbk = document.createElement("p");
    fbk.textContent = "FBK number: " + (a.fbk_number || "—");

    const status = document.createElement("span");
    status.className = "admin-status";
    status.textContent = (a.status || "unknown").replaceAll("_", " ").toUpperCase();

    details.append(name, phone, level, fbk, status);

    const actions = document.createElement("div");
    actions.className = "admin-row-actions";

    if (a.status !== "approved") {
      addAction(actions, "Approve", () => changeStatus(a, "approved"));
    }

    if (a.status !== "awaiting_fbk") {
      addAction(actions, "Return to FBK", () => changeStatus(a, "awaiting_fbk"));
    }

    if (a.status !== "suspended") {
      addAction(actions, "Suspend", () => changeStatus(a, "suspended"), true);
    } else {
      addAction(actions, "Restore", () => changeStatus(a, "approved"));
    }

    row.append(details, actions);
    host.appendChild(row);
  });
}


function addAction(host, label, callback, danger = false) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = danger ? "secondary admin-danger" : "secondary";
  button.textContent = label;
  button.addEventListener("click", callback);

  host.appendChild(button);
}


// ==========================================
// CHANGE APPLICATION AND PROFILE STATUS
// ==========================================

async function changeStatus(application, newStatus) {
  let reason = "";

  if (newStatus === "awaiting_fbk" || newStatus === "suspended") {
    reason = prompt(
      newStatus === "suspended"
        ? "Enter the reason for suspension:"
        : "Enter the reason for returning this application to FBK:"
    ) || "";

    if (!reason.trim()) return;
  }

  const confirmation = confirm(
    "Are you sure you want to change this application to " +
    newStatus.replaceAll("_", " ") + "?"
  );

  if (!confirmation) return;

  adminMessage("Updating member account...");

  try {
    const { data: { user }, error: authError } = await sb.auth.getUser();

    if (authError || !user) {
      throw new Error("Your administrator session has expired.");
    }

    // Update the application.
    const applicationUpdate = {
      status: newStatus,
      rejection_reason:
        newStatus === "awaiting_fbk" ? reason : null,
      updated_at: new Date().toISOString()
    };

    const { error: applicationError } = await sb
      .from("scholarbridge_applications")
      .update(applicationUpdate)
      .eq("id", application.id);

    if (applicationError) throw applicationError;

    // Keep the profile status consistent with application routing.
    const profileStatus = {
      approved: "approved",
      suspended: "suspended",
      awaiting_fbk: "awaiting_activation"
    }[newStatus];

    const { error: profileError } = await sb
      .from("profiles")
      .update({ account_status: profileStatus })
      .eq("id", application.user_id);

    if (profileError) {
      throw new Error(
        "Application updated, but profile status could not be updated: " +
        profileError.message
      );
    }

    adminMessage("Member account updated successfully.");

    await adminLoad();

  } catch (error) {
    console.error("Status update error:", error);
    adminMessage(error.message);
  }
}


// ==========================================
// FILTERS, SEARCH AND REFRESH
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

  el("search")?.addEventListener("input", render);

  el("refresh")?.addEventListener("click", adminLoad);

  document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;

      document.querySelectorAll("[data-filter]").forEach(item => {
        item.classList.toggle("active", item === button);
      });

      render();
    });
  });

  adminLoad();
});
