import { createOidcService } from './oidc.js';
import { createSessionStore } from './store.js';
import { HttpError, handleApiError, requireMethod, sendJson } from '../http.js';

export function createAuthHttpHandler({env=process.env,store=createSessionStore(),service}={}) {
  service??=createOidcService({env,store});
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    try {
      const path=new URL(req.url,'https://api.3dprint4.me').pathname;
      if(path==='/api/auth/logout') {
        if(req.headers?.origin!==env.OPERATOR_WEB_ORIGIN)throw new HttpError(403,'Origin is not allowed.');
        res.setHeader('Access-Control-Allow-Origin',env.OPERATOR_WEB_ORIGIN);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');
        if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.statusCode=204;res.end();return;}
        requireMethod(req,'POST');const result=await service.logout(req);res.setHeader('Set-Cookie',result.cookie);sendJson(res,200,{ok:true});return;
      }
      if(!['/api/auth/login','/api/auth/callback'].includes(path)){sendJson(res,404,{error:'Not found.'});return;}
      requireMethod(req,'GET');const result=await(path.endsWith('/login')?service.login():service.callback(req));
      res.setHeader('Set-Cookie',result.clearFlow?[result.cookie,result.clearFlow]:result.cookie);
      res.statusCode=303;res.setHeader('Location',result.location);res.end();
    }catch(error){handleApiError(res,error);}
  };
}
