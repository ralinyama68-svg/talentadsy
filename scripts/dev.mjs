import http from 'node:http';import fs from 'node:fs';import handler from '../api/index.js';
await import('./build.mjs');
const pages=new Set(['/','/tes','/spv','/selesai']);
const portIndex=process.argv.indexOf('--port');const port=Number(process.env.PORT||(portIndex>=0?process.argv[portIndex+1]:3000));
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/'))return handler(req,res);
 if(req.method!=='GET'){res.statusCode=405;res.end();return;}
 const file=pages.has(url.pathname)?'index.html':url.pathname==='/app.js'?'app.js':null;
 if(!file){res.statusCode=404;res.end('Not found');return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript;charset=utf-8':'text/html;charset=utf-8');res.end(fs.readFileSync('public/'+file));
}).listen(port,'127.0.0.1',()=>console.log('Ruang Talent Adsy: http://localhost:'+port));
