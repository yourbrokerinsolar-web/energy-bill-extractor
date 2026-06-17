Energy Bill Extractor
=====================

A small static web app that extracts 12 monthly kWh values from an image of an electricity bill graph and produces an annual snapshot PNG.

Files
- index.html — UI and page content
- app.js — main application logic (image parsing, extraction, report generation)
- styles.css — page styles

Quick start (local)
1. Open the project folder in a terminal:

```bash
cd "/Users/erikgarcia/Documents/Codex/2026-06-16/i-want-to-build-an-app/outputs/energy-bill-extractor"
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

How to use
- Select a utility from the "Utility" dropdown (used in the report and filename).
- Upload a bill image or click "Demo" to load the sample graph.
- Click "Find graph" to auto-place the crop box, or drag the gold box to adjust.
- Enter the graph top value (kWh) and the rate per kWh if desired.
- Click "Extract 12 months" to read the bars.
- If the left axis contains daily kWh values, enable the "Auto-detect daily axis" checkbox (the app also tries to auto-detect).
- Edit any monthly values inline, then click "Download PNG" to save the snapshot. The downloaded filename includes the selected utility and reference month.

Deployment
- This is a static site. Push the folder to a GitHub repo and enable GitHub Pages (branch `main`, root) or deploy via Netlify/Vercel.

Notes
- Extraction is heuristic: results may require manual tuning of the crop box and graph top value.
- Demo mode provides a consistent sample for testing.

License
- MIT (or change as you prefer)
