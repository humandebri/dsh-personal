/**
 * The Enter gesture of the side-chat composer.
 *
 * The main composer owns the reference rule (ui-conversation's editor keymap),
 * and this textarea keeps the same three decisions, so a question submitted in
 * the side panel behaves like one submitted in the main thread:
 *
 * - a composition-closing Enter belongs to the IME (candidate pick), never to
 *   the transport. `KeyboardEvent.isComposing` covers most engines, but Safari
 *   delivers the closing keydown AFTER `compositionend` — the desktop and iOS
 *   shells are WKWebView — so the watch holds the guard for a short window past
 *   the event, and keyCode 229 is the legacy signal engines emit without
 *   `isComposing`;
 * - on a touch-first device plain Enter is the only way to type a new line, so
 *   it stays with the text and the Send button submits;
 * - Shift+Enter is the native line break everywhere, and the accelerated chord
 *   (Cmd/Ctrl+Enter) is a deliberate submit even on a touch device.
 */

/** How long after `compositionend` a closing Enter still belongs to the IME. */
const COMPOSITION_GRACE_MS = 10

/**
 * Whether the plain-Enter gesture belongs to the text rather than to the
 * transport. Phones, tablets, and the iOS app's WKWebView all report a coarse
 * primary pointer, where the software keyboard's Return key is the only way to
 * start a new line. Evaluated per keystroke: the query is engine-cached and
 * survives an attached mouse flipping the primary pointer.
 * @returns true when plain Enter must fall through to the native line break.
 */
export function plainEnterBreaksLine(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}

/** Composition state one textarea composer carries between keystrokes. */
export interface ComposerCompositionWatch {
  /** Bind to the textarea's `compositionstart`. */
  readonly onCompositionStart: () => void
  /** Bind to the textarea's `compositionend`. */
  readonly onCompositionEnd: () => void
  /**
   * Whether this keydown closes an IME composition instead of submitting.
   * @param event - the native keydown.
   * @returns true when the gesture must be left to the IME.
   */
  readonly blocksEnter: (event: KeyboardEvent) => boolean
}

/**
 * Track IME composition across one composer's keystrokes.
 * @returns the watch to bind to the textarea and to consult on Enter.
 */
export function createComposerCompositionWatch(): ComposerCompositionWatch {
  let composing = false
  let composingUntil = 0
  return {
    onCompositionStart: () => { composing = true },
    onCompositionEnd: () => {
      composing = false
      composingUntil = Date.now() + COMPOSITION_GRACE_MS
    },
    blocksEnter: (event) => {
      // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
      // oxlint-disable-next-line typescript/no-deprecated
      if (event.isComposing || event.keyCode === 229) return true
      return composing || Date.now() < composingUntil
    },
  }
}
