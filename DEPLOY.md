# Deploying Math Hero to GitHub Pages

Math Hero is plain static files (no build step), so hosting it is just
"put these files on an HTTPS URL." GitHub Pages does that for free. This
guide takes you from the local folder to a full-screen, offline app icon
on the iPad.

> **Why GitHub Pages?** The PWA features — install, offline, reliable
> speech — require a **secure origin (HTTPS)**. `localhost` is secure for
> dev, but the iPad can't reach your PC's `localhost`. GitHub Pages gives
> a public HTTPS URL the iPad *can* reach, at $0.

---

## 0. Prerequisites
- A free GitHub account.
- Git installed (`git --version` to check).
- The iPad you'll install on.

## 1. Test locally first
Never deploy something you haven't run. Serve over HTTP (not `file://` —
that breaks the ES-module imports):

```bash
python -m http.server 8080
# open http://localhost:8080
```

> On Windows, if typing `python` pops open the Microsoft Store, install Python
> from python.org (or use `py -m http.server 8080`).

- Play a full session end-to-end.
- Open `http://localhost:8080/?debug` → check the console says the
  generator self-test passed.
- DevTools → Application → Service Workers: confirm it registers, and
  Application → Manifest: confirm no errors and the icons show.
- DevTools → Lighthouse → run the **Progressive Web App** / installability
  audit → confirm "installable" and "works offline" pass.

## 2. Make it a git repo and push

> **⚠ Privacy first — the repo will be PUBLIC.** On a **free** GitHub account,
> Pages only publishes from a **public** repo (private-repo Pages needs a paid
> plan, which breaks the $0 rule). So everything you push is world-readable.
> This project's `.gitignore` already excludes the internal planning docs
> (`.claude/`, `CLAUDE.md`) so they stay off the public web — keep it that way
> unless you deliberately mean to publish them.

From the project folder (`math_hero/`):

```bash
git init
git add .          # .gitignore keeps the private docs out
git commit -m "Math Hero — PWA shell ready for deploy"
```

> First time using git on this machine? Set your identity once or the commit
> errors out:
> `git config --global user.name "Your Name"` /
> `git config --global user.email "you@example.com"`.

Create a **public** repo on GitHub (required for free Pages), then:

```bash
git remote add origin https://github.com/<your-username>/math-hero.git
git branch -M main
git push -u origin main
```

## 3. Turn on GitHub Pages
On GitHub: **repo → Settings → Pages**.
- **Source:** "Deploy from a branch"
- **Branch:** `main`, folder `/ (root)` → **Save**

Wait ~1 minute. The page shows your URL:
`https://<your-username>.github.io/math-hero/`

> The `.nojekyll` file in this repo tells Pages to skip Jekyll processing
> and serve every file as-is (safer for the service worker + manifest).

## 4. Install on the iPad
1. Open the URL in **Safari** (must be Safari, not Chrome, for Add to
   Home Screen on iOS).
2. Tap **Share → Add to Home Screen → Add**.
3. Launch from the new **Math Hero** icon — it should open **full-screen**
   (no Safari chrome). The icon should be the gold star.

## 5. Verify it actually works (the real test)
On the installed app:
- [ ] **Speech:** the first problem is *spoken* (tap Start, listen). This
      is the #1 risk on iOS — confirm on the real device.
- [ ] **Text always shows** even if audio is muted/fails.
- [ ] **Offline:** turn on **Airplane Mode**, fully close the app, reopen
      it from the icon → it still loads and plays (proves the cache).
- [ ] **Persistence:** play a session, close, reopen → stars/progress
      survive (localStorage).
- [ ] **Both orientations** look OK on the iPad.

## 6. Shipping an update later (don't skip this)
After you change any file:

1. **Bump the cache version** in `service-worker.js`:
   `const CACHE_VERSION = "v1";` → `"v2"`.
   This is what forces devices to pull the new build instead of serving
   the old cached one (PRD risk #2 — stale cache).
2. Commit and push.
3. On the iPad, open the app **twice**: the first open fetches the new
   service worker in the background; the second open runs it. (Or pull to
   refresh inside Safari once before relying on the installed icon.)

To confirm an update landed: ship a *visible* change (e.g. the title),
push, bump the version, reopen on the device, and check it appears.

---

## Troubleshooting
- **Icon is a gray page / screenshot, not the star** → the
  `apple-touch-icon` link or `icons/apple-touch-icon.png` isn't reachable.
  Check the path and that the file pushed.
- **App opens in Safari with the address bar, not full-screen** → the
  `apple-mobile-web-app-capable` meta is missing, or you opened a
  bookmark instead of the Home Screen icon.
- **Old version keeps showing after a push** → you forgot to bump
  `CACHE_VERSION`. Bump it, push, reopen twice.
- **Blank page on GitHub Pages but works on localhost** → almost always a
  path issue. All asset paths in this project are **relative** (e.g.
  `styles.css`, `js/app.js`, `./service-worker.js`) so they resolve correctly
  under the `/math-hero/` subpath. Don't change any to absolute (`/…`) paths.
- **Brief blank navy screen when launching the installed app** → expected.
  iOS PWAs have no custom splash screen without extra startup images; it
  flashes the background color for a moment, then the app paints. Harmless.
- **404 on the URL** → Pages can take a minute on first deploy; also
  confirm Settings → Pages shows the branch/folder you pushed to.
