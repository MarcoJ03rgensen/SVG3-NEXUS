import SVG3NEXUS from './svg3-nexus-system.js';

async function main() {
  try {
    // Load SVG3 file - creates NEXUS entities automatically
    const system = await SVG3NEXUS.load(
      document.getElementById('canvas'),
      './tree.svg3'
    );

    // Get the camera for interactive controls
    const camera = system.renderer.camera;

    // If a sky HDR exists, try to load and tone-map it into an LDR dataURL for the CSS background
    async function loadAndToneMapHDR(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load HDR');
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);

      // parse header
      let pos = 0;
      const readLine = () => {
        let s = '';
        while (pos < bytes.length) {
          const c = bytes[pos++];
          if (c === 10) break; // \n
          s += String.fromCharCode(c);
        }
        return s;
      };

      // read header lines until empty line
      let line = '';
      let header = '';
      while (true) {
        line = readLine();
        if (line === undefined) break;
        if (line.trim() === '') break;
        header += line + '\n';
      }

      // resolution line expected like: -Y 256 +X 512
      const resLine = readLine();
      const parts = resLine.split(' ');
      let height = 0, width = 0;
      for (let i = 0; i < parts.length; i += 2) {
        const key = parts[i], val = parseInt(parts[i+1]);
        if (!isNaN(val)) {
          if (key === '-Y' || key === '+Y') height = val;
          if (key === '+X' || key === '-X') width = val;
        }
      }

      if (width === 0 || height === 0) throw new Error('Invalid HDR resolution');

      // Prepare float RGB buffer
      const floatPixels = new Float32Array(width * height * 3);

      // Decode RLE-encoded scanlines (Radiance RGBE)
      for (let y = 0; y < height; y++) {
        if (pos + 4 > bytes.length) break;
        const r0 = bytes[pos++], r1 = bytes[pos++], r2 = bytes[pos++], r3 = bytes[pos++];
        if (r0 !== 2 || r1 !== 2) {
          throw new Error('Unsupported HDR format (old RLE)');
        }
        const scanlineWidth = (r2 << 8) | r3;
        if (scanlineWidth !== width) throw new Error('HDR width mismatch');

        const scanR = new Uint8Array(width);
        const scanG = new Uint8Array(width);
        const scanB = new Uint8Array(width);
        const scanE = new Uint8Array(width);

        // read each component's RLE
        for (let comp = 0; comp < 4; comp++) {
          let i = 0;
          while (i < width) {
            const val = bytes[pos++];
            if (val > 128) {
              const count = val - 128;
              const v = bytes[pos++];
              for (let k = 0; k < count; k++) {
                if (comp === 0) scanR[i++] = v;
                else if (comp === 1) scanG[i++] = v;
                else if (comp === 2) scanB[i++] = v;
                else scanE[i++] = v;
              }
            } else {
              if (comp === 0) scanR[i++] = val;
              else if (comp === 1) scanG[i++] = val;
              else if (comp === 2) scanB[i++] = val;
              else scanE[i++] = val;
            }
          }
        }

        // convert scanline to floats
        for (let x = 0; x < width; x++) {
          const e = scanE[x];
          const idx = (y * width + x) * 3;
          if (e === 0) {
            floatPixels[idx] = floatPixels[idx+1] = floatPixels[idx+2] = 0;
          } else {
            const f = Math.pow(2.0, e - (128 + 8));
            floatPixels[idx]   = scanR[x] * f;
            floatPixels[idx+1] = scanG[x] * f;
            floatPixels[idx+2] = scanB[x] * f;
          }
        }
      }

      // Tone map & convert to LDR ImageData
      const exposure = 0.6;
      const outCanvas = document.createElement('canvas');
      outCanvas.width = width; outCanvas.height = height;
      const ctx = outCanvas.getContext('2d');
      const img = ctx.createImageData(width, height);

      for (let i = 0; i < width * height; i++) {
        const r = floatPixels[i*3] * exposure;
        const g = floatPixels[i*3+1] * exposure;
        const b = floatPixels[i*3+2] * exposure;
        // simple Reinhard tonemap
        const rr = r / (1 + r);
        const gg = g / (1 + g);
        const bb = b / (1 + b);
        img.data[i*4] = Math.max(0, Math.min(255, Math.floor(rr * 255)));
        img.data[i*4+1] = Math.max(0, Math.min(255, Math.floor(gg * 255)));
        img.data[i*4+2] = Math.max(0, Math.min(255, Math.floor(bb * 255)));
        img.data[i*4+3] = 255;
      }

      ctx.putImageData(img, 0, 0);
      return outCanvas.toDataURL('image/png');
    }

    (async () => {
      // Prefer a pre-converted PNG sky if present
      const pngSky = './sunflowers_puresky_2k.png';
      // Helper: create a sphere geometry with uvs for the sky
      function createSphereGeometry(radius = 1, segments = 32) {
        const vertices = [];
        const uvs = [];
        const indices = [];

        for (let lat = 0; lat <= segments; lat++) {
          const theta = (lat * Math.PI) / segments;
          const sinTheta = Math.sin(theta);
          const cosTheta = Math.cos(theta);

          for (let lon = 0; lon <= segments; lon++) {
            const phi = (lon * 2 * Math.PI) / segments;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);

            const x = radius * cosPhi * sinTheta;
            const y = radius * cosTheta;
            const z = radius * sinPhi * sinTheta;

            vertices.push(x, y, z);
            // u: longitude, v: latitude
            uvs.push(lon / segments, 1 - (lat / segments));
          }
        }

        for (let lat = 0; lat < segments; lat++) {
          for (let lon = 0; lon < segments; lon++) {
            const first = lat * (segments + 1) + lon;
            const second = first + segments + 1;

            // note: winding order kept consistent
            indices.push(first, second, first + 1);
            indices.push(second, second + 1, first + 1);
          }
        }

        return {
          vertices: new Float32Array(vertices),
          indices: new Uint16Array(indices),
          uvs: new Float32Array(uvs)
        };
      }

      try {
        // Try to load the PNG sky and use it as an in-scene textured sky
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          // load from same origin; avoid forcing crossOrigin which can cause failures
          i.onload = () => resolve(i);
          i.onerror = (err) => reject(new Error('PNG not found: ' + err));
          i.src = pngSky + '?_=' + Date.now();
        });

        // Also set CSS background as a quick visible fallback (helps if GL upload fails)
        try { document.getElementById('canvas').style.backgroundImage = `url('${pngSky}?_=${Date.now()}')`; } catch (bgErr) {}
        console.log('Loaded PNG sky:', pngSky);

        // Create sphere geometry with UVs and register it
        const sphere = createSphereGeometry(1, 48);
        const geomId = system.geometryLibrary.addGeometry('sky_sphere', sphere.vertices, sphere.indices, sphere.uvs);

        // Create an entity for the sky and assign the texture image to its material
        const world = system.world;
        const skyEntity = world.createEntity();
        world.addComponent(skyEntity, 'transform', new SVG3NEXUS.Transform(0, 0, 0));
        world.addComponent(skyEntity, 'mesh', new SVG3NEXUS.Mesh(geomId, null));
        const skyMat = new SVG3NEXUS.Material([1,1,1], { doubleSided: true });
        skyMat.isSky = true;
        skyMat.isGrass = false;
        skyMat.opacity = 1.0;
        skyMat.textureImage = img;
        world.addComponent(skyEntity, 'material', skyMat);

        // Make GL canvas clear transparent so sky behind shows through if any
        if (system.renderer && system.renderer.gl) system.renderer.gl.clearColor(0.0,0.0,0.0,0.0);
      } catch (err) {
        // PNG not available — fall back to HDR tonemapping below
      }

      try {
        const hdrPath = './kloofendal_48d_partly_cloudy_puresky_1k.hdr';
        const dataUrl = await loadAndToneMapHDR(hdrPath);
        // Create an Image from the tonemapped data URL and use as sky texture
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error('Failed to load tonemapped HDR data URL'));
          i.src = dataUrl;
        });

        // Register geometry and create sky entity similar to PNG flow
        const sphere = (function createSphereGeometry(radius = 1, segments = 48) {
          const vertices = [];
          const uvs = [];
          const indices = [];

          for (let lat = 0; lat <= segments; lat++) {
            const theta = (lat * Math.PI) / segments;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);

            for (let lon = 0; lon <= segments; lon++) {
              const phi = (lon * 2 * Math.PI) / segments;
              const sinPhi = Math.sin(phi);
              const cosPhi = Math.cos(phi);

              const x = radius * cosPhi * sinTheta;
              const y = radius * cosTheta;
              const z = radius * sinPhi * sinTheta;

              vertices.push(x, y, z);
              uvs.push(lon / segments, 1 - (lat / segments));
            }
          }

          for (let lat = 0; lat < segments; lat++) {
            for (let lon = 0; lon < segments; lon++) {
              const first = lat * (segments + 1) + lon;
              const second = first + segments + 1;
              indices.push(first, second, first + 1);
              indices.push(second, second + 1, first + 1);
            }
          }

          return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices), uvs: new Float32Array(uvs) };
        })();

        const geomId = system.geometryLibrary.addGeometry('sky_sphere_hdr', sphere.vertices, sphere.indices, sphere.uvs);
        const world = system.world;
        const skyEntity = world.createEntity();
        world.addComponent(skyEntity, 'transform', new SVG3NEXUS.Transform(0,0,0));
        world.addComponent(skyEntity, 'mesh', new SVG3NEXUS.Mesh(geomId, null));
        const skyMat = new SVG3NEXUS.Material([1,1,1], { doubleSided: true });
        skyMat.isSky = true;
        skyMat.textureImage = img;
        world.addComponent(skyEntity, 'material', skyMat);

        if (system.renderer && system.renderer.gl) system.renderer.gl.clearColor(0.0,0.0,0.0,0.0);
      } catch (e) {
        // fallback: try to set direct URL (may not render in browser)
        try { document.getElementById('canvas').style.backgroundImage = `url('./kloofendal_48d_partly_cloudy_puresky_1k.hdr')`; } catch (e2) {}
      }
    })();

    // Camera controls state - start from SVG3 camera position
    let isMouseDown = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let cameraDistance = 15; // Match SVG3 camera z position
    let cameraRotationX = 0; // Horizontal rotation
    let cameraRotationY = 0; // Vertical rotation
    // First-person state
    let fpsMode = false;
    let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, moveUp = false, moveDown = false;
    let fpSpeed = 5.0; // meters per second
    let groundTopY = 0;
    // Initialize camera yaw/pitch for first-person (optional)
    camera.yaw = 0;
    camera.pitch = 0;
    // physics state for player
    camera.velocity = camera.velocity || [0, 0, 0];
    let grounded = false;
    // make the player slightly smaller to emphasize tree size
    const eyeHeight = 1.2; // player eye height when in first-person (reduced)

    // Mouse event handlers for camera controls
    const canvas = document.getElementById('canvas');

    canvas.addEventListener('mousedown', (e) => {
      isMouseDown = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    });

    canvas.addEventListener('mouseup', () => {
      isMouseDown = false;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!isMouseDown) return;

      const deltaX = e.clientX - lastMouseX;
      const deltaY = e.clientY - lastMouseY;

      // Rotate camera
      cameraRotationX += deltaX * 0.01;
      cameraRotationY += deltaY * 0.01;

      // Limit vertical rotation to prevent flipping
      cameraRotationY = Math.max(-Math.PI/2, Math.min(Math.PI/2, cameraRotationY));

      lastMouseX = e.clientX;
      lastMouseY = e.clientY;

      updateCameraPosition();
    });

    // Pointer-lock mouse look for FPS mode
    function onPointerMove(e) {
      if (!fpsMode) return;
      const movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
      const movementY = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
      const sensitivity = 0.0025;
      // Standard mapping: moving mouse right increases yaw, moving mouse down increases pitch downward
      camera.yaw += movementX * sensitivity;
      camera.pitch -= movementY * sensitivity;
      camera.pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, camera.pitch));
    }

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked) {
        fpsMode = false;
        console.log('Exited first-person mode');
      } else {
        // Entered pointer lock -> enable FPS and snap to ground
        fpsMode = true;
        // snap camera Y to ground top + eye height
        if (typeof groundTopY === 'number') {
          camera.position[1] = groundTopY + eyeHeight;
        }
        console.log('Entered first-person mode (pointer locked)');
      }
    });
    document.addEventListener('mousemove', onPointerMove);

    // Mouse wheel for zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      cameraDistance += e.deltaY * 0.01;
      // Limit zoom distance
      cameraDistance = Math.max(5, Math.min(100, cameraDistance));
      updateCameraPosition();
    });

    // Touch events for mobile
    let lastTouchDistance = 0;

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        // Single touch - rotation
        isMouseDown = true;
        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        // Two touches - zoom
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        lastTouchDistance = Math.sqrt(
          Math.pow(touch2.clientX - touch1.clientX, 2) +
          Math.pow(touch2.clientY - touch1.clientY, 2)
        );
      }
    });

    canvas.addEventListener('touchend', () => {
      isMouseDown = false;
    });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();

      if (e.touches.length === 1 && isMouseDown) {
        // Single touch rotation
        const deltaX = e.touches[0].clientX - lastMouseX;
        const deltaY = e.touches[0].clientY - lastMouseY;

        cameraRotationX += deltaX * 0.01;
        cameraRotationY += deltaY * 0.01;
        cameraRotationY = Math.max(-Math.PI/2, Math.min(Math.PI/2, cameraRotationY));

        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;

        updateCameraPosition();
      } else if (e.touches.length === 2) {
        // Two touch zoom
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const currentDistance = Math.sqrt(
          Math.pow(touch2.clientX - touch1.clientX, 2) +
          Math.pow(touch2.clientY - touch1.clientY, 2)
        );

        if (lastTouchDistance > 0) {
          const delta = currentDistance - lastTouchDistance;
          cameraDistance -= delta * 0.01;
          cameraDistance = Math.max(5, Math.min(100, cameraDistance));
          updateCameraPosition();
        }

        lastTouchDistance = currentDistance;
      }
    });

    // Initialize camera position to match SVG3 camera
    function updateCameraPosition() {
      const x = Math.sin(cameraRotationX) * Math.cos(cameraRotationY) * cameraDistance;
      const y = Math.sin(cameraRotationY) * cameraDistance + 6; // +6 to match SVG3 camera height
      const z = Math.cos(cameraRotationX) * Math.cos(cameraRotationY) * cameraDistance;

      camera.position[0] = x;
      camera.position[1] = y;
      camera.position[2] = z;

      // Also update camera yaw/pitch so switching to FPS feels continuous
      camera.yaw = cameraRotationX;
      camera.pitch = cameraRotationY - 0.1;
    }

    // Set initial camera position (no rotation)
    updateCameraPosition();

    // Create a flat green ground under the scene so models stand on it
    try {
      const geomLib = system.geometryLibrary;
      const world = system.world;

      let globalMinY = Infinity;
      let globalMinX = Infinity, globalMinZ = Infinity;
      let globalMaxX = -Infinity, globalMaxZ = -Infinity, globalMaxY = -Infinity;

      // helper: apply a single entity's local transform to a point
      // transform order: scale -> rotationZ -> rotationY -> rotationX -> translate
      const applyLocalTransform = (tr, p) => {
        let x = p[0] * (tr.scale[0] || 1);
        let y = p[1] * (tr.scale[1] || 1);
        let z = p[2] * (tr.scale[2] || 1);

        const rz = (tr.rotation[2] || 0);
        if (rz !== 0) {
          const c = Math.cos(rz), s = Math.sin(rz);
          const nx = c * x - s * y;
          const ny = s * x + c * y;
          x = nx; y = ny;
        }

        const ry = (tr.rotation[1] || 0);
        if (ry !== 0) {
          const c = Math.cos(ry), s = Math.sin(ry);
          const nx = c * x + s * z;
          const nz = -s * x + c * z;
          x = nx; z = nz;
        }

        const rx = (tr.rotation[0] || 0);
        if (rx !== 0) {
          const c = Math.cos(rx), s = Math.sin(rx);
          const ny = c * y - s * z;
          const nz = s * y + c * z;
          y = ny; z = nz;
        }

        // translate
        x += (tr.position[0] || 0);
        y += (tr.position[1] || 0);
        z += (tr.position[2] || 0);

        return [x, y, z];
      };

      const renderables = world.query(['transform', 'mesh']);
      for (const e of renderables.entities) {
        const mesh = e.getComponent('mesh');
        const transform = e.getComponent('transform');
        if (!mesh || !mesh.geometryId || !transform) continue;

        const geom = geomLib.getGeometry(mesh.geometryId);
        if (!geom || !geom.vertices) continue;

        // compute world-space position for each vertex by applying local+parent transforms
        const verts = geom.vertices;
        for (let i = 0; i < verts.length; i += 3) {
          let p = [verts[i], verts[i+1], verts[i+2]];
          // apply local transform
          p = applyLocalTransform(transform, p);

          // apply parent chain
          let parentId = transform.parent;
          while (parentId) {
            const parent = world.getEntity(parentId);
            if (!parent) break;
            const pt = parent.getComponent('transform');
            if (!pt) break;
            p = applyLocalTransform(pt, p);
            parentId = pt.parent;
          }

          const wx = p[0], wy = p[1], wz = p[2];
          if (wy < globalMinY) globalMinY = wy;
          if (wx < globalMinX) globalMinX = wx;
          if (wz < globalMinZ) globalMinZ = wz;
          if (wx > globalMaxX) globalMaxX = wx;
          if (wy > globalMaxY) globalMaxY = wy;
          if (wz > globalMaxZ) globalMaxZ = wz;
        }
      }

      if (globalMinY === Infinity) {
        globalMinY = 0;
        globalMinX = 0; globalMinZ = 0; globalMaxX = 0; globalMaxY = 0; globalMaxZ = 0;
      }

      // Compute scene center from bounds
      const centerX = (globalMinX + globalMaxX) / 2;
      const centerY = (globalMinY + globalMaxY) / 2;
      const centerZ = (globalMinZ + globalMaxZ) / 2;

      // Create a large, thin box as ground centered so its TOP equals the computed minimum Y
      const groundThickness = 0.02;
      const groundHalf = groundThickness / 2;
      const groundGeomId = geomLib.createBox('ground-geom', 100, groundThickness, 100);
      const groundEntity = world.createEntity();
      // place box center so its top equals globalMinY -> centerY = globalMinY - halfHeight
      const groundCenterY = globalMinY - groundHalf;
      // position ground centered horizontally on scene bounds
      world.addComponent(groundEntity, 'transform', new SVG3NEXUS.Transform(centerX, groundCenterY, centerZ));
      // record the world-space top Y of the ground so we can position the player
      groundTopY = globalMinY;
      const groundMesh = new SVG3NEXUS.Mesh(groundGeomId, null);
      groundMesh.visible = true;
      world.addComponent(groundEntity, 'mesh', groundMesh);
      // make the ground color a bit brighter and give a touch of emissive so it's visible in low light
      // mark doubleSided = true to avoid top-face being culled if winding is inverted
      world.addComponent(groundEntity, 'material', new SVG3NEXUS.Material([0.12, 0.6, 0.12], { roughness: 1.0, metalness: 0, emissive: [0.02, 0.06, 0.02], emissiveIntensity: 0.3, isGrass: true, doubleSided: true }));
      // mark ground as effectively immovable (very large mass)
      world.addComponent(groundEntity, 'rigidbody', { mass: 1e9, static: true });
      console.log('Ground created at topY=', groundTopY, 'centerY=', groundCenterY);

      // Create projected shadows by projecting each mesh's world-space vertices onto the ground along the renderer light direction
      try {
        const lightPos = system.renderer.light.position || [3, 3, 3];
        // projection direction (from surface toward ground) — use negative light position as directional light
        let D = [-lightPos[0], -lightPos[1], -lightPos[2]];
        const dlen = Math.sqrt(D[0]*D[0] + D[1]*D[1] + D[2]*D[2]) || 1;
        D = [D[0]/dlen, D[1]/dlen, D[2]/dlen];

        const renderablesForShadow = world.query(['transform', 'mesh']);
        const combinedVerts = [];
        const combinedIndices = [];
        let indexOffset = 0;

        for (const e of renderablesForShadow.entities) {
          const mesh = e.getComponent('mesh');
          if (!mesh || !mesh.geometryId || mesh.geometryId === groundGeomId) continue;

          const geom = geomLib.getGeometry(mesh.geometryId);
          if (!geom || !geom.vertices) continue;

          const verts = geom.vertices;
          // project each vertex to world-space then onto ground plane
          const projected = [];

          for (let i = 0; i < verts.length; i += 3) {
            let p = [verts[i], verts[i+1], verts[i+2]];
            p = applyLocalTransform(e.getComponent('transform'), p);
            let parentId = e.getComponent('transform').parent;
            while (parentId) {
              const parent = world.getEntity(parentId);
              if (!parent) break;
              const pt = parent.getComponent('transform');
              if (!pt) break;
              p = applyLocalTransform(pt, p);
              parentId = pt.parent;
            }

            let proj;
            if (Math.abs(D[1]) < 1e-6) {
              proj = [p[0], globalMinY, p[2]];
            } else {
              const t = (globalMinY - p[1]) / D[1];
              proj = [p[0] + D[0]*t, p[1] + D[1]*t, p[2] + D[2]*t];
            }
            proj[1] += 0.0005;
            projected.push(proj[0], proj[1], proj[2]);
          }

          // push projected vertices into combined buffer
          combinedVerts.push(...projected);

          // append indices with offset
          const indices = geom.indices instanceof Uint16Array ? Array.from(geom.indices) : Array.from(geom.indices || []);
          for (let k = 0; k < indices.length; k++) {
            combinedIndices.push(indices[k] + indexOffset);
          }

          indexOffset += verts.length / 3;
        }

        if (combinedVerts.length > 0 && combinedIndices.length > 0) {
          const projectedArray = new Float32Array(combinedVerts);
          const indicesArray = new Uint16Array(combinedIndices);
          const shadowGeomId = geomLib.addGeometry('shadow-combined', projectedArray, indicesArray);

          const shadowEntity = world.createEntity();
          world.addComponent(shadowEntity, 'transform', new SVG3NEXUS.Transform(0, 0, 0));
          world.addComponent(shadowEntity, 'mesh', new SVG3NEXUS.Mesh(shadowGeomId, null));
          world.addComponent(shadowEntity, 'material', new SVG3NEXUS.Material([0,0,0], { opacity: 0.85, transparent: true, doubleSided: true, isShadow: true }));
        }

        console.log('Projected shadows (combined) created');
      } catch (e) {
        console.warn('Projected shadow creation failed:', e);
      }

      // Position the camera so it looks at the scene center on spawn
      // Place camera a bit above center and some distance back on Z
      const spawnDistance = Math.max(6, Math.max(globalMaxX - globalMinX, globalMaxZ - globalMinZ));
      camera.position[0] = centerX;
      camera.position[1] = centerY + Math.max(2.0, spawnDistance * 0.3);
      camera.position[2] = centerZ + spawnDistance * 1.2;
      // Compute yaw/pitch so renderer will look at the center
      const dx = centerX - camera.position[0];
      const dy = centerY - camera.position[1];
      const dz = centerZ - camera.position[2];
      const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
      const dirx = dx / len, diry = dy / len, dirz = dz / len;
      camera.yaw = Math.atan2(dirx, dirz);
      camera.pitch = Math.asin(diry);
      // keep orbit controls in sync
      cameraRotationX = camera.yaw;
      cameraRotationY = camera.pitch;
      cameraDistance = len;
    } catch (err) {
      console.warn('Ground creation failed:', err);
    }

    // Start rendering
    // Add FPS update system: moves camera when fpsMode is active
    system.addSystem('fps-controls', (world, dt) => {
      if (!fpsMode) return;
      // compute forward/right vectors from yaw/pitch (horizontal movement only)
      const yaw = camera.yaw || 0;
      const pitch = camera.pitch || 0;
      const forward = [Math.sin(yaw) * Math.cos(pitch), 0, Math.cos(yaw) * Math.cos(pitch)];
      const right = [Math.cos(yaw), 0, -Math.sin(yaw)];

      // horizontal input
      let hx = 0, hz = 0;
      if (moveForward) { hx += forward[0]; hz += forward[2]; }
      if (moveBackward) { hx -= forward[0]; hz -= forward[2]; }
      if (moveLeft) { hx -= right[0]; hz -= right[2]; }
      if (moveRight) { hx += right[0]; hz += right[2]; }

      // normalize horizontal
      const hlen = Math.sqrt(hx*hx + hz*hz) || 1;
      hx /= hlen; hz /= hlen;

      // apply horizontal movement with friction when grounded
      const FRICTION = 6.0; // per-second friction when grounded
      const frictionFactor = grounded ? Math.max(0, 1 - FRICTION * dt) : 1;
      const speed = fpSpeed * frictionFactor * dt;
      camera.position[0] += hx * speed;
      camera.position[2] += hz * speed;

      // gravity integration (simple)
      const GRAVITY = -9.81; // m/s^2
      // if user pressed space while grounded, make a jump impulse
      if (moveUp && grounded) {
        camera.velocity[1] = 5.0; // jump impulse (m/s)
        grounded = false;
        // consume the key so we don't keep jumping
        moveUp = false;
      }

      // apply gravity to vertical velocity
      camera.velocity[1] += GRAVITY * dt;
      // integrate vertical position
      camera.position[1] += camera.velocity[1] * dt;

      // collision with ground: prevent penetration and zero vertical velocity
      const groundY = (typeof groundTopY === 'number') ? groundTopY + eyeHeight : -Infinity;
      if (camera.position[1] <= groundY) {
        camera.position[1] = groundY;
        camera.velocity[1] = 0;
        grounded = true;
      }
    }, 95);

    // Minimal physics system: integrate rigidbodies (non-static) and collide with ground plane
    system.addSystem('physics', (world, dt) => {
      const bodies = world.query(['transform', 'rigidbody']);
      for (const e of bodies.entities) {
        const tr = e.getComponent('transform');
        const rb = e.getComponent('rigidbody');
        if (rb.static) continue;

        rb.velocity = rb.velocity || [0, 0, 0];
        // apply gravity
        rb.velocity[1] += -9.81 * dt;
        // integrate
        tr.position[0] += rb.velocity[0] * dt;
        tr.position[1] += rb.velocity[1] * dt;
        tr.position[2] += rb.velocity[2] * dt;

        // collide with ground (simple plane at groundTopY)
        const groundPlaneY = (typeof groundTopY === 'number') ? groundTopY : -Infinity;
        if (tr.position[1] <= groundPlaneY) {
          tr.position[1] = groundPlaneY;
          rb.velocity[1] = 0;
        }
      }
    }, 80);

    system.start();

    console.log('✅ Tree scene loaded with interactive camera controls!');
    console.log('🖱️  Left click + drag to rotate (orbit)');
    console.log('🔍 Mouse wheel to zoom');
    console.log('📱 Touch to rotate/zoom on mobile');
    console.log('▶ Press F to toggle first-person (pointer lock). WASD to move. Space/C to up/down.');
    console.log(`📊 Entities: ${system.getAllEntities().length}`);

    // Key handlers for FPS toggle and movement
    window.addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === 'F') {
        // toggle FPS by requesting pointer lock
        fpsMode = true;
        canvas.requestPointerLock();
        console.log('Entered first-person mode (pointer locked).');
      }
      if (e.key === 'w' || e.key === 'W') moveForward = true;
      if (e.key === 's' || e.key === 'S') moveBackward = true;
      if (e.key === 'a' || e.key === 'A') moveLeft = true;
      if (e.key === 'd' || e.key === 'D') moveRight = true;
      if (e.code === 'Space') moveUp = true;
      if (e.key === 'c' || e.key === 'C') moveDown = true;
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'w' || e.key === 'W') moveForward = false;
      if (e.key === 's' || e.key === 'S') moveBackward = false;
      if (e.key === 'a' || e.key === 'A') moveLeft = false;
      if (e.key === 'd' || e.key === 'D') moveRight = false;
      if (e.code === 'Space') moveUp = false;
      if (e.key === 'c' || e.key === 'C') moveDown = false;
    });
  } catch (error) {
    console.error('❌ Error loading willow scene:', error);
  }
}

main();