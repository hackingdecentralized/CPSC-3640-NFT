/**
 * Settings for the illustration matte built by `npm run prepare-assets`, and the
 * fingerprint that tells whether prepared assets are still current.
 */
import sharp from "sharp";
import type {Layout} from "./types";

/** Tuning for the illustration matte. Changing these changes every mask. */
export const MATTE = {
  /** Background colour of the card, measured from an empty margin. */
  background: [23, 23, 30] as const,
  /** Anything brighter than this is artwork: stone, cream, gold, lit windows. */
  brightLuma: 95,
  /** Cool colours (navy, blue leaves, green trees) count as artwork when this far from the background. */
  coolDelta: 14,
  coolMinDistance: 28,
  /** Fill gaps in foliage and tracery narrower than this. */
  closeRadius: 18,
  /** Keep decoration this far from the artwork's edge. */
  marginRadius: 6,
  /** Keep decoration this far inside the inner border line. */
  borderInset: 10,
  /** Softness of the edge around the artwork and the border. */
  featherSigma: 6,
  /**
   * Softness of the edge around protected text. Much wider, because a glow that
   * stops sharply at a text box outlines the box. The fade happens entirely outside
   * the box: the box is grown by 2.5 sigma before blurring.
   */
  textFeatherSigma: 26
};


/** Anything that changes the prepared bases or masks when it changes. */
export const preparedFingerprint = (layout: Layout): string =>
  JSON.stringify({sharp: sharp.versions, matte: MATTE, layout});
