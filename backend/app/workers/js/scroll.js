/**
 * Scroll the page up, down, or back to the top.
 *
 * @param {'scroll-up' | 'scroll-down' | 'scroll-top'} action
 * @returns {{ ok: boolean, action: string, scrollTop: number }}
 */
(action) => {
  const root = document.scrollingElement || document.documentElement || document.body;

  if (action === 'scroll-top') {
    root.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    return { ok: true, action: 'scroll-top', scrollTop: root.scrollTop };
  }

  const step = Math.max(Math.round(window.innerHeight * 0.72), 240);
  const delta = action === 'scroll-down' ? step : -step;
  root.scrollBy({ top: delta, left: 0, behavior: 'auto' });
  return { ok: true, action, scrollTop: root.scrollTop };
}
