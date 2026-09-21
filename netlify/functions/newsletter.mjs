import {assertDbSafe,rpcAdmin,SITE,NETLIFY_CONTEXT} from './lib/x-core.mjs';
import {createNewsletterHandler} from './lib/newsletter-handler.mjs';
export default createNewsletterHandler({origin:SITE,store:async(name,args)=>{
 if(!NETLIFY_CONTEXT)throw Error('missing_context');
 assertDbSafe();
 return rpcAdmin(name,args);
}});
