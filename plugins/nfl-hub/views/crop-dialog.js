// views/crop-dialog.js — pick the part of an image that actually gets used.
//
// ⚠️ IT OWNS ITS OWN DOM, DELIBERATELY, and is the only thing in this plugin that
// does. Every other view is a pure render function the router paints into
// `#main`, which is right for a page and wrong for this: a drag is dozens of
// updates a second, and routing each one through `router.refresh()` would rebuild
// the whole League tab per pointer move and destroy the very canvas being
// dragged. So the dialog appends itself to `document.body`, outside the mount
// point, and a re-render underneath cannot disturb it.
//
// ⚠️ NO requestAnimationFrame. `core/motion.test.js` enforces that only
// core/motion.js opens one, and the rule is right — `pointermove` is already
// delivered at frame rate, so a rAF here would add a frame of latency and buy
// nothing.
//
// It resolves a Blob to upload, or null when the user backs out.

import { esc } from '../core/ui.js';
import {
  coverScale, clampOffset, cropRect, previewBox, outputSize, parseRatio,
  isAnimatedImage,
} from '../core/image-crop.js';

/**
 * Open the cropper for one file.
 *
 * `spec` is an entry from `IMAGE_SPEC` — `{ ratio, label, best }` — so the window
 * the user drags is the exact shape of the thing that gets rendered, and the
 * output is the exact size the guidance promised.
 *
 * ⚠️ ALWAYS RESOLVES, never rejects. A cancel is an ordinary outcome the caller
 * handles as `null`; a broken image resolves null too, after saying so, because
 * a rejected promise here would surface as a scary refusal in the identity card.
 */
export function openCropper(file, spec, { title = 'Adjust image' } = {}) {
  return new Promise((resolve) => {
    const ratio = parseRatio(spec.ratio);
    const box = previewBox(ratio.w, ratio.h);
    const out = outputSize(spec.best);

    const url = URL.createObjectURL(file);
    const state = { img: null, scale: 1, offset: { x: 0, y: 0 }, dragging: null, animated: false };

    const root = document.createElement('div');
    root.className = 'cropper';
    root.innerHTML = shell({ title, spec, box });
    document.body.appendChild(root);

    const canvas = root.querySelector('.cr-canvas');
    const zoom = root.querySelector('.cr-zoom');
    const note = root.querySelector('.cr-note');
    const accept = root.querySelector('[data-cr="accept"]');
    const whole = root.querySelector('[data-cr="whole"]');
    canvas.width = box.w;
    canvas.height = box.h;

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('keydown', onKey, true);
      URL.revokeObjectURL(url);
      root.remove();
      resolve(value);
    };

    function draw() {
      const ctx = canvas.getContext('2d');
      if (!ctx || !state.img) return;
      ctx.clearRect(0, 0, box.w, box.h);
      const w = state.img.width * state.scale;
      const h = state.img.height * state.scale;
      ctx.drawImage(
        state.img,
        box.w / 2 + state.offset.x - w / 2,
        box.h / 2 + state.offset.y - h / 2,
        w, h,
      );
    }

    const reclamp = () => {
      state.offset = clampOffset(
        state.offset, state.img.width, state.img.height, state.scale, box.w, box.h,
      );
    };

    function onMove(e) {
      if (!state.dragging) return;
      // ⚠️ Clamped on every move rather than only on release, so the image cannot
      // be flung past its limit and snap back — that reads as the drag breaking.
      state.offset = clampOffset(
        {
          x: state.dragging.ox + (e.clientX - state.dragging.mx),
          y: state.dragging.oy + (e.clientY - state.dragging.my),
        },
        state.img.width, state.img.height, state.scale, box.w, box.h,
      );
      draw();
    }
    const onUp = () => { state.dragging = null; canvas.classList.remove('is-dragging'); };
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (!state.img) return;
      state.dragging = { mx: e.clientX, my: e.clientY, ox: state.offset.x, oy: state.offset.y };
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('wheel', (e) => {
      if (!state.img) return;
      e.preventDefault();
      setScale(state.scale * (1 - e.deltaY * 0.0015));
    }, { passive: false });
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('keydown', onKey, true);

    zoom.addEventListener('input', () => setScale(minScale() * Number(zoom.value)));
    root.querySelector('[data-cr="cancel"]').addEventListener('click', () => finish(null));
    root.querySelector('.cr-scrim').addEventListener('click', () => finish(null));

    const minScale = () => coverScale(state.img.width, state.img.height, box.w, box.h);

    function setScale(next) {
      const min = minScale();
      // ⚠️ THE FLOOR IS COVER, NOT AN ARBITRARY 0.1. Below it a gap opens at the
      // edge of the window and the output carries transparent bands.
      state.scale = Math.min(min * 8, Math.max(min, next));
      zoom.value = String(state.scale / min);
      reclamp();
      draw();
    }

    accept.addEventListener('click', () => {
      const rect = cropRect({
        imgW: state.img.width, imgH: state.img.height,
        scale: state.scale, offset: state.offset, boxW: box.w, boxH: box.h,
      });
      const c = document.createElement('canvas');
      c.width = out.w;
      c.height = out.h;
      const ctx = c.getContext('2d');
      if (!ctx) { finish(null); return; }
      // Smoothing on, quality high: this is a downscale of a photo, and the
      // default nearest-ish sampling on a big reduction looks visibly gritty.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(state.img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, out.w, out.h);
      // ⚠️ toBlob CAN RETURN NULL — an unsupported type, or a tainted canvas.
      // The frame is null-origin and the source is a blob URL it created itself,
      // so it should never taint; "should never" is exactly the case that needs a
      // branch rather than an exception.
      c.toBlob((blob) => {
        if (!blob) { fail('This image could not be processed. Try a PNG or JPEG.'); return; }
        finish(blob);
      }, 'image/webp', 0.92);
    });

    // Animated images only: keep every frame by uploading the original untouched.
    whole.addEventListener('click', () => finish(file));

    function fail(message) {
      note.textContent = message;
      note.hidden = false;
      note.classList.add('is-bad');
    }

    const img = new Image();
    img.onload = async () => {
      state.img = img;
      state.scale = minScale();
      state.offset = { x: 0, y: 0 };
      zoom.value = '1';
      draw();

      // ⚠️ ASKED, NOT DECIDED. A canvas captures ONE FRAME, so cropping a GIF
      // returns a still. The client's own editor preserves animation by uploading
      // the original and storing crop metadata; this module has nowhere to put
      // that metadata — the record holds a file id and nothing else — so the
      // honest move is to offer both and say what each costs.
      state.animated = await isAnimatedImage(file);
      if (state.animated) {
        note.textContent = 'This image is animated. Cropping it will freeze it to a '
          + 'single frame — use the whole image to keep it moving.';
        note.hidden = false;
        whole.hidden = false;
        accept.textContent = 'Crop anyway (becomes a still)';
        accept.classList.remove('primary');
        whole.classList.add('primary');
      }
    };
    img.onerror = () => fail('That image could not be opened.');
    img.src = url;
  });
}

function shell({ title, spec, box }) {
  return `
    <div class="cr-scrim"></div>
    <div class="cr-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3 class="cr-title">${esc(title)}</h3>
      <p class="cr-hint">Drag to reposition · scroll or use the slider to zoom</p>
      <div class="cr-stage" style="width:${box.w}px;height:${box.h}px">
        <canvas class="cr-canvas"></canvas>
        <div class="cr-frame${spec.ratio === '1 / 1' ? ' is-circle' : ''}"></div>
      </div>
      <p class="cr-note" hidden></p>
      <div class="cr-zoom-row">
        <span class="cr-zoom-label">Zoom</span>
        <input class="cr-zoom" type="range" min="1" max="8" step="0.01" value="1"
               aria-label="Zoom">
      </div>
      <div class="cr-actions">
        <button class="btn" data-cr="cancel" type="button">Cancel</button>
        <button class="btn" data-cr="whole" type="button" hidden>Use whole image</button>
        <button class="btn primary" data-cr="accept" type="button">Use this</button>
      </div>
      <p class="cr-out">Saved at ${esc(spec.best)}</p>
    </div>`;
}
