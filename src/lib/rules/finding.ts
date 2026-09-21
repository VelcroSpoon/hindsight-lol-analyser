/**
 * A Finding is one thing the rule engine noticed worth surfacing to the player.
 * This type is the contract between the (pure) rule engine and any consumer —
 * the CLI today, the UI later. Keep it framework-free.
 */
export type Finding = {
  /** Stable identifier of the rule that produced this, e.g. "deaths-without-vision". */
  ruleId: string;
  /** 1 = info, 2 = warning, 3 = critical. */
  severity: 1 | 2 | 3;
  /** In-game time of the event, in milliseconds from game start. */
  gameTimeMs: number;
  /** Short human headline. */
  title: string;
  /** Longer explanation with the specifics. */
  detail: string;
  /** Map coordinate the finding refers to, if it has one. */
  position?: { x: number; y: number };
};
