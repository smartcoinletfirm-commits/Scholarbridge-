
document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("fbk-form");
  const fbkInput = document.getElementById("fbk");
  const output = document.getElementById("message");

  if (!form || !fbkInput || !output) return;

  // Verify logged-in member
  const { data: { user }, error: authError } = await sb.auth.getUser();

  if (authError || !user) {
    location.href = "index.html";
    return;
  }

  // Load this member's application
  const { data: app, error: appError } = await sb
    .from("scholarbridge_applications")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (appError) {
    output.textContent = "Unable to load your application. Please refresh.";
    console.error(appError);
    return;
  }

  if (!app) {
    location.href = "level.html";
    return;
  }

  // Notify admin that the member reached the FBK page
  const { error: pageNotifyError } = await sb.functions.invoke(
    "notify-admin",
    {
      body: {
        event: "fbk_page_reached",
        application_id: app.id,
        full_name: app.full_name,
        phone: app.phone,
        level: app.level
      }
    }
  );

  if (pageNotifyError) {
    console.warn("FBK page notification failed:", pageNotifyError);
  }

  // Handle FBK submission
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fbk = fbkInput.value.trim();

    if (!/^[0-9]{4}$/.test(fbk)) {
      output.textContent = "Enter exactly four digits.";
      return;
    }

    const submitButton = form.querySelector('[type="submit"]');

    if (submitButton) submitButton.disabled = true;

    output.textContent = "Submitting reference...";

    try {
      // Save FBK number to the application
      const { error: updateError } = await sb
        .from("scholarbridge_applications")
        .update({
          fbk_number: fbk,
          status: "pending_approval",
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", app.id)
        .eq("user_id", user.id);

      if (updateError) {
        throw updateError;
      }

      // Notify admin of the submitted FBK number
      const { error: notifyError } = await sb.functions.invoke(
        "notify-admin",
        {
          body: {
            event: "fbk_submitted",
            application_id: app.id,
            user_id: user.id,
            fbk_number: fbk,
            phone: app.phone,
            level: app.level,
            full_name: app.full_name
          }
        }
      );

      if (notifyError) {
        console.error("Admin notification failed:", notifyError);
        output.textContent =
          "Your FBK number was saved, but admin notification failed. Please contact support.";
        if (submitButton) submitButton.disabled = false;
        return;
      }

      output.textContent = "FBK submitted successfully.";

      location.href = "processing.html";

    } catch (error) {
      console.error("FBK submission error:", error);
      output.textContent =
        error.message || "Submission failed. Please try again.";

      if (submitButton) submitButton.disabled = false;
    }
  });
});
