import { create } from 'zustand'

interface JobsStore {
  selectedJobId: string | null
  setSelectedJobId: (id: string | null) => void
  optimisticTriggers: Set<string>   // job IDs currently being triggered
  markTriggered: (id: string) => void
  clearTriggered: (id: string) => void
  // Job IDs the user clicked "Book Now" on. Tracked separately from
  // optimisticTriggers so the book button can distinguish "I clicked book,
  // now waiting for the hold worker" from "someone triggered a check" — both
  // land the job in CHECKING status, but only the former should show a
  // booking spinner on the Book button.
  pendingBookings: Set<string>
  markBooking: (id: string) => void
  clearBooking: (id: string) => void
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
  pendingBookings: new Set(),
  markBooking: (id) => set(s => ({
    pendingBookings: new Set(s.pendingBookings).add(id)
  })),
  clearBooking: (id) => set(s => {
    const next = new Set(s.pendingBookings)
    next.delete(id)
    return { pendingBookings: next }
  }),
}))