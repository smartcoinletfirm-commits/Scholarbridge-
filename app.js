// Scholarbridge frontend configuration. Use your existing project's publishable/anon key only.
const SUPABASE_URL = "https://vulbvlardmvvxdhqyopn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hve5CvGEO3tyocvupHOv9w_zEVEaN9a";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const msg = (s) => { if ($("auth-message")) $("auth-message").textContent = s; };
if ($("year")) $("year").textContent = new Date().getFullYear();

async function callNotify(event, payload={}) {
  // Notification failures are surfaced; the application record remains saved for admin review.
  const { data, error } = await sb.functions.invoke("notify-admin", { body: { event, ...payload } });
  if (error) console.warn("Notification was not sent:", error.message);
  return {data,error};
}
async function currentApplication() {
  const {data:{user}} = await sb.auth.getUser();
  if (!user) return null;
  const {data,error} = await sb.from("scholarbridge_applications").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error) throw error; return data;
}
async function goForStatus() {
  const app = await currentApplication();
  if (!app) { location.href="index.html"; return; }
  if(app.status==="approved") location.href="dashboard.html";
  else if(app.status==="suspended") location.href="suspended.html";
  else if(app.status==="awaiting_fbk") location.href="fbk.html";
  else if(app.status==="pending_approval" || app.status==="rejected") location.href="pending.html";
  else location.href="level.html";
}
document.addEventListener("DOMContentLoaded",()=>{
  $("show-login")?.addEventListener("click",()=>{$("login-form").classList.remove("hidden");$("register-form").classList.add("hidden");$("show-login").classList.add("active");$("show-register").classList.remove("active");});
  $("show-register")?.addEventListener("click",()=>{$("register-form").classList.remove("hidden");$("login-form").classList.add("hidden");$("show-register").classList.add("active");$("show-login").classList.remove("active");});
  $("login-form")?.addEventListener("submit",async e=>{e.preventDefault();msg("Signing in…");const {error}=await sb.auth.signInWithPassword({email:$("login-email").value,password:$("login-password").value});if(error){msg(error.message);return;}await goForStatus();});
  $("register-form")?.addEventListener("submit",async e=>{e.preventDefault();msg("Creating your account…");const name=$("reg-name").value.trim(),email=$("reg-email").value.trim(),whatsapp=$("reg-whatsapp").value.trim(),country=$("reg-country").value.trim();const {data,error}=await sb.auth.signUp({email,password:$("reg-password").value,options:{data:{full_name:name,whatsapp,country}}});if(error){msg(error.message);return;}if(!data.user){msg("Check your email to confirm your account.");return;}if(!data.session){msg("Account created. Confirm your email, then sign in.");return;}location.href="level.html";});
});
