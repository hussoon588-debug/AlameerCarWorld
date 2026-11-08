// Real integration tests — starts server on ephemeral port, exercises full flow.
process.env.NODE_ENV='test';
process.env.JWT_SECRET='ucw-test-secret-abcdefghijklmnopqrstuvwxyz012345';
process.env.DB_FILE='./data/test.sqlite';
const fs=require('fs');
const path=require('path');
// Remove test db
try{fs.unlinkSync(path.resolve(process.env.DB_FILE));}catch(e){}
try{fs.unlinkSync(path.resolve(process.env.DB_FILE)+'-wal');}catch(e){}
try{fs.unlinkSync(path.resolve(process.env.DB_FILE)+'-shm');}catch(e){}
const {server}=require('./server');
require('./seed');

async function j(r){return r.json();}
let fails=0,passes=0;
function ok(n,c){if(c){passes++;console.log('PASS',n);}else{fails++;console.log('FAIL',n);}}
async function test(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 const B=`http://127.0.0.1:${port}`;
 console.log('Test server on',port);

 // 1: health
 let h=await fetch(B+'/health'); ok('health returns 200',h.ok);
 // 2: register
 let r1=await fetch(B+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'testplayer',password:'password123'})});
 ok('register',r1.status===201);
 // 3: register duplicate
 let r2=await fetch(B+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'testplayer',password:'password123'})});
 ok('duplicate register blocked',r2.status===409);
 // 4: login
 let r3=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'testplayer',password:'password123'})});
 ok('login',r3.ok);
 const d=await j(r3); ok('login returns token',!!d.token);
 const T=d.token;
 // 5: /me — should have starter car
 let r4=await fetch(B+'/api/me',{headers:{Authorization:'Bearer '+T}});
 const me=await j(r4);
 ok('/me has starter car',me.cars && me.cars.length>=1);
 ok('/me has starting balance',me.user.balanceYER>=500000);
 // 6: can't buy with no money
 let cheap=await (await fetch(B+'/api/cars')).json();
 const sport=cheap.find(c=>c.code==='ucw-supra-00');
 let r5=await fetch(B+'/api/garage/buy',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify({carId:sport.id})});
 ok('cannot afford sports car',r5.status===400);
 // 7: buy the cheap sedan (second account with money? use credit via owner)
 // create owner
 let r6=await fetch(B+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'theowner',password:'ownerpass123'})});
 const db=require('./db');
 db.prepare("UPDATE users SET role='owner' WHERE username='theowner'").run();
 let r7=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'theowner',password:'ownerpass123'})});
 const ownerD=await j(r7); const OT=ownerD.token;
 let r8=await fetch(B+'/api/admin/wallet-adjust',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+OT},body:JSON.stringify({userId:d.user.id,amountYER:20000000,reason:'test credit'})});
 ok('owner credit',r8.ok);
 // 9: buy sport
 let r9=await fetch(B+'/api/garage/buy',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify({carId:sport.id})});
 ok('buy sports car after credit',r9.ok);
 // 10: activate
 let me2=await j(await fetch(B+'/api/me',{headers:{Authorization:'Bearer '+T}}));
 const newOwned=me2.cars.find(c=>c.code==='ucw-supra-00');
 let r10=await fetch(B+'/api/garage/activate',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify({ownedCarId:newOwned.id})});
 ok('activate car',r10.ok);
 // 11: missions
 let ms=await j(await fetch(B+'/api/missions',{headers:{Authorization:'Bearer '+T}}));
 ok('missions listed',Array.isArray(ms)&&ms.length>=3);
 // 12: validate parking telemetry
 let parkMission=ms.find(m=>m.code==='parking_basic');
 let r11=await fetch(B+'/api/telemetry',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify({event:'parking_complete',data:{code:'parking_basic',speedKmh:2,distance:1.5}})});
 let teld=await j(r11);
 ok('parking mission validated',teld.validated===true);
 // 13: duplicate claim rejected
 let r12=await fetch(B+'/api/telemetry',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify({event:'parking_complete',data:{code:'parking_basic',speedKmh:2,distance:1.5}})});
 let teld2=await j(r12);
 ok('parking duplicate not re-awarded',teld2.validated===false);
 // 14: cannot sell last car
 let me3=await j(await fetch(B+'/api/me',{headers:{Authorization:'Bearer '+T}}));
 await fetch(B+'/api/garage/sell',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify({ownedCarId:me3.cars[0].id})});
 await fetch(B+'/api/garage/sell',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify({ownedCarId:me3.cars[me3.cars.length-1].id})});
 let me4=await j(await fetch(B+'/api/me',{headers:{Authorization:'Bearer '+T}}));
 ok('cannot sell last car (still >=1)',me4.cars.length>=1);
 // 15: chat
 let r15=await fetch(B+'/api/chat/global',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+T},body:JSON.stringify({message:'hello world'})});
 ok('chat post',r15.ok);
 // 16: admin overview
 let r16=await fetch(B+'/api/admin/overview',{headers:{Authorization:'Bearer '+OT}});
 ok('admin overview',r16.ok);
 // 17: player cannot access admin
 let r17=await fetch(B+'/api/admin/overview',{headers:{Authorization:'Bearer '+T}});
 ok('player blocked from admin',r17.status===403);
 // 18: bad login
 let r18=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'testplayer',password:'wrongpass'})});
 ok('bad creds rejected',r18.status===401);

 server.close();
 console.log(`\nResults: ${passes} passed, ${fails} failed`);
 if(fails>0)process.exit(1);
}
test().catch(e=>{console.error('TEST ERROR',e);process.exit(1);});
