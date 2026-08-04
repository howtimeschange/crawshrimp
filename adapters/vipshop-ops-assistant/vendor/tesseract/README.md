Tesseract.js browser runtime for the Vipshop package/main-image replacement OCR fallback.

Contents:
- tesseract.min.js and worker.min.js from tesseract.js 5.1.1.
- tesseract-core-lstm.wasm.js from tesseract.js-core 5.1.1.
- lang/chi_sim.traineddata.gz from the Tesseract OCR tessdata_fast repository.

The adapter script loads these files through the local Crawshrimp backend
`/adapter-assets/vipshop-ops-assistant/vendor/tesseract/...` route, so OCR can
run without depending on CDN availability or another adapter during a task run.
The script pins the browser worker to this embedded LSTM core file and fast
Chinese language data so the packaged desktop update ZIP stays below the R2
upload limit.
