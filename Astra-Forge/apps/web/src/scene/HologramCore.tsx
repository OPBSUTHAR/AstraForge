import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import * as THREE from "three";

interface HologramCoreProps {
  color?: string;
  exploded?: boolean;
}

export function HologramCore({ color = "#00e5ff", exploded = false }: HologramCoreProps) {
  const core = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const scatter = useRef(0);

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec2 vUv;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          vUv = uv;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec2 vUv;
        float scanline(vec2 uv) {
          float line = sin((uv.y * 480.0) - uTime * 2.0);
          return smoothstep(0.45, 0.55, line) * 0.35;
        }
        float fresnel(vec3 n, vec3 v) {
          return pow(1.0 - max(dot(n, v), 0.0), 3.0);
        }
        void main() {
          float f = fresnel(vNormal, vView);
          vec3 base = uColor * (f + 0.35);
          base += scanline(vUv.yx) * uColor;
          float pulse = 0.5 + 0.5 * sin(uTime * 2.0);
          float alpha = max(f, 0.18) + scanline(vUv.yx);
          gl_FragColor = vec4(base + uColor * pulse * 0.15, clamp(alpha, 0.15, 0.9));
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    return mat;
  }, []);

  // Update color without recreating material
  useEffect(() => {
    try {
      material.uniforms.uColor.value.set(color);
    } catch {
      material.uniforms.uColor.value.set("#00e5ff");
    }
  }, [color, material]);

  useEffect(() => {
    return () => material.dispose();
  }, [material]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    material.uniforms.uTime.value = t;
    if (ring.current) {
      ring.current.rotation.z = t * 0.4;
      ring.current.rotation.x = Math.PI / 2.6 + Math.sin(t * 0.3) * 0.2;
    }
    // smooth scatter
    const target = exploded ? 3.2 : 0;
    scatter.current = THREE.MathUtils.lerp(scatter.current, target, 0.06);
    if (core.current) {
      core.current.position.x = scatter.current;
    }
  });

  return (
    <group>
      <mesh ref={core} position={[scatter.current, 0, 0]} material={material} castShadow>
        <icosahedronGeometry args={[1.4, 0]} />
        <Edges scale={1.02} color={color} threshold={15} />
      </mesh>

      <mesh position={[-scatter.current, 0, 0]}>
        <icosahedronGeometry args={[0.7, 0]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <mesh ref={ring} position={[0, scatter.current, 0]}>
        <torusGeometry args={[2.2, 0.03, 8, 100]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <mesh position={[0, -1.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.4, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}
