import {writeFileSync} from 'node:fs';
const value=process.env.WORD_TO_PDF_API_URL;
if(value!==undefined){
 if(value){const url=new URL(value);if(url.username||url.password||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('WORD_TO_PDF_API_URL must be HTTPS (HTTP is allowed only for localhost).');}
 writeFileSync(new URL('../src/assets/word-to-pdf/config.json',import.meta.url),JSON.stringify({apiBaseUrl:value.replace(/\/+$/,'')})+'\n');
}
