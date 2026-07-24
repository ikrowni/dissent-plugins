// Headless render of the clips-gallery landing against a stubbed Dissent SDK.
// Asserts the redesign's invariants: ONE player, five rail rows, preview-first
// sources, the week ribbon, the empty-week fallback, and that switching the
// window chip does not blow away the contributor list.
//
// Uses jsdom (from dissent-client's node_modules) — there is no layout engine, so
// anything requiring real layout is asserted against the stylesheet source instead.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/home/ubuntu/projects/dissent-client/");
const { JSDOM } = require("jsdom");

const html = readFileSync(new URL("./plugin.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)[1];
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];

const sixClips = () =>
  [0, 1, 2, 3, 4, 5].map(i => ({
    attachment_id: String(i),
    video_url: `https://x/v${i}`,
    // clip 1 has no derived preview — the fallback path must still work
    ...(i === 1 ? {} : { preview_url: `https://x/p${i}` }),
    thumb_url: `https://x/t${i}`,
    display_name: `user${i}`,
    avatar_url: "",
    avg_rating: 5 - i * 0.3,
    rating_count: 4,
  }));

async function render({ weekEmpty }) {
  const dom = new JSDOM(`<body><div id="app"></div><div class="toast" id="toast"></div></body>`, {
    url: "https://app.dissent.chat/",
    pretendToBeVisual: true,
    runScripts: "dangerously", // required so the plugin script runs inside the jsdom realm
  });
  const { window } = dom;
  const errors = [];
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function () {};
  window.console.error = (...a) => errors.push(a.join(" "));

  window.Dissent = {
    init: async () => ({ user: { id: "me" } }),
    gallery: {
      featured: async w => ({ clips: w === "week" && weekEmpty ? [] : sixClips() }),
      contributors: async () => ({
        contributors: [
          { user_id: "u1", display_name: "user0", folder: "f", game_name: "RL", clip_count: 3, latest_thumb_url: "" },
          { user_id: "u2", display_name: "user2", folder: "g", game_name: "CS2", clip_count: 1, latest_thumb_url: "" },
        ],
      }),
      list: async () => ({ clips: [] }),
    },
  };

  const el = window.document.createElement("script");
  el.textContent = script;
  window.document.body.appendChild(el);
  // main() is async: let the two awaited SDK calls settle.
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5));
  return { window, doc: window.document, errors };
}

const q = (doc, s) => doc.querySelector(s);
const qa = (doc, s) => [...doc.querySelectorAll(s)];

// ---- populated week ----
{
  const { doc, errors } = await render({ weekEmpty: false });

  assert.equal(qa(doc, ".theater video").length, 1, "exactly one player");
  assert.equal(qa(doc, ".frow").length, 0, "no second hero row");
  assert.equal(qa(doc, ".stage").length, 0, "old full-width stage is gone");
  assert.equal(qa(doc, ".rrow").length, 5, "five rail rows (top 5 of 6)");
  assert.ok(q(doc, ".rrow").classList.contains("cur"), "row 1 selected on load");
  assert.match(q(doc, ".theater .ribbon").textContent, /Clip of the week/, "week ribbon");
  assert.equal(q(doc, ".theater video").getAttribute("src"), "https://x/p0", "muted autoplay uses the preview");
  assert.equal(q(doc, ".theater video").getAttribute("poster"), "https://x/t0", "player has a poster");
  assert.equal(q(doc, ".theater video").getAttribute("preload"), "metadata");
  assert.equal(qa(doc, ".railnote").length, 0, "no fallback note on a populated week");
  assert.equal(qa(doc, ".contrib").length, 2, "contributors rendered in the rail");
  assert.ok(q(doc, ".rail #spotrail"), "spotlight lives inside the rail");

  // clicking rank 2 (no preview_url) moves selection and falls back to the original
  q(doc, '.rrow[data-r="1"]').click();
  assert.ok(q(doc, '.rrow[data-r="1"]').classList.contains("cur"), "click moves selection");
  assert.ok(!q(doc, '.rrow[data-r="0"]').classList.contains("cur"), "previous row deselected");
  assert.equal(qa(doc, ".theater video").length, 1, "still exactly one player after switching");
  assert.equal(q(doc, ".theater video").getAttribute("src"), "https://x/v1", "falls back to original when no preview");

  assert.deepEqual(errors, [], "no console errors");
  console.log("smoke: populated week ok");
}

// ---- empty week falls back to all time ----
{
  const { doc, errors } = await render({ weekEmpty: true });
  assert.match(q(doc, ".theater .ribbon").textContent, /Top rated/, "ribbon relabelled on fallback");
  assert.equal(qa(doc, ".railnote").length, 1, "fallback note shown");
  assert.match(q(doc, ".railnote").textContent, /No clips rated this week yet/);
  assert.equal(qa(doc, ".rrow").length, 5, "rail still populated from all-time");
  assert.equal(qa(doc, ".theater video").length, 1, "exactly one player");
  assert.deepEqual(errors, [], "no console errors");
  console.log("smoke: empty-week fallback ok");
}

// ---- switching the window chip must not destroy the contributor list ----
{
  const { doc, errors } = await render({ weekEmpty: false });
  assert.equal(qa(doc, ".contrib").length, 2);
  q(doc, '.chip[data-win="all"]').click();
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(qa(doc, ".contrib").length, 2, "contributors survive a window switch");
  assert.equal(qa(doc, ".rrow").length, 5, "rail re-rendered");
  assert.equal(qa(doc, ".theater video").length, 1, "still one player");
  assert.deepEqual(errors, [], "no console errors");
  console.log("smoke: chip switch preserves contributors ok");
}

// ---- owner can find and use delete on their own gallery ----
{
  const deleted = [];
  const dom = new JSDOM(`<body><div id="app"></div><div class="toast" id="toast"></div></body>`, {
    url: "https://app.dissent.chat/",
    pretendToBeVisual: true,
    runScripts: "dangerously",
  });
  const { window } = dom;
  const errors = [];
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function () {};
  window.console.error = (...a) => errors.push(a.join(" "));
  window.confirm = () => true;

  const mine = [
    { attachment_id: "m1", video_url: "https://x/v1", thumb_url: "https://x/t1", caption: "one", created_at: "2026-07-20", avg_rating: 0, rating_count: 0 },
    { attachment_id: "m2", video_url: "https://x/v2", thumb_url: "https://x/t2", caption: "two", created_at: "2026-07-21", avg_rating: 0, rating_count: 0 },
  ];
  window.Dissent = {
    init: async () => ({ user: { id: "owner" } }),
    gallery: {
      featured: async () => ({ clips: [] }),
      contributors: async () => ({ contributors: [{ user_id: "owner", display_name: "me", folder: "f", game_name: "RL", clip_count: 2, latest_thumb_url: "" }] }),
      list: async () => ({ clips: mine }),
      deleteClip: async id => { deleted.push(id); return {}; },
    },
  };
  const el = window.document.createElement("script");
  el.textContent = script;
  window.document.body.appendChild(el);
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5));

  const doc = window.document;
  doc.querySelector(".contrib").click();
  for (let i = 0; i < 25; i++) await new Promise(r => setTimeout(r, 5));

  assert.equal(qa(doc, ".card").length, 2, "own clips rendered");
  assert.equal(qa(doc, ".card .del").length, 2, "each own card has a quick-delete control");
  assert.equal(qa(doc, '.edit button[data-act="delete"]').length, 2, "each own card has a Delete action");

  // The grid sorts newest-first, so card 0 is m2 (2026-07-21), not m1. The delete
  // control must follow the RENDERED order, not the source array.
  qa(doc, ".card .del")[0].click();
  for (let i = 0; i < 25; i++) await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(deleted, ["m2"], "quick-delete deletes the clip it is actually attached to");
  assert.deepEqual(errors, [], "no console errors");
  console.log("smoke: owner delete ok");
}

// ---- non-owners must never see delete ----
{
  const { doc } = await render({ weekEmpty: false });
  // landing shows other people's clips only; no owner controls anywhere
  assert.equal(qa(doc, ".card .del").length, 0, "no delete control for non-owners");
  console.log("smoke: non-owner has no delete ok");
}

// ---- layout rules jsdom cannot compute, asserted against the stylesheet ----
{
  assert.match(style, /\.landing\{display:grid;grid-template-columns:minmax\(240px,320px\) minmax\(0,1fr\)/,
    "landing is a two-column grid");
  assert.match(style, /@media\(max-width:760px\)\{\.landing\{grid-template-columns:1fr\}/,
    "landing collapses to one column on narrow panes");
  assert.match(style, /\.theater video[^}]*max-height:56vh/, "player height is capped");
  assert.ok(!/\.frow\{/.test(style), "the second-hero row rule is deleted");
  console.log("smoke: stylesheet rules ok");
}

console.log("smoke ok");
