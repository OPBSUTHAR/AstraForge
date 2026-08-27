import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { useLoader } from "@react-three/fiber";

interface Props {
  url: string;
  color?: string;
  transform?: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] };
  wireframe?: boolean;
}

export function MeshAsset({ url, color = "#00e5ff", transform, wireframe = false }: Props) {
  const obj = useLoader(OBJLoader, url, undefined);

  const cloned = useMemo(() => {
    const group = obj.clone(true);
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);
    const size = box.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.4 / max;
    group.scale.setScalar(scale);
    const col = new THREE.Color(color);
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        const hasVertCol = !!m.geometry.getAttribute("color");
        if (!hasVertCol) {
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat.color) mat.color.copy(col);
          if (mat.roughness !== undefined) { mat.roughness = 0.42; mat.metalness = 0.06; }
        } else {
          // For vertex-colored meshes (heightfield), keep colors but boost emissive so dark EPS is visible
          const mat = m.material as THREE.MeshStandardMaterial;
          // Ensure vertexColors enabled
          mat.vertexColors = true;
          mat.roughness = 0.55;
          mat.metalness = 0.02;
          mat.emissive.copy(col).multiplyScalar(0.18);
          mat.emissiveIntensity = 0.45;
          // Brighten dark vertex colors slightly
          const colAttr = m.geometry.getAttribute("color") as THREE.BufferAttribute;
          if (colAttr) {
            const arr = colAttr.array as Float32Array;
            let avg = 0; for (let i = 0; i < arr.length; i++) avg += arr[i];
            avg /= arr.length || 1;
            if (avg < 0.25) {
              for (let i = 0; i < arr.length; i++) arr[i] = Math.min(1, arr[i] * 1.7 + 0.12);
              colAttr.needsUpdate = true;
            }
          }
        }
        (m.material as THREE.MeshStandardMaterial).wireframe = wireframe;
        (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return group;
  }, [obj, color, wireframe]);

  useEffect(() => {
    return () => {
      cloned.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const m = c as THREE.Mesh;
          m.geometry?.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
          else (m.material as THREE.Material)?.dispose?.();
        }
      });
    };
  }, [cloned]);

  const pos: [number, number, number] = transform?.position ?? [0, 0, 0];
  const rot: [number, number, number] = transform?.rotation ?? [0, 0, 0];
  const scl: [number, number, number] = transform?.scale ?? [1, 1, 1];

  return (
    <group position={pos} rotation={rot} scale={scl}>
      <primitive object={cloned} />
    </group>
  );
}
