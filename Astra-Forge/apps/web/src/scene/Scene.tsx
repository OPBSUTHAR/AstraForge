import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Stars, Html } from "@react-three/drei";
import { MeshAsset } from "./MeshAsset";
import type { ModelAsset } from "@astraforge/shared";

interface SceneProps {
  exploded: boolean;
  color: string;
  activeAsset: ModelAsset | null;
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
      <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)", background: "rgba(4,7,15,0.72)", padding: "12px 16px", borderRadius: 8, border: "1px solid rgba(0,229,255,0.18)", textAlign: "center", maxWidth: 280 }}>
        <div style={{ color: "var(--hologram)", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>NO MODEL LOADED</div>
        <div>Import a JPG, PNG or EPS image</div>
        <div style={{ opacity: 0.7, marginTop: 4 }}>then click Generate 3D mesh</div>
      </div>
    </Html>
  );
}

export function Scene({ exploded, color, activeAsset }: SceneProps) {
  const hasMesh = activeAsset?.meshUrl || (activeAsset?.path && activeAsset.status === "ready");
  const meshUrl = activeAsset?.meshUrl ?? (hasMesh ? `/meshes/${activeAsset?.path}` : null);

  return (
    <Canvas camera={{ position: [6, 4.5, 8], fov: 45 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
      <color attach="background" args={["#04070f"]} />
      <fog attach="fog" args={["#04070f", 14, 30]} />

      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 10, 4]} intensity={1.2} color="#7fd7ff" />
      <hemisphereLight args={["#212a48", "#04070f", 0.6]} />

      <Stars radius={40} depth={30} count={900} factor={2} fade speed={0.3} />
      <Grid
        position={[0, -1.15, 0]}
        args={[40, 40]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#0e3b4a"
        sectionSize={2.5}
        sectionThickness={1}
        sectionColor={color}
        fadeDistance={28}
        infiniteGrid
      />

      {meshUrl ? (
        <Suspense fallback={<LoaderFallback />}>
          <MeshAsset url={meshUrl} color={color} transform={activeAsset?.transform} />
        </Suspense>
      ) : (
        <EmptyState />
      )}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.06}
        autoRotate={!exploded && !meshUrl}
        autoRotateSpeed={0.6}
        minDistance={2.5}
        maxDistance={24}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}
