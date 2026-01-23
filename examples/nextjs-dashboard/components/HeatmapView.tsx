"use client";

import { useEffect, useRef } from "react";
import h337 from "heatmap.js";

export type HeatmapPoint = { x: number; y: number; value: number };

type Props = {
  points: HeatmapPoint[];
  max: number;
};

export default function HeatmapView({ points, max }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<ReturnType<typeof h337.create> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!heatmapRef.current) {
      heatmapRef.current = h337.create({
        container: containerRef.current,
        radius: 40,
        maxOpacity: 0.7,
        minOpacity: 0.1,
        blur: 0.9
      });
    }
    heatmapRef.current.setData({ min: 0, max: max || 1, data: points });
  }, [points, max]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
