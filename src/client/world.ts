// Three.js tarafı: Kumkent haritası, oyuncu modelleri, elde silah, mermi izleri.
import * as THREE from 'three';
import { EYE_HEIGHT, MAX_HP } from '../shared/constants';
import { ARENA_HALF, MAP_BOXES, PALMS, POTS, type Box, type BoxKind } from '../shared/map';
import {
  awningTexture, barkTexture, brickTexture, clayTexture, crateTexture, frondTexture,
  plasterTexture, sandTexture, stoneTexture,
} from './textures';

import { onSettings, settings } from './settings';

const reduced = () => settings.reduceFx;

/** BoxGeometry UV'lerini dünya ölçüsüne göre ölçekler: doku her kutuda aynı büyüklükte görünür */
function worldUvBox(sx: number, sy: number, sz: number, tile: number) {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // yüz sırası: +x, -x, +y, -y, +z, -z (her biri 4 köşe)
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  return geo;
}

const TILE: Record<BoxKind, number> = {
  floor: 7, wall: 2.6, building: 4, lowwall: 1.6, crate: 1, pillar: 2, block: 2.4,
};

/** Aynı parçadan çok sayıda (pencere, panjur…) tek çizim çağrısıyla */
class Instancer {
  private mats: THREE.Matrix4[] = [];
  constructor(private geo: THREE.BufferGeometry, private mat: THREE.Material) {}
  push(x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(sx, sy, sz),
    );
    this.mats.push(m);
  }
  build(scene: THREE.Scene, shadow = true) {
    if (!this.mats.length) return;
    const im = new THREE.InstancedMesh(this.geo, this.mat, this.mats.length);
    this.mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = shadow;
    im.receiveShadow = true;
    scene.add(im);
  }
}

export class World {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 0.05, 500);
  renderer: THREE.WebGLRenderer;
  private gunScene = new THREE.Scene();
  private gunCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  private gun = new THREE.Group();
  private flash!: THREE.Mesh;
  private flashLight: THREE.PointLight;
  private recoil = 0;
  private bob = 0;
  private reloadAnim = 0;
  private fx: { obj: THREE.Mesh | THREE.Line; life: number; max: number; kind: 'tracer' | 'spark' }[] = [];
  private disposables: { dispose(): void }[] = [];
  avatars = new Map<string, Avatar>();

  constructor(canvas: HTMLCanvasElement, private lowPower = false) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
    // telefonda piksel oranı ve gölge çözünürlüğü düşük: ısınma ve kare düşüşü olmasın
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.autoClear = false;

    this.buildSky();
    this.buildLights();
    this.buildMap();
    this.buildDetails();
    this.buildProps();
    this.buildGun();

    this.flashLight = new THREE.PointLight(0xffc27a, 0, 7, 2);
    this.scene.add(this.flashLight);
    this.unsub = onSettings((st) => {
      this.camera.fov = st.fov;
      this.camera.updateProjectionMatrix();
    });
    this.resize();
  }

  private unsub: () => void;

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  private buildSky() {
    const geo = this.track(new THREE.SphereGeometry(400, 32, 16));
    const mat = this.track(new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#2f7fd8') },
        mid: { value: new THREE.Color('#7fb8ee') },
        low: { value: new THREE.Color('#f1e3c6') },
        sunDir: { value: new THREE.Vector3(-0.45, 0.72, 0.53).normalize() },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sunDir; varying vec3 vP;
        void main(){
          float h = vP.y;
          vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.6, h)) : mix(low, mid, smoothstep(-0.05, 0.08, h));
          float s = max(dot(normalize(vP), sunDir), 0.0);
          c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    this.scene.add(new THREE.Mesh(geo, mat));
    this.scene.fog = new THREE.Fog('#e9dcc0', 55, 190);
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0xc9a26c, 1.35));
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.6);
    sun.position.set(-22, 36, 26);
    sun.castShadow = true;
    const sm = this.lowPower ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    const s = sun.shadow.camera;
    s.left = s.bottom = -36;
    s.right = s.top = 36;
    s.near = 1; s.far = 120;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
  }

  private buildMap() {
    const sand = this.track(sandTexture());
    const brick = this.track(brickTexture(3, 30));
    const lowBrick = this.track(brickTexture(17, 22));
    const plaster = this.track(plasterTexture());
    const stone = this.track(stoneTexture());
    const crate = this.track(crateTexture());
    const std = (map: THREE.Texture, rough = 0.92) => this.track(new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0 }));
    const mats: Record<BoxKind, THREE.MeshStandardMaterial> = {
      floor: std(sand, 1),
      wall: std(brick),
      building: std(plaster),
      lowwall: std(lowBrick),
      crate: std(crate, 0.8),
      pillar: std(stone),
      block: std(stone),
    };

    for (const b of MAP_BOXES) {
      const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
      const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      if (b.kind === 'pillar') {
        this.column(cx, b.min[1], cz, sy, mats.pillar);
        continue;
      }
      const geo = this.track(b.kind === 'crate' ? new THREE.BoxGeometry(sx, sy, sz) : worldUvBox(sx, sy, sz, TILE[b.kind]));
      const mesh = new THREE.Mesh(geo, mats[b.kind]);
      mesh.position.set(cx, cy, cz);
      mesh.castShadow = b.kind !== 'floor';
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  /** Görsel sütun: kaide, gövde, başlık (çarpışma kutusu aynı yerde) */
  private column(x: number, y: number, z: number, h: number, mat: THREE.Material) {
    const g = new THREE.Group();
    const base = this.track(new THREE.BoxGeometry(0.95, 0.3, 0.95));
    const shaft = this.track(new THREE.CylinderGeometry(0.36, 0.42, h - 0.75, 16));
    const ring = this.track(new THREE.CylinderGeometry(0.48, 0.38, 0.25, 16));
    const cap = this.track(new THREE.BoxGeometry(1.05, 0.2, 1.05));
    const parts: [THREE.BufferGeometry, number][] = [[base, 0.15], [shaft, 0.3 + (h - 0.75) / 2], [ring, h - 0.32], [cap, h - 0.1]];
    for (const [geo, py] of parts) {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = py;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    g.position.set(x, y, z);
    this.scene.add(g);
  }

  /** Binalara pencere, kapı, korkuluk, tente */
  private buildDetails() {
    const darkWood = this.track(new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.85 }));
    const shutterMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3f6f7a, roughness: 0.8 }));
    const hole = this.track(new THREE.MeshStandardMaterial({ color: 0x2b1d12, roughness: 1 }));
    const trimMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(stoneTexture(77)), roughness: 0.9 }));

    const winGeo = this.track(new THREE.BoxGeometry(0.9, 1.15, 0.1));
    const sillGeo = this.track(new THREE.BoxGeometry(1.15, 0.12, 0.28));
    const shutGeo = this.track(new THREE.BoxGeometry(0.42, 1.15, 0.06));
    const doorGeo = this.track(new THREE.BoxGeometry(1.3, 2.3, 0.1));
    const lintelGeo = this.track(new THREE.BoxGeometry(1.7, 0.25, 0.3));
    const win = new Instancer(winGeo, hole);
    const sill = new Instancer(sillGeo, trimMat);
    const shut = new Instancer(shutGeo, shutterMat);
    const door = new Instancer(doorGeo, darkWood);
    const lintel = new Instancer(lintelGeo, trimMat);

    const awnings = [
      this.track(awningTexture('#c8442f', '#efe3cc')),
      this.track(awningTexture('#2f6fa8', '#efe3cc')),
      this.track(awningTexture('#d8962c', '#5a3a22')),
    ];

    const buildings = MAP_BOXES.filter((b) => b.kind === 'building');
    buildings.forEach((b, bi) => {
      const h = b.max[1];
      // çatı korkuluğu
      const sx = b.max[0] - b.min[0], sz = b.max[2] - b.min[2];
      const trimGeo = this.track(worldUvBox(sx + 0.3, 0.45, sz + 0.3, 2.4));
      const trim = new THREE.Mesh(trimGeo, trimMat);
      trim.position.set((b.min[0] + b.max[0]) / 2, h + 0.1, (b.min[2] + b.max[2]) / 2);
      trim.castShadow = trim.receiveShadow = true;
      this.scene.add(trim);
      const band = new THREE.Mesh(this.track(worldUvBox(sx + 0.12, 0.25, sz + 0.12, 2.4)), trimMat);
      band.position.set(trim.position.x, 3.0, trim.position.z);
      band.receiveShadow = true;
      this.scene.add(band);

      for (const face of faces(b)) {
        // sura bitişik yüzleri süsleme (görünmez)
        if (face.hidden) continue;
        const n = Math.max(1, Math.floor(face.len / 3.3));
        const step = face.len / n;
        for (let i = 0; i < n; i++) {
          const t = -face.len / 2 + step * (i + 0.5);
          const [x, z] = face.at(t, 0.04);
          // üst kat penceresi
          if (h > 4.5) {
            win.push(x, 4.6, z, face.rot);
            const [sx2, sz2] = face.at(t, 0.13);
            sill.push(sx2, 3.98, sz2, face.rot);
            const [lx, lz] = face.at(t - 0.68, 0.06);
            const [rx, rz] = face.at(t + 0.68, 0.06);
            shut.push(lx, 4.6, lz, face.rot);
            shut.push(rx, 4.6, rz, face.rot);
          }
          // zemin katı: ortada kapı, kenarlarda küçük pencere
          if (i === Math.floor(n / 2)) {
            door.push(x, 1.15, z, face.rot);
            const [lx2, lz2] = face.at(t, 0.15);
            lintel.push(lx2, 2.42, lz2, face.rot);
            if (face.len > 6 && (bi + i) % 2 === 0) this.awning(face, t, awnings[(bi + i) % awnings.length]);
          } else {
            win.push(x, 1.7, z, face.rot, 0.8, 0.8, 1);
          }
        }
      }
    });
    win.build(this.scene, false);
    sill.build(this.scene);
    shut.build(this.scene);
    door.build(this.scene, false);
    lintel.build(this.scene);
  }

  private awning(face: Face, t: number, tex: THREE.Texture) {
    const geo = this.track(new THREE.PlaneGeometry(2.4, 1.3));
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.95 }));
    const m = new THREE.Mesh(geo, mat);
    const [x, z] = face.at(t, 0.55);
    m.position.set(x, 2.75, z);
    m.rotation.order = 'YXZ';
    m.rotation.y = face.rot;
    m.rotation.x = -Math.PI / 2 + 0.55;
    m.castShadow = true;
    this.scene.add(m);
  }

  private buildProps() {
    // palmiyeler
    const bark = this.track(barkTexture());
    const barkMat = this.track(new THREE.MeshStandardMaterial({ map: bark, roughness: 1 }));
    const frondTex = this.track(frondTexture());
    const frondMat = this.track(new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 }));
    const frondDepth = this.track(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: frondTex, alphaTest: 0.45 }));
    const frondGeo = this.track(new THREE.PlaneGeometry(1.1, 3.6, 1, 8));
    // yaprağı sarkıt: uca doğru aşağı kıvrılır
    const pos = frondGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const v = (pos.getY(i) + 1.8) / 3.6; // 0 dip, 1 uç
      pos.setZ(i, -v * v * 1.6);
      pos.setY(i, v * 3.6);
    }
    frondGeo.computeVertexNormals();

    PALMS.forEach(([x, z, h], pi) => {
      const lean = new THREE.Vector3(Math.cos(pi * 2.1) * 0.9, 0, Math.sin(pi * 2.1) * 0.9);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(lean.x * 0.15, h * 0.35, lean.z * 0.15),
        new THREE.Vector3(lean.x * 0.55, h * 0.7, lean.z * 0.55),
        new THREE.Vector3(lean.x, h, lean.z),
      ]);
      const trunkGeo = this.track(new THREE.TubeGeometry(curve, 12, 0.2, 8, false));
      const trunk = new THREE.Mesh(trunkGeo, barkMat);
      trunk.castShadow = true;
      const g = new THREE.Group();
      g.add(trunk);
      const crown = new THREE.Group();
      crown.position.set(lean.x, h, lean.z);
      const count = 10;
      for (let i = 0; i < count; i++) {
        const f = new THREE.Mesh(frondGeo, frondMat);
        f.customDepthMaterial = frondDepth;
        f.castShadow = true;
        const holder = new THREE.Group();
        holder.rotation.y = (i / count) * Math.PI * 2 + pi;
        f.rotation.x = -Math.PI / 2 + 0.35 + (i % 3) * 0.12; // yataya yakın açılır
        holder.add(f);
        crown.add(holder);
      }
      g.add(crown);
      g.position.set(x, 0, z);
      this.scene.add(g);
    });

    // toprak küpler
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const r = 0.12 + Math.sin(t * Math.PI) * 0.32 + (t > 0.85 ? (t - 0.85) * 0.8 : 0);
      pts.push(new THREE.Vector2(r, t * 1.0));
    }
    const potGeo = this.track(new THREE.LatheGeometry(pts, 18));
    const potMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(clayTexture()), roughness: 0.9 }));
    for (const [x, z, s] of POTS) {
      const m = new THREE.Mesh(potGeo, potMat);
      m.position.set(x, 0, z);
      m.scale.setScalar(s);
      m.castShadow = true;
      this.scene.add(m);
    }
  }

  private buildGun() {
    const metal = this.track(new THREE.MeshStandardMaterial({ color: 0x5b5f66, roughness: 0.5, metalness: 0.3 }));
    const metal2 = this.track(new THREE.MeshStandardMaterial({ color: 0x7a7f88, roughness: 0.45, metalness: 0.35 }));
    const polymer = this.track(new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.7 }));
    const tan = this.track(new THREE.MeshStandardMaterial({ color: 0xa88a5c, roughness: 0.8 }));
    const glove = this.track(new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 }));
    const sleeve = this.track(new THREE.MeshStandardMaterial({ color: 0x5d6142, roughness: 0.95 }));
    const glow = this.track(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff5a2a, emissiveIntensity: 2 }));

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = this.gun) => {
      this.track(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      parent.add(m);
      return m;
    };
    // tüfek (namlu -z yönünde)
    add(new THREE.BoxGeometry(0.075, 0.1, 0.42), metal, 0, 0, -0.05); // gövde
    add(new THREE.BoxGeometry(0.06, 0.03, 0.4), metal2, 0, 0.065, -0.06); // ray
    add(new THREE.BoxGeometry(0.085, 0.085, 0.3), polymer, 0, -0.005, -0.38); // el kundağı
    add(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 10), metal2, 0, 0.012, -0.64, Math.PI / 2); // namlu
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.09, 10), metal, 0, 0.012, -0.8, Math.PI / 2); // namlu ağzı
    add(new THREE.BoxGeometry(0.05, 0.19, 0.08), tan, 0, -0.13, -0.13, 0.22); // şarjör
    add(new THREE.BoxGeometry(0.045, 0.13, 0.06), polymer, 0, -0.1, 0.1, -0.35); // kabza
    add(new THREE.BoxGeometry(0.06, 0.08, 0.26), tan, 0, -0.01, 0.27); // dipçik
    add(new THREE.BoxGeometry(0.03, 0.025, 0.03), metal, 0, 0.09, 0.08); // gez
    add(new THREE.BoxGeometry(0.006, 0.006, 0.006), glow, 0, 0.105, 0.08); // nişan noktası
    add(new THREE.BoxGeometry(0.02, 0.05, 0.02), metal, 0, 0.1, -0.5); // ön nişangâh

    // sağ el kabzada, sol el kundakta; kollar ekran dışına uzanır
    const right = new THREE.Group();
    right.position.set(0.02, -0.12, 0.1);
    add(new THREE.BoxGeometry(0.075, 0.09, 0.1), glove, 0, 0, 0, 0, 0, 0, right);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.06), glove, -0.035, 0.03, -0.07, 0, 0, 0, right); // işaret parmağı
    add(new THREE.CylinderGeometry(0.05, 0.06, 0.38, 10), sleeve, 0.06, -0.09, 0.2, -1.2, 0, -0.25, right);
    this.gun.add(right);
    const left = new THREE.Group();
    left.position.set(-0.03, -0.06, -0.4);
    add(new THREE.BoxGeometry(0.1, 0.06, 0.13), glove, 0, 0, 0, 0, 0, -0.3, left);
    this.gun.add(left);

    // namlu ışığı
    const fc = document.createElement('canvas');
    fc.width = fc.height = 128;
    const fg = fc.getContext('2d')!;
    const grad = fg.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,240,1)');
    grad.addColorStop(0.25, 'rgba(255,200,120,0.9)');
    grad.addColorStop(1, 'rgba(255,120,40,0)');
    fg.fillStyle = grad;
    fg.beginPath();
    for (let i = 0; i < 12; i++) {
      const r = i % 2 ? 22 : 64;
      const a = (i / 12) * Math.PI * 2;
      fg.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    fg.fill();
    const flashTex = this.track(new THREE.CanvasTexture(fc));
    const flashMat = this.track(new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash = add(new THREE.PlaneGeometry(0.22, 0.22), flashMat, 0, 0.012, -0.87);

    this.gun.position.set(0.2, -0.21, -0.42);
    this.gun.scale.setScalar(0.8);
    this.gun.rotation.y = 0.06;
    this.gunScene.add(this.gun);
    this.gunScene.add(new THREE.HemisphereLight(0xdfeeff, 0xc9a26c, 1.6));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
    key.position.set(-1, 2, 1.2);
    this.gunScene.add(key);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.gunCam.aspect = w / h;
    this.gunCam.updateProjectionMatrix();
  }

  /** Kendi atışımız: geri tepme + namlu ışığı */
  muzzle() {
    this.recoil = 1;
    (this.flash.material as THREE.MeshBasicMaterial).opacity = 1;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flashLight.intensity = 5;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: string | number, own: boolean) {
    const start = from.clone();
    if (own) {
      const off = new THREE.Vector3(0.17, -0.15, -0.9).applyQuaternion(this.camera.quaternion);
      start.add(off);
    }
    const geo = new THREE.BufferGeometry().setFromPoints([start, to]);
    const mat = new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.fx.push({ obj: line, life: 0.08, max: 0.08, kind: 'tracer' });

    const sg = new THREE.SphereGeometry(0.05, 6, 4);
    const sm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const spark = new THREE.Mesh(sg, sm);
    spark.position.copy(to);
    this.scene.add(spark);
    this.fx.push({ obj: spark, life: 0.2, max: 0.2, kind: 'spark' });
  }

  avatar(id: string, name: string, color: string): Avatar {
    let a = this.avatars.get(id);
    if (!a) {
      a = new Avatar(name, color);
      this.avatars.set(id, a);
      this.scene.add(a.group);
    }
    return a;
  }

  removeAvatar(id: string) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.group);
    a.dispose();
    this.avatars.delete(id);
  }

  setReloading(r: boolean) { this.reloadAnim = r ? 1 : 0; }

  private reloadT = 0;

  render(dt: number, moving: boolean) {
    this.recoil = Math.max(0, this.recoil - dt * 10);
    const kick = reduced() ? 0.3 : 1;
    if (moving && !reduced()) this.bob += dt * 10;
    this.reloadT += ((this.reloadAnim ? 1 : 0) - this.reloadT) * Math.min(1, dt * 10);
    const by = reduced() ? 0 : Math.abs(Math.sin(this.bob)) * 0.012;
    const bx = reduced() ? 0 : Math.cos(this.bob) * 0.009;
    this.gun.position.set(0.2 + bx, -0.21 + by - this.reloadT * 0.12, -0.42 + this.recoil * 0.05 * kick);
    this.gun.rotation.set(this.recoil * 0.09 * kick + this.reloadT * 0.5, 0.06, this.reloadT * 0.4);

    const fm = this.flash.material as THREE.MeshBasicMaterial;
    fm.opacity = Math.max(0, fm.opacity - dt * 24);
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 120);
    this.flashLight.position.copy(this.camera.position);

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      const m = f.obj.material as THREE.Material & { opacity: number };
      m.opacity = Math.max(0, f.life / f.max);
      if (f.kind === 'spark') f.obj.scale.setScalar(1 + (1 - f.life / f.max) * 2.5);
      if (f.life <= 0) {
        this.scene.remove(f.obj);
        f.obj.geometry.dispose();
        m.dispose();
        this.fx.splice(i, 1);
      }
    }

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.gunScene, this.gunCam);
  }

  setGunVisible(v: boolean) { this.gun.visible = v; }

  dispose() {
    this.unsub();
    for (const a of this.avatars.values()) a.dispose();
    this.avatars.clear();
    for (const f of this.fx) { f.obj.geometry.dispose(); (f.obj.material as THREE.Material).dispose(); }
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
  }
}

interface Face {
  len: number;
  rot: number;
  hidden: boolean;
  /** yüz boyunca t konumunda, dışarı doğru d kadar ötedeki nokta */
  at(t: number, d: number): [number, number];
}

function faces(b: Box): Face[] {
  const [x0, , z0] = b.min;
  const [x1, , z1] = b.max;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const lim = ARENA_HALF - 0.6;
  return [
    { len: x1 - x0, rot: 0, hidden: z1 > lim, at: (t, d) => [cx + t, z1 + d] }, // +z
    { len: x1 - x0, rot: Math.PI, hidden: z0 < -lim, at: (t, d) => [cx - t, z0 - d] }, // -z
    { len: z1 - z0, rot: Math.PI / 2, hidden: x1 > lim, at: (t, d) => [x1 + d, cz - t] }, // +x
    { len: z1 - z0, rot: -Math.PI / 2, hidden: x0 < -lim, at: (t, d) => [x0 - d, cz + t] }, // -x
  ];
}

/** Diğer oyuncuların asker modeli: kamuflaj pantolon, renkli yelek, kask, tüfek, isim ve can çubuğu */
export class Avatar {
  group = new THREE.Group();
  private upper = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private shinL = new THREE.Group();
  private shinR = new THREE.Group();
  private label: THREE.Sprite;
  private labelCtx: CanvasRenderingContext2D;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private tex: THREE.CanvasTexture;
  private bodyMats: THREE.MeshStandardMaterial[] = [];
  private phase = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private speed = 0;
  private lastHp = -1;
  hitFlash = 0;

  constructor(private name: string, private color: string) {
    const c = new THREE.Color(color);
    const mat = (col: THREE.ColorRepresentation, rough = 0.85) => {
      const m = new THREE.MeshStandardMaterial({ color: col, roughness: rough, emissive: 0xff2020, emissiveIntensity: 0 });
      this.mats.push(m);
      this.bodyMats.push(m);
      return m;
    };
    const pants = mat(0x6e6a4c);
    const boots = mat(0x2e2620);
    const shirt = mat(0x55583c);
    const vest = mat(c.clone().lerp(new THREE.Color(0x4a4a3a), 0.25), 0.7);
    const skin = mat(0xc08a63, 0.7);
    const helmet = mat(0x59603f, 0.6);
    const gunM = mat(0x232427, 0.45);
    const bandM = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6 });
    this.mats.push(bandM);

    const box = (sx: number, sy: number, sz: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      this.geos.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // bacaklar: kalça ekleminden döner, dizden bükülür
    for (const [leg, shin, sx] of [[this.legL, this.shinL, -0.11], [this.legR, this.shinR, 0.11]] as const) {
      leg.position.set(sx, 0.92, 0);
      box(0.17, 0.46, 0.19, pants, 0, -0.23, 0, leg);
      shin.position.set(0, -0.46, 0);
      box(0.15, 0.4, 0.17, pants, 0, -0.2, 0, shin);
      box(0.16, 0.1, 0.26, boots, 0, -0.42, -0.04, shin);
      leg.add(shin);
      this.group.add(leg);
    }
    box(0.36, 0.14, 0.22, pants, 0, 0.95, 0, this.group); // kalça

    // üst gövde: bakış açısıyla eğilir
    this.upper.position.y = 1.0;
    this.group.add(this.upper);
    box(0.4, 0.5, 0.22, shirt, 0, 0.25, 0, this.upper);
    box(0.44, 0.38, 0.3, vest, 0, 0.28, 0, this.upper); // yelek
    box(0.1, 0.12, 0.06, vest, -0.1, 0.2, -0.17, this.upper); // cepler
    box(0.1, 0.12, 0.06, vest, 0.1, 0.2, -0.17, this.upper);
    box(0.24, 0.3, 0.12, vest, 0, 0.3, 0.2, this.upper); // sırt çantası
    // baş
    const head = new THREE.Group();
    head.position.y = EYE_HEIGHT - 1.0;
    this.upper.add(head);
    const headGeo = new THREE.SphereGeometry(0.13, 14, 10);
    const helmGeo = new THREE.SphereGeometry(0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const neckGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8);
    this.geos.push(headGeo, helmGeo, neckGeo);
    const headM = new THREE.Mesh(headGeo, skin); headM.castShadow = true; head.add(headM);
    const helm = new THREE.Mesh(helmGeo, helmet); helm.position.y = 0.02; helm.castShadow = true; head.add(helm);
    const neck = new THREE.Mesh(neckGeo, skin); neck.position.y = -0.14; head.add(neck);
    box(0.24, 0.05, 0.04, bandM, 0, 0.04, -0.13, head); // gözlük bandı (oyuncu rengi)
    // kollar ve tüfek: göğüs hizasında, ileri doğru
    const armR = box(0.11, 0.11, 0.42, shirt, 0.21, 0.32, -0.15, this.upper);
    armR.rotation.x = 0.25;
    const armL = box(0.11, 0.11, 0.48, shirt, -0.12, 0.33, -0.25, this.upper);
    armL.rotation.set(0.15, -0.45, 0);
    box(0.08, 0.1, 0.75, gunM, 0.08, 0.36, -0.42, this.upper);
    box(0.05, 0.14, 0.07, gunM, 0.08, 0.26, -0.38, this.upper);

    // isim etiketi + can çubuğu
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 72;
    this.labelCtx = cv.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const sm = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false });
    this.mats.push(sm);
    this.label = new THREE.Sprite(sm);
    this.label.scale.set(1.5, 0.42, 1);
    this.label.position.y = 2.2;
    this.label.renderOrder = 10;
    this.group.add(this.label);
    this.drawLabel(MAX_HP);
  }

  private drawLabel(hp: number) {
    const g = this.labelCtx;
    g.clearRect(0, 0, 256, 72);
    g.font = '600 26px "Space Grotesk", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.strokeText(this.name, 128, 22);
    g.fillStyle = '#ffffff';
    g.fillText(this.name, 128, 22);
    // can çubuğu
    const w = 150, x = 128 - w / 2, y = 46;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x - 2, y - 2, w + 4, 14);
    g.fillStyle = this.color;
    g.fillRect(x, y, (w * Math.max(0, hp)) / MAX_HP, 10);
    // bölmeler
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (let i = 1; i < 5; i++) g.fillRect(x + (w * i) / 5 - 1, y, 2, 10);
    this.tex.needsUpdate = true;
  }

  set(x: number, y: number, z: number, yaw: number, pitch: number, alive: boolean, hp: number, dt: number) {
    if (hp !== this.lastHp) { this.lastHp = hp; this.drawLabel(hp); }
    if (!Number.isNaN(this.lastX) && dt > 0) {
      const v = Math.hypot(x - this.lastX, z - this.lastZ) / dt;
      this.speed += (Math.min(v, 12) - this.speed) * Math.min(1, dt * 10);
    }
    this.lastX = x; this.lastZ = z;
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.upper.rotation.x = pitch * 0.6;
    this.group.visible = alive;

    // yürüme döngüsü
    const k = Math.min(1, this.speed / 6);
    this.phase += dt * (4 + this.speed * 1.2) * (k > 0.05 ? 1 : 0);
    const s = Math.sin(this.phase) * 0.7 * k;
    this.legL.rotation.x = s;
    this.legR.rotation.x = -s;
    this.shinL.rotation.x = Math.max(0, -Math.cos(this.phase)) * 0.9 * k;
    this.shinR.rotation.x = Math.max(0, Math.cos(this.phase)) * 0.9 * k;
    this.upper.position.y = 1.0 + Math.abs(Math.cos(this.phase)) * 0.03 * k;

    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    for (const m of this.bodyMats) m.emissiveIntensity = this.hitFlash * 0.6;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.tex.dispose();
  }
}
