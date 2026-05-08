import { useEffect, useRef } from 'react'

/**
 * Tracks an element's height and writes it to a CSS custom property on
 * <html>. Updates on resize so other elements can consume it via var().
 */
export function useElementHeightCssVar<T extends HTMLElement>(cssVarName: string) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const root = document.documentElement
    const update = () => {
      root.style.setProperty(cssVarName, `${node.getBoundingClientRect().height}px`)
    }

    update()

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(node)
    window.addEventListener('resize', update)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', update)
      root.style.removeProperty(cssVarName)
    }
  }, [cssVarName])

  return ref
}
