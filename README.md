# Mission Engineer — AI agent (Team Interstellar, NASA Space Apps 2026)

Evaluates a user's idea for an open NASA hardware failure and decides: **send to NASA** or **do not send**.
Pure Python standard library: nothing to install.

**Demo video (2 min):** [demo/Mission_Echoes_demo.mp4](demo/Mission_Echoes_demo.mp4)

## Run it (Windows, VS Code terminal)

```bash
python test_cases.py      # runs 3 demo ideas
python server.py          # then open http://localhost:8000
```

Without an API key it runs in **mock mode** (placeholder scores) so you can test the website.
For real evaluation:

1. Copy `.env.example` to `.env`
2. Set `PROVIDER` (`anthropic`, `openai` or `gemini`) and paste your `API_KEY`
3. Optional: set `MODEL` if you want a different model than the default
4. Restart `python server.py`

## Files

| File | What it does |
| --- | --- |
| `agent/prompt.py` | The system prompt and the message template |
| `agent/problems.json` | The 4 open problems (facts + what NASA tried) |
| `agent/agent.py` | Calls the model, checks the JSON, recomputes the score and the decision, saves results |
| `server.py` | Web server + API for the 3D / 360 website |
| `static/index.html` | Engineer challenge page (embedded in the 3D site) |
| `static/reel.js` | Mission Reel: records moments and builds the vertical video on the user's device |
| `static/demo.html` | The full site: character → Mars map → 3D story → engineer challenge → Mission Reel |
| `static/insight/` | The 3D team's InSight scene (three.js), served as is, no build step |
| `static/sounds/` | Narration, sound effects and Mars wind for the 3D story (no music) |
| `test_cases.py` | 3 demo ideas: weak, already tried by NASA, new |
| `data/submissions.jsonl` | Every evaluation (created automatically) |

## The 3D scene inside the site

Open `http://localhost:8000/demo.html`. Clicking InSight on the Mars map opens the 3D scene
full window. `static/insight/` is the 3D project's `src/` and `public/` copied as is, with three
small changes so it runs from this server without Vite:

- `index.html` links `src/style.css` and has an import map: `three` points to `vendor/three/`
  (three.js 0.187, the same version as the project).
- `src/scenes/marsScene.js` finds the model next to the code (`models/insight.glb`).
- `src/bridge.js` tells the site when Mars opens and when each mission starts and ends.
  `main.js` and `mission/mission.js` call it. Opened on its own (`/insight/`), it does nothing.

The site plays the narration and sounds on those events, records the reel moments from the
3D canvas, and shows "Story finished" after a mission, which opens the engineer challenge.
When the 3D team changes the scene, copy their new `src/` over `static/insight/src/` and
keep these three changes.

## API (for the 3D / 360 website)

```js
const res = await fetch("http://localhost:8000/api/evaluate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ problem_id: "dust_solar_panels", text: userIdea, language: "ar" })
});
const result = await res.json();   // result.decision, result.message_to_user, result.total ...
```

- `GET /api/problems` — list of problems (`id`, `title`, `problem`)
- `POST /api/evaluate` — evaluate one idea
- `GET /api/report` — Markdown report of every idea the agent chose to send

Problem ids: `dust_solar_panels`, `cohesive_soil`, `hidden_soft_sand`, `featureless_terrain_navigation`.

The 3D / 360 site can open the idea page directly for a problem and a language:
`http://localhost:8000/?problem=dust_solar_panels&lang=ar` (or `lang=en`).

## Mission Reel: engineer badge

Embed the idea page in the 3D site as an iframe. When the challenge ends, the page sends a message to the 3D site:

```js
window.addEventListener("message", (e) => {
  if (e.data?.type !== "mission-engineer-result") return;
  // e.data.decision: "send_to_nasa" | "do_not_send" | "skipped" | "error"
  // e.data.badge: true only when the agent chose to send the idea to NASA
  if (e.data.badge) reel.addEngineerBadge();   // your reel code
});
```

The reel shows the engineer badge **only** when `badge` is `true`.

## Mission Reel (`static/reel.js`)

Try the whole flow before merging: run `python server.py` and open `http://localhost:8000/demo.html`.
The demo uses a simple 2D stand-in scene. In the 3D site, replace it and keep the same 3 calls:

```html
<script src="reel.js"></script>
```

```js
// 1. once, after the scene and the AudioContext are created
const audioIn = Reel.attach(renderer.domElement, audioContext);
masterGain.connect(audioIn);              // Three.js: listener.gain.connect(audioIn)

// 2. on every interaction (push, dig...): saves a 3.5 s clip
Reel.captureMoment("push");

// 3. after the engineer challenge
const reel = await Reel.build({
  title: problem.title_ar,                // or problem.title in English
  machine: "إنسايت",                      // short machine name ("InSight" in English)
  machineTag: "#InSight",                 // added to the hashtags
  fact: problem.fact_ar,                  // or problem.fact
  badge: result.badge,                    // from the "mission-engineer-result" message
  photo: await Reel.loadPhoto(file),      // optional, only after the user agrees
  lang: "ar",
  onProgress: p => bar.style.width = p * 100 + "%"
});
await Reel.share(reel);                   // share sheet on mobile (with reel.caption), download on desktop
// reel.caption = one line + hashtags, ready to copy
// Reel.drawPoster(canvas, sameOptions) draws the last frame as a preview before building
```

Notes for the 3D team:
- Narration must be an audio file played through the same `AudioContext`; `speechSynthesis` cannot be recorded.
- With Three.js, create the renderer with `preserveDrawingBuffer: true` if captured frames come out black.
- In VR the headset view is doubled (one image per eye): record from a normal spectator camera instead.
- The reel is about 20 s: title, 3 moments, a real fact, then the finale: the user's photo in the helmet, the engineer patch (only if `badge` is true) and the hashtags.
- Everything runs in the browser. Nothing is uploaded.
- Chrome and Safari record H.264 MP4 when they can; otherwise the file is WebM, which some apps do not accept.

## How the decision works

The model scores 5 criteria (1-5). The code recomputes:

```
total = 5*root_cause + 5*principle + 4*novelty + 3*feasibility + 3*simplicity   (max 100)
send_to_nasa  if root_cause >= 3 and principle >= 3 and novelty >= 4 and total >= 75
```

If the model's math or decision is off, the code corrects it (`corrected_by_code: true`).

Before anything is really emailed to NASA, have a team member read the report.
