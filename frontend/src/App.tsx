import { JobList } from '@/components/jobs/JobList'
import { JobCard } from '@/components/jobs/JobCard'
import { CreateJobDialog } from '@/components/jobs/CreateJobDialog'

export default function App() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Hut Hunter</h1>
          <p className="text-muted-foreground text-sm">DOC availability watcher</p>
        </div>
        <CreateJobDialog />
      </header>
      <main className="px-6 py-6 grid grid-cols-[1fr_360px] gap-6 items-start">
        <JobList />
        <JobCard />
      </main>
    </div>
  )
}