document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("fbk-form");
  const fbkInput = document.getElementById("fbk");
  const output = document.getElementById("message");

  if (!form || !fbkInput || !output) return;

  const { data: { user }, error: authError } =
    await sb.auth.getUser();

  if (authError || !user) {
    location.href = "index.html";
    return;
  }

  const { data: app, error: appError } = await sb
    .from("scholarbridge_applications")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (appError || !app) {
    output.textContent = "Unable to load your application.";
    return;
  }

  // Notify admin when member reaches FBK page
  const { error: pageError } = await sb.functions.invoke(
    "Scholarbridge-admin-alerts",
    {
      body: {
        event: "fbk_page_reached",
        application_id: app.id
      }
    }
  );

  if (pageError) {
    console.error("Page notification error:", pageError);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fbk = fbkInput.value.trim();

    if (!/^[0-9]{4}$/.test(fbk)) {
      output.textContent = "Enter exactly four digits.";
      return;
    }

    const button = form.querySelector('[type="submit"]');

    if (button) button.disabled = true;

    output.textContent = "Submitting FBK reference...";

    const { data, error } = await sb.functions.invoke(
      "Scholarbridge-admin-alerts",
      {
        body: {
          event: "fbk_submitted",
          application_id: app.id,
          fbk_number: fbk
        }
      }
    );

    if (error || !data?.success) {
      console.error("FBK submission error:", error, data);

      output.textContent =
        data?.error || error?.message ||
        "Submission failed. Please try again.";

      if (button) button.disabled = false;
      return;
    }

    output.textContent = "FBK submitted successfully.";

    location.href = "processing.html";
  });
});

