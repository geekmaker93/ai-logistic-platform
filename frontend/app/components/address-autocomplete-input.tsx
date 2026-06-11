"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AddressSuggestion, ResolvedAddress } from "@/lib/logistics-api";
import { autocompleteAddress, resolveAddressPlace } from "@/lib/logistics-api";

type AddressAutocompleteInputProps = Readonly<{
  value: string;
  placeId: string | null;
  placeholder: string;
  disabled?: boolean;
  inputClassName?: string;
  showStructuredBreakdown?: boolean;
  onValueChange: (value: string) => void;
  onPlaceIdChange: (placeId: string | null) => void;
}>;

export default function AddressAutocompleteInput(props: AddressAutocompleteInputProps) {
  const { value, placeId, placeholder, disabled, inputClassName, onValueChange, onPlaceIdChange } = props;
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [resolvedAddress, setResolvedAddress] = useState<ResolvedAddress | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const normalizedValue = useMemo(() => value.trim(), [value]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    globalThis.addEventListener("mousedown", onPointerDown);
    return () => globalThis.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    if (disabled || normalizedValue.length < 3) {
      return;
    }

    const timeout = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const results = await autocompleteAddress(normalizedValue, 6);
          setSuggestions(results);
          setOpen(results.length > 0);
          setErrorMessage("");
        } catch (error) {
          setSuggestions([]);
          setOpen(false);
          setErrorMessage(error instanceof Error ? error.message : "Google Maps suggestions are unavailable.");
        } finally {
          setLoading(false);
        }
      })();
    }, 220);

    return () => clearTimeout(timeout);
  }, [normalizedValue, disabled]);

  function chooseSuggestion(suggestion: AddressSuggestion) {
    void (async () => {
      try {
        const resolved = await resolveAddressPlace(suggestion.place_id);
        onValueChange(resolved.formatted_address);
        onPlaceIdChange(suggestion.place_id);
        setResolvedAddress(resolved);
        setErrorMessage("");
      } catch {
        onValueChange(suggestion.description);
        onPlaceIdChange(suggestion.place_id);
        setResolvedAddress(null);
      } finally {
        setSuggestions([]);
        setOpen(false);
        setActiveIndex(-1);
      }
    })();
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        value={value}
        onFocus={() => {
          if (suggestions.length > 0) {
            setOpen(true);
          }
        }}
        onChange={(event) => {
          onValueChange(event.target.value);
          onPlaceIdChange(null);
          setResolvedAddress(null);
          setActiveIndex(-1);
          setErrorMessage("");
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (!open || suggestions.length === 0) {
            return;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((prev) => (prev + 1) % suggestions.length);
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
          }

          if (event.key === "Enter" && activeIndex >= 0 && activeIndex < suggestions.length) {
            event.preventDefault();
            chooseSuggestion(suggestions[activeIndex]);
          }

          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClassName}
      />
      {placeId && (
        <p className="mt-1 text-[11px] text-emerald-700">Google Maps validated</p>
      )}
      {!placeId && normalizedValue.length > 0 && (
        <p className="mt-1 text-[11px] text-amber-600">Pick an address suggestion from Google Maps</p>
      )}
      {normalizedValue.length >= 3 && errorMessage && (
        <p className="mt-1 text-[11px] text-rose-600">{errorMessage}</p>
      )}

      {props.showStructuredBreakdown && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input
            value={resolvedAddress?.physical_address || ""}
            readOnly
            placeholder="Physical address"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700"
          />
          <input
            value={resolvedAddress?.city || ""}
            readOnly
            placeholder="City"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700"
          />
          <input
            value={resolvedAddress?.state || ""}
            readOnly
            placeholder="State"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700"
          />
          <input
            value={resolvedAddress?.postal_code || ""}
            readOnly
            placeholder="ZIP"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700"
          />
        </div>
      )}

      {open && !disabled && normalizedValue.length >= 3 && (
        <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {loading && <p className="px-3 py-2 text-xs text-slate-500">Searching...</p>}
          {!loading && errorMessage && <p className="px-3 py-2 text-xs text-rose-600">{errorMessage}</p>}
          {!loading && !errorMessage && suggestions.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">No address suggestions</p>}
          {!loading && suggestions.map((item, index) => (
            <button
              key={item.place_id}
              type="button"
              onClick={() => chooseSuggestion(item)}
              className={`block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 ${
                activeIndex === index ? "bg-slate-100" : "bg-white"
              }`}
            >
              {item.description}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
