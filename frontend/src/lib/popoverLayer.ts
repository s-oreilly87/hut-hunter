/** Marks portaled popovers that must stay interactive inside modal dialogs. */
export const POPOVER_LAYER_ATTR = 'data-popover-layer'
export const POPOVER_LAYER_SELECTOR = `[${POPOVER_LAYER_ATTR}]`

/** z-index above Dialog overlay/content (z-50). */
export const POPOVER_LAYER_Z_INDEX = 100

export function isPopoverLayerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(POPOVER_LAYER_SELECTOR)
    || target.closest('[data-slot="select-content"]'),
  )
}
