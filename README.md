# Internship Logbook

A small static site to log daily internship activities: pick a date, write your
notes, and see everything laid out in a table (date / day / week), with CSV,
XLSX, PDF, and image export. Deploys for free on GitHub Pages.

## How it stores data

GitHub Pages only serves static files — there's no server or database. So this
site reads and writes a single `data.json` file **inside your own GitHub repo**,
using the GitHub API:

- **Anyone with the link** can view the log (public read, no login).
- **Only you** can save changes — you sign in once per browser/device with a
  personal access token (PAT), stored only in that browser's `localStorage`.
  It's never committed or sent anywhere except GitHub's API.

## 1. Create the repo

1. Go to https://github.com/new
2. Repo name: `internship-logbook` (or anything you like)
3. Make it **Public** (GitHub Pages + reading `data.json` without login both
   need a public repo, unless you're on a paid plan)
4. Create the repo, then upload all the files from this folder
   (`index.html`, `style.css`, `app.js`, `config.js`, `data.json`) to the repo
   root — either drag-and-drop on the GitHub web UI, or:

```bash
cd internship-logbook
git init
git add .
git commit -m "Initial logbook site"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 2. Edit `config.js`

Open `config.js` and set it to your actual username/repo:

```js
const CONFIG = {
  GITHUB_OWNER: "aaadam-H",
  GITHUB_REPO: "internship-logbook",
  GITHUB_BRANCH: "main",
  DATA_PATH: "data.json"
};
```

Commit and push this change.

## 3. Turn on GitHub Pages

1. In the repo, go to **Settings → Pages**
2. Under "Build and deployment", set **Source: Deploy from a branch**
3. Branch: `main`, folder: `/ (root)` → **Save**
4. After a minute, your site is live at:
   `https://<your-username>.github.io/<your-repo>/`

## 4. Create your personal access token (so you can save entries)

1. Go to https://github.com/settings/personal-access-tokens/new
   (fine-grained tokens — more limited/safer than a classic token)
2. **Resource owner**: your account
3. **Repository access**: "Only select repositories" → choose this repo
4. **Permissions** → **Repository permissions** → **Contents** → set to
   **Read and write**
5. Set an expiration (90 days is reasonable — you'll just repeat this step
   when it expires)
6. Generate the token and copy it (you'll only see it once)

## 5. Sign in on the site

1. Open your live site
2. Click **"Sign in to edit"** in the top right
3. Paste the token → **Save token**
4. You'll now see "● signed in — saves to GitHub", and can log entries,
   edit your profile, and delete rows. Every save creates a small commit
   to `data.json` in your repo — your logbook doubles as a version
   history of your internship.

Anyone else who visits the link sees your entries but has no sign-in
that works (they'd need their own token with write access to your repo,
which you control by never sharing one).

## Notes

- **One entry per day**: saving again on a date you've already logged
  updates that day's notes instead of creating a duplicate row.
- **Week number** is calculated from the "Internship start date" you set
  in your profile (Edit details), not the calendar year.
- **Exports** (CSV / XLSX / PDF / image) work entirely in the browser — no
  server involved — and always reflect what's currently loaded.
- If you ever see "Could not reach GitHub" or "No data.json found yet",
  double check `config.js` matches your actual GitHub username/repo, and
  that the repo is public.
