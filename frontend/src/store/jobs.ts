import { create } from 'zustand'

interface JobsStore {
  selectedJobId: string | null
  setSelectedJobId: (id: string | null) => void
  optimisticTriggers: Set<string>   // job IDs currently being triggered
  markTriggered: (id: string) => void
  clearTriggered: (id: string) => void
}

export const useJobsStore = create<JobsStore>((set) => ({
  selectedJobId: null,
  setSelectedJobId: (id) => set({ selectedJobId: id }),
  optimisticTriggers: new Set(),
  markTriggered: (id) => set(s => ({
    optimisticTriggers: new Set(s.optimisticTriggers).add(id)
  })),
  clearTriggered: (id) => set(s => {
    const next = new Set(s.optimisticTriggers)
    next.delete(id)
    return { optimisticTriggers: next }
  }),
}))