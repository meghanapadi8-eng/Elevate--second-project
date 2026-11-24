# Elevate

Elevate is a browser-based career workspace for students and early-career professionals. It brings resume building, ATS readiness, career guidance, job discovery, application tracking, interview preparation, letters, analytics, and AI assistance into one focused workflow.

## Features

- ATS-friendly resume builder with live preview, templates, scoring, import/export, and PDF download
- Combined Career page with a personalized career-fit quiz and 30-day roadmap
- Live remote job search with filters, saved jobs, resume matching, and application tracking
- Application Workspace for tailoring a resume, creating a letter, and recording follow-ups
- AI Career Copilot and career planning informed by the career assessment
- Interview preparation, analytics, profile management, and light/dark themes
- Local browser storage with an optional Python API and SQLite account synchronization

## Run locally

1. Install Python 3.10+ and XAMPP (Apache serves the static website).
2. Place this folder at `C:\xampp\htdocs\Elevate`.
3. In a terminal at the project folder, run `python -m pip install -r requirements.txt`.
4. Start the API with `python -m uvicorn backend.main:app --reload`.
5. Open [http://localhost/Elevate/](http://localhost/Elevate/) in a browser. If you use another website origin, add it to the API's CORS allowlist.

The API creates `data/elevate.sqlite3` and its tables automatically. Static product features work without an account; authentication and server-synced records require the Python API.

To preserve existing MySQL accounts and records, back up your MySQL database, set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE`, then run `python migrate_mysql_to_sqlite.py` once before starting the API. The importer refuses to merge into a SQLite database that already contains users. Keep the MySQL backup until you have verified the imported records. Users should sign in again after migration.

Job Search uses live listings from the Himalayas public jobs API when Adzuna credentials are not set. No API key is needed for this fallback. Set `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` to prefer Adzuna. For generative AI, set `GEMINI_API_KEY` (preferred) or `OPENAI_API_KEY`; Copilot, resume tools, and career planning use the configured provider and retain guided responses when no key is set. For local development, put the Gemini key in `backend/.env` as `GEMINI_API_KEY=...`; this file is ignored by Git and read only by the Python API. Never put provider keys in browser JavaScript or HTML.

## Deploy the app

The frontend is a static site hosted on Netlify; the Python API runs separately on Render. Netlify's build publishes only the root HTML, CSS, and JavaScript files plus `js/`, so backend source, configuration, and database files are not included in the site.

1. Connect the repository to Netlify. The included `netlify.toml` builds and publishes the static frontend.
2. In Render, create a **Blueprint** from the repository and select `render.yaml`. The Blueprint creates the Python API with a generated JWT secret and a `/health` health check.
3. Wait for Render to deploy, then verify `https://elevate-api-meghanapadi8-eng.onrender.com/health` returns `"ok": true`.
4. Netlify serves the frontend at `https://melevate.netlify.app`; `js/auth.js` uses the Render API outside localhost. The Render Blueprint allows this Netlify origin and the GitHub Pages origin.

The Render free instance has ephemeral storage: SQLite users and records can be lost when the service restarts, redeploys, or sleeps. Use durable storage before relying on this backend for important user data. If you host the frontend on a different domain, update `ELEVATE_CORS_ORIGINS` in Render to include that exact origin. Add SMTP environment variables in Render before relying on password-reset email. Do not put secrets in frontend files or commit them.

## Project structure

```text
index.html                 Product homepage
dashboard.html             Career workspace dashboard
resume-builder.html        Resume editor and live preview
job-search.html            Job discovery and matching
application-tracker.html   Application pipeline
career-advisor.html        Career-fit quiz and 30-day career plan
copilot.html               AI career assistant
backend/main.py            FastAPI application and SQLite database
js/auth.js                 Client-side authentication helper
*.css / *.js               Page-specific styles and behavior
database.sql               Legacy MySQL schema used by the migration importer
migrate_mysql_to_sqlite.py One-time MySQL-to-SQLite data migration
```

## Configuration

Configure these environment variables in the Python process (never in frontend JavaScript or committed files):

- `ELEVATE_ENV=production`
- `ELEVATE_SQLITE_PATH` (optional; defaults to `data/elevate.sqlite3`)
- `ELEVATE_JWT_SECRET` (at least 32 characters; generate a unique random secret)
- `ELEVATE_CORS_ORIGINS` (comma-separated allowed website origins; defaults to local development origins)
- Optional integrations: `GEMINI_API_KEY`, `GEMINI_MODEL` (defaults to `gemini-3.8-flash`), `OPENAI_API_KEY`, `OPENAI_MODEL`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, and `ADZUNA_COUNTRY`
- Password-reset email: `ELEVATE_BASE_URL`, `ELEVATE_SMTP_HOST`, `ELEVATE_SMTP_PORT`, `ELEVATE_SMTP_ENCRYPTION` (`tls` or `ssl`), `ELEVATE_SMTP_USERNAME`, `ELEVATE_SMTP_PASSWORD`, `ELEVATE_MAIL_FROM`, and optionally `ELEVATE_MAIL_FROM_NAME`

Set production secrets in the API host's environment settings (Render prompts for `GEMINI_API_KEY` from `render.yaml`). For local XAMPP, use `ELEVATE_BASE_URL=http://localhost/Elevate`; in production use your HTTPS site URL, set `ELEVATE_CORS_ORIGINS`, and change `API_BASE` in `js/auth.js` to the deployed Python API URL. Never commit SMTP/provider credentials. Password reset links are single-use and expire after 60 minutes. Back up the SQLite file regularly and use HTTPS in production. The website API is served by FastAPI in `backend/main.py`; the browser frontend connects to it on port 8000 during local development.

## Quality checklist

- Test the website through Apache at `http://localhost/Elevate/` and keep Uvicorn running for backend features.
- Test mobile navigation, light/dark mode, resume export, authentication, and saved application data.
- Use `security.html` for API health and `launch-center.html` for the in-product readiness checklist.
- Run all API and page/asset smoke tests with `python -m unittest discover -s tests -v`.
- View the end-to-end user journey in [docs/website-flow.md](./docs/website-flow.md).
