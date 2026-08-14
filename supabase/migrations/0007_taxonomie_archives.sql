-- 0007_taxonomie_archives.sql
-- Classement canonique (zone / compétition / rubrique) + dimensions PDF, pour
-- la page Archives publique. 100 % ADDITIF : n'ajoute que des colonnes NULLABLES
-- sur public.publications, ne renomme/ne supprime rien, ne touche ni Jogadle,
-- ni le classement, ni les comptes, ni les buckets. Les anciens numéros restent
-- valides (colonnes vides = « non classé », affichés quand même).
--
-- Trois AXES séparés (voir assets/js/taxonomy.js, source unique des libellés) :
--   zone_code / competition_code / rubrique_code  = codes stables (kebab-case)
-- On stocke aussi le libellé au moment du classement (pratique pour l'affichage
-- hors-ligne), mais le CODE fait foi.

-- 1) Colonnes de classement (nullables, sans valeur par défaut).
alter table public.publications add column if not exists zone_code        text;
alter table public.publications add column if not exists zone_label       text;
alter table public.publications add column if not exists competition_code text;
alter table public.publications add column if not exists competition_label text;
alter table public.publications add column if not exists rubrique_code    text;
alter table public.publications add column if not exists rubrique_label   text;

-- 2) Dimensions du PDF détectées par la régie (points), pour info/tri/contrôle.
alter table public.publications add column if not exists pdf_width  numeric;
alter table public.publications add column if not exists pdf_height numeric;
alter table public.publications add column if not exists pdf_ratio  numeric;

-- 3) Index de filtrage Archives (année/mois via sort_date déjà indexé en 0004).
create index if not exists publications_zone_idx        on public.publications (zone_code);
create index if not exists publications_competition_idx on public.publications (competition_code);
create index if not exists publications_rubrique_idx    on public.publications (rubrique_code);

-- 4) Backfill « best-effort » de l'ancienne colonne libre `category` vers le bon
--    axe. On ne touche qu'aux lignes non encore classées (rubrique_code null),
--    et on N'ÉCRASE PAS une éventuelle valeur déjà posée par la nouvelle régie.
--    Les compétitions historiques ne sont pas dans `category` (elles vivaient
--    dans les cartes d'accueil, pas dans publications) → on ne mappe ici que les
--    rubriques éditoriales connues. Le reste reste « non classé ».
update public.publications
set rubrique_code = case lower(trim(category))
      when 'grand format' then 'grand-format'
      when 'chronique'    then 'chronique'
      when 'analyse'      then 'analyse'
      when 'reportage'    then 'reportage'
      when 'entretien'    then 'entretien'
      when 'édito'        then 'edito'
      when 'edito'        then 'edito'
      when 'récit'        then 'recit'
      when 'recit'        then 'recit'
      when 'histoire'     then 'histoire'
      when 'portrait'     then 'portrait'
      when 'tactique'     then 'tactique'
      else null
    end,
    rubrique_label = case lower(trim(category))
      when 'grand format' then 'Grand format'
      when 'chronique'    then 'Chronique'
      when 'analyse'      then 'Analyse'
      when 'reportage'    then 'Reportage'
      when 'entretien'    then 'Entretien'
      when 'édito'        then 'Édito'
      when 'edito'        then 'Édito'
      when 'récit'        then 'Récit'
      when 'recit'        then 'Récit'
      when 'histoire'     then 'Histoire'
      when 'portrait'     then 'Portrait'
      when 'tactique'     then 'Tactique'
      else null
    end
where rubrique_code is null
  and category is not null
  and lower(trim(category)) in
      ('grand format','chronique','analyse','reportage','entretien','édito','edito','récit','recit','histoire','portrait','tactique');
