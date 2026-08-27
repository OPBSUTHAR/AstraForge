import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { useLoader } from "@react-three/fiber";

interface Props {
  url: string;
  color?: string;
  transform?: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] };
}

export function MeshAsset({ url, color = "#00e5ff", transform }: Props) {
  const obj = useLoader(OBJLoader, url, undefined);

  const cloned = useMemo(() => {
    const group = obj.clone(true);
    // center and normalize
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);
    const size = box.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.4 / max;
    group.scale.setScalar(scale);

    // recolor: traverse meshes and tint vertex colors or material
    const col = new THREE.Color(color);
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        // If geometry has vertex colors, multiply; else apply material
        if (m.geometry.getAttribute("color")) {
          // tint by multiplying
        } else {
          const mat = m.material as THREE.Material;
          if ((mat as THREE.MeshStandardMaterial).color) {
            (mat as THREE.MeshStandardMaterial).color.copy(col);
          }
        }
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return group;
  }, [obj, color]);

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
