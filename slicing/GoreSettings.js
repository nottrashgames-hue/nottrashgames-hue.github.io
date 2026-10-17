import { settings } from '../settings.js';

/*
  Gore intensity for the slicing system, in one place (the stand-in for a ScriptableObject: one
  shared, editable asset of tunables). The player-facing switches in the Esc / VR settings menu
  (settings.js: blood, dismember, ...) still win: these scale what's left on.
*/
export const GORE = {
  dismemberment: true,   // off: the blade never cuts anything apart (blunt hits only)
  bloodAmount: 1,        // 0..2: particles per cut, spray strength, drip rate
  decalLifetime: 90,     // s blood decals made by cuts stay before they fade (0 = forever)
  dripTime: 6,           // s an open cut surface keeps dripping
  bladeBlood: 1,         // 0..2: how much each cut leaves on the blade
  maxPieces: 24,         // loose sliced pieces at once; the oldest fade out past this
  fadeTime: 1.2,         // s a piece takes to fade out
  pieceLifetime: 120,    // s before a resting piece fades anyway
  sliceBudgetMs: 4,      // ms of mesh slicing allowed per frame (the rest waits a frame)
  debug: false,          // gizmos + the piece count / slice time readout (Debug.js)
};
export const dismemberOn = () => GORE.dismemberment && settings.dismember !== false;
export const bloodOn = () => settings.blood !== false;
