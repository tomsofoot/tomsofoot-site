// Same server environment variable as TomsoFoot's existing matches.mjs.
import { getStore } from '@netlify/blobs';
import { createMatchDetailsHandler } from './lib/match-details-handler.mjs';
let handler;
export default async request=>{
  if(!handler){let store;try{store=getStore('apisports-cache');}catch{}handler=createMatchDetailsHandler({store});}
  return handler(request);
};
