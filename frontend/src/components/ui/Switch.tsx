"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // Base layout
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 outline-none",
        // Expanded touch target
        "after:absolute after:-inset-x-3 after:-inset-y-2",
        // Focus ring
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2",
        // Sizes — default is iOS-standard proportions; sm for dense contexts
        "data-[size=default]:h-6 data-[size=default]:w-11",
        "data-[size=sm]:h-[18px] data-[size=sm]:w-8",
        // Track colours — unchecked gets a border so it reads clearly on light bg
        "data-checked:bg-primary",
        "data-unchecked:bg-input data-unchecked:ring-1 data-unchecked:ring-inset data-unchecked:ring-border/80",
        // Disabled
        "data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          // Thumb — white pill with shadow so it pops off both checked and unchecked tracks
          "pointer-events-none block rounded-full bg-white dark:bg-foreground shadow-sm ring-1 ring-black/10 dark:ring-white/10 transition-transform duration-200",
          // Default size + travel
          "group-data-[size=default]/switch:size-5",
          "group-data-[size=default]/switch:data-unchecked:translate-x-0.5",
          "group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)]",
          // sm size + travel
          "group-data-[size=sm]/switch:size-3.5",
          "group-data-[size=sm]/switch:data-unchecked:translate-x-0.5",
          "group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)]",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
