// Every element the code hides with `classList.toggle('hidden')` must actually be hidden.
//
// WHY THIS EXISTS. Until 2026-08-17 there was no generic `.hidden` rule in rl-hub-styles.css.
// Every rule was scoped to one element — `.screen.hidden`, `.reg-error.hidden`,
// `.live-debug.hidden` and the two overlays — so adding the class to anything ELSE did
// nothing at all. No error, no failing test, nothing to grep unless you already knew.
//
// Two live bugs came from it:
//   · #btn-cancel-edit — plugin.html says "Hidden during first registration", and it was
//     not. A brand-new user saw a Cancel button with nowhere to go back to.
//   · #versus-panel / #tab-content — showHubTab toggled a class that styled nothing, so the
//     live view never hid and the second tab rendered underneath it. That is what the owner
//     screenshotted.
//
// So this does not hardcode a list. It reads the elements the source actually toggles and
// asserts the stylesheet can hide each one. Toggle 'hidden' on something new and this passes
// only because the generic rule exists — remove that rule and it fails for every element.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'rl-hub-styles.css'), 'utf8');

/// Every .js in the plugin root plus plugin.html — anywhere the class could be applied.
function sources() {
  const files = readdirSync(here)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => join(here, f));
  files.push(join(here, 'plugin.html'));
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

const src = sources();

/// Strip comments so a rule mentioned in prose is never mistaken for a real one.
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the hidden class', () => {
  it('has a generic rule, not only element-scoped ones', () => {
    // A bare `.hidden { … }` selector — not `.screen.hidden`, not `.reg-error.hidden`.
    const generic = /(^|[\s,}])\.hidden\s*\{[^}]*display\s*:\s*none/m.test(cssRules);
    expect(
      generic,
      'rl-hub-styles.css has no generic `.hidden { display: none }` rule, so any element ' +
        'toggled with classList.toggle("hidden") that lacks its own scoped rule stays visible',
    ).toBe(true);
  });

  it('is actually used by the code, or this contract is pointless', () => {
    expect(/classList\.(toggle|add)\(\s*['"]hidden['"]/.test(src)).toBe(true);
  });

  it('hides every element the source toggles it on', () => {
    // Elements toggled by id: `getElementById('x')` … `classList.toggle('hidden')` is too
    // loose to pair up reliably, so assert the property that makes pairing unnecessary —
    // the generic rule covers all of them at once.
    const generic = /(^|[\s,}])\.hidden\s*\{[^}]*display\s*:\s*none/m.test(cssRules);
    if (generic) return; // covered

    // Without the generic rule, every toggled id needs its own scoped rule. Name them.
    const ids = [...src.matchAll(/getElementById\(\s*['"]([\w-]+)['"]/g)].map((m) => m[1]);
    const unscoped = ids.filter((id) => !new RegExp(`#${id}\\.hidden`).test(cssRules));
    expect(unscoped, 'these ids are toggled but nothing hides them').toEqual([]);
  });
});
