// dnd-hub-dice.js — Three.js + cannon-es with per-face textures, DSN-style camera
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const FLOOR_Y           = -2.5;
const FIXED_STEP        = 1 / 60;
const MAX_SUB_STEPS     = 3;
const SETTLE_SECS       = 0.12; // quick snap like Dice So Nice final settle

// Triangles per logical face.
const TRI_PER_FACE = { 4: 1, 6: 2, 8: 1, 10: 2, 12: 3, 20: 1 };

// ── Singletons ───────────────────────────────────────────
let _renderer = null, _scene = null, _camera = null;
let _world = null;
let _wallBodies = [];
let _activeDice = [];
let _loopRunning = false;
let _resizeObserver = null;
const _shapeCache   = new Map();
const _normCache    = new Map();
const _textureCache = new Map();
const _mappingCache = new Map();

// ── Scene ────────────────────────────────────────────────
function ensureScene(overlay) {
  const w = overlay.clientWidth || 600;
  const h = overlay.clientHeight || 400;

  if (_renderer) {
    _renderer.setSize(w, h);
    _camera.aspect = w / h;
    _camera.updateProjectionMatrix();
    return;
  }

  _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _renderer.setClearColor(0x000000, 0);
  const canvas = _renderer.domElement;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  overlay.appendChild(canvas);

  _scene  = new THREE.Scene();
  // Near-top-down camera matching Dice So Nice style
  _camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
  _camera.position.set(0, 9, 3);
  _camera.lookAt(0, FLOOR_Y, 0);
  _renderer.setSize(w, h);

  _scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffeedd, 1.6);
  dir.position.set(2, 10, 4);
  _scene.add(dir);
  const fill = new THREE.DirectionalLight(0xaaccff, 0.3);
  fill.position.set(-4, 4, -2);
  _scene.add(fill);

  if (_resizeObserver) _resizeObserver.disconnect();
  _resizeObserver = new ResizeObserver(() => {
    const w2 = overlay.clientWidth || 600;
    const h2 = overlay.clientHeight || 400;
    _renderer.setSize(w2, h2);
    _camera.aspect = w2 / h2;
    _camera.updateProjectionMatrix();
    ensureWalls();
  });
  _resizeObserver.observe(overlay);
}

// ── Physics world ────────────────────────────────────────
function ensureWorld() {
  if (_world) return;
  _world = new CANNON.World({ gravity: new CANNON.Vec3(0, -40, 0) });
  _world.broadphase = new CANNON.NaiveBroadphase();
  _world.allowSleep = true;
  _world.defaultContactMaterial.restitution = 0.42;
  _world.defaultContactMaterial.friction    = 0.38;

  const ground = new CANNON.Body({ mass: 0 });
  ground.addShape(new CANNON.Plane());
  ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  ground.position.set(0, FLOOR_Y, 0);
  _world.addBody(ground);
}

// Projects an NDC screen corner to a world-space point on the floor plane (y = FLOOR_Y).
function screenCornerToWorld(ndcX, ndcY) {
  const ndc = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(_camera);
  const dir = ndc.clone().sub(_camera.position).normalize();
  if (Math.abs(dir.y) < 1e-6) return null;
  const t = (FLOOR_Y - _camera.position.y) / dir.y;
  if (t < 0) return null;
  return new THREE.Vector3(
    _camera.position.x + t * dir.x,
    FLOOR_Y,
    _camera.position.z + t * dir.z,
  );
}

// Rebuilds the four static wall planes bounding the camera-visible floor rectangle.
// Safe to call multiple times — removes previous walls first.
function ensureWalls() {
  if (!_camera || !_world) { _wallBodies = []; return; }
  _wallBodies.forEach(b => _world.removeBody(b));
  _wallBodies = [];

  const INSET = 0.4;
  // Use NDC ±0.65 for X: keeps dice within the central 65% of canvas width,
  // so they stay well clear of the panel edges on either side.
  const corners = [
    screenCornerToWorld(-0.65, -1),
    screenCornerToWorld( 0.65, -1),
    screenCornerToWorld(-0.65,  1),
    screenCornerToWorld( 0.65,  1),
  ].filter(Boolean);

  let xMin, xMax, zMin, zMax;
  if (corners.length === 4) {
    const xs = corners.map(c => c.x);
    const zs = corners.map(c => c.z);
    xMin = Math.min(...xs) + INSET;
    xMax = Math.max(...xs) - INSET;
    zMin = Math.min(...zs) + INSET;
    zMax = Math.max(...zs) - INSET;
  } else {
    // Fallback when frustum math fails
    xMin = -4; xMax = 4; zMin = -3.5; zMax = 3.5;
  }

  // Axis: 0=Y for rotating the default +Z normal to face the correct direction
  const makeWall = (pos, axisAngle) => {
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(new CANNON.Plane());
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), axisAngle);
    body.position.set(pos.x, FLOOR_Y, pos.z);
    _world.addBody(body);
    _wallBodies.push(body);
  };

  makeWall({ x: xMin, z: 0 },  Math.PI / 2);   // left  — normal +X
  makeWall({ x: xMax, z: 0 }, -Math.PI / 2);   // right — normal -X
  makeWall({ x: 0, z: zMin },  0);              // far   — normal +Z
  makeWall({ x: 0, z: zMax },  Math.PI);        // near  — normal -Z
}

// ── Textures ─────────────────────────────────────────────

// D4: each face has 3 different numbers — one at each vertex, rotated 120° toward that corner.
// Canvas layout (flipY): apex vertex at bottom-centre (64,118); base at top (10,18)–(118,18).
// n0 = apex (v0), n1 = top-right (v1), n2 = top-left (v2).
function getD4FaceTexture(n0, n1, n2) {
  const cacheKey = `d4_${n0}_${n1}_${n2}`;
  if (_textureCache.has(cacheKey)) return _textureCache.get(cacheKey);
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d0804';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#d4af37';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 22px Georgia, serif';
  [
    { x: S * 0.50, y: S * 0.71, rot: 0,                   num: n0 },
    { x: S * 0.75, y: S * 0.24, rot: -(2 * Math.PI) / 3, num: n1 },
    { x: S * 0.25, y: S * 0.24, rot:  (2 * Math.PI) / 3, num: n2 },
  ].forEach(({ x, y, rot, num }) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillText(String(num), 0, 0);
    ctx.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  _textureCache.set(cacheKey, tex);
  return tex;
}

function getNumberTexture(num, dieType) {
  const cacheKey = `${num}_${dieType}`;
  if (_textureCache.has(cacheKey)) return _textureCache.get(cacheKey);
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d0804';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#d4af37';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  {
    const fs = dieType === 10
      ? (String(num).length > 1 ? 40 : 50)
      : (String(num).length > 1 ? 50 : 62);
    ctx.font = `bold ${fs}px Georgia, serif`;
    // flipY=true: canvas y = (1 − V) × S.  Number goes at the UV centroid of each face.
    // d6  square:   centroid V=0.50 → canvas 0.50*S
    // d12 pentagon: centroid V≈0.506 → canvas ≈0.494*S  (use 0.50, imperceptible diff)
    // d8/d20 tri:   centroid V=0.60 → canvas (1−0.60)×S = 0.40*S
    const textY = (dieType === 6 || dieType === 10 || dieType === 12) ? S * 0.50 : S * 0.40;
    ctx.fillText(String(num), S / 2, textY);
    if (num === 6 || num === 9) {
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(S / 2 - 12, textY + 26);
      ctx.lineTo(S / 2 + 12, textY + 26);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  _textureCache.set(cacheKey, tex);
  return tex;
}

// ── Geometry ─────────────────────────────────────────────

// Pentagonal trapezohedron — the correct shape for a d10.
// Each face is a flat kite (4 coplanar vertices). Coplanarity requires:
//   h = H * (1 - cos36°) / (1 + cos36°)
// where H is apex height and h is the equatorial ring height.
// Any other h value makes the faces non-planar and produces visible split artefacts.
function makePentagonalTrapezohedron() {
  const N     = 5;
  const ANGLE = (2 * Math.PI) / N;
  const HALF  = Math.PI / N; // 36°

  const H = 0.85;  // apex height
  const R = 0.82;  // equatorial ring radius
  const h = H * (1 - Math.cos(HALF)) / (1 + Math.cos(HALF)); // ≈ 0.090

  const north = new THREE.Vector3(0,  H, 0);
  const south = new THREE.Vector3(0, -H, 0);
  const topV  = Array.from({ length: N }, (_, k) =>
    new THREE.Vector3(R * Math.cos(k * ANGLE), h, R * Math.sin(k * ANGLE)));
  const botV  = Array.from({ length: N }, (_, k) =>
    new THREE.Vector3(R * Math.cos(k * ANGLE + HALF), -h, R * Math.sin(k * ANGLE + HALF)));

  const posArr = [];
  const push = v => posArr.push(v.x, v.y, v.z);
  const addQuad = (a, b, c, d) => { push(a); push(b); push(c); push(a); push(c); push(d); };

  // CCW winding → outward normals
  for (let k = 0; k < N; k++) addQuad(north, topV[(k + 1) % N], botV[k], topV[k]);
  for (let k = 0; k < N; k++) addQuad(south, botV[k], topV[(k + 1) % N], botV[(k + 1) % N]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3));
  geo.computeVertexNormals();
  return geo;
}

function makeRawGeometry(sides) {
  switch (sides) {
    case 4:  return new THREE.TetrahedronGeometry(1.0, 0);
    case 6:  return new THREE.BoxGeometry(1.4, 1.4, 1.4).toNonIndexed();
    case 8:  return new THREE.OctahedronGeometry(1.1, 0);
    case 10: return makePentagonalTrapezohedron();
    case 12: return new THREE.DodecahedronGeometry(1.0, 0);
    case 20: return new THREE.IcosahedronGeometry(1.1, 0);
    default: return new THREE.IcosahedronGeometry(1.0, 0);
  }
}

// Returns UV [u,v] for vertex `vert` in triangle `triInFace` of a face
// whose logical shape requires `triPF` triangles.
function faceUV(triPF, triInFace, vert) {
  if (triPF === 1) {
    return [[0.5, 0.08], [0.92, 0.86], [0.08, 0.86]][vert];
  }
  if (triPF === 2) {
    // Three.js BoxGeometry toNonIndexed winding: TL BL TR / BL BR TR
    return triInFace === 0
      ? [[0, 1], [0, 0], [1, 1]][vert]
      : [[0, 0], [1, 0], [1, 1]][vert];
  }
  if (triPF === 3) {
    // Pentagon fan from top vertex; pts[0] is the shared fan vertex
    const pts = [[0.5,0.07],[0.91,0.37],[0.75,0.86],[0.25,0.86],[0.09,0.37]];
    return [pts[0], pts[triInFace + 1], pts[triInFace + 2]][vert];
  }
  return [0.5, 0.5];
}

// D12: planar UV projection per pentagonal face.
// DodecahedronGeometry emits faces as consecutive groups of 9 vertices (3 tris × 3 verts).
// We project each face onto its own tangent plane so canvas center maps to face center.
function applyD12FaceUVs(geo) {
  const pos = geo.getAttribute('position');
  const FACE_COUNT  = 12;
  const VERTS_PER   = 9; // 3 triangles × 3 verts
  const uvArr = new Float32Array(pos.count * 2);

  for (let f = 0; f < FACE_COUNT; f++) {
    const base = f * VERTS_PER;
    const verts = Array.from({ length: VERTS_PER }, (_, i) =>
      new THREE.Vector3(pos.getX(base + i), pos.getY(base + i), pos.getZ(base + i)));

    const e1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
    const e2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
    const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();
    if (normal.dot(verts[0]) < 0) normal.negate(); // ensure outward

    const tangent   = e1.normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    const center = new THREE.Vector3();
    verts.forEach(v => center.add(v));
    center.divideScalar(VERTS_PER);

    const uvs2d = verts.map(v => {
      const rel = new THREE.Vector3().subVectors(v, center);
      return [rel.dot(tangent), rel.dot(bitangent)];
    });

    const us = uvs2d.map(uv => uv[0]);
    const vs = uvs2d.map(uv => uv[1]);
    const range = Math.max(
      Math.max(...us) - Math.min(...us),
      Math.max(...vs) - Math.min(...vs),
    ) || 1;
    const scale = (1 - 2 * 0.14) / range;

    for (let i = 0; i < VERTS_PER; i++) {
      uvArr[(base + i) * 2]     = 0.5 + uvs2d[i][0] * scale;
      uvArr[(base + i) * 2 + 1] = 0.5 + uvs2d[i][1] * scale;
    }
    geo.addGroup(base, VERTS_PER, f);
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return FACE_COUNT;
}

// D10: planar UV projection per kite face (same method as D12).
// makePentagonalTrapezohedron emits 10 faces as consecutive groups of 6 vertices (2 tris × 3).
function applyD10FaceUVs(geo) {
  const pos = geo.getAttribute('position');
  const FACE_COUNT = 10;
  const VERTS_PER  = 6; // 2 triangles × 3 verts
  const uvArr = new Float32Array(pos.count * 2);

  for (let f = 0; f < FACE_COUNT; f++) {
    const base = f * VERTS_PER;
    const verts = Array.from({ length: VERTS_PER }, (_, i) =>
      new THREE.Vector3(pos.getX(base + i), pos.getY(base + i), pos.getZ(base + i)));

    const e1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
    const e2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
    const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();
    if (normal.dot(verts[0]) < 0) normal.negate();

    const tangent   = e1.clone().normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    const center = new THREE.Vector3();
    verts.forEach(v => center.add(v));
    center.divideScalar(VERTS_PER);

    const uvs2d = verts.map(v => {
      const rel = new THREE.Vector3().subVectors(v, center);
      return [rel.dot(tangent), rel.dot(bitangent)];
    });

    const us = uvs2d.map(uv => uv[0]);
    const vs = uvs2d.map(uv => uv[1]);
    const range = Math.max(
      Math.max(...us) - Math.min(...us),
      Math.max(...vs) - Math.min(...vs),
    ) || 1;
    const scale = (1 - 2 * 0.14) / range;

    for (let i = 0; i < VERTS_PER; i++) {
      uvArr[(base + i) * 2]     = 0.5 + uvs2d[i][0] * scale;
      uvArr[(base + i) * 2 + 1] = 0.5 + uvs2d[i][1] * scale;
    }
    geo.addGroup(base, VERTS_PER, f);
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return FACE_COUNT;
}

// Mutates `geo`: overwrites UVs with face-centred layout and adds one group per face.
// Returns the number of logical faces added (0 if not supported).
function applyFaceData(geo, sides) {
  if (sides === 12) return applyD12FaceUVs(geo);
  if (sides === 10) return applyD10FaceUVs(geo);
  const triPF = TRI_PER_FACE[sides];
  if (!triPF) return 0;
  const pos = geo.getAttribute('position');
  const faceCount = (pos.count / 3) / triPF;
  const uvArr = new Float32Array(pos.count * 2);

  for (let f = 0; f < faceCount; f++) {
    for (let t = 0; t < triPF; t++) {
      for (let v = 0; v < 3; v++) {
        const i = (f * triPF + t) * 3 + v;
        const [u, vv] = faceUV(triPF, t, v);
        uvArr[i * 2] = u; uvArr[i * 2 + 1] = vv;
      }
    }
    geo.addGroup(f * triPF * 3, triPF * 3, f);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return faceCount;
}

// Computes the outward-pointing unit normal for each logical face
// (normalised centroid of all vertices belonging to that face).
// Returns null for die types without face-texture support.
function computeFaceNormals(sides) {
  if (_normCache.has(sides)) return _normCache.get(sides);
  const triPF = TRI_PER_FACE[sides];
  if (!triPF) { _normCache.set(sides, null); return null; }

  const geo = makeRawGeometry(sides);
  const pos = geo.getAttribute('position');
  const faceCount = (pos.count / 3) / triPF;
  const normals = [];

  for (let f = 0; f < faceCount; f++) {
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (let t = 0; t < triPF; t++) {
      const base = (f * triPF + t) * 3;
      for (let v = 0; v < 3; v++, n++) {
        cx += pos.getX(base + v);
        cy += pos.getY(base + v);
        cz += pos.getZ(base + v);
      }
    }
    cx /= n; cy /= n; cz /= n;
    const len = Math.sqrt(cx*cx + cy*cy + cz*cz);
    normals.push(new THREE.Vector3(cx / len, cy / len, cz / len));
  }
  geo.dispose();
  _normCache.set(sides, normals);
  return normals;
}

// ── Face → number mapping ─────────────────────────────────
// Returns array where result[faceIndex] = the number shown on that face.
// Conventions:
//   d10: odd numbers (1,3,5,7,9) on upper ring (Y>0 normals), even on lower ring
//   all others: opposite faces sum to (sides + 1)
function buildNumberMapping(sides, normals) {
  if (!normals) return null;
  const n = normals.length;

  if (sides === 10) {
    const upper = [], lower = [];
    normals.forEach((norm, i) => (norm.y > 0 ? upper : lower).push(i));
    upper.sort((a, b) => Math.atan2(normals[a].z, normals[a].x) - Math.atan2(normals[b].z, normals[b].x));
    lower.sort((a, b) => Math.atan2(normals[a].z, normals[a].x) - Math.atan2(normals[b].z, normals[b].x));
    const mapping = new Array(n);
    [1, 3, 5, 7, 9].forEach((num, i) => { mapping[upper[i]] = num; });
    [2, 4, 6, 8, 10].forEach((num, i) => { mapping[lower[i]] = num; });
    return mapping;
  }

  // Pair each face with its most anti-parallel face; assign numbers so pairs sum to sides+1.
  const assigned = new Array(n).fill(false);
  const pairs = [];
  for (let i = 0; i < n; i++) {
    if (assigned[i]) continue;
    let bestJ = -1, bestDot = Infinity;
    for (let j = i + 1; j < n; j++) {
      if (assigned[j]) continue;
      const dot = normals[i].dot(normals[j]);
      if (dot < bestDot) { bestDot = dot; bestJ = j; }
    }
    if (bestJ >= 0) {
      pairs.push([i, bestJ]);
      assigned[i] = assigned[bestJ] = true;
    }
  }
  const mapping = new Array(n);
  pairs.forEach(([a, b], k) => { mapping[a] = k + 1; mapping[b] = n - k; });
  return mapping;
}

function getFaceMapping(sides) {
  if (_mappingCache.has(sides)) return _mappingCache.get(sides);
  const mapping = buildNumberMapping(sides, computeFaceNormals(sides));
  _mappingCache.set(sides, mapping);
  return mapping;
}

// ── Three.js mesh ────────────────────────────────────────

// Actual buffer vertex order for each TetrahedronGeometry face after PolyhedronGeometry
// subdivision (detail=0). PolyhedronGeometry pushes [b,c,a] per face, not [a,b,c], so
// raw indices [2,1,0] → buffer [v1,v0,v2], [0,3,2] → [v3,v2,v0], etc.
// Each entry is [vi0, vi1, vi2] — global vertex indices for buffer positions 0,1,2.
// vi0 → UV apex (bottom-centre), vi1 → UV top-right, vi2 → UV top-left.
const D4_FACE_VERTS = [[1, 0, 2], [3, 2, 0], [3, 0, 1], [3, 1, 2]];

// Normalised world-space directions of each TetrahedronGeometry vertex (raw coords / √3).
// Used to settle d4 with the result vertex pointing straight up.
const D4_VERTEX_DIRS = [
  new THREE.Vector3( 1,  1,  1).normalize(),
  new THREE.Vector3(-1, -1,  1).normalize(),
  new THREE.Vector3(-1,  1, -1).normalize(),
  new THREE.Vector3( 1, -1, -1).normalize(),
];

function makeDieGroup(sides) {
  const geo = makeRawGeometry(sides);
  const faceCount = applyFaceData(geo, sides);
  const mapping = getFaceMapping(sides);

  let mesh;
  if (faceCount > 0) {
    const mats = [];

    if (sides === 4 && mapping) {
      // Each vertex has one number; each face shows the 3 numbers of its vertices.
      // Derive vertex number: the face NOT containing vertex vi has result = vi's number.
      const vertNum = new Array(4);
      for (let vi = 0; vi < 4; vi++) {
        for (let f = 0; f < 4; f++) {
          if (!D4_FACE_VERTS[f].includes(vi)) { vertNum[vi] = mapping[f]; break; }
        }
      }
      for (let f = 0; f < 4; f++) {
        const [vi0, vi1, vi2] = D4_FACE_VERTS[f];
        mats.push(new THREE.MeshPhongMaterial({
          map: getD4FaceTexture(vertNum[vi0], vertNum[vi1], vertNum[vi2]),
          shininess: 80,
          specular: new THREE.Color(0.22, 0.13, 0.04),
        }));
      }
    } else {
      for (let f = 0; f < faceCount; f++) {
        const num = mapping ? mapping[f] : f + 1;
        mats.push(new THREE.MeshPhongMaterial({
          map: getNumberTexture(num, sides),
          shininess: 80,
          specular: new THREE.Color(0.22, 0.13, 0.04),
        }));
      }
    }
    mesh = new THREE.Mesh(geo, mats);
  } else {
    mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
      color: 0x120c08, shininess: 80, specular: 0x553322,
    }));
  }

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 15),
    new THREE.LineBasicMaterial({ color: 0xd4af37 }),
  );
  const group = new THREE.Group();
  group.add(mesh);
  group.add(edges);
  return group;
}

// ── Cannon shapes ────────────────────────────────────────
function geometryToConvexPolyhedron(geo) {
  const pos = geo.getAttribute('position');
  const PREC = 1e4; const map = new Map(); const verts = []; const idxOf = [];
  for (let i = 0; i < pos.count; i++) {
    const x = Math.round(pos.getX(i)*PREC)/PREC;
    const y = Math.round(pos.getY(i)*PREC)/PREC;
    const z = Math.round(pos.getZ(i)*PREC)/PREC;
    const key = `${x},${y},${z}`;
    if (!map.has(key)) { map.set(key, verts.length); verts.push(new CANNON.Vec3(x, y, z)); }
    idxOf.push(map.get(key));
  }
  const faces = [];
  for (let i = 0; i < idxOf.length; i += 3) {
    const a = idxOf[i], b = idxOf[i+1], c = idxOf[i+2];
    if (a !== b && b !== c && a !== c) faces.push([a, b, c]);
  }
  return new CANNON.ConvexPolyhedron({ vertices: verts, faces });
}

function getCannonShape(sides) {
  if (_shapeCache.has(sides)) return _shapeCache.get(sides);
  let shape;
  if (sides === 6) {
    shape = new CANNON.Box(new CANNON.Vec3(0.7, 0.7, 0.7));
  } else {
    const geo = makeRawGeometry(sides);
    try { shape = geometryToConvexPolyhedron(geo); } catch (_) { shape = new CANNON.Sphere(1.0); }
    geo.dispose();
  }
  _shapeCache.set(sides, shape);
  return shape;
}

// ── Read which face is on top from physics quaternion ────
function getTopFaceValue(sides, cannonQuat) {
  const mapping = getFaceMapping(sides);
  const q = new THREE.Quaternion(cannonQuat.x, cannonQuat.y, cannonQuat.z, cannonQuat.w);

  if (sides === 4 && mapping) {
    // d4: result = the vertex pointing most upward
    const vertNum = new Array(4);
    for (let vi = 0; vi < 4; vi++)
      for (let f = 0; f < 4; f++)
        if (!D4_FACE_VERTS[f].includes(vi)) { vertNum[vi] = mapping[f]; break; }
    let bestVi = 0, bestY = -Infinity;
    for (let vi = 0; vi < 4; vi++) {
      const wy = D4_VERTEX_DIRS[vi].clone().applyQuaternion(q).y;
      if (wy > bestY) { bestY = wy; bestVi = vi; }
    }
    return vertNum[bestVi];
  }

  const norms = computeFaceNormals(sides);
  if (!norms) return Math.ceil(Math.random() * sides);
  let bestFace = 0, bestY = -Infinity;
  for (let i = 0; i < norms.length; i++) {
    const wy = norms[i].clone().applyQuaternion(q).y;
    if (wy > bestY) { bestY = wy; bestFace = i; }
  }
  return mapping ? mapping[bestFace] : bestFace + 1;
}

// ── Spawn ────────────────────────────────────────────────
function spawnState(sides, result, { suppressLabel = false, labelResult = null, freeRoll = false, onSettled = null } = {}) {
  const group = makeDieGroup(sides);
  _scene.add(group);

  // Drop from above, scattered across the table (DSN style).
  // Keep X/Z within ±1.5 so dice always start inside the physics walls.
  const spawnX = (Math.random() - 0.5) * 3;
  const spawnY = 6 + Math.random() * 3;
  const spawnZ = (Math.random() - 0.5) * 3;

  const cannon = new CANNON.Body({
    mass: 1, shape: getCannonShape(sides),
    linearDamping: 0.15, angularDamping: 0.25,
    allowSleep: true, sleepSpeedLimit: 0.4, sleepTimeLimit: 0.6,
  });
  cannon.position.set(spawnX, spawnY, spawnZ);
  cannon.velocity.set(
    (Math.random() - 0.5) * 5,
    -(6 + Math.random() * 6),
    (Math.random() - 0.5) * 5,
  );
  const spin = 15 + Math.random() * 12;
  cannon.angularVelocity.set(
    (Math.random() - 0.5) * spin,
    (Math.random() - 0.5) * spin,
    (Math.random() - 0.5) * spin,
  );
  _world.addBody(cannon);

  const die = {
    group, cannon, result, sides,
    suppressLabel, labelResult, freeRoll, onSettled,
    settling: false, settleStart: null,
    settleFromQuat: null, settleToQuat: null,
    settled: false, settledAt: null,
    resultEl: null, removed: false,
    startedAt: performance.now(),
  };
  cannon.addEventListener('sleep', () => settle(die, performance.now()));
  return die;
}

// ── Tick ─────────────────────────────────────────────────
function easeOut(t) { return 1 - (1 - t) * (1 - t); }

function tickDie(die, now) {
  if (die.settling) {
    const t = Math.min((now - die.settleStart) / 1000 / SETTLE_SECS, 1);
    // Position: stay exactly on floor
    die.group.position.set(die.cannon.position.x, FLOOR_Y, die.cannon.position.z);
    // Rotation: quick slerp to result-face-up
    if (die.settleToQuat) {
      die.group.quaternion.slerpQuaternions(die.settleFromQuat, die.settleToQuat, easeOut(t));
    }
    if (t >= 1) {
      die.settling  = false;
      die.settled   = true;
      die.settledAt = now;
      showResult(die);
      die.onSettled?.(die.result);
    }
    return;
  }

  if (!die.settled) {
    if ((now - die.startedAt) / 1000 > 5) settle(die, now);
    die.group.position.copy(die.cannon.position);
    die.group.quaternion.copy(die.cannon.quaternion);
  }

  if (die.settled && die.settledAt) {
    const age = (now - die.settledAt) / 1000;
    if (age > 3.0) {
      const t = Math.min((age - 3.0) / 0.7, 1);
      die.group.traverse(o => {
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { m.transparent = true; m.opacity = 1 - t; });
        }
      });
      if (die.resultEl) die.resultEl.style.opacity = String(1 - t);
      if (t >= 1) removeDie(die);
    }
  }
}

// ── Settle ───────────────────────────────────────────────
function settle(die, now) {
  if (die.settled || die.settling) return;

  die.cannon.sleep();
  die.cannon.velocity.setZero();
  die.cannon.angularVelocity.setZero();

  if (die.freeRoll) {
    // Physics determines the result — read whichever face landed on top
    die.result = getTopFaceValue(die.sides, die.cannon.quaternion);
    die.settled   = true;
    die.settledAt = now;
    showResult(die);
    die.onSettled?.(die.result);
    return;
  }

  // Determine which direction in object space should point straight up after settling.
  // d4: point the result VERTEX up (physical convention — the spike pointing up is the result).
  // All others: point the result FACE normal up.
  let settleDir = null;
  if (die.sides === 4) {
    const mapping = getFaceMapping(4);
    if (mapping) {
      const vertNum = new Array(4);
      for (let vi = 0; vi < 4; vi++)
        for (let f = 0; f < 4; f++)
          if (!D4_FACE_VERTS[f].includes(vi)) { vertNum[vi] = mapping[f]; break; }
      for (let vi = 0; vi < 4; vi++) {
        if (vertNum[vi] === die.result) { settleDir = D4_VERTEX_DIRS[vi].clone(); break; }
      }
    }
  } else {
    const norms   = computeFaceNormals(die.sides);
    const mapping = getFaceMapping(die.sides);
    const faceIdx = mapping ? mapping.indexOf(die.result) : die.result - 1;
    if (norms) settleDir = norms[faceIdx >= 0 ? faceIdx : die.result - 1] ?? null;
  }

  if (settleDir) {
    die.settleFromQuat = new THREE.Quaternion(
      die.cannon.quaternion.x, die.cannon.quaternion.y,
      die.cannon.quaternion.z, die.cannon.quaternion.w,
    );
    die.settleToQuat = new THREE.Quaternion().setFromUnitVectors(
      settleDir, new THREE.Vector3(0, 1, 0),
    );
    die.settling    = true;
    die.settleStart = now;
  } else {
    die.settled   = true;
    die.settledAt = now;
    showResult(die);
    die.onSettled?.(die.result);
  }
}

function showResult(die) {
  if (die.suppressLabel) return;
  const val = die.labelResult ?? die.result;
  const overlay = document.getElementById('dice-overlay');
  if (!overlay || !_camera) return;

  const pos = new THREE.Vector3(die.cannon.position.x, FLOOR_Y, die.cannon.position.z);
  pos.project(_camera);
  const sx = ((pos.x + 1) / 2) * overlay.clientWidth;
  const sy = ((-pos.y + 1) / 2) * overlay.clientHeight - 58;

  const el = document.createElement('div');
  el.className  = 'die-result-overlay';
  el.style.left = `${sx}px`;
  el.style.top  = `${sy}px`;
  el.textContent = String(val);
  overlay.appendChild(el);
  die.resultEl = el;
}

function removeDie(die) {
  die.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => m.dispose());
    }
  });
  _scene.remove(die.group);
  _world.removeBody(die.cannon);
  if (die.resultEl) die.resultEl.remove();
  die.removed = true;
}

// ── Render loop ──────────────────────────────────────────
function startLoop() {
  if (_loopRunning) return;
  _loopRunning = true;
  let lastTime = performance.now();
  function loop() {
    if (_activeDice.length === 0) { _loopRunning = false; return; }
    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.05);
    lastTime  = now;
    requestAnimationFrame(loop);
    _world.step(FIXED_STEP, dt, MAX_SUB_STEPS);
    _activeDice.forEach(d => tickDie(d, now));
    _activeDice = _activeDice.filter(d => !d.removed);
    _renderer.render(_scene, _camera);
  }
  requestAnimationFrame(loop);
}

// ── Public API ───────────────────────────────────────────
/**
 * Free-physics roll: run the animation and resolve with the face values
 * that each die physically landed on. No predetermined result — the physics decides.
 * @param {number} dieSides - faces (4, 6, 8, 10, 12, 20)
 * @param {number} count    - how many dice to throw
 * @returns {Promise<number[]>}
 */
export function animateDiceFree(dieSides, count) {
  return new Promise(resolve => {
    const overlay = document.getElementById('dice-overlay');
    if (!overlay) { resolve(Array.from({ length: count }, () => Math.ceil(Math.random() * dieSides))); return; }
    ensureScene(overlay);
    ensureWorld();
    ensureWalls();

    // d100: roll 5 d20 freely — their sum is the result
    if (dieSides === 100) {
      const values = [];
      let lastDie = null;
      for (let i = 0; i < 5; i++) {
        const isLast = i === 4;
        setTimeout(() => {
          const die = spawnState(20, null, {
            freeRoll: true,
            suppressLabel: true,
            onSettled: value => {
              values.push(value);
              if (values.length === 5) {
                const total = values.reduce((a, b) => a + b, 0);
                resolve([total]);
                if (lastDie) {
                  lastDie.suppressLabel = false;
                  lastDie.labelResult   = total;
                  showResult(lastDie);
                }
              }
            },
          });
          if (isLast) lastDie = die;
          _activeDice.push(die);
          startLoop();
        }, i * 180);
      }
      return;
    }

    const results = [];
    function onSettled(value) {
      results.push(value);
      if (results.length === count) resolve(results);
    }

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        _activeDice.push(spawnState(dieSides, null, { freeRoll: true, onSettled }));
        startLoop();
      }, i * 180);
    }
  });
}

/**
 * Animate dice rolling on the map overlay with a predetermined result.
 * Used for observer clients who receive someone else's roll result.
 * d100 spawns 5 d20 dice; the actual result is shown as a label on the last die.
 * @param {number}   dieSides - faces (4, 6, 8, 10, 12, 20, 100)
 * @param {number[]} results  - one result per die
 */
export function animateDice(dieSides, results) {
  const overlay = document.getElementById('dice-overlay');
  if (!overlay) { console.warn('[dice] #dice-overlay not found'); return; }
  ensureScene(overlay);
  ensureWorld();
  ensureWalls();

  if (dieSides === 100) {
    const d100result = results[0];
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        _activeDice.push(spawnState(20, Math.ceil(Math.random() * 20), {
          suppressLabel: i < 4,
          labelResult:   i === 4 ? d100result : null,
        }));
        startLoop();
      }, i * 200);
    }
    return;
  }

  results.forEach((result, i) => {
    setTimeout(() => {
      _activeDice.push(spawnState(dieSides, result));
      startLoop();
    }, i * 180);
  });
}
