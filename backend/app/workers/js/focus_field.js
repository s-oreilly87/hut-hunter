/**
 * Move focus to the next or previous visible form control on the page.
 *
 * Scrolls the target into view, focuses it, and positions the text cursor at
 * the end for input/textarea elements.
 *
 * @param {1 | -1} direction  1 = next, -1 = previous
 * @returns {{ ok: boolean, action: string, tag?: string, id?: string|null, name?: string|null, type?: string }}
 */
(direction) => {
  const selector = [
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'button:not([disabled])',
    '[contenteditable="true"]',
  ].join(',');

  const visibleControls = Array.from(document.querySelectorAll(selector)).filter((el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      rect.width > 0 &&
      rect.height > 0
    );
  });

  if (!visibleControls.length) {
    return { ok: false, action: direction > 0 ? 'focus-next' : 'focus-prev', reason: 'no_focusable_controls' };
  }

  const active = document.activeElement;
  let currentIndex = visibleControls.findIndex((el) => el === active || el.contains(active));
  if (currentIndex === -1) currentIndex = direction > 0 ? -1 : 0;

  let nextIndex = currentIndex + direction;
  if (nextIndex < 0) nextIndex = visibleControls.length - 1;
  else if (nextIndex >= visibleControls.length) nextIndex = 0;

  const target = visibleControls[nextIndex];
  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });

  if (typeof target.focus === 'function') {
    target.focus({ preventScroll: true });
  }

  const tag = target.tagName.toLowerCase();
  const type = (target.getAttribute('type') || '').toLowerCase();

  if (tag === 'input' || tag === 'textarea') {
    if (typeof target.click === 'function') target.click();
    if (typeof target.setSelectionRange === 'function' && type !== 'checkbox' && type !== 'radio') {
      const end = target.value ? target.value.length : 0;
      target.setSelectionRange(end, end);
    }
  }

  return {
    ok: true,
    action: direction > 0 ? 'focus-next' : 'focus-prev',
    tag,
    id: target.id || null,
    name: target.getAttribute('name'),
    type,
  };
}
