# SuccubusStats — owner live dashboard

NW.js desktop app showing in real time:
- Players currently online (+ flash on new record).
- Players per zone (live animated bars).
- Top drop-off zones / maps (24h).
- Concurrent players history (24h / 7d / 30d).

## Setup

```
npm install
```

Place [Chart.js UMD](https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js) at `vendor/chart.umd.min.js`.

Place a 256×256 `icon.png` in this folder (window icon).

## Run dev

```
npx nw .
```

On first launch click **Settings**, paste your Railway URL (e.g. `https://your-app.up.railway.app`) and the `ADMIN_TOKEN` you set on Railway. The dashboard reconnects automatically.

## Build SuccubusStats.exe

```
npm run build
```

Outputs `./dist/SuccubusStats/SuccubusStats.exe` (folder with the NW.js runtime).
