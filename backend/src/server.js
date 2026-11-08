require('dotenv').config();
if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<32) {
  console.warn('WARNING: JWT_SECRET <32 chars, falling back to dev secret.');
  process.env.JWT_SECRET='ucw-dev-secret-change-me-to-32-chars-minimum';
}
const express=require('express'), cors=require('cors'), helmet=require('helmet'), http=require('http'), path=require('path');
const rateLimit=require('express-rate-limit'), bcrypt=require('bcryptjs'), jwt=require('jsonwebtoken');
const {Server}=require('socket.io');
const {z}=require('zod');
const db=require('./db'); const {auth,permit}=require('./security');

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});

const allowed=(process.env.CORS_ORIGIN||'http://localhost:5500').split(',').map(x=>x.trim());
app.use(helmet({
  contentSecurityPolicy:false,
  crossOriginEmbedderPolicy:false,
  crossOriginOpenerPolicy:false,
  crossOriginResourcePolicy:false,
  frameguard:false
}));
// Explicitly allow embedding in arena preview iframe
app.use((req,res,next)=>{ res.setHeader('X-Frame-Options','ALLOWALL'); next(); });
app.use(cors({origin:(origin,cb)=>!origin||allowed.includes(origin)||allowed.includes('*')?cb(null,true):cb(null,true)}));
app.use(express.json({limit:'1mb'}));
app.use('/api/auth',rateLimit({windowMs:15*60*1000,max:30,standardHeaders:true,legacyHeaders:false}));
app.use('/api',rateLimit({windowMs:60*1000,max:300,standardHeaders:true,legacyHeaders:false}));

const log=(actor,action,target,details={})=>db.prepare('INSERT INTO audit_logs(actor_id,action,target,details) VALUES(?,?,?,?)').run(actor,action,target,JSON.stringify(details));
const fail=(res,e)=>res.status(400).json({error:e.message||'REQUEST_FAILED'});

// ---------- CLIENT & ADMIN STATIC ----------
app.use('/play',express.static(path.join(__dirname,'../../client')));
app.use('/admin',express.static(path.join(__dirname,'../../admin')));
app.get('/',(req,res)=>res.redirect('/play'));

// ---------- HEALTH ----------
app.get('/health',(req,res)=>res.json({status:'ok',service:'ultimate-car-world-api',version:'1.2.0',time:Date.now()}));

// ---------- AUTH ----------
app.post('/api/auth/register',(req,res)=>{
 const s=z.object({username:z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),email:z.string().email().optional(),password:z.string().min(6).max(100)}).safeParse(req.body);
 if(!s.success)return res.status(400).json({error:'INVALID_INPUT',details:s.error.issues});
 try{
  const startingBalance=Number(db.prepare('SELECT value FROM game_settings WHERE key=?').get('starting_balance')?.value||500000);
  const hash=bcrypt.hashSync(s.data.password,10);
  const r=db.prepare('INSERT INTO users(username,email,password_hash,balance_yer) VALUES(?,?,?,?)').run(s.data.username,s.data.email||null,hash,startingBalance);
  const uid=Number(r.lastInsertRowid);
  // Give starter car (first compact)
  const starter=db.prepare('SELECT id FROM cars WHERE code=?').get('ucw-compact-01');
  if(starter){
   db.prepare('INSERT INTO player_cars(user_id,car_id,is_active,color) VALUES(?,?,1,?)').run(uid,starter.id,'#d4a574');
   db.prepare('INSERT INTO transactions(user_id,type,amount_yer,reference) VALUES(?,?,?,?)').run(uid,'starter_car',0,'ucw-compact-01');
  }
  res.status(201).json({id:uid,username:s.data.username});
 }catch(e){res.status(409).json({error:'USERNAME_OR_EMAIL_EXISTS'});}
});
app.post('/api/auth/login',(req,res)=>{
 const s=z.object({username:z.string(),password:z.string()}).safeParse(req.body);
 if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});
 const u=db.prepare('SELECT * FROM users WHERE username=?').get(s.data.username);
 if(!u||u.banned||!bcrypt.compareSync(s.data.password,u.password_hash))return res.status(401).json({error:'BAD_CREDENTIALS'});
 db.prepare('UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?').run(u.id);
 const token=jwt.sign({sub:u.id},process.env.JWT_SECRET,{expiresIn:'24h'});
 res.json({token,user:{id:u.id,username:u.username,role:u.role,balanceYER:u.balance_yer,level:u.level,xp:u.xp}});
});
app.get('/api/me',auth,(req,res)=>{
 const u=db.prepare('SELECT id,username,email,role,balance_yer AS balanceYER,level,xp,created_at FROM users WHERE id=?').get(req.user.id);
 const cars=db.prepare(`SELECT pc.id,pc.nickname,pc.is_active AS isActive,c.id AS carId,c.name,c.code,c.category,c.top_speed AS topSpeed,c.accel,c.handling,pc.color,c.color AS defaultColor,pc.odometer_km AS odometer
  FROM player_cars pc JOIN cars c ON c.id=pc.car_id WHERE pc.user_id=? ORDER BY pc.is_active DESC,pc.id`).all(req.user.id);
 res.json({user:u,cars});
});

// ---------- CATALOG ----------
app.get('/api/cars',(req,res)=>res.json(db.prepare('SELECT id,code,name,category,price_yer AS priceYER,stock,description,top_speed AS topSpeed,accel,handling,color FROM cars WHERE enabled=1 ORDER BY price_yer').all()));
app.get('/api/missions',auth,(req,res)=>res.json(db.prepare(`SELECT m.id,m.code,m.title,m.description,m.reward_yer AS rewardYER,m.reward_xp AS rewardXP,m.mission_type AS type,m.target_value AS target,
 EXISTS(SELECT 1 FROM mission_completions mc WHERE mc.mission_id=m.id AND mc.user_id=?) AS completed
 FROM missions m WHERE m.enabled=1`).all(req.user.id)));

// ---------- TELEMETRY (server-side mission validation) ----------
app.post('/api/telemetry',auth,(req,res)=>{
 const s=z.object({event:z.string().min(2).max(40),data:z.any()}).safeParse(req.body);
 if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});
 db.prepare('INSERT INTO telemetry(user_id,event,data) VALUES(?,?,?)').run(req.user.id,s.data.event,JSON.stringify(s.data.data||{}));
 // Validate parking
 if(s.data.event==='parking_complete'){
  const {code,speedKmh,distance}=s.data.data||{};
  const m=db.prepare('SELECT * FROM missions WHERE code=? AND enabled=1').get(code);
  if(m && speedKmh<=5 && distance<=2.5){
   try{
    db.prepare('INSERT INTO mission_completions(user_id,mission_id,proof) VALUES(?,?,?)').run(req.user.id,m.id,JSON.stringify({speedKmh,distance}));
    db.prepare('UPDATE users SET balance_yer=balance_yer+?, xp=xp+? WHERE id=?').run(m.reward_yer,m.reward_xp,req.user.id);
    db.prepare('INSERT INTO transactions(user_id,type,amount_yer,reference) VALUES(?,?,?,?)').run(req.user.id,'mission_reward',m.reward_yer,m.code);
    return res.json({validated:true,rewardYER:m.reward_yer,rewardXP:m.reward_xp});
   }catch(e){ return res.json({validated:false,reason:'already completed'}); }
  }
  return res.json({validated:false});
 }
 // Delivery complete with checkpoint count
 if(s.data.event==='delivery_complete'){
  const {code,checkpoints,distanceKm,crashes}=s.data.data||{};
  const m=db.prepare('SELECT * FROM missions WHERE code=? AND enabled=1').get(code);
  if(m && checkpoints>=m.target_value && crashes===0){
   try{
    db.prepare('INSERT INTO mission_completions(user_id,mission_id,proof) VALUES(?,?,?)').run(req.user.id,m.id,JSON.stringify({checkpoints,distanceKm}));
    db.prepare('UPDATE users SET balance_yer=balance_yer+?, xp=xp+? WHERE id=?').run(m.reward_yer,m.reward_xp,req.user.id);
    db.prepare('INSERT INTO transactions(user_id,type,amount_yer,reference) VALUES(?,?,?,?)').run(req.user.id,'mission_reward',m.reward_yer,m.code);
    return res.json({validated:true,rewardYER:m.reward_yer,rewardXP:m.reward_xp});
   }catch(e){ return res.json({validated:false,reason:'already completed'});}
  }
  return res.json({validated:false});
 }
 // Speed / distance / clean drive
 if(['speed_reached','distance_driven','clean_drive_complete'].includes(s.data.event)){
  const ev=s.data.event; const d=s.data.data||{};
  let codeMap={speed_reached:'speed_run',distance_driven:'long_drive',clean_drive_complete:'clean_drive'};
  const m=db.prepare('SELECT * FROM missions WHERE code=? AND enabled=1').get(codeMap[ev]);
  if(!m)return res.json({ok:true});
  let valid=false;
  if(ev==='speed_reached' && d.speedKmh>=m.target_value)valid=true;
  if(ev==='distance_driven' && d.km>=m.target_value)valid=true;
  if(ev==='clean_drive_complete' && d.km>=m.target_value && !d.hadCrash)valid=true;
  if(valid){
   try{
    db.prepare('INSERT INTO mission_completions(user_id,mission_id,proof) VALUES(?,?,?)').run(req.user.id,m.id,JSON.stringify(d));
    db.prepare('UPDATE users SET balance_yer=balance_yer+?, xp=xp+? WHERE id=?').run(m.reward_yer,m.reward_xp,req.user.id);
    db.prepare('INSERT INTO transactions(user_id,type,amount_yer,reference) VALUES(?,?,?,?)').run(req.user.id,'mission_reward',m.reward_yer,m.code);
    return res.json({validated:true,rewardYER:m.reward_yer,rewardXP:m.reward_xp});
   }catch(e){return res.json({validated:false,reason:'already completed'});}
  }
  return res.json({validated:false});
 }
 res.json({ok:true});
});

// ---------- GARAGE ----------
app.post('/api/garage/buy',auth,(req,res)=>{
 const s=z.object({carId:z.number().int().positive()}).safeParse(req.body);
 if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});
 const tx=db.transaction(()=>{
  const c=db.prepare('SELECT * FROM cars WHERE id=? AND enabled=1').get(s.data.carId);
  const u=db.prepare('SELECT balance_yer FROM users WHERE id=?').get(req.user.id);
  if(!c)throw new Error('CAR_NOT_AVAILABLE');if(c.stock===0)throw new Error('OUT_OF_STOCK');
  if(c.price_yer>0 && u.balance_yer<c.price_yer)throw new Error('INSUFFICIENT_FUNDS');
  if(c.price_yer>0) db.prepare('UPDATE users SET balance_yer=balance_yer-? WHERE id=?').run(c.price_yer,req.user.id);
  const pc=db.prepare('INSERT INTO player_cars(user_id,car_id,color) VALUES(?,?,?)').run(req.user.id,c.id,c.color);
  if(c.stock>0)db.prepare('UPDATE cars SET stock=stock-1 WHERE id=?').run(c.id);
  db.prepare('INSERT INTO transactions(user_id,type,amount_yer,reference) VALUES(?,?,?,?)').run(req.user.id,'car_purchase',-c.price_yer,c.code);
  return {car:c,ownedId:Number(pc.lastInsertRowid)};
 });
 try{const r=tx();res.json({purchased:true,ownedCarId:r.ownedId,car:r.car.name,priceYER:r.car.price_yer});}catch(e){fail(res,e);}
});
app.post('/api/garage/activate',auth,(req,res)=>{
 const s=z.object({ownedCarId:z.number().int().positive()}).safeParse(req.body);
 if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});
 const tx=db.transaction(()=>{
  const own=db.prepare('SELECT id FROM player_cars WHERE id=? AND user_id=?').get(s.data.ownedCarId,req.user.id);
  if(!own)throw new Error('CAR_NOT_OWNED');
  db.prepare('UPDATE player_cars SET is_active=0 WHERE user_id=?').run(req.user.id);
  db.prepare('UPDATE player_cars SET is_active=1 WHERE id=?').run(own.id);
 });
 try{tx();res.json({activated:true});}catch(e){fail(res,e);}
});
app.post('/api/garage/sell',auth,(req,res)=>{
 const s=z.object({ownedCarId:z.number().int().positive()}).safeParse(req.body);
 if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});
 const tx=db.transaction(()=>{
  const own=db.prepare(`SELECT pc.id,pc.car_id,c.price_yer,c.code,c.name FROM player_cars pc JOIN cars c ON c.id=pc.car_id WHERE pc.id=? AND pc.user_id=?`).get(s.data.ownedCarId,req.user.id);
  if(!own)throw new Error('CAR_NOT_OWNED');
  const ownedCount=db.prepare('SELECT COUNT(*) n FROM player_cars WHERE user_id=?').get(req.user.id).n;
  if(ownedCount<=1)throw new Error('CANNOT_SELL_LAST_CAR');
  const resellPct=Number(db.prepare('SELECT value FROM game_settings WHERE key=?').get('resell_pct')?.value||60);
  const payout=Math.floor(own.price_yer*(resellPct/100));
  db.prepare('DELETE FROM player_cars WHERE id=?').run(own.id);
  db.prepare('UPDATE users SET balance_yer=balance_yer+? WHERE id=?').run(payout,req.user.id);
  db.prepare('INSERT INTO transactions(user_id,type,amount_yer,reference) VALUES(?,?,?,?)').run(req.user.id,'car_sale',payout,own.code);
  return {name:own.name,payout};
 });
 try{const r=tx();res.json({sold:true,car:r.name,payoutYER:r.payout});}catch(e){fail(res,e);}
});
app.get('/api/wallet/transactions',auth,(req,res)=>res.json(db.prepare('SELECT id,type,amount_yer AS amountYER,reference,created_at FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id)));
app.post('/api/garage/repaint',auth,(req,res)=>{
 const s=z.object({ownedCarId:z.number().int().positive(),color:z.string().regex(/^#[0-9a-fA-F]{6}$/)}).safeParse(req.body);
 if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});
 const cost=25000;
 const tx=db.transaction(()=>{
  const own=db.prepare('SELECT id FROM player_cars WHERE id=? AND user_id=?').get(s.data.ownedCarId,req.user.id);
  const u=db.prepare('SELECT balance_yer FROM users WHERE id=?').get(req.user.id);
  if(!own)throw new Error('CAR_NOT_OWNED');
  if(u.balance_yer<cost)throw new Error('INSUFFICIENT_FUNDS');
  db.prepare('UPDATE users SET balance_yer=balance_yer-? WHERE id=?').run(cost,req.user.id);
  db.prepare('UPDATE player_cars SET color=? WHERE id=?').run(s.data.color,own.id);
  db.prepare('INSERT INTO transactions(user_id,type,amount_yer,reference) VALUES(?,?,?,?)').run(req.user.id,'repaint',-cost,'color_change');
 });
 try{tx();res.json({repainted:true,costYER:cost});}catch(e){fail(res,e);}
});

// ---------- CHAT ----------
app.get('/api/chat/:channel',auth,(req,res)=>{
 const ch=(req.params.channel||'global').slice(0,20);
 res.json(db.prepare(`SELECT cm.id,cm.message,cm.created_at,u.username FROM chat_messages cm JOIN users u ON u.id=cm.user_id WHERE cm.channel=? ORDER BY cm.id DESC LIMIT 50`).all(ch).reverse());
});
app.post('/api/chat/:channel',auth,(req,res)=>{
 const s=z.object({message:z.string().min(1).max(300)}).safeParse(req.body);
 if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});
 const ch=(req.params.channel||'global').slice(0,20);
 db.prepare('INSERT INTO chat_messages(user_id,channel,message) VALUES(?,?,?)').run(req.user.id,ch,s.data.message);
 io.to('chat:'+ch).emit('chat_msg',{user:req.user.username,message:s.data.message,ts:Date.now()});
 res.json({ok:true});
});

// ---------- ADMIN ----------
app.get('/api/admin/overview',auth,permit('manager'),(req,res)=>res.json({
 users:db.prepare('SELECT COUNT(*) n FROM users').get().n,
 cars:db.prepare('SELECT COUNT(*) n FROM cars WHERE enabled=1').get().n,
 transactions:db.prepare('SELECT COUNT(*) n FROM transactions').get().n,
 treasuryYER:db.prepare('SELECT COALESCE(SUM(balance_yer),0) n FROM users').get().n,
 online:io.engine.clientsCount
}));
app.get('/api/admin/users',auth,permit('manager'),(req,res)=>res.json(db.prepare('SELECT id,username,email,role,balance_yer AS balanceYER,level,xp,banned,created_at,last_seen FROM users ORDER BY id DESC LIMIT 200').all()));
app.get('/api/admin/transactions',auth,permit('manager'),(req,res)=>res.json(db.prepare(`SELECT t.*,u.username FROM transactions t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 300`).all()));
app.post('/api/admin/cars',auth,permit('manager'),(req,res)=>{
 const s=z.object({code:z.string().min(2).max(30),name:z.string().min(2).max(60),category:z.string().min(2).max(30),priceYER:z.number().int().nonnegative(),stock:z.number().int().min(-1),description:z.string().max(500).default(''),topSpeed:z.number().positive().default(220),accel:z.number().positive().default(12),handling:z.number().positive().default(0.85),color:z.string().default('#1a1a2e')}).safeParse(req.body);
 if(!s.success)return res.status(400).json({error:'INVALID_INPUT',details:s.error.issues});
 try{const r=db.prepare('INSERT INTO cars(code,name,category,price_yer,stock,description,top_speed,accel,handling,color) VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.data.code,s.data.name,s.data.category,s.data.priceYER,s.data.stock,s.data.description,s.data.topSpeed,s.data.accel,s.data.handling,s.data.color);
 log(req.user.id,'car.create',String(r.lastInsertRowid),s.data);res.status(201).json({id:Number(r.lastInsertRowid)});}catch(e){res.status(409).json({error:'CAR_CODE_EXISTS'});}
});
app.patch('/api/admin/cars/:id',auth,permit('manager'),(req,res)=>{
 const s=z.object({priceYER:z.number().int().nonnegative().optional(),stock:z.number().int().min(-1).optional(),enabled:z.boolean().optional()}).safeParse(req.body);
 if(!s.success||Object.keys(s.data||{}).length===0)return res.status(400).json({error:'INVALID_INPUT'});
 const c=db.prepare('SELECT * FROM cars WHERE id=?').get(Number(req.params.id));if(!c)return res.status(404).json({error:'NOT_FOUND'});
 const next={price_yer:s.data.priceYER??c.price_yer,stock:s.data.stock??c.stock,enabled:s.data.enabled===undefined?c.enabled:(s.data.enabled?1:0)};
 db.prepare('UPDATE cars SET price_yer=?,stock=?,enabled=? WHERE id=?').run(next.price_yer,next.stock,next.enabled,c.id);
 log(req.user.id,'car.update',String(c.id),next);res.json({updated:true});
});
app.post('/api/admin/missions',auth,permit('manager'),(req,res)=>{
 const s=z.object({code:z.string().min(2).max(40),title:z.string().min(2).max(80),description:z.string().min(5).max(500),rewardYER:z.number().int().nonnegative(),rewardXP:z.number().int().nonnegative().default(0)}).safeParse(req.body);
 if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});
 try{const r=db.prepare('INSERT INTO missions(code,title,description,reward_yer,reward_xp) VALUES(?,?,?,?,?)').run(s.data.code,s.data.title,s.data.description,s.data.rewardYER,s.data.rewardXP);log(req.user.id,'mission.create',String(r.lastInsertRowid),s.data);res.status(201).json({id:Number(r.lastInsertRowid)});}catch(e){res.status(409).json({error:'MISSION_CODE_EXISTS'});}
});
app.post('/api/admin/users/:id/ban',auth,permit('manager'),(req,res)=>{
 const s=z.object({banned:z.boolean()}).safeParse(req.body);if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});
 const target=db.prepare('SELECT id,role FROM users WHERE id=?').get(Number(req.params.id));if(!target)return res.status(404).json({error:'USER_NOT_FOUND'});
 if(target.role==='owner')return res.status(403).json({error:'OWNER_PROTECTED'});
 db.prepare('UPDATE users SET banned=? WHERE id=?').run(s.data.banned?1:0,target.id);log(req.user.id,'user.ban',String(target.id),s.data);res.json({updated:true});
});
app.post('/api/admin/users/:id/role',auth,permit('owner'),(req,res)=>{
 const s=z.object({role:z.enum(['player','employee','manager'])}).safeParse(req.body);if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});
 const target=db.prepare('SELECT id,role FROM users WHERE id=?').get(Number(req.params.id));if(!target)return res.status(404).json({error:'USER_NOT_FOUND'});
 if(target.role==='owner')return res.status(403).json({error:'OWNER_PROTECTED'});
 db.prepare('UPDATE users SET role=? WHERE id=?').run(s.data.role,target.id);log(req.user.id,'user.role',String(target.id),s.data);res.json({updated:true});
});
app.post('/api/admin/wallet-adjust',auth,permit('owner'),(req,res)=>{
 const s=z.object({userId:z.number().int().positive(),amountYER:z.number().int().positive(),reason:z.string().min(5).max(200)}).safeParse(req.body);
 if(!s.success)return res.status(400).json({error:'INVALID_INPUT'});
 const tx=db.transaction(()=>{const u=db.prepare('SELECT id FROM users WHERE id=?').get(s.data.userId);if(!u)throw new Error('USER_NOT_FOUND');
 db.prepare('UPDATE users SET balance_yer=balance_yer+? WHERE id=?').run(s.data.amountYER,u.id);
 db.prepare('INSERT INTO transactions(user_id,type,amount_yer,reference) VALUES(?,?,?,?)').run(u.id,'admin_credit',s.data.amountYER,s.data.reason);});
 try{tx();log(req.user.id,'wallet.credit',String(s.data.userId),s.data);res.json({updated:true});}catch(e){fail(res,e);}
});
app.get('/api/admin/audit',auth,permit('manager'),(req,res)=>res.json(db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all()));
app.get('/api/admin/telemetry',auth,permit('manager'),(req,res)=>res.json(db.prepare(`SELECT t.*,u.username FROM telemetry t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 200`).all()));

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'INTERNAL_ERROR'});});

// ---------- SOCKET.IO: Multiplayer + Chat + Voice Signaling ----------
io.use((socket,next)=>{
 try{
  const token=(socket.handshake.auth?.token||socket.handshake.headers?.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token) return next(new Error('auth required'));
  const p=jwt.verify(token,process.env.JWT_SECRET);
  const u=db.prepare('SELECT id,username,role,banned FROM users WHERE id=?').get(p.sub);
  if(!u||u.banned) return next(new Error('unauthorized'));
  socket.user=u; next();
 }catch(e){next(new Error('invalid token'));}
});
io.on('connection',(socket)=>{
 const user=socket.user;
 db.prepare('UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?').run(user.id);
 socket.join('world');
 socket.join('chat:global');

 socket.on('player_update',(data)=>{
  socket.data.state={...data,u:user.username,uid:user.id,t:Date.now()};
  socket.to('world').emit('player_state',{id:socket.id,...socket.data.state});
 });

 socket.on('chat_msg',({channel,message})=>{
  const ch=String(channel||'global').slice(0,20);
  if(typeof message!=='string'||!message.trim()||message.length>300)return;
  io.to('chat:'+ch).emit('chat_msg',{user:user.username,message:message.trim(),ts:Date.now()});
  try{db.prepare('INSERT INTO chat_messages(user_id,channel,message) VALUES(?,?,?)').run(user.id,ch,message.trim());}catch(e){}
 });
 socket.on('join_voice',(roomId)=>{
  const rid=String(roomId||'default').slice(0,40);
  socket.join('voice:'+rid);
  socket.to('voice:'+rid).emit('voice_peer_join',{id:socket.id,user:user.username});
 });
 socket.on('voice_signal',({to,signal})=>{
  io.to(to).emit('voice_signal',{from:socket.id,user:user.username,signal});
 });
 socket.on('leave_voice',(roomId)=>{
  const rid=String(roomId||'default').slice(0,40);
  socket.leave('voice:'+rid);
  socket.to('voice:'+rid).emit('voice_peer_leave',{id:socket.id,user:user.username});
 });
 socket.on('honk',()=>socket.to('world').emit('honk',{id:socket.id,user:user.username}));
 socket.on('disconnect',()=>{
  socket.to('world').emit('player_left',{id:socket.id});
 });
});
// Periodic cleanup
setInterval(()=>{
 const all=new Map();
 io.sockets.sockets.forEach(s=>{if(s.data.state) all.set(s.id,{...s.data.state,u:s.user?.username,uid:s.user?.id});});
 io.emit('world_snapshot',Array.from(all.values()));
},1000);

const port=Number(process.env.PORT||8080);
if(require.main===module){
 server.listen(port,'0.0.0.0',()=>console.log(`UCW API+MP listening on 0.0.0.0:${port} — client at /play, admin at /admin`));
}
module.exports={app,server,io};
