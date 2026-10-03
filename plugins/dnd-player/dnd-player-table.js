// dnd-player-table.js — what the DM's Table rules change on a player's sheet: trap saves, the initiative roll, the
// death-save reminder. Pure; dnd-player-main.js does the clicking and saving. The switches: lk-table-rules.js.
import { abilityMod, profBonus, saveForHalf } from './lk-rules5e.js';

/** The bonus a hero adds to a saving throw: ability modifier, plus proficiency when trained in it. */
export function saveBonus(char, eff, ab) {
  return abilityMod(eff[ab]) + ((char.savingThrows || []).includes(ab) ? profBonus(char.level) : 0);
}

/** The words of a trap's save prompt; the DC only when the table shows hints. */
export function trapPrompt(trap, hints) {
  return `Roll a ${trap.saveAbility.toUpperCase()} save${hints ? `, DC ${trap.saveDC}` : ''}`;
}

/** A trap's damage after the hero's save (half on a success), and the line that explains it. */
export function trapResult(trap, d20, bonus, hints) {
  const damage = trap.damage || 0;
  if (!trap.saveAbility || !trap.saveDC) return { damage, note: '' };
  const total = d20 + bonus;
  const r = saveForHalf(damage, total, trap.saveDC);
  const vs = hints ? ` vs DC ${trap.saveDC}` : '';
  const sign = bonus >= 0 ? '+' : '';
  return { damage: r.damage, note: ` ${trap.saveAbility.toUpperCase()} save ${d20}${sign}${bonus} = ${total}${vs}: ${r.saved ? 'half damage' : 'failed'}.` };
}

/** My row is in the fight and has no roll yet (Table rules: playersRollInitiative). */
export function needsMyRoll(init, userId) {
  return !!init?.active && !!init.order?.some(c => c.type === 'player' && c.userId === userId && c.roll == null);
}

/** The turn key ("round:index") when my turn starts at 0 HP and I have not been reminded this turn; else null. */
export function deathSaveTurn(init, userId, char, lastKey) {
  if (!init?.active || init.waiting || !char || char.stable || char.dead || !(char.hp <= 0)) return null;
  const i = init.currentIndex || 0;
  const cur = init.order?.[i];
  if (cur?.type !== 'player' || cur.userId !== userId) return null;
  const key = `${init.round || 1}:${i}`;
  return key === lastKey ? null : key;
}
