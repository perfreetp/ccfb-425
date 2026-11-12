import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type {
  AnalysisResult,
  BuildingObstacle,
  CraneObstacle,
  Obstacle,
  Platform,
  SurfaceName,
} from '../types';
import { OlsModel } from '../lib/ols';
import { SURFACE_LABEL } from '../types';

export interface SceneCallbacks {
  onPickPoint?: (x: number, y: number) => void;
  onPlatformChange?: (patch: Partial<Platform>) => void;
  onSelectObstacle?: (id: string | null) => void;
}

interface Theme {
  bg: number;
  fog: number;
  ground: number;
  grid: number;
  ambient: number;
  sun: number;
  building: number;
  hostBuilding: number;
  crane: number;
  edge: number;
}

const DAY: Theme = {
  bg: 0xbfd7ea,
  fog: 0xbfd7ea,
  ground: 0xd8d2c4,
  grid: 0x8a97a3,
  ambient: 0xffffff,
  sun: 0xfff2d8,
  building: 0x9fb0bd,
  hostBuilding: 0x6f9bc5,
  crane: 0xd9a441,
  edge: 0x3c4854,
};

const NIGHT: Theme = {
  bg: 0x070d18,
  fog: 0x070d18,
  ground: 0x101826,
  grid: 0x1f3147,
  ambient: 0x4a5d7a,
  sun: 0x8fb4ff,
  building: 0x1c2c40,
  hostBuilding: 0x274b73,
  crane: 0x8a6a2f,
  edge: 0x5a7fa6,
};

const SURFACE_COLORS: Record<SurfaceName, number> = {
  approach: 0x2ecc71,
  takeoff: 0x3498db,
  transition: 0xf39c12,
  horizontal: 0x9b59b6,
};

const PEN_COLOR = 0xff2a2a;

function buildingGeometry(b: BuildingObstacle): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  b.footprint.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, -p.y);
    else shape.lineTo(p.x, -p.y);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, b.baseElevation, 0);
  geo.computeVertexNormals();
  return geo;
}

export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private transform: TransformControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private ground: THREE.Mesh;
  private grid: THREE.GridHelper;
  private ambient: THREE.AmbientLight;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private nightLights: THREE.PointLight[] = [];

  private buildingGroup = new THREE.Group();
  private craneGroup = new THREE.Group();
  private olsGroup = new THREE.Group();
  private penGroup = new THREE.Group();
  private platformGroup = new THREE.Group();
  private markerGroup = new THREE.Group();
  private pickPlane: THREE.Mesh;

  private theme = DAY;
  private wireframe = false;
  private mode: 'day' | 'night' = 'day';
  private platform: Platform | null = null;
  private obstacles: Obstacle[] = [];
  private hostId: string | null = null;
  private selectedId: string | null = null;
  private result: AnalysisResult | null = null;
  private picking = false;
  private cb: SceneCallbacks;
  private resizeObs: ResizeObserver;
  private container: HTMLElement;
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(container: HTMLElement, cb: SceneCallbacks = {}) {
    this.container = container;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.5,
      5000,
    );
    this.camera.position.set(260, 220, 300);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbit.target.set(0, 40, 0);

    this.ambient = new THREE.AmbientLight(DAY.ambient, 0.55);
    this.hemi = new THREE.HemisphereLight(0xddeeff, 0x6b6255, 0.5);
    this.sun = new THREE.DirectionalLight(DAY.sun, 1.6);
    this.sun.position.set(180, 300, 120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 350;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.far = 1200;
    this.scene.add(this.ambient, this.hemi, this.sun, this.sun.target);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: DAY.ground, roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(2000, 100, DAY.grid, DAY.grid);
    const gridMat = this.grid.material as THREE.LineBasicMaterial;
    gridMat.opacity = 0.35;
    gridMat.transparent = true;
    this.scene.add(this.grid);

    // 拾取用隐形水平面(位于平台高度)
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
    );
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.pickPlane);

    this.scene.add(
      this.buildingGroup,
      this.craneGroup,
      this.olsGroup,
      this.penGroup,
      this.platformGroup,
      this.markerGroup,
    );

    // TransformControls
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.9);
    this.transform.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      if (!e.value && this.platform) {
        this.cb.onPlatformChange?.({
          position: { ...this.platform.position },
          approachBearing: this.platform.approachBearing,
        });
      }
    });
    this.transform.addEventListener('objectChange', () => {
      if (!this.platform) return;
      const o = this.transform.object;
      this.platform.position.x = o.position.x;
      this.platform.position.y = o.position.z;
      this.platform.approachBearing =
        (THREE.MathUtils.radToDeg(-o.rotation.y) + 360) % 360;
    });
    this.scene.add(this.transform.getHelper ? this.transform.getHelper() : (this.transform as unknown as THREE.Object3D));

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);

    this.animate();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  };

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setPicking(on: boolean): void {
    this.picking = on;
    this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
  }

  setCallbacks(cb: Partial<SceneCallbacks>): void {
    this.cb = { ...this.cb, ...cb };
  }

  setWireframe(on: boolean): void {
    this.wireframe = on;
    this.olsGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = on;
        }
      }
    });
  }

  setMode(mode: 'day' | 'night'): void {
    this.mode = mode;
    this.theme = mode === 'night' ? NIGHT : DAY;
    const t = this.theme;
    this.scene.background = new THREE.Color(t.bg);
    this.scene.fog = new THREE.Fog(t.fog, 500, 2200);
    (this.ground.material as THREE.MeshStandardMaterial).color.setHex(t.ground);
    (this.grid.material as THREE.LineBasicMaterial).color.setHex(t.grid);
    this.ambient.color.setHex(t.ambient);
    this.ambient.intensity = mode === 'night' ? 0.42 : 0.55;
    this.hemi.intensity = mode === 'night' ? 0.32 : 0.5;
    this.sun.color.setHex(t.sun);
    this.sun.intensity = mode === 'night' ? 0.35 : 1.6;
    this.renderer.toneMappingExposure = mode === 'night' ? 0.95 : 1.05;
    this.rebuildBuildings();
    this.rebuildCranes();
    this.rebuildOls();
    this.rebuildPlatform();
    this.applyNightLights();
  }

  /** 载入项目数据并重建全部场景对象 */
  setData(platform: Platform, obstacles: Obstacle[], hostId: string | null): void {
    this.platform = structuredClone(platform);
    this.obstacles = obstacles;
    this.hostId = hostId;
    this.selectedId = null;
    this.rebuildBuildings();
    this.rebuildCranes();
    this.rebuildOls();
    this.rebuildPlatform();
    this.clearPenetration();
    this.attachTransform();
    this.applyNightLights();
  }

  /** 平台/限制面参数变化后的增量刷新(不重建楼块) */
  updatePlatform(platform: Platform): void {
    this.platform = structuredClone(platform);
    this.rebuildOls();
    this.rebuildPlatform();
    if (this.result) this.showPenetration(this.result);
    this.attachTransform();
  }

  updateObstacles(obstacles: Obstacle[], hostId: string | null): void {
    this.obstacles = obstacles;
    this.hostId = hostId;
    this.rebuildBuildings();
    this.rebuildCranes();
    this.applyNightLights();
  }

  selectObstacle(id: string | null): void {
    this.selectedId = id;
    this.rebuildBuildings();
    this.rebuildCranes();
  }

  private clearGroup(g: THREE.Group): void {
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m?.dispose());
      }
    });
    g.clear();
  }

  private rebuildBuildings(): void {
    this.clearGroup(this.buildingGroup);
    const t = this.theme;
    for (const b of this.obstacles) {
      if (b.kind !== 'building') continue;
      const geo = buildingGeometry(b);
      const isHost = b.id === this.hostId;
      const isSel = b.id === this.selectedId;
      const mat = new THREE.MeshStandardMaterial({
        color: isHost ? t.hostBuilding : t.building,
        roughness: 0.75,
        metalness: this.mode === 'night' ? 0.35 : 0.05,
        emissive: isSel ? 0x2266aa : isHost ? 0x0a2540 : 0x000000,
        emissiveIntensity: isSel ? 0.7 : isHost ? 0.4 : 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.obstacleId = b.id;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 25),
        new THREE.LineBasicMaterial({ color: t.edge, transparent: true, opacity: 0.5 }),
      );
      mesh.add(edges);

      // 夜间楼顶红色航空障碍灯
      if (this.mode === 'night') {
        const c = b.footprint.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        const n = b.footprint.length;
        const topZ = b.baseElevation + b.height;
        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(1.6, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xff3333 }),
        );
        beacon.position.set(c.x / n, topZ + 2, c.y / n);
        mesh.add(beacon);
      }
      this.buildingGroup.add(mesh);
    }
  }

  private rebuildCranes(): void {
    this.clearGroup(this.craneGroup);
    const t = this.theme;
    for (const o of this.obstacles) {
      if (o.kind !== 'crane') continue;
      const c = o as CraneObstacle;
      const g = new THREE.Group();
      g.userData.obstacleId = c.id;
      const mat = new THREE.MeshStandardMaterial({
        color: t.crane,
        roughness: 0.5,
        metalness: 0.3,
        emissive: this.selectedId === c.id ? 0x663300 : 0x000000,
        emissiveIntensity: this.selectedId === c.id ? 0.8 : 0,
      });
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, c.mastHeight, 8), mat);
      mast.position.set(c.position.x, c.baseElevation + c.mastHeight / 2, c.position.y);
      mast.castShadow = true;
      g.add(mast);

      const head = new THREE.Vector3(c.position.x, c.baseElevation + c.mastHeight, c.position.y);
      const th = THREE.MathUtils.DEG2RAD * c.jibBearing;
      const dir = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
      const tip = head.clone().addScaledVector(dir, c.jibLength);
      tip.y += c.jibTipHeight;
      g.add(this.cylinderBetween(head, tip, 0.35, mat));
      // 平衡臂
      const tail = head.clone().addScaledVector(dir, -c.jibLength * 0.32);
      g.add(this.cylinderBetween(head, tail, 0.45, mat));
      // 塔顶
      const apex = head.clone().add(new THREE.Vector3(0, 6, 0));
      g.add(this.cylinderBetween(head, apex, 0.3, mat));
      // 吊钩
      const hookTop = tip.clone();
      const hookBottom = tip.clone();
      hookBottom.y = Math.max(c.baseElevation + 2, tip.y - c.mastHeight * 0.35);
      g.add(this.cylinderBetween(hookTop, hookBottom, 0.12, mat));
      this.craneGroup.add(g);
    }
  }

  private cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
    const len = a.distanceTo(b);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    mesh.castShadow = true;
    return mesh;
  }

  private surfaceMaterial(surface: SurfaceName, opacity = 0.28): THREE.MeshStandardMaterial {
    const color = SURFACE_COLORS[surface];
    return new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: this.mode === 'night' ? 0.55 : 0.18,
      transparent: true,
      opacity: this.mode === 'night' ? Math.min(opacity + 0.08, 0.5) : opacity,
      side: THREE.DoubleSide,
      roughness: 0.4,
      metalness: 0.05,
      depthWrite: false,
      wireframe: this.wireframe,
    });
  }

  /** 构建进近/起飞梯形坡面 */
  private wedgeMesh(
    model: OlsModel,
    kind: 'approach' | 'takeoff',
  ): THREE.Mesh {
    const o = model.params;
    const length = kind === 'approach' ? o.approachLength : o.takeoffLength;
    const slope = kind === 'approach' ? o.approachSlope : o.takeoffSlope;
    const dir = kind === 'approach' ? 1 : -1;
    const segU = 24;
    const segV = 6;
    const positions: number[] = [];
    const indices: number[] = [];
    const z0 = model.baseZ;

    for (let i = 0; i <= segU; i++) {
      const d = (length * i) / segU;
      const u = dir * d;
      const hw = model.surfaceHalfWidth(u);
      const z = z0 + d / slope;
      for (let j = 0; j <= segV; j++) {
        const v = -hw + (2 * hw * j) / segV;
        const w = model.toWorld(u, v);
        positions.push(w.x, z, w.y);
      }
    }
    for (let i = 0; i < segU; i++) {
      for (let j = 0; j < segV; j++) {
        const a = i * (segV + 1) + j;
        const b = a + 1;
        const c = a + segV + 1;
        const d2 = c + 1;
        indices.push(a, c, b, b, c, d2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.surfaceMaterial(kind));
    mesh.renderOrder = 2;
    this.addWire(mesh);
    return mesh;
  }

  private addWire(mesh: THREE.Mesh): void {
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }),
    );
    wire.visible = this.wireframe;
    mesh.add(wire);
  }

  private ribbonMesh(ribbon: ReturnType<OlsModel['transitionRibbons']>[number]): THREE.Mesh {
    const n = ribbon.inner.length;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      positions.push(ribbon.inner[i].x, ribbon.innerZ[i], ribbon.inner[i].y);
      positions.push(ribbon.outer[i].x, ribbon.outerZ[i], ribbon.outer[i].y);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.surfaceMaterial('transition', 0.22));
    mesh.renderOrder = 2;
    this.addWire(mesh);
    return mesh;
  }

  private rebuildOls(): void {
    this.clearGroup(this.olsGroup);
    if (!this.platform) return;
    const model = new OlsModel(this.platform);

    this.olsGroup.add(this.wedgeMesh(model, 'approach'));
    this.olsGroup.add(this.wedgeMesh(model, 'takeoff'));
    for (const r of model.transitionRibbons()) {
      this.olsGroup.add(this.ribbonMesh(r));
    }

    const cap = model.horizontalCap();
    const capGeo = new THREE.CircleGeometry(cap.radius, 72);
    capGeo.rotateX(-Math.PI / 2);
    const capMesh = new THREE.Mesh(capGeo, this.surfaceMaterial('horizontal', 0.1));
    capMesh.position.set(cap.center.x, cap.z, cap.center.y);
    capMesh.renderOrder = 1;
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 97 }, (_, i) => {
          const a = (i / 96) * Math.PI * 2;
          return new THREE.Vector3(
            cap.center.x + cap.radius * Math.cos(a),
            cap.z,
            cap.center.y + cap.radius * Math.sin(a),
          );
        }),
      ),
      new THREE.LineBasicMaterial({ color: SURFACE_COLORS.horizontal, transparent: true, opacity: 0.7 }),
    );
    capMesh.add(ring);
    this.olsGroup.add(capMesh);
  }

  private rebuildPlatform(): void {
    this.transform.detach();
    this.clearGroup(this.platformGroup);
    if (!this.platform) return;
    const p = this.platform;
    const g = new THREE.Group();
    g.position.set(p.position.x, p.position.z, p.position.y);
    g.rotation.y = -THREE.MathUtils.DEG2RAD * p.approachBearing;

    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x2b3a55,
      roughness: 0.6,
      metalness: 0.2,
      emissive: this.mode === 'night' ? 0x123055 : 0x000000,
      emissiveIntensity: this.mode === 'night' ? 0.8 : 0,
    });
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(p.fatoWidth + p.safetyMargin * 2, 0.8, p.fatoLength + p.safetyMargin * 2),
      deckMat,
    );
    deck.castShadow = true;
    g.add(deck);

    // FATO 标线
    const fatoLine = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(p.fatoWidth, 0.05, p.fatoLength)),
      new THREE.LineBasicMaterial({ color: 0xfff6d8 }),
    );
    fatoLine.position.y = 0.45;
    g.add(fatoLine);

    // 进近方向箭头
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, p.fatoLength / 2 + 2);
    arrowShape.lineTo(-2.2, p.fatoLength / 2 - 3);
    arrowShape.lineTo(2.2, p.fatoLength / 2 - 3);
    arrowShape.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    arrowGeo.rotateX(Math.PI / 2);
    const arrow = new THREE.Mesh(
      arrowGeo,
      new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide }),
    );
    arrow.position.y = 0.5;
    g.add(arrow);

    // 中心标识 H
    const hGeo = new THREE.PlaneGeometry(4, 6);
    hGeo.rotateX(-Math.PI / 2);
    const hCanvas = document.createElement('canvas');
    hCanvas.width = 128;
    hCanvas.height = 192;
    const hctx = hCanvas.getContext('2d')!;
    hctx.fillStyle = '#fff6d8';
    hctx.font = 'bold 150px Arial';
    hctx.textAlign = 'center';
    hctx.textBaseline = 'middle';
    hctx.fillText('H', 64, 100);
    const hTex = new THREE.CanvasTexture(hCanvas);
    const hMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 7.5),
      new THREE.MeshBasicMaterial({ map: hTex, transparent: true, side: THREE.DoubleSide }),
    );
    hMesh.geometry.rotateX(-Math.PI / 2);
    hMesh.position.y = 0.52;
    g.add(hMesh);

    this.platformGroup.add(g);
    this.pickPlane.position.set(p.position.x, p.position.z, p.position.y);
  }

  private attachTransform(): void {
    if (!this.platform || this.platformGroup.children.length === 0) return;
    const g = this.platformGroup.children[0];
    if (this.transform.object !== g) this.transform.attach(g);
    this.transform.showX = true;
    this.transform.showZ = true;
    this.transform.showY = false;
  }

  setTransformMode(mode: 'translate' | 'rotate' | null): void {
    if (!mode) {
      this.transform.detach();
      return;
    }
    this.attachTransform();
    this.transform.setMode(mode);
    if (mode === 'rotate') {
      this.transform.showX = false;
      this.transform.showZ = false;
      this.transform.showY = true;
    } else {
      this.transform.showX = true;
      this.transform.showZ = true;
      this.transform.showY = false;
    }
  }

  showPenetration(result: AnalysisResult): void {
    this.result = result;
    this.clearGroup(this.penGroup);
    const mat = new THREE.MeshStandardMaterial({
      color: PEN_COLOR,
      transparent: true,
      opacity: 0.72,
      emissive: PEN_COLOR,
      emissiveIntensity: this.mode === 'night' ? 0.9 : 0.35,
      roughness: 0.4,
    });
    for (const r of result.results) {
      if (!r.penetrated) continue;
      for (const box of r.boxes) {
        const h = box.topZ - box.bottomZ;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(box.maxX - box.minX, h, box.maxY - box.minY),
          mat,
        );
        mesh.position.set(
          (box.minX + box.maxX) / 2,
          box.bottomZ + h / 2,
          (box.minY + box.maxY) / 2,
        );
        mesh.renderOrder = 3;
        this.penGroup.add(mesh);
      }
      for (const pt of r.points) {
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 10), mat);
        sphere.position.set(pt.x, (pt.z + pt.limitZ) / 2, pt.y);
        this.penGroup.add(sphere);
      }
    }
  }

  clearPenetration(): void {
    this.result = null;
    this.clearGroup(this.penGroup);
  }

  /** 在指定世界坐标放置一个临时标记(塔吊预览) */
  showMarker(x: number, y: number, z = 2): void {
    this.clearGroup(this.markerGroup);
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(2.5, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff8800 }),
    );
    m.position.set(x, z, y);
    this.markerGroup.add(m);
  }

  clearMarker(): void {
    this.clearGroup(this.markerGroup);
  }

  private applyNightLights(): void {
    for (const l of this.nightLights) {
      this.scene.remove(l);
      l.dispose();
    }
    this.nightLights = [];
    if (this.mode !== 'night') return;
    // 楼块顶部暖色点光源,烘托夜间城区
    for (const o of this.obstacles) {
      if (o.kind !== 'building') continue;
      const b = o as BuildingObstacle;
      const sum = b.footprint.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
      const n = b.footprint.length;
      const light = new THREE.PointLight(0xffb066, 0.8, 150, 2);
      light.position.set(sum.x / n, b.baseElevation + b.height + 6, sum.y / n);
      this.scene.add(light);
      this.nightLights.push(light);
    }
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.transform.dragging) return;
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.picking) {
      const hit = this.raycaster.intersectObject(this.pickPlane, false)[0];
      if (hit) {
        this.cb.onPickPoint?.(hit.point.x, hit.point.z);
      }
      return;
    }

    const hits = this.raycaster.intersectObjects(
      [...this.buildingGroup.children, ...this.craneGroup.children],
      true,
    );
    if (hits.length === 0) {
      this.cb.onSelectObstacle?.(null);
      return;
    }
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !obj.userData.obstacleId) obj = obj.parent;
    this.cb.onSelectObstacle?.(obj?.userData.obstacleId ?? null);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.picking) return;
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.pickPlane, false)[0];
    if (hit) this.showMarker(hit.point.x, hit.point.z, this.platform?.position.z ?? 2);
  };

  /** 截图返回 dataURL */
  capture(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  fitView(): void {
    if (!this.platform) return;
    const p = this.platform.position;
    this.orbit.target.set(p.x, p.z * 0.6, p.y);
    this.camera.position.set(p.x + 260, p.z + 170, p.y + 300);
    this.orbit.update();
  }

  dispose(): void {
    this.resizeObs.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.transform.dispose();
    this.orbit.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export { SURFACE_LABEL };
