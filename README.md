Scholarbrige Academic Hub - One-Step FBK Approval Package

Files:
- index.html: website page (renamed from the saved index(2).html)
- app.js: JavaScript application file
- scf-one-step-approval.sql: Supabase SQL migration for one-step manual FBK approval

Install:
1. Back up your current repository files.
2. Run scf-one-step-approval.sql in Supabase SQL Editor once.
3. Upload index.html and app.js to the root of the GitHub Pages repository, replacing the matching existing files.
4. Confirm index.html references app.js using the same filename.
5. Test signup, FBK submission, waiting page, and admin approve/reject with a test member account.

Do not delete existing database tables or users. The SQL and JavaScript have not been tested against the live Supabase project.
