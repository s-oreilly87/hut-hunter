import { JobList } from '@/components/jobs/JobList'
import { JobCard } from '@/components/jobs/JobCard'
import { CreateJobDialog } from '@/components/jobs/CreateJobDialog'
import { OccupantsDialog } from '@/components/occupants/OccupantsDialog'

export default function App() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Hut Hunter</h1>
          <p className="text-muted-foreground text-sm">DOC availability watcher</p>
        </div>
        <div className="flex items-center gap-2">
          <OccupantsDialog />
          <CreateJobDialog />
        </div>
      </header>
      <main className="px-6 py-6 space-y-6">
        <div className="border rounded-md max-h-[50vh] overflow-auto">
          <JobList />
        </div>
        <JobCard />
      </main>
    </div>
  )
}