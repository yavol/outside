"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Camera, Compass, LocateFixed, Minus, Plus } from "lucide-react";
import { destinations, type Destination } from "@/lib/destinations";
import "maplibre-gl/dist/maplibre-gl.css";

type CoastalMapProps = {
  selectedId: string;
  onSelect: (id: string) => void;
  cameraImages?: Record<string, string>;
  resetKey?: number;
  showCameras?: boolean;
};

const INK = "#194538";
const ORANGE = "#e77646";
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const CARD_OFFSETS: Record<string, { x: number; y: number }> = {
  cowells: { x: -80, y: -117 },
  "main-beach": { x: 92, y: -15 },
  sunset: { x: 0, y: -117 },
};

function frameCoast(map: MapLibreMap, animate = true) {
  const width = map.getContainer().clientWidth;
  map.fitBounds(
    [[-122.068, 36.864], [-121.805, 37.019]],
    {
      padding: { top: 100, bottom: 95, left: width > 900 ? 100 : 95, right: width > 900 ? 270 : 85 },
      duration: animate ? 1100 : 0,
      maxZoom: 11.85,
      bearing: 0,
      pitch: 0,
    },
  );
}

function BeachPin({ place, selected, imageUrl, showCamera, onSelect }: {
  place: Destination;
  selected: boolean;
  imageUrl?: string;
  showCamera: boolean;
  onSelect: () => void;
}) {
  const offset = CARD_OFFSETS[place.id];
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [imageUrl]);

  return (
    <div style={{ position: "relative", width: 28, height: 28, color: INK, fontFamily: "inherit" }}>
      {showCamera && (
        <button
          type="button"
          onClick={onSelect}
          aria-label={`Explore ${place.name} and its camera snapshot`}
          aria-pressed={selected}
          style={{
            position: "absolute", left: offset.x + 14, top: offset.y + 14,
            transform: "translateX(-50%)", width: 145, padding: 4, textAlign: "left",
            border: selected ? `2px solid ${ORANGE}` : "1px solid rgba(25,69,56,.12)",
            borderRadius: 12, background: "#fffdf8", color: INK, cursor: "pointer",
            boxShadow: selected ? "0 8px 28px #163f3426" : "0 5px 16px #163f341a",
            transition: "border-color .2s, box-shadow .2s", zIndex: selected ? 5 : 3,
          }}
        >
          <div style={{ position: "relative", height: 67, borderRadius: 8, overflow: "hidden", background: "#dce8e0" }}>
            {!imageFailed && imageUrl ? (
              // Snapshot URLs are supplied by the official USGS CoastCam source.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt={`${place.name} coastal camera snapshot`} onError={() => setImageFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 10, color: "#527668" }}><Camera size={15} /> Snapshot unavailable</div>
            )}
            <span style={{ position: "absolute", top: 5, left: 5, display: "flex", alignItems: "center", gap: 4, padding: "3px 5px", borderRadius: 4, fontSize: 8, fontWeight: 700, letterSpacing: ".08em", color: "white", background: "#143e35b8", backdropFilter: "blur(4px)" }}><Camera size={9} /> COAST CAM</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 5px 4px", fontSize: 10.5, fontWeight: 700 }}>
            <span>{place.shortName}</span><span style={{ color: selected ? ORANGE : "#7f9b88", fontSize: 13 }}>↗</span>
          </div>
        </button>
      )}
      {showCamera && (
        <svg aria-hidden="true" width="220" height="170" viewBox="0 0 220 170" style={{ position: "absolute", left: -96, top: -126, pointerEvents: "none", overflow: "visible", zIndex: 1 }}>
          <path d={`M 110 140 L ${110 + offset.x} ${140 + offset.y + 105}`} fill="none" stroke={selected ? ORANGE : "#638a75"} strokeWidth="1.3" strokeDasharray="3 3" />
        </svg>
      )}
      <button type="button" onClick={onSelect} aria-label={`Select ${place.name}`} aria-pressed={selected} style={{ position: "absolute", inset: 0, border: "3px solid #fffdf8", borderRadius: "50%", background: selected ? ORANGE : INK, color: "white", display: "grid", placeItems: "center", cursor: "pointer", boxShadow: selected ? "0 0 0 7px #e7764628, 0 3px 10px #19453830" : "0 3px 10px #19453830", zIndex: 4, transition: "all .25s" }}>
        <span style={{ width: 5, height: 5, background: "currentColor", borderRadius: "50%" }} />
      </button>
      {!showCamera && <span style={{ position: "absolute", top: place.id === "cowells" ? -26 : 33, left: 14, transform: "translateX(-50%)", whiteSpace: "nowrap", fontSize: 10, fontWeight: 700, padding: "4px 7px", borderRadius: 5, color: selected ? ORANGE : INK, background: "#fffdf8f5", boxShadow: "0 2px 8px #19453812", pointerEvents: "none" }}>{place.shortName}</span>}
    </div>
  );
}

function MapPreview({ selectedId, onSelect }: Pick<CoastalMapProps, "selectedId" | "onSelect">) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#d5e7e9", overflow: "hidden" }}>
      <svg aria-hidden="true" viewBox="0 0 1000 850" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
        <defs><pattern id="outside-topo" width="150" height="120" patternUnits="userSpaceOnUse"><path d="M-30 90Q60-10 170 50 M-30 105Q60 5 170 65 M-30 120Q60 20 170 80" fill="none" stroke="#a8b69a" strokeWidth="1" opacity=".22" /></pattern></defs>
        <path d="M0 0H1000V850H870Q805 695 722 620Q675 578 653 507Q626 430 550 398Q505 371 487 320Q463 291 408 300Q345 285 288 254Q225 223 186 163L125 0Z" fill="#ececdf" />
        <path d="M0 0H1000V850H870Q805 695 722 620Q675 578 653 507Q626 430 550 398Q505 371 487 320Q463 291 408 300Q345 285 288 254Q225 223 186 163L125 0Z" fill="url(#outside-topo)" />
        <path d="M323 120Q460 190 525 270T710 430T860 650" fill="none" stroke="#fffdf2" strokeWidth="9" /><path d="M323 120Q460 190 525 270T710 430T860 650" fill="none" stroke="#ded6ae" strokeWidth="2" />
        <path d="M414 306Q545 345 638 467T730 628" fill="none" stroke="#467a67" strokeWidth="2" strokeDasharray="5 8" opacity=".6" />
        <text x="400" y="251" fill="#536d5b" fontSize="18" fontFamily="sans-serif">SANTA CRUZ</text><text x="725" y="530" fill="#536d5b" fontSize="15" fontFamily="sans-serif">WATSONVILLE</text>
        <text x="255" y="565" fill="#6b9b9c" fontSize="16" letterSpacing="7" transform="rotate(14 255 565)" fontFamily="sans-serif">MONTEREY BAY</text>
      </svg>
      {destinations.map((place, i) => (
        <button type="button" key={place.id} onClick={() => onSelect(place.id)} style={{ position: "absolute", left: `${[41, 49, 72][i]}%`, top: `${[36, 39, 73][i]}%`, border: "3px solid #fffdf8", borderRadius: 20, padding: "8px 12px", background: selectedId === place.id ? ORANGE : INK, color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 15px #19453825" }}>{place.shortName}</button>
      ))}
      <span style={{ position: "absolute", bottom: 34, left: 20, fontSize: 10, color: "#426b62", padding: "5px 8px", background: "#fffdf8d9", borderRadius: 4 }}>Map preview · interactive map unavailable</span>
    </div>
  );
}

export default function CoastalMap({ selectedId, onSelect, cameraImages, resetKey = 0, showCameras = true }: CoastalMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const lastSelectionRef = useRef(selectedId);
  const [markerHosts, setMarkerHosts] = useState<{ place: Destination; element: HTMLDivElement }[]>([]);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [compactMap, setCompactMap] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    const markers: maplibregl.Marker[] = [];
    let labelMarker: maplibregl.Marker | undefined;
    let map: MapLibreMap;
    try {
      // MapLibre 6 ships its worker as a separate ES module. Serving that exact
      // package file from public avoids a rewritten import.meta.url in Turbopack.
      maplibregl.setWorkerUrl(`/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [-121.936, 36.944], zoom: 11.3, minZoom: 8, maxZoom: 18,
        attributionControl: { compact: true },
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
      frameCoast(map, false);
      map.on("style.load", () => {
        if (disposed) return;
        const palette: Record<string, ["background-color" | "fill-color", string]> = {
          background: ["background-color", "#f1f0e5"],
          water: ["fill-color", "#d5e5e7"],
          park: ["fill-color", "#dce5cf"],
          landuse_residential: ["fill-color", "#eeede1"],
          landcover_wood: ["fill-color", "#c4d3b6"],
          landcover_grass: ["fill-color", "#dce3cd"],
          landcover_sand: ["fill-color", "#f2e8cc"],
          building: ["fill-color", "#e1dfd3"],
        };
        for (const [layer, [property, value]] of Object.entries(palette)) {
          if (map.getLayer(layer)) map.setPaintProperty(layer, property, value);
        }
      });
      map.on("load", () => {
        if (disposed) return;
        setMapReady(true);
        map.addSource("coastal-guide", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[-122.0254, 36.9628], [-122.0197, 36.9634], [-121.998, 36.9505], [-121.969, 36.934], [-121.936, 36.914], [-121.90, 36.899], [-121.864, 36.888], [-121.8375, 36.897]] } } });
        map.addLayer({ id: "coastal-guide", type: "line", source: "coastal-guide", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#4f7b69", "line-width": 1.8, "line-dasharray": [1, 3], "line-opacity": 0.65 } });
        const guideLabel = document.createElement("div");
        guideLabel.textContent = "COASTAL DAY TRIP";
        Object.assign(guideLabel.style, { color: "#5d8775", fontSize: "8px", fontWeight: "700", letterSpacing: ".2em", transform: "rotate(22deg)", whiteSpace: "nowrap", pointerEvents: "none" });
        labelMarker = new maplibregl.Marker({ element: guideLabel, anchor: "center", rotation: 22 }).setLngLat([-121.944, 36.929]).addTo(map);
      });
      map.on("error", (event) => {
        // A missing individual tile is recoverable; a lost WebGL context is not.
        if (!disposed && /WebGL|context lost/i.test(event.error?.message ?? "")) setMapFailed(true);
      });
      const hosts = destinations.map((place) => {
        const element = document.createElement("div");
        element.style.width = "28px";
        element.style.height = "28px";
        element.style.fontFamily = "inherit";
        const marker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat(place.coordinates).addTo(map);
        markers.push(marker);
        return { place, element };
      });
      setMarkerHosts(hosts);
      resizeObserver = new ResizeObserver(() => {
        map.resize();
        const compact = map.getContainer().clientWidth < 600;
        setCompactMap(compact);
        markers.forEach((marker, index) => marker.setOffset(compact ? (index === 0 ? [-14, -7] : index === 1 ? [14, 7] : [0, 0]) : [0, 0]));
      });
      resizeObserver.observe(containerRef.current);
    } catch {
      setMapFailed(true);
    }
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      markers.forEach((marker) => marker.remove());
      labelMarker?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    markerHosts.forEach(({ place, element }) => { element.style.zIndex = place.id === selectedId ? "8" : "5"; });
    const map = mapRef.current;
    if (map && lastSelectionRef.current !== selectedId) {
      const place = destinations.find((item) => item.id === selectedId);
      if (place) {
        const width = map.getContainer().clientWidth;
        map.easeTo({ center: place.coordinates, zoom: Math.max(map.getZoom(), 11.6), duration: 900, padding: { top: 135, bottom: 160, left: 110, right: width > 900 ? 330 : 110 } });
      }
    }
    lastSelectionRef.current = selectedId;
  }, [markerHosts, selectedId]);

  useEffect(() => {
    if (mapRef.current && resetKey > 0) frameCoast(mapRef.current);
  }, [resetKey]);

  const controlStyle = { width: 36, height: 36, display: "grid", placeItems: "center", border: 0, background: "#fffdf8", color: INK, cursor: "pointer" } as const;

  return (
    <div className="coastal-map" style={{ position: "absolute", inset: 0, background: "#d8e7e5", overflow: "hidden" }}>
      <div ref={containerRef} aria-label="Interactive map of Santa Cruz and Monterey Bay beaches" style={{ position: "absolute", inset: 0, opacity: mapFailed ? 0 : 1 }} />
      {mapFailed && <MapPreview selectedId={selectedId} onSelect={onSelect} />}
      {!mapFailed && markerHosts.map(({ place, element }) => createPortal(<BeachPin place={place} selected={place.id === selectedId} imageUrl={cameraImages?.[place.id] ?? place.camera.imageUrl} showCamera={showCameras && !compactMap} onSelect={() => onSelect(place.id)} />, element, place.id))}
      {!mapFailed && mapReady && <>
        <div aria-label="Map controls" style={{ position: "absolute", right: 23, bottom: 108, border: "1px solid #19453814", borderRadius: 10, overflow: "hidden", boxShadow: "0 4px 18px #19453810", zIndex: 10 }}>
          <button type="button" title="Zoom in" aria-label="Zoom in" style={controlStyle} onClick={() => mapRef.current?.zoomIn({ duration: 350 })}><Plus size={17} strokeWidth={1.7} /></button>
          <div style={{ height: 1, margin: "0 8px", background: "#19453815" }} />
          <button type="button" title="Zoom out" aria-label="Zoom out" style={controlStyle} onClick={() => mapRef.current?.zoomOut({ duration: 350 })}><Minus size={17} strokeWidth={1.7} /></button>
          <div style={{ height: 1, margin: "0 8px", background: "#19453815" }} />
          <button type="button" title="Reset north" aria-label="Reset map to north" style={controlStyle} onClick={() => mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 500 })}><Compass size={17} strokeWidth={1.5} /></button>
        </div>
        <button type="button" title="Show all beaches" aria-label="Recenter map to show all beaches" style={{ ...controlStyle, position: "absolute", right: 23, bottom: 62, borderRadius: 10, boxShadow: "0 4px 18px #19453810", border: "1px solid #19453814", zIndex: 10 }} onClick={() => mapRef.current && frameCoast(mapRef.current)}><LocateFixed size={17} strokeWidth={1.6} /></button>
        <span style={{ position: "absolute", left: 18, bottom: 8, fontSize: 8, letterSpacing: ".035em", color: "#587c71", pointerEvents: "none", background: "#fffdf8b0", padding: "3px 6px", borderRadius: 3 }}>Coastal guide · line is not a road route</span>
      </>}
    </div>
  );
}
