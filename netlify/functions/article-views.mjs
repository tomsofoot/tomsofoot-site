import { createArticleViewsHandler } from './lib/article-views-handler.mjs';
// Ce fichier utilise le garde-fou déjà présent dans le dépôt TomsoFoot.
import { assertDbSafe, rpcAdmin, NETLIFY_CONTEXT } from './lib/x-core.mjs';
const handler=createArticleViewsHandler({
  secret:process.env.ARTICLE_VIEW_SESSION_SECRET,
  origin:process.env.SITE_ORIGIN || 'https://tomsofoot.fr',
  store:async(name,args)=>{
    // Une absence de contexte ne doit pas autoriser la base de production.
    if(!NETLIFY_CONTEXT)throw Error('missing_context');
    assertDbSafe();
    try{return await rpcAdmin(name,args);}catch(error){error.code=error.data?.code || error.code;throw error;}
  }
});
export default handler;
