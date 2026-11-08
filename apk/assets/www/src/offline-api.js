// Offline API for APK single-player mode — falls back when backend unreachable
// Provides in-memory/localStorage-backed mock of the server endpoints.
(function(){
 const KEY='ucw_offline_db_v1';
 function load(){try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch(e){return null;}}
 function save(db){localStorage.setItem(KEY,JSON.stringify(db));}
 function init(){
  let db=load();
  if(db)return db;
  db={users:[],nextUserId:1,cars:[],playerCars:[],transactions:[],missions:[],chat:[],meId:null};
  // Seed cars
  const cars=[
   {id:1,code:'ucw-compact-01',name:'Sahm Compact',category:'Compact',priceYER:850000,stock:-1,enabled:1,description:'سيارة اقتصادية.',topSpeed:180,accel:10,handling:0.9,color:'#d4a574'},
   {id:2,code:'ucw-sedan-01',name:'Naseem Sedan',category:'Sedan',priceYER:1450000,stock:-1,enabled:1,description:'سيدان.',topSpeed:210,accel:13,handling:0.88,color:'#2c3e50'},
   {id:3,code:'ucw-sport-01',name:'Rimal Sport',category:'Sport',priceYER:4200000,stock:-1,enabled:1,description:'رياضية.',topSpeed:280,accel:18,handling:0.82,color:'#c0392b'},
   {id:4,code:'ucw-suv-01',name:'Jabal SUV',category:'SUV',priceYER:3600000,stock:-1,enabled:1,description:'SUV.',topSpeed:200,accel:11,handling:0.80,color:'#1a5276'},
   {id:5,code:'ucw-pickup-01',name:'Wadi Pickup',category:'Pickup',priceYER:2750000,stock:-1,enabled:1,description:'شاحنة.',topSpeed:190,accel:10,handling:0.78,color:'#7b7d19'},
   {id:6,code:'ucw-supra-00',name:'UCW Supra GT',category:'Sport',priceYER:6500000,stock:-1,enabled:1,description:'رياضية فائقة.',topSpeed:310,accel:20,handling:0.80,color:'#0a0a0a'},
   {id:7,code:'ucw-luxury-01',name:'Malik Luxury',category:'Luxury',priceYER:8000000,stock:-1,enabled:1,description:'فاخرة.',topSpeed:250,accel:12,handling:0.92,color:'#1a1a1a'}
  ];
  db.cars=cars;
  const missions=[
   {id:1,code:'parking_basic',title:'ركنة دقيقة',description:'أكمل الركنة.',rewardYER:15000,rewardXP:30,type:'parking',target:5,enabled:1},
   {id:2,code:'city_delivery',title:'توصيل المدينة',description:'أكمل التوصيل.',rewardYER:25000,rewardXP:50,type:'delivery',target:3,enabled:1},
   {id:3,code:'clean_drive',title:'قيادة آمنة',description:'اركب بأمان.',rewardYER:10000,rewardXP:20,type:'nodamage',target:2,enabled:1},
   {id:4,code:'speed_run',title:'تحدي السرعة',description:'200 كم/س.',rewardYER:20000,rewardXP:40,type:'speed',target:200,enabled:1},
   {id:5,code:'long_drive',title:'جولة طويلة',description:'5 كم.',rewardYER:30000,rewardXP:60,type:'distance',target:5,enabled:1}
  ];
  db.missions=missions;
  save(db);
  return db;
 }
 let db=init();
 let completedMissions=new Set();

 function getMe(){
  if(!db.meId){
   const u={id:1,username:'Hussein',email:'',role:'owner',balanceYER:1250000,level:25,xp:1360,banned:0,createdAt:Date.now()};
   db.users.push(u);db.meId=u.id;
   db.playerCars.push({id:1,userId:u.id,carId:1,nickname:'',isActive:1,odometer:0,crashes:0,color:cars0_color(db)});
   db.playerCars.push({id:2,userId:u.id,carId:6,nickname:'',isActive:0,odometer:120,crashes:0,color:'#0a0a0a'});
   save(db);
  }
  return db.users.find(u=>u.id===db.meId);
 }
 function cars0_color(){return '#d4a574';}

 async function fauxFetch(path,opts={}){
  await new Promise(r=>setTimeout(r,40));
  const body=opts.body?JSON.parse(opts.body):{};
  const me=getMe();
  const auth=()=>{/*always ok offline*/};
  auth();
  // Routes
  if(path==='/health')return {ok:true,json:async()=>({status:'ok',service:'ucw-offline',version:'1.2.0-offline'})};
  if(path==='/api/auth/login'||path==='/api/auth/register'){
   return {ok:true,json:async()=>({token:'offline-token',user:{id:me.id,username:me.username,role:me.role,balanceYER:me.balanceYER,level:me.level,xp:me.xp}})};
  }
  if(path==='/api/me'){
   const cars=db.playerCars.filter(p=>p.userId===me.id).map(p=>{
    const c=db.cars.find(x=>x.id===p.carId);
    return {id:p.id,nickname:p.nickname,isActive:p.isActive,carId:c.id,name:c.name,code:c.code,category:c.category,topSpeed:c.topSpeed,accel:c.accel,handling:c.handling,color:p.color||c.color,defaultColor:c.color,odometer:p.odometer||0};
   });
   return {ok:true,json:async()=>({user:{id:me.id,username:me.username,email:me.email,role:me.role,balanceYER:me.balanceYER,level:me.level,xp:me.xp,createdAt:me.createdAt},cars})};
  }
  if(path==='/api/cars')return {ok:true,json:async()=>db.cars.filter(c=>c.enabled).map(c=>({id:c.id,code:c.code,name:c.name,category:c.category,priceYER:c.priceYER,stock:c.stock,description:c.description,topSpeed:c.accel?c.topSpeed:220,accel:c.accel||12,handling:c.handling||0.85,color:c.color}))};
  if(path==='/api/missions'){
   const arr=db.missions.filter(m=>m.enabled).map(m=>({id:m.id,code:m.code,title:m.title,description:m.description,rewardYER:m.rewardYER,rewardXP:m.rewardXP,type:m.type,target:m.target,completed:completedMissions.has(m.code)}));
   return {ok:true,json:async()=>arr};
  }
  if(path==='/garage/buy'){
   const c=db.cars.find(x=>x.id===body.carId);if(!c)return {ok:false,json:async()=>({error:'CAR_NOT_AVAILABLE'})};
   if(c.priceYER>me.balanceYER)return {ok:false,status:400,json:async()=>({error:'INSUFFICIENT_FUNDS'})};
   me.balanceYER-=c.priceYER;
   const id=db.playerCars.length?Math.max(...db.playerCars.map(p=>p.id))+1:1;
   db.playerCars.push({id,userId:me.id,carId:c.id,nickname:'',isActive:0,color:c.color,odometer:0,crashes:0});
   db.transactions.push({id:Date.now(),userId:me.id,type:'car_purchase',amountYER:-c.priceYER,reference:c.code,createdAt:new Date().toISOString()});
   save(db);
   return {ok:true,json:async()=>({purchased:true,ownedCarId:id,car:c.name,priceYER:c.priceYER})};
  }
  if(path==='/garage/activate'){
   const own=db.playerCars.find(p=>p.id===body.ownedCarId&&p.userId===me.id);if(!own)return {ok:false,json:async()=>({error:'CAR_NOT_OWNED'})};
   db.playerCars.forEach(p=>{if(p.userId===me.id)p.isActive=0;});own.isActive=1;save(db);
   return {ok:true,json:async()=>({activated:true})};
  }
  if(path==='/garage/sell'){
   const own=db.playerCars.find(p=>p.id===body.ownedCarId&&p.userId===me.id);if(!own)return {ok:false,json:async()=>({error:'CAR_NOT_OWNED'})};
   if(db.playerCars.filter(p=>p.userId===me.id).length<=1)return {ok:false,status:400,json:async()=>({error:'CANNOT_SELL_LAST_CAR'})};
   const c=db.cars.find(x=>x.id===own.carId);const payout=Math.floor(c.priceYER*0.6);
   db.playerCars=db.playerCars.filter(p=>p.id!==own.id);me.balanceYER+=payout;
   db.transactions.push({id:Date.now(),userId:me.id,type:'car_sale',amountYER:payout,reference:c.code,createdAt:new Date().toISOString()});
   save(db);
   return {ok:true,json:async()=>({sold:true,car:c.name,payoutYER:payout})};
  }
  if(path==='/garage/repaint'){
   const own=db.playerCars.find(p=>p.id===body.ownedCarId&&p.userId===me.id);if(!own)return {ok:false,json:async()=>({error:'CAR_NOT_OWNED'})};
   if(me.balanceYER<25000)return {ok:false,status:400,json:async()=>({error:'INSUFFICIENT_FUNDS'})};
   me.balanceYER-=25000;own.color=body.color;
   db.transactions.push({id:Date.now(),userId:me.id,type:'repaint',amountYER:-25000,reference:'color_change',createdAt:new Date().toISOString()});
   save(db);return {ok:true,json:async()=>({repainted:true,costYER:25000})};
  }
  if(path.startsWith('/telemetry')){
   const ev=body.event;const data=body.data||{};
   let reward=null;
   if(ev==='parking_complete'&&data.speedKmh<=5&&data.distance<=3&&!completedMissions.has('parking_basic')){
    completedMissions.add('parking_basic');me.balanceYER+=15000;me.xp+=30;reward={validated:true,rewardYER:15000,rewardXP:30};
    db.transactions.push({id:Date.now(),userId:me.id,type:'mission_reward',amountYER:15000,reference:'parking_basic',createdAt:new Date().toISOString()});
   }
   if(ev==='delivery_complete'&&data.checkpoints>=3&&!completedMissions.has('city_delivery')){
    completedMissions.add('city_delivery');me.balanceYER+=25000;me.xp+=50;reward={validated:true,rewardYER:25000,rewardXP:50};
    db.transactions.push({id:Date.now(),userId:me.id,type:'mission_reward',amountYER:25000,reference:'city_delivery',createdAt:new Date().toISOString()});
   }
   if(ev==='speed_reached'&&data.speedKmh>=200&&!completedMissions.has('speed_run')){
    completedMissions.add('speed_run');me.balanceYER+=20000;me.xp+=40;reward={validated:true,rewardYER:20000,rewardXP:40};
   }
   if(ev==='distance_driven'&&data.km>=5&&!completedMissions.has('long_drive')){
    completedMissions.add('long_drive');me.balanceYER+=30000;me.xp+=60;reward={validated:true,rewardYER:30000,rewardXP:60};
   }
   if(ev==='clean_drive_complete'&&data.km>=2&&!data.hadCrash&&!completedMissions.has('clean_drive')){
    completedMissions.add('clean_drive');me.balanceYER+=10000;me.xp+=20;reward={validated:true,rewardYER:10000,rewardXP:20};
   }
   // Level up
   while(me.xp>=me.level*100){me.xp-=me.level*100;me.level++;}
   save(db);
   return {ok:true,json:async()=>(reward||{ok:true,validated:false})};
  }
  if(path==='/wallet/transactions')return {ok:true,json:async()=>db.transactions.filter(t=>t.userId===me.id).slice(-100).reverse().map(t=>({id:t.id,type:t.type,amountYER:t.amountYER,reference:t.reference,created_at:t.createdAt}))};
  if(path.startsWith('/chat/')){
   if(opts.method==='POST'){db.chat.push({user:me.username,message:body.message,ts:Date.now()});if(db.chat.length>100)db.chat.shift();save(db);return {ok:true,json:async()=>({ok:true})};}
   return {ok:true,json:async()=>db.chat.slice(-50).map(m=>({username:m.user,message:m.message,created_at:m.ts}))};
  }
  if(path==='/admin/overview')return {ok:true,json:async()=>({users:1,cars:db.cars.length,transactions:db.transactions.length,treasuryYER:me.balanceYER,online:1})};
  return {ok:false,status:404,json:async()=>({error:'NOT_FOUND_OFFLINE'})};
 }

 window.OfflineApi={fauxFetch,available:true};
 window.addEventListener('load',()=>{
  // Patch fetch to fall back to offline API
  const origFetch=window.fetch;
  let online=false;
  async function probe(){
   try{
    const c=new AbortController();setTimeout(()=>c.abort(),1200);
    const r=await origFetch(API+'/health',{signal:c.signal});
    if(r.ok){online=true;return;}
   }catch(e){online=false;}
  }
  probe();setInterval(probe,8000);
  window.fetch=async function(input,init){
   const url=typeof input==='string'?input:input.url;
   const isApi=url.startsWith(API);
   if(!isApi)return origFetch.apply(this,arguments);
   try{
    const c=new AbortController();setTimeout(()=>c.abort(),2000);
    const r=await origFetch(url,{...(init||{}),signal:c.signal});
    if(r.ok||r.status===400||r.status===401||r.status===403||r.status===409){online=true;return r;}
    throw new Error('bad status');
   }catch(e){
    // offline fallback
    const path=url.slice(API.length);
    const r=await fauxFetch(path,init||{});
    return new Response(JSON.stringify(await r.json()),{status:r.status||200,headers:{'Content-Type':'application/json'}});
   }
  };
 });
})();
