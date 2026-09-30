export interface Validation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export class Collector {
  errors: string[] = [];
  warnings: string[] = [];
  err(msg: string) {
    this.errors.push(msg);
  }
  warn(msg: string) {
    this.warnings.push(msg);
  }
  result(): Validation {
    return { ok: this.errors.length === 0, errors: this.errors, warnings: this.warnings };
  }
}

/** Minimal event shape validators need; compatible with nostr-tools NostrEvent. */
export interface EventLike {
  id?: string;
  pubkey: string;
  kind: number;
  created_at?: number;
  tags: string[][];
  content: string;
  sig?: string;
}

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}
