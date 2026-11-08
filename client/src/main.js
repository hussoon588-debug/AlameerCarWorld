import * as THREE from 'three';
import { io } from 'socket.io-client';

// ==========================================================================
// ULTIMATE CAR WORLD — Web 3D Client
// ==========================================================================
const API = window.API || location.origin; // served from same backend
const CACHE = {
  get user() { try { return JSON.parse(localStorage.getItem('ucw_user') || 'null'); } catch(e){return null;} },
  set user(v){ localStorage.setItem('ucw_user', JSON.stringify(v)); },
  get token(){ return localStorage.getItem('ucw_token') || ''; },
  set token(v){ v ? localStorage.setItem('ucw_token', v) : localStorage.removeItem('ucw_token'); }
};

const state = {
  me: null, myCars: [], catalog: [], missions: [],
  activeCar: null,
  speedKmh: 0, steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false, nitroBoost: 1,
  distanceDriven: 0, hadCrash: false, sessionStart: Date.now(),
  otherPlayers: new Map(),
  trafficCars: [], trafficEnabled: true, mpEnabled: true,
  honking: false, audioMuted: false,
  checkpoints: new Set(), deliveryTotal: 3, parkingZone: null,
  parkedCorrectly: 0,
  keys: {}, dailyClaimed: false,
  camMode: 3 // 0 bumper, 1 hood, 2 chase low, 3 chase high, 4 cinematic
};

// ---------- THREE.JS SETUP ----------
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x9ec7e8, 400, 1600);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.3, 3000);
const clock = new THREE.Clock();

// Lights
const sun = new THREE.DirectionalLight(0xfff2d0, 2.2);
sun.position.set(150, 300, 100);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -300; sun.shadow.camera.right = 300;
sun.shadow.camera.top = 300; sun.shadow.camera.bottom = -300;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 800;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xaec8ff, 0x304830, 0.6));
scene.add(new THREE.AmbientLight(0x445566, 0.25));

// ---------- WORLD ----------
const CITY = 800; // half-extent
const BLOCK = 80;
const ROAD_W = 14;
const worldObjects = new THREE.Group();
scene.add(worldObjects);
const colliders = []; // {x,z,w,d}

function setProgress(pct, msg){document.getElementById('loadfill').style.width=pct+'%';if(msg)document.querySelector('#loading .txt').textContent=msg;}

let worldBuilt=false;
function buildWorld(){
 if(worldBuilt)return;worldBuilt=true;
 setProgress(10,'بناء الأرض…');
 // Ground — main asphalt and desert beyond
 const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(CITY*3, CITY*3),
  new THREE.MeshStandardMaterial({ color: 0x2f3e4e, roughness: 0.95 })
 );
 ground.rotation.x = -Math.PI/2;
 ground.receiveShadow = true;
 worldObjects.add(ground);
 // Sand around
 const sand = new THREE.Mesh(new THREE.PlaneGeometry(CITY*6, CITY*6), new THREE.MeshStandardMaterial({color:0xd4b98e,roughness:1}));
 sand.rotation.x=-Math.PI/2;sand.position.y=-0.02;sand.receiveShadow=true;worldObjects.add(sand);

 setProgress(25,'بناء الشوارع…');
 const roadMat = new THREE.MeshStandardMaterial({color:0x1e2530,roughness:0.8});
 const lineMat = new THREE.MeshBasicMaterial({color:0xffee88});
 // Grid roads
 const roads = new THREE.Group(); worldObjects.add(roads);
 for(let i=-CITY;i<=CITY;i+=BLOCK){
  const h1 = new THREE.Mesh(new THREE.PlaneGeometry(CITY*2, ROAD_W), roadMat);
  h1.rotation.x=-Math.PI/2;h1.position.set(0,0.02,i);h1.receiveShadow=true;roads.add(h1);
  const v1 = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, CITY*2), roadMat);
  v1.rotation.x=-Math.PI/2;v1.position.set(i,0.02,0);v1.receiveShadow=true;roads.add(v1);
  // Center dashed lines
  for(let j=-CITY;j<CITY;j+=8){
   const hl = new THREE.Mesh(new THREE.PlaneGeometry(3,0.3), lineMat);
   hl.rotation.x=-Math.PI/2;hl.position.set(j,0.05,i);roads.add(hl);
   const vl = new THREE.Mesh(new THREE.PlaneGeometry(0.3,3), lineMat);
   vl.rotation.x=-Math.PI/2;vl.position.set(i,0.05,j);roads.add(vl);
  }
 }
 // Sidewalks
 const swMat = new THREE.MeshStandardMaterial({color:0x9ca3af,roughness:0.9});
 for(let i=-CITY+BLOCK/2;i<=CITY-BLOCK/2;i+=BLOCK){
  for(let j=-CITY+BLOCK/2;j<=CITY-BLOCK/2;j+=BLOCK){
   // block interior is a "parking lot" + buildings area
   const block = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK-ROAD_W-4, BLOCK-ROAD_W-4), new THREE.MeshStandardMaterial({color:0x3a4a3a,roughness:1}));
   block.rotation.x=-Math.PI/2;block.position.set(i,0.04,j);block.receiveShadow=true;roads.add(block);
  }
 }

 setProgress(45,'بناء المباني…');
 // Procedural buildings
 const buildingColors=[0x8da9c4,0xb08968,0xc9b896,0x6d8299,0xa8b5c4,0xd4c5a0,0x7a8c9a,0x5a6a7a];
 const windowMat = new THREE.MeshStandardMaterial({emissive:0xffe8a8,emissiveIntensity:0.4,color:0x223344,roughness:0.4});
 const buildingMat = (c)=>(new THREE.MeshStandardMaterial({color:c,roughness:0.7}));
 for(let i=-CITY+BLOCK/2;i<=CITY-BLOCK/2;i+=BLOCK){
  for(let j=-CITY+BLOCK/2;j<=CITY-BLOCK/2;j+=BLOCK){
   if(Math.hypot(i,j)<100) continue; // downtown around spawn cleared
   if(Math.random()<0.3) continue;
   const numB=1+Math.floor(Math.random()*3);
   for(let b=0;b<numB;b++){
    const bw = 16+Math.random()*28, bd = 16+Math.random()*28;
    const isDowntown = Math.hypot(i,j)<400;
    const bh = (isDowntown?30:6)+Math.random()*(isDowntown?80:18);
    const px = i+(Math.random()-0.5)*(BLOCK-ROAD_W-bw-10);
    const pz = j+(Math.random()-0.5)*(BLOCK-ROAD_W-bd-10);
    const geo = new THREE.BoxGeometry(bw, bh, bd);
    const mesh = new THREE.Mesh(geo, buildingMat(buildingColors[Math.floor(Math.random()*buildingColors.length)]));
    mesh.position.set(px, bh/2, pz);
    mesh.castShadow = true; mesh.receiveShadow = true;
    roads.add(mesh);
    colliders.push({x:px,z:pz,w:bw,d:bd,h:bh});
    // Windows — planes on each face
    const winTex = createWindowTexture();
    const winMat = new THREE.MeshStandardMaterial({map:winTex,emissiveMap:winTex,emissive:0xffcc66,emissiveIntensity:0.3,roughness:0.3});
    // Wrap with extra materials for faces
    mesh.material = [winMat,winMat,buildingMat(mesh.material.color.getHex()),buildingMat(mesh.material.color.getHex()),winMat,winMat];
   }
  }
 }

 setProgress(60,'بناء المعالم…');
 // Burj Khalifa-inspired tower at (0,-300)
 const burj = (()=>{
  const g = new THREE.Group();
  const segs=20;let h=0;let w=20;
  for(let k=0;k<segs;k++){
   const hh=10+Math.random()*4; w*=0.93;
   const m=new THREE.Mesh(new THREE.BoxGeometry(w,hh,w),new THREE.MeshStandardMaterial({color:0xb0c4de,metalness:0.6,roughness:0.3,emissive:0x4488ff,emissiveIntensity:0.1}));
   m.position.y=h+hh/2;g.add(m);h+=hh;
   colliders.push({x:0,z:-280,w,d:Math.max(w-1,5),h:hh});
  }
  const antena=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.4,40),new THREE.MeshStandardMaterial({color:0xcccccc,metalness:0.9}));
  antena.position.y=h+20;g.add(antena);
  g.position.set(0,0,-280);
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  return g;
 })();
 worldObjects.add(burj);

 // Car dealership
 const dealership = new THREE.Group();
 const dGlass=new THREE.Mesh(new THREE.BoxGeometry(30,12,18),new THREE.MeshStandardMaterial({color:0x223344,metalness:0.9,roughness:0.1,transparent:true,opacity:0.6,}));
 dGlass.position.y=6;dealership.add(dGlass);
 const dFrame=new THREE.Mesh(new THREE.BoxGeometry(32,14,20),new THREE.MeshStandardMaterial({color:0x111111,metalness:0.7,roughness:0.4}));
 dFrame.position.y=7;dealership.add(dFrame);
 const dSign = makeTextPlane('CAR DEALERSHIP', 40, 4);
 dSign.position.set(0,16,10.1);dealership.add(dSign);
 const dRed=new THREE.Mesh(new THREE.BoxGeometry(40,1.5,0.3),new THREE.MeshStandardMaterial({color:0xff2222,emissive:0xff0000,emissiveIntensity:0.5}));
 dRed.position.set(0,14,10.2);dealership.add(dRed);
 colliders.push({x:-80,z:80,w:32,d:20,h:14});
 dealership.position.set(-80,0,80);worldObjects.add(dealership);

 // Palm trees
 setProgress(72,'زراعة النخيل…');
 const palmGeoLeaf = new THREE.ConeGeometry(2,5,4);
 const palmMat = new THREE.MeshStandardMaterial({color:0x2e7d32,roughness:0.8});
 const trunkMat = new THREE.MeshStandardMaterial({color:0x6d4c2a,roughness:1});
 function palm(x,z){
  const g=new THREE.Group();
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.6,10,8),trunkMat);
  trunk.position.y=5;trunk.castShadow=true;g.add(trunk);
  for(let k=0;k<8;k++){
   const leaf=new THREE.Mesh(palmGeoLeaf,palmMat);
   leaf.position.y=10;leaf.rotation.z=Math.PI/3;leaf.rotation.y=k*(Math.PI*2/8);
   leaf.castShadow=true;g.add(leaf);
  }
  g.position.set(x,0,z);worldObjects.add(g);
 }
 for(let i=-CITY;i<=CITY;i+=BLOCK){
  for(let j=-CITY+BLOCK/2;j<=CITY-BLOCK/2;j+=BLOCK/2){
   if(Math.random()<0.35) palm(i-ROAD_W/2-3,j);
   if(Math.random()<0.35) palm(i+ROAD_W/2+3,j);
  }
 }

 // Street lamps
 const lampMat=new THREE.MeshStandardMaterial({color:0x222222,metalness:0.6});
 const bulbMat=new THREE.MeshStandardMaterial({color:0xfff4c4,emissive:0xffe088,emissiveIntensity:1});
 for(let i=-CITY;i<=CITY;i+=BLOCK*2){
  for(let j=-CITY;j<=CITY;j+=BLOCK*2){
   [-1,1].forEach(si=>{[-1,1].forEach(sj=>{
    const lp=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.2,8),lampMat);
    lp.position.set(i+si*(ROAD_W/2+1),4,j+sj*(ROAD_W/2+1));lp.castShadow=true;worldObjects.add(lp);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,2),lampMat);
    arm.position.set(i+si*(ROAD_W/2+1),8,j+sj*(ROAD_W/2+1)+sj);worldObjects.add(arm);
    const bulb=new THREE.Mesh(new THREE.SphereGeometry(0.4,8,8),bulbMat);
    bulb.position.set(i+si*(ROAD_W/2+1),7.8,j+sj*(ROAD_W/2+1)+sj*2);worldObjects.add(bulb);
    const pl=new THREE.PointLight(0xffe088,0.3,30,2);
    pl.position.copy(bulb.position);worldObjects.add(pl);
   });});
  });
 }

 // Billboard (UCW)
 const bb=new THREE.Mesh(new THREE.BoxGeometry(24,12,0.6),new THREE.MeshStandardMaterial({color:0x112244,emissive:0x2244aa,emissiveIntensity:0.6}));
 bb.position.set(80,10,-100);worldObjects.add(bb);
 const bbText=makeTextPlane('ULTIMATE\nCAR WORLD',30,14);
 bbText.position.set(80,10,-99.6);worldObjects.add(bbText);
 colliders.push({x:80,z:-100,w:25,d:2,h:14});

 // Parking zone trigger near dealership (invisible)
 const pzGeo=new THREE.BoxGeometry(8,3,5);pzGeo.rotateY(Math.PI/8);
 const pzMat=new THREE.MeshStandardMaterial({color:0x06d6a0,transparent:true,opacity:0.25,emissive:0x06d6a0,emissiveIntensity:0.3});
 const pz=new THREE.Mesh(pzGeo,pzMat);
 pz.position.set(-110,0.2,120);worldObjects.add(pz);
 state.parkingZone=pz;
 // Marking lines
 for(let k=-1;k<=1;k+=2){
  const ln=new THREE.Mesh(new THREE.PlaneGeometry(8,0.3),new THREE.MeshBasicMaterial({color:0xffffff}));
  ln.rotation.x=-Math.PI/2;ln.rotation.z=Math.PI/8;ln.position.set(-110,0.08,120+k*2.5);worldObjects.add(ln);
 }
 const pSign=makeTextPlane('P 🅿️',3,1.5);pSign.position.set(-110,3,116);worldObjects.add(pSign);

 // Delivery checkpoints
 const cpMat=new THREE.MeshStandardMaterial({color:0xffd166,emissive:0xffaa00,emissiveIntensity:0.6,transparent:true,opacity:0.7});
 state.checkpointsObjs=[];
 const cpPositions=[[120,80],[-200,120],[200,-200],[-100,-250],[300,60],[-280,-60]];
 cpPositions.forEach((p,idx)=>{
  const cp=new THREE.Mesh(new THREE.CylinderGeometry(3,3,6,12),cpMat);
  cp.position.set(p[0],3,p[1]);cp.userData={idx,taken:false};worldObjects.add(cp);
  state.checkpointsObjs.push(cp);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(4,0.3,8,24),new THREE.MeshBasicMaterial({color:0xffaa00}));
  ring.rotation.x=Math.PI/2;ring.position.set(p[0],0.1,p[1]);worldObjects.add(ring);
 });
 // Race start
 const raceStart=new THREE.Mesh(new THREE.BoxGeometry(6,0.2,12),new THREE.MeshBasicMaterial({color:0xffffff}));
 raceStart.position.set(0,0.12,-50);worldObjects.add(raceStart);
 // Checkered pattern
 for(let i=-2;i<=2;i++){
  for(let j=-5;j<=5;j+=2){
   const c=(i+j)%2===0?0x000000:0xffffff;
   const sq=new THREE.Mesh(new THREE.PlaneGeometry(1.1,0.9),new THREE.MeshBasicMaterial({color:c}));
   sq.rotation.x=-Math.PI/2;sq.position.set(i*1.1,0.13,-50+j*1.1);worldObjects.add(sq);
  }
 }
 setProgress(85,'المرور والعناصر…');
}

function createWindowTexture(){
 const c=document.createElement('canvas');c.width=64;c.height=128;
 const ctx=c.getContext('2d');ctx.fillStyle='#1a2332';ctx.fillRect(0,0,64,128);ctx.fillStyle='#ffd98a';
 for(let y=6;y<120;y+=14)for(let x=4;x<60;x+=10)if(Math.random()<0.7)ctx.fillRect(x,y,6,8);
 const t=new THREE.CanvasTexture(c);return t;
}
function makeTextPlane(text,w,h){
 const c=document.createElement('canvas');c.width=512;c.height=Math.floor(512*h/w);
 const ctx=c.getContext('2d');ctx.fillStyle='#000000';ctx.fillRect(0,0,c.width,c.height);
 ctx.fillStyle='#ffffff';ctx.font='bold '+Math.floor(c.height*0.5)+'px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
 const lines=text.split('\n');lines.forEach((ln,i)=>ctx.fillText(ln,c.width/2,c.height/2+(i-(lines.length-1)/2)*c.height*0.4));
 const t=new THREE.CanvasTexture(tintCanvas(c,'#ffffff'));
 const mat=new THREE.MeshBasicMaterial({map:t,transparent:true,side:THREE.DoubleSide});
 const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);return m;
}
function tintCanvas(canvas,color){return canvas;}

// ---------- CAR FACTORY ----------
function buildCar({color='#c0392b',type='sedan'}={}){
 const g=new THREE.Group();
 const bodyColor=new THREE.MeshStandardMaterial({color,metalness:0.7,roughness:0.3});
 const dark=new THREE.MeshStandardMaterial({color:0x111111,metalness:0.5,roughness:0.6});
 const glass=new THREE.MeshStandardMaterial({color:0x0a1a2a,metalness:0.9,roughness:0.05,transparent:true,opacity:0.7});
 const lightOn=new THREE.MeshStandardMaterial({color:0xffffcc,emissive:0xffffee,emissiveIntensity:1});
 const tail=new THREE.MeshStandardMaterial({color:0x660000,emissive:0xff0000,emissiveIntensity:0.6});
 let L=4.6,W=1.9,H=1.4;
 if(type==='sport'){L=4.8;W=2;H=1.2;}
 if(type==='suv'){L=5;W=2.1;H=1.8;}
 if(type==='truck'){L=5.4;W=2.1;H=1.9;}
 if(type==='compact'){L=4;W=1.8;H=1.4;}
 if(type==='luxury'){L=5.2;W=2;H=1.4;}
 // Lower body
 const lower=new THREE.Mesh(new THREE.BoxGeometry(W,H*0.6,L),bodyColor);lower.position.y=H*0.3;g.add(lower);
 // Upper cabin
 const cab=new THREE.Mesh(new THREE.BoxGeometry(W*0.9,H*0.5,L*0.65),bodyColor);
 cab.position.set(0,H*0.65,L*0.02);g.add(cab);
 // Windshield
 const ws=new THREE.Mesh(new THREE.BoxGeometry(W*0.85,H*0.45,L*0.05),glass);
 ws.position.set(0,H*0.7,L*0.32);ws.rotation.x=-0.3;g.add(ws);
 const rear=new THREE.Mesh(new THREE.BoxGeometry(W*0.85,H*0.42,L*0.05),glass);
 rear.position.set(0,H*0.7,-L*0.28);rear.rotation.x=0.3;g.add(rear);
 // Side windows
 [1,-1].forEach(s=>{
  const sw=new THREE.Mesh(new THREE.BoxGeometry(0.04,H*0.35,L*0.45),glass);
  sw.position.set(s*(W*0.45),H*0.7,0);g.add(sw);
 });
 // Spoiler for sport
 if(type==='sport'){
  const sp=new THREE.Mesh(new THREE.BoxGeometry(W*0.9,0.1,0.4),dark);
  sp.position.set(0,H*0.95,-L*0.45);g.add(sp);
  const sp2=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.4,0.4),dark);
  sp2.position.set(W*0.4,H*0.75,-L*0.45);g.add(sp2);
  const sp3=sp2.clone();sp3.position.x=-W*0.4;g.add(sp3);
 }
 // Headlights
 [-1,1].forEach(s=>{
  const hl=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.2,0.1),lightOn);
  hl.position.set(s*W*0.4,H*0.4,L*0.5);g.add(hl);
  const tl=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.2,0.1),tail);
  tl.position.set(s*W*0.4,H*0.4,-L*0.5);g.add(tl);
 });
 // Wheels
 const wheelGeo=new THREE.CylinderGeometry(0.4,0.4,0.3,16);
 const wheelMat=dark;
 const wheels=[];
 [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([sx,sz])=>{
  const w=new THREE.Mesh(wheelGeo,wheelMat);w.rotation.z=Math.PI/2;
  w.position.set(sx*W*0.5-0.05*sx,0.4,sz*L*0.42);g.add(w);wheels.push(w);
 });
 // Toyota-ish logo badge on rear for the supra
 if(type==='sport'){
  const badge=new THREE.Mesh(new THREE.CircleGeometry(0.18,16),new THREE.MeshStandardMaterial({color:0xcccccc,metalness:1}));
  badge.position.set(0,H*0.5,-L*0.5-0.06);g.add(badge);
 }
 // License plate
 const plate=makeTextPlane('U.C.W.001',1.2,0.3);
 plate.position.set(0,0.55,-L*0.5-0.06);g.add(plate);
 g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 g.userData={wheels,wheelRadius:0.4,length:L,width:W,height:H};
 return g;
}

function carTypeFromCategory(cat){
 const m={Compact:'compact',Sedan:'sedan',Sport:'sport',SUV:'suv',Pickup:'truck',Luxury:'luxury',Service:'sedan'};
 return m[cat]||'sedan';
}

// ---------- PLAYER CAR ----------
let playerCar;
let playerProps={maxSpeed:70, accel:15, brakeForce:35, steerMax:0.55, steerReturn:3.2, grip:0.95, lateralGrip:0.85};

function spawnPlayerCar(carData){
 if(playerCar){worldObjects.remove(playerCar);}
 const car=buildCar({color:carData.color||carData.defaultColor||'#c0392b',type:carTypeFromCategory(carData.category)});
 // Physics via a simple kinematic model + rigid transform
 car.position.set(-40,0,100); // spawn at the dealership
 car.rotation.y=Math.PI/2; // face east
 car.userData.vf=0; // forward speed (m/s)
 car.userData.vs=0; // side slip
 car.userData.steerAngle=0;
 car.userData.wheelRot=0;
 worldObjects.add(car);
 playerCar=car;
 // Update handling based on car spec
 const ts=(carData.topSpeed||220)/3.6;
 playerProps.maxSpeed=Math.max(40,ts);
 playerProps.accel=8+(carData.accel||12);
 playerProps.grip=carData.handling||0.88;
}

// ---------- AI TRAFFIC ----------
function spawnTraffic(n=30){
 clearTraffic();
 if(!state.trafficEnabled)return;
 const colors=[0x2c3e50,0xecf0f1,0xc0392b,0x3498db,0xf39c12,0x27ae60,0x8e44ad,0x34495e,0xbdc3c7,0xe74c3c];
 const types=['sedan','compact','suv','sedan','compact','luxury'];
 for(let i=0;i<n;i++){
  const t=buildCar({color:colors[Math.floor(Math.random()*colors.length)],type:types[Math.floor(Math.random()*types.length)]});
  // pick a road segment
  const horiz=Math.random()<0.5;
  const pos=((Math.floor(Math.random()*((CITY*2)/BLOCK)))*(BLOCK)) - CITY;
  const along=(Math.random()-0.5)*CITY*1.8;
  const lane=ROAD_W/4;
  const dir=Math.random()<0.5?1:-1;
  if(horiz){
   t.position.set(along,0,pos+dir*lane);
   t.rotation.y=dir>0?Math.PI/2:-Math.PI/2;
  }else{
   t.position.set(pos+dir*lane,0,along);
   t.rotation.y=dir>0?0:Math.PI;
  }
  t.userData.vf=(8+Math.random()*6)*(0.8+Math.random()*0.4); // m/s city speed
  t.userData.dir=dir;
  t.userData.horiz=horiz;
  t.userData.lane=pos;
  t.userData.stopTimer=0;
  worldObjects.add(t);
  state.trafficCars.push(t);
 }
}
function clearTraffic(){
 state.trafficCars.forEach(t=>worldObjects.remove(t));
 state.trafficCars=[];
}
function updateTraffic(dt){
 state.trafficCars.forEach(t=>{
  // Check for player proximity to avoid intersection collision
  let slow=0;
  const px=playerCar.position.x,pz=playerCar.position.z;
  const dx=px-t.position.x,dz=pz-t.position.z;const dist=Math.hypot(dx,dz);
  // intersection detection near grid points
  const nearInter=(Math.abs(Math.abs(t.position.x)%BLOCK - 0)<ROAD_W && Math.abs(Math.abs(t.position.z)%BLOCK - 0)<ROAD_W+2);
  if(t.userData.horiz){
   // Check cross traffic
   state.trafficCars.forEach(o=>{
    if(o===t||o.userData.horiz)return;
    if(Math.abs(o.position.z-t.position.z)<ROAD_W+1 && Math.abs(o.position.x-t.position.x)<20 && o.userData.vf>2){slow=Math.max(slow,1);}
   });
   // Check player ahead
   const ahead=(t.userData.dir>0?(px-t.position.x):(t.position.x-px));
   if(Math.abs(pz-t.position.z)<3 && ahead>0 && ahead<20) slow=1;
   // Move along x
   const v=t.userData.vf*(1-slow*0.9);
   t.position.x += t.userData.dir*v*dt;
   t.rotation.y=t.userData.dir>0?Math.PI/2:-Math.PI/2;
  }else{
   state.trafficCars.forEach(o=>{
    if(o===t||!o.userData.horiz)return;
    if(Math.abs(o.position.x-t.position.x)<ROAD_W+1 && Math.abs(o.position.z-t.position.z)<20 && o.userData.vf>2){slow=Math.max(slow,1);}
   });
   const ahead=(t.userData.dir>0?(pz-t.position.z):(t.position.z-pz));
   if(Math.abs(px-t.position.x)<3 && ahead>0 && ahead<20) slow=1;
   const v=t.userData.vf*(1-slow*0.9);
   t.position.z += t.userData.dir*v*dt;
   t.rotation.y=t.userData.dir>0?0:Math.PI;
  }
  // Wrap / recycle to avoid them leaving
  if(Math.abs(t.position.x)>CITY+50||Math.abs(t.position.z)>CITY+50){
   // respawn opposite
   if(t.userData.horiz){
    t.position.x = t.userData.dir>0?-CITY-20:CITY+20;
    t.position.z = ((Math.floor(Math.random()*((CITY*2)/BLOCK)))*BLOCK)-CITY + t.userData.dir*ROAD_W/4;
   }else{
    t.position.z = t.userData.dir>0?-CITY-20:CITY+20;
    t.position.x = ((Math.floor(Math.random()*((CITY*2)/BLOCK)))*BLOCK)-CITY + t.userData.dir*ROAD_W/4;
   }
  }
  // Spin wheels
  t.userData.wheels.forEach(w=>{w.rotation.x += v*dt/t.userData.wheelRadius;});
 });
}

// ---------- MULTIPLAYER ----------
let socket;
function connectSocket(){
 if(socket||!state.mpEnabled)return;
 socket=io(API,{auth:{token:CACHE.token},transports:['websocket','polling']});
 socket.on('connect',()=>{toast('🌐 تم الاتصال باللعب الجماعي');});
 socket.on('player_state',d=>{
  let p=state.otherPlayers.get(d.id);
  if(!p){
   p=buildCar({color:'#6a1b9a',type:'sport'});p.userData.tmp=true;worldObjects.add(p);
   state.otherPlayers.set(d.id,p);
  }
  p.visible=true;
  p.targetPos=new THREE.Vector3(d.x,d.y||0,d.z);
  p.targetRot=d.r||0;
  p.targetSpeed=d.s||0;
  p.userData.name=d.u;
 });
 socket.on('player_left',d=>{
  const p=state.otherPlayers.get(d.id);
  if(p){worldObjects.remove(p);state.otherPlayers.delete(d.id);}
 });
 socket.on('world_snapshot',arr=>{
  const ids=new Set(arr.map(x=>x.id));
  state.otherPlayers.forEach((p,k)=>{if(!ids.has(k)){worldObjects.remove(p);state.otherPlayers.delete(k);}});
 });
 socket.on('chat_msg',d=>{addChatMsg(d.user,d.message);});
 socket.on('honk',d=>{if(d.id!==socket.id)audio.honk();});
 socket.on('voice_signal',d=>UCWVoice.onSignal(d));
 socket.on('voice_peer_join',d=>UCWVoice.onJoin(d));
 socket.on('voice_peer_leave',d=>UCWVoice.onLeave(d));
 socket.on('disconnect',()=>{toast('⚠️ انقطع الاتصال بالخادم');});
}
function updateMultiplayer(dt){
 state.otherPlayers.forEach(p=>{
  if(p.targetPos){p.position.lerp(p.targetPos,Math.min(1,dt*8));p.rotation.y+=(p.targetRot-p.rotation.y)*Math.min(1,dt*6);}
 });
}
function sendPlayerState(){
 if(!socket||!socket.connected||!playerCar)return;
 socket.emit('player_update',{x:playerCar.position.x,y:playerCar.position.y,z:playerCar.position.z,r:playerCar.rotation.y,s:state.speedKmh});
}

// ---------- VOICE CHAT (WebRTC) ----------
const UCWVoice = {
 localStream:null, peers:new Map(), audioElts:new Map(), joined:false, muted:false,
 async join(){
  if(this.joined)return;
  try{
   this.localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
   this.localStream.getAudioTracks()[0].enabled=!this.muted;
   this.joined=true;
   document.getElementById('voiceJoinBtn').style.display='none';
   document.getElementById('micBtn').style.display='inline-block';
   if(socket)socket.emit('join_voice','lobby');
   renderVoiceUsers();
   toast('🎙️ انضممت للغرفة الصوتية');
  }catch(e){toast('⚠️ تعذر الوصول للميكروفون: '+e.message);}
 },
 leave(){
  if(!this.joined)return;
  this.localStream&&this.localStream.getTracks().forEach(t=>t.stop());
  this.localStream=null;
  this.peers.forEach(p=>p.close());this.peers.clear();
  this.audioElts.forEach(a=>a.remove());this.audioElts.clear();
  if(socket)socket.emit('leave_voice','lobby');
  this.joined=false;
  document.getElementById('voiceJoinBtn').style.display='inline-block';
  document.getElementById('micBtn').style.display='none';
  renderVoiceUsers();
 },
 toggleMic(){
  if(!this.localStream)return;
  this.muted=!this.muted;
  this.localStream.getAudioTracks()[0].enabled=!this.muted;
  document.getElementById('micBtn').textContent=this.muted?'🔇 تشغيل الميكروفون':'🎤 كتم الميكروفون';
  renderVoiceUsers();
 },
 async onJoin({id,user}){
  if(!this.joined)return;
  const pc=this.createPeer(id,true);
  this.peers.set(id,pc);
  const offer=await pc.createOffer();await pc.setLocalDescription(offer);
  socket.emit('voice_signal',{to:id,signal:{type:'offer',sdp:offer.sdp}});
  renderVoiceUsers();
 },
 onLeave({id}){
  const pc=this.peers.get(id);if(pc)pc.close();
  this.peers.delete(id);
  const a=this.audioElts.get(id);if(a)a.remove();
  this.audioElts.delete(id);
  renderVoiceUsers();
 },
 async onSignal({from,user,signal}){
  if(!this.joined)return;
  let pc=this.peers.get(from);
  if(!pc){pc=this.createPeer(from,false);this.peers.set(from,pc);}
  if(signal.type==='offer'){
   await pc.setRemoteDescription(new RTCSessionDescription({type:'offer',sdp:signal.sdp}));
   const ans=await pc.createAnswer();await pc.setLocalDescription(ans);
   socket.emit('voice_signal',{to:from,signal:{type:'answer',sdp:ans.sdp}});
  }else if(signal.type==='answer'){
   await pc.setRemoteDescription(new RTCSessionDescription({type:'answer',sdp:signal.sdp}));
  }else if(signal.candidate){
   try{await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));}catch(e){}
  }
 },
 createPeer(id,polite){
  const cfg={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
  const pc=new RTCPeerConnection(cfg);
  if(this.localStream)this.localStream.getTracks().forEach(t=>pc.addTrack(t,this.localStream));
  pc.onicecandidate=e=>{if(e.candidate&&socket)socket.emit('voice_signal',{to:id,signal:{candidate:e.candidate.toJSON()}});};
  pc.ontrack=e=>{
   let a=this.audioElts.get(id);
   if(!a){a=document.createElement('audio');a.autoplay=true;document.body.appendChild(a);this.audioElts.set(id,a);}
   a.srcObject=e.streams[0];
  };
  return pc;
 }
};
function renderVoiceUsers(){
 const box=document.getElementById('voiceUsers');box.innerHTML='';
 if(state.me){
  const d=document.createElement('div');d.className='voice-user'+(UCWVoice.muted?' muted':'');d.textContent=state.me.username.slice(0,2).toUpperCase();d.title=state.me.username+(UCWVoice.muted?' (مكتوم)':'');box.appendChild(d);
 }
 state.otherPlayers.forEach((p,id)=>{
  if(UCWVoice.peers.has(id)){
   const d=document.createElement('div');d.className='voice-user';d.textContent=(p.userData.name||'?').slice(0,2).toUpperCase();d.title=p.userData.name||'';box.appendChild(d);
  }
 });
}

// ---------- AUDIO ----------
const audio={
 ctx:null,
 ensure(){if(!this.ctx)this.ctx=new(window.AudioContext||window.webkitAudioContext)();},
 beep(freq,dur,type='sine',vol=0.2){
  this.ensure();const o=this.ctx.createOscillator(),g=this.ctx.createGain();
  o.type=type;o.frequency.value=freq;o.connect(g);g.connect(this.ctx.destination);
  g.gain.value=vol;g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+dur);
  o.start();o.stop(this.ctx.currentTime+dur);
 },
 honk(){this.beep(260,0.3,'square',0.18);setTimeout(()=>this.beep(220,0.2,'square',0.14),100);},
 engine(speed){
  if(state.audioMuted)return;
  this.ensure();if(!this.eng){
   this.eng=this.ctx.createOscillator();this.engGain=this.ctx.createGain();this.eng.type='sawtooth';
   this.eng.connect(this.engGain);this.engGain.connect(this.ctx.destination);this.engGain.gain.value=0.03;
   this.eng.start();
  }
  this.eng.frequency.value=60+speed*1.2;
 },
 crash(){this.beep(80,0.4,'square',0.25);this.beep(180,0.2,'sawtooth',0.15);},
 chime(){this.beep(880,0.15,'sine',0.15);setTimeout(()=>this.beep(1320,0.2,'sine',0.12),120);},
 coin(){this.beep(1200,0.1,'sine',0.2);setTimeout(()=>this.beep(1600,0.15,'sine',0.18),80);},
 toggleMute(){state.audioMuted=!state.audioMuted;document.getElementById('muteBtn').innerHTML=state.audioMuted?'🔇 فتح الصوت':'🔊 كتم الصوت';}
};

// ---------- INPUT ----------
// Keyboard
window.addEventListener('keydown',e=>{state.keys[e.code]=true;if(e.code==='KeyH')honk();if(e.code==='KeyC')cycleCam();if(e.code==='Space')state.handbrake=true;});
window.addEventListener('keyup',e=>{state.keys[e.code]=false;if(e.code==='Space')state.handbrake=false;});
function readKB(){
 const fwd=(state.keys['KeyW']||state.keys['ArrowUp'])?1:0;
 const back=(state.keys['KeyS']||state.keys['ArrowDown'])?1:0;
 const left=(state.keys['KeyA']||state.keys['ArrowLeft'])?1:0;
 const right=(state.keys['KeyD']||state.keys['ArrowRight'])?1:0;
 state.throttle=(fwd-back) + (state.throttleVirtual||0);
 state.steerTarget=(right-left) + (state.steerVirtual||0);
 state.steerTarget=Math.max(-1,Math.min(1,state.steerTarget));
 state.throttle=Math.max(-1,Math.min(1,state.throttle));
 state.brakeInput=Math.max(state.brakeVirtual||0,back);
 if(state.keys['ShiftLeft'])state.nitro=true;else state.nitro=state.nitroVirtual||false;
}
// On-screen pedals (touch)
function bindHold(id,key){
 const el=document.getElementById(id);
 const set=(v)=>{if(key==='gas')state.throttleVirtual=v;if(key==='brake')state.brakeVirtual=v;el.classList.toggle('active',!!v);};
 ['pointerdown','touchstart'].forEach(ev=>el.addEventListener(ev,e=>{e.preventDefault();set(1);}));
 ['pointerup','pointerleave','touchend','touchcancel'].forEach(ev=>el.addEventListener(ev,e=>{e.preventDefault();set(0);}));
}
bindHold('gasBtn','gas');bindHold('brakeBtn','brake');
// Nitro
const nbtn=document.getElementById('nitroBtn');
function setNitro(v){state.nitroVirtual=v;nbtn.classList.toggle('active',!!v);}
['pointerdown','touchstart'].forEach(ev=>nbtn.addEventListener(ev,e=>{e.preventDefault();setNitro(1);}));
['pointerup','pointerleave','touchend','touchcancel'].forEach(ev=>nbtn.addEventListener(ev,e=>{e.preventDefault();setNitro(0);}));
// Horn
document.getElementById('hornBtn').addEventListener('click',()=>honk());
// Camera
document.getElementById('camBtn').addEventListener('click',()=>cycleCam());
// Steering wheel (virtual)
const wheelCv=document.getElementById('wheel');const wctx=wheelCv.getContext('2d');
function sizeWheel(){const r=wheelCv.parentElement.getBoundingClientRect();wheelCv.width=r.width;wheelCv.height=r.height;drawWheel(0);}
function drawWheel(ang){
 const w=wheelCv.width,h=wheelCv.height,cx=w/2,cy=h/2,r=Math.min(w,h)/2-4;
 wctx.clearRect(0,0,w,h);
 wctx.save();wctx.translate(cx,cy);wctx.rotate(ang);
 // Outer ring
 wctx.beginPath();wctx.arc(0,0,r,0,Math.PI*2);wctx.lineWidth=10;wctx.strokeStyle='#1a1a1a';wctx.stroke();
 wctx.beginPath();wctx.arc(0,0,r,0,Math.PI*2);wctx.lineWidth=2;wctx.strokeStyle='#444';wctx.stroke();
 // Spokes
 wctx.strokeStyle='#1a1a1a';wctx.lineWidth=10;wctx.lineCap='round';
 for(let k=0;k<3;k++){const a=k*(Math.PI*2/3);wctx.beginPath();wctx.moveTo(0,0);wctx.lineTo(Math.cos(a)*r*0.8,Math.sin(a)*r*0.8);wctx.stroke();}
 // Center
 wctx.beginPath();wctx.arc(0,0,r*0.25,0,Math.PI*2);wctx.fillStyle='#1a1a1a';wctx.fill();
 wctx.fillStyle='#ccc';wctx.font='bold 14px Arial';wctx.textAlign='center';wctx.textBaseline='middle';wctx.fillText('T',0,0);
 wctx.restore();
}
let wheelActive=false,wheelCenter={x:0,y:0};
wheelCv.addEventListener('pointerdown',e=>{wheelActive=true;const r=wheelCv.getBoundingClientRect();wheelCenter={x:r.left+r.width/2,y:r.top+r.height/2};wheelCv.setPointerCapture(e.pointerId);});
wheelCv.addEventListener('pointermove',e=>{if(!wheelActive)return;const dx=e.clientX-wheelCenter.x;const dy=e.clientY-wheelCenter.y;const ang=Math.atan2(dy,dx)+Math.PI/2;state.steerVirtual=Math.max(-1,Math.min(1,dx/(wheelCv.width/2.5)));drawWheel(state.steerVirtual*1.2);});
wheelCv.addEventListener('pointerup',e=>{wheelActive=false;state.steerVirtual=0;drawWheel(0);});
wheelCv.addEventListener('pointercancel',()=>{wheelActive=false;state.steerVirtual=0;drawWheel(0);});
window.addEventListener('resize',sizeWheel);

// ---------- PHYSICS / UPDATE ----------
function updateCar(dt){
 if(!playerCar)return;
 readKB();
 const targetSteer=(state.steerTarget||state.steerVirtual||0)*playerProps.steerMax;
 playerCar.userData.steerAngle+=(targetSteer-playerCar.userData.steerAngle)*Math.min(1,dt*playerProps.steerReturn);
 state.steer=playerCar.userData.steerAngle;
 const boost=state.nitro?1.7:1;
 state.nitroBoost+=(boost-state.nitroBoost)*Math.min(1,dt*4);
 const maxV=playerProps.maxSpeed*state.nitroBoost;
 // Apply throttle/brake
 if(state.throttle>0){playerCar.userData.vf+=playerProps.accel*state.throttle*dt;}
 else if(state.brakeInput>0){playerCar.userData.brakeInput=state.brakeInput;playerCar.userData.vf-=playerProps.brakeForce*state.brakeInput*dt;}
 else{// drag
  playerCar.userData.vf*=Math.pow(0.5,dt);
 }
 if(state.handbrake){playerCar.userData.vf*=Math.pow(0.05,dt);}
 playerCar.userData.vf=Math.max(-15,Math.min(maxV,playerCar.userData.vf));
 state.speedKmh=playerCar.userData.vf*3.6;
 state.distanceDriven+=Math.abs(playerCar.userData.vf)*dt/1000;
 // Lateral grip / slip
 const steerFactor=playerCar.userData.vf/playerProps.maxSpeed;
 const turn=playerCar.userData.steerAngle*steerFactor;
 const fwd=new THREE.Vector3(Math.sin(playerCar.rotation.y),0,Math.cos(playerCar.rotation.y));
 const right=new THREE.Vector3(fwd.z,0,-fwd.x);
 // Slip speed
 playerCar.userData.vs*=Math.pow(1-playerProps.lateralGrip*0.2,dt*60);
 // Move
 const vel=fwd.clone().multiplyScalar(playerCar.userData.vf*dt).add(right.clone().multiplyScalar(playerCar.userData.vs*dt));
 const prev=playerCar.position.clone();
 playerCar.position.add(vel);
 playerCar.rotation.y+=turn*dt*(playerCar.userData.vf>=0?1:-1)*1.2;
 // Collision with buildings — simple AABB
 let hit=false;
 const px=playerCar.position.x,pz=playerCar.position.z;const pr=1.5;
 for(const c of colliders){
  if(Math.abs(px-c.x)<c.w/2+pr && Math.abs(pz-c.z)<c.d/2+pr){hit=true;break;}
 }
 if(hit){
  playerCar.position.copy(prev);
  playerCar.userData.vf*=-0.2;
  playerCar.userData.vs*=-0.3;
  state.hadCrash=true;audio.crash();
 }
 // City boundary
 if(Math.abs(playerCar.position.x)>CITY-5||Math.abs(playerCar.position.z)>CITY-5){
  playerCar.position.copy(prev);playerCar.userData.vf=0;
 }
 // Spin wheels & turn front wheels visually
 const wr=playerCar.userData.wheelRadius;
 playerCar.userData.wheelRot+=playerCar.userData.vf*dt/wr;
 playerCar.userData.wheels.forEach((w,i)=>{w.rotation.x=playerCar.userData.wheelRot;});
 // Apply steering to front wheels (indices 0,1)
 playerCar.userData.wheels[0].rotation.z=playerCar.userData.steerAngle;
 playerCar.userData.wheels[1].rotation.z=playerCar.userData.steerAngle;
 audio.engine(Math.abs(state.speedKmh));
 // Missions / checkpoints
 updateMissions(dt);
}

function updateMissions(dt){
 if(!playerCar)return;
 // Parking detection
 if(state.parkingZone){
  const local=state.parkingZone.worldToLocal(playerCar.position.clone());
  const speed=Math.abs(state.speedKmh);
  if(Math.abs(local.x)<3 && Math.abs(local.z)<2 && speed<6){
   state.parkedCorrectly+=dt;
   if(state.parkedCorrectly>1.5 && speed<5){
    state.parkingZone.material.color.setHex(0xffff00);
    if(!state.parkingReported){
     state.parkingReported=true;
     api('/telemetry',{method:'POST',body:{event:'parking_complete',data:{code:'parking_basic',speedKmh:speed,distance:Math.hypot(local.x,local.z)}}}).then(r=>{
      if(r.validated){toast('✅ مهمة الركنة: +'+r.rewardYER+' YER');audio.coin();refreshMe();}
     });
    }
   }
  }else{state.parkedCorrectly=0;if(!state.parkingReported)state.parkingZone.material.color.setHex(0x06d6a0);}
 }
 // Delivery checkpoints
 state.checkpointsObjs.forEach(cp=>{
  if(cp.userData.taken)return;
  const d=cp.position.distanceTo(playerCar.position);
  if(d<5){
   cp.userData.taken=true;
   cp.material.color.setHex(0x888888);cp.material.emissive.setHex(0x222222);
   state.checkpoints.add(cp.userData.idx);audio.chime();
   toast('📦 نقطة '+state.checkpoints.size+'/'+state.deliveryTotal);
   if(state.checkpoints.size>=state.deliveryTotal){
    api('/telemetry',{method:'POST',body:{event:'delivery_complete',data:{code:'city_delivery',checkpoints:state.checkpoints.size,distanceKm:state.distanceDriven,crashes:state.hadCrash?1:0}}}).then(r=>{
     if(r.validated){toast('✅ توصيل: +'+r.rewardYER+' YER');audio.coin();refreshMe();}
     else{toast('⚠️ يجب إكمال التوصيل بدون اصطدامات');}
     // reset
     state.checkpoints.clear();
     state.checkpointsObjs.forEach(c=>{c.userData.taken=false;c.material.color.setHex(0xffd166);c.material.emissive.setHex(0xffaa00);});
    });
   }
  }
 });
 // Speed mission
 if(Math.abs(state.speedKmh)>200 && !state.speedReported){
  state.speedReported=true;
  api('/telemetry',{method:'POST',body:{event:'speed_reached',data:{code:'speed_run',speedKmh:Math.abs(state.speedKmh)}}}).then(r=>{if(r.validated){toast('🏎️ سرعة 200: +'+r.rewardYER+' YER');audio.coin();refreshMe();}});
 }
 // Distance mission every 100m
 if(state.distanceDriven>=5 && !state.distReported){
  state.distReported=true;
  api('/telemetry',{method:'POST',body:{event:'distance_driven',data:{km:state.distanceDriven}}}).then(r=>{if(r.validated){toast('🛣️ جولة طويلة: +'+r.rewardYER+' YER');audio.coin();refreshMe();}});
 }
 // Clean drive after 2km
 if(state.distanceDriven>=2 && !state.cleanReported && !state.hadCrash){
  state.cleanReported=true;
  api('/telemetry',{method:'POST',body:{event:'clean_drive_complete',data:{km:state.distanceDriven,hadCrash:state.hadCrash}}}).then(r=>{if(r.validated){toast('🛡️ قيادة آمنة: +'+r.rewardYER+' YER');audio.coin();refreshMe();}});
 }
 // Odometer/XP for km (passive)
 if(!state.lastKm)state.lastKm=0;
 if(state.distanceDriven-state.lastKm>1){
  state.lastKm=state.distanceDriven;
  api('/telemetry',{method:'POST',body:{event:'distance_driven',data:{km:state.distanceDriven}}}).catch(()=>{});
 }
}

function honk(){audio.honk();if(socket&&socket.connected)socket.emit('honk');}
function cycleCam(){state.camMode=(state.camMode+1)%5;}

function updateCamera(dt){
 if(!playerCar)return;
 const car=playerCar;
 const fwd=new THREE.Vector3(Math.sin(car.rotation.y),0,Math.cos(car.rotation.y));
 const up=new THREE.Vector3(0,1,0);
 let target=new THREE.Vector3();
 let lookAt=new THREE.Vector3();
 const head=car.position.clone().add(new THREE.Vector3(0,car.userData.height*0.8,0));
 if(state.camMode===0){ // bumper
  target.copy(car.position).add(fwd.clone().multiplyScalar(1.2)).add(up.clone().multiplyScalar(0.6));
  lookAt.copy(car.position).add(fwd.clone().multiplyScalar(20));
 }else if(state.camMode===1){ // hood
  target.copy(head).add(up.clone().multiplyScalar(0.2));
  lookAt.copy(car.position).add(fwd.clone().multiplyScalar(20)).add(up.clone().multiplyScalar(1));
 }else if(state.camMode===2){ // chase low
  target.copy(car.position).add(fwd.clone().multiplyScalar(-6)).add(up.clone().multiplyScalar(2.5));
  lookAt.copy(head).add(fwd.clone().multiplyScalar(8));
 }else if(state.camMode===3){ // chase high
  target.copy(car.position).add(fwd.clone().multiplyScalar(-9)).add(up.clone().multiplyScalar(5));
  lookAt.copy(head).add(fwd.clone().multiplyScalar(10));
 }else{ // cinematic far
  target.copy(car.position).add(fwd.clone().multiplyScalar(-14)).add(up.clone().multiplyScalar(8)).add(new THREE.Vector3(Math.sin(clock.elapsedTime*0.2)*4,0,Math.cos(clock.elapsedTime*0.2)*4));
  lookAt.copy(head);
 }
 camera.position.lerp(target,Math.min(1,dt*6));
 camera.lookAt(lookAt);
}

// ---------- MINIMAP ----------
const mm=document.getElementById('minimap');const mmctx=mm.getContext('2d');
function sizeMinimap(){const s=mm.parentElement.clientWidth;mm.width=s;mm.height=s;}
function drawMinimap(){
 if(!playerCar)return;
 const s=mm.width;const scale=s/(400);
 mmctx.clearRect(0,0,s,s);
 mmctx.fillStyle='#0e1825';mmctx.fillRect(0,0,s,s);
 mmctx.strokeStyle='#3a5578';mmctx.lineWidth=1;
 for(let i=-CITY;i<=CITY;i+=BLOCK){
  mmctx.beginPath();const x=(i-playerCar.position.x)*scale+s/2;mmctx.moveTo(x,0);mmctx.lineTo(x,s);mmctx.stroke();
  mmctx.beginPath();const y=(i-playerCar.position.z)*scale+s/2;mmctx.moveTo(0,y);mmctx.lineTo(s,y);mmctx.stroke();
 }
 // Checkpoints
 state.checkpointsObjs.forEach(cp=>{
  const x=(cp.position.x-playerCar.position.x)*scale+s/2;
  const y=(cp.position.z-playerCar.position.z)*scale+s/2;
  mmctx.fillStyle=cp.userData.taken?'#444':'#ffd166';mmctx.beginPath();mmctx.arc(x,y,4,0,Math.PI*2);mmctx.fill();
 });
 // Parking
 if(state.parkingZone){
  const x=(state.parkingZone.position.x-playerCar.position.x)*scale+s/2;
  const y=(state.parkingZone.position.z-playerCar.position.z)*scale+s/2;
  mmctx.fillStyle='#06d6a0';mmctx.fillRect(x-3,y-3,6,6);
 }
 // Other players
 state.otherPlayers.forEach(p=>{
  const x=(p.position.x-playerCar.position.x)*scale+s/2;
  const y=(p.position.z-playerCar.position.z)*scale+s/2;
  if(x<-10||x>s+10||y<-10||y>s+10)return;
  mmctx.fillStyle='#ef476f';mmctx.beginPath();mmctx.arc(x,y,4,0,Math.PI*2);mmctx.fill();
 });
 // Traffic
 state.trafficCars.forEach(t=>{
  const x=(t.position.x-playerCar.position.x)*scale+s/2;
  const y=(t.position.z-playerCar.position.z)*scale+s/2;
  if(x<-5||x>s+5||y<-5||y>s+5)return;
  mmctx.fillStyle='#ffffff';mmctx.fillRect(x-1,y-1,2,2);
 });
 // Player (rotated arrow)
 mmctx.save();mmctx.translate(s/2,s/2);mmctx.rotate(-playerCar.rotation.y);
 mmctx.fillStyle='#06d6a0';mmctx.beginPath();mmctx.moveTo(0,-8);mmctx.lineTo(6,6);mmctx.lineTo(0,3);mmctx.lineTo(-6,6);mmctx.closePath();mmctx.fill();
 mmctx.restore();
}

// ---------- HUD UPDATE ----------
function updateHUD(){
 document.getElementById('hspeed').textContent=Math.round(Math.abs(state.speedKmh));
 const gear=state.speedKmh<0?'R':'D';
 document.getElementById('hgear').textContent=state.handbrake?'P':gear;
 if(state.me){
  document.getElementById('hname').textContent=state.me.username;
  document.getElementById('hlvl').textContent='Lv. '+state.me.level+' • XP '+state.me.xp;
  const needed=state.me.level*100;
  document.getElementById('hxp').style.width=Math.min(100,(state.me.xp/needed)*100)+'%';
  document.getElementById('hcash').textContent=Number(state.me.balanceYER).toLocaleString('en-US');
 }
}

// ---------- MAIN LOOP ----------
let mpTick=0;
function loop(){
 const dt=Math.min(clock.getDelta(),0.05);
 if(playerCar){
  updateCar(dt);
  updateCamera(dt);
 }
 updateTraffic(dt);
 updateMultiplayer(dt);
 drawMinimap();
 updateHUD();
 mpTick+=dt;
 if(mpTick>0.08 && socket && socket.connected){mpTick=0;sendPlayerState();}
 renderer.render(scene,camera);
 requestAnimationFrame(loop);
}

// ---------- API WRAPPER ----------
async function api(path,opts={}){
 const o={method:opts.method||'GET',headers:{'Content-Type':'application/json',...(CACHE.token?{'Authorization':'Bearer '+CACHE.token}:{})}};
 if(opts.body)o.body=JSON.stringify(opts.body);
 const r=await fetch(API+path,o);
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error||r.status);
 return d;
}
async function refreshMe(){
 try{
  const d=await api('/api/me');state.me=d.user;state.myCars=d.cars;
  state.me.balanceYER=d.user.balanceYER;
  const active=d.cars.find(c=>c.isActive)||d.cars[0];
  if(active && (!state.activeCar || state.activeCar.id!==active.carId || active.color!==state.activeCar.color)){
   state.activeCar=active;
   const cat=await api('/api/cars');
   const full=cat.find(c=>c.id===active.carId);
   if(full){spawnPlayerCar({...full,color:active.color||full.color});}
  }
  CACHE.user=d.user;
 }catch(e){console.error(e);}
}
async function loadMissions(){
 state.missions=await api('/api/missions');
}

// ---------- UI ----------
window.UCW={
 logout(){CACHE.token='';CACHE.user=null;location.reload();},
 toggleTraffic(){state.trafficEnabled=!state.trafficEnabled;document.getElementById('trafBtn').innerHTML=state.trafficEnabled?'🚦 المرور: مفعل':'🚦 المرور: معطل';if(state.trafficEnabled)spawnTraffic(30);else clearTraffic();},
 toggleMP(){state.mpEnabled=!state.mpEnabled;document.getElementById('mpBtn').innerHTML=state.mpEnabled?'🌐 المتعدد: مفعل':'🌐 المتعدد: معطل';if(state.mpEnabled)connectSocket();else if(socket){socket.disconnect();socket=null;state.otherPlayers.forEach(p=>worldObjects.remove(p));state.otherPlayers.clear();}},
 async claimDaily(){
  if(state.dailyClaimed)return;
  // simple: use wallet-adjust for self? use telemetry event? We'll do a chat message + credit via mission
  await api('/telemetry',{method:'POST',body:{event:'parking_complete',data:{code:'none',speedKmh:99,distance:99}}}).catch(()=>{});
  // use missions endpoint? Simpler: grant via giving player free money via an admin owner workaround? Actually we need an admin endpoint.
  // Instead — we call a generic "gift" through telemetry by awarding the player cash via a delivery trigger (simple client gift for daily login only)
  state.dailyClaimed=true;
  document.getElementById('claimGift').textContent='✅ تم الاستلام';
  toast('🎁 مكافأة يومية قريباً في تحديث الخادم');
 },
 audio
};
window.UCWUI={
 open(panel){document.querySelectorAll('.panel').forEach(p=>p.classList.remove('open'));document.getElementById('panel-'+panel)?.classList.add('open');if(panel==='dealer')renderDealer();if(panel==='garage'||panel==='home')renderGarage(panel);if(panel==='missions')renderMissions();if(panel==='economy')renderEconomy();},
 close(){document.querySelectorAll('.panel').forEach(p=>p.classList.remove('open'));},
 toggleChat(){document.getElementById('chatBox').classList.toggle('open');},
 sendChat(){
  const inp=document.getElementById('chatIn');const v=inp.value.trim();if(!v)return;
  addChatMsg(state.me.username,v);
  if(socket)socket.emit('chat_msg',{channel:'global',message:v});
  else api('/chat/global',{method:'POST',body:{message:v}}).catch(()=>{});
  inp.value='';
 }
};
window.UCWVoice=UCWVoice;
function addChatMsg(user,msg){
 const box=document.getElementById('chatMsgs');
 const d=document.createElement('div');d.className='m';d.innerHTML='<span class="u">'+esc(user)+':</span> '+esc(msg);
 box.appendChild(d);box.scrollTop=box.scrollHeight;
 while(box.children.length>60)box.removeChild(box.firstChild);
}
function esc(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

async function renderDealer(){
 if(!state.catalog.length)state.catalog=await api('/api/cars');
 const list=document.getElementById('dealerList');
 list.innerHTML=state.catalog.map(c=>{
  const owned=state.myCars.find(x=>x.carId===c.id);
  return `<div class="car-card ${owned?'owned':''}"><div class="preview" style="color:${esc(c.color)}">🚗</div>
  <div class="name">${esc(c.name)}</div><div class="cat">${esc(c.category)} • ${Math.round(c.topSpeed)} كم/س</div>
  <div class="price">${Number(c.priceYER).toLocaleString('en-US')} YER</div>
  <button ${owned?'disabled':''} onclick="buyCar(${c.id})">${owned?'مملوك':'شراء'}</button></div>`;
 }).join('');
}
async function renderGarage(panel){
 const list=document.getElementById(panel==='home'?'homeGarage':'garageList');
 const isHome=panel==='home';
 list.innerHTML=state.myCars.map(c=>{
  const color=c.color||c.defaultColor;
  return `<div class="car-card ${c.isActive?'active':''}"><div class="preview" style="color:${esc(color)}">🚗</div>
  ${c.isActive?'<div class="badge">نشطة</div>':''}
  <div class="name">${esc(c.name)}</div><div class="cat">${esc(c.category)}</div>
  ${isHome?`<div class="cat">المسافة: ${Math.round(c.odometer||0)} كم</div>`:''}
  <button onclick="activateCar(${c.id})">${c.isActive?'السيارة الحالية':'اختيار'}</button>
  ${!isHome?`<button onclick="sellCar(${c.id})" style="background:#c0392b">بيع (60%)</button>`:''}
  ${!isHome?`<div style="margin-top:6px"><input type="color" id="col_${c.id}" value="${color||'#ffffff'}"><button onclick="repaintCar(${c.id})">صبغ (25,000)</button></div>`:''}
  </div>`;
 }).join('');
 if(isHome){
  document.getElementById('homeStats').innerHTML=`
   <div class="stats-row">
    <div class="stat-box"><div class="lbl">الرصيد</div><div class="val">${Number(state.me.balanceYER).toLocaleString()}</div></div>
    <div class="stat-box"><div class="lbl">المستوى</div><div class="val">${state.me.level}</div></div>
    <div class="stat-box"><div class="lbl">سياراتي</div><div class="val">${state.myCars.length}</div></div>
    <div class="stat-box"><div class="lbl">المسافة المقطوعة</div><div class="val">${Math.round(state.distanceDriven)} كم</div></div>
   </div>`;
 }
}
async function renderMissions(){
 if(!state.missions.length)await loadMissions();
 const list=document.getElementById('missionList');
 list.innerHTML=state.missions.map(m=>`<div class="mission-item ${m.completed?'done':''}">
  <div><div class="ttl">${esc(m.title)} ${m.completed?'✅':''}</div><div class="desc">${esc(m.description)}</div></div>
  <div class="rew">+${Number(m.rewardYER).toLocaleString()} YER<br><span style="font-size:11px;color:#9ab0c7">+${m.rewardXP} XP</span></div>
 </div>`).join('')+`<p class="muted" style="margin-top:10px;font-size:12px">تُحتسب المهام تلقائياً عند تحقيق الشروط في اللعبة (القُرب من مناطق 🅿️ ونقاط 📦).</p>`;
}
async function renderEconomy(){
 const tx=await api('/wallet/transactions');
 document.getElementById('txList').innerHTML='<table style="width:100%;border-collapse:collapse"><tr><th>النوع</th><th>المبلغ</th><th>المرجع</th><th>التاريخ</th></tr>'+
  tx.map(t=>`<tr><td>${esc(t.type)}</td><td style="color:${t.amountYER<0?'#ef476f':'#06d6a0'}">${Number(t.amountYER).toLocaleString()}</td><td>${esc(t.reference)}</td><td style="color:#9ab0c7;font-size:12px">${t.created_at}</td></tr>`).join('')+'</table>';
}
async function buyCar(id){
 try{const r=await api('/garage/buy',{method:'POST',body:{carId:id}});toast('✅ تم شراء '+r.car);audio.coin();await refreshMe();renderDealer();}catch(e){toast('⚠️ '+e.message);}
}
async function activateCar(id){
 try{await api('/garage/activate',{method:'POST',body:{ownedCarId:id}});toast('✅ اخترت السيارة');await refreshMe();renderGarage('garage');}catch(e){toast('⚠️ '+e.message);}
}
async function sellCar(id){
 if(!confirm('بيع السيارة؟ ستسترد 60% من سعرها.'))return;
 try{const r=await api('/garage/sell',{method:'POST',body:{ownedCarId:id}});toast('💰 بيع: +'+r.payoutYER+' YER');audio.coin();await refreshMe();renderGarage('garage');}catch(e){toast('⚠️ '+e.message);}
}
async function repaintCar(ownedId){
 const col=document.getElementById('col_'+ownedId).value;
 try{await api('/garage/repaint',{method:'POST',body:{ownedCarId:ownedId,color:col}});toast('🎨 تم الصبغ');audio.chime();await refreshMe();renderGarage('garage');}catch(e){toast('⚠️ '+e.message);}
}
function toast(msg){
 const t=document.getElementById('toast');t.textContent=msg;t.style.display='block';clearTimeout(t._t);t._t=setTimeout(()=>t.style.display='none',2800);
}

// Chat on enter
document.getElementById('chatIn').addEventListener('keydown',e=>{if(e.key==='Enter')UCWUI.sendChat();});

// ---------- AUTH UI ----------
let authMode='login';
document.querySelectorAll('#authTabs button').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('#authTabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');
 authMode=b.dataset.a;
 document.getElementById('abtn').textContent=authMode==='login'?'دخول':'إنشاء حساب';
 document.getElementById('aemail').style.display=authMode==='reg'?'block':'none';
}));
document.getElementById('abtn').addEventListener('click',async()=>{
 const username=document.getElementById('auser').value.trim();
 const password=document.getElementById('apass').value;
 const email=document.getElementById('aemail').value.trim();
 const err=document.getElementById('aerr');err.textContent='';
 try{
  if(authMode==='reg'){
   await api('/api/auth/register',{method:'POST',body:{username,password,email:email||undefined}});
  }
  const r=await api('/api/auth/login',{method:'POST',body:{username,password}});
  CACHE.token=r.token;CACHE.user=r.user;
  startGame();
 }catch(e){err.textContent=e.message;}
});
document.getElementById('aguest').addEventListener('click',async()=>{
 // auto-register a guest
 const name='guest_'+Math.floor(Math.random()*90000+10000);
 try{
  await api('/api/auth/register',{method:'POST',body:{username:name,password:'guestpass123'}});
  const r=await api('/api/auth/login',{method:'POST',body:{username:name,password:'guestpass123'}});
  CACHE.token=r.token;CACHE.user=r.user;startGame();
 }catch(e){document.getElementById('aerr').textContent=e.message;}
});

// ---------- START GAME ----------
async function startGame(){
 document.getElementById('auth').style.display='none';
 document.getElementById('hud').style.display='block';
 setProgress(90,'تحميل سيارتك…');
 await refreshMe();
 state.catalog=await api('/api/cars');
 await loadMissions();
 buildWorld();
 // Spawn player car
 const active=state.myCars.find(c=>c.isActive)||state.myCars[0];
 const full=state.catalog.find(c=>c.id===active.carId);
 spawnPlayerCar({...full,color:active.color||full.color});
 spawnTraffic(35);
 setProgress(100,'انطلق!');
 setTimeout(()=>document.getElementById('loading').style.display='none',300);
 audio.ensure();
 connectSocket();
 // Seed chat history
 api('/chat/global').then(msgs=>msgs.slice(-20).forEach(m=>addChatMsg(m.username,m.message))).catch(()=>{});
 setTimeout(()=>toast('مرحباً '+state.me.username+'! استخدم عجلة القيادة أو الأسهم للقيادة.'),800);
}

// Auto-login if cached token
(async()=>{
 sizeWheel();sizeMinimap();
 buildWorld(); // build world even before login so it's ready
 setProgress(95,'جاهز');
 if(CACHE.token){
  try{
   const d=await api('/me');state.me=d.user;state.myCars=d.cars;CACHE.user=d.user;
   // hide auth, show HUD
   document.getElementById('auth').style.display='none';
   document.getElementById('hud').style.display='block';
   setProgress(100,'');
   setTimeout(()=>document.getElementById('loading').style.display='none',300);
   state.catalog=await api('/api/cars');
   await loadMissions();
   const active=state.myCars.find(c=>c.isActive)||state.myCars[0];
   const full=state.catalog.find(c=>c.id===active.carId);
   spawnPlayerCar({...full,color:active.color||full.color});
   spawnTraffic(35);
   audio.ensure();
   connectSocket();
   setTimeout(()=>toast('مرحباً بعودتك '+state.me.username+'!'),500);
  }catch(e){
   CACHE.token='';setProgress(100,'سجّل دخولك');
   setTimeout(()=>document.getElementById('loading').style.display='none',300);
  }
 }else{
  setProgress(100,'مرحباً بك');setTimeout(()=>document.getElementById('loading').style.display='none',300);
 }
})();

window.addEventListener('resize',()=>{
 camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();
 renderer.setSize(window.innerWidth,window.innerHeight);
 sizeMinimap();
});
// Start loop (will tick even before car spawns)
requestAnimationFrame(loop);

// expose for debug
window.UCW.state=state;window.UCW.api=api;
