import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const sha256Hex = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));

/** Validators reject events whose blob hash does not match the downloaded bytes. */
export const blobMatches = (bytes: Uint8Array, expected: string): boolean =>
  sha256Hex(bytes) === expected.toLowerCase();
