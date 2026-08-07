import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function HoldToConfirmButton({
  children,
  onComplete,
  duration = 1100,
  disabled = false,
  className,
  holdingLabel = "Keep holding…",
  completeLabel = "Confirmed",
  ...props
}) {
  const timerRef = useRef(null);
  const resetTimerRef = useRef(null);
  const [holding, setHolding] = useState(false);
  const [completed, setCompleted] = useState(false);

  const cancel = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setHolding(false);
  }, []);

  const begin = useCallback(() => {
    if (disabled || holding || completed) return;
    setHolding(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      setCompleted(true);
      onComplete?.();
      resetTimerRef.current = window.setTimeout(() => setCompleted(false), 900);
    }, duration);
  }, [completed, disabled, duration, holding, onComplete]);

  useEffect(() => () => {
    window.clearTimeout(timerRef.current);
    window.clearTimeout(resetTimerRef.current);
  }, []);
  useEffect(() => {
    if (disabled) cancel();
  }, [cancel, disabled]);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    begin();
  };

  const onKeyDown = (event) => {
    if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
      event.preventDefault();
      begin();
    }
  };

  const onKeyUp = (event) => {
    if (event.key === "Enter" || event.key === " ") cancel();
  };

  return (
    <Button
      type="button"
      variant="destructive"
      disabled={disabled}
      className={cn("nx-hold-confirm min-w-36 select-none", className)}
      data-holding={holding ? "true" : "false"}
      data-completed={completed ? "true" : "false"}
      style={{ "--nx-hold-duration": `${duration}ms` }}
      onPointerDown={onPointerDown}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      {...props}
    >
      <span className="nx-hold-confirm__fill" aria-hidden="true" />
      <span className="relative z-[1] flex items-center justify-center gap-2">
        {completed ? <Check className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        {completed ? completeLabel : holding ? holdingLabel : children}
      </span>
    </Button>
  );
}
