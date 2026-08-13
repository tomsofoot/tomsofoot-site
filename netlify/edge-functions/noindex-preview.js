// noindex-preview.js — ajoute X-Robots-Tag: noindex UNIQUEMENT sur les
// environnements de prévisualisation (Deploy Previews / *.netlify.app), jamais
// sur le domaine public tomsofoot.fr.
//
// Sécurité : le filtre est basé sur le NOM DE DOMAINE de la requête. Ainsi,
// même si cette fonction se retrouvait un jour fusionnée dans `main`, la
// production (tomsofoot.fr) ne serait JAMAIS désindexée — seuls les domaines
// d'aperçu reçoivent l'en-tête.
export default async (request, context) => {
  const response = await context.next();
  let host = '';
  try { host = new URL(request.url).hostname.toLowerCase(); } catch (_) {}

  const isPublic = host === 'tomsofoot.fr' || host === 'www.tomsofoot.fr';
  if (!isPublic) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  return response;
};

export const config = { path: '/*' };
