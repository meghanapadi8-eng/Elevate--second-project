# Elevate end-to-end user flow

```mermaid
flowchart TD
    Start([Open Elevate]) --> Home[Home page]
    Home --> Account{Sign in or create an account?}

    Account -- No --> Local[Explore tools without an account]
    Local --> LocalSave[Save drafts in browser localStorage]
    LocalSave --> WantsSync{Want cross-device sync?}
    WantsSync -- Yes --> Auth[Register or sign in]
    WantsSync -- No --> LocalTools[Resume, career and job tools]

    Account -- Yes --> Auth
    Auth --> AuthOK{Credentials valid?}
    AuthOK -- No --> LoginError[Show validation or sign-in error]
    LoginError --> Auth
    AuthOK -- Yes --> SQLite[(FastAPI stores account data in SQLite)]
    SQLite --> Dashboard[Career dashboard]
    LocalTools --> Dashboard

    Dashboard --> Profile[Complete profile and job preferences]
    Dashboard --> Career[Take career assessment]
    Career --> Plan[Review 30-day career plan]
    Profile --> Resume[Build or update resume]
    Career --> Resume
    Resume --> ATS[Check ATS readiness]
    ATS --> Jobs[Search and match jobs]

    Jobs --> Provider{Adzuna credentials configured?}
    Provider -- Yes --> Adzuna[Search Adzuna]
    Provider -- No --> Himalayas[Search Himalayas]
    Adzuna --> ChooseJob[Review a job]
    Himalayas --> ChooseJob

    ChooseJob --> SaveOrApply{Save or apply?}
    SaveOrApply -- Save --> SavedJobs[Save job to account or browser]
    SaveOrApply -- Apply --> Workspace[Prepare application]
    Workspace --> Tailor[Optionally tailor resume]
    Tailor --> Letter[Create cover letter]
    Letter --> Tracker[Track application and follow-ups]
    Tracker --> Interview[Prepare for interviews]
    SavedJobs --> Tracker

    Dashboard --> Copilot[Ask Career Copilot]
    Profile --> Copilot
    Resume --> Copilot
    Tracker --> Copilot
    Copilot --> AIConfigured{OpenAI configured?}
    AIConfigured -- Yes --> OpenAI[Generate contextual guidance]
    AIConfigured -- No --> Guided[Use guided career responses]

    Profile --> Persistence{Signed in?}
    Resume --> Persistence
    Tracker --> Persistence
    Persistence -- Yes --> SQLite
    Persistence -- No --> LocalSave
    Plan --> Dashboard
    Interview --> Dashboard
    Tracker --> Analytics[Review application analytics]
    Analytics --> Dashboard
```

Password recovery branches from the sign-in page: request a reset email, open its single-use link, set a new password, and return to sign-in. Email delivery requires SMTP configuration.
