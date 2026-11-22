import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
const W=innerWidth,H=innerHeight,renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(W,H);renderer.outputColorSpace=T.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.prepend(renderer.domElement);
const load=new GLTFLoader();const root='/@film/assets/';
const names=[['city-kit-commercial','building-a'],['city-kit-commercial','building-d'],['city-kit-commercial','building-f'],['city-kit-commercial','building-skyscraper-a'],['city-kit-commercial','building-skyscraper-b'],['city-kit-suburban','building-type-e'],['city-kit-suburban','tree-small'],['city-kit-roads','light-curved'],['city-kit-roads','traffic-light'],['car-kit','sedan'],['car-kit','ambulance'],['car-kit','delivery'],['train-kit','train-electric-city-a']];
const pool={},characterAssets={};await Promise.all(names.map(async ([pack,name])=>{try{const path=`${root}${pack}/Models/GLB format/${name}.glb`;const gltf=await load.loadAsync(path);pool[name]=gltf.scene;}catch(e){console.warn('asset unavailable',name,String(e));}}));
await Promise.all(['man','woman'].map(async name=>{characterAssets[name]=await load.loadAsync(`${root}${name}.glb`)}));
const coast=await (await fetch(`${root}japan-coast.json`)).json();
function model(name,height,x,z,rot=0){const source=pool[name];if(!source)throw Error(`missing asset ${name}`);const m=source.clone(true);const size=new T.Vector3();new T.Box3().setFromObject(m).getSize(size);m.scale.setScalar(height/(size.y||1));m.position.set(x,0,z);m.rotation.y=rot;m.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});return m;}
const mat=c=>new T.MeshStandardMaterial({color:c,roughness:.88});
function block(parent,x,y,z,w,h,d,c){const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat(c));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function person(group,x,z,colour,phase=0){
 const key=phase%1.3<.65?'man':'woman', asset=characterAssets[key];
 const p=cloneSkeleton(asset.scene);const clip=asset.animations.find(a=>/walk$/i.test(a.name));
 if(clip){const mixer=new T.AnimationMixer(p);mixer.clipAction(clip).play();mixer.setTime(phase);p.userData.mixer=mixer;}
 p.scale.setScalar(0.29);
 p.position.set(x,0,z);p.userData.phase=phase;p.userData.baseZ=z;group.add(p);
 p.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(Array.isArray(o.material)){o.material=o.material.map(m=>{const copy=m.clone();if(copy.name==='Shirt')copy.color.setHex(colour);return copy;});}else if(o.material?.name==='Shirt'){o.material=o.material.clone();o.material.color.setHex(colour);}}});return p;
}
function street(scene,opts={}){
 const asphalt=block(scene,0,-.14,-5,22,.25,40,0x484945);asphalt.receiveShadow=true;
 block(scene,-5,.03,-5,3.2,.18,40,0xc1b09a);block(scene,5,.03,-5,3.2,.18,40,0xc1b09a);
 for(let z=-22;z<12;z+=4)block(scene,0,.015,z,.10,.02,1.8,0xe9d1a1);
 const types=['building-a','building-d','building-f','building-skyscraper-a','building-skyscraper-b'];
 for(let side of [-1,1])for(let i=0;i<8;i++){const n=types[(i+(side>0?1:0))%types.length],b=model(n,5+(i%3)*2,side*(8+(i%2)*.5),-21+i*4.6,side===1?-Math.PI/2:Math.PI/2);scene.add(b);if(opts.shake)b.userData.shake=i*.4+side;}
 for(let z=-18;z<12;z+=8){scene.add(model('light-curved',4,-3.1,z));scene.add(model('tree-small',2.4,3.8,z));}
 // A second row closes the horizon instead of leaving the road against an empty backdrop.
 for(let i=0;i<9;i++){const b=model(types[i%types.length],5+(i%3)*1.5,-15+i*3.8,-27,0);scene.add(b);if(opts.shake)b.userData.shake=i*.3;}
 if(opts.cars!==false)for(let j=0;j<4;j++){const car=model('sedan',1.4,(j%2?1.6:-1.6),-12+j*5,j%2?0:Math.PI);scene.add(car);}
 scene.add(model('traffic-light',4,3.0,-10));return scene;
}
// The film uses empty environments; off-screen events are conveyed by narration.
function addPeople(){return [];}
function train(g,x,z){const tr=model('train-electric-city-a',2.9,x,z,0);g.add(tr);return tr;}
function station(g){
 block(g,0,-.12,-5,24,.24,38,0x8d8980);block(g,-3.2,.35,-5,3.3,.7,34,0xc8c0ad);
 for(const x of [-.8,.8])block(g,x,.08,-6,.08,.12,30,0x948f87);
 for(let z=-19;z<10;z+=1.1)block(g,0,.04,z,1.9,.08,.18,0x544c41);
 for(let z=-17;z<7;z+=5){block(g,-4.3,2.3,z,.18,4.6,.18,0x6f6559);block(g,-3,4.6,z,3,.12,.17,0x756b5c);}
 block(g,-3,4.7,-5,3.3,.2,29,0xb7ab98);block(g,-4.7,2.4,-10,.12,4.8,13,0xe1d4bc);
 for(let z=-15;z<5;z+=5){block(g,-4.6,2.5,z,.1,1.1,2.5,0x69838a);block(g,-3.0,.9,z,.7,.10,1.5,0x867765);}
 for(let i=0;i<4;i++)g.add(model('building-d',5+i%2*1.5,7,-16+i*5,-Math.PI/2));
}
function aircraft(g,x,y,z){const p=new T.Group();p.position.set(x,y,z);g.add(p);const fuselage=new T.Mesh(new T.CylinderGeometry(.48,.7,9,12),mat(0xddd5c1));fuselage.rotation.z=Math.PI/2;p.add(fuselage);block(p,0,0,0,2,.16,8,0xc5c5b9);block(p,3.6,.35,0,1.8,.12,2.8,0xc5c5b9);block(p,3.6,.9,0,1.1,1.5,.1,0xd4d2ca);for(let x=-3;x<3;x+=.8)block(p,x,.15,.61,.26,.22,.04,0x415c68);return p;}
function addSky(scene,shot){
 // A low-poly sky surrounds each set, with a different horizon for dawn and night.
 const night=shot===5,dusk=shot===6;
 const sky=new T.Mesh(new T.SphereGeometry(100,32,16),new T.ShaderMaterial({
  uniforms:{top:{value:new T.Color(night?0x263550:dusk?0x607e9b:0x79b9dc)},horizon:{value:new T.Color(night?0x8a7778:dusk?0xe9ac8e:0xe9d9c4)}},
  vertexShader:'varying vec3 vWorld; void main(){vec4 p=modelMatrix*vec4(position,1.0); vWorld=p.xyz; gl_Position=projectionMatrix*viewMatrix*p;}',
  fragmentShader:'uniform vec3 top; uniform vec3 horizon; varying vec3 vWorld; void main(){float h=normalize(vWorld-cameraPosition).y; float blend=smoothstep(-0.12,0.48,h); gl_FragColor=vec4(mix(horizon,top,blend),1.0); #include <tonemapping_fragment> #include <colorspace_fragment> }'.replaceAll(' #include','\n#include'),
  side:T.BackSide,depthWrite:false
 }));sky.frustumCulled=false;sky.renderOrder=-1;scene.add(sky);
 const cloudMat=new T.MeshBasicMaterial({color:night?0x8d98a7:dusk?0xf4c7ae:0xffffff,transparent:true,opacity:night?.34:.74,depthWrite:false});
 for(let n=0;n<9;n++){
  const cloud=new T.Group();cloud.position.set(-54+n*14,20+(n%3)*2,-43-(n%2)*5);
  for(let j=0;j<4;j++){const puff=new T.Mesh(new T.IcosahedronGeometry(1,1),cloudMat);puff.position.set((j-1.5)*1.7,j%2*.45,0);puff.scale.set(2.3,1.1+(j%2)*.35,1.15);cloud.add(puff);}scene.add(cloud);
 }
}
const mapRings=await (await fetch('/@film/map-coast.json')).json();
function label(text,color='#ffffff'){
 const c=document.createElement('canvas');c.width=512;c.height=128;const x=c.getContext('2d');x.font='bold 56px Arial';x.textAlign='center';x.lineWidth=10;x.strokeStyle='#243137';x.strokeText(text,256,81);x.fillStyle=color;x.fillText(text,256,81);
 const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;const s=new T.Sprite(new T.SpriteMaterial({map:tex,transparent:true,depthTest:false}));s.scale.set(4.5,1.125,1);return s;
}
function mapScene(i){
 const scene=new T.Scene();scene.background=new T.Color(0x89b5ad);scene.add(new T.HemisphereLight(0xffffff,0x65746a,2.5));
 const global=i===6, scale=global?.15:1, center=global?-37:-76.5, project=(lon,lat)=>[(lon-center)*scale,-(lat-45)*scale];
 const ocean=new T.Mesh(new T.PlaneGeometry(250,180),mat(0x82b3b6));ocean.rotation.x=-Math.PI/2;ocean.position.y=-.2;scene.add(ocean);
 for(const ring of mapRings){if(ring.length<3)continue;const shape=new T.Shape();ring.forEach(([lon,lat],j)=>{const [x,z]=project(lon,lat);j?shape.lineTo(x,-z):shape.moveTo(x,-z)});shape.closePath();const m=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:false}),mat(0xe4dfc7));m.rotation.x=-Math.PI/2;scene.add(m)}
 const cities=i===2?[['MONTREAL',-73.567,45.502],['TORONTO',-79.383,43.653]]:i===3?[['TORONTO',-79.383,43.653],['NEW YORK',-74.006,40.713]]:[['NEW YORK',-74.006,40.713],['PARIS',2.352,48.857]];
 const positions=[];for(const [name,lon,lat] of cities){const [x,z]=project(lon,lat);positions.push(new T.Vector3(x,.32,z));const dot=new T.Mesh(new T.SphereGeometry(.19,12,8),new T.MeshStandardMaterial({color:0xe45d36,emissive:0xa62412,emissiveIntensity:.7}));dot.position.set(x,.4,z);scene.add(dot);const l=label(name);l.position.set(x,.9,z-1);scene.add(l)}
 const [a,b]=positions,arc=[];for(let n=0;n<=40;n++){const t=n/40;arc.push(new T.Vector3(T.MathUtils.lerp(a.x,b.x,t),.45+Math.sin(t*Math.PI)*1.0,T.MathUtils.lerp(a.z,b.z,t)))}
 const line=new T.Line(new T.BufferGeometry().setFromPoints(arc),new T.LineBasicMaterial({color:0xe75839}));scene.add(line);scene.userData.route=line;return scene;
}
function hospital(g){
 block(g,0,3.8,-9,8,7.6,4,0xd8d6c9);block(g,0,7.8,-9,8.3,.45,4.3,0x788b8a);
 for(const x of [-2.8,-1.4,0,1.4,2.8])for(const y of [2,4,6])block(g,x,y,-6.96,1,.8,.1,0x7fa4af);
 block(g,0,1,-6.86,1.7,2,.18,0x425f6e);block(g,0,6.35,-6.77,1.35,.4,.16,0xd14d43);block(g,0,6.35,-6.74,.4,1.35,.16,0xd14d43);
 const sign=label('HOSPITAL','#ffffff');sign.position.set(0,8.6,-8);g.add(sign);
 const ambulance=model('ambulance',1.55,2,-1,Math.PI);g.add(ambulance);g.userData.ambulance=ambulance;
}
function publicHealth(g){
 block(g,0,3.8,-9,10,7.6,4,0xd1cbbd);block(g,0,7.8,-9,10.4,.4,4.4,0x566d7a);
 for(const x of [-4,-2,0,2,4]){block(g,x,3.7,-6.9,.22,6.9,.24,0xb3aa9c);if(x!==4)block(g,x+1,4.4,-6.88,1.4,2.3,.08,0x7695a2);}
 block(g,0,1.1,-6.8,2,2.2,.15,0x425f6e);block(g,0,6.6,-6.75,7,.8,.2,0x3f6475);
 const sign=label('PUBLIC HEALTH');sign.position.set(0,7,-6.4);g.add(sign);
}
function buildShot(i){
 if([2,3,6].includes(i))return mapScene(i);
 const scene=new T.Scene();addSky(scene,i);scene.add(new T.HemisphereLight(0xffe9d4,0x697571,2));const sun=new T.DirectionalLight(0xffe1bb,2.5);sun.position.set(-10,18,10);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-24;sun.shadow.camera.right=24;sun.shadow.camera.top=24;sun.shadow.camera.bottom=-24;scene.add(sun);
 if(i===5){station(scene);train(scene,0,-5);}
 else if(i===4){street(scene);publicHealth(scene);}
 else if(i===7){street(scene,{cars:false});const cars=[];for(let j=0;j<3;j++){const car=model('sedan',1.4,j%2?1.6:-1.6,-12+j*7,j%2?0:Math.PI);scene.add(car);cars.push(car);}scene.userData.traffic=cars;}
 else {street(scene);hospital(scene);}
 return scene;
}
const scenes=Array.from({length:8},(_,i)=>buildShot(i));
const cuts=[0,5,9,14,18,23,28,33,40];
const dates=['DAY 1','DAY 2','DAY 7','DAY 14','DAY 20','DAY 30','DAY 60','DAY 180'];
const captions=['<b>RESPIRATORY OUTBREAK</b><br>IN MONTREAL','CASES RISE<br><b>TESTING EXPANDS</b>','<b>LOCAL SPREAD</b><br>REACHES TORONTO','INFECTIONS SPREAD<br><b>IN NEW YORK</b>','<b>CANADA COORDINATES</b><br>ITS RESPONSE','<b>TRAVEL & SERVICES</b><br>DISRUPTED','LOCAL SPREAD<br><b>REACHES PARIS</b>','INFECTIONS FALL<br><b>HOSPITALS RECOVER</b>'];
const cameras=[{p:[1,4,12],q:[0,3,-9],d:[-1,.1,-2]},{p:[-5,3,5],q:[0,4,-9],d:[1,.4,-1]},{p:[0,20,15],q:[0,0,0],d:[0,-1,-1]},{p:[0,20,15],q:[0,0,0],d:[0,-1,-1]},{p:[5,5,6],q:[0,4,-9],d:[-1,.4,-1]},{p:[6,3.2,8],q:[0,1.8,-5],d:[-1,.1,-.5]},{p:[0,27,18],q:[0,0,0],d:[0,-1,-1]},{p:[-3,3,12],q:[0,4,-9],d:[1,.4,-2]}];
const camera=new T.PerspectiveCamera(46,W/H,.1,150);
const shotParam=new URLSearchParams(location.search).get('shot');const selectedShot=shotParam===null?-1:Number(shotParam);
if(selectedShot!==-1&&(!Number.isInteger(selectedShot)||selectedShot<0||selectedShot>=8))throw new Error('Invalid shot');
window.DUR=selectedShot<0?40:cuts[selectedShot+1]-cuts[selectedShot];
window.render=(localTime)=>{
 const time=selectedShot<0?localTime:cuts[selectedShot]+localTime;let shot=Math.max(0,cuts.findIndex((v,i)=>i<8&&time>=v&&time<cuts[i+1]));const local=Math.max(0,time-cuts[shot]),scene=scenes[shot],c=cameras[shot],glide=Math.min(local/5,1);
 camera.position.set(c.p[0]+c.d[0]*glide,c.p[1]+c.d[1]*glide,c.p[2]+c.d[2]*glide);camera.lookAt(...c.q);
 if(scene.userData.route)scene.userData.route.geometry.setDrawRange(0,Math.min(41,Math.max(2,Math.floor(local*14))));
 if(scene.userData.ambulance)scene.userData.ambulance.position.z=-1+local*.5;
 if(scene.userData.traffic)scene.userData.traffic.forEach((car,j)=>{car.position.z=-12+j*7+(j%2?-1:1)*local*.8});
 document.querySelector('#date').textContent=dates[shot];document.querySelector('#caption').innerHTML=captions[shot];renderer.render(scene,camera);
};window.READY=true;window.render(0);
