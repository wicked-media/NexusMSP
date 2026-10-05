import SearchableSelect from "@/components/ui/searchable-select";
import { useDeviceOptions, useClientOptions } from "@/hooks/usePickerOptions";

/**
 * Drop-in searchable device picker (type to filter by hostname, IP or client).
 * Wrapped in a width box so it sizes like the compact fields it replaces.
 */
export default function DevicePicker({ value, onChange, placeholder = "Search devices…", testId, className = "w-56" }) {
  const items = useDeviceOptions();
  return (
    <div className={className} data-testid={testId ? `${testId}-wrap` : undefined}>
      <SearchableSelect
        items={items}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        searchPlaceholder="Search by hostname, IP or client…"
        emptyLabel="No devices found"
        testId={testId}
      />
    </div>
  );
}

/** Drop-in searchable client picker. */
export function ClientPicker({ value, onChange, placeholder = "Search clients…", testId, className = "w-56" }) {
  const items = useClientOptions();
  return (
    <div className={className} data-testid={testId ? `${testId}-wrap` : undefined}>
      <SearchableSelect
        items={items}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        searchPlaceholder="Search by name or domain…"
        emptyLabel="No clients found"
        testId={testId}
      />
    </div>
  );
}
