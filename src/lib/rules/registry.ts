import type { Rule } from "./engine";
import { deathsWithoutVisionRule } from "./rules/deathsWithoutVision";
import { laneDifferentialRule } from "./rules/laneDifferential";
import { diedWithUnspentGoldRule } from "./rules/diedWithUnspentGold";

/**
 * The rule registry: the single list of active rules.
 *
 * Adding a rule is exactly two edits — a new file under ./rules exporting a
 * `Rule`, and one line here. No existing rule, and no engine code, ever
 * changes. The three rules below were added that way.
 */
export const rules: Rule[] = [
  deathsWithoutVisionRule,
  laneDifferentialRule,
  diedWithUnspentGoldRule,
];
