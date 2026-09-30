import { verifyEvent } from "nostr-tools/pure";
import { validateCut } from "./cut";
import { KIND } from "./kinds";
import { validatePayout } from "./payout";
import { Collector, type EventLike, type Validation } from "./result";
import { validateScene } from "./scene";
import { validateSeries } from "./series";
import { validateStory } from "./story";

/** Dispatch on kind; optionally verify id+sig. Unknown kinds are an error. */
export function validateEvent(e: EventLike, opts: { verifySig?: boolean } = {}): Validation {
  let r: Validation;
  switch (e.kind) {
    case KIND.SCENE:
      r = validateScene(e);
      break;
    case KIND.STORY:
      r = validateStory(e);
      break;
    case KIND.CUT:
      r = validateCut(e);
      break;
    case KIND.SERIES:
      r = validateSeries(e);
      break;
    case KIND.PAYOUT:
      r = validatePayout(e);
      break;
    default: {
      const c = new Collector();
      c.err(`unknown reelstr kind ${e.kind}`);
      r = c.result();
    }
  }
  if (opts.verifySig && !verifySignature(e)) {
    return {
      ok: false,
      errors: ["invalid event id or signature", ...r.errors],
      warnings: r.warnings,
    };
  }
  return r;
}

/**
 * Verify event id and signature. Works on a clean copy: verifyEvent caches its result on a hidden
 * symbol that object spread copies, so a tampered copy of a verified event would otherwise pass.
 */
export function verifySignature(e: EventLike): boolean {
  try {
    const { id, pubkey, created_at, kind, tags, content, sig } = e;
    return verifyEvent({ id, pubkey, created_at, kind, tags, content, sig } as Parameters<
      typeof verifyEvent
    >[0]);
  } catch {
    return false;
  }
}
