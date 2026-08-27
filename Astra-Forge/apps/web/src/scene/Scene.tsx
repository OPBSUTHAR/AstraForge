import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Stars, Html, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { MeshAsset } from "./MeshAsset";
import type { ModelAsset } from "@astraforge/shared";

interface SceneProps {
  exploded?: boolean;
  color: string;
  activeAsset: ModelAsset | null;
  onTransform?: (payload: { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] }) => void;
}

function LoaderFallback() {
  return (
    <Html center>
      <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--hologram-dim)", background: "rgba(4,7,15,0.6)", padding: "4px 8px", borderRadius: 4 }}>loading…</div>
    </Html>
  );
}

function EmptyState() {
  return (
    <Html center>
      <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)", background: "rgba(4,7,15,0.72)", padding: "12px 16px", borderRadius: 8, border: "1px solid rgba(0,229,255,0.18)", textAlign: "center", maxWidth: 300 }}>
        <div style={{ color: "var(--hologram)", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>NO MODEL LOADED</div>
        <div>Import a JPG, PNG or EPS image</div>
        <div style={{ opacity: 0.7, marginTop: 4 }}>then click Generate 3D mesh</div>
        <div style={{ opacity: 0.5, marginTop: 8, fontSize: 10 }}>orbit: left-drag · pan: right-drag · zoom: wheel · gizmo: T/R/S</div>
      </div>
    </Html>
  );
}

type Mode = "translate" | "rotate" | "scale";

export function Scene({ color, activeAsset, onTransform }: SceneProps) {
  const hasMesh = activeAsset?.meshUrl || (activeAsset?.path && activeAsset.status === "ready");
  const meshUrl = activeAsset?.meshUrl ?? (hasMesh ? `/meshes/${activeAsset?.path}` : null);
  const [mode, setMode] = useState<Mode>("translate");
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const groupRef = useRef<THREE.Group>(null);

  // Sync persisted transform from server to outer group
  useEffect(() => {
    if (!groupRef.current || !activeAsset?.transform) return;
    const { position, rotation, scale } = activeAsset.transform;
    if (position) groupRef.current.position.set(...position);
    if (rotation) groupRef.current.rotation.set(...rotation);
    if (scale) groupRef.current.scale.set(...scale);
  }, [activeAsset?.transform]);

  // Keyboard: T/R/S/Esc
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "t") setMode("translate");
      if (k === "r") setMode("rotate");
      if (k === "s") setMode("scale");
      if (k === "escape") setOrbitEnabled(true);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <Canvas camera={{ position: [6, 4.5, 8], fov: 42 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }} shadows>
      <color attach="background" args={["#060a14"]} />
      <fog attach="fog" args={["#060a14", 16, 36]} />

      <ambientLight intensity={0.62} />
      <directionalLight position={[6, 10, 4]} intensity={1.35} color="#dff6ff" castShadow shadow-mapSize={[2048, 2048]} />
      <hemisphereLight args={["#2a3a5a", "#060a14", 0.55]} />
      {/* Subtle studio light rig like Blender/Tripo */}
      <pointLight position={[-4, 6, -3]} intensity={0.5} color={color} />
      <pointLight position={[4, 3, 6]} intensity={0.35} color="#ffffff" />

      <Stars radius={40} depth={30} count={700} factor={1.4} fade speed={0.2} />
      <Grid
        position={[0, -1.12, 0]}
        args={[40, 40]}
        cellSize={0.5}
        cellThickness={0.4}
        cellColor="rgba(20,60,80,0.35)"
        sectionSize={2.5}
        sectionThickness={0.9}
        sectionColor={color}
        fadeDistance={32}
        fadeStrength={1.2}
        infiniteGrid
      />

      {meshUrl ? (
        <Suspense fallback={<LoaderFallback />}>
          <group ref={groupRef}>
            <MeshAsset url={meshUrl} color={color} />
          </group>
          <TransformControls
            object={groupRef as unknown as THREE.Object3D}
            mode={mode}
            enabled={!!meshUrl}
            onMouseDown={() => setOrbitEnabled(false)}
            onMouseUp={() => {
              setOrbitEnabled(true);
              if (onTransform && groupRef.current) {
                const p = groupRef.current.position;
                const r = groupRef.current.rotation;
                const s = groupRef.current.scale;
                onTransform({
                  position: [Number(p.x.toFixed(3)), Number(p.y.toFixed(3)), Number(p.z.toFixed(3))],
                  rotation: [Number(r.x.toFixed(3)), Number(r.y.toFixed(3)), Number(r.z.toFixed(3))],
                  scale: [Number(s.x.toFixed(3)), Number(s.y.toFixed(3)), Number(s.z.toFixed(3))],
                });
              }
            }}
          />
        </Suspense>
      ) : (
        <EmptyState />
      )}

      {meshUrl && (
        <Html position={[0, 2.2, 0]} center>
          <div style={{ display: "flex", gap: 6, background: "rgba(4,7,15,0.75)", border: "1px solid rgba(0,229,255,0.18)", borderRadius: 6, padding: "4px 6px" }}>
            {(["translate", "rotate", "scale"] as Mode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`btn ${mode === m ? "active" : ""}`} style={{ padding: "4px 8px", fontSize: 10, textTransform: "uppercase" }}>{m[0]}</button>
            ))}
          </div>
        </Html>
      )}

      <OrbitControls
        makeDefault
        enabled={orbitEnabled}
        enableDamping
        dampingFactor={0.06}
        autoRotate={false}
        minDistance={2.5}
        maxDistance={24}
        target={[0, 0, 0]}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </Canvas>
  );
}
