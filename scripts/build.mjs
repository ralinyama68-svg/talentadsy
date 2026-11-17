import fs from 'node:fs';
import {page} from '../lib/page.js';
import {client} from '../lib/client.js';
fs.mkdirSync('public',{recursive:true});fs.writeFileSync('public/index.html',page);fs.writeFileSync('public/app.js',client);
if(/SPV_PASSWORD|SERVICE_ROLE_KEY|correct:/.test(client))throw Error('Server-only content detected in public client');
console.log('Built public/index.html and public/app.js; scoring stays in lib/questions.js');
