import {createRouter} from '../lib/api.js';
export default async function handler(req,res){
 try{
  const host=req.headers.host;
  const proto=process.env.VERCEL?'https':(req.headers['x-forwarded-proto']||'http');
  const incoming=new URL(req.url,proto+'://'+host);
  const route=req.query?.route??incoming.searchParams.get('route');
  if(route){const parts=Array.isArray(route)?route.join('/'):route;incoming.pathname='/api/'+parts;incoming.searchParams.delete('route');}
  let text;if(!['GET','HEAD'].includes(req.method)){
   if(req.body!==undefined)text=typeof req.body==='string'?req.body:Buffer.isBuffer(req.body)?req.body.toString():JSON.stringify(req.body);
   else{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>20000){res.statusCode=413;res.end('{"error":"Data terlalu besar."}');return;}chunks.push(chunk);}text=Buffer.concat(chunks).toString();}
  }
  if(text?.length>20000){res.statusCode=413;res.end('{"error":"Data terlalu besar."}');return;}
  const request=new Request(incoming,{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter(([,v])=>v!==undefined).map(([k,v])=>[k,Array.isArray(v)?v.join(','):v])),...(text?{body:text}:{})});
  const response=await createRouter(process.env)(request);
  res.statusCode=response.status;for(const [key,value] of response.headers)if(key!=='set-cookie')res.setHeader(key,value);
  const setCookies=response.headers.getSetCookie();if(setCookies.length)res.setHeader('Set-Cookie',setCookies);
  res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.statusCode=500;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end('{"error":"Layanan sementara bermasalah. Coba lagi."}');}
}
