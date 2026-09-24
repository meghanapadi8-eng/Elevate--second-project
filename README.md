# Elevate

Elevate is a browser-based career workspace for students and early-career professionals. It brings resume building, ATS readiness, career guidance, job discovery, application tracking, interview preparation, letters, analytics, and AI assistance into one focused workflow.

## Features

- ATS-friendly resume builder with live preview, templates, scoring, import/export, and PDF download
- Career Advisor quiz with personalized role and skill suggestions
- Job search with filters, saved jobs, resume matching, and application tracking
- Application Workspace for tailoring a resume, creating a letter, and recording follow-ups
- AI Career Copilot and 30-day career planning
- Interview preparation, analytics, profile management, and light/dark themes
- Local browser storage with optional PHP/MySQL account synchronization

## Run locally

1. Install XAMPP and start Apache. Start MySQL if you want account and cloud-sync features.
2. Place this folder at `C:\xampp\htdocs\Elevate`.
3. Open [http://localhost/Elevate/](http://localhost/Elevate/) in a browser.
4. For database-backed features, import `database.sql` into MySQL and configure `api/config/config.php`.

The static product features work without an account. AI, authentication, profile syncing, and server-backed records require the PHP API and their configured provider credentials.

## Project structure

```text
index.html                 Product homepage
dashboard.html             Career workspace dashboard
resume-builder.html        Resume editor and live preview
job-search.html            Job discovery and matching
application-tracker.html   Application pipeline
career-advisor.html        Career-fit quiz
copilot.html               AI career assistant
api/                       PHP API and database configuration
js/auth.js                 Client-side authentication helper
*.css / *.js               Page-specific styles and behavior
database.sql               MySQL schema
```

## Configuration

Keep secrets on the server. Configure database credentials, a strong JWT secret, and AI or job-provider keys through the API configuration or server environment variables. Do not commit secrets to this repository.

## Quality checklist

- Test the site through Apache at `http://localhost/Elevate/`, not by opening files directly.
- Test mobile navigation, light/dark mode, resume export, authentication, and saved application data.
- Use `security.html` for API health and `launch-center.html` for the in-product readiness checklist.
