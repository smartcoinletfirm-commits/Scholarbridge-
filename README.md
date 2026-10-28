Scholarbrige Academic Hub — coordinated redesign

Files
- index.html: existing login/signup, activation, FBK review, dashboard, Hall of Fame and added member tools.
- style.css: responsive academic styling, motion, Hall of Fame, member profile/search/chat styles; braces checked.
- app.js: based on the latest saved Scholarbrige Hall of Fame app.js, retaining existing Supabase flows and adding requested feature handlers.
- setup.sql: required database tables, RLS policies, RPCs and storage bucket for withdrawal requests, upgrades, member search, private chat and profile photos.

Syntax checks performed locally
- node --check app.js: passed.
- CSS opening/closing brace count: matched.
- HTML IDs referenced by the new feature handlers: present.

Before publishing
1. Back up your current GitHub Pages files.
2. Run setup.sql in Supabase SQL Editor. Review any error; it expects the existing profiles, wallets, activation_requests, fbk_code_submissions, admin_notifications tables and scf_is_admin() function already used by your app.
3. Replace index.html, style.css and app.js together.
4. Test with a normal approved member and a separate approved admin account.

Important limits
- The local syntax check is not a live Supabase integration test. The code has not been run against your live database.
- Withdrawal requests are queued for manual review; the website does not transfer funds.
- Upgrade requests remain subject to manual FBK review. The setup trigger updates the level only when an administrator changes the associated FBK submission to accepted.
- Private messages are protected by participant-based RLS. Apply setup.sql before using the member tools.
- Never place a Supabase service-role key in app.js. Keep only the publishable/anon key in browser code.
- 
