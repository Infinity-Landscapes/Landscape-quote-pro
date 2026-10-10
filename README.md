# Landscape Quote Pro

Quoting and job-management app for landscapers, by Infinity Landscapes and Design LTD.

## What's here

| Folder | What it is |
|---|---|
| `app/app.html` | The whole app (one file). The claude.ai version is published from it, and the website version is built from it, so both always run the same code. |
| `firebase/` | The website version: Firebase sign-in + database layer (`src/platform.js`), security rules (`firestore.rules`), and `build.py`, which wraps `app/app.html` into `firebase/public/`. |
| `tests/app/` | Automated tests of the app (Playwright, with a stand-in database). |
| `firebase/tests/` | End-to-end test of the website version against the Firebase emulators. |
| `plan/launch_plan.html` | The step-by-step launch plan. |

## Running the tests

```
# app tests (each file is one test)
cd tests/app && node test_smoke_all.js

# website version: build, then test against local Firebase emulators
cd firebase && npm install && python3 build.py
firebase emulators:exec --only auth,firestore "node tests/test_firebase_e2e.js"
```

Firebase project: `landscape-quote-pro` (Firestore in europe-west2, London).
