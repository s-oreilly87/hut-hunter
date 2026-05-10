/**
 * Type a string of characters into the currently focused DOM element.
 *
 * More reliable than Playwright's keyboard.type() because it dispatches events
 * directly on the JS-focused element and doesn't require the OS window to hold
 * CDP-level focus.
 *
 * @param {string} text
 */
(text) => {
  const el = document.activeElement;
  if (!el) return;

  const tag = el.tagName.toLowerCase();

  for (const ch of text) {
    el.dispatchEvent(new KeyboardEvent('keydown',  { key: ch, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true, cancelable: true }));

    if (tag === 'input' || tag === 'textarea') {
      const start = el.selectionStart ?? el.value.length;
      const end   = el.selectionEnd   ?? el.value.length;
      el.value = el.value.slice(0, start) + ch + el.value.slice(end);
      el.selectionStart = el.selectionEnd = start + ch.length;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
    }

    el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true }));
  }
}
