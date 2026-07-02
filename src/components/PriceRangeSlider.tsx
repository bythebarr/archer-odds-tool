"use client";

import * as Slider from "@radix-ui/react-slider";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";

interface PriceRangeSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
}

/** A dual-thumb slider operating in decimal-odds space, labeled in American odds. */
export function PriceRangeSlider({ min, max, value, onChange }: PriceRangeSliderProps) {
  return (
    <div className="w-full">
      <div className="mb-2 flex justify-between text-sm font-medium text-zinc-900 dark:text-zinc-50">
        <span>{formatAmerican(decimalToAmerican(value[0]))}</span>
        <span>{formatAmerican(decimalToAmerican(value[1]))}</span>
      </div>
      <Slider.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        min={min}
        max={max}
        step={(max - min) / 200 || 0.001}
        value={value}
        onValueChange={(v) => onChange([v[0], v[1]] as [number, number])}
        minStepsBetweenThumbs={1}
      >
        <Slider.Track className="relative h-1.5 grow rounded-full bg-zinc-200 dark:bg-zinc-800">
          <Slider.Range className="absolute h-full rounded-full bg-zinc-900 dark:bg-zinc-50" />
        </Slider.Track>
        <Slider.Thumb
          className="block h-4 w-4 rounded-full bg-zinc-900 shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:bg-zinc-50"
          aria-label="Minimum price"
        />
        <Slider.Thumb
          className="block h-4 w-4 rounded-full bg-zinc-900 shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:bg-zinc-50"
          aria-label="Maximum price"
        />
      </Slider.Root>
      <div className="mt-1 flex justify-between text-xs text-zinc-400">
        <span>{formatAmerican(decimalToAmerican(min))}</span>
        <span>{formatAmerican(decimalToAmerican(max))}</span>
      </div>
    </div>
  );
}
