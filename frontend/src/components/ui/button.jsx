import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-transparent text-sm font-semibold transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:-translate-y-px hover:bg-primary/90 hover:shadow-md hover:shadow-primary/25 active:translate-y-0",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm shadow-destructive/20 hover:-translate-y-px hover:bg-destructive/90 hover:shadow-md active:translate-y-0",
        success:
          "bg-emerald-500 text-emerald-950 shadow-sm shadow-emerald-500/20 hover:-translate-y-px hover:bg-emerald-400 hover:shadow-md hover:shadow-emerald-500/25 active:translate-y-0",
        info:
          "border-cyan-400/25 bg-cyan-500/[0.08] text-cyan-100 shadow-sm shadow-cyan-500/10 hover:-translate-y-px hover:border-cyan-300/40 hover:bg-cyan-500/[0.16] hover:shadow-md active:translate-y-0",
        warning:
          "border-amber-400/30 bg-amber-500/[0.08] text-amber-100 shadow-sm shadow-amber-500/10 hover:-translate-y-px hover:border-amber-300/45 hover:bg-amber-500/[0.16] hover:shadow-md active:translate-y-0",
        outline:
          "border-border/70 bg-background/70 text-foreground shadow-sm hover:-translate-y-px hover:border-primary/35 hover:bg-accent hover:text-accent-foreground hover:shadow-md active:translate-y-0",
        secondary:
          "border-border/50 bg-secondary text-secondary-foreground shadow-sm hover:-translate-y-px hover:border-primary/25 hover:bg-secondary/80 hover:shadow-md active:translate-y-0",
        ghost: "border-transparent bg-transparent shadow-none hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-5 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, onPointerDown, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  const handlePointerDown = (event) => {
    if (!props.disabled && (event.button === undefined || event.button === 0)) {
      const element = event.currentTarget
      const bounds = element.getBoundingClientRect()
      element.style.setProperty("--nx-press-x", `${event.clientX - bounds.left}px`)
      element.style.setProperty("--nx-press-y", `${event.clientY - bounds.top}px`)
      element.dataset.nxPressed = "true"
      window.clearTimeout(element.__nxPressTimer)
      element.__nxPressTimer = window.setTimeout(() => {
        delete element.dataset.nxPressed
      }, 520)
    }
    onPointerDown?.(event)
  }
  return (
    <Comp
      className={cn("nx-button", buttonVariants({ variant, size, className }))}
      ref={ref}
      onPointerDown={handlePointerDown}
      {...props} />
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
