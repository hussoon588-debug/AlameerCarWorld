const jwt = require('jsonwebtoken');
const db = require('./db');
function auth(req,res,next){
 const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 if(!token) return res.status(401).json({error:'AUTH_REQUIRED'});
 try{
  const p=jwt.verify(token,process.env.JWT_SECRET);
  const user=db.prepare('SELECT id,username,role,banned FROM users WHERE id=?').get(p.sub);
  if(!user || user.banned) return res.status(401).json({error:'ACCOUNT_UNAVAILABLE'});
  req.user=user; next();
 }catch(e){ return res.status(401).json({error:'INVALID_TOKEN'}); }
}
const roles={player:0,employee:1,manager:2,owner:3};
function permit(minRole){return (req,res,next)=>{
 if(!req.user || roles[req.user.role] < roles[minRole]) return res.status(403).json({error:'FORBIDDEN'});
 next();
};}
module.exports={auth,permit};
