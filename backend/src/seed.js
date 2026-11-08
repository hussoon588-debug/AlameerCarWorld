require('dotenv').config();
const db=require('./db');
const cars=[
 ['ucw-compact-01','Sahm Compact','Compact',850000,180,10,0.9,'#d4a574','سيارة اقتصادية صغيرة للقيادة داخل المدينة.'],
 ['ucw-sedan-01','Naseem Sedan','Sedan',1450000,210,13,0.88,'#2c3e50','سيدان متوازنة للاستخدام اليومي والعائلي.'],
 ['ucw-sport-01','Rimal Sport','Sport',4200000,280,18,0.82,'#c0392b','سيارة رياضية خفيفة واستجابة سريعة.'],
 ['ucw-suv-01','Jabal SUV','SUV',3600000,200,11,0.80,'#1a5276','دفع رباعي مناسب للطرق الوعرة.'],
 ['ucw-pickup-01','Wadi Pickup','Pickup',2750000,190,10,0.78,'#7b7d19','شاحنة عملية للحمولات والمهام.'],
 ['ucw-supra-00','UCW Supra GT','Sport',6500000,310,20,0.80,'#0a0a0a','سيارة رياضية فائقة الأداء بتصميم أنيق.'],
 ['ucw-luxury-01','Malik Luxury','Luxury',8000000,250,12,0.92,'#1a1a1a','سيارة فخمة بمستوى عالي من الراحة.'],
 ['ucw-police-01','Police Interceptor','Service',0,260,16,0.85,'#f1f2f6','سيارة شرطة - للمهمات الخاصة.']
];
const ins=db.prepare('INSERT OR IGNORE INTO cars(code,name,category,price_yer,top_speed,accel,handling,color,description) VALUES(?,?,?,?,?,?,?,?,?)');
const tx=db.transaction(()=>cars.forEach(c=>ins.run(c[0],c[1],c[2],c[3],c[4],c[5],c[6],c[7],c[8])));
tx();
const missions=[
 ['parking_basic','ركنة دقيقة','أكمل تحدي الركن داخل اللعبة بسرعة أقل من 5 كم/س.',15000,30,5,'parking'],
 ['city_delivery','توصيل المدينة','أكمل مهمة توصيل طرود عبر 3 نقاط تفتيش.',25000,50,3,'delivery'],
 ['clean_drive','قيادة آمنة','أكمل رحلة 2 كم دون اصطدامات.',10000,20,2,'nodamage'],
 ['speed_run','تحدي السرعة','وصل لسرعة 200 كم/س على الطريق السريع.',20000,40,200,'speed'],
 ['long_drive','جولة طويلة','اقطع مسافة 5 كم في القيادة الحرة.',30000,60,5,'distance']
];
const mi=db.prepare('INSERT OR IGNORE INTO missions(code,title,description,reward_yer,reward_xp,target_value,mission_type) VALUES(?,?,?,?,?,?,?)');
db.transaction(()=>missions.forEach(m=>mi.run(...m)))();
// Default settings
const setDefaults=db.prepare('INSERT OR IGNORE INTO game_settings(key,value) VALUES(?,?)');
setDefaults.run('starting_balance','500000');
setDefaults.run('resell_pct','60');
setDefaults.run('xp_per_km','5');
setDefaults.run('xp_per_delivery','50');
console.log('Seed complete: catalog, missions, settings inserted.');
