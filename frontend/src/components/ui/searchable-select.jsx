import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A searchable single-select (combobox). Type to filter `items`, pick one, done.
 *
 * `items` is `[{ id, label, description?, keywords? }]`. Selection is reported via
 * `onChange(id)`. When `value` is set but no item matches (e.g. a typed device id
 * with no loaded record), the raw value is shown so the field never looks empty.
 */
export default function SearchableSelect({
  items = [],
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyLabel = "No matches",
  allowNone = false,
  noneLabel = "None",
  className = "",
  testId,
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => String(item.id) === String(value));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`h-10 w-full justify-between bg-background/65 px-3 font-normal ${className}`}
          data-testid={testId}
        >
          <span className={`truncate ${selected || value ? "text-foreground" : "text-muted-foreground"}`}>
            {selected?.label || (value ? String(value) : allowNone && !value ? noneLabel : placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-45" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder || placeholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {allowNone && (
                <CommandItem value={`none ${noneLabel}`} onSelect={() => { onChange?.(""); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${!value ? "opacity-100" : "opacity-0"}`} />
                  <span>{noneLabel}</span>
                </CommandItem>
              )}
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.description || ""} ${item.keywords || ""}`}
                  onSelect={() => { onChange?.(item.id); setOpen(false); }}
                >
                  <Check className={`mr-2 h-4 w-4 ${String(item.id) === String(value) ? "opacity-100" : "opacity-0"}`} />
                  <span className="min-w-0">
                    <span className="block truncate">{item.label}</span>
                    {item.description && <span className="block truncate text-[10px] text-muted-foreground">{item.description}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
