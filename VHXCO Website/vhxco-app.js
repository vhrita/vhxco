/* =============================================================
   VHXCO — Synapse Journey
   Single-file app: Three.js neural core + phase orchestration +
   nodes + data room + form + tweaks + i18n + audio
   ============================================================= */

(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ------- Tweakable defaults (editable via host) -------
  const TWEAKS = /*EDITMODE-BEGIN*/{
    "particleDensity": 2.0,
    "particleSize": 1.0,
    "particleOpacity": 1.0,
    "animSpeed": 0.4,
    "nodeLayout": "triangle",
    "primaryHue": 200,
    "audioOn": false,
    "showHud": true,
    "distortion": 1.0,
    "chroma": 1.0
  }/*EDITMODE-END*/;
  window.VHXCO.tweaks = TWEAKS;

  // ============== 1. CUSTOM CURSOR + TRAIL + RIPPLE ==============
  const cursor = $("#cursor");
  let mx = window.innerWidth / 2, my = window.innerHeight / 2;
  let cx = mx, cy = my;
  let mouseSpeed = 0, prevMx = mx, prevMy = my;
  window.addEventListener("pointermove", e => { mx = e.clientX; my = e.clientY; });
  function tickCursor() {
    const dx = mx - prevMx, dy = my - prevMy;
    mouseSpeed = lerp(mouseSpeed, Math.sqrt(dx * dx + dy * dy), 0.15);
    prevMx = mx; prevMy = my;
    cx = lerp(cx, mx, 0.22); cy = lerp(cy, my, 0.22);
    cursor.style.transform = `translate(${cx}px, ${cy}px)`;
    requestAnimationFrame(tickCursor);
  }
  tickCursor();

  // --- Cursor trail particles (2D canvas) ---
  const trailCanvas = $("#cursorTrail");
  const trailCtx = trailCanvas.getContext("2d");
  const TRAIL_MAX = 60;
  const trailParticles = [];
  function resizeTrail() {
    trailCanvas.width = window.innerWidth * Math.min(window.devicePixelRatio, 2);
    trailCanvas.height = window.innerHeight * Math.min(window.devicePixelRatio, 2);
    trailCanvas.style.width = window.innerWidth + "px";
    trailCanvas.style.height = window.innerHeight + "px";
  }
  resizeTrail();
  window.addEventListener("resize", resizeTrail);

  function spawnTrailParticle() {
    if (mouseSpeed < 1.5) return;
    const count = Math.min(3, Math.floor(mouseSpeed / 8) + 1);
    for (let i = 0; i < count && trailParticles.length < TRAIL_MAX; i++) {
      trailParticles.push({
        x: cx + (Math.random() - 0.5) * 8,
        y: cy + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        life: 1.0,
        size: 1 + Math.random() * 2,
      });
    }
  }
  function tickTrail() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    spawnTrailParticle();
    for (let i = trailParticles.length - 1; i >= 0; i--) {
      const p = trailParticles[i];
      p.x += p.vx; p.y += p.vy;
      p.life -= 0.025;
      if (p.life <= 0) { trailParticles.splice(i, 1); continue; }
      const alpha = p.life * 0.6;
      const sz = p.size * p.life * dpr;
      trailCtx.beginPath();
      trailCtx.arc(p.x * dpr, p.y * dpr, sz, 0, Math.PI * 2);
      const hue = TWEAKS.primaryHue;
      trailCtx.fillStyle = `hsla(${hue}, 80%, 70%, ${alpha})`;
      trailCtx.fill();
      // halo
      trailCtx.beginPath();
      trailCtx.arc(p.x * dpr, p.y * dpr, sz * 3, 0, Math.PI * 2);
      trailCtx.fillStyle = `hsla(${hue}, 80%, 70%, ${alpha * 0.15})`;
      trailCtx.fill();
    }
    requestAnimationFrame(tickTrail);
  }
  tickTrail();

  // --- Click ripple ---
  window.addEventListener("click", e => {
    const ripple = document.createElement("div");
    ripple.className = "click-ripple";
    ripple.style.left = e.clientX + "px";
    ripple.style.top = e.clientY + "px";
    document.body.appendChild(ripple);
    audioPing(660);
    setTimeout(() => ripple.remove(), 750);
  });

  // hover state
  document.addEventListener("pointerover", e => {
    const t = e.target;
    if (t.closest("button, a, input, textarea, .node, .step, .term-options button")) {
      document.body.classList.add("hover-link");
    }
  });
  document.addEventListener("pointerout", e => {
    if (!e.relatedTarget || !e.relatedTarget.closest("button, a, input, textarea, .node, .step, .term-options button")) {
      document.body.classList.remove("hover-link");
    }
  });

  // ============== 2. THREE.JS NEURAL CORE ==============
  const canvas = $("#webgl");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.04);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 0, 14);

  // --- Post-processing (Bloom) ---
  const composer = new THREE.EffectComposer(renderer);
  const renderPass = new THREE.RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new THREE.UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5, // strength
    0.4, // radius
    0.6  // threshold
  );
  composer.addPass(bloomPass);

  // --- Procedural Brain Cloud ---
  function generateBrainCloud() {
    const COUNT = 35000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    const alphas = new Float32Array(COUNT);
    const seeds = new Float32Array(COUNT);

    function hash(n) { return Math.sin(n) * 43758.5453; }
    function noise3D(x, y, z) {
      const p = Math.floor(x) * 17 + Math.floor(y) * 53 + Math.floor(z) * 101;
      return hash(p);
    }

    for (let i = 0; i < COUNT; i++) {
      let x, y, z;
      while (true) {
        x = (Math.random() * 14.0) - 7.0;
        y = (Math.random() * 13.0) - 6.5;
        z = (Math.random() * 10.0) - 5.0;

        // Sagittal Brain Silhouette (Lateral X-Ray)
        let r1 = Math.pow(x / 6.5, 2) + Math.pow((y - 1.0) / 4.5, 2) + Math.pow(z / 5.0, 2); // Cerebrum
        let r2 = Math.pow((x + 2.0) / 5.0, 2) + Math.pow((y + 0.5) / 3.5, 2) + Math.pow(z / 4.0, 2); // Occipital
        let r3 = Math.pow((x + 3.5) / 2.5, 2) + Math.pow((y + 2.5) / 2.0, 2) + Math.pow(z / 2.5, 2); // Cerebellum
        let r4 = Math.pow((x + 1.0) / 1.2, 2) + Math.pow((y + 4.0) / 2.5, 2) + Math.pow(z / 1.2, 2); // Brain Stem

        if (r1 <= 1.0 || r2 <= 1.0 || r3 <= 1.0 || r4 <= 1.0) {
          break;
        }
      }

      let n = noise3D(x * 1.5, y * 1.5, z * 1.5) * 0.4;
      x += n; y += n; z += n;

      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      alphas[i] = 0.5 + Math.random() * 0.5;
      seeds[i] = Math.random() * 100;
    }

    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uHue: { value: TWEAKS.primaryHue / 360 }, uOpacity: { value: 0.9 }, uBootProgress: { value: 0.0 } },
      vertexShader: `
        attribute float aAlpha; attribute float aSeed; varying float vAlpha; varying vec3 vPos; uniform float uTime;
        void main() {
          vAlpha = aAlpha; vPos = position;
          float pulse = sin(uTime * 1.5 + aSeed) * 0.5 + 0.5;
          vAlpha *= (0.6 + pulse * 0.4);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Clamp point size to prevent hardware clipping on Mac/Mobile
          float pSize = (2.5 + pulse) * (250.0 / -mv.z);
          gl_PointSize = clamp(pSize, 1.0, 48.0);
        }`,
      fragmentShader: `
        varying float vAlpha; varying vec3 vPos; uniform float uHue; uniform float uOpacity; uniform float uBootProgress;
        vec3 hsl2rgb(vec3 c) { vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0); return c.z + c.y * (rgb-0.5) * (1.0-abs(2.0*c.z-1.0)); }
        void main() {
          vec2 uv = gl_PointCoord - 0.5; float d = length(uv); if (d > 0.5) discard;
          // Balanced alpha to be visible but not over-saturate
          float bootAlpha = smoothstep(0.8, 0.9, uBootProgress); float alpha = smoothstep(0.5, 0.1, d) * vAlpha * uOpacity * 0.5 * bootAlpha;
          float rim = smoothstep(2.0, 6.0, length(vPos.xy));
          vec3 col = hsl2rgb(vec3(uHue, 0.8, 0.2 + rim * 0.2));
          gl_FragColor = vec4(col, alpha);
        }`
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    window.brainCloudMat = mat; return { points, geo, mat };
  }

  const brainCloud = generateBrainCloud();
  scene.add(brainCloud.points);

  // --- Neural Graph (Active Neurons, Neurogénese, Pruning) ---
  function makeNeuralNetwork() {
    const MAX_NEURONS = 200;
    const MAX_SYNAPSES = 15; // Strict limit to prevent visual overload
    const neurons = [];
    const staticEdges = [];

    // 1. GENERATE NEURONS
    for (let i = 0; i < MAX_NEURONS; i++) {
      let x, y, z;
      while (true) {
        x = (Math.random() * 12.0) - 6.0;
        y = (Math.random() * 11.0) - 5.5;
        z = (Math.random() * 8.0) - 4.0;

        let r1 = Math.pow(x / 5.5, 2) + Math.pow((y - 1.0) / 3.5, 2) + Math.pow(z / 4.0, 2);
        let r2 = Math.pow((x + 2.0) / 4.0, 2) + Math.pow((y + 0.5) / 2.5, 2) + Math.pow(z / 3.0, 2);
        let r3 = Math.pow((x + 3.5) / 2.0, 2) + Math.pow((y + 2.5) / 1.5, 2) + Math.pow(z / 2.0, 2);
        let r4 = Math.pow((x + 1.0) / 1.0, 2) + Math.pow((y + 4.0) / 2.0, 2) + Math.pow(z / 1.0, 2);

        if (r1 <= 1.0 || r2 <= 1.0 || r3 <= 1.0 || r4 <= 1.0) break;
      }

      neurons.push({
        id: i, x, y, z,
        firingRate: Math.random() * 0.5 + 0.1,
        lastFire: Math.random() * -5,
        baseSeed: Math.random() * 100
      });
    }

    // 2. GENERATE STATIC AXON WEB (Nearest Neighbors)
    for (let i = 0; i < MAX_NEURONS; i++) {
      const nA = neurons[i];
      const neighbors = neurons
        .filter(nB => nB.id !== nA.id)
        .map(nB => ({ nB, d: Math.hypot(nA.x - nB.x, nA.y - nB.y, nA.z - nB.z) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3); // Connect to 3 nearest

      neighbors.forEach(nn => {
        // Prevent duplicate undirected edges
        if (!staticEdges.find(e => (e.nA === nA && e.nB === nn.nB) || (e.nA === nn.nB && e.nB === nA))) {
          staticEdges.push({ nA, nB: nn.nB, dist: nn.d });
        }
      });
    }

    // 3. 3D SOMAS (CELL BODIES)
    const somaGeo = new THREE.IcosahedronGeometry(0.12, 4); // High detail for displacement
    const somaGeoInst = new THREE.InstancedBufferGeometry().copy(somaGeo);
    somaGeoInst.instanceCount = MAX_NEURONS;

    const somaEnergy = new Float32Array(MAX_NEURONS); // Glow intensity (0 to 1)
    const somaSeed = new Float32Array(MAX_NEURONS);
    const somaBirth = new Float32Array(MAX_NEURONS);
    for (let i = 0; i < MAX_NEURONS; i++) { somaSeed[i] = neurons[i].baseSeed; somaBirth[i] = (i < 2) ? 0.0 : 0.85; }

    const attrSomaEnergy = new THREE.InstancedBufferAttribute(somaEnergy, 1);
    somaGeoInst.setAttribute('aEnergy', attrSomaEnergy);
    somaGeoInst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(somaSeed, 1));
    somaGeoInst.setAttribute('aBirth', new THREE.InstancedBufferAttribute(somaBirth, 1));

    const somaMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: true, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uHue: { value: TWEAKS.primaryHue / 360 }, uBootProgress: { value: 0.0 } },
      vertexShader: `
        attribute float aEnergy; attribute float aSeed; attribute float aBirth; uniform float uBootProgress;
        varying vec3 vNormal; varying vec3 vViewPosition; varying float vEnergy;
        uniform float uTime;
        
        // 3D Noise for organic soma displacement
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        float snoise(vec3 v) {
          const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
          const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
          vec3 i  = floor(v + dot(v, C.yyy) );
          vec3 x0 = v - i + dot(i, C.xxx) ;
          vec3 g = step(x0.yzx, x0.xyz);
          vec3 l = 1.0 - g;
          vec3 i1 = min( g.xyz, l.zxy );
          vec3 i2 = max( g.xyz, l.zxy );
          vec3 x1 = x0 - i1 + C.xxx;
          vec3 x2 = x0 - i2 + C.yyy;
          vec3 x3 = x0 - D.yyy;
          i = mod289(i);
          vec4 p = permute( permute( permute(
                     i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                   + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
                   + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
          float n_ = 0.142857142857;
          vec3  ns = n_ * D.wyz - D.xzx;
          vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
          vec4 x_ = floor(j * ns.z);
          vec4 y_ = floor(j - 7.0 * x_ );
          vec4 x = x_ *ns.x + ns.yyyy;
          vec4 y = y_ *ns.x + ns.yyyy;
          vec4 h = 1.0 - abs(x) - abs(y);
          vec4 b0 = vec4( x.xy, y.xy );
          vec4 b1 = vec4( x.zw, y.zw );
          vec4 s0 = floor(b0)*2.0 + 1.0;
          vec4 s1 = floor(b1)*2.0 + 1.0;
          vec4 sh = -step(h, vec4(0.0));
          vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
          vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
          vec3 p0 = vec3(a0.xy,h.x);
          vec3 p1 = vec3(a0.zw,h.y);
          vec3 p2 = vec3(a1.xy,h.z);
          vec3 p3 = vec3(a1.zw,h.w);
          vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
          p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
          vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
          m = m * m;
          return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
        }

        void main() {
          vEnergy = aEnergy;
          vec3 pos = position;
          // World position of this instance for stable noise
          vec4 worldInstance = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          
          float noise = snoise(pos * 5.0 + uTime + aSeed + worldInstance.xyz);
          pos += normal * noise * 0.04; // Bumpy surface
          
          vNormal = normalMatrix * mat3(instanceMatrix) * normal;
          float scale = smoothstep(aBirth, aBirth + 0.05, uBootProgress);
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos * scale, 1.0);
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vViewPosition; varying float vEnergy;
        uniform float uHue;
        vec3 hsl2rgb(vec3 c) { vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0); return c.z + c.y * (rgb-0.5) * (1.0-abs(2.0*c.z-1.0)); }
        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);
          // Fresnel effect (glow on edges)
          float fresnel = dot(viewDir, normal);
          fresnel = clamp(1.0 - fresnel, 0.0, 1.0);
          fresnel = pow(fresnel, 2.0);
          
          // Base soma color (Cyan)
          vec3 baseColor = hsl2rgb(vec3(uHue, 0.9, 0.2 + fresnel * 0.4));
          // Red pulse when firing
          vec3 fireColor = vec3(1.0, 0.2, 0.3) * 5.0; // Bright pink/red
          vec3 col = mix(baseColor, fireColor, vEnergy);
          
          gl_FragColor = vec4(col, 0.8 + vEnergy * 0.2);
        }`
    });

    const somas = new THREE.InstancedMesh(somaGeoInst, somaMat, MAX_NEURONS);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < MAX_NEURONS; i++) {
      dummy.position.set(neurons[i].x, neurons[i].y, neurons[i].z);
      // Random scale for variation
      const s = 0.6 + Math.random() * 0.6;
      dummy.scale.set(s, s, s);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      dummy.updateMatrix();
      somas.setMatrixAt(i, dummy.matrix);
    }
    scene.add(somas);


    // 4. PERSISTENT AXON WEB (Static Instanced Tubes)
    const tubeGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6, 12);
    tubeGeo.translate(0, 0.5, 0);
    tubeGeo.rotateX(Math.PI / 2);

    const numEdges = staticEdges.length;
    const tubeGeoInst = new THREE.InstancedBufferGeometry().copy(tubeGeo);
    tubeGeoInst.instanceCount = numEdges;

    const tubeSeed = new Float32Array(numEdges);
    for (let i = 0; i < numEdges; i++) tubeSeed[i] = Math.random() * 100.0;
    tubeGeoInst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(tubeSeed, 1));

    const webMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uHue: { value: TWEAKS.primaryHue / 360 }, uBootProgress: { value: 0.0 } },
      vertexShader: `
        attribute float aSeed; varying float vZ; varying float vSeed;
        uniform float uTime;
        void main() {
          vZ = position.z; vSeed = aSeed;
          vec3 pos = position;
          // Static wavy distortion to look like organic tubes
          float waveX = sin(pos.z * 15.0 + aSeed) * 0.05;
          float waveY = cos(pos.z * 12.0 + aSeed * 2.0) * 0.05;
          // Thin out the middle slightly
          float thickness = 1.0 - sin(pos.z * 3.1415) * 0.4;
          pos.x = pos.x * thickness + waveX;
          pos.y = pos.y * thickness + waveY;
          
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: `
        varying float vZ; varying float vSeed; uniform float uHue; uniform float uBootProgress;
        vec3 hsl2rgb(vec3 c) { vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0); return c.z + c.y * (rgb-0.5) * (1.0-abs(2.0*c.z-1.0)); }
        void main() {
          // Semi-transparent deep cyan, much brighter than before
          vec3 col = hsl2rgb(vec3(uHue, 0.9, 0.25));
          float tex = sin(vZ * 40.0 + vSeed) * 0.5 + 0.5;
          col *= (0.7 + tex * 0.3); // Add subtle fibrous texture
          
          // Fade at ends so it blends into somas
          float edgeFade = smoothstep(0.0, 0.1, vZ) * smoothstep(1.0, 0.9, vZ);
          float bootAlpha = smoothstep(0.85, 0.95, uBootProgress);
          gl_FragColor = vec4(col, 0.6 * edgeFade * bootAlpha);
        }`
    });

    const web = new THREE.InstancedMesh(tubeGeoInst, webMat, numEdges);
    for (let i = 0; i < numEdges; i++) {
      const e = staticEdges[i];
      dummy.position.set(e.nA.x, e.nA.y, e.nA.z);
      dummy.lookAt(e.nB.x, e.nB.y, e.nB.z);
      dummy.scale.set(1, 1, e.dist);
      dummy.updateMatrix();
      web.setMatrixAt(i, dummy.matrix);
    }
    scene.add(web);
    window.somaMat = somaMat;
    window.webMat = webMat;


    // 5. TRAVELING SYNAPSE PULSES
    const synapses = [];
    const pulseGeo = new THREE.IcosahedronGeometry(0.04, 2);
    const pulseGeoInst = new THREE.InstancedBufferGeometry().copy(pulseGeo);
    pulseGeoInst.instanceCount = MAX_SYNAPSES;

    const pulseMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        void main() {
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: `
        void main() {
          // Bright neon red/pink core
          gl_FragColor = vec4(1.0, 0.2, 0.4, 1.0) * 8.0;
        }`
    });

    const pulses = new THREE.InstancedMesh(pulseGeoInst, pulseMat, MAX_SYNAPSES);
    pulses.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(pulses);

    const dummyPulse = new THREE.Object3D();

    function update(t, dt) {
      // 1. Spawning Synapses
      // We randomly pick a neuron to fire if we are below MAX_SYNAPSES
      if (synapses.length < MAX_SYNAPSES && Math.random() < 0.1) {
        // Find a random neuron that hasn't fired recently
        const nA = neurons[Math.floor(Math.random() * MAX_NEURONS)];
        if (t - nA.lastFire > 2.0) {
          // Find connected neighbors
          const connectedEdges = staticEdges.filter(e => e.nA === nA || e.nB === nA);
          if (connectedEdges.length > 0) {
            const edge = connectedEdges[Math.floor(Math.random() * connectedEdges.length)];
            const nB = edge.nA === nA ? edge.nB : edge.nA;
            synapses.push({ nA, nB, progress: 0, speed: 0.8 + Math.random() * 0.5 });
            nA.lastFire = t;

            if (TWEAKS.audioOn && getAudio() && Math.random() < 0.2) {
              const o = getAudio().createOscillator(), g = getAudio().createGain();
              o.type = "sine"; o.frequency.value = 1500 + Math.random() * 2000;
              g.gain.value = 0.0; o.connect(g); g.connect(getAudio().destination);
              const tt = getAudio().currentTime;
              g.gain.setValueAtTime(0, tt);
              g.gain.linearRampToValueAtTime(0.02, tt + 0.01);
              g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.15);
              o.start(tt); o.stop(tt + 0.2);
            }
          }
        }
      }

      // 2. Update Neurons (Soma Energy)
      for (let i = 0; i < MAX_NEURONS; i++) {
        const n = neurons[i];
        // Soma glows brightly exactly when it fires, then decays
        const timeSinceFire = t - n.lastFire;
        let energy = 0;
        if (timeSinceFire < 0.5) {
          energy = 1.0 - (timeSinceFire / 0.5); // decay over 0.5s
        }
        somaEnergy[i] = energy;
      }
      attrSomaEnergy.needsUpdate = true;

      // 3. Update Traveling Pulses
      for (let i = synapses.length - 1; i >= 0; i--) {
        const syn = synapses[i];
        syn.progress += dt * syn.speed;

        if (syn.progress >= 1.0) {
          // Reached destination, spark nB slightly
          syn.nB.lastFire = t;
          synapses.splice(i, 1);
        }
      }

      // Rebuild pulse matrices
      let numActivePulses = 0;
      for (let i = 0; i < synapses.length; i++) {
        const syn = synapses[i];
        const pA = syn.nA;
        const pB = syn.nB;
        // Interpolate position
        const lx = pA.x + (pB.x - pA.x) * syn.progress;
        const ly = pA.y + (pB.y - pA.y) * syn.progress;
        const lz = pA.z + (pB.z - pA.z) * syn.progress;

        dummyPulse.position.set(lx, ly, lz);

        // Add tiny wobble to pulse so it follows the wavy tube vaguely
        const waveX = Math.sin(syn.progress * 15.0) * 0.05;
        dummyPulse.position.x += waveX;

        dummyPulse.updateMatrix();
        pulses.setMatrixAt(i, dummyPulse.matrix);
        numActivePulses++;
      }

      pulses.instanceCount = numActivePulses;
      if (numActivePulses > 0) pulses.instanceMatrix.needsUpdate = true;

      somaMat.uniforms.uTime.value = t;
      webMat.uniforms.uTime.value = t;

      // FIX: Feed the boot progress and hue into the 3D neuron shaders
      somaMat.uniforms.uBootProgress.value = window.bootProgress;
      webMat.uniforms.uBootProgress.value = window.bootProgress;
      somaMat.uniforms.uHue.value = TWEAKS.primaryHue / 360;
      webMat.uniforms.uHue.value = TWEAKS.primaryHue / 360;
    }

    return { update }; // Export update
  }

  const network = makeNeuralNetwork();

  // --- Helpers for Raycaster ---
  const mouseN = new THREE.Vector2();
  window.addEventListener("pointermove", e => {
    mouseN.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouseN.y = -((e.clientY / window.innerHeight) * 2 - 1);
  });

  // ============== 3. PHASE / SCROLL ORCHESTRATION ==============
  // Virtual scroll progress 0..1 across 4 phases
  // Each phase = 0.25 of progress
  const PHASES = ["core", "branches", "proof", "diagnose"];
  let progress = 0;       // 0..1
  let targetProgress = 0;
  const PHASE_COUNT = 4;

  function progressToPhase(p) {
    return Math.min(PHASE_COUNT - 1, Math.floor(p * PHASE_COUNT * 0.999));
  }

  // Wheel + touch
  let wheelAccum = 0;
  window.addEventListener("wheel", e => {
    e.preventDefault();
    targetProgress = clamp(targetProgress + e.deltaY * 0.00038, 0, 1);
  }, { passive: false });

  let touchY = null;
  window.addEventListener("touchstart", e => { touchY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener("touchmove", e => {
    if (touchY == null) return;
    const dy = touchY - e.touches[0].clientY;
    targetProgress = clamp(targetProgress + dy * 0.001, 0, 1);
    touchY = e.touches[0].clientY;
  }, { passive: true });

  // Keyboard arrows
  window.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
      targetProgress = clamp(targetProgress + 0.06, 0, 1);
    } else if (e.key === "ArrowUp" || e.key === "PageUp") {
      targetProgress = clamp(targetProgress - 0.06, 0, 1);
    } else if (e.key >= "1" && e.key <= "4") {
      goToPhase(parseInt(e.key, 10) - 1);
    }
  });

  function goToPhase(idx) {
    targetProgress = (idx + 0.15) / PHASE_COUNT;
  }

  // Nav chapter buttons
  $$("#navChapters button").forEach(b => {
    b.addEventListener("click", () => goToPhase(parseInt(b.dataset.phase, 10)));
  });
  $$("#rail .step").forEach(b => {
    b.addEventListener("click", () => goToPhase(parseInt(b.dataset.phase, 10)));
  });

  // ============== 4. NODES (HTML) ==============
  const NODE_DATA = () => {
    const d = window.VHXCO.i18n[window.VHXCO.lang];
    return [
      { num: d.n1n, title: d.n1t, desc: d.n1d, stack: ["LLM", "AGENTIC", "RAG", "AGNO"], glyph: "intelligence" },
      { num: d.n2n, title: d.n2t, desc: d.n2d, stack: ["NEXT.JS", "SUPABASE", "EDGE", "TS"], glyph: "structure" },
      { num: d.n3n, title: d.n3t, desc: d.n3d, stack: ["MQTT", "ESP32", "LORA", "EDGE.AI"], glyph: "presence" },
    ];
  };

  function glyphSvg(kind) {
    if (kind === "intelligence") {
      // neural fan
      return `<svg viewBox="0 0 100 100">
        <g fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.6">
          <circle cx="50" cy="50" r="34"/>
          <circle cx="50" cy="50" r="22"/>
        </g>
        <g class="glyph-fg" fill="#5eeaff">
          <circle cx="50" cy="50" r="4"/>
          ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
        const a = i * Math.PI / 4;
        const x = 50 + Math.cos(a) * 34;
        const y = 50 + Math.sin(a) * 34;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6"/>`;
      }).join("")}
        </g>
        <g stroke="rgba(94,234,255,0.5)" stroke-width="0.4" fill="none">
          ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
        const a = i * Math.PI / 4;
        const x = 50 + Math.cos(a) * 34;
        const y = 50 + Math.sin(a) * 34;
        return `<line x1="50" y1="50" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
      }).join("")}
        </g>
      </svg>`;
    }
    if (kind === "structure") {
      // nested squares
      return `<svg viewBox="0 0 100 100">
        <g fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.6">
          <rect x="20" y="20" width="60" height="60" transform="rotate(0 50 50)"/>
          <rect x="28" y="28" width="44" height="44" transform="rotate(15 50 50)"/>
          <rect x="36" y="36" width="28" height="28" transform="rotate(30 50 50)"/>
        </g>
        <g class="glyph-fg" fill="#5eeaff">
          <rect x="46" y="46" width="8" height="8" transform="rotate(45 50 50)"/>
        </g>
      </svg>`;
    }
    // presence — circuit
    return `<svg viewBox="0 0 100 100">
      <g fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.6">
        <path d="M10,50 H30 V20 H50 V50 H70 V80 H90"/>
        <path d="M50,10 V35 H75 V60 H35 V90"/>
      </g>
      <g class="glyph-fg" fill="#5eeaff">
        <circle cx="30" cy="20" r="2"/>
        <circle cx="50" cy="50" r="3"/>
        <circle cx="70" cy="80" r="2"/>
        <circle cx="35" cy="60" r="2"/>
        <circle cx="75" cy="35" r="2"/>
      </g>
      <g fill="none" stroke="rgba(94,234,255,0.6)" stroke-width="0.4">
        <circle cx="50" cy="50" r="14" stroke-dasharray="2 3"/>
      </g>
    </svg>`;
  }

  function renderNodes() {
    const wrap = $("#nodesWrap");
    const data = NODE_DATA();
    wrap.innerHTML = data.map((n, i) => `
      <div class="node" data-idx="${i}">
        <div class="node-glyph">
          <div class="ring-ext"></div>
          ${glyphSvg(n.glyph)}
        </div>
        <div class="node-num">${n.num}</div>
        <h3 class="node-title">${n.title}</h3>
        <div class="node-desc">${n.desc}</div>
        <div class="node-stack">${n.stack.map(s => `<span>${s}</span>`).join("")}</div>
      </div>
    `).join("");
    layoutNodes();
  }

  function layoutNodes() {
    const wrap = $("#nodesWrap");
    const w = wrap.clientWidth || 1000;
    const h = wrap.clientHeight || 500;
    const nodes = $$(".node", wrap);
    const layout = TWEAKS.nodeLayout;
    nodes.forEach((node, i) => {
      let x = 50, y = 50;
      if (layout === "triangle") {
        if (i === 0) { x = 50; y = 22; }
        if (i === 1) { x = 18; y = 78; }
        if (i === 2) { x = 82; y = 78; }
      } else if (layout === "line") {
        x = 16 + i * 34;
        y = 50;
      } else if (layout === "orbital") {
        // animated below — set initial
        x = 50; y = 50;
      }
      node.dataset.tx = x; node.dataset.ty = y;
      node.style.left = x + "%";
      node.style.top = y + "%";
    });
  }

  function tickOrbital(t) {
    if (TWEAKS.nodeLayout !== "orbital") return;
    const wrap = $("#nodesWrap");
    if (!wrap) return;
    const nodes = $$(".node", wrap);
    nodes.forEach((node, i) => {
      const a = t * 0.0003 * TWEAKS.animSpeed + i * (Math.PI * 2 / 3);
      const x = 50 + Math.cos(a) * 32;
      const y = 50 + Math.sin(a) * 32;
      node.style.left = x + "%";
      node.style.top = y + "%";
    });
  }

  // ============== 5. DATA ROOM ==============
  function buildDataRoom() {
    const grid = $("#dataGrid");
    const d = window.VHXCO.i18n[window.VHXCO.lang];
    grid.innerHTML = `
      <div class="cell" style="grid-column: span 1; grid-row: span 2;">
        <span class="corner-tl"></span><span class="corner-tr"></span><span class="corner-bl"></span><span class="corner-br"></span>
        <div class="label"><span>${d.m1l}</span><span class="delta">▲ +18%</span></div>
        <div class="metric-num" data-counter="312" data-suffix="%"><span class="num">0</span><span class="unit">%</span></div>
        <svg class="spark" viewBox="0 0 200 36" preserveAspectRatio="none">
          <path class="fill" d="M0,30 L20,28 L40,24 L60,22 L80,18 L100,20 L120,14 L140,10 L160,8 L180,4 L200,2 L200,36 L0,36 Z"/>
          <path class="line" d="M0,30 L20,28 L40,24 L60,22 L80,18 L100,20 L120,14 L140,10 L160,8 L180,4 L200,2"/>
        </svg>
        <div class="metric-foot">${d.m1f}</div>
      </div>

      <div class="cell">
        <span class="corner-tl"></span><span class="corner-tr"></span><span class="corner-bl"></span><span class="corner-br"></span>
        <div class="label"><span>${d.m2l}</span><span class="delta">▲ ATIVO</span></div>
        <div class="metric-num" data-counter="2840" data-suffix="h"><span class="num">0</span><span class="unit">h</span></div>
        <div class="metric-foot">${d.m2f}</div>
      </div>

      <div class="cell">
        <span class="corner-tl"></span><span class="corner-tr"></span><span class="corner-bl"></span><span class="corner-br"></span>
        <div class="label"><span>${d.m3l}</span><span class="delta">▼ -42%</span></div>
        <div class="metric-num" data-counter="14" data-suffix="d"><span class="num">0</span><span class="unit">d</span></div>
        <div class="metric-foot">${d.m3f}</div>
      </div>

      <div class="cell">
        <span class="corner-tl"></span><span class="corner-tr"></span><span class="corner-bl"></span><span class="corner-br"></span>
        <div class="label"><span>${d.m4l}</span><span class="delta">▲ LIVE</span></div>
        <div class="metric-num" data-counter="47" data-suffix=""><span class="num">0</span></div>
        <div class="metric-foot">${d.m4f}</div>
      </div>

      <div class="cell">
        <span class="corner-tl"></span><span class="corner-tr"></span><span class="corner-bl"></span><span class="corner-br"></span>
        <div class="label"><span>${d.m5l}</span><span class="delta">99.97%</span></div>
        <div class="metric-num" data-counter="9997" data-suffix="" data-divisor="100"><span class="num">0</span><span class="unit">%</span></div>
        <div class="metric-foot">${d.m5f}</div>
      </div>

      <div class="cell" style="grid-column: span 1;">
        <span class="corner-tl"></span><span class="corner-tr"></span><span class="corner-bl"></span><span class="corner-br"></span>
        <div class="label"><span>${d.m6l}</span><span class="delta">▲ +6</span></div>
        <div class="metric-num" data-counter="74" data-suffix=""><span class="num">0</span></div>
        <div class="metric-foot">${d.m6f}</div>
      </div>

      <div class="log">
        <div class="row" style="color: var(--cyan); margin-bottom: 8px;">
          <span>${d.logCol[0]}</span><span>${d.logCol[1]}</span><span>${d.logCol[2]}</span><span style="text-align:right">${d.logCol[3]}</span>
        </div>
        ${window.VHXCO.logRows.map(r => `
          <div class="row">
            <span class="ts">${r[0]}</span><span class="id">${r[1]}</span><span>${r[2]}</span><span class="res">${r[3]}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  let countersAnimated = false;
  function animateCounters() {
    if (countersAnimated) return;
    countersAnimated = true;
    $$(".metric-num").forEach(el => {
      const target = parseFloat(el.dataset.counter);
      const divisor = parseFloat(el.dataset.divisor || "1");
      const numEl = el.querySelector(".num");
      const start = performance.now();
      const dur = 1400;
      function step(t) {
        const k = clamp((t - start) / dur, 0, 1);
        const eased = 1 - Math.pow(1 - k, 3);
        const v = (target * eased) / divisor;
        numEl.textContent = divisor > 1 ? v.toFixed(2) : Math.floor(v).toLocaleString("pt-BR");
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  // ============== 6. FORM ==============
  function bindForm() {
    const form = $("#termForm");
    const opts = $("#bnOpts");
    let selected = null;
    opts.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      $$("button", opts).forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      selected = b.dataset.v;
    });
    form.addEventListener("submit", e => {
      e.preventDefault();
      $("#termOk").classList.add("show");
      audioPing();
      setTimeout(() => form.reset(), 200);
    });
    // Typing sounds on terminal inputs
    $$(".term-input, .term-area", form).forEach(inp => {
      inp.addEventListener("keydown", () => {
        if (!TWEAKS.audioOn) return;
        const freq = 1200 + Math.random() * 600;
        const ctx = getAudio(); if (!ctx) return;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "square"; o.frequency.value = freq;
        g.gain.value = 0; o.connect(g); g.connect(ctx.destination);
        const t = ctx.currentTime;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.012, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        o.start(t); o.stop(t + 0.07);
      });
    });
  }

  // next slot text
  function setNextSlot() {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const day = d.getDate().toString().padStart(2, "0");
    const mo = (d.getMonth() + 1).toString().padStart(2, "0");
    $("#nextSlot").textContent = `${day}/${mo} 14:30`;
  }

  // ============== 6.5 TEXT SCRAMBLE REVEAL ==============
  const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:',.<>?/~`";
  function scrambleReveal(el) {
    if (!el || el.dataset.scrambled === "1") return;
    el.dataset.scrambled = "1";
    const originalHTML = el.innerHTML;
    // Extract text nodes and preserve HTML tags
    const text = el.textContent;
    if (!text.trim()) return;
    const chars = text.split("");
    const totalDur = Math.min(chars.length * 30, 1200);
    const startTime = performance.now();
    let iterations = 0;

    function tick(now) {
      iterations++;
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / totalDur, 1);
      let result = "";
      for (let i = 0; i < chars.length; i++) {
        const charProgress = (progress * chars.length - i) / 3;
        if (chars[i] === " " || chars[i] === "\n") {
          result += chars[i];
        } else if (charProgress >= 1) {
          result += chars[i];
        } else if (charProgress > 0) {
          result += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        } else {
          result += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        }
      }
      el.textContent = result;
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        // Restore original HTML (with <em>, <span> etc)
        el.innerHTML = originalHTML;
      }
    }
    requestAnimationFrame(tick);
  }

  function scramblePhaseElements(phaseIdx) {
    const phaseEl = $$(`.phase`)[phaseIdx];
    if (!phaseEl) return;
    // Scramble headlines and eyebrows
    const targets = $$("h1, h2, .eyebrow span, .core-sub", phaseEl);
    targets.forEach((el, i) => {
      el.dataset.scrambled = "0";
      setTimeout(() => scrambleReveal(el), i * 120);
    });
  }

  // ============== 6.6 GLITCH TRANSITION ==============
  function triggerGlitch() {
    const overlay = $("#glitchOverlay");
    overlay.classList.remove("active");
    void overlay.offsetWidth; // force reflow
    overlay.classList.add("active");
    setTimeout(() => overlay.classList.remove("active"), 300);
  }

  // ============== 6.7 HUD WAVEFORM ==============
  const waveCanvas = $("#hudWaveform");
  const waveCtx = waveCanvas ? waveCanvas.getContext("2d") : null;
  const waveHistory = new Float32Array(40);
  let waveIdx = 0;

  function tickWaveform() {
    if (!waveCtx) return;
    // Feed mouse speed + subtle noise into the waveform
    const val = Math.min(1, mouseSpeed / 30) * 0.7 + Math.sin(performance.now() * 0.008) * 0.15 + 0.15;
    waveHistory[waveIdx % 40] = val;
    waveIdx++;

    waveCtx.clearRect(0, 0, 80, 16);
    waveCtx.strokeStyle = `hsl(${TWEAKS.primaryHue}, 80%, 65%)`;
    waveCtx.lineWidth = 1;
    waveCtx.beginPath();
    for (let i = 0; i < 40; i++) {
      const idx = (waveIdx + i) % 40;
      const x = (i / 39) * 80;
      const y = 8 - waveHistory[idx] * 7;
      if (i === 0) waveCtx.moveTo(x, y); else waveCtx.lineTo(x, y);
    }
    waveCtx.stroke();
    // Glow line
    waveCtx.strokeStyle = `hsla(${TWEAKS.primaryHue}, 80%, 65%, 0.3)`;
    waveCtx.lineWidth = 3;
    waveCtx.stroke();
  }

  // ============== 6.8 HUD WARNING FLASH ==============
  function hudWarningFlash() {
    $$(".hud-corner").forEach(el => {
      el.classList.remove("hud-warn");
      void el.offsetWidth;
      el.classList.add("hud-warn");
      setTimeout(() => el.classList.remove("hud-warn"), 500);
    });
  }

  // ============== 7. PRELOADER ==============
  window.bootProgress = 0.0;
  function runPreloader() {
    const fill = $("#preFill");
    const sys = $("#preSys");
    const preEl = $("#preloader");

    const TOTAL_MS = 3800; // cinematic duration
    const start = performance.now();

    function tickBoot(now) {
      const elapsed = now - start;
      window.bootProgress = Math.min(elapsed / TOTAL_MS, 1.0);
      if (window.bootProgress < 1.0) {
        requestAnimationFrame(tickBoot);
      } else {
        // End of preloader
        const flash = $("#preFlash");
        if (flash) flash.classList.add("flash");
        preEl.classList.add("done");
        $("#hud-session").textContent = "VHX-" + Math.random().toString(36).substring(2, 8).toUpperCase();
        audioBoot();
        setTimeout(() => scramblePhaseElements(0), 400);
      }
    }
    requestAnimationFrame(tickBoot);

    const steps = [
      "BOOT.0 → kernel_init",
      "BOOT.1 → vector_db_connect",
      "BOOT.2 → genesis_sequence_start",
      "BOOT.3 → isolated_synapse_test",
      "BOOT.4 → massive_neurogenesis",
      "READY → synaptic_handoff",
    ];
    let i = 0;
    const tickSys = () => {
      if (sys) sys.innerHTML = `<span class="ok">●</span> ${steps[i] || ""}`;
      i++;
      if (i < steps.length) setTimeout(tickSys, TOTAL_MS / steps.length);
    };
    if (fill) requestAnimationFrame(() => fill.style.width = "100%");
    tickSys();
  }

  // ============== 8. AUDIO (enhanced soundscape) ==============
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    return audioCtx;
  }
  function audioPing(freq = 880) {
    if (!TWEAKS.audioOn) return;
    const ctx = getAudio(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.value = 0.0; o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.start(t); o.stop(t + 0.45);
  }
  function audioBoot() {
    if (!TWEAKS.audioOn) return;
    setTimeout(() => audioPing(660), 0);
    setTimeout(() => audioPing(990), 180);
  }

  // --- Transition swoosh (dimensional shift sound) ---
  function audioSwoosh() {
    if (!TWEAKS.audioOn) return;
    const ctx = getAudio(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    o.type = "sawtooth";
    f.type = "lowpass"; f.frequency.value = 800;
    f.Q.value = 8;
    o.connect(f); f.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(1200, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.4);
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2000, t + 0.12);
    f.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.04, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.start(t); o.stop(t + 0.5);
    // White noise burst layer
    const bufSz = ctx.sampleRate * 0.3;
    const buf = ctx.createBuffer(1, bufSz, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSz; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const ng = ctx.createGain();
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass"; nf.frequency.value = 1000; nf.Q.value = 2;
    noise.connect(nf); nf.connect(ng); ng.connect(ctx.destination);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.025, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    noise.start(t); noise.stop(t + 0.35);
  }

  // --- Enhanced ambient drone (phase-adaptive) ---
  let ambientNode = null;
  let ambientPhase = -1;
  function startAmbient() {
    const ctx = getAudio(); if (!ctx) return;
    if (ambientNode) stopAmbient();
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const o3 = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 120;
    o.type = "sine"; o.frequency.value = 55;
    o2.type = "sine"; o2.frequency.value = 55.3;
    o3.type = "triangle"; o3.frequency.value = 82.5;
    o.connect(f); o2.connect(f); o3.connect(f);
    f.connect(g); g.connect(ctx.destination);
    g.gain.value = 0.018;
    o.start(); o2.start(); o3.start();
    ambientNode = { o, o2, o3, g, f };
  }
  function updateAmbientForPhase(phaseIdx) {
    if (!ambientNode || ambientPhase === phaseIdx) return;
    ambientPhase = phaseIdx;
    const ctx = getAudio(); if (!ctx) return;
    const t = ctx.currentTime;
    const freqs = [55, 65, 82, 48]; // core=deep, branches=rising, data=rhythmic, diagnose=tension
    const filters = [120, 200, 300, 100];
    const gains = [0.018, 0.015, 0.012, 0.02];
    ambientNode.o.frequency.linearRampToValueAtTime(freqs[phaseIdx], t + 1.5);
    ambientNode.o2.frequency.linearRampToValueAtTime(freqs[phaseIdx] + 0.3, t + 1.5);
    ambientNode.o3.frequency.linearRampToValueAtTime(freqs[phaseIdx] * 1.5, t + 1.5);
    ambientNode.f.frequency.linearRampToValueAtTime(filters[phaseIdx], t + 1);
    ambientNode.g.gain.linearRampToValueAtTime(gains[phaseIdx], t + 1);
  }
  function stopAmbient() {
    if (!ambientNode) return;
    try { ambientNode.o.stop(); ambientNode.o2.stop(); ambientNode.o3.stop(); } catch (e) { }
    ambientNode = null;
    ambientPhase = -1;
  }
  $("#muteBtn").addEventListener("click", () => {
    TWEAKS.audioOn = !TWEAKS.audioOn;
    $("#muteBtn").textContent = TWEAKS.audioOn ? "♪" : "ø";
    $("#muteBtn").style.color = TWEAKS.audioOn ? "var(--cyan)" : "";
    if (TWEAKS.audioOn) { getAudio() && getAudio().resume && getAudio().resume(); startAmbient(); audioPing(880); }
    else stopAmbient();
  });

  // ============== 9. HUD telemetry ==============
  let frameCount = 0;
  function tickHud(t) {
    frameCount++;
    // Waveform updates every frame for smoothness
    tickWaveform();
    if (frameCount % 4 !== 0) return;
    const now = new Date();
    const hh = now.getUTCHours().toString().padStart(2, "0");
    const mm = now.getUTCMinutes().toString().padStart(2, "0");
    const ss = now.getUTCSeconds().toString().padStart(2, "0");
    $("#hud-time").textContent = `${hh}:${mm}:${ss}`;
    $("#hud-frame").textContent = frameCount.toString().padStart(6, "0");
    // Reactive coordinates: x/y follow mouse position mapped to viewport, z follows scroll depth
    const coordX = ((mx / window.innerWidth) * 2000 - 1000) | 0;
    const coordY = ((my / window.innerHeight) * 2000 - 1000) | 0;
    const coordZ = (progress * 9999) | 0;
    const x = coordX.toString().padStart(4, " ");
    const y = coordY.toString().padStart(4, " ");
    const z = coordZ.toString().padStart(4, " ");
    $("#hud-coord").textContent = `x:${x} y:${y} z:${z}`;
    // Latency reacts to mouse speed (more motion = more "load")
    const baseLat = 8 + Math.min(mouseSpeed * 0.5, 15);
    $("#hud-lat").textContent = (baseLat + Math.sin(t * 0.001) * 2 | 0) + "ms";
    $("#hud-temp").textContent = (35.5 + Math.sin(t * 0.0003) * 1.2 + mouseSpeed * 0.02).toFixed(1) + "°C";
    $("#hud-node").textContent = ["CORE/PRIMARY", "BRANCH/3-NODES", "DATA/ROOM", "DIAGNOSE/LINK"][progressToPhase(progress)];
  }

  // ============== 10. PHASE update ==============
  let prevPhase = -1;
  function updatePhase() {
    const phaseIdx = progressToPhase(progress);
    if (phaseIdx !== prevPhase) {
      const isFirstLoad = prevPhase === -1;
      prevPhase = phaseIdx;
      $$(".phase").forEach((p, i) => p.classList.toggle("active", i === phaseIdx));
      document.body.classList.toggle("dense-phase", phaseIdx >= 2);
      $$("#navChapters button").forEach((b, i) => b.classList.toggle("active", i === phaseIdx));
      $$("#rail .step").forEach((s, i) => {
        s.classList.toggle("active", i === phaseIdx);
        s.classList.toggle("done", i < phaseIdx);
      });
      if (phaseIdx === 2) animateCounters();

      // --- Immersion triggers on phase change ---
      if (!isFirstLoad) {
        // Glitch flash
        triggerGlitch();
        // Text scramble reveal
        scramblePhaseElements(phaseIdx);
        // HUD warning flash
        hudWarningFlash();
        // Audio swoosh + ping
        audioSwoosh();
        audioPing(440 + phaseIdx * 110);
      } else {
        audioPing(440 + phaseIdx * 110);
      }
      // Update ambient drone for new phase
      updateAmbientForPhase(phaseIdx);
    }
  }

  // ============== 11. RENDER LOOP ==============
  const clock = new THREE.Clock();
  function render() {
    const dt = clock.getDelta();
    const t = clock.getElapsedTime() * TWEAKS.animSpeed;

    progress = lerp(progress, targetProgress, 0.07);

    let zT, xT, yT, fovT, brainOpacity;

    if (progress < 0.25) {
      const k = progress / 0.25;
      // Start much closer (Z=7 instead of 16) to make it look ~3x bigger
      zT = lerp(11, 6.5, k);
      xT = Math.sin(t * 0.15 + k * Math.PI) * 2.0;
      yT = Math.cos(t * 0.1) * 1.5;
      fovT = 65;
      brainOpacity = 0.8;
      document.body.classList.remove("dense-phase");
    } else if (progress < 0.6) {
      const k = (progress - 0.25) / 0.35;
      const easeIn = Math.pow(k, 2.0);
      zT = lerp(4.5, 2, easeIn);
      xT = lerp(Math.sin(t * 0.15 + 1.0 * Math.PI) * 2.0, 1.0, easeIn);
      yT = lerp(Math.cos(t * 0.1) * 1.5, 0.0, easeIn);
      fovT = lerp(65, 95, easeIn);
      brainOpacity = lerp(0.8, 0.4, k);
      document.body.classList.remove("dense-phase");
    } else {
      const k = (progress - 0.6) / 0.4;
      // Stay inside the brain! Z from 2 to 0 (center)
      zT = lerp(2, 0, k);
      xT = lerp(1.0, -1.5, k);
      yT = lerp(0.0, 1.0, k);
      fovT = lerp(95, 110, Math.pow(k, 0.7));
      brainOpacity = lerp(0.4, 0.3, k);
      document.body.classList.add("dense-phase");
    }

    camera.position.x = lerp(camera.position.x, xT, 0.08);
    camera.position.z = lerp(camera.position.z, zT, 0.08);
    camera.position.y = lerp(camera.position.y, yT, 0.08);

    if (Math.abs(camera.fov - fovT) > 0.05) {
      camera.fov = lerp(camera.fov, fovT, 0.07);
      camera.updateProjectionMatrix();
    }

    camera.lookAt(-xT * 0.15, -yT * 0.15, 0);

    const roll = Math.sin(progress * Math.PI * 3) * 0.2;
    camera.up.set(roll, 1, 0);

    brainCloud.mat.uniforms.uTime.value = t;
    brainCloud.mat.uniforms.uHue.value = TWEAKS.primaryHue / 360;
    brainCloud.mat.uniforms.uOpacity.value = lerp(brainCloud.mat.uniforms.uOpacity.value, brainOpacity, 0.1);

    // FIX: Feed the boot progress into the ghost X-ray cloud
    brainCloud.mat.uniforms.uBootProgress.value = window.bootProgress;

    const rotSpeed = lerp(0.05, 0.01, progress);
    brainCloud.points.rotation.y = t * rotSpeed;
    brainCloud.points.rotation.x = Math.sin(t * 0.02) * 0.1;

    network.update(t, dt, camera, mouseN.x, mouseN.y);

    tickHud(performance.now());
    updatePhase();

    composer.render();
    requestAnimationFrame(render);
  }

  // ============== 12. LANG ==============
  $$(".lang button").forEach(b => {
    b.addEventListener("click", () => {
      $$(".lang button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      window.VHXCO.lang = b.dataset.lang;
      window.VHXCO.applyI18n();
      renderNodes();
      buildDataRoom();
      countersAnimated = false;
      if (progressToPhase(progress) === 2) animateCounters();
    });
  });

  // ============== 13. TWEAKS PANEL ==============
  function buildTweakPanel() {
    if ($("#tweakPanel")) return;
    const root = document.createElement("div");
    root.id = "tweakPanel";
    root.style.cssText = `
      position: fixed; bottom: 76px; right: 28px; z-index: 60;
      width: 280px; background: rgba(8, 12, 16, 0.92);
      border: 1px solid var(--line);
      backdrop-filter: blur(10px);
      padding: 18px; font-family: var(--mono);
      transform: translateX(120%); transition: transform 380ms cubic-bezier(.2,.8,.2,1);
    `;
    root.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 14px;">
        <div style="font-size: 10px; letter-spacing: 0.24em; color: var(--cyan); text-transform: uppercase;">Tweaks</div>
        <button id="tweakClose" style="background:none; border:0; color: var(--dim); cursor:none; font-family: var(--mono); font-size: 14px;">×</button>
      </div>
      <div class="tw-row">
        <label>Layout dos nós</label>
        <div class="tw-segs">
          <button data-k="nodeLayout" data-v="triangle">△</button>
          <button data-k="nodeLayout" data-v="line">─</button>
          <button data-k="nodeLayout" data-v="orbital">◯</button>
        </div>
      </div>
      <div class="tw-row">
        <label>Velocidade <span id="tw-spd-v">1.0×</span></label>
        <input type="range" min="0.2" max="2.5" step="0.1" data-k="animSpeed" />
      </div>
      <div class="tw-row">
        <label>Densidade <span id="tw-d-v">1.0×</span></label>
        <input type="range" min="0.4" max="2.0" step="0.1" data-k="particleDensity" />
      </div>
      <div class="tw-row">
        <label>Tamanho partícula <span id="tw-sz-v">1.0×</span></label>
        <input type="range" min="0.3" max="3.5" step="0.1" data-k="particleSize" />
      </div>
      <div class="tw-row">
        <label>Opacidade <span id="tw-op-v">1.0×</span></label>
        <input type="range" min="0.2" max="2.0" step="0.05" data-k="particleOpacity" />
      </div>
      <div class="tw-row">
        <label>Distorção <span id="tw-ds-v">1.0×</span></label>
        <input type="range" min="0" max="2.5" step="0.1" data-k="distortion" />
      </div>
      <div class="tw-row">
        <label>Aberração cromática <span id="tw-ch-v">1.0×</span></label>
        <input type="range" min="0" max="3" step="0.1" data-k="chroma" />
      </div>
      <div class="tw-row">
        <label>Matiz primária <span id="tw-h-v">200°</span></label>
        <input type="range" min="160" max="320" step="2" data-k="primaryHue" />
      </div>
      <div class="tw-row">
        <label>Cores predefinidas</label>
        <div class="tw-segs">
          <button data-preset="cyan" style="background: oklch(0.78 0.18 200);"></button>
          <button data-preset="violet" style="background: oklch(0.78 0.18 280);"></button>
          <button data-preset="amber" style="background: oklch(0.82 0.16 70);"></button>
          <button data-preset="magenta" style="background: oklch(0.78 0.18 330);"></button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    // styles for tweak rows
    const st = document.createElement("style");
    st.textContent = `
      #tweakPanel .tw-row { margin-bottom: 14px; }
      #tweakPanel label {
        display: flex; justify-content: space-between;
        font-size: 9px; letter-spacing: 0.18em; color: var(--dim);
        text-transform: uppercase; margin-bottom: 6px;
      }
      #tweakPanel label span { color: var(--cyan); }
      #tweakPanel input[type="range"] {
        width: 100%; height: 2px; background: var(--line);
        -webkit-appearance: none; appearance: none; outline: none; cursor: none;
      }
      #tweakPanel input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none; width: 10px; height: 10px;
        background: var(--cyan); border-radius: 50%; cursor: none;
        box-shadow: 0 0 8px var(--cyan);
      }
      #tweakPanel input[type="range"]::-moz-range-thumb {
        width: 10px; height: 10px; background: var(--cyan);
        border: 0; border-radius: 50%; box-shadow: 0 0 8px var(--cyan);
      }
      #tweakPanel .tw-segs { display: flex; gap: 4px; }
      #tweakPanel .tw-segs button {
        flex: 1; padding: 8px; background: transparent;
        border: 1px solid var(--line); color: var(--dim);
        font-family: var(--mono); font-size: 11px; cursor: none;
      }
      #tweakPanel .tw-segs button.active {
        border-color: var(--cyan); color: var(--cyan);
      }
      #tweakPanel .tw-segs button[data-preset] {
        height: 18px; border: 1px solid rgba(255,255,255,0.2); padding: 0;
      }
    `;
    document.head.appendChild(st);

    // sync values
    function syncUI() {
      root.querySelectorAll("input[type=range]").forEach(inp => {
        inp.value = TWEAKS[inp.dataset.k];
      });
      root.querySelectorAll(".tw-segs button[data-k]").forEach(b => {
        b.classList.toggle("active", TWEAKS[b.dataset.k] === b.dataset.v);
      });
      $("#tw-spd-v").textContent = TWEAKS.animSpeed.toFixed(1) + "×";
      $("#tw-d-v").textContent = TWEAKS.particleDensity.toFixed(1) + "×";
      $("#tw-sz-v").textContent = TWEAKS.particleSize.toFixed(1) + "×";
      $("#tw-op-v").textContent = TWEAKS.particleOpacity.toFixed(2) + "×";
      $("#tw-ds-v").textContent = TWEAKS.distortion.toFixed(1) + "×";
      $("#tw-ch-v").textContent = TWEAKS.chroma.toFixed(1) + "×";
      $("#tw-h-v").textContent = Math.round(TWEAKS.primaryHue) + "°";
      // update CSS var
      document.documentElement.style.setProperty("--cyan", `oklch(0.78 0.18 ${TWEAKS.primaryHue})`);
      document.documentElement.style.setProperty("--cyan-soft", `oklch(0.85 0.12 ${TWEAKS.primaryHue})`);
      document.documentElement.style.setProperty("--cyan-deep", `oklch(0.55 0.22 ${TWEAKS.primaryHue + 15})`);
    }

    root.addEventListener("input", e => {
      if (e.target.matches("input[type=range]")) {
        const k = e.target.dataset.k;
        TWEAKS[k] = parseFloat(e.target.value);
        syncUI();
        persist({ [k]: TWEAKS[k] });
      }
    });
    root.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.k && b.dataset.v) {
        TWEAKS[b.dataset.k] = b.dataset.v;
        syncUI();
        layoutNodes();
        persist({ [b.dataset.k]: TWEAKS[b.dataset.k] });
      } else if (b.dataset.preset) {
        const map = { cyan: 200, violet: 280, amber: 70, magenta: 330 };
        TWEAKS.primaryHue = map[b.dataset.preset];
        syncUI();
        persist({ primaryHue: TWEAKS.primaryHue });
      }
    });
    $("#tweakClose").addEventListener("click", () => {
      root.style.transform = "translateX(120%)";
      window.parent.postMessage({ type: "__edit_mode_dismissed" }, "*");
    });

    function persist(edits) {
      window.parent.postMessage({ type: "__edit_mode_set_keys", edits }, "*");
    }

    syncUI();
    return root;
  }

  // host protocol
  window.addEventListener("message", e => {
    const d = e.data || {};
    if (d.type === "__activate_edit_mode") {
      const p = buildTweakPanel();
      requestAnimationFrame(() => { p.style.transform = "translateX(0)"; });
    }
    if (d.type === "__deactivate_edit_mode") {
      const p = $("#tweakPanel");
      if (p) p.style.transform = "translateX(120%)";
    }
  });
  // announce
  setTimeout(() => {
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
  }, 500);

  // ============== INIT ==============
  window.VHXCO.applyI18n();
  renderNodes();
  buildDataRoom();
  bindForm();
  setNextSlot();
  runPreloader();
  render();

  // expose
  window.VHXCO.goToPhase = goToPhase;
})();
