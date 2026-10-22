// tower-hud.js — everything drawn over the canvas (spec §3.7, §5): floor, place and time; the key hints; banners and
// the feed; the Esc menu with the audio controls; the waiting card, the node's result, and "this table has closed".
// Plain DOM. 🔴 Names come from other people: they only ever go in through textContent, never innerHTML.
import { fmtTime } from "./hudParts.js";

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (text, onClick, cls = "") => {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
};

export class Hud {
  /** host: the element the HUD fills. on: { leave, resume, giveUp, playAgain, prefs(p) } */
  constructor(host, on) {
    this.on = on;
    host.innerHTML = `
      <div class="tw-tl">
        <div class="tw-box tw-stat"><small>Floor</small><b data-floor></b></div>
        <div class="tw-box tw-stat"><small>Place</small><b data-place></b></div>
        <div class="tw-box tw-stat" data-extra-box hidden><small>&nbsp;</small><b data-extra style="font-size:17px"></b></div>
      </div>
      <div class="tw-tr">
        <div class="tw-box tw-stat"><small>Time</small><b data-time></b></div>
        <div class="tw-box tw-item" data-item-box>
          <span class="g" data-glyph></span>
          <span class="tw-stat"><small>Pick-up</small><b style="font-size:15px"><span data-item>none</span> <kbd>E</kbd></b></span>
        </div>
      </div>
      <div class="tw-keys" data-keys>
        <kbd>A</kbd> <kbd>D</kbd> run · <kbd>W</kbd>/<kbd>Space</kbd> jump (hold = higher, run = much higher) · <kbd>S</kbd> drop · <kbd>J</kbd> punch · <kbd>E</kbd> use pick-up · <kbd>Esc</kbd> menu
      </div>
      <div class="tw-banner" data-banner aria-live="polite"></div>
      <div class="tw-feed" data-feed></div>
      <div data-card></div>`;
    const q = (k) => host.querySelector(`[data-${k}]`);
    this.$ = { floor: q("floor"), place: q("place"), extraBox: q("extra-box"), extra: q("extra"), time: q("time"),
      itemBox: q("item-box"), glyph: q("glyph"), item: q("item"), keys: q("keys"), banner: q("banner"), feed: q("feed"), card: q("card") };
    const leave = button("Leave", () => this.on.leave(), "tw-leave");
    leave.setAttribute("aria-label", "Leave the game");
    host.querySelector(".tw-tr").append(leave);
    this.card = { kind: "none" };
    this.prefs = { music: 0.3, sounds: true };
    /** The last banners said, oldest first (for the checks: "3", "2", "1", "GO!"). */
    this.said = [];
  }

  /** The stats, about ten times a second. */
  setHud(h) {
    const $ = this.$;
    $.floor.textContent = String(h.floor);
    if (h.floors > 0) { const i = el("i", "", ` / ${h.floors}`); $.floor.append(i); }
    $.place.textContent = h.place;
    $.extraBox.hidden = !h.extra;
    $.extra.textContent = h.extra ?? "";
    $.time.textContent = fmtTime(h.timeMs);
    $.itemBox.classList.toggle("has", !!h.item);
    $.itemBox.setAttribute("aria-label", h.item ? `Holding ${h.item.name}` : "Holding nothing");
    $.glyph.textContent = h.item?.glyph ?? "";
    $.item.textContent = h.item?.name ?? "none";
    $.keys.style.opacity = h.keysFaded ? "0.3" : "1";
  }

  /** A big line in the middle ("3", "GO!", "Hurry up!"): it pops, then fades. */
  say(text, cls = "") {
    this.said.push(text);
    if (this.said.length > 20) this.said.shift();
    const b = this.$.banner;
    b.className = "tw-banner";
    b.textContent = text;
    void b.offsetWidth; // restart the animation
    b.className = `tw-banner show ${cls}`;
  }

  /** A short line in the feed, bottom left, gone after a few seconds. */
  note(text) {
    const n = el("div", "tw-box", text);
    this.$.feed.append(n);
    while (this.$.feed.children.length > 4) this.$.feed.firstChild.remove();
    setTimeout(() => n.remove(), 3700);
  }

  setPrefs(p) { this.prefs = p; if (this.card.kind === "menu") this.setCard(this.card); }

  /** The card over the game: none, menu, waiting, result, closed. Rows: { id, name, color, right, place? }. */
  setCard(card) {
    this.card = card;
    const box = this.$.card;
    box.replaceChildren();
    if (card.kind === "none") return;
    const c = el("div", "tw-box tw-card");
    c.setAttribute("role", card.kind === "waiting" || card.kind === "closed" ? "status" : "dialog");
    const rowsList = (rows) => {
      const ol = el("ol");
      rows.forEach((r, i) => {
        const li = el("li");
        const dot = el("i"); dot.style.background = r.color;
        li.append(el("b", "", String(r.place ?? i + 1)), dot, document.createTextNode(r.name), el("span", "", r.right));
        ol.append(li);
      });
      return ol;
    };
    const row = (...buttons) => { const d = el("div", "row"); d.append(...buttons); return d; };
    if (card.kind === "menu") {
      c.setAttribute("aria-label", "Menu");
      c.append(el("h3", "", "Paused for you"), el("p", "", "Nobody else pauses. The mist keeps rising."));
      const audio = el("div", "tw-audio");
      const music = el("label", "", "Music ");
      const range = el("input");
      Object.assign(range, { type: "range", min: "0", max: "1", step: "0.05", value: String(this.prefs.music) });
      range.setAttribute("aria-label", "Music volume");
      range.addEventListener("input", () => this.on.prefs({ ...this.prefs, music: Number(range.value) }));
      music.append(range);
      const sounds = el("label");
      const box2 = el("input"); box2.type = "checkbox"; box2.checked = this.prefs.sounds;
      box2.addEventListener("change", () => this.on.prefs({ ...this.prefs, sounds: box2.checked }));
      sounds.append(box2, document.createTextNode(" Game sounds"));
      audio.append(music, sounds);
      const buttons = [button("Resume", () => this.on.resume(), "pri")];
      if (card.canGiveUp) buttons.push(button("Give up this round", () => this.on.giveUp()));
      buttons.push(button("Leave the game", () => this.on.leave()));
      c.append(audio, row(...buttons));
    } else if (card.kind === "waiting") {
      c.append(el("h3", "", card.title), el("p", "", "Waiting for the others…"), rowsList(card.rows), row(button("Back to the games room", () => this.on.leave())));
    } else if (card.kind === "result") {
      c.setAttribute("aria-label", "Result");
      c.append(el("h3", "", card.title), el("p", "", card.sub));
      if (card.note) c.append(el("p", "", card.note));
      if (card.rows.length) c.append(rowsList(card.rows));
      const again = card.host ? button("Play again", () => this.on.playAgain(), "pri")
        : el("span", "", `${card.hostName} starts the next round`);
      if (!card.host) again.style.cssText = "font-size:13px;opacity:.7;align-self:center";
      c.append(row(again, button("Back to the games room", () => this.on.leave())));
      if (card.best) c.append(el("small", "best", card.best));
      c.append(el("small", "", card.prizeLine));
    } else if (card.kind === "closed") {
      c.append(el("h3", "", "This table has closed"), row(button("Back to the games room", () => this.on.leave(), "pri")));
    }
    box.append(c);
  }
}
