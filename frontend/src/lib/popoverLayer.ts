import type { TouchEvent, WheelEvent } from 'react'

/** Marks portaled popovers that must stay interactive inside modal dialogs. */
export const POPOVER_LAYER_ATTR = 'data-popover-layer'
export const POPOVER_LAYER_SELECTOR = `[${POPOVER_LAYER_ATTR}]`

/** z-index above Dialog overlay/content (z-50). */
export const POPOVER_LAYER_Z_INDEX = 100

/**
 * Modal dialogs use react-remove-scroll, which cancels wheel/touch events that
 * bubble to document unless the target is inside a registered scroll shard.
 * Portaled popovers sit outside the dialog content shard, so stop propagation
 * here to keep overflow scrolling working on the popover itself.
 */
export const popoverLayerEventHandlers = {
  onWheel: (event: WheelEvent) => {
    event.stopPropagation()
  },
  onTouchMove: (event: TouchEvent) => {
    event.stopPropagation()
  },
}

export function isPopoverLayerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(POPOVER_LAYER_SELECTOR)
    || target.closest('[data-slot="select-content"]'),
  )
}
