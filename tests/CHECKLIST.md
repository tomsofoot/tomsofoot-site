# Checklist de validation — lecteur de journal

Automatisé = couvert par `tests/reader.spec.mjs` (16/16 ✅). Manuel = à vérifier
visuellement sur les captures / en local.

## Qualité
- [x] Texte net à 100 % (automatisé : canvas HiDPI, backing ≥ 1.8× CSS)
- [x] Texte net à 150 % / 200 % (automatisé : le zoom re-rend, backing augmente)
- [x] Aucun étirement CSS (rendu recalculé, pas de `transform: scale` figé)
- [x] Rendu HiDPI / Retina (automatisé desktop dpr 2, mobile dpr 3)
- [x] Texte sélectionnable (automatisé : sélection non vide)
- [x] Accents français corrects (automatisé : é è à ê…)
- [~] Images nettes à leur résolution normale (manuel — photos source en
      résolution web : nettes à 100 %, s'adoucissent au zoom, **signalé**)

## Navigation
- [x] Couverture seule au lancement (manuel : cover à droite, intérieur vierge)
- [x] Double page sur ordinateur (automatisé : `is-twoup`)
- [x] Page unique sur mobile (automatisé : `is-oneup`, page gauche masquée)
- [x] Bouton précédent / suivant (automatisé : le compteur change)
- [x] Clavier (← → Home End + - 0 F T Échap)
- [x] Glissement tactile (touchstart/touchend horizontal)
- [x] Numéro de page (compteur « 2–3 / 28 »)
- [x] Miniatures / sommaire (panneau + rendu paresseux)
- [x] Plein écran (bouton + Échap + relayout)
- [x] Reprise de lecture (bannière « Reprendre à la page N »)
- [x] Changement d'orientation / redimensionnement (relayout + re-rendu)

## Données
- [x] La bonne publication s'ouvre depuis sa carte (`?edition=slug`)
- [x] Publication programmée invisible avant sa date (`isPubliclyVisible`)
- [x] Publication publiée visible
- [x] Archive accessible
- [x] Mise à la une pilotée par `featured` (accueil → featured)
- [x] Téléchargement activable/désactivable (`download_enabled`)
- [x] Brouillon non accessible publiquement

## Sécurité
- [x] Aucune clé `service_role` côté client (aucune clé dans le dépôt)
- [x] Écriture réservée à l'admin (RLS `0002` + Storage `0003`)
- [x] Fichier non-PDF refusé (régie : MIME + extension + signature `%PDF`)
- [x] Nom de fichier nettoyé (`sanitizeName`)
- [~] URL privée non accessible sans autorisation (manuel — bucket privé + URL
      signée, documenté ; non activé en mode dépôt)

## Non-régression
- [x] Accueil inchangé hors ajout validé (liens magazine → lecteur natif)
- [x] Plus aucun lien Heyzine externe (remplacé par le lecteur natif)
- [x] Lien vers le jeu conservé
- [x] Aucune nouvelle erreur JavaScript (automatisé)
- [ ] Menu desktop fonctionnel (manuel — captures 1366/1920)
- [ ] Menu mobile fonctionnel (manuel — captures 390/430)
- [ ] Vidéos / carrousels fonctionnels (manuel — non touchés)
- [ ] Jogadle / classement fonctionnels (manuel — non touchés)

## Comment lancer les tests

```bash
# À la racine du dépôt :
python3 -m http.server 8100 &
READER_BASE=http://localhost:8100 node tests/reader.spec.mjs
```
