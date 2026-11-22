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
function buildShot(i){const scene=new T.Scene();addSky(scene,i);scene.add(new T.HemisphereLight(0xffe7c8,0x6e716f,2));const sun=new T.DirectionalLight(i===5?0xffb268:0xffe2b3,2.5);sun.position.set(-10,18,10);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-24;sun.shadow.camera.right=24;sun.shadow.camera.top=24;sun.shadow.camera.bottom=-24;scene.add(sun);const people=[];
 if([0,2,6].includes(i))street(scene,{shake:i===0||i===6});if(i===3||i===7)station(scene);
 if(i===0){people.push(...addPeople(scene,3,-5));const projected=new T.PointLight(0xff9b3f,22,15,2);projected.position.set(-4,4,-8);scene.add(projected);scene.userData.projected=projected;}
 if(i===1){block(scene,0,-.3,0,45,.5,45,0xb69d7b);block(scene,0,-.03,-10,45,.15,16,0x5b99a0);const pole=block(scene,1,3.1,-2,.15,6.2,.15,0x595959);pole.castShadow=true;block(scene,1,6.4,-2,.95,.6,.7,0xcea64f);const beacon=block(scene,1,6.74,-2,.95,.13,.7,0xb84331);scene.userData.beacon=beacon;for(let j=0;j<5;j++)scene.add(model('building-type-e',3.5,-8+j*4,-5));people.push(...addPeople(scene,4,1));}
 if(i===2)people.push(...addPeople(scene,16,-1));
 if(i===3){const bulbs=[];for(let z=-12;z<6;z+=5){const bulb=new T.Mesh(new T.SphereGeometry(.17,12,8),new T.MeshStandardMaterial({color:0xffe9aa,emissive:0xffcc55,emissiveIntensity:1}));bulb.position.set(-3,4.4,z);scene.add(bulb);bulbs.push(bulb);}scene.userData.bulbs=bulbs;const t=train(scene,0,-5);t.rotation.y=0;const riders=addPeople(scene,4,1);riders.forEach((p,j)=>{p.position.x=-3.1-(j%2)*.6;p.position.y=.7;});people.push(...riders);}
 if(i===4){street(scene);const water=new T.Mesh(new T.PlaneGeometry(38,32),new T.MeshStandardMaterial({color:0x4b8990,transparent:true,opacity:.87,roughness:.35,metalness:.1}));water.rotation.x=-Math.PI/2;water.position.set(0,.36,-4);scene.add(water);scene.userData.water=water;}
 if(i===5){block(scene,0,-.1,0,45,.2,45,0x767368);for(let n=-3;n<=3;n++)block(scene,0,.02,n*4,.2,.02,2.3,0xf2e1bc);block(scene,0,2,-10,20,4,4,0xc9bfaa);for(let j=0;j<7;j++)block(scene,-8+j*2.6,2.2,-7.95,1.8,1.8,.1,0x597682);aircraft(scene,0,2,-3);scene.add(model('delivery',2.1,5,3,-Math.PI/2));for(let j=0;j<6;j++)block(scene,-4+j*1.2,.55,2,1,.9,1,0x9c7b56);people.push(...addPeople(scene,6,-1));}
 if(i===6){people.push(...addPeople(scene,3,-2));for(let j=0;j<4;j++)block(scene,-2+j*1.2,.6,-4,.7,1.2,.7,0xd68d50);}
 if(i===7){const tr=train(scene,0,-4);tr.rotation.y=0;scene.userData.train=tr;const riders=addPeople(scene,7,1);riders.forEach((p,j)=>{p.position.x=-3.1-(j%2)*.6;p.position.y=.7;});people.push(...riders);}
 scene.userData.people=people;return scene;}
const locator=new T.Scene();locator.background=new T.Color(0xe6d1ae);locator.add(new T.HemisphereLight(0xffffff,0x61706b,2.5));const mapSun=new T.DirectionalLight(0xffe4b7,2);mapSun.position.set(-6,12,7);locator.add(mapSun);const ocean=new T.Mesh(new T.PlaneGeometry(35,35),mat(0x89b5ad));ocean.rotation.x=-Math.PI/2;ocean.position.y=-.2;locator.add(ocean);
for(const ring of coast){if(ring.length<3)continue;const shape=new T.Shape();ring.forEach(([lon,lat],i)=>{const x=(lon-138)*.5,y=(lat-36)*.5;i?shape.lineTo(x,y):shape.moveTo(x,y)});shape.closePath();const mesh=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:false}),mat(0xe8dfc5));mesh.rotation.x=-Math.PI/2;locator.add(mesh);}
const epicenter=new T.Mesh(new T.SphereGeometry(.14,12,8),new T.MeshStandardMaterial({color:0xe35a31,emissive:0xb42c13,emissiveIntensity:.4}));epicenter.position.set((142.4-138)*.5,.3,-(38.3-36)*.5);locator.add(epicenter);
const scenes=Array.from({length:8},(_,i)=>buildShot(i));
const cuts=[0,5,9,14,18,23,28,33,40];const dates=['DAY 1 · 06:42','DAY 1 · 06:45','DAY 1 · 07:00','DAY 1 · 07:18','DAY 1 · 07:35','DAY 2 · 02:00','DAY 2 · 19:20','DAY 4 · 06:20'];
const captions=['<b>M7.8 EARTHQUAKE</b><br>OFF MIYAGI','<b>TSUNAMI WARNING</b><br>ISSUED','<b>EVACUATIONS</b><br>IN ISHINOMAKI','SENDAI<br><b>LOSES POWER</b>','<b>FLOODWATER</b><br>REACHES THE COAST','<b>RESCUE TEAMS</b><br>ARRIVE','ANOTHER <b>AFTERSHOCK</b><br>HITS','RAIL SERVICE<br><b>RETURNS</b>'];
const cameras=[{p:[.7,2.5,11],q:[0,1.8,-8],d:[.5,.1,-1]},{p:[7,4,9],q:[1,3,-3],d:[-1,.1,-.5]},{p:[-1,2.6,6],q:[0,1.6,-5],d:[1,.1,-1]},{p:[6,3.2,8],q:[0,1.8,-5],d:[-1,.1,-.5]},{p:[14,17,15],q:[0,.5,-4],d:[-2,-1,-1]},{p:[12,3.2,10],q:[0,1,-3],d:[-1,.1,-.8]},{p:[-3,2.3,9],q:[0,2.4,-4],d:[.7,.2,-1]},{p:[-5,3,8],q:[0,1.5,-3],d:[-1,.1,-.7]}];
const camera=new T.PerspectiveCamera(46,W/H,.1,150);
const shotParam=new URLSearchParams(location.search).get('shot');
const selectedShot=shotParam===null ? -1 : Number(shotParam);
if(selectedShot!==-1 && (!Number.isInteger(selectedShot)||selectedShot<0||selectedShot>=8))throw new Error('Invalid shot');
window.DUR=selectedShot<0?40:cuts[selectedShot+1]-cuts[selectedShot];
window.render=(localTime)=>{const time=selectedShot<0?localTime:cuts[selectedShot]+localTime;let shot=Math.max(0,cuts.findIndex((v,i)=>i<8&&time>=v&&time<cuts[i+1]));const local=Math.max(0,time-cuts[shot]);const scene=(shot===0&&time<1.5)?locator:scenes[shot],c=cameras[shot];const glide=Math.min(local/5,1);camera.position.set(c.p[0]+c.d[0]*glide,c.p[1]+c.d[1]*glide,c.p[2]+c.d[2]*glide);camera.lookAt(...c.q);if(scene===locator){camera.position.set(1,14,11);camera.lookAt(0,0,0);}
 if(scene.userData.beacon)scene.userData.beacon.material.color.setHex(Math.sin(local*8)>0?0xff6347:0x8e2922);if(scene.userData.bulbs)scene.userData.bulbs.forEach(b=>{b.material.emissiveIntensity=local<1.2?1:0;b.material.color.setHex(local<1.2?0xffe9aa:0x55524a)});if(scene.userData.projected)scene.userData.projected.intensity=12+8*(.5+.5*Math.sin(local*3));scene.traverse(o=>{if(o.userData.shake!==undefined)o.rotation.z=Math.sin(local*14+o.userData.shake)*.018*Math.max(0,1-local/4);});
 // People face down the street/platform, so their position must advance in that
 // direction as their walk cycles play. Keep it time-based for parallel rendering.
 for(const p of (scene.userData.people||[])){p.position.z=p.userData.baseZ-local*.9;p.userData.mixer?.setTime(local+p.userData.phase);}

 if(scene.userData.water)scene.userData.water.position.y=.3+Math.min(local*.1,.45);if(scene.userData.train)scene.userData.train.position.z=-4+local*.4;
 document.querySelector('#date').textContent=dates[shot];document.querySelector('#caption').innerHTML=captions[shot];renderer.render(scene,camera);};
window.DEBUG_SCENES=scenes;window.DEBUG_THREE=T;window.READY=true;window.render(0);
