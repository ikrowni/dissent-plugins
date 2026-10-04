Tesseract OCR for LanternKeep book import (book/book-ocr.js), loaded only when a scanned book is imported.
- tesseract-core-simd-lstm.js / .wasm.gz: tesseract.js-core 6.1.2 (Apache-2.0, LICENSE), the .wasm gzipped -9.
- eng.traineddata.gz.1 + .2: tessdata 4.0.0_best_int English (Apache-2.0), from @tesseract.js-data/eng 1.0.0,
  the .gz split in two because a mirrored plugin file may be at most 2 MB. book-ocr.js joins and unzips them.
