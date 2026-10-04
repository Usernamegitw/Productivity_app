# Organization XP — pilot

A small web app that tracks a single RPG-style stat, **Organization**, which levels up as you log real tasks. It runs in the browser with no build step and no server-side code. You can add it to a phone home screen.

## Use it

- **Locally:** `npm start` (or `python3 -m http.server 8000`), then open http://localhost:8000.
- **On a phone:** host the folder on any static host (e.g. GitHub Pages → *Settings → Pages → Deploy from branch*). Open the URL and choose *Add to Home Screen*. The app works offline after the first load.

Data is stored in the browser's `localStorage` on each device. To keep a copy or move data between devices, use **Settings & data → Export / Import backup**.

## How XP works

| Concept | Rule (defaults) |
|---|---|
| Log | Task + minutes + resistance rating 1–10 (how hard it felt *this time*) |
| Bottleneck score | Per task, 1–10. Starts at 5.5. Each log moves it 35% of the way toward that log's rating (an exponential moving average). |
| Multiplier | `4 ^ ((score − 5.5) / 4.5)`: a score of 10 gives ×4, 5.5 gives ×1, and 1 gives ×0.25 |
| XP for a log | `minutes × XP-per-minute × multiplier`, using the score after this log's rating is folded in |
| Level | Going from level L to L+1 costs `100 × L` XP (100, 200, 300, …) |

So a task you keep rating as easy loses its boost, and grinding it yields less and less XP. A task that still has real resistance stays worth more. The task list is sorted by current boost, so the biggest bottlenecks appear first.

All derived numbers (scores, multipliers, XP, level) are recomputed by replaying the log history. Deleting a log or changing a setting therefore updates everything consistently. The constants can be changed under **Settings**.

## Code

- `logic.js` contains the pure scoring and leveling functions, with unit tests in `tests/` (`npm test`).
- `app.js`, `index.html` and `styles.css` contain the UI and storage.
- `sw.js`, `manifest.webmanifest` and the icons make it installable and usable offline.
