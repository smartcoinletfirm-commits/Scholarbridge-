
document.addEventListener("DOMContentLoaded", async () => {
  const count = document.getElementById("count");

  function show(message) {
    if (count) count.textContent = message;
  }

  const { data: { user }, error: authError } =
    await sb.auth.getUser();

  if (authError || !user) {
    location.href = "index.html";
    return;
  }

  let checking = false;
  let stopped = false;

  async function checkApplication() {
    if (checking || stopped) return;

    checking = true;

    try {
      const { data: app, error } = await sb
        .from("scholarbridge_applications")
        .select("id,status,level,fbk_number")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (!app) {
        show("Application not found. Please contact support.");
        return;
      }

      const status = String(app.status || "").toLowerCase();

      if (status === "approved") {
        stopped = true;
        show("Application approved! Opening your dashboard...");
        location.replace("dashboard.html");
        return;
      }

      if (status === "rejected") {
        stopped = true;
        show("Your application needs correction. Redirecting...");
        location.replace("fbk.html");
        return;
      }

      if (status === "awaiting_fbk") {
        stopped = true;
        show("Please submit your FBK number...");
        location.replace("fbk.html");
        return;
      }

      show("Your application is under review. Please wait...");
      
    } catch (error) {
      console.error("Application status error:", error);
      show("Unable to check status. Retrying shortly...");
    } finally {
      checking = false;
    }
  }

  // Check immediately
  await checkApplication();

  // Check every 5 seconds
  const interval = setInterval(() => {
    if (stopped) {
      clearInterval(interval);
      return;
    }

    checkApplication();
  }, 5000);

  // Also check when the member returns to this page
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !stopped) {
      checkApplication();
    }
  });
});
