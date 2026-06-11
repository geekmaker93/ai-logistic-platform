"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CarrierTrackingHistoryPoint } from "@/lib/logistics-api";

type LiveTrackingMapProps = {
  currentLatitude: number | null;
  currentLongitude: number | null;
  history: CarrierTrackingHistoryPoint[];
  heightClassName?: string;
};

type LatLngPoint = [number, number];

function interpolate(from: LatLngPoint, to: LatLngPoint, progress: number): LatLngPoint {
  const clamped = Math.max(0, Math.min(1, progress));
  return [
    from[0] + ((to[0] - from[0]) * clamped),
    from[1] + ((to[1] - from[1]) * clamped),
  ];
}

export default function LiveTrackingMap(props: Readonly<LiveTrackingMapProps>) {
  const { currentLatitude, currentLongitude, history, heightClassName = "h-48" } = props;
  const [isMounted, setIsMounted] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      disposedRef.current = true;
      setIsMounted(false);
    };
  }, []);

  const orderedTrack = useMemo(() => {
    const ordered = [...history]
      .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
      .sort((a, b) => +new Date(a.tracked_at) - +new Date(b.tracked_at));

    const points: LatLngPoint[] = ordered.map((point) => [point.latitude, point.longitude]);
    if (currentLatitude !== null && currentLongitude !== null) {
      points.push([currentLatitude, currentLongitude]);
    }

    const deduped: LatLngPoint[] = [];
    for (const point of points) {
      const last = deduped.at(-1);
      if (last?.[0] !== point[0] || last?.[1] !== point[1]) {
        deduped.push(point);
      }
    }

    return deduped;
  }, [currentLatitude, currentLongitude, history]);

  const targetPosition = orderedTrack.at(-1) ?? null;
  
  useEffect(() => {
    if (!isMounted || !targetPosition || !containerRef.current || mapRef.current) {
      return;
    }

    let disposed = false;
    disposedRef.current = false;

    const init = async () => {
      const leafletModule = await import("leaflet");
      const L = (leafletModule as any).default ?? leafletModule;
      if (disposed || !containerRef.current) {
        return;
      }

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView(targetPosition, 12);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      const truckIcon = L.divIcon({
        className: "carrier-truck-marker",
        html: '<div class="carrier-truck-marker__inner" aria-hidden="true">🚚</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      const marker = L.marker(targetPosition, { icon: truckIcon }).addTo(map);
      const polyline = L.polyline(orderedTrack, {
        color: "#0f766e",
        weight: 4,
        opacity: 0.8,
      }).addTo(map);

      mapRef.current = map;
      markerRef.current = marker;
      polylineRef.current = polyline;
      setMapReady(true);

      if (orderedTrack.length > 1) {
        const bounds = L.latLngBounds(orderedTrack.map((point: LatLngPoint) => L.latLng(point[0], point[1])));
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14, animate: false });
      }

      setTimeout(() => {
        if (!disposed && mapRef.current) {
          mapRef.current.invalidateSize();
        }
      }, 0);
    };

    void init();

    return () => {
      disposed = true;
      disposedRef.current = true;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (mapRef.current) {
        markerRef.current?.remove?.();
        polylineRef.current?.remove?.();
        mapRef.current.off?.();
        mapRef.current.remove();
      }
      mapRef.current = null;
      markerRef.current = null;
      polylineRef.current = null;
      leafletRef.current = null;
      setMapReady(false);
    };
  }, [isMounted, orderedTrack, targetPosition]);

  useEffect(() => {
    if (!mapReady || !targetPosition || !mapRef.current || !markerRef.current || !polylineRef.current || !leafletRef.current) {
      return;
    }

    const map = mapRef.current;
    const marker = markerRef.current;
    const polyline = polylineRef.current;
    const L = leafletRef.current;

    polyline.setLatLngs(orderedTrack);

    if (orderedTrack.length > 1) {
      const bounds = L.latLngBounds(orderedTrack.map((point: LatLngPoint) => L.latLng(point[0], point[1])));
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14, animate: false });
    } else {
      map.setView(targetPosition, 12, { animate: false });
    }

    const currentLatLng = marker.getLatLng();
    const from: LatLngPoint = [currentLatLng.lat, currentLatLng.lng];
    const to: LatLngPoint = targetPosition;

    if (from[0] === to[0] && from[1] === to[1]) {
      return;
    }

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const durationMs = 1200;
    const start = performance.now();

    const tick = (now: number) => {
      if (
        disposedRef.current ||
        mapRef.current !== map ||
        markerRef.current !== marker ||
        !map.getContainer?.()?.isConnected ||
        !marker._map
      ) {
        animationFrameRef.current = null;
        return;
      }

      const progress = (now - start) / durationMs;
      const [lat, lng] = interpolate(from, to, progress);
      marker.setLatLng([lat, lng]);
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(tick);
      }
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [mapReady, orderedTrack, targetPosition]);

  if (!isMounted || !targetPosition) {
    const placeholderText = isMounted ? "Waiting for first GPS coordinate." : "Loading map...";
    return (
      <div className={`flex items-center justify-center text-xs text-slate-500 ${heightClassName}`}>
        {placeholderText}
      </div>
    );
  }

  return (
    <div className={heightClassName}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
