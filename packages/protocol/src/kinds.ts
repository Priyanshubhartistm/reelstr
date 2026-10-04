/**
 * Event kinds. Scene reuses NIP-71 addressable short video (34236) - see docs/DESIGN-DECISIONS.md.
 * Story/Cut/Series/Payout are unregistered placeholders chosen from ranges free in the NIPs
 * README as of 2026-09-27. Re-check for collisions before opening the NIP PR.
 */
export const KIND = {
  SCENE: 34236,
  STORY: 31810,
  CUT: 31811,
  SERIES: 31812,
  PAYOUT: 9810,
  /** generation job request and result (plain request/response; not a NIP-90 DVM) */
  JOB_REQUEST: 9811,
  JOB_RESULT: 9812,
  /** NIP-51 video set; Series is mirrored here for interop */
  VIDEO_SET: 30005,
  /** NIP-56 report, NIP-32 label, NIP-57 zap request, NIP-61 nutzap */
  REPORT: 1984,
  LABEL: 1985,
  ZAP_REQUEST: 9734,
  NUTZAP: 9321,
  NUTZAP_INFO: 10019,
} as const;

export const REELSTR_TAG = "reelstr";
export const DEFAULT_LICENSE = "CC-BY-SA-4.0";
/** NIP-57 Appendix G weights are integers that sum to this */
export const WEIGHT_TOTAL = 10_000;
