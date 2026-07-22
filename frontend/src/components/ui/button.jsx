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

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
