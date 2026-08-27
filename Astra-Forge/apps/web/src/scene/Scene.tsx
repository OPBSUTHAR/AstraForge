import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, Stars, Html, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { MeshAsset } from "./MeshAsset";
import type { ModelAsset } from "@astraforge/shared";

interface SceneProps {
  exploded?: boolean;
  color: string;
  activeAsset: ModelAsset | null;
  onTransform?: (payload: { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] }) => void;
  wireframe?: boolean;
  viewResetKey?: number;
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
    <Html position={[0, -0.9, 0]} center>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "rgba(214,240,255,0.45)", background: "transparent", padding: 0, textAlign: "center", pointerEvents: "none", userSelect: "none" }}>
        <div style={{ letterSpacing: 1.2, opacity: 0.6 }}>— drop image to generate · scroll free zoom · dbl-click to focus/pan —</div>
      </div>
    </Html>
  );
}

type Mode = "translate" | "rotate" | "scale";

export function Scene({ color, activeAsset, onTransform, wireframe = false, viewResetKey = 0 }: SceneProps) {
  const hasMesh = activeAsset?.meshUrl || (activeAsset?.path && activeAsset.status === "ready");
  let meshUrl: string | null = null;
  if (activeAsset?.meshUrl) {
    const u = activeAsset.meshUrl;
    meshUrl = u.startsWith("/") ? u : `/meshes/${u.replace(/^\/+/, "")}`;
    if (!meshUrl.startsWith("/meshes/") && !meshUrl.startsWith("/api/")) meshUrl = `/meshes/${u.split("/").pop()}`;
  } else if (hasMesh && activeAsset?.path) {
    meshUrl = `/meshes/${activeAsset.path.split("/").pop()}`;
  }
  const [mode, setMode] = useState<Mode>("translate");
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const groupRef = useRef<THREE.Group>(null);
  const [gizmoObject, setGizmoObject] = useState<THREE.Object3D | null>(null);
  const controlsRef = useRef<unknown>(null);

  // Sync persisted transform from server to outer group
  useEffect(() => {
    if (!groupRef.current || !activeAsset?.transform) return;
    const { position, rotation, scale } = activeAsset.transform;
    if (position) groupRef.current.position.set(...position);
    if (rotation) groupRef.current.rotation.set(...rotation);
    if (scale) groupRef.current.scale.set(...scale);
  }, [activeAsset?.transform]);

  // Keep gizmo object in sync when mesh changes
  useEffect(() => {
    if (groupRef.current) setGizmoObject(groupRef.current);
  }, [meshUrl]);

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
      <fog attach="fog" args={["#060a14", 48, 90]} />

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
          <group ref={(el) => { (groupRef as React.MutableRefObject<THREE.Group | null>).current = el; if (el) setGizmoObject(el); }}>
            <MeshAsset url={meshUrl} color={color} wireframe={wireframe} />
          </group>
          {gizmoObject && (
            <TransformControls
              object={gizmoObject}
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
          )}
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
        ref={controlsRef as never}
        makeDefault
        enabled={orbitEnabled}
        enableDamping
        dampingFactor={0.06}
        enableRotate={true}
        enableZoom={true}
        zoomSpeed={1.4}
        enablePan={true}
        panSpeed={1.2}
        screenSpacePanning={false}
        minDistance={0.01}
        maxDistance={Infinity}
        target={[0, 0, 0]}
        minPolarAngle={0}
        maxPolarAngle={Math.PI}
        minAzimuthAngle={-Infinity}
        maxAzimuthAngle={Infinity}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
      <ResetWatcher resetKey={viewResetKey} controlsRef={controlsRef} />
      <DoubleClickPan controlsRef={controlsRef} meshUrl={meshUrl} />
    </Canvas>
  );
}

function ResetWatcher({ resetKey, controlsRef }: { resetKey: number; controlsRef: React.MutableRefObject<unknown> }) {
  const { camera } = useThree();
  useEffect(() => {
    if (resetKey === 0) return;
    (camera as THREE.PerspectiveCamera).position.set(6, 4.5, 8);
    const c = controlsRef.current as { target?: THREE.Vector3; update?: () => void } | null;
    if (c?.target) c.target.set(0, 0, 0);
    c?.update?.();
  }, [resetKey, camera, controlsRef]);
  return null;
}

function DoubleClickPan({ controlsRef, meshUrl }: { controlsRef: React.MutableRefObject<unknown>; meshUrl: string | null }) {
  const { camera, scene, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  useEffect(() => {
    const el = gl.domElement;
    const onDblClick = (e: MouseEvent) => {
      // Double-click to focus/pan: raycast to mesh, or pan to center if missed
      const rect = el.getBoundingClientRect();
      mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.current.setFromCamera(mouse.current, camera as THREE.Camera);
      const intersects = raycaster.current.intersectObjects(scene.children, true);
      // Find first mesh hit (ignore grid/transform gizmo)
      const hit = intersects.find((h) => (h.object as THREE.Mesh).isMesh && !(h.object as unknown as { isTransformControls?: boolean }));
      const controls = controlsRef.current as { target?: THREE.Vector3; update?: () => void } | null;
      if (!controls?.target) return;
      if (hit) {
        // Smooth pan to hit point — free view from any angle
        const target = controls.target;
        const start = target.clone();
        const end = hit.point.clone();
        // Keep camera offset, just move target (pan)
        let t = 0;
        const animate = () => {
          t += 0.08;
          if (t >= 1) {
            target.copy(end);
            controls.update?.();
            return;
          }
          target.lerpVectors(start, end, 1 - Math.pow(1 - t, 3));
          controls.update?.();
          requestAnimationFrame(animate);
        };
        animate();
      } else {
        // Double-click empty: re-center to origin (like Blender Numpad .)
        const target = controls.target;
        const start = target.clone();
        const end = new THREE.Vector3(0, 0, 0);
        let t = 0;
        const animate = () => {
          t += 0.08;
          if (t >= 1) { target.copy(end); controls.update?.(); return; }
          target.lerpVectors(start, end, 1 - Math.pow(1 - t, 3));
          controls.update?.();
          requestAnimationFrame(animate);
        };
        animate();
      }
    };
    el.addEventListener("dblclick", onDblClick);
    return () => el.removeEventListener("dblclick", onDblClick);
  }, [camera, scene, gl, controlsRef, meshUrl]);
  return null;
}
