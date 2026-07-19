"use strict";

/* ---- shared: reduced motion flag ---- */
window.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---- shared: copy to clipboard (used on ordering / ratings pages) ---- */
function copyText(text, btn){
  var original = btn.textContent;
  function done(ok){
    btn.textContent = ok ? 'Copied ✓' : 'Failed';
    setTimeout(function(){ btn.textContent = original; }, 1500);
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){done(true);}, function(){done(false);});
  } else {
    try{
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      done(true);
    }catch(e){ done(false); }
  }
}

/* ---- shared: generic mouse-tracking tilt for .tilt-card / .cert-card ---- */
(function(){
  if(window.prefersReducedMotion) return;
  function attachTilt(el){
    el.addEventListener('pointermove', function(e){
      var r = el.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width;   // 0..1
      var py = (e.clientY - r.top) / r.height;   // 0..1
      var rx = (px - 0.5) * 14;   // rotateY range
      var ry = (0.5 - py) * 10;   // rotateX range
      el.style.setProperty('--rx', rx.toFixed(2) + 'deg');
      el.style.setProperty('--ry', ry.toFixed(2) + 'deg');
    });
    el.addEventListener('pointerleave', function(){
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  }
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('.tilt-card, .cert-card').forEach(attachTilt);
  });
})();

/* ---- shared: flip card (ordering page) ---- */
document.addEventListener('DOMContentLoaded', function(){
  var flip = document.querySelector('.flip-card');
  if(flip){
    flip.addEventListener('click', function(){
      flip.classList.toggle('flipped');
    });
    flip.setAttribute('tabindex', '0');
    flip.setAttribute('role', 'button');
    flip.setAttribute('aria-label', 'Flip card to show contact details');
    flip.addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); flip.classList.toggle('flipped'); }
    });
  }
});

/* ---- shared: PM-VIKAS style accordion (used on pmvikas page) ---- */
document.addEventListener('DOMContentLoaded', function(){
  var logEntries = document.querySelectorAll('.log-entry');
  logEntries.forEach(function(entry, idx){
    var btn = entry.querySelector('.log-btn');
    if(!btn) return;
    var body = entry.querySelector('.log-body');
    var bodyId = 'log-body-' + idx;
    body.id = bodyId;
    btn.setAttribute('aria-controls', bodyId);
    btn.addEventListener('click', function(){
      var isOpen = entry.classList.contains('open');
      entry.classList.toggle('open', !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
    });
  });
  var toggleAllBtn = document.getElementById('logToggleAll');
  if(toggleAllBtn){
    toggleAllBtn.addEventListener('click', function(){
      var anyClosed = Array.prototype.some.call(logEntries, function(e){ return !e.classList.contains('open'); });
      logEntries.forEach(function(entry){
        entry.classList.toggle('open', anyClosed);
        entry.querySelector('.log-btn').setAttribute('aria-expanded', String(anyClosed));
      });
      toggleAllBtn.textContent = anyClosed ? 'Collapse all' : 'Expand all';
    });
  }
});

/* ---- shared: lightweight reusable Three.js scene kit ----
   Handles: WebGL detection, renderer/camera/lights, drag-to-rotate,
   idle auto-rotate (paused if reduced-motion or dragging), resize, RAF loop.
   Now upgraded for HDRI environment maps and photorealistic rendering.
------------------------------------------------------------------- */
window.Scene3DKit = {
  create: function(canvas, opts){
    opts = opts || {};
    if(typeof THREE === 'undefined') return null;

    var webglOK = false;
    try{
      var t = document.createElement('canvas');
      webglOK = !!(window.WebGLRenderingContext && (t.getContext('webgl') || t.getContext('experimental-webgl')));
    }catch(e){ webglOK = false; }
    if(!webglOK) return null;

    try{
      var w = canvas.clientWidth || 300, h = canvas.clientHeight || 300;
      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(opts.fov || 40, w/h, 0.1, 100);
      camera.position.set(opts.camX || 0, opts.camY != null ? opts.camY : 1.4, opts.camZ != null ? opts.camZ : 7);
      camera.lookAt(0, opts.lookY != null ? opts.lookY : 0, 0);

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias:true, alpha:true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      
      // Upgraded Tone Mapping for Photorealism
      if(THREE.ACESFilmicToneMapping){
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        renderer.outputEncoding = THREE.sRGBEncoding; // Crucial for accurate GLTF colors
      }

      // Basic Lighting Fallback (keeps your scene lit while HDRI loads)
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      var key = new THREE.DirectionalLight(0xffffff, 0.9);
      key.position.set(4, 6, 5);
      scene.add(key);
      var fill = new THREE.DirectionalLight(0x88aaff, 0.12);
      fill.position.set(-5, -1, -3);
      scene.add(fill);
      var warm = new THREE.PointLight(0xeab454, 0.75, 25);
      warm.position.set(-3, 2, 4);
      scene.add(warm);

      // --- NEW: HDRI Environment Map Loading ---
      if(opts.envMapUrl && THREE.RGBELoader) {
        new THREE.RGBELoader().load(opts.envMapUrl, function(texture) {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          scene.environment = texture;
          // We intentionally do not set scene.background to keep the UI layer transparent
        });
      }

      var group = new THREE.Group();
      scene.add(group);

      if(opts.build) opts.build(scene, group, THREE);

      var isDragging = false, dragStartX = 0, dragStartRotY = 0;
      function onDown(e){
        isDragging = true;
        dragStartX = (e.touches ? e.touches[0].clientX : e.clientX);
        dragStartRotY = group.rotation.y;
        canvas.style.cursor = 'grabbing';
      }
      function onMove(e){
        if(!isDragging) return;
        var x = (e.touches ? e.touches[0].clientX : e.clientX);
        group.rotation.y = dragStartRotY + (x - dragStartX) * 0.008;
      }
      function onUp(){ isDragging = false; canvas.style.cursor = 'grab'; }
      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      canvas.addEventListener('touchstart', onDown, {passive:true});
      canvas.addEventListener('touchmove', onMove, {passive:true});
      canvas.addEventListener('touchend', onUp);
      canvas.style.cursor = 'grab';

      function onResize(){
        var nw = canvas.clientWidth || w, nh = canvas.clientHeight || h;
        camera.aspect = nw/nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
      window.addEventListener('resize', onResize);

      var clock = new THREE.Clock();
      var reduced = window.prefersReducedMotion;
      function animate(){
        requestAnimationFrame(animate);
        var dt = Math.min(clock.getDelta(), 0.05);
        if(!isDragging && !reduced){
          group.rotation.y += (opts.autoRotateSpeed != null ? opts.autoRotateSpeed : 0.15) * dt;
        }
        if(opts.onFrame) opts.onFrame(dt, group, scene, camera);
        renderer.render(scene, camera);
      }
      animate();

      return { scene:scene, group:group, camera:camera, renderer:renderer };
    }catch(err){
      return null;
    }
  }
};

/* ---- shared: wire up a .scene-panel to Scene3DKit with graceful fallback ----
   Call: initScenePanel('panelId','canvasId', {build:..., onFrame:..., ...}) */
function initScenePanel(panelId, canvasId, opts){
  var panel = document.getElementById(panelId);
  var canvas = document.getElementById(canvasId);
  if(!panel || !canvas) return null;
  var kit = window.Scene3DKit.create(canvas, opts);
  if(!kit){ panel.classList.add('no-3d'); }
  return kit;
}
