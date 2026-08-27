import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Stars, Html } from "@react-three/drei";
import { HologramCore } from "./HologramCore";
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
        <HologramCore color={color} exploded={exploded} />
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
