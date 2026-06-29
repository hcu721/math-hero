# Math Hero

A small, friendly **math-practice web app** that teaches early math as
*visible patterns* — the math lives on the screen (a 50-chart, ten-frames,
number bonds) instead of in your head. It's a **Practice Board**: a board of
skill tiles you unlock by mastering them, grouped into chapters across "Worlds,"
with the difficulty climbing each "Season." Mastering skills assembles a hero
avatar, and the coins you earn buy outfits in a dress-up shop. **Addition and
subtraction are live; multiplication and division are on the way.**

Built as an installable **PWA**: it works offline and adds to your home screen
like a native app.

## Tech

Plain **HTML / CSS / vanilla JavaScript** — no framework, no build step, no
backend. Data stays on the device (localStorage). All visuals are SVG drawn in
code; all sounds are synthesized with the Web Audio API. $0 to run and host.

## Run it locally

You must serve over HTTP (opening the file directly breaks ES-module imports):

```bash
python -m http.server 8080
# then open http://localhost:8080
```

Dev hooks (append to the URL):

- `?debug` runs the generator self-test (check the console).
- `?skill=<id>` previews any single skill round.
- `?season=N` previews a skill at a harder Season (the difficulty escalator).
- `?design` shows every avatar / shop item on one grid.

## Deploy

See **[DEPLOY.md](DEPLOY.md)** for step-by-step GitHub Pages hosting and
installing on an iPad.

## Project layout

```
index.html            app shell (three screens)
styles.css            big touch targets, high contrast, reduce-motion gated
js/app.js             the engine: board + round state machine
js/skills.js          skill definitions + problem generators (+ self-test)
js/curriculum.js      the skill spine + the bounded-picker mastery gate
js/visuals.js         SVG renderers (50-chart, ten-frame, number bond, …)
js/speech.js          speech-synthesis wrapper
js/sfx.js             Web Audio sound effects
js/progress.js        coins, mastery record, Season state (localStorage)
manifest.webmanifest  PWA manifest
service-worker.js     offline caching (bump CACHE_VERSION when you ship)
icons/                app icons
```
