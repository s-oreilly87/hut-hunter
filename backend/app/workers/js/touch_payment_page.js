/**
 * Lightweight keepalive heartbeat for the DOC payment page.
 *
 * Combines a same-origin fetch with DOM activity events to prevent inactivity
 * timeouts without doing anything disruptive like reloads or key presses.
 */
async () => {
  const dispatch = (target, type) => {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 18,
      clientY: 18,
    }));
  };

  try {
    await fetch(window.location.href, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
  } catch (_) {
    // Network heartbeat is best-effort only.
  }

  if (document.body) {
    dispatch(document.body, 'mousemove');
    dispatch(document.body, 'mousedown');
    dispatch(document.body, 'mouseup');
  }
  dispatch(document, 'mousemove');
  window.dispatchEvent(new Event('focus'));
}
