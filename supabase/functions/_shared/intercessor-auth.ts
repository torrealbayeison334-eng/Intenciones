import { HttpError, jsonResponse, readBody, requireOrigin } from './domain.ts';
import { apiHeaders, env, rest, serviceKey } from './platform.ts';

export function username(value: unknown): string {
  const name = typeof value === 'string' ? value.toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(name)) throw new HttpError(400,'Usa un usuario de 3 a 32 caracteres, sin espacios: letras sin tilde, números, punto, guion o guion bajo.');
  return name;
}
export function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new HttpError(400,'La contraseña debe tener entre 12 y 128 caracteres.');
  return value;
}
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function recoveryCode(): string {
  // 96 random bits, displayed in four groups. Existing 192-bit codes remain valid.
  const hex=Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');
  return hex.match(/.{6}/g)!.join('-');
}
export function normalizeCode(value: unknown): string {
  const code=typeof value==='string'?value.replace(/[\s-]/g,'').toLowerCase():'';
  if(!/^(?:[a-f0-9]{24}|[a-f0-9]{48})$/.test(code)) throw new HttpError(400,'Revisa tu usuario y código de recuperación.');
  return code;
}
async function sameSecret(a: string,b: string): Promise<boolean> {
  const [left,right]=await Promise.all([digest(a),digest(b)]);
  let diff=0; for(let i=0;i<left.length;i++) diff|=left.charCodeAt(i)^right.charCodeAt(i);
  return diff===0;
}
export async function rateKey(request: Request,scope: string): Promise<string> {
  // Supabase's ingress supplies x-forwarded-for; use the final proxy-observed
  // address, never a caller-controlled leftmost entry. Missing headers share
  // a conservative fallback bucket rather than disabling throttling.
  const ip=request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env('RATE_LIMIT_SECRET')),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${scope}:${ip}`))),b=>b.toString(16).padStart(2,'0')).join('');
}
async function auth(path: string,method: string,body?: unknown): Promise<any> {
  const key=serviceKey();
  const response=await fetch(`${env('SUPABASE_URL')}/auth/v1/${path}`,{
    method,headers:{...apiHeaders(key),'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),
  });
  if(!response.ok) {
    if(path==='token?grant_type=password') throw new HttpError(401,'Usuario o contraseña incorrectos.');
    if(response.status===422) throw new HttpError(409,'No se pudo crear la cuenta. Prueba otro usuario y revisa tu contraseña.');
    throw new HttpError(502,'No pudimos completar la operación. Inténtalo nuevamente.');
  }
  return response.status===204?null:response.json();
}
export type AuthDeps={
  origin: string; registrationSecret: ()=>string;
  limit:(request:Request,scope:string,max:number)=>Promise<void>;
  db:typeof rest; auth:typeof auth;
};
export function intercessorAuth(deps:AuthDeps) {
  return async(request:Request):Promise<Response>=>{
    let origin:string|undefined;
    try {
      origin=requireOrigin(request,deps.origin);
      if(request.method==='OPTIONS') return jsonResponse({},200,origin);
      if(request.method!=='POST') throw new HttpError(405,'Método no permitido.');
      const body=await readBody(request) as Record<string,unknown>;
      if(!body || typeof body!=='object' || Array.isArray(body)) throw new HttpError(400,'Formulario inválido.');
      const action=body.action;
      if(!['register','login','recover'].includes(String(action))) throw new HttpError(400,'Operación inválida.');
      await deps.limit(request,`auth:${action}`,action==='register'?5:30);
      const name=username(body.username);
      const pass=password(body.password);
      // A hexadecimal identifier also supports usernames with repeated/trailing dots.
      const email=`${await digest(name)}@intercesor.misterio.invalid`;
      if(action==='register') {
        const secret=typeof body.secret==='string'?body.secret:'';
        const configured=deps.registrationSecret();
        if(configured.length<32) throw new HttpError(503,'El registro todavía no está configurado.');
        if(secret.length>256 || !await sameSecret(secret,configured)) throw new HttpError(403,'Este enlace de registro no es válido o fue reemplazado.');
        const code=recoveryCode();
        const user=await deps.auth('admin/users','POST',{email,password:pass,email_confirm:true});
        try {
          await deps.db('rpc/register_intercessor','POST',{p_user_id:user.id,p_username:name,p_recovery_hash:await digest(normalizeCode(code))});
        } catch(error) {
          // Remove an Auth orphan when the membership transaction fails.
          await deps.auth(`admin/users/${encodeURIComponent(user.id)}`,'DELETE').catch(()=>{});
          throw error;
        }
        return jsonResponse({ok:true,username:name,recoveryCode:code},201,origin);
      }
      if(action==='login') {
        const session=await deps.auth('token?grant_type=password','POST',{email,password:pass});
        const member=await deps.db(`members?user_id=eq.${encodeURIComponent(session.user.id)}&approved=eq.true&role=in.(priest,intercessor)&select=user_id`);
        if(member.length!==1) throw new HttpError(403,'Esta cuenta no tiene acceso a Intercesor.');
        return jsonResponse({access_token:session.access_token,refresh_token:session.refresh_token},200,origin);
      }
      const code=normalizeCode(body.code);
      const next=recoveryCode(); const nextHash=await digest(normalizeCode(next));
      const userId=await deps.db('rpc/reserve_recovery','POST',{p_username:name,p_hash:await digest(code),p_next_hash:nextHash});
      if(!userId) throw new HttpError(400,'Revisa tu usuario y código de recuperación, o vuelve a intentarlo en unos minutos.');
      try {
        await deps.auth(`admin/users/${encodeURIComponent(userId)}`,'PUT',{password:pass});
      } catch(error) {
        await deps.db('rpc/finish_recovery','POST',{p_user_id:userId,p_next_hash:nextHash,p_success:false});
        throw error;
      }
      const finished=await deps.db('rpc/finish_recovery','POST',{p_user_id:userId,p_next_hash:nextHash,p_success:true});
      if(!finished) throw new HttpError(503,'La contraseña cambió, pero no pudimos renovar el código. Conserva el anterior y vuelve a intentarlo.');
      return jsonResponse({ok:true,username:name,recoveryCode:next},200,origin);
    } catch(error) {
      return jsonResponse({error:error instanceof HttpError?error.message:'No pudimos completar la operación. Inténtalo nuevamente.'},error instanceof HttpError?error.status:503,origin);
    }
  };
}
export function authHandler() {
  return intercessorAuth({origin:env('APP_ORIGIN'),registrationSecret:()=>env('INTERCESSOR_REGISTRATION_SECRET'),db:rest,auth,
    limit:async(request,scope,max)=>{await rest('rpc/check_request_limit','POST',{p_key:await rateKey(request,scope),p_limit:max});},
  });
}
