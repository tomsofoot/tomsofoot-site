// Repli facultatif, alimentable avec des chiffres vérifiés. null = aucun chiffre affiché.
// Associer les vues de vidéo à son ID exact pour ne jamais réutiliser celles d'un ancien épisode.
export default {
  videoId: null,
  videoViews: null,
  channelViews: null,
  updatedAt: null // Date ISO de relevé obligatoire pour le repli manuel.
};
