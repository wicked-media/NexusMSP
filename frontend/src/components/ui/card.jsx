import * as React from "react"

import { cn } from "@/lib/utils"

const Card = React.forwardRef(({ className, interactive = false, onClick, signal, ...props }, ref) => {
  const isInteractive = Boolean(interactive || onClick)
  return (
    <div
      ref={ref}
      data-interactive={isInteractive ? "true" : undefined}
      data-nx-signal={signal || undefined}
      className={cn(
        "nx-card rounded-xl border bg-card text-card-foreground shadow",
        isInteractive && "nx-card-interactive",
        signal && "nx-ambient-surface",
        className,
      )}
      onClick={onClick}
      {...props} />
  )
})
Card.displayName = "Card"

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props} />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props} />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props} />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
