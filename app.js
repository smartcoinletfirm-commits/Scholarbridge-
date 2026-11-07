
document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("fbk-form");
  const input = document.getElementById("fbk");
  const output = document.getElementById("message");

  if (!form || !input || !output) return;

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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fbk = input.value.trim();

    if (!/^[0-9]{4}$/.test(fbk)) {
      output.textContent = "Enter exactly four digits.";
      return;
    }

    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;

    output.textContent = "Submitting FBK number...";

    try {
      const now = new Date().toISOString();

      // Save application
      const { error: updateError } = await sb
        .from("scholarbridge_applications")
        .update({
          fbk_number: fbk,
          status: "pending_approval",
          submitted_at: now,
          updated_at: now
        })
        .eq("id", app.id)
        .eq("user_id", user.id);

      if (updateError) throw updateError;

      // Create notification directly for admin
      const { error: notificationError } = await sb
        .from("admin_notifications")
        .insert({
          user_id: user.id,
          event_type: "fbk_submitted",
          membership_level: app.level,
          phone: app.phone,
          message:
            `${app.full_name} submitted an FBK number | ` +
            `Phone: ${app.phone} | Level: ${app.level}`,
          submitted_fbk_code: fbk,
          is_read: false
        });

      if (notificationError) {
        throw notificationError;
      }

      output.textContent = "FBK submitted successfully.";
      location.href = "processing.html";

    } catch (error) {
      console.error(error);
      output.textContent =
        "Submission error: " + error.message;

      if (button) button.disabled = false;
    }
  });
});
