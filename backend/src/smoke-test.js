const base=process.env.API_URL||'http://127.0.0.1:8080';
(async()=>{
 const health=await fetch(base+'/health');if(!health.ok)throw Error('health endpoint failed');
 const h=await health.json();console.log('PASS health',h.version);
 const cars=await fetch(base+'/api/cars');if(!cars.ok)throw Error('catalog endpoint failed');
 const list=await cars.json();if(!Array.isArray(list))throw Error('catalog response is not an array');
 console.log(`PASS catalog (${list.length} cars)`);
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
