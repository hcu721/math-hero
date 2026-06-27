# Math Hero

A small, friendly **math-practice web app** that teaches early addition as
*visible patterns* — the math lives on the screen (a 50-chart, ten-frames,
number bonds) instead of in your head.

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

- `http://localhost:8080/?debug` runs the generator self-test (check the console).
- `http://localhost:8080/?skill=<id>` previews any single skill.

## Deploy

See **[DEPLOY.md](DEPLOY.md)** for step-by-step GitHub Pages hosting and
installing on an iPad.

## Project layout

```
index.html            app shell (three screens)
styles.css            big touch targets, high contrast, reduce-motion gated
js/app.js             the engine: state machine + session loop
js/skills.js          skill definitions + problem generators (+ self-test)
js/visuals.js         SVG renderers (50-chart, ten-frame, number bond, …)
js/speech.js          speech-synthesis wrapper
js/sfx.js             Web Audio sound effects
js/progress.js        localStorage persistence
manifest.webmanifest  PWA manifest
service-worker.js     offline caching (bump CACHE_VERSION when you ship)
icons/                app icons
```
