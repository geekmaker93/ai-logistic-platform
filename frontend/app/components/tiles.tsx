"use client";

import { useEffect, useRef } from "react";

type TilesProps = Readonly<{
  rows?: number;
  cols?: number;
  tileSize?: "sm" | "md" | "lg";
}>;

export function Tiles({ rows = 50, cols = 8, tileSize = "md" }: TilesProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const tileCount = rows * cols;

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const bounds = layer.getBoundingClientRect();
      layer.style.setProperty("--tiles-pointer-x", `${event.clientX - bounds.left}px`);
      layer.style.setProperty("--tiles-pointer-y", `${event.clientY - bounds.top}px`);
    };

    layer.addEventListener("pointermove", onPointerMove);
    return () => layer.removeEventListener("pointermove", onPointerMove);
  }, []);

  return (
    <div
      ref={layerRef}
      className={`about-tiles about-tiles-${tileSize}`}
      style={{ "--tiles-columns": cols } as React.CSSProperties}
      aria-hidden="true"
    >
      {Array.from({ length: tileCount }, (_, index) => <span key={index} className="about-tile" />)}
    </div>
  );
}
