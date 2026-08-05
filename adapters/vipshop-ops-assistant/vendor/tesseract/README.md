Tesseract.js browser runtime for the Vipshop package/main-image replacement OCR fallback.

Contents:
- tesseract.min.js and worker.min.js from tesseract.js 5.1.1.
- tesseract-core*.js and tesseract-core*.wasm from tesseract.js-core 5.1.1.
- lang/eng.traineddata.gz and lang/chi_sim.traineddata.gz from Project Naptha tessdata 4.0.0.

The adapter script loads these files through the local Crawshrimp backend
`/adapter-assets/vipshop-ops-assistant/vendor/tesseract/...` route, so OCR can
run without depending on CDN availability or another adapter during a task run.
The runtime is kept as a complete package to avoid machine-specific failures
when Tesseract.js resolves related core or language files at runtime.
