import { useCallback, useEffect, useRef } from 'react'

type RowNode = HTMLDivElement | HTMLTableRowElement

/**
 * Bookkeeps a registry of DOM nodes keyed by job id and scrolls the
 * currently-selected job into view exactly once per selection change.
 *
 * Returns:
 *   - `setJobRef(jobId, node)` — call from each row's `ref` to register/
 *     unregister the row's DOM node.
 *   - `markJobSelected()` — call when selection changes from a click so the
 *     auto-scroll fires the next time the selected node mounts.
 *
 * `deps` is a list of values whose changes should re-attempt the scroll
 * (e.g. expanded-group state, the grouped jobs list itself), since a row may
 * not be mounted yet on the first render after a selection change.
 */
export function useScrollSelectedIntoView(
  selectedJobId: string | null,
  deps: readonly unknown[] = [],
) {
  const jobRefs = useRef(new Map<string, RowNode>())
  const hasAutoScrolledRef = useRef(false)

  const setJobRef = useCallback((jobId: string, node: RowNode | null) => {
    if (node) {
      jobRefs.current.set(jobId, node)
    } else {
      jobRefs.current.delete(jobId)
    }
  }, [])

  const markJobSelected = useCallback(() => {
    hasAutoScrolledRef.current = false
  }, [])

  useEffect(() => {
    if (!selectedJobId) {
      hasAutoScrolledRef.current = false
      return
    }

    const selectedNode = jobRefs.current.get(selectedJobId)
    if (!selectedNode || hasAutoScrolledRef.current) return

    hasAutoScrolledRef.current = true
    const timeoutId = window.setTimeout(() => {
      selectedNode.scrollIntoView({
        block: 'start',
        behavior: 'auto',
      })
    }, 40)

    return () => window.clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId, ...deps])

  return { setJobRef, markJobSelected }
}
