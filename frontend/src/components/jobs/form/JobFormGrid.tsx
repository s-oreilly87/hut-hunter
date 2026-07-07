import { Pencil, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { AutomationFields } from './AutomationFields'
import { BookingInputsFields } from './BookingInputsFields'
import { FormSection } from './FormSection'
import { HuntSetupFields } from './HuntSetupFields'
import type { JobFormController } from './useJobForm'

/**
 * Dialog-presentation form: every section visible in a two-column grid,
 * with the submit button living in its own bottom-right card. Used by the
 * desktop modal entrypoints where the dialog is wide enough for both
 * columns.
 */
export function JobFormGrid({
  form,
  onOpenOccupants,
  onOpenCredentials,
}: {
  form: JobFormController
  onOpenOccupants?: () => void
  onOpenCredentials?: () => void
}) {
  const {
    mode,
    name,
    setName,
    selectedAdapter,
    selectedAdapterId,
    adapters,
    handleAdapterChange,
    hasCredentialsForSelectedAdapter,
    credentialVerifiedForSelectedAdapter,
    params,
    roster,
    occupantsLoading,
    selectedOccupantIds,
    setSelectedOccupantIds,
    selectedRosterOccupants,
    permitHolderOccupantId,
    setPermitHolderOccupantId,
    effectivePeopleCount,
    selectedOccupantCount,
    selectedOccupantsPresent,
    selectedOccupantDetailsComplete,
    resolveOptions,
    handleParamChange,
    effectiveAutoBook,
    setAutoBook,
    enableMonitoring,
    setEnableMonitoring,
    intervalMinutes,
    setIntervalMinutes,
    error,
    windowCheck,
    windowAcknowledged,
    acknowledgeWindow,
    pending,
    submitLabel,
    submitBusyLabel,
    handleSubmit,
  } = form

  const title = mode === 'create' ? 'Create Hunt' : 'Edit Hunt'

  return (
    <>
      {/* Fixed header — stays visible while body scrolls */}
      <div className="shrink-0 px-6 pt-6 pb-2">
        <DialogHeader>
          <DialogTitle className="pl-2 text-2xl tracking-tight sm:pl-3">
            {title}
          </DialogTitle>
        </DialogHeader>
      </div>

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
      <div className="grid gap-4 py-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
        <div className="space-y-4">
          <FormSection>
            <HuntSetupFields
              mode={mode}
              name={name}
              setName={setName}
              adapters={adapters}
              selectedAdapterId={selectedAdapterId}
              onAdapterChange={handleAdapterChange}
              selectedAdapter={selectedAdapter}
              hasCredentialsForSelectedAdapter={hasCredentialsForSelectedAdapter}
            />
          </FormSection>

          {selectedAdapter && (
            <FormSection title={selectedAdapter.name ?? 'not loaded'}>
              <BookingInputsFields
                selectedAdapter={selectedAdapter}
                params={params}
                roster={roster}
                occupantsLoading={occupantsLoading}
                selectedOccupantIds={selectedOccupantIds}
                setSelectedOccupantIds={setSelectedOccupantIds}
                selectedRosterOccupants={selectedRosterOccupants}
                permitHolderOccupantId={permitHolderOccupantId}
                setPermitHolderOccupantId={setPermitHolderOccupantId}
                effectivePeopleCount={effectivePeopleCount}
                selectedOccupantCount={selectedOccupantCount}
                selectedOccupantsPresent={selectedOccupantsPresent}
                resolveOptions={resolveOptions}
                handleParamChange={handleParamChange}
                onOpenOccupants={onOpenOccupants}
                windowCheck={windowCheck}
                windowAcknowledged={windowAcknowledged}
                acknowledgeWindow={acknowledgeWindow}
              />
            </FormSection>
          )}
        </div>

        <div className="space-y-4">
          <FormSection>
            <AutomationFields
              selectedAdapter={selectedAdapter}
              autoBook={effectiveAutoBook}
              setAutoBook={setAutoBook}
              enableMonitoring={enableMonitoring}
              setEnableMonitoring={setEnableMonitoring}
              intervalMinutes={intervalMinutes}
              setIntervalMinutes={setIntervalMinutes}
              selectedOccupantsPresent={selectedOccupantsPresent}
              hasCredentialsForSelectedAdapter={hasCredentialsForSelectedAdapter}
              credentialVerifiedForSelectedAdapter={credentialVerifiedForSelectedAdapter}
              selectedOccupantDetailsComplete={selectedOccupantDetailsComplete}
              onOpenCredentials={onOpenCredentials}
            />
          </FormSection>

          <FormSection>
            {error && (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={
                !name || !selectedAdapterId || pending
                // THR-124: block save until the booking-window notice (if any) is acknowledged.
                || Boolean(windowCheck && !windowCheck.is_open && !windowAcknowledged)
              }
            >
              {mode === 'edit' ? <Pencil className="size-4" /> : <Settings2 className="size-4" />}
              {pending ? submitBusyLabel : submitLabel}
            </Button>
          </FormSection>
        </div>
      </div>
      </div> {/* end scrollable body */}
    </>
  )
}
