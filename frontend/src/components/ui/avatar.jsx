import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"])
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || (
  typeof window !== "undefined" && LOCAL_HOSTS.has(window.location.hostname)
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : ""
)

function resolveAvatarSource(src) {
  if (typeof src !== "string" || !src.startsWith("/api/uploads/")) return src
  return BACKEND_URL ? `${BACKEND_URL}${src}` : src
}

const Avatar = React.forwardRef(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className)}
    {...props} />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef(({ className, src, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    src={resolveAvatarSource(src)}
    {...props} />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className
    )}
    {...props} />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback, resolveAvatarSource }
