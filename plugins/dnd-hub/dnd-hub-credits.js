// plugins/dnd-hub/dnd-hub-credits.js
//
// 🔴 LEGALLY REQUIRED. The bundled rules data is SRD 5.1 (2014 rules) and SRD 5.2.1 (2024 rules: spells,
// monsters, magic items, origins, classes, mastery, conditions), both licensed CC-BY-4.0, whose one condition is this
// attribution — one sentence per document, in the wording each asks for. Quiet on purpose (a small link in the lobby), but it
// must stay reachable. Do not remove it. See docs/research/2026-10-02-dnd-vtt-research.md §4.
export const SRD_ATTRIBUTION =
  'This work includes material from the System Reference Document 5.1 ("SRD 5.1") by ' +
  'Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. ' +
  'The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, ' +
  'available at https://creativecommons.org/licenses/by/4.0/legalcode.';
export const SRD52_ATTRIBUTION =
  'This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by ' +
  'Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. ' +
  'The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, ' +
  'available at https://creativecommons.org/licenses/by/4.0/legalcode.';

export function showCredits() {
  document.getElementById('dnd-credits')?.remove();
  const d = document.createElement('div');
  d.id = 'dnd-credits';
  d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);z-index:9999';
  d.innerHTML = `<div style="max-width:520px;background:var(--dnd-surface,#1a1410);border:1px solid var(--dnd-border,#5c4724);border-radius:10px;padding:20px;color:var(--dnd-text,#e8dcc4);font-size:12px;line-height:1.6">
    <div style="font-size:14px;margin-bottom:8px">About and credits</div>
    <p>Not affiliated with or endorsed by Wizards of the Coast.</p>
    <p>${SRD_ATTRIBUTION}</p>
    <p>${SRD52_ATTRIBUTION}</p>
    <button style="margin-top:8px" onclick="document.getElementById('dnd-credits').remove()">Close</button></div>`;
  d.addEventListener('click', e => { if (e.target === d) d.remove(); });
  document.body.appendChild(d);
}
