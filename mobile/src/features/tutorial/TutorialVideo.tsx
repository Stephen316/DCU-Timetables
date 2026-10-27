import { TutorialMedia } from '../../core/tutorial';

/** Only Safari's tour has a recording to play (see TutorialVideo.web.tsx). */
export function TutorialVideo(_: { media: TutorialMedia; maxWidth: number; maxHeight: number }) {
  return null;
}
