import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Stars } from "@react-three/drei";
import { HologramCore } from "./HologramCore";
import type { ModelAsset } from "@astraforge/shared";

interface SceneProps {
  exploded: boolean;
  color: string;
  activeAsset: ModelAsset | null;
}

export function Scene({ exploded, color, activeAsset }: SceneProps) {
  void activeAsset;
  return (
    <Canvas
      camera={{ position: [6, 4.5, 8], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
    >
      <color attach="background" args={["#04070f"]} />
      <fog attach="fog" args={["#04070f", 14, 30]} />

      <ambientLight intensity={0.25} />
      <directionalLight position={[6, 10, 4]} intensity={1.2} color="#7fd7ff" />

      <Stars radius={40} depth={30} count={1400} factor={2.4} fade speed={0.4} />

      <Grid
        position={[0, -1.15, 0]}
        args={[40, 40]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#0e3b4a"
        sectionSize={2.5}
        sectionThickness={1.1}
        sectionColor={color}
        fadeDistance={28}
        infiniteGrid
      />

      <HologramCore color={color} exploded={exploded} />

      <OrbitControls
        makeDefault
        enableDamping
        autoRotate={!exploded}
        autoRotateSpeed={0.8}
        minDistance={2.5}
        maxDistance={24}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}