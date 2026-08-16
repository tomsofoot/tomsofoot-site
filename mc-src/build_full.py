import json,unicodedata,os
# ===== MODE DE BUILD : 'test' (TESTFIX actif) ou 'prod' (vraie sélection quotidienne + persistance) =====
BUILD_MODE=os.environ.get("JOGADLE_MODE","test").strip().lower()
if BUILD_MODE not in ("test","prod"): BUILD_MODE="test"
# TESTFIX n'est injecté qu'en mode TEST. En PROD : objet vide -> aucun forçage, sélection quotidienne réelle.
TESTFIX_JS = "{amateur:'Q11576',pro:'Q6125605',expert:'Q314879'}" if BUILD_MODE=="test" else "{}"
css=open("/tmp/jog.css",encoding="utf-8").read()

# --- Extraction de la base d'origine (2838 joueurs + logos) ---
_src=open("/tmp/devine-carriere-1080p.html",encoding="utf-8",errors="ignore").read()
def _extract(h,key,o,c):
    i=h.find(key);s=h.find(o,i);d=0;instr=False;esc=False
    for j in range(s,len(h)):
        ch=h[j]
        if instr:
            if esc:esc=False
            elif ch=='\\':esc=True
            elif ch=='"':instr=False
        else:
            if ch=='"':instr=True
            elif ch==o:d+=1
            elif ch==c:
                d-=1
                if d==0:return h[s:j+1]
careers=json.loads(_extract(_src,"CAREERS=","[","]"))
# Nationalités SPORTIVES (id Wikidata -> nationalité) issues de Wikidata P1532
_natref={}
if os.path.exists("/tmp/natsport.json"):
    _natref=json.load(open("/tmp/natsport.json",encoding="utf-8"))
elif os.path.exists("/tmp/nationalites.json"):
    _natref=json.load(open("/tmp/nationalites.json",encoding="utf-8"))
# Joueurs sans nationalité sportive -> à retirer de la base
_natremoved=set()
if os.path.exists("/tmp/natsport_removed.json"):
    _natremoved=set(json.load(open("/tmp/natsport_removed.json",encoding="utf-8")))
# Corrections photos + joueurs retirés (outil de revue) : fix (id->image), remove (photo vidée), removePlayer (retiré de la base)
_photofix={}; _photovide=set(); _rmplayer=set()
if os.path.exists("/tmp/photos-fix.json"):
    _pf=json.load(open("/tmp/photos-fix.json",encoding="utf-8"))
    _photofix=_pf.get("fix",{}) or {}
    _photovide=set(_pf.get("remove",{}) or {})
    _rmplayer=set(_pf.get("removePlayer",{}) or {})
logos=json.loads(_extract(_src,"LOGOS=","{","}"))

def _norm(s):
    s=unicodedata.normalize("NFD",str(s).lower())
    return "".join(ch for ch in s if unicodedata.category(ch)!="Mn").strip()
def split_name(full):
    t=full.split()
    if len(t)==1: return ("",t[0])
    return (" ".join(t[:-1]), t[-1])

byLevel={"amateur":[],"pro":[],"expert":[]}
_nb_removed_nonat=0
for p in careers:
    lvl=p.get("level","pro")
    if lvl not in byLevel: continue
    if p.get("id") in _natremoved:  # aucune nationalité sportive -> retiré
        _nb_removed_nonat+=1; continue
    if p.get("id") in _rmplayer:    # retiré définitivement via l'outil de revue
        continue
    car=[[c[0],c[1]] for c in p.get("career",[]) if c]
    if not car: continue
    _nat=_natref.get(p.get("id")) or p.get("nat","")
    byLevel[lvl].append({"name":p["name"],"answer":p.get("answer",""),"nat":_nat,"pos":p.get("pos",""),"career":car,"id":p.get("id","")})
print("Retirés (sans nationalité sportive) :",_nb_removed_nonat)

# --- Application du fichier de régie (niveaux + photos) s'il est présent ---
import os
_ph={}
if os.path.exists("/tmp/regie-jogadle.json"):
    _r=json.load(open("/tmp/regie-jogadle.json",encoding="utf-8"))
    _lv=_r.get("levels",{}) or {}
    _ph=_r.get("photos",{}) or {}
    _rm=_r.get("removed",{}) or {}
    _lg=_r.get("logos",{}) or {}
    if _lg:
        logos.update(_lg)  # logos de clubs ajoutés dans la régie
    if _lv:
        flat=[(_lv.get(e["name"],lvl),e) for lvl in list(byLevel) for e in byLevel[lvl]]
        byLevel={"amateur":[],"pro":[],"expert":[]}
        for lvl,e in flat: byLevel.get(lvl,byLevel["pro"]).append(e)
    if _rm:
        for lvl in byLevel: byLevel[lvl]=[e for e in byLevel[lvl] if not _rm.get(e["name"])]
    print("Régie appliquée : ",len(_lv),"niveau(x),",len(_ph),"photo(s),",len(_rm),"retiré(s),",len(_lg),"logo(s) club.")

# Logos de clubs récupérés sur Wikimedia Commons (Wikidata P154) — comblent uniquement les clubs encore sans logo
if os.path.exists("/tmp/club_logos.json"):
    _cl=json.load(open("/tmp/club_logos.json",encoding="utf-8"))
    _nadd=0
    for _club,_u in _cl.items():
        if _club not in logos: logos[_club]=_u; _nadd+=1
    print("Logos Commons (clubs) ajoutés :",_nadd)

# --- On n'affiche que les clubs qui ont un logo : les clubs sans logo sont retirés des parcours ---
_clubs_ret=0; _joueurs_ret=0
for lvl in list(byLevel):
    _newlist=[]
    for e in byLevel[lvl]:
        _car2=[c for c in e["career"] if c[0] in logos]
        _clubs_ret += len(e["career"])-len(_car2)
        if _car2:
            e["career"]=_car2; _newlist.append(e)
        else:
            _joueurs_ret+=1
    byLevel[lvl]=_newlist
print("Clubs sans logo retirés des parcours :",_clubs_ret,"| joueurs sans aucun club à logo retirés :",_joueurs_ret)

# --- Tri chronologique stable des carrières ---
# Les carrières sont déjà classées par année de début, mais à année de début identique l'équipe
# première (période plus longue) précédait parfois l'équipe réserve/jeunes (ex. Raúl : Real Madrid CF
# avant Real Madrid C). On trie par (année de début, année de fin) croissante : à même début, la
# période la plus courte — donc la réserve (B/C) — passe AVANT l'équipe A. Aucun club n'est retiré.
import re as _re
def _career_years(y):
    y=str(y).replace("—","-").replace("–","-").strip()
    m=_re.match(r"^(\d{4})\s*-\s*(\d{0,4})$",y)
    if m:
        s=int(m.group(1)); e=m.group(2)
        if e=="": return (s,9999)
        e=int(e)
        if e<100:                              # fin sur 2 chiffres -> complète le siècle (94->1994, 10->2010)
            full=(s//100)*100+e
            if full<s: full+=100
            e=full
        return (s,e)
    m=_re.match(r"^(\d{4})$",y)
    if m: return (int(m.group(1)),int(m.group(1)))
    return (9999,9999)                          # non lisible -> laissé en fin, ordre d'origine conservé (tri stable)
for lvl in byLevel:
    for e in byLevel[lvl]:
        if isinstance(e.get("career"),list) and len(e["career"])>1:
            e["career"]=sorted(e["career"], key=lambda it:_career_years(it[1] if len(it)>1 else ""))

used=set()
for lvl in byLevel:
    for e in byLevel[lvl]:
        for c in e["career"]: used.add(c[0])
logos={k:v for k,v in logos.items() if k in used}

# Alias / surnoms de football (facultatif) : { "Qxxxx": ["Jorginho", ...] }. Reconnu par la recherche.
ALIASES={}
if os.path.exists("/tmp/aliases.json"):
    try: ALIASES=json.load(open("/tmp/aliases.json",encoding="utf-8"))
    except Exception: ALIASES={}
seen=set();pool=[]
for lvl in byLevel:
    for e in byLevel[lvl]:
        f=e["name"]
        if f in seen: continue
        seen.add(f)
        pr,no=split_name(f)
        al=list(ALIASES.get(e.get("id"),[]) or [])
        toks=f.split()
        if len(toks)>2:                       # prénom + nom (sans intermédiaires) comme alias pratique
            short=toks[0]+" "+toks[-1]
            if short!=f: al.append(short)
        pool.append({"prenom":pr,"nom":no,"full":f,"s":_norm(f),"id":e.get("id"),"aliases":al})

# Photos Wikimedia Commons (id -> URL) — chargées à la révélation
_phurl={}
if os.path.exists("/tmp/photos_url.json"):
    _phurl=json.load(open("/tmp/photos_url.json",encoding="utf-8"))
_phurl.update(_photofix)                 # remplacements manuels (dataURI) priment sur Commons
for _vid in _photovide: _phurl.pop(_vid,None)   # photos volontairement vidées
for _rid in _rmplayer:  _phurl.pop(_rid,None)   # joueurs retirés (par sécurité)
_errsnd=""
if os.path.exists("/tmp/err_sound.txt"):
    _errsnd=open("/tmp/err_sound.txt",encoding="utf-8").read().strip()
_winsnd=""
if os.path.exists("/tmp/win_sound.txt"):
    _winsnd=open("/tmp/win_sound.txt",encoding="utf-8").read().strip()
_revsnd=""
if os.path.exists("/tmp/reveal_sound.txt"):
    _revsnd=open("/tmp/reveal_sound.txt",encoding="utf-8").read().strip()
# Écran final « Le joueur du jour » : table club->pays, fond flouté, miniature vidéo
_clubcountry={}
if os.path.exists("/tmp/club_country.json"):
    _clubcountry=json.load(open("/tmp/club_country.json",encoding="utf-8"))
TROPHY_URI=open("/tmp/trophy_uri.txt").read().strip() if os.path.exists("/tmp/trophy_uri.txt") else ""
# Carte de partage « maître » — PNG verrouillé, embarqué tel quel (aucune recompression / modification).
SHARECARD_URI=open("/tmp/sharecard_uri.txt").read().strip() if os.path.exists("/tmp/sharecard_uri.txt") else ""
SHARECARD_URI_ETOILES=open("/tmp/sharecard_etoiles_uri.txt").read().strip() if os.path.exists("/tmp/sharecard_etoiles_uri.txt") else ""
SHARECARD_URI_RITUEL=open("/tmp/sharecard_rituel_uri.txt").read().strip() if os.path.exists("/tmp/sharecard_rituel_uri.txt") else ""
_bg=open("/tmp/bg_blur.txt").read().strip() if os.path.exists("/tmp/bg_blur.txt") else ""
_vthumb=open("/tmp/videothumb.txt").read().strip() if os.path.exists("/tmp/videothumb.txt") else ""
# Détourage joueur (vrai PNG/WebP transparent) par id Wikidata. Vide -> repli portrait classique.
# (Détourage réel de Saint-Maximin mappé sur l'Expert de test pour valider la composition.)
_cutout={}
if os.path.exists("/tmp/cutout_maximin.txt"):
    _cutout["Q15044053"]=open("/tmp/cutout_maximin.txt").read().strip()  # Allan Saint-Maximin (échantillon embarqué)
# Dossier en ligne des détourages, un fichier <idWikidata>.webp par joueur Expert.
# >>> MODIFIER ICI l'adresse si besoin (doit finir par « / ») <<<
_cutoutbase="https://tomsofoot.fr/cutouts/"
# Palmarès enrichis (généré par generer-palmares-wikidata.mjs). Re-clé par QID pour le jeu.
_palmares={}
_palmsrc=None
for _pf in ("/tmp/palmares-joueurs.json","/tmp/palmares-expert.json"):
    if os.path.exists(_pf):
        _palmsrc=json.load(open(_pf,encoding="utf-8")); break
if _palmsrc:
    for _k,_v in _palmsrc.items():
        _q=_k if (isinstance(_k,str) and _k[:1]=='Q' and _k[1:].isdigit()) else (_v.get('wikidataId') if isinstance(_v,dict) else None)
        if _q: _palmares[_q]=_v
data={"logos":logos,"byLevel":byLevel,"pool":pool,"photos":_ph,"photosUrl":_phurl,"errSound":_errsnd,"winSound":_winsnd,"revealSound":_revsnd,"clubCountry":_clubcountry,"bg":_bg,"videoThumb":_vthumb,"cutout":_cutout,"cutoutBase":_cutoutbase,"palmares":_palmares}
print("Palmarès embarqués :",len(_palmares))
print("Photos Commons :",len(_phurl),"| corrigées:",len(_photofix),"| vidées:",len(_photovide),"| joueurs retirés (revue):",len(_rmplayer))
print("joueurs:",sum(len(byLevel[l]) for l in byLevel),"| logos:",len(logos),"| pool:",len(pool))

# ============================================================================
#  PHASE 2 — EXTERNALISATION DES MÉDIAS (WebP + audio). Aucune image base64 en
#  sortie. Logos/éléments à transparence : WebP LOSSLESS + alpha. Photos/fonds :
#  WebP lossy visuellement imperceptible. Noms versionnés par HASH (cache long).
#  Les images d'origine restent dans les sources (regénérables à volonté).
# ============================================================================
import base64 as _b64, hashlib as _hl, io as _io, subprocess as _sp
from PIL import Image as _PILImage
ASSETS_OUT = os.environ.get("JOGADLE_ASSETS_OUT", "/tmp/mc-assets")
_MEDIA_STATS = {"webp_files":0,"webp_bytes":0,"audio_files":0,"audio_bytes":0,"kept_b64":0}
_MEDIA_CACHE = {}   # dédup par hash de contenu source -> url
def _dataurl_bytes(u):
    if not isinstance(u,str) or not u.startswith("data:") or ";base64," not in u: return None
    try: return _b64.b64decode(u.split(";base64,",1)[1])
    except Exception: return None
def _emit(rel, raw):
    p = os.path.join(ASSETS_OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    if not os.path.exists(p): open(p,"wb").write(raw)
    return "assets/"+rel
def _to_webp(u, sub, lossless):
    b = _dataurl_bytes(u)
    if b is None: return u                       # déjà une URL (ou vide) -> inchangé
    ck = _hl.sha1(b).hexdigest()
    if ck in _MEDIA_CACHE: return _MEDIA_CACHE[ck]
    try:
        im = _PILImage.open(_io.BytesIO(b))
        if im.mode == "P": im = im.convert("RGBA")   # palette -> RGBA (conserve la transparence)
        out = _io.BytesIO()
        if lossless: im.save(out, "WEBP", lossless=True, method=6)          # logos : sans perte, alpha conservé
        else:        im.save(out, "WEBP", quality=82, method=6)             # photos/fonds : imperceptible
        data_out = out.getvalue()
        h = _hl.sha1(data_out).hexdigest()[:16]
        url = _emit(sub+"/"+h+".webp", data_out)
        _MEDIA_STATS["webp_files"] += 1; _MEDIA_STATS["webp_bytes"] += len(data_out)
        _MEDIA_CACHE[ck] = url; return url
    except Exception:
        _MEDIA_STATS["kept_b64"] += 1; return u    # échec rare : on garde (signalé)
def _to_audio(u, name):
    b = _dataurl_bytes(u)
    if b is None: return u
    ck = _hl.sha1(b).hexdigest()
    if ck in _MEDIA_CACHE: return _MEDIA_CACHE[ck]
    try:
        h = _hl.sha1(b).hexdigest()[:16]
        os.makedirs(os.path.join(ASSETS_OUT, "audio"), exist_ok=True)
        src = os.path.join(ASSETS_OUT, "audio", "_src.tmp"); open(src,"wb").write(b)
        rel = "audio/"+name+"-"+h+".webm"; dst = os.path.join(ASSETS_OUT, rel)
        r = _sp.run(["ffmpeg","-y","-i",src,"-c:a","libopus","-b:a","64k",dst], capture_output=True)
        if r.returncode!=0 or not os.path.exists(dst):
            rel = "audio/"+name+"-"+h+".mp3"; dst = os.path.join(ASSETS_OUT, rel)
            _sp.run(["ffmpeg","-y","-i",src,"-c:a","libmp3lame","-b:a","96k",dst], capture_output=True)
        try: os.remove(src)
        except Exception: pass
        if os.path.exists(dst):
            _MEDIA_STATS["audio_files"] += 1; _MEDIA_STATS["audio_bytes"] += os.path.getsize(dst)
            url = "assets/"+rel; _MEDIA_CACHE[ck] = url; return url
    except Exception:
        pass   # ffmpeg absent (ex. build Netlify) : on garde le son en base64 (négligeable, 3 sons ~56 Ko)
    _MEDIA_STATS["kept_b64"] += 1; return u
def _map_webp(d, sub, lossless): return {k:_to_webp(v, sub, lossless) for k,v in d.items()}
# --- data dict : logos (lossless+alpha), photos (lossy), cutout (lossless) ---
data["logos"]  = _map_webp(data["logos"],  "logos",  True)
data["photos"] = _map_webp(data["photos"], "photos", False)
data["photosUrl"] = _map_webp(data["photosUrl"], "photos", False)   # les corrections base64 (photos-fix) -> WebP ; les URLs Commons restent inchangées
data["cutout"] = _map_webp(data["cutout"], "cutout", True)
data["bg"]         = _to_webp(data.get("bg",""),         "bg", False)
data["videoThumb"] = _to_webp(data.get("videoThumb",""), "bg", False)
# --- sons : audio compressé, chargés à la demande (jamais WebP) ---
data["errSound"]    = _to_audio(data.get("errSound",""),    "err")
data["winSound"]    = _to_audio(data.get("winSound",""),    "win")
data["revealSound"] = _to_audio(data.get("revealSound",""), "reveal")
# --- assets injectés à part : cartes de partage (secondaires) + trophée ---
SHARECARD_URI         = _to_webp(SHARECARD_URI,         "sharecards", False)
SHARECARD_URI_ETOILES = _to_webp(SHARECARD_URI_ETOILES, "sharecards", False)
SHARECARD_URI_RITUEL  = _to_webp(SHARECARD_URI_RITUEL,  "sharecards", False)
TROPHY_URI            = _to_webp(TROPHY_URI,            "ui", True)
print("PHASE2 médias -> WebP:",_MEDIA_STATS["webp_files"],"fichiers /",round(_MEDIA_STATS["webp_bytes"]/1048576,2),"Mo | audio:",_MEDIA_STATS["audio_files"],"/",round(_MEDIA_STATS["audio_bytes"]/1024),"Ko | base64 restants:",_MEDIA_STATS["kept_b64"])

DATA=json.dumps(data,ensure_ascii=False)

anim_css='''
/* --- Animation + jouabilité (additif) --- */
.career-timeline{bottom:54px}
.timeline-progress{width:0;transition:width .9s var(--ease)}
.career-card-frame{transition:opacity .45s ease,filter .45s ease,border-color .45s ease,box-shadow .45s ease,background .45s ease}
.club-logo-fallback{width:82px;height:82px;display:grid;place-items:center;font-family:"Archivo Black",sans-serif;font-size:1.7rem;color:#d9b8ff;filter:drop-shadow(0 10px 12px rgba(0,0,0,.42))}
.career-card.is-hidden .club-logo-fallback{display:none}
.career-card.is-visible .club-logo-fallback{display:grid}
/* Zone résultat (Bravo + nom) */
.game-result{margin:22px auto 8px;max-width:1000px;text-align:center;opacity:0;transform:translateY(10px);transition:opacity .5s ease,transform .5s ease;pointer-events:none}
.game-result.show{opacity:1;transform:none;pointer-events:auto}
.result-kicker{color:var(--violet-light);font-family:"Archivo Black",sans-serif;letter-spacing:.05em;font-size:clamp(1.5rem,2.6vw,2.3rem)}
.result-name{font-family:"Archivo Black",sans-serif;color:#fff;font-size:clamp(2.2rem,4.6vw,3.8rem);line-height:1.05;margin-top:10px;text-shadow:0 0 30px rgba(var(--violet-rgb),.5)}
.result-photo{display:block;margin:16px auto 0;max-height:200px;max-width:min(90%,320px);object-fit:contain;border-radius:16px;border:1px solid rgba(var(--violet-rgb),.55);box-shadow:0 0 30px rgba(var(--violet-rgb),.42)}
.game-result:not(.show) .result-photo{display:none}
/* --- Cartes + dates agrandies, meilleur remplissage (demandé) --- */
.career-card{width:184px;flex:0 0 184px}
.career-card-frame{height:232px}
.club-logo,.club-logo-fallback{width:104px;height:104px}
.club-logo-fallback{font-size:2.1rem}
.hidden-club-symbol{font-size:5.8rem}
.club-name{font-size:0.82rem}
.career-period{font-size:1.08rem;font-weight:800;margin-top:26px}
.career-cards{gap:24px;padding:84px 40px 34px}
.career-section{min-height:470px;padding:52px 0 82px}
.career-timeline{bottom:66px}
.career-card.is-active{transform:translateY(-50px) scale(1.06)}
/* ===== Alignement carte <-> point : UNE colonne (career-step) par club =====
   La carte, sa date et SON point partagent la même colonne. La ligne violette va du centre de la
   1re carte au centre de la dernière (via tous les points). Seule la carte reçoit translateY :
   le point est attaché au career-step et ne monte pas avec la carte. */
.career-track{--card-width:145px;--gap:24px;--dot-bottom:15px;position:relative;z-index:6;width:max-content;margin-inline:auto;padding:84px 0 0}
.career-steps{display:grid;grid-auto-flow:column;grid-auto-columns:var(--card-width);gap:var(--gap);align-items:stretch}
.career-step{position:relative;display:flex;flex-direction:column;align-items:center}
.career-track .career-card{width:var(--card-width);flex:0 0 auto;margin-bottom:40px}
.career-step .timeline-node{position:absolute;left:50%;bottom:var(--dot-bottom);transform:translate(-50%,50%);margin:0;z-index:2}
.career-line{position:absolute;left:calc(var(--card-width)/2);right:calc(var(--card-width)/2);bottom:var(--dot-bottom);height:4px;transform:translateY(50%);border-radius:999px;z-index:0;background:rgba(var(--violet-rgb),.32)}
.career-line-fill{position:absolute;left:0;top:0;height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,rgba(var(--violet-rgb),.92),rgba(var(--violet-rgb),1));box-shadow:0 0 9px rgba(var(--violet-rgb),.9),0 0 25px rgba(var(--violet-rgb),.33);transition:width .45s var(--ease)}
@media(max-width:1280px){.career-track{--card-width:132px;--gap:18px}}
@media(max-width:720px){.career-track{--card-width:120px;--gap:14px;padding-top:64px}.career-track .career-card{margin-bottom:30px}}
/* --- Contrôles : Indice ultime (gauche) + Révéler (droite), sans tentatives --- */
.game-controls{grid-template-columns:1fr 1fr}
.hint-button{justify-self:start}
.reveal-button{justify-self:end}
/* --- Suggestions : nom à gauche, prénom à droite, joueur déjà utilisé --- */
.suggestion-item{justify-content:flex-start;gap:10px}
.sg-nom{font-weight:800;color:#fff;letter-spacing:.01em}
.sg-prenom{margin-left:auto;color:rgba(255,255,255,.55);font-weight:600}
.suggestion-item.is-used{opacity:.42;cursor:not-allowed;pointer-events:none}
.sg-left{color:rgba(255,255,255,.9)}
.sg-left b{font-weight:800}
.sg-used{margin-left:auto;color:rgba(255,255,255,.55);font-style:italic;font-size:.82rem;white-space:nowrap}
/* --- Survol suggestions : surbrillance CSS pure (instantanée, jamais pilotée en JS) --- */
.suggestions{scroll-behavior:auto;padding:6px}
.suggestion-item{min-height:54px;padding:0 16px;border-radius:9px;transition:background-color 60ms ease,color 60ms ease,box-shadow 60ms ease,border-color 60ms ease}
.suggestion-item+.suggestion-item{margin-top:2px}
.suggestion-item:hover,.suggestion-item.is-keyboard-active{background:linear-gradient(90deg,rgba(145,45,255,.82),rgba(102,24,190,.62))!important;color:#fff!important;box-shadow:inset 4px 0 0 var(--violet-light)}
.suggestion-item:hover .sg-prenom,.suggestion-item.is-keyboard-active .sg-prenom{color:rgba(255,255,255,.9)}
/* --- Texte saisi plus grand dans la barre de recherche (suggestions inchangées) --- */
.guess-input{font-size:1.38rem}
/* --- Message (« Ce n'est pas le bon joueur ») : plus bas et 50% plus grand --- */
.game-message{font-size:1.14rem;margin-top:22px}
/* --- Indices : nationalité sous « Indice ultime » (gauche), poste sous « Révéler la réponse » (droite) --- */
.player-clues{grid-column:1 / -1;display:grid;grid-template-columns:1fr 1fr;gap:22px;min-height:0;margin-top:16px;animation:clueDrop .55s cubic-bezier(.2,.85,.25,1) both}
.player-clues .clue-nat{justify-self:start}
.player-clues .clue-pos{justify-self:end}
@keyframes clueDrop{from{opacity:0;transform:translateY(-16px) scale(.95)}to{opacity:1;transform:none}}
.player-clues .clue-card{min-width:184px;padding:13px 22px;border-color:rgba(var(--violet-rgb),.6);background:linear-gradient(180deg,rgba(var(--violet-rgb),.2),rgba(255,255,255,.02));animation:cluePulse 1.5s ease-out .15s 3}
@media (max-width:720px){.player-clues{grid-template-columns:1fr;gap:12px}.player-clues .clue-nat,.player-clues .clue-pos{justify-self:stretch}.player-clues .clue-card{width:100%}}
/* --- Indices à la demande (Pro/Expert) : carte verrouillée = cliquable, bien visible --- */
.player-clues .clue-card.is-locked{cursor:pointer;position:relative;overflow:hidden;border-style:solid;border-width:1.5px;border-color:var(--violet-light);background:linear-gradient(180deg,rgba(var(--violet-rgb),.28),rgba(var(--violet-rgb),.08));transition:transform .12s ease,box-shadow .15s ease,border-color .15s ease;animation:clueInvite 7s ease-in-out infinite}
/* Le sursaut ne dure qu'~1,3 s puis la carte reste au repos jusqu'au cycle suivant (toutes les 7 s) */
@keyframes clueInvite{0%,18%,100%{box-shadow:0 0 0 rgba(var(--violet-rgb),0),inset 0 1px 0 rgba(255,255,255,.06);transform:none}9%{box-shadow:0 0 26px rgba(var(--violet-rgb),.75),inset 0 1px 0 rgba(255,255,255,.06);transform:scale(1.035)}}
/* Balayage lumineux qui traverse la carte une fois par cycle de 7 s */
.player-clues .clue-card.is-locked::after{content:'';position:absolute;top:0;left:-60%;width:45%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.28),transparent);transform:skewX(-18deg);animation:clueShine 7s ease-in-out infinite}
@keyframes clueShine{0%{left:-60%}33%,100%{left:130%}}
.player-clues .clue-card.is-locked:hover{border-color:#fff;box-shadow:0 0 34px rgba(var(--violet-rgb),.9);transform:translateY(-2px) scale(1.05);animation-play-state:paused}
.player-clues .clue-card.is-locked .clue-label{color:#fff;opacity:.92}
.player-clues .clue-card.is-locked .clue-value{color:#fff;font-weight:900;letter-spacing:.02em;text-shadow:0 0 12px rgba(var(--violet-rgb),.8)}
.player-clues .clue-card.is-locked .clue-value::before{content:'👁 ';font-size:.95em}
/* EXPERT : indice pas encore atteignable (palier d'essais) -> grisé, non cliquable, cadenas */
.player-clues .clue-card.is-gated{cursor:not-allowed;opacity:.5;filter:grayscale(.45);border-style:dashed;border-color:rgba(var(--violet-rgb),.5);background:linear-gradient(180deg,rgba(var(--violet-rgb),.12),rgba(255,255,255,.02));animation:none}
.player-clues .clue-card.is-gated::after{display:none}
.player-clues .clue-card.is-gated:hover{border-color:rgba(var(--violet-rgb),.5);box-shadow:none;transform:none}
.player-clues .clue-card.is-gated .clue-label{color:rgba(255,255,255,.55)}
.player-clues .clue-card.is-gated .clue-value{color:rgba(255,255,255,.7);font-weight:700;text-shadow:none}
.player-clues .clue-card.is-gated .clue-value::before{content:'🔒 ';font-size:.9em}
/* Indice ultime verrouillé tant que les deux indices ne sont pas consultés */
.hint-button.is-locked{opacity:.5;filter:grayscale(.3)}
.hint-button.is-locked:hover{opacity:.62}
@keyframes cluePulse{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 0 0 rgba(var(--violet-rgb),0)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 0 30px rgba(var(--violet-rgb),.65)}}
.player-clues .clue-label{font-size:.66rem;color:var(--violet-light)}
.player-clues .clue-value{font-size:1.12rem;font-weight:800}
/* --- Retour visuel au clic sur VALIDER : le bouton s'illumine --- */
.validate-button{transition:transform .12s ease,box-shadow .18s ease,filter .12s ease,background .18s ease}
.validate-button:active{transform:translateY(0) scale(.97);filter:brightness(1.15)}
.validate-button.is-pressed{animation:vbFlash .5s ease}
@keyframes vbFlash{
  0%{box-shadow:0 0 0 0 rgba(var(--violet-rgb),.6),0 0 30px rgba(var(--violet-rgb),.75);filter:brightness(1.4);background:linear-gradient(180deg,rgba(var(--violet-rgb),.85),rgba(var(--violet-rgb),.5))}
  100%{box-shadow:0 0 0 12px rgba(var(--violet-rgb),0),0 0 0 rgba(var(--violet-rgb),0);filter:brightness(1)}
}
@media(prefers-reduced-motion:reduce){.validate-button.is-pressed{animation:none}}
'''

# ================= Écran final EXPERT « Le joueur du jour » (scène fixe 1672x941, design strict) =================
# Deux colonnes, portrait 668x430, parcours 1 ligne (carrousel si 7+), colonne éditoriale (4 blocs).
# La scène garde ses proportions et se met à l'échelle proportionnellement (jamais réempilée > 700px).
jdj_css='''
#rdsWrap{width:100%;margin:0 auto;overflow:hidden}
.rds-stage{position:relative;width:1672px;height:941px;transform-origin:top left;font-family:Montserrat,Arial,sans-serif;color:#f2eef0}
.rds-bg{position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,10,35,.76),rgba(8,13,43,.35) 48%,rgba(6,9,31,.74)),var(--rds-bg) center/cover no-repeat;filter:saturate(.72) brightness(.62)}
.rds-bg::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,transparent 18%,rgba(2,5,24,.30) 62%,rgba(2,5,21,.82) 100%)}
.rds-panel{position:absolute;left:125px;top:45px;width:1421px;height:841px;border:1px solid rgba(196,187,224,.58);border-radius:21px;overflow:hidden;padding:31px 47px 20px;background:radial-gradient(circle at 30% 38%,rgba(26,76,165,.26),transparent 39%),linear-gradient(118deg,rgba(4,27,79,.98),rgba(10,18,58,.98) 58%,rgba(22,18,63,.98));box-shadow:0 30px 80px rgba(0,0,20,.42),inset 0 0 80px rgba(40,65,135,.08)}
.rds-hero{text-align:center;margin:0 0 18px}
.rds-hero h1{margin:0;font-size:28px;line-height:1.25;letter-spacing:.29em;text-indent:.29em;font-weight:700;text-shadow:0 2px 12px rgba(0,0,0,.45)}
.rds-hero p{margin:3px 0 0;font-size:17px;letter-spacing:.11em;font-weight:500;color:#e8e5ea}
.rds-grid{display:grid;grid-template-columns:668px 1px 520px;column-gap:48px;align-items:start}
.rds-sep{width:1px;height:646px;margin-top:15px;background:linear-gradient(180deg,transparent,rgba(202,199,226,.28) 12%,rgba(202,199,226,.28) 88%,transparent)}
/* === Composition « joueur détouré + panneaux flottants » — SANS cadre intermédiaire === */
.player-visual-stage,.left-stage{position:relative;width:668px;height:430px;overflow:visible;isolation:isolate;perspective:1400px;border:0;border-radius:0;background:transparent;box-shadow:none}
/* Les calques de composition n'apparaissent qu'avec un vrai détourage ; sinon portrait classique */
.player-visual-stage:not(.has-player-cutout) .stage-atmosphere,
.player-visual-stage:not(.has-player-cutout) .stage-halo,
.player-visual-stage:not(.has-player-cutout) .glass-aura,
.player-visual-stage:not(.has-player-cutout) .career-glass,
.player-visual-stage:not(.has-player-cutout) .player-cutout,
.player-visual-stage:not(.has-player-cutout) .player-ground-light{display:none}
.player-visual-stage.has-player-cutout .classic-portrait{display:none}
.player-visual-stage:not(.cutout-loaded) .career-glass,
.player-visual-stage:not(.cutout-loaded) .glass-aura{opacity:0}
.career-glass,.glass-aura{transition:opacity .45s ease}
/* Atmosphère + halo */
.stage-atmosphere{position:absolute;z-index:1;inset:-30px;pointer-events:none;background:radial-gradient(ellipse at 50% 74%,rgba(47,70,150,.30),transparent 46%),radial-gradient(circle at 50% 32%,rgba(120,96,205,.13),transparent 34%)}
.stage-halo{position:absolute;z-index:2;left:50%;top:16%;width:48%;height:72%;transform:translateX(-50%);border-radius:50%;background:radial-gradient(ellipse,rgba(66,86,180,.22),rgba(96,72,190,.10) 55%,transparent 72%);filter:blur(34px);pointer-events:none}
.glass-aura{position:absolute;z-index:2;top:62px;width:24%;height:316px;border-radius:24px;pointer-events:none;background:radial-gradient(ellipse,rgba(96,86,205,.20),rgba(84,104,210,.12) 60%,transparent 78%);filter:blur(26px);opacity:.7}
.glass-aura--left{left:30px;transform:rotate(-2deg)}
.glass-aura--right{right:30px;transform:rotate(2deg)}
/* Calque 3 — panneaux verre : plus étroits, plus hauts, inclinés vers le joueur */
.career-glass{position:absolute;z-index:3;top:42px;width:27%;height:356px;padding:18px 15px;overflow:hidden;border:0;border-radius:11px;color:rgba(246,243,248,.95);background:linear-gradient(150deg,rgba(23,40,96,.46) 0%,rgba(15,30,82,.32) 52%,rgba(9,20,60,.22) 100%);box-shadow:0 26px 50px rgba(0,2,26,.34),0 0 30px rgba(120,110,225,.14),inset 0 1px 0 rgba(255,255,255,.16),inset 0 -1px 0 rgba(110,100,210,.14);backdrop-filter:blur(14px) saturate(135%);-webkit-backdrop-filter:blur(14px) saturate(135%);transform-style:preserve-3d}
.career-glass--left{left:20px;transform-origin:right center;transform:rotateY(11deg) rotateX(.6deg) translateZ(-8px);box-shadow:0 26px 50px rgba(0,2,26,.34),0 0 30px rgba(120,110,225,.14),inset 0 1px 0 rgba(255,255,255,.16),inset -1px 0 0 rgba(176,190,255,.34)}
.career-glass--right{right:20px;transform-origin:left center;transform:rotateY(-11deg) rotateX(.6deg) translateZ(-8px);box-shadow:0 26px 50px rgba(0,2,26,.34),0 0 30px rgba(120,110,225,.14),inset 0 1px 0 rgba(255,255,255,.16),inset 1px 0 0 rgba(176,190,255,.34)}
/* Bordure lumineuse progressive (dégradé + masque exclude, jamais uniforme) */
.career-glass::before{content:"";position:absolute;z-index:5;inset:0;padding:1px;border-radius:inherit;pointer-events:none;background:linear-gradient(132deg,rgba(200,210,255,.72) 0%,rgba(150,170,255,.42) 22%,rgba(120,130,230,.14) 48%,rgba(120,130,230,.05) 68%,rgba(160,150,240,.34) 100%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude}
/* Reflet supérieur de verre (le contenu passe devant) */
.career-glass::after{content:"";position:absolute;z-index:1;top:-42%;left:-18%;width:86%;height:76%;border-radius:50%;pointer-events:none;background:radial-gradient(ellipse,rgba(255,255,255,.11) 0%,rgba(157,168,255,.06) 38%,transparent 72%);transform:rotate(-12deg);filter:blur(4px)}
.career-glass>*{position:relative;z-index:3}
/* Voile intérieur : le panneau se fond doucement près du joueur */
.career-glass--left .glass-inner-fade{position:absolute;z-index:4;top:0;right:0;width:24%;height:100%;background:linear-gradient(90deg,transparent,rgba(7,15,51,.34));pointer-events:none}
.career-glass--right .glass-inner-fade{position:absolute;z-index:4;top:0;left:0;width:24%;height:100%;background:linear-gradient(270deg,transparent,rgba(7,15,51,.34));pointer-events:none}
/* Contenu intérieur des panneaux */
.career-glass__title{display:flex;align-items:center;gap:11px;margin:0 0 16px;color:rgba(249,246,251,.96);font-size:11px;font-weight:700;letter-spacing:.17em;text-transform:uppercase}
.career-glass__title::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,#ef2637,rgba(239,38,55,.22),transparent)}
.career-glass__row{display:grid;grid-template-columns:47px 28px minmax(0,1fr);gap:9px;align-items:center;min-height:52px;padding:7px 0;border-bottom:1px solid rgba(203,203,231,.12)}
.career-glass__row:last-child{border-bottom:0}
.career-glass__row time{color:rgba(207,205,221,.72);font-size:9px}
.career-glass__row img{width:25px;height:25px;object-fit:contain;filter:drop-shadow(0 3px 5px rgba(0,0,20,.25))}
.career-glass__row strong{display:block;overflow:hidden;color:rgba(247,244,249,.92);font-size:10px;font-weight:600;white-space:nowrap;text-overflow:ellipsis}
.career-glass__row small{display:block;margin-top:2px;color:rgba(187,185,205,.61);font-size:8px}
.career-glass__stat{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:10px 0;border-bottom:1px solid rgba(203,203,231,.12);font-size:11px}
.career-glass__stat:last-child{border-bottom:0}
.career-glass__stat span{color:rgba(207,205,221,.72)}
.career-glass__stat strong{font-weight:700;color:rgba(247,244,249,.94);white-space:nowrap;max-width:58%;overflow:hidden;text-overflow:ellipsis;text-align:right}
/* Calque 5 — joueur détouré (mode-cutout) : devant tout, plus imposant. Ombres extérieures uniquement. */
.player-cutout{position:absolute;z-index:5;left:50%;bottom:-1px;width:47%;height:100%;margin:0;transform:translateX(-50%);pointer-events:none}
.player-cutout__image{display:block;width:100%;height:100%;object-fit:contain;object-position:center bottom;filter:drop-shadow(0 22px 28px rgba(1,4,23,.52)) drop-shadow(0 0 14px rgba(95,112,210,.16))}
/* Ombre/lumière de contact au sol */
.player-ground-light{position:absolute;z-index:6;left:50%;bottom:-14px;width:48%;height:40px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(ellipse,rgba(88,104,199,.34),transparent 70%);filter:blur(16px);pointer-events:none}
/* IMAGE WIKIDATA : portrait photographique classique (aucun détourage disponible) */
.classic-portrait{position:absolute;inset:0;margin:0;overflow:hidden;border:0;border-radius:13px;background:transparent}
.classic-portrait img{width:100%;height:100%;object-fit:contain;object-position:center}
.classic-portrait .rds-portrait-label{position:absolute;top:24px;left:29px;z-index:2;font-size:13px;font-weight:500}
.classic-portrait .rds-portrait-label::after{content:"";display:block;width:24px;height:2px;margin-top:10px;background:#ef2637}
.rds-journey{margin-top:27px}
.rds-rule{display:flex;align-items:center;gap:14px;margin:0 4px 15px;color:#eae7eb;white-space:nowrap;font-size:12px;font-weight:700;letter-spacing:.18em}
.rds-rule::before,.rds-rule::after{content:"";flex:1;height:1px;background:rgba(191,196,217,.42)}
.rds-clubs-nav{position:relative}
.rds-clubs-vp{overflow:hidden;width:668px}
.rds-clubs{display:flex;flex-wrap:nowrap;gap:12px;transition:transform .35s cubic-bezier(.2,.8,.25,1)}
.rds-club{position:relative;flex:0 0 101px;width:101px;height:168px;padding:11px 6px 8px;border-radius:10px;color:#101a44;background:linear-gradient(150deg,#fff,#e6e2e4);text-align:center;box-shadow:0 9px 25px rgba(1,6,28,.20)}
.rds-club:not(:last-child)::after{content:"\\203A";position:absolute;right:-13px;top:60px;z-index:3;color:#ef2637;font:34px/1 Arial,sans-serif;text-shadow:0 0 5px rgba(239,38,55,.2)}
.rds-dates{font-size:10px;font-weight:600}
.rds-crest{width:58px;height:74px;margin:9px auto 6px;display:grid;place-items:center;background:#fff;border-radius:7px;overflow:hidden}
.rds-crest img{max-width:100%;max-height:100%;object-fit:contain}
.rds-crest.rds-fallback{background:#111d4b;color:#fff;font-weight:700;font-size:12px;border-radius:7px}
.rds-club-name{font-size:10px;line-height:1.18;font-weight:700}
.rds-country{margin-top:3px;font-size:9px;color:#42507a;letter-spacing:.02em;text-transform:uppercase}
.rds-arrow{position:absolute;top:64px;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(8,16,45,.72);color:#fff;cursor:pointer;z-index:6;font:18px/1 Arial;transition:transform .12s ease,background .12s ease}
.rds-arrow:hover{background:rgba(30,50,110,.92);transform:scale(1.08)}
.rds-arrow.rds-prev{left:-14px}
.rds-arrow.rds-next{right:-14px}
.rds-arrow[disabled]{opacity:.28;pointer-events:none}
.rds-right{position:relative;padding-top:2px}
.rds-eyebrow{margin:0 0 8px;color:#ff7a86;font-size:12px;font-weight:700;letter-spacing:.22em}
.rds-right h2{margin:0 0 14px;font-size:35px;line-height:1.18;letter-spacing:.07em;font-weight:700;text-transform:uppercase}
.rds-name-title{font-weight:800;margin-top:2px}
.rds-intro{max-width:520px;margin:0 0 18px;font-size:15px;line-height:1.52;color:#e5e1e7}
.rds-redrule{display:flex;align-items:center;gap:9px;margin:0 0 16px}
.rds-redrule::before,.rds-redrule::after{content:"";height:1px;background:rgba(194,194,221,.30)}
.rds-redrule::before{flex:0 0 230px}
.rds-redrule::after{flex:1}
.rds-redrule i{width:31px;height:2px;background:#ef2637}
.rds-right h3{margin:0 0 12px;font-size:17px;letter-spacing:.19em;font-weight:700;text-transform:uppercase}
.rds-take{display:grid;grid-template-columns:45px 1fr;align-items:center;gap:18px;margin:0 0 10px;color:#e4e0e7;font-size:14px}
.rds-take b{display:grid;place-items:center;height:39px;border:1px solid rgba(185,191,221,.46);border-radius:10px;font-size:18px;font-weight:700}
.rds-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:11px}
.rds-stat{height:61px;display:grid;align-content:center;text-align:center;border:1px solid rgba(177,184,217,.36);border-radius:10px}
.rds-stat strong{font-size:25px;line-height:1}
.rds-stat small{margin-top:3px;font-size:13px;color:#cbc8d5}
.rds-stat.rds-verify{grid-column:1/-1;height:61px;align-content:center;color:#cbc8d5;font-size:14px;font-style:italic}
.rds-palm-extra{margin-top:2px}
.palm-summary{font-size:12px;color:#cbc8d5;margin:0 0 9px;letter-spacing:.01em}
.palm-carousel{position:relative}
.palm-viewport{overflow-x:auto;scroll-behavior:smooth;-ms-overflow-style:none;scrollbar-width:none;padding:3px 0 4px}
.palm-viewport::-webkit-scrollbar{display:none}
.palm-track{display:flex;gap:11px;width:max-content;padding:0 2px}
.palm-card{position:relative;flex:0 0 172px;min-height:78px;padding:11px 13px;display:flex;flex-direction:column;justify-content:center;border-radius:12px;border:1px solid rgba(150,170,255,.26);background:linear-gradient(180deg,rgba(22,38,94,.55),rgba(11,22,64,.32));box-shadow:0 10px 24px rgba(0,3,26,.30),inset 0 1px 0 rgba(255,255,255,.14);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:transform .16s ease,box-shadow .16s ease}
.palm-card:hover{transform:translateY(-2px);box-shadow:0 15px 30px rgba(0,3,26,.42),0 0 20px rgba(110,120,225,.18),inset 0 1px 0 rgba(255,255,255,.18)}
.palm-card--award{border-color:rgba(255,150,120,.34);background:linear-gradient(180deg,rgba(70,44,58,.46),rgba(34,24,44,.30))}
.palm-card-top{display:flex;align-items:center;gap:7px}
.palm-ico{font-size:13px;line-height:1;filter:drop-shadow(0 0 6px rgba(255,205,120,.4))}
.palm-card-name{flex:1;min-width:0;font-size:11.5px;font-weight:700;line-height:1.15;color:#f5f2f8;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.palm-x{flex:0 0 auto;padding:1px 7px;border-radius:99px;background:linear-gradient(180deg,rgba(150,166,255,.42),rgba(104,112,220,.24));border:1px solid rgba(170,182,255,.6);box-shadow:0 0 10px rgba(120,132,235,.35);color:#fff;font-size:9.5px;font-weight:800}
.palm-seasons{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.palm-pill{padding:1px 7px;border-radius:99px;background:rgba(120,135,235,.16);border:1px solid rgba(150,165,240,.3);color:#dfe0ee;font-size:9px;font-weight:600;line-height:1.6}
.palm-star{position:absolute;top:8px;right:10px;color:#ff9a86;font-size:11px;line-height:1}
.palm-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:6;width:28px;height:28px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(160,175,255,.4);background:rgba(10,20,52,.80);color:#fff;cursor:pointer;font:16px/1 Arial;box-shadow:0 4px 12px rgba(0,2,24,.4);transition:background .12s ease,transform .12s ease}
.palm-arrow:hover{background:rgba(34,54,120,.95);transform:translateY(-50%) scale(1.08)}
.palm-prev{left:-4px}
.palm-next{right:-4px}
.palm-arrow[disabled]{opacity:.25;pointer-events:none}
.palm-arrow.is-hidden{display:none}
.rds-video{min-height:120px;margin-top:14px;padding:14px;display:grid;grid-template-columns:158px 1fr;gap:18px;align-items:center;border:1px solid rgba(177,184,217,.30);border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.02),transparent)}
.rds-vthumb{height:96px;border:1px solid rgba(183,187,213,.36);border-radius:10px;overflow:hidden}
.rds-vthumb img{width:100%;height:100%;object-fit:cover}
.rds-veyebrow{margin-bottom:7px;color:#ef2637;font-size:12px;letter-spacing:.12em;font-weight:700}
.rds-vcopy h4{margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:600}
.rds-vbtn{width:100%;height:44px;display:flex;justify-content:center;align-items:center;gap:12px;border:1px solid rgba(255,92,100,.8);border-radius:6px;color:#fff;background:linear-gradient(100deg,#be1226,#eb2739);text-decoration:none;font-size:16px;font-weight:600;transition:transform .18s ease,filter .18s ease}
.rds-vbtn:hover{transform:translateY(-2px);filter:brightness(1.12)}
.rds-vplay{width:25px;height:25px;display:grid;place-items:center;border:2px solid #fff;border-radius:50%;font-size:11px}
#jdjPanel{animation:jdjIn .6s cubic-bezier(.2,.85,.25,1) both}
@keyframes jdjIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.game-result.is-expert{max-width:none}
'''

diamond='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z"/><path d="M12 8.4l3.2 1.8v3.6L12 15.6l-3.2-1.8v-3.6z" fill="currentColor" stroke="none"/></svg>'
eye='<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>'
dots="".join('<span class="attempt-dot is-active"></span>' for _ in range(5))

js=r'''
(function(){
  var DATA=__DATA__;
  var LOGOS=DATA.logos, BYLEVEL=DATA.byLevel, POOL=DATA.pool;
  var LEVELS={
    amateur:{num:'1',label:'NIVEAU AMATEUR',cluesAt:0,nameAt:0},
    pro:{num:'4',label:'NIVEAU PRO',cluesAt:3,nameAt:3},
    expert:{num:'7',label:'NIVEAU EXPERT',cluesAt:3,nameAt:5,clueAt:{nat:3,pos:5}}
  };
  var MAXDOTS=5, ORDER=['amateur','pro','expert'];
  var S={}, level='amateur', finished=false, busy=false, token=0;
  // =====================================================================
  //  MOTEUR QUOTIDIEN DÉTERMINISTE — identique dans le monde entier
  //  Journée officielle = fuseau Europe/Paris. Jamais l'heure locale de
  //  l'appareil. Jamais Math.random. Clé fixe + date Paris + niveau + QID.
  // =====================================================================
  var DAILY_KEY='JOGADLE_DAILY_V1';         // clé fixe du moteur (ne pas changer sans vouloir décaler tout le calendrier)
  var LAUNCH_DATE='2026-08-04';             // <<< DATE DE LANCEMENT (modifiable) : jour 0 du calendrier
  function pad2(n){return (n<10?'0':'')+n;}
  // Date « du jour » dans le fuseau de Paris, au format AAAA-MM-JJ (DST géré par Intl).
  function parisDateStr(d){
    d=d||new Date();
    try{
      var p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d),o={};
      p.forEach(function(x){o[x.type]=x.value;});
      if(o.year&&o.month&&o.day) return o.year+'-'+o.month+'-'+o.day;
    }catch(e){}
    return d.getUTCFullYear()+'-'+pad2(d.getUTCMonth()+1)+'-'+pad2(d.getUTCDate());
  }
  // Index de jour stable, indépendant du fuseau local (calculé depuis la chaîne AAAA-MM-JJ).
  function dateToIndex(ds){var p=String(ds).split('-');return Math.floor(Date.UTC(+p[0],+p[1]-1,+p[2])/86400000);}
  function addDays(ds,n){var p=String(ds).split('-');var t=Date.UTC(+p[0],+p[1]-1,+p[2])+n*86400000;var d=new Date(t);return d.getUTCFullYear()+'-'+pad2(d.getUTCMonth()+1)+'-'+pad2(d.getUTCDate());}
  // Hachage déterministe (cyrb53) -> graine entière stable.
  function hash53(str,seed){
    var h1=0xdeadbeef^(seed>>>0),h2=0x41c6ce57^(seed>>>0);
    for(var i=0;i<str.length;i++){var ch=str.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}
    h1=Math.imul(h1^(h1>>>16),2246822507);h1^=Math.imul(h2^(h2>>>13),3266489909);
    h2=Math.imul(h2^(h2>>>16),2246822507);h2^=Math.imul(h1^(h1>>>13),3266489909);
    return (4294967296*(2097151&h2)+(h1>>>0))>>>0;
  }
  // PRNG déterministe (mulberry32) — pour un mélange stable par niveau, sans Math.random.
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
  // Liste des joueurs d'un niveau, triée de façon stable par numéro de QID croissant.
  var POOLSORT={};
  function sortedPool(level){
    if(POOLSORT[level]) return POOLSORT[level];
    var a=(BYLEVEL[level]||[]).slice();
    a.sort(function(x,y){var qx=parseInt(String(x.id||'Q0').slice(1),10)||0,qy=parseInt(String(y.id||'Q0').slice(1),10)||0;return qx-qy||String(x.id).localeCompare(String(y.id));});
    POOLSORT[level]=a; return a;
  }
  // Permutation déterministe (Fisher-Yates) des indices, graine fixe par (clé+niveau).
  var ORDERCACHE={};
  function shuffledOrder(n,level){
    var ck=level+':'+n; if(ORDERCACHE[ck]) return ORDERCACHE[ck];
    var rnd=mulberry32(hash53(DAILY_KEY+'|'+level,1));
    var idx=[];for(var i=0;i<n;i++)idx.push(i);
    for(var j=n-1;j>0;j--){var k=Math.floor(rnd()*(j+1));var t=idx[j];idx[j]=idx[k];idx[k]=t;}
    ORDERCACHE[ck]=idx; return idx;
  }
  // Sélection des 3 joueurs pour une date Paris donnée. Rotation : parcourt toute la
  // liste avant répétition ; +1 déterministe pour éviter qu'un QID soit choisi deux fois le même jour.
  function pickDaily(dateStr){
    var dayIdx=dateToIndex(dateStr)-dateToIndex(LAUNCH_DATE),out={},taken={};
    ['amateur','pro','expert'].forEach(function(l){
      var pool=sortedPool(l),n=pool.length;
      if(!n){out[l]=null;return;}
      var order=shuffledOrder(n,l),base=((dayIdx%n)+n)%n,step=0,chosen=null;
      while(step<n){var cand=pool[order[(base+step)%n]];if(cand&&!taken[cand.id]){chosen=cand;break;}step++;}
      if(!chosen)chosen=pool[order[base]];
      out[l]=chosen;if(chosen)taken[chosen.id]=true;
    });
    return out;
  }
  function findByQid(level,qid){var a=BYLEVEL[level]||[];for(var i=0;i<a.length;i++){if(a[i].id===qid)return a[i];}return null;}

  // ---- Débogage / aperçu (facultatif, sans effet sur la sélection mondiale) ----
  //  ?date=AAAA-MM-JJ  force la journée courante du moteur (test minuit / archives)
  //  ?amateur=Qxxx ?pro=Qxxx ?expert=Qxxx  force un joueur (aperçu ; la progression n'est alors pas sauvegardée)
  var PREVIEW=false, DATE_OVERRIDE=null;
  try{
    var _qs=new URLSearchParams(location.search||'');
    var _d=_qs.get('date'); if(_d&&/^\d{4}-\d{2}-\d{2}$/.test(_d)) DATE_OVERRIDE=_d;
  }catch(e){}
  function currentParisDate(){return DATE_OVERRIDE||parisDateStr();}

  var TODAY=currentParisDate();
  var DAILY=pickDaily(TODAY);
  // ===== MODE TEST : joueurs fixes du jour (pour vérifier le comportement du jeu) =====
  // Amateur : Raúl González · Pro : Sergio Rico · Expert : Olivier Dacourt.
  // BUILD_MODE injecté au build : 'test' (TESTFIX actif) ou 'prod' (aucun forçage). Voir build_full.py / JOGADLE_MODE.
  var BUILD_MODE='__BUILD_MODE__';
  // En PROD, __TESTFIX__ = {} -> TESTMODE reste false -> vraie sélection quotidienne + persistance normale.
  var TESTFIX=__TESTFIX__;
  var TESTMODE=false;   // TEST seulement : les 3 niveaux repartent de zéro à chaque chargement (rien n'est sauvegardé)
  ['amateur','pro','expert'].forEach(function(l){ if(!TESTFIX[l])return; var m=findByQid(l,TESTFIX[l]); if(m){DAILY[l]=m;TESTMODE=true;} });
  try{
    var _qp=new URLSearchParams(location.search||'');
    ['amateur','pro','expert'].forEach(function(l){
      var want=_qp.get(l); if(!want) return;
      var m=findByQid(l,want); if(m){ DAILY[l]=m; PREVIEW=true; }
    });
  }catch(e){}

  var $=function(id){return document.getElementById(id);};
  var cardsEl=$('cards'),stepsEl=$('careerSteps'),progress=$('progress'),input=$('guessInput'),form=$('guessForm'),
      box=$('suggestions'),msg=$('message'),dotsEl=$('attemptDots'),validate=$('validateButton'),
      hintBtn=$('hintButton'),hintTxt=$('hintButtonText'),revealBtn=$('revealAnswerButton'),
      levelLabel=$('levelLabel'),root=$('jogadle'),selector=$('levelSelector'),
      cluesEl=$('playerClues'),clueNat=$('clueNat'),cluePos=$('cluePos'),
      clueCardNat=$('clueCardNat'),clueCardPos=$('clueCardPos'),
      resultEl=$('gameResult'),resultKicker=$('resultKicker'),resultName=$('resultName'),resultPhoto=$('resultPhoto'),
      simpleResult=$('simpleResult'),jdjPanel=$('jdjPanel'),eaExpert=$('eaExpert'),
      rdsWrap=$('rdsWrap'),rdsStage=$('rdsStage'),rdsPortrait=$('rdsPortrait'),rdsClubs=$('rdsClubs'),rdsClubsNav=$('rdsClubsNav'),
      rdsStageVisual=$('rdsStageVisual'),rdsCutoutImg=$('rdsCutoutImg'),rdsFeedL=$('rdsFeedL'),rdsFeedR=$('rdsFeedR'),rdsPanelRTitle=$('rdsPanelRTitle'),
      rdsEyebrow=$('rdsEyebrow'),rdsTitle=$('rdsTitle'),rdsIntro=$('rdsIntro'),rdsPoints=$('rdsPoints'),rdsStats=$('rdsStats'),rdsPalmExtra=$('rdsPalmExtra'),rdsVideoThumb=$('rdsVideoThumb');
  var PHOTOS=DATA.photos||{};
  var PHOTOSURL=DATA.photosUrl||{};
  var CLUBCOUNTRY=DATA.clubCountry||{};
  var CUTOUT=DATA.cutout||{};
  if(rdsStage&&DATA.bg) rdsStage.style.setProperty('--rds-bg','url('+DATA.bg+')');
  if(rdsVideoThumb&&DATA.videoThumb) rdsVideoThumb.src=DATA.videoThumb;
  var ERRSND=DATA.errSound?new Audio(DATA.errSound):null;
  if(ERRSND){ERRSND.preload='auto';ERRSND.volume=0.6;}
  function playErr(){ if(!ERRSND)return; try{ERRSND.currentTime=0; var p=ERRSND.play(); if(p&&p.catch)p.catch(function(){});}catch(e){} }
  var WINSND=DATA.winSound?new Audio(DATA.winSound):null;
  if(WINSND){WINSND.preload='auto';WINSND.volume=0.6;}
  function playWin(){ if(!WINSND)return; try{WINSND.currentTime=0; var p=WINSND.play(); if(p&&p.catch)p.catch(function(){});}catch(e){} }
  var REVSND=DATA.revealSound?new Audio(DATA.revealSound):null;
  if(REVSND){REVSND.preload='auto';REVSND.volume=0.6;}
  function playReveal(){ if(!REVSND)return; try{REVSND.currentTime=0; var p=REVSND.play(); if(p&&p.catch)p.catch(function(){});}catch(e){} }

  function range(a,b){var r=[];for(var i=a;i<b;i++)r.push(i);return r;}
  function norm(s){return (s||'').toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g,'').trim();}
  function compact(s){return norm(s).replace(/[^a-z0-9]/g,'');}
  function initials(s){var w=(s||'').replace(/[^A-Za-zÀ-ÿ0-9\s]/g,' ').split(/\s+/).filter(Boolean);if(!w.length)return '?';if(w.length===1)return w[0].slice(0,2).toUpperCase();return (w[0][0]+w[1][0]).toUpperCase();}
  function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function player(){return DAILY[level];}
  function career(){return player()?player().career:[];}
  function setMsg(t,cls){msg.textContent=t||'';msg.className='game-message'+(cls?(' '+cls):'');}

  function newState(l){
    var n=(DAILY[l]&&DAILY[l].career)?DAILY[l].career.length:0;
    var order = l==='amateur' ? range(0,n) : (l==='pro' ? (n>1?[0,n-1]:[0]) : [0]);
    var q;
    if(l==='amateur') q=[];
    else if(l==='pro'){ q=[]; for(var i=1;i<n-1;i++) q.push(i); }
    else { q=[]; for(var j=1;j<n;j++) q.push(j); }
    return {attempts:0,revealed:{},order:order.slice(),queue:q,active:-1,solved:false,answerRevealed:false,hintUsed:false,used:{},clue:{nat:false,pos:false},guesses:[]};
  }

  function accepted(p){var s={};function add(v){var c=compact(v);if(c)s[c]=1;}add(p.name);add(p.answer);(p.aliases||[]).forEach(add);var parts=(p.name||'').trim().split(/\s+/).filter(Boolean);if(parts.length)add(parts[parts.length-1]);return s;}
  function isCorrect(v){return !!accepted(player())[compact(v)];}

  // Une COLONNE (career-step) par club : la carte, sa date et SON point partagent exactement la même colonne.
  // Le nombre de points est toujours égal au nombre de cartes (générés depuis le même tableau de clubs).
  function renderCards(){
    var c=career();
    stepsEl.innerHTML=c.map(function(it){
      var club=it[0],years=it[1],logo=LOGOS[club]||'';
      var media=logo?('<img class="club-logo" src="'+logo+'" alt="">'):('<div class="club-logo-fallback">'+initials(club)+'</div>');
      return '<div class="career-step">'+
        '<article class="career-card is-hidden">'+
          '<div class="career-card-frame"><span class="card-decoration"></span>'+
            '<div class="club-content"><span class="hidden-club-symbol">?</span>'+media+'<span class="club-name">'+club+'</span></div>'+
          '</div><span class="career-period">'+years+'</span></article>'+
        '<span class="timeline-node"></span>'+
      '</div>';
    }).join('');
    cardsEl.style.setProperty('--n', c.length);   // nb de colonnes = nb de clubs (ligne bornée aux centres des cartes)
  }
  function cards(){return [].slice.call(stepsEl.querySelectorAll('.career-card'));}
  function nodes(){return [].slice.call(stepsEl.querySelectorAll('.timeline-node'));}

  function applyState(){
    var st=S[level],n=career().length,rightmost=-1;
    cards().forEach(function(card,i){
      var vis=!!st.revealed[i];
      card.classList.toggle('is-hidden',!vis);
      card.classList.toggle('is-visible',vis);
      card.classList.toggle('is-active', i===st.active);
      if(vis&&i>rightmost)rightmost=i;
    });
    nodes().forEach(function(node,i){
      node.classList.toggle('is-visible',!!st.revealed[i]);
      node.classList.toggle('is-active', i===st.active);
    });
    // Remplissage de la ligne : du 1er point au point le plus à droite révélé (base = centres des cartes).
    var w = (n<=1)?0 : (rightmost<0?0:(rightmost/(n-1))*100);
    if(progress) progress.style.width=w.toFixed(2)+'%';
  }

  async function revealSequence(indices){
    var my=token;
    // Cadence DYNAMIQUE : la séquence complète tient en ~1,3 s quel que soit le nombre de cartes,
    // tout en restant SÉQUENTIELLE (jamais simultanée) et en conservant l'animation d'impact par carte.
    var n=indices.length||1;
    var step=Math.max(70, Math.min(280, Math.round(1150/n)));   // séquence complète ≤ ~1,5 s même à 15+ cartes
    for(var k=0;k<indices.length;k++){
      if(my!==token)return;
      var i=indices[k];
      S[level].revealed[i]=true; S[level].active=i;
      applyState();
      await wait(step);
      if(my!==token)return;
    }
  }
  async function revealOne(i){ S[level].revealed[i]=true; S[level].active=i; applyState(); await wait(720); }
  function remaining(){var st=S[level],r=[];for(var i=0;i<career().length;i++)if(!st.revealed[i])r.push(i);return r;}
  // Carrousel du parcours : amène une carte dans la vue (défilement horizontal uniquement, jamais la page).
  function scrollViewportToCard(i){
    // Défile le carrousel pour centrer la colonne i (carte + date + point + ligne se déplacent ensemble).
    try{ var vp=cardsEl&&cardsEl.parentNode, st=stepsEl&&stepsEl.children[i]; if(!vp||!st)return;
      var vr=vp.getBoundingClientRect(), sr=st.getBoundingClientRect();
      vp.scrollLeft += (sr.left-vr.left)-(vp.clientWidth-sr.width)/2; }catch(e){}
  }
  // Élévation FINALE : après la fin des révélations, l'ancienne carte élevée redescend et la DERNIÈRE
  // carte chronologique s'élève puis reste élevée. Tout (halo, rayons, date, gros point de la frise,
  // barre de progression) suit l'index actif -> synchronisation automatique sur la dernière carte.
  async function elevateFinalCard(){
    var st=S[level], n=career().length; if(n<=0) return;
    var last=n-1;
    if(!st.revealed[last]){ st.revealed[last]=true; st.active=last; applyState(); await wait(720); } // date ouverte incluse
    scrollViewportToCard(last);                 // carrousel positionné sur la dernière carte avant l'élévation
    if(st.active!==last){ st.active=last; applyState(); await wait(80); } // ancienne carte redescend, dernière s'élève
  }

  function renderDots(){if(!dotsEl)return;var a=Math.min(S[level].attempts,MAXDOTS);[].slice.call(dotsEl.children).forEach(function(d,i){d.classList.toggle('is-used',i<a);});}

  function cluesUnlocked(){var st=S[level];return st.solved||st.answerRevealed||st.attempts>=LEVELS[level].cluesAt;}
  function onDemand(){return level!=='amateur';}                 // pro/expert : indices à la demande
  function bothCluesSeen(){var c=S[level].clue;return !!(c&&c.nat&&c.pos);}
  // EXPERT : paliers d'essais avant de pouvoir consulter un indice (nat dès le 3e essai, pos dès le 5e).
  function clueThreshold(kind){var lv=LEVELS[level],g=lv&&lv.clueAt;return (g&&g[kind])||0;}
  function clueAvailable(kind){var st=S[level];if(st.solved||st.answerRevealed)return true;return st.attempts>=clueThreshold(kind);}
  function paintClue(card,valEl,val,seen,kind){
    if(!card)return;
    if(seen){card.classList.remove('is-locked','is-gated');card.classList.add('is-revealed');valEl.textContent=val||'—';return;}
    card.classList.remove('is-revealed');
    if(kind&&!clueAvailable(kind)){                               // pas encore débloqué : palier d'essais non atteint
      card.classList.add('is-locked','is-gated');
      valEl.textContent='Dès '+clueThreshold(kind)+' essais';
    }else{
      card.classList.remove('is-gated');card.classList.add('is-locked');
      valEl.textContent='Voir l’indice';
    }
  }
  function renderClues(){
    var st=S[level];
    if(!onDemand()){                       // AMATEUR : comportement automatique inchangé
      var show=cluesUnlocked();
      cluesEl.hidden=!show;
      if(clueCardNat){clueCardNat.classList.remove('is-locked');clueCardPos.classList.remove('is-locked');}
      if(show){clueNat.textContent=player().nat||'—';cluePos.textContent=player().pos||'—';}
      return;
    }
    // PRO / EXPERT : les cartes servent de boutons de révélation
    var done=st.solved||st.answerRevealed;
    cluesEl.hidden=false;
    paintClue(clueCardNat,clueNat,player().nat,st.clue.nat||done,'nat');
    paintClue(clueCardPos,cluePos,player().pos,st.clue.pos||done,'pos');
  }
  function revealClue(kind){
    var st=S[level];
    if(!onDemand()||st.solved||st.answerRevealed)return;
    if(st.clue[kind])return;
    if(!clueAvailable(kind)){                                     // palier d'essais non atteint (EXPERT)
      var n=clueThreshold(kind);
      setMsg('Indice disponible à partir du '+n+(n===1?'er':'e')+' essai.','is-error');
      return;
    }
    st.clue[kind]=true;
    renderClues();renderHint();saveProgress();
  }

  function nameStart(){
    var raw=player().answer||player().name.split(/\s+/).pop();
    var letters=raw.replace(/[^A-Za-zÀ-ÿ]/g,'');
    if(!letters)return '';
    var k=letters.length<=2?1:2;
    return letters.slice(0,k).toUpperCase();
  }
  function hintUnlocked(){var st=S[level];if(st.solved||st.answerRevealed)return true;return onDemand()?bothCluesSeen():(st.attempts>=LEVELS[level].nameAt);}
  function renderHint(){
    var unlocked=hintUnlocked();
    hintTxt.textContent=(S[level].hintUsed&&unlocked)?('DÉBUT : '+nameStart()):'INDICE ULTIME';
    if(hintBtn)hintBtn.classList.toggle('is-locked',onDemand()&&!unlocked);
  }
  function onHint(){
    if(!hintUnlocked()){
      setMsg(onDemand()?'Consulte d’abord les indices 1 et 2.':('Début du nom disponible après '+LEVELS[level].nameAt+' erreurs.'),'is-error');return;}
    S[level].hintUsed=true;renderHint();saveProgress();setMsg('Le nom commence par « '+nameStart()+' »');
  }

  function scrollBottom(){try{window.scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'});}catch(e){window.scrollTo(0,document.documentElement.scrollHeight);}}
  // Sources de la photo, par ordre de priorité : embarquée (dataURI) puis en ligne (Commons).
  // Le chargement en ligne est un FILET : s'il échoue (hors-ligne / 404), on passe à la source
  // suivante puis on masque proprement. Rien ici ne peut bloquer l'animation ni le reste du jeu.
  function photoSources(name){
    var _pl=player(),src=[];
    try{
      if(PHOTOS && PHOTOS[name]) src.push(PHOTOS[name]);          // 1) photo embarquée (hors-ligne OK)
      if(_pl && PHOTOSURL && PHOTOSURL[_pl.id]) src.push(PHOTOSURL[_pl.id]); // 2) photo en ligne (Commons)
    }catch(e){}
    return src;
  }
  // Charge une photo dans <img> en essayant chaque source; appelle onready quand c'est réglé.
  // Fail-safe : source KO -> source suivante ; tout KO -> image masquée, jamais bloquant.
  function loadPhotoInto(imgEl,name,onready){
    if(!imgEl){if(onready)onready();return;}
    var src=photoSources(name),i=0;
    imgEl.onload=null;imgEl.onerror=null;imgEl.hidden=true;
    function tryNext(){
      if(i>=src.length){ imgEl.hidden=true; imgEl.removeAttribute('src'); if(onready)onready(); return; }
      var url=src[i++];
      imgEl.onload=function(){ imgEl.hidden=false; if(onready)onready(); };
      imgEl.onerror=function(){ tryNext(); };
      try{ imgEl.src=url; }catch(e){ tryNext(); }
    }
    tryNext();
  }
  // ================= Écran final EXPERT « Le joueur du jour » (scène 1672x941) =================
  // Mise à l'échelle proportionnelle : la scène garde ses proportions et rétrécit selon la largeur.
  function scaleStage(){
    if(!rdsStage||!rdsWrap) return;
    var avail=rdsWrap.clientWidth||rdsWrap.offsetWidth||0;
    if(!avail) return;
    // Remplit TOUTE la largeur disponible (échelle uniforme -> proportions gardées, aucune déformation).
    // Grandit au-delà de la taille native sur grand écran ; plafonné pour éviter des tailles absurdes.
    var scale=Math.min(2.4, avail/1672);
    rdsStage.style.transform='scale('+scale+')';
    rdsWrap.style.height=(941*scale)+'px';
  }
  // Parcours en club : carrousel horizontal (6 cartes visibles) dès qu'il y a plus de 6 clubs.
  var CARW=101+12, carIndex=0, carMax=0;
  function carApply(){
    rdsClubs.style.transform='translateX('+(-carIndex*CARW)+'px)';
    var pv=rdsClubsNav.querySelector('.rds-prev'), nx=rdsClubsNav.querySelector('.rds-next');
    if(pv) pv.disabled=(carIndex<=0);
    if(nx) nx.disabled=(carIndex>=carMax);
  }
  function carSlide(d){ carIndex=Math.max(0,Math.min(carMax,carIndex+d)); carApply(); }
  function buildRdsClubs(){
    var c=career();
    rdsClubs.innerHTML=c.map(function(it){
      var club=it[0],years=it[1],logo=LOGOS[club]||'',country=CLUBCOUNTRY[club]||'';
      var crest=logo?('<span class="rds-crest"><img src="'+logo+'" alt=""></span>')
                    :('<span class="rds-crest rds-fallback">'+initials(club)+'</span>');
      return '<article class="rds-club"><div class="rds-dates">'+esc(years)+'</div>'+crest
        +'<div class="rds-club-name">'+esc(club)+'</div><div class="rds-country">'+esc(country)+'</div></article>';
    }).join('');
    carIndex=0; carMax=Math.max(0,c.length-6);
    var old=rdsClubsNav.querySelectorAll('.rds-arrow'); [].forEach.call(old,function(a){a.parentNode.removeChild(a);});
    if(c.length>6){
      var pv=document.createElement('button'); pv.className='rds-arrow rds-prev'; pv.type='button'; pv.textContent='‹';
      var nx=document.createElement('button'); nx.className='rds-arrow rds-next'; nx.type='button'; nx.textContent='›';
      pv.addEventListener('click',function(){carSlide(-1);}); nx.addEventListener('click',function(){carSlide(1);});
      rdsClubsNav.appendChild(pv); rdsClubsNav.appendChild(nx);
    }
    carApply();
  }
  // Génère le contenu éditorial (intro + 3 points) UNIQUEMENT à partir des données réelles du joueur.
  function capFirst(s){s=String(s||'');return s?s.charAt(0).toUpperCase()+s.slice(1):s;}
  function yr2(s){ // -> [début, fin] à partir d'une chaîne type "2002–04" / "2024 – AUJ."
    s=String(s||''); var all=s.match(/\d{2,4}/g)||[]; var start=null,end=null;
    if(all.length){ start=parseInt(all[0],10); if(all[0].length===2) start=1900+start; }
    if(/auj|présent|present|aujourd/i.test(s)){ end=(new Date()).getFullYear(); }
    else if(all.length>1){ var e=all[all.length-1]; end=parseInt(e,10); if(e.length===2){ end=Math.floor(start/100)*100+end; if(end<start) end+=100; } }
    else { end=start; }
    return [start,end];
  }
  function genEditorial(pl){
    if(!pl) return;
    var cr=pl.career||[], seen={}, countries=[];
    cr.forEach(function(it){ var co=CLUBCOUNTRY[it[0]]; if(co&&!seen[co]){seen[co]=1;countries.push(co);} });
    var f=yr2(cr.length?cr[0][1]:''), l=yr2(cr.length?cr[cr.length-1][1]:'');
    var first=f[0], last=l[1], span=(first&&last&&last>=first)?(last-first):0, N=cr.length, k=countries.length;
    var pos=capFirst(pl.pos||'Joueur');
    var intro=pos+', il a évolué dans '+N+' club'+(N>1?'s':'')+(k?(' et '+k+' pays'):'')+((first&&last)?(', de '+first+' à '+last):'')+'.';
    if(pl.nat) intro+=' Sélection : '+pl.nat+'.';
    rdsIntro.textContent=intro;
    var pts=[];
    if(cr.length) pts.push('Formé à '+cr[0][0]+(first?(' ('+first+')'):'')+'.');
    if(k) pts.push('A évolué dans '+k+' pays : '+countries.join(', ')+'.');
    pts.push(N+' club'+(N>1?'s':'')+(span?(' sur '+span+' saisons de carrière'):'')+'.');
    while(pts.length<3) pts.push('');
    rdsPoints.innerHTML=pts.slice(0,3).map(function(t,i){
      return '<div class="rds-take"><b>'+('0'+(i+1)).slice(-2)+'</b><span>'+esc(t)+'</span></div>';
    }).join('');
  }
  // ===== Palmarès en direct depuis Wikidata (branchement en ligne, fail-safe) =====
  // Trophées : déclarés sur le joueur (P2522) ou gagnés par un club/sélection où il évoluait
  // (P1344 + P1346 + P54). Repli hérité, désormais inutilisé à l'affichage (palmarès = données embarquées).
  var PALMCACHE={};
  // Palmarès fusionné Wikidata+Wikipedia : window.TOMSOFOOT_PALMARES (chargé avant), indexé par QID.
  var PALMBAKED=DATA.palmares||{};
  (function(){
    try{
      var src=(typeof window!=='undefined')&&window.TOMSOFOOT_PALMARES;
      if(src){ var idx={}; var vals=Object.keys(src).map(function(k){return src[k];});
        vals.forEach(function(e){ var q=e&&(e.wikidataId||e.qid); if(q) idx[q]=e; });
        PALMBAKED=idx; }
    }catch(e){}
  })();
  async function fetchPalmares(qid){
    if(!qid) return [];
    if(PALMBAKED[qid]) return PALMBAKED[qid];       // 1) données embarquées -> instantané, hors-ligne OK
    if(PALMCACHE[qid]) return PALMCACHE[qid];
    var query='SELECT DISTINCT ?competition ?competitionLabel ?type ?date WHERE {'
      +'VALUES ?player { wd:'+qid+' }'
      +'{ ?player wdt:P2522 ?competition. BIND("competition_won" AS ?type) }'
      +'UNION { ?player wdt:P1344 ?competition. ?competition wdt:P1346 ?winningTeam. ?player wdt:P54 ?winningTeam. BIND("team_victory" AS ?type) }'
      +'OPTIONAL { ?competition wdt:P585 ?date. }'
      +'SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". } } ORDER BY ?date';
    var url='https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(query);
    var ctrl=('AbortController' in window)?new AbortController():null;
    var to=ctrl?setTimeout(function(){try{ctrl.abort();}catch(e){}},8000):null;
    try{
      var r=await fetch(url,{headers:{Accept:'application/sparql-results+json'},signal:ctrl?ctrl.signal:undefined});
      if(to){clearTimeout(to);to=null;}
      if(!r.ok) throw new Error('HTTP '+r.status);
      var d=await r.json();
      var out=(d&&d.results&&d.results.bindings?d.results.bindings:[]).map(function(b){
        var yr=(b.date&&b.date.value)?(new Date(b.date.value)).getUTCFullYear():null;
        return {nom:(b.competitionLabel&&b.competitionLabel.value)||'', annee:(yr&&!isNaN(yr))?yr:null};
      });
      PALMCACHE[qid]=out;
      return out;
    }catch(e){ if(to)clearTimeout(to); return []; }
  }
  function statTile(v,l){return '<div class="rds-stat"><strong>'+v+'</strong><small>'+l+'</small></div>';}
  // Palmarès affiché depuis les données EMBARQUÉES uniquement (aucun appel Wikidata à l'affichage).
  // N'affiche que les titres « wikidata_confirmed » ; distinctions individuelles à part ; sinon « Palmarès à compléter ».
  function plural(n,s,p){return n>1?p:s;}
  // Configure le carrousel : flèches visibles/activées uniquement s'il y a débordement.
  function setupPalmCarousel(){
    if(!rdsPalmExtra) return;
    var vp=rdsPalmExtra.querySelector('.palm-viewport'),
        prev=rdsPalmExtra.querySelector('.palm-prev'),
        next=rdsPalmExtra.querySelector('.palm-next');
    if(!vp||!prev||!next) return;
    function update(){
      var overflow=(vp.scrollWidth-vp.clientWidth)>2;
      prev.classList.toggle('is-hidden',!overflow);
      next.classList.toggle('is-hidden',!overflow);
      if(overflow){ prev.disabled=vp.scrollLeft<=1; next.disabled=vp.scrollLeft>=(vp.scrollWidth-vp.clientWidth-1); }
    }
    prev.addEventListener('click',function(){ vp.scrollBy({left:-Math.round(vp.clientWidth*0.8),behavior:'smooth'}); });
    next.addEventListener('click',function(){ vp.scrollBy({left: Math.round(vp.clientWidth*0.8),behavior:'smooth'}); });
    vp.addEventListener('scroll',update);
    requestAnimationFrame(update); setTimeout(update,80);
  }
  // Nettoie le libellé (retire l'article de tête) et fabrique une clé de regroupement stable.
  function cleanTitle(n){ return String(n||'').replace(/^\s*(les|la|le|l['’]|the)\s+/i,'').trim(); }
  function titleKey(n){ return cleanTitle(n).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
  // Lignes parasites issues du scraping (résultats de matchs, qualifs, résidus HTML) -> jamais un trophée.
  function isJunkHonour(h){
    var n=(h&&h.name)||'';
    if(!n) return true;
    if(/rowspan|<\/?[a-z][^>]*>|\|/i.test(n)) return true;          // résidus HTML de tableau
    if(/^\s*\d+\s*[—–-]\s/.test(n)) return true;                    // "1 — 8 octobre — ..."
    if(/\b\d{1,2}\s*[-–]\s*\d{1,2}\b/.test(n)) return true;         // score de match "1-0" / "2 - 1"
    if(/match amical|[ée]liminatoires|qualifications?\b/i.test(n)) return true;
    return false;
  }
  // Distinctions individuelles (même quand le drapeau isIndividual manque dans la source).
  function isIndividualHonour(h){
    if(!h) return false;
    if(h.isIndividual) return true;
    var n=(h.name||'');
    return /team of the (year|tournament|season)|best xi|best player|best footballer|player of the (year|month|tournament|season)|man of the match|top ?(goal ?scorer|scorer|assist)|meilleur buteur|meilleur passeur|golden (boot|ball)|silver ball|bronze ball|ballon d[’'` ]?or|joueur du mois|player of the month|troph[ée]e unfp|\bunfp\b|[ée]lu joueur|best footballer in asia|iffhs/i.test(n);
  }
  // On ne compte JAMAIS les finalistes / vice-champions / places / candidats / lignes parasites / distinctions.
  function isRealTitle(h){
    if(!h||h.isIndividual) return false;
    if(isJunkHonour(h)) return false;
    if(isIndividualHonour(h)) return false;
    var v=(h.v||h.verificationStatus||'').toLowerCase();
    if(/candidate|verifier|à vérifier/.test(v)) return false;
    var n=(h.name||'').toLowerCase();
    if(/finalist|finaliste|demi-finaliste|vice-?champion|runner-?up|deuxi[eè]me|troisi[eè]me|m[eé]daille d['’]argent|m[eé]daille de bronze|\b2e\b|\b3e\b|second place|third place/.test(n)) return false;
    return true;
  }
  // Palmarès (window.TOMSOFOOT_PALMARES). Regroupe les titres identiques avec badge ×N (toutes les
  // saisons conservées), distinctions à part, carrousel horizontal + flèches si débordement.
  function renderPalmares(pl){
    if(!rdsStats) return;
    if(rdsPalmExtra) rdsPalmExtra.innerHTML='';
    var d=(pl&&pl.id&&PALMBAKED[pl.id])?PALMBAKED[pl.id]:null;
    // ---- Titres collectifs : regroupés par nom, saisons dédoublonnées ----
    var groups={}, order=[];
    if(d) (d.honours||[]).forEach(function(h){
      if(!isRealTitle(h)) return;
      var k=titleKey(h.name); if(!k) return;
      var season=(h.season!=null&&h.season!=='')?String(h.season):(h.year!=null?String(h.year):'');
      if(!groups[k]){ groups[k]={label:cleanTitle(h.name),seasons:{},order:[]}; order.push(k); }
      var g=groups[k];
      if(season && !g.seasons[season]){ g.seasons[season]=1; g.order.push(season); }
      else if(!season && !g.seasons['?']){ g.seasons['?']=1; }
    });
    // ---- Distinctions individuelles (catégorie séparée) ----
    var awards=[];
    if(d){
      (d.individualAwards||[]).forEach(function(a){ if(!isJunkHonour(a)) awards.push({name:a.name,season:a.season||(a.year!=null?String(a.year):'')}); });
      (d.honours||[]).forEach(function(h){ if(h&&!isJunkHonour(h)&&isIndividualHonour(h)){ awards.push({name:h.name,season:h.season||(h.year!=null?String(h.year):'')}); } });
    }
    var titleGroups=order.map(function(k){var g=groups[k];
      var yrs=g.order.filter(function(x){return x!=='?';}).sort();
      return {label:g.label, count:Object.keys(g.seasons).length, years:yrs};
    });
    var totalTitles=titleGroups.reduce(function(a,g){return a+g.count;},0);
    if(!titleGroups.length && !awards.length){
      rdsStats.innerHTML='<div class="rds-stat rds-verify">Palmarès non renseigné</div>'; return;
    }
    rdsStats.innerHTML='';
    // tri : plus de titres d'abord, puis saison la plus récente
    titleGroups.sort(function(a,b){ if(b.count!==a.count) return b.count-a.count; return (b.years[b.years.length-1]||'').localeCompare(a.years[a.years.length-1]||''); });
    function card(label,years,count,award){
      var pills=years.filter(Boolean).map(function(y){return '<span class="palm-pill">'+esc(y)+'</span>';}).join('');
      var badge=(count>1)?('<span class="palm-x">×'+count+'</span>'):'';
      var full=label+(count>1?(' ×'+count):'')+(years.length?(' — '+years.join(' · ')):'');
      return '<div class="palm-card'+(award?' palm-card--award':'')+'" title="'+esc(full)+'">'
        +(award?'<span class="palm-star">★</span>':'')
        +'<div class="palm-card-top">'+(award?'':'<span class="palm-ico">🏆</span>')+'<span class="palm-card-name">'+esc(label)+'</span>'+badge+'</div>'
        +(pills?('<div class="palm-seasons">'+pills+'</div>'):'')+'</div>';
    }
    var cards=titleGroups.map(function(g){return card(g.label,g.years,g.count,false);}).join('');
    // distinctions regroupées aussi (×N)
    var ag={}, aorder=[];
    awards.forEach(function(a){var k=titleKey(a.name); if(!k)return; if(!ag[k]){ag[k]={label:cleanTitle(a.name),seasons:{},order:[]};aorder.push(k);} var s=a.season?String(a.season):''; if(s&&!ag[k].seasons[s]){ag[k].seasons[s]=1;ag[k].order.push(s);} else if(!s&&!ag[k].seasons['?']){ag[k].seasons['?']=1;}});
    cards+=aorder.map(function(k){var g=ag[k];var yrs=g.order.filter(function(x){return x!=='?';}).sort();return card(g.label,yrs,Object.keys(g.seasons).length,true);}).join('');
    var capParts=[];
    if(totalTitles) capParts.push(totalTitles+' '+plural(totalTitles,'titre','titres'));
    if(aorder.length) capParts.push(aorder.length+' '+plural(aorder.length,'distinction','distinctions'));
    rdsPalmExtra.innerHTML=(capParts.length?('<div class="palm-summary">'+esc(capParts.join(' · '))+'</div>'):'')
      +'<div class="palm-carousel"><button type="button" class="palm-arrow palm-prev" aria-label="Précédent">‹</button>'
      +'<div class="palm-viewport"><div class="palm-track">'+cards+'</div></div>'
      +'<button type="button" class="palm-arrow palm-next" aria-label="Suivant">›</button></div>';
    setupPalmCarousel();
  }

  // ===== Composition « joueur détouré + panneaux flottants ». N'affecte QUE la zone portrait. =====
  // Détourage réel (PNG/WebP transparent) requis ; sinon repli portrait photographique classique.
  function fillPortraitPanels(pl){
    var cr=(pl&&pl.career)||[];
    // Panneau gauche : PARCOURS — 5 clubs les plus récents (du plus récent au plus ancien)
    var rows=cr.filter(function(e){return e&&e[0];}).slice(-5).reverse();
    rdsFeedL.innerHTML=rows.map(function(it){
      var club=it[0],years=it[1],logo=LOGOS[club]||'',country=CLUBCOUNTRY[club]||'';
      var crest=logo?('<img src="'+logo+'" alt="">'):('<span></span>');
      return '<div class="career-glass__row"><time>'+esc(years)+'</time>'+crest
        +'<div><strong>'+esc(club)+'</strong><small>'+esc(country)+'</small></div></div>';
    }).join('');
    // Panneau droit : REPÈRES — uniquement des infos réellement disponibles (aucune stat inventée)
    if(rdsPanelRTitle) rdsPanelRTitle.textContent='REPÈRES';
    var seen={},countries=[];
    cr.forEach(function(it){ var co=CLUBCOUNTRY[it[0]]; if(co&&!seen[co]){seen[co]=1;countries.push(co);} });
    var f=yr2(cr.length?cr[0][1]:''), l=yr2(cr.length?cr[cr.length-1][1]:'');
    var span=(f[0]&&l[1]&&l[1]>=f[0])?(l[1]-f[0]):0;
    var facts=[];
    if(pl&&pl.nat) facts.push(['Nationalité',pl.nat]);
    if(pl&&pl.pos) facts.push(['Poste',capFirst(pl.pos)]);
    facts.push(['Clubs',String(cr.length)]);
    if(countries.length) facts.push(['Pays',String(countries.length)]);
    if(span) facts.push(['Saisons',String(span)]);
    rdsFeedR.innerHTML=facts.map(function(ff){
      return '<div class="career-glass__stat"><span>'+esc(ff[0])+'</span><strong>'+esc(ff[1])+'</strong></div>';
    }).join('');
  }
  // Sélection de l'image détourée (jamais la photo JPG) : échantillon embarqué, sinon fichier en ligne <id>.webp
  var CUTOUTBASE=DATA.cutoutBase||'';
  function getPlayerCutout(pl){
    if(!pl||!pl.id) return null;
    if(CUTOUT[pl.id]) return CUTOUT[pl.id];
    if(CUTOUTBASE) return CUTOUTBASE+pl.id+'.webp';
    return null;
  }
  // Affiche d'abord le portrait classique « IMAGE WIKIDATA » (immédiat), puis bascule sur la
  // composition « verre » dès qu'un détourage transparent du joueur est chargé (sinon reste en portrait).
  function buildEditorialPortrait(pl,name,onready){
    fillPortraitPanels(pl);
    rdsStageVisual.classList.remove('has-player-cutout','cutout-loaded');
    loadPhotoInto(rdsPortrait,name,onready);          // portrait photographique classique, tout de suite
    var cut=getPlayerCutout(pl); if(!cut) return;
    var my=token, probe=new Image();
    probe.onload=function(){
      if(my!==token) return;
      rdsCutoutImg.src=cut;
      rdsStageVisual.classList.add('has-player-cutout');
      requestAnimationFrame(function(){ rdsStageVisual.classList.add('cutout-loaded'); });
    };
    probe.onerror=function(){};
    probe.src=cut;
  }
  // Défile UNE seule fois, une fois la photo prête -> un seul mouvement fluide jusqu'en bas
  // ===================== NOUVEL ÉCRAN RÉSULTAT EXPERT « EA-straight » (commun à TOUS les Experts) =====================
  // Composant unique alimenté par les VRAIES données du joueur : aucune condition sur un nom, aucun HTML dupliqué.
  function escEA(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
  function photoSourcesFor(pl){var src=[];try{if(pl&&PHOTOS&&PHOTOS[pl.name])src.push(PHOTOS[pl.name]);if(pl&&PHOTOSURL&&PHOTOSURL[pl.id])src.push(PHOTOSURL[pl.id]);}catch(e){}return src;}
  function loadEaPortrait(pl){
    var img=$('portrait-image'), glow=$('portrait-glow'), src=photoSourcesFor(pl), i=0;
    if(eaExpert)eaExpert.classList.remove('ea-no-photo');
    if(img)img.alt='Portrait de '+((pl&&pl.name)||'ce joueur');
    function fail(){ if(eaExpert)eaExpert.classList.add('ea-no-photo'); if(img)img.removeAttribute('src'); if(glow)glow.removeAttribute('src'); }
    (function tryNext(){
      if(i>=src.length){ fail(); return; }
      var u=src[i++], probe=new Image();
      probe.onload=function(){ if(img)img.src=u; if(glow)glow.src=u; if(eaExpert)eaExpert.classList.remove('ea-no-photo'); };
      probe.onerror=function(){ tryNext(); };
      probe.src=u;
    })();
  }
  function eaEditorial(pl){
    var cr=(pl&&pl.career)||[], seen={}, countries=[];
    cr.forEach(function(it){var co=CLUBCOUNTRY[it[0]];if(co&&!seen[co]){seen[co]=1;countries.push(co);}});
    var f=yr2(cr.length?cr[0][1]:''), l=yr2(cr.length?cr[cr.length-1][1]:'');
    var first=f[0], last=l[1], span=(first&&last&&last>=first)?(last-first):0, N=cr.length, k=countries.length;
    var pos=capFirst((pl&&pl.pos)||'Joueur');
    var summary=pos+', il a évolué dans '+N+' club'+(N>1?'s':'')+(k?(' et '+k+' pays'):'')+((first&&last)?(', de '+first+' à '+last):'')+'.';
    if(pl&&pl.nat) summary+=' Sélection : '+pl.nat+'.';
    var facts=[];
    if(cr.length) facts.push('Formé à '+cr[0][0]+(first?(' ('+first+')'):'')+'.');
    if(k) facts.push('A évolué dans '+k+' pays : '+countries.join(', ')+'.');
    facts.push(N+' club'+(N>1?'s':'')+(span?(' sur '+span+' saisons de carrière'):'')+'.');
    while(facts.length<3) facts.push('');
    return {summary:summary, facts:facts.slice(0,3)};
  }
  // Palmarès : mêmes règles que renderPalmares (titres collectifs regroupés ×N, saisons conservées).
  function eaPalmares(pl){
    var d=(pl&&pl.id&&PALMBAKED[pl.id])?PALMBAKED[pl.id]:null, groups={}, order=[];
    if(d)(d.honours||[]).forEach(function(h){
      if(!isRealTitle(h))return;
      var k=titleKey(h.name); if(!k)return;
      var season=(h.season!=null&&h.season!=='')?String(h.season):(h.year!=null?String(h.year):'');
      if(!groups[k]){groups[k]={label:cleanTitle(h.name),seasons:{},order:[]};order.push(k);}
      var g=groups[k];
      if(season&&!g.seasons[season]){g.seasons[season]=1;g.order.push(season);}
      else if(!season&&!g.seasons['?']){g.seasons['?']=1;}
    });
    var tg=order.map(function(k){var g=groups[k];var yrs=g.order.filter(function(x){return x!=='?';}).sort();return {name:g.label,count:Object.keys(g.seasons).length,years:yrs};});
    tg.sort(function(a,b){if(b.count!==a.count)return b.count-a.count;return (b.years[b.years.length-1]||'').localeCompare(a.years[a.years.length-1]||'');});
    return {groups:tg, total:tg.reduce(function(a,g){return a+g.count;},0)};
  }
  function updateEaCarousels(){
    var map={clubs:$('club-viewport'),honours:$('honour-viewport')};
    [].forEach.call((eaExpert||document).querySelectorAll('[data-scroll]'),function(btn){
      var vp=map[btn.getAttribute('data-scroll')];
      btn.hidden=!(vp&&vp.scrollWidth>vp.clientWidth+2);
    });
  }
  // Composant UNIQUE : reçoit le joueur Expert courant et génère tout l'écran depuis ses données.
  function renderExpertResult(pl){
    if(!pl) throw new Error('renderExpertResult: joueur manquant');
    loadEaPortrait(pl);
    var ed=eaEditorial(pl);
    var nm=$('player-name'); if(nm)nm.textContent=pl.name||'';
    var sm=$('player-summary'); if(sm)sm.textContent=ed.summary||'';
    var fe=$('facts'); if(fe)fe.innerHTML=[0,1,2].map(function(i){
      return '<article class="fact-row"><div class="fact-index">'+('0'+(i+1)).slice(-2)+'</div><div class="fact-copy">'+escEA(ed.facts[i]||'Information en cours de vérification.')+'</div></article>';
    }).join('');
    var ct=$('club-track'); if(ct)ct.innerHTML=(pl.career||[]).map(function(it){
      var club=it[0], years=it[1], logo=LOGOS[club]||'', country=CLUBCOUNTRY[club]||'';
      var media=logo?('<img class="club-logo" src="'+escEA(logo)+'" alt="Logo '+escEA(club)+'">'):('<div class="club-fallback">'+escEA(initials(club))+'</div>');
      return '<article class="club-card cut-panel"><div class="club-period">'+escEA(years)+'</div><div class="club-logo-wrap">'+media+'</div><div class="club-name">'+escEA(club)+'</div><div class="club-country">'+escEA(country)+'</div></article>';
    }).join('');
    var pm=eaPalmares(pl);
    var hc=$('honours-count'); if(hc)hc.textContent=pm.total>0?(pm.total+' titre'+(pm.total>1?'s':'')):'';
    var ht=$('honour-track'); if(ht)ht.innerHTML=pm.groups.length?pm.groups.map(function(g){
      return '<article class="honour-card cut-panel"><div class="trophy-line"><div class="trophy-icon" aria-hidden="true"></div><div class="honour-name">'+escEA(g.name)+(g.count>1?(' <span class="honour-multiplier">×'+g.count+'</span>'):'')+'</div></div><div></div><div class="years">'+(g.years||[]).map(function(y){return '<span class="year-pill">'+escEA(y)+'</span>';}).join('')+'</div></article>';
    }).join(''):'<article class="honour-card cut-panel"><div class="honour-name">Palmarès en cours de vérification</div></article>';
    // Carrousels remis au PREMIER élément à chaque nouveau joueur (le 1er club doit être visible).
    var cv=$('club-viewport'), hv=$('honour-viewport');
    if(cv)cv.scrollLeft=0; if(hv)hv.scrollLeft=0;
    requestAnimationFrame(function(){
      if(cv)cv.classList.toggle('ea-scroll', cv.scrollWidth>cv.clientWidth+2);  // débordement -> aligné à gauche (1er club visible)
      if(cv)cv.scrollLeft=0; if(hv)hv.scrollLeft=0;
      updateEaCarousels();
    });
  }
  (function(){
    [].forEach.call((eaExpert||document).querySelectorAll('[data-scroll]'),function(btn){
      btn.addEventListener('click',function(){
        var vp=$(btn.getAttribute('data-scroll')==='clubs'?'club-viewport':'honour-viewport');
        var dir=Number(btn.getAttribute('data-direction'))||1;
        if(vp)vp.scrollBy({left:dir*Math.max(260,vp.clientWidth*0.72),behavior:'smooth'});
      });
    });
    window.addEventListener('resize',updateEaCarousels);
  })();

  function showResult(kicker,name,scroll){
    var did=false; function go(){if(did)return;did=true;setTimeout(function(){try{resultEl.scrollIntoView({behavior:'smooth',block:'start'});}catch(e){scrollBottom();}},50);}
    var gc=document.querySelector('.game-controls');
    if(level==='expert'){
      // ===== Écran « Le joueur du jour » — Expert : nouveau design EA (commun à tous), ancien écran en secours =====
      if(simpleResult)simpleResult.hidden=true;
      if(gc)gc.style.display='none';             // masque les indices (Nationalité/Poste) sur l'écran de résultat Expert
      resultEl.classList.add('is-expert');
      var okEA=false;
      try{ renderExpertResult(player()); if(eaExpert)eaExpert.hidden=false; if(jdjPanel)jdjPanel.hidden=true; okEA=true; }catch(e){ okEA=false; }
      if(!okEA){                                   // repli automatique : ancien écran éditorial « Le joueur du jour »
        if(eaExpert)eaExpert.hidden=true; if(jdjPanel)jdjPanel.hidden=false;
        if(rdsTitle)rdsTitle.textContent=name;
        buildRdsClubs(); genEditorial(player()); renderPalmares(player());
        buildEditorialPortrait(player(),name,function(){ requestAnimationFrame(scaleStage); });
        requestAnimationFrame(scaleStage);
      }
      if(scroll)setTimeout(go,900);
    } else {
      // ===== Carte simple (Amateur / Pro) — inchangée =====
      if(jdjPanel)jdjPanel.hidden=true;
      if(eaExpert)eaExpert.hidden=true;
      if(simpleResult)simpleResult.hidden=false;
      if(gc)gc.style.display='';
      resultEl.classList.remove('is-expert');
      resultKicker.textContent=kicker;resultName.textContent=name;
      updateNextCta();
      loadPhotoInto(resultPhoto,name,function(){ if(scroll)go(); });
      if(scroll)setTimeout(go,1200);
    }
    resultEl.classList.add('show');}
  function hideResult(){resultEl.classList.remove('show');if(resultPhoto){resultPhoto.hidden=true;}if(jdjPanel){jdjPanel.hidden=true;}if(eaExpert){eaExpert.hidden=true;}if(simpleResult){simpleResult.hidden=false;}var _nc=$('nextLevelCta');if(_nc)_nc.hidden=true;var _gc=document.querySelector('.game-controls');if(_gc)_gc.style.display='';}
  // Bouton « Niveau suivant » (Amateur/Pro) : visible une fois le joueur trouvé OU la réponse révélée
  function updateNextCta(){
    var cta=$('nextLevelCta'); if(!cta)return;
    var i=ORDER.indexOf(level), nx=ORDER[i+1], st=S[level], done=!!(st&&(st.solved||st.answerRevealed));
    if(nx && done && level!=='expert' && !replay){
      var tl=(LEVELS[nx]?LEVELS[nx].label:nx).replace(/^NIVEAU\s+/i,'');
      var tgt=$('nextLevelTarget'); if(tgt)tgt.textContent='Niveau '+capFirst(tl.toLowerCase());
      cta.hidden=false;
    } else { cta.hidden=true; }
  }

  function renderValidate(){
    var st=S[level];
    if(finished){validate.textContent='TERMINÉ';validate.disabled=true;input.disabled=true;return;}
    if(st.solved){validate.textContent=level==='expert'?'TERMINER':'SUIVANT';validate.disabled=false;input.disabled=true;return;}
    if(st.answerRevealed){validate.textContent=level==='expert'?'TERMINER':'NIVEAU SUIVANT';validate.disabled=false;input.disabled=true;return;}
    validate.textContent='VALIDER';validate.disabled=false;input.disabled=false;
  }
  function renderLevel(){
    root.dataset.level=level;levelLabel.textContent=LEVELS[level].label;
    [].slice.call(selector.children).forEach(function(b){b.classList.toggle('is-active',b.dataset.level===level);});
    renderLevelLocks();
    renderDots();renderHint();renderClues();renderValidate();
  }

  async function loadLevel(){
    token++; var my=token;
    if(!S[level]) S[level]=newState(level);
    renderCards(); renderLevel(); hideResult(); renderUsedPlayers();
    var st=S[level];
    if(st.solved||st.answerRevealed){
      for(var i=0;i<career().length;i++) st.revealed[i]=true;
      st.active=career().length-1; applyState(); scrollViewportToCard(st.active);   // partie restaurée : dernière carte élevée, sans rejouer les animations
      showResult(st.solved?'Bravo ! Tu as trouvé, c’était…':'La réponse était…', player().name);
      renderValidate(); return;
    }
    var already=false; for(var k in st.revealed){already=true;break;}
    applyState();
    if(!already){ await wait(60); await revealSequence(st.order); }   // départ quasi immédiat
    renderClues();
    if(my===token && !st.solved && !st.answerRevealed) requestAnimationFrame(function(){input.focus();});
  }
  // ===== Progression verrouillée : Pro après Amateur, Expert après Pro =====
  function levelDone(l){var st=S[l];return !!(st&&(st.solved||st.answerRevealed));}
  function levelUnlocked(l){var i=ORDER.indexOf(l);if(i<=0)return true;return levelDone(ORDER[i-1]);}
  function renderLevelLocks(){
    if(!selector)return;
    [].slice.call(selector.children).forEach(function(b){
      var l=b.dataset.level, locked=!levelUnlocked(l);
      b.classList.toggle('is-locked',locked);
      b.setAttribute('aria-disabled',locked?'true':'false');
    });
  }
  function setLevel(l){
    if(!LEVELS[l])return;
    if(!levelUnlocked(l)){                            // niveau verrouillé : on refuse et on explique
      var prev=ORDER[ORDER.indexOf(l)-1];
      var pl=(LEVELS[prev]?LEVELS[prev].label:prev).replace(/^NIVEAU\s+/i,'');
      setMsg('Termine d’abord le niveau '+pl+'.','is-error');
      renderLevelLocks();
      return;
    }
    level=l;input.value='';setMsg('');hideSug();loadLevel();
  }
  function nextLevel(){if(replay){exitReplay();return;}var i=ORDER.indexOf(level),nx=ORDER[i+1];if(!nx){finished=true;setMsg('Bravo, tu as terminé les trois niveaux.','is-success');renderValidate();return;}setLevel(nx);}

  async function onCorrect(v){
    var st=S[level]; st.solved=true; setMsg('');
    (st.guesses=st.guesses||[]).push({v:v||'',ok:true}); saveProgress();
    playWin();
    await revealSequence(remaining());
    await elevateFinalCard();                    // dernière carte chronologique élevée définitivement
    renderClues();
    showResult('Bravo ! Tu as trouvé, c’était…', player().name, true);
    renderValidate(); renderLevelLocks();            // déverrouille le niveau suivant
    maybeUnlockDailyCard();                           // obtention de la carte si le défi est complet
  }
  function markUsed(v){var cv=compact(v);for(var i=0;i<POOL.length;i++){var e=POOL[i];if(compact(e.full)===cv||compact(e.nom)===cv){S[level].used[compact(e.full)]=true;return;}}}
  // Nom canonique « Prénom Nom » d'une proposition (pour l'historique des joueurs déjà utilisés).
  function resolveGuessName(v){
    var cv=compact(v);
    for(var i=0;i<POOL.length;i++){var e=POOL[i];if(compact(e.full)===cv||compact(e.nom)===cv)return e.full;}
    return String(v||'').trim();
  }
  // Liste (dédupliquée, dans l'ordre) des joueurs déjà proposés à tort sur le niveau courant.
  function usedNamesFor(l){
    var st=S[l]; if(!st||!st.guesses)return [];
    var seen={}, out=[];
    st.guesses.forEach(function(g){
      if(!g||g.ok!==false)return;
      var nm=(g.name&&String(g.name).trim())||resolveGuessName(g.v);
      var key=compact(nm); if(!nm||seen[key])return; seen[key]=1; out.push(nm);
    });
    return out;
  }
  function renderUsedPlayers(){
    var wrap=$('usedPlayers'), list=$('usedPlayersList'), cnt=$('usedPlayersCount');
    if(!wrap||!list)return;
    var names=usedNamesFor(level);
    if(!names.length){ wrap.hidden=true; list.innerHTML=''; if(cnt)cnt.textContent=''; return; }
    wrap.hidden=false;
    if(cnt)cnt.textContent=names.length+' joueur'+(names.length>1?'s':'');
    list.innerHTML=names.map(function(n){return '<span class="up-chip">'+esc(n)+'</span>';}).join('');
  }
  async function onWrong(v){
    var st=S[level]; st.attempts++; markUsed(v);
    (st.guesses=st.guesses||[]).push({v:v,ok:false,name:resolveGuessName(v)});
    renderUsedPlayers();
    playErr();
    setMsg('Ce n’est pas le bon joueur.','is-error');
    renderDots(); renderClues();
    if(st.queue.length){
      var i=st.queue.shift(); await revealOne(i);
      // Pro/Expert : à partir de 6 clubs, la 1re erreur ouvre 2 cases, puis une par une
      if(level!=='amateur' && career().length>=6 && st.attempts===1 && st.queue.length){
        var i2=st.queue.shift(); await revealOne(i2);
      }
    }
    renderHint(); saveProgress();
    try{ if(typeof checkEtoilesReward==='function') checkEtoilesReward(); }catch(e){}   // participation (LDC) : contrôle assiduité
    input.value=''; input.focus();
  }
  async function submit(e){
    e.preventDefault(); hideSug();
    if(validate){ validate.classList.remove('is-pressed'); void validate.offsetWidth; validate.classList.add('is-pressed');
      setTimeout(function(){ if(validate)validate.classList.remove('is-pressed'); },500); }
    if(finished)return;
    var st=S[level];
    if(st.solved||st.answerRevealed){ nextLevel(); return; }
    var v=input.value.trim();
    if(!v){ setMsg('Entre le nom d’un joueur.','is-error'); input.focus(); return; }
    if(busy)return; busy=true;
    // La sélection conserve le QID : si le joueur exact du jour a été choisi, c'est bon (jamais uniquement le nom).
    var byId=(selectedQid&&player()&&selectedQid===player().id);
    if(byId||isCorrect(v)) await onCorrect(v); else await onWrong(v);
    busy=false;
  }
  async function onReveal(){
    var st=S[level]; if(st.solved||st.answerRevealed)return;
    st.answerRevealed=true; setMsg(''); saveProgress();
    playReveal();
    await revealSequence(remaining());
    await elevateFinalCard();                    // cohérent avec la partie restaurée : dernière carte élevée
    renderClues();
    showResult('La réponse était…', player().name, true);
    renderValidate(); renderLevelLocks();            // déverrouille le niveau suivant
    maybeUnlockDailyCard();                           // obtention de la carte si le défi est complet
  }

  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  // =====================================================================
  //  RECHERCHE INTELLIGENTE DE JOUEURS
  //  Index normalisé pré-calculé au chargement ; classement par pertinence ;
  //  tolérance aux fautes ; alias ; max 6 résultats ; conserve le QID.
  // =====================================================================
  // Normalisation : minuscules, sans accents, apostrophes/traits d'union -> espace,
  // espaces multiples réduits. « Raúl » et « Raul » -> « raul » ; « Saint-Maximin » -> « saint maximin ».
  function normKey(s){return norm(s).replace(/[’'`´]/g,' ').replace(/-/g,' ').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
  // Distance d'édition bornée (Levenshtein) : renvoie >max dès qu'on dépasse le seuil.
  function lev(a,b,max){
    var la=a.length,lb=b.length; if(Math.abs(la-lb)>max)return max+1;
    var prev=[],cur=[],i,j; for(j=0;j<=lb;j++)prev[j]=j;
    for(i=1;i<=la;i++){cur[0]=i;var best=cur[0];
      for(j=1;j<=lb;j++){var cost=a.charCodeAt(i-1)===b.charCodeAt(j-1)?0:1;cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+cost);if(cur[j]<best)best=cur[j];}
      if(best>max)return max+1; var t=prev;prev=cur;cur=t;}
    return prev[lb];
  }
  // Index pré-calculé UNE fois (aucune reconstruction à chaque touche).
  var IDX=POOL.map(function(e){
    var nFull=normKey(e.full),nCompact=nFull.replace(/ /g,''),words=nFull.split(' ').filter(Boolean);
    var nSurname=normKey(e.nom||''),surC=nSurname.replace(/ /g,'');
    var aliasN=(e.aliases||[]).map(function(a){var f=normKey(a);return {f:f,c:f.replace(/ /g,'')};});
    return {full:e.full,nom:e.nom,prenom:e.prenom,id:e.id,nFull:nFull,nCompact:nCompact,words:words,nSurname:nSurname,surC:surC,firstC:(words[0]||''),aliasN:aliasN};
  });
  var BYID={}; IDX.forEach(function(e){if(e.id&&!BYID[e.id])BYID[e.id]=e;});
  function indexById(id){return BYID[id]||null;}
  // Regroupement par longueur (nom de famille / prénom) — restreint la recherche floue à un petit
  // sous-ensemble de candidats (jamais les 1 380 joueurs) sans rien recalculer à la frappe.
  var LENSUR={}, LENFIRST={};
  IDX.forEach(function(e){(LENSUR[e.surC.length]=LENSUR[e.surC.length]||[]).push(e);(LENFIRST[e.firstC.length]=LENFIRST[e.firstC.length]||[]).push(e);});
  function aliasHit(e,q,qc,mode){var A=e.aliasN;for(var i=0;i<A.length;i++){var a=A[i];if(mode===0){if(a.f===q||a.c===qc)return true;}else{if(a.f.indexOf(q)===0||a.c.indexOf(qc)===0)return true;}}return false;}
  function cmpRes(a,b){if(a.tier!==b.tier)return a.tier-b.tier;if(a.sec!==b.sec)return a.sec-b.sec;if(a.e.full.length!==b.e.full.length)return a.e.full.length-b.e.full.length;return a.e.nFull<b.e.nFull?-1:(a.e.nFull>b.e.nFull?1:0);}
  // Classement : 0=exact (nom/alias) · 1=commence par · 2=nom de famille · 3=mot contenu · 4=faute de frappe.
  // Optimisé : petits paniers par niveau (jamais de tri sur des milliers de correspondances) ; le
  // niveau 3 n'est calculé que si les niveaux 0-2 ne remplissent pas déjà la liste ; la recherche
  // floue (coûteuse) est restreinte aux candidats de longueur voisine, pas aux 1 380 joueurs.
  var CAP=200;
  function byLen(a,b){return a.sec-b.sec||a.e.full.length-b.e.full.length||(a.e.nFull<b.e.nFull?-1:(a.e.nFull>b.e.nFull?1:0));}
  function searchPlayers(q,limit){
    var qc=q.replace(/ /g,''), L=q.length, maxTypo=L<=4?1:(L<=7?2:3);
    var b0=[],b1=[],b2=[],b3=[];
    for(var k=0;k<IDX.length;k++){
      var e=IDX[k];
      if(e.nFull===q||e.nCompact===qc||aliasHit(e,q,qc,0)){ b0.push({e:e,sec:0}); continue; }
      if(e.nFull.indexOf(q)===0||e.nCompact.indexOf(qc)===0||aliasHit(e,q,qc,1)){ if(b1.length<CAP)b1.push({e:e,sec:0}); continue; }
      if(e.nSurname===q||e.nSurname.indexOf(q)===0||(qc&&e.surC.indexOf(qc)===0)){ if(b2.length<CAP)b2.push({e:e,sec:0}); continue; }
      if(b0.length+b1.length+b2.length<limit && b3.length<CAP){   // niveau 3 seulement si nécessaire
        var w=e.words,hit=false;
        for(var wi=0;wi<w.length;wi++){if(w[wi].indexOf(q)===0){hit=true;break;}}
        if(hit) b3.push({e:e,sec:0});
        else if(e.nFull.indexOf(q)>-1||(qc&&e.nCompact.indexOf(qc)>-1)) b3.push({e:e,sec:1});
      }
    }
    b0.sort(byLen);b1.sort(byLen);b2.sort(byLen);b3.sort(byLen);
    var out=b0.concat(b1,b2,b3).map(function(o){return o.e;});
    if(out.length>=limit||L<3) return out.slice(0,limit);
    // Faute de frappe : uniquement sur les candidats de longueur voisine (petit sous-ensemble).
    var have={}; out.forEach(function(e){have[e.full]=1;});
    var seen={}, cand=[], fc=qc.charCodeAt(0);
    for(var dl=-maxTypo;dl<=maxTypo;dl++){
      var a1=LENSUR[qc.length+dl], a2=LENFIRST[qc.length+dl];
      // On restreint aux candidats partageant la 1re lettre (les fautes courantes la conservent) -> très peu de calculs.
      if(a1)for(var i=0;i<a1.length;i++){var x=a1[i];if(!seen[x.full]&&!have[x.full]&&x.surC.charCodeAt(0)===fc){seen[x.full]=1;cand.push(x);}}
      if(a2)for(var j=0;j<a2.length;j++){var y=a2[j];if(!seen[y.full]&&!have[y.full]&&y.firstC.charCodeAt(0)===fc){seen[y.full]=1;cand.push(y);}}
    }
    var typo=[];
    for(var c=0;c<cand.length;c++){var e2=cand[c];var d=Math.min(lev(qc,e2.surC,maxTypo),lev(qc,e2.firstC,maxTypo));if(d<=maxTypo)typo.push({e:e2,sec:d});}
    typo.sort(function(a,b){return a.sec-b.sec||a.e.full.length-b.e.full.length;});
    return out.concat(typo.map(function(o){return o.e;})).slice(0,limit);
  }

  // ---- Dernières propositions du joueur (localStorage, max 5) ----
  // Historique « Tes dernières propositions » DATÉ (jour Paris) : il se vide de lui-même au
  // changement de jour, donc les joueurs testés la veille ne réapparaissent plus dans la recherche.
  function recentKey(){return 'jogadle-recent-'+TODAY;}
  function pruneOldRecent(){ try{ var keep=recentKey(); Store.keys().forEach(function(k){ if(k==='jogadle-recent'||(k.indexOf('jogadle-recent-')===0&&k!==keep)) Store.remove(k); }); }catch(e){} }
  function loadRecent(){try{var a=Store.getJSON(recentKey(),[]);return Array.isArray(a)?a:[];}catch(e){return [];}}
  function pushRecent(e){if(!e)return;try{var a=loadRecent().filter(function(r){return r.id!==e.id&&r.full!==e.full;});a.unshift({id:e.id||null,full:e.full});Store.setJSON(recentKey(),a.slice(0,5));}catch(err){}}

  var sug=[],act=-1,selectedQid=null;
  function hideSug(){box.hidden=true;box.innerHTML='';sug=[];act=-1;}
  function selectable(){var r=[];for(var i=0;i<sug.length;i++)if(!sug[i].used)r.push(i);return r;}
  function rowHtml(s,i){
    var e=s.e,nom=esc((e.nom||e.full||'').toUpperCase()),pre=esc(e.prenom||'');
    if(s.used) return '<div class="suggestion-item is-used" data-i="'+i+'"><span class="sg-left"><b>'+nom+'</b>'+(pre?' '+pre:'')+'</span><span class="sg-used">joueur déjà utilisé</span></div>';
    return '<button type="button" class="suggestion-item" data-i="'+i+'"><span class="sg-nom">'+nom+'</span>'+(pre?'<span class="sg-prenom">'+pre+'</span>':'')+'</button>';
  }
  // Surbrillance clavier UNIQUEMENT (la souris est gérée en CSS :hover, instantané). kb=true seulement en navigation clavier.
  var kb=false;
  function paintActive(){[].forEach.call(box.querySelectorAll('.suggestion-item'),function(c){c.classList.toggle('is-keyboard-active',kb&&+c.getAttribute('data-i')===act);});}
  function renderEmpty(){
    var used=S[level].used||{}, rec=loadRecent(), html='', players=[];
    rec.forEach(function(r){var e=(r.id&&indexById(r.id))||null; if(!e){for(var i=0;i<IDX.length;i++){if(IDX[i].full===r.full){e=IDX[i];break;}}} if(e)players.push(e);});
    players=players.slice(0,5);
    sug=players.map(function(e){return {e:e,used:!!used[compact(e.full)]};});
    if(sug.length){ html+='<div class="sg-head">Tes dernières propositions</div>'+sug.map(function(s,i){return rowHtml(s,i);}).join(''); }
    html+='<button type="button" class="sg-browse" data-act="browse-open">Parcourir tous les joueurs →</button>';
    box.innerHTML=html; box.hidden=false;
    var sel=selectable(); act=sel.length?sel[0]:-1; kb=false; paintActive();
  }
  function renderSug(){
    var q=normKey(input.value);
    if(!q){ renderEmpty(); return; }
    var used=S[level].used||{}, res=searchPlayers(q,8);
    if(!res.length){ hideSug(); return; }
    sug=res.map(function(e){return {e:e,used:!!used[compact(e.full)]};});
    var sel=selectable(); if(sel.indexOf(act)<0) act=sel.length?sel[0]:-1;
    box.innerHTML=sug.map(function(s,i){return rowHtml(s,i);}).join('');
    box.hidden=false; kb=false; paintActive();
  }
  // Garde la proposition active visible par repositionnement IMMÉDIAT (jamais de défilement animé).
  function ensureActiveVisible(){
    var el=box.querySelector('.suggestion-item.is-keyboard-active'); if(!el)return;
    var top=el.offsetTop, bot=top+el.offsetHeight;
    if(top<box.scrollTop) box.scrollTop=top;
    else if(bot>box.scrollTop+box.clientHeight) box.scrollTop=bot-box.clientHeight;
  }
  function pick(i){ if(i<0||!sug[i]||sug[i].used)return; var e=sug[i].e; input.value=e.full; selectedQid=e.id||null; pushRecent(e); hideSug(); input.focus(); }
  // La saisie reste instantanée : on ne calcule QUE la nouvelle requête, regroupée par requestAnimationFrame,
  // et on annule le calcul précédent à chaque touche (aucun caractère perdu, aucune tâche longue empilée).
  var searchRAF=0;
  function scheduleSearch(){ if(searchRAF)cancelAnimationFrame(searchRAF); searchRAF=requestAnimationFrame(function(){searchRAF=0;renderSug();}); }
  input.addEventListener('input',function(){act=-1;selectedQid=null;scheduleSearch();});
  input.addEventListener('focus',function(){if(!input.disabled&&!input.value.trim())renderEmpty();});
  input.addEventListener('keydown',function(e){
    if(box.hidden){ if(e.key==='ArrowDown'&&!input.value.trim()){renderEmpty();} return; }
    var sel=selectable();
    if(e.key==='ArrowDown'){e.preventDefault();if(!sel.length)return;var p=sel.indexOf(act);act=sel[p<0?0:Math.min(p+1,sel.length-1)];kb=true;paintActive();ensureActiveVisible();}
    else if(e.key==='ArrowUp'){e.preventDefault();if(!sel.length)return;var p2=sel.indexOf(act);act=sel[p2<0?sel.length-1:Math.max(p2-1,0)];kb=true;paintActive();ensureActiveVisible();}
    else if(e.key==='Enter'&&act>-1&&sug[act]&&!sug[act].used){e.preventDefault();pick(act);}
    else if(e.key==='Escape'){hideSug();}
  });
  // Sélection UNIQUEMENT sur une vraie ligne. Aucune surbrillance JS au survol : c'est le CSS :hover
  // qui gère (toujours instantané, jamais en retard). Un clic sur la barre/zone vide ne fait rien.
  box.addEventListener('mousedown',function(e){
    if(e.target.closest('[data-act]'))return;                 // liens -> gérés au click
    var b=e.target.closest('.suggestion-item');
    if(!b)return;                                             // barre de défilement / vide : ne rien faire
    e.preventDefault();                                       // garde le focus dans le champ
    if(b.classList.contains('is-used'))return;
    pick(+b.getAttribute('data-i'));
  });

  // ===================== PARCOURIR TOUS LES JOUEURS (liste complète, défilement natif) =====================
  // Solution simple et robuste : pour ~2 155 noms TEXTE, on rend tout dans un conteneur à défilement
  // natif. Le contenu correspond toujours exactement à la position de défilement (aucune virtualisation).
  var BROWSE=[];
  function browseData(filter){
    var arr=IDX.slice().sort(function(a,b){return a.nFull<b.nFull?-1:(a.nFull>b.nFull?1:0);});
    if(filter){var f=normKey(filter),fc=f.replace(/ /g,'');if(f)arr=arr.filter(function(e){return e.nFull.indexOf(f)>-1||(fc&&e.nCompact.indexOf(fc)>-1);});}
    return arr;
  }
  function renderBrowseAll(){
    var inner=$('browseInner'); if(!inner)return;
    var used=S[level].used||{}, html='';
    for(var i=0;i<BROWSE.length;i++){var e=BROWSE[i],u=!!used[compact(e.full)];
      html+='<div class="browse-row'+(u?' is-used':'')+'"'+(u?'':(' data-bid="'+esc(e.full)+'"'))+'>'+esc(e.full)+(u?' <span class="br-used">déjà utilisé</span>':'')+'</div>';}
    inner.innerHTML=html;
  }
  function buildBrowse(f){BROWSE=browseData(f||'');var vp=$('browseList');if(vp)vp.scrollTop=0;renderBrowseAll();}
  function nfmt(n){return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ');}   // espace fine séparateur de milliers
  function buildAZ(){
    var az=$('browseAZ'); if(!az||az.childElementCount)return;
    var s=''; for(var c=65;c<=90;c++){var L=String.fromCharCode(c);s+='<button type="button" data-letter="'+L.toLowerCase()+'">'+L+'</button>';}
    az.innerHTML=s;
  }
  function jumpToLetter(letter){
    var inner=$('browseInner'), vp=$('browseList'); if(!inner||!vp)return;
    for(var i=0;i<BROWSE.length;i++){ if(BROWSE[i].nFull.charAt(0)===letter){ var row=inner.children[i]; if(row)vp.scrollTop=row.offsetTop; return; } }
  }
  var browseScrollY=0;
  function openBrowse(){
    var o=$('browseOverlay'); if(!o)return;
    hideSug(); buildAZ();
    var cnt=$('browseCount'); if(cnt)cnt.textContent=nfmt(IDX.length)+' joueurs disponibles';
    var bi=$('browseInput'); if(bi)bi.value='';
    buildBrowse('');
    browseScrollY=window.scrollY||window.pageYOffset||0;      // mémorise la position pour la restaurer
    o.classList.add('open'); o.setAttribute('aria-hidden','false'); document.body.classList.add('cal-open');
    if(bi)setTimeout(function(){try{bi.focus();}catch(e){}},60);
  }
  function closeBrowse(){
    var o=$('browseOverlay'); if(!o)return;
    o.classList.remove('open'); o.setAttribute('aria-hidden','true'); document.body.classList.remove('cal-open');
    try{window.scrollTo(0,browseScrollY);}catch(e){}          // retrouve exactement la position précédente
  }
  function browsePick(full){var e=indexById2(full);if(!e)return;input.value=e.full;selectedQid=e.id||null;pushRecent(e);closeBrowse();try{input.focus();}catch(x){}}
  function indexById2(full){for(var i=0;i<IDX.length;i++){if(IDX[i].full===full)return IDX[i];}return null;}
  var browseFilterRAF=0;
  (function(){
    var bl=$('browseList'); if(bl)bl.addEventListener('click',function(e){var r=e.target.closest('[data-bid]');if(r)browsePick(r.getAttribute('data-bid'));});
    var bi=$('browseInput'); if(bi)bi.addEventListener('input',function(){if(browseFilterRAF)cancelAnimationFrame(browseFilterRAF);browseFilterRAF=requestAnimationFrame(function(){browseFilterRAF=0;buildBrowse(bi.value);});});
    var az=$('browseAZ'); if(az)az.addEventListener('click',function(e){var btn=e.target.closest('[data-letter]');if(btn)jumpToLetter(btn.getAttribute('data-letter'));});
    // Clic sur le fond sombre (jamais à l'intérieur) -> ferme. Un clic dans la modale ne ferme jamais.
    var ov=$('browseOverlay'); if(ov)ov.addEventListener('click',function(e){if(e.target===ov)closeBrowse();});
  })();
  window.__jogadleSearch={search:function(q){return searchPlayers(normKey(q),8).map(function(e){return {name:e.full,id:e.id};});},openBrowse:openBrowse};
  // Fermeture UNIQUEMENT au clic réellement hors de la zone de recherche (jamais sur molette, survol,
  // mouseleave, barre de défilement ou interaction interne). Sélection/Échap/Valider ferment ailleurs.
  var searchWrapper=(input.closest&&input.closest('.autocomplete'))||form;
  document.addEventListener('click',function(e){if(!searchWrapper.contains(e.target))hideSug();});
  form.addEventListener('submit',submit);
  hintBtn.addEventListener('click',onHint);
  revealBtn.addEventListener('click',onReveal);
  window.addEventListener('resize',scaleStage);
  if(clueCardNat)clueCardNat.addEventListener('click',function(){revealClue('nat');});
  if(clueCardPos)clueCardPos.addEventListener('click',function(){revealClue('pos');});
  [].slice.call(selector.children).forEach(function(b){b.addEventListener('click',function(){setLevel(b.dataset.level);});});

  // ===== Contrôle automatique universel des 1380 joueurs Expert (console) =====
  window.jogadleValidateExperts=function(){
    var exp=(BYLEVEL.expert||[]), n=exp.length, gen=0, matched=0, jsErr=0, undef=0, titlesTotal=0;
    exp.forEach(function(pl){
      try{
        if(pl.id) matched++;
        if(pl.name==null) undef++;
        var cr=pl.career||[]; if(!Array.isArray(cr)) throw new Error('career');
        cr.forEach(function(it){ if(!it||it[0]==null) throw new Error('club'); });
        var d=pl.id?PALMBAKED[pl.id]:null;
        if(d){ (d.honours||[]).forEach(function(h){ if(isRealTitle(h)){ titleKey(h.name); titlesTotal++; } }); }
        gen++;
      }catch(e){ jsErr++; }
    });
    var byName={}; exp.forEach(function(p){(byName[p.name]=byName[p.name]||[]).push(p.id);});
    var dupUnresolved=0;
    Object.keys(byName).forEach(function(nm){ var seen={},dup=false; byName[nm].forEach(function(id){ if(seen[id])dup=true; seen[id]=1; }); if(dup)dupUnresolved++; });
    var s='Expert contrôlés : '+gen+'/'+n
      +'\\nPages générables : '+gen
      +'\\nCorrespondances par QID : '+matched
      +'\\nErreurs JavaScript : '+jsErr
      +'\\nValeurs undefined/null : '+undef
      +'\\nDoublons non résolus : '+dupUnresolved
      +'\\nTitres confirmés (total) : '+titlesTotal;
    console.log(s);
    return {experts:n,generables:gen,qid:matched,jsErrors:jsErr,undef:undef,dupUnresolved:dupUnresolved,titles:titlesTotal};
  };

  // =====================================================================
  //  PERSISTANCE — progression personnelle (localStorage), par date + niveau.
  //  Le localStorage NE décide JAMAIS quels joueurs sont choisis : uniquement
  //  la progression. Les erreurs de stockage ne bloquent jamais le jeu.
  // =====================================================================
  // ===================================================================
  //  STORAGE ADAPTER — SEUL module qui connaît le mécanisme de stockage.
  //  ⚠️ ADAPTATEUR TEMPORAIRE localStorage (mode hors-ligne / tests).
  //  À REMPLACER par l'API serveur TomsoFoot : réimplémenter get/set/remove/keys
  //  (ex. en Promises + fetch) SANS toucher au reste du jeu. Voir JogadleServer.
  // ===================================================================
  var Store=(function(){
    var ok=(function(){try{var k='__jgt__';localStorage.setItem(k,'1');localStorage.removeItem(k);return true;}catch(e){return false;}})();
    return {
      backend:'localStorage',            // deviendra 'server' une fois l'API branchée
      available:function(){return ok;},
      get:function(k){ try{ return ok?localStorage.getItem(k):null; }catch(e){ return null; } },
      set:function(k,v){ try{ if(ok)localStorage.setItem(k,v); }catch(e){} },
      remove:function(k){ try{ if(ok)localStorage.removeItem(k); }catch(e){} },
      keys:function(){ var a=[]; try{ for(var i=0;i<localStorage.length;i++)a.push(localStorage.key(i)); }catch(e){} return a; },
      getJSON:function(k,def){ try{ var r=this.get(k); return r?JSON.parse(r):(def===undefined?null:def); }catch(e){ return (def===undefined?null:def); } },
      setJSON:function(k,v){ this.set(k,JSON.stringify(v)); }
    };
  })();
  var STOREOK=Store.available();   // alias conservé pour compatibilité du code existant
  // MODE TEST : les sauvegardes sont ISOLÉES sous un préfixe dédié (« jogadle-test-… ») afin de ne JAMAIS
  // toucher aux clés/statistiques réelles (« jogadle-… »). En PROD, préfixe standard inchangé.
  var KEYNS = TESTMODE ? 'jogadle-test-' : 'jogadle-';
  function progKey(ds,l){return KEYNS+'progress-'+ds+'-'+l;}
  function readProg(ds,l){var r=Store.get(progKey(ds,l));if(!r)return null;try{return JSON.parse(r);}catch(e){return null;}}
  function writeProg(ds,l,obj){try{Store.set(progKey(ds,l),JSON.stringify(obj));}catch(e){}}
  function statusOf(st){if(!st)return 'unplayed';if(st.solved)return 'win';if(st.answerRevealed)return 'fail';return (st.attempts>0||(st.clue&&(st.clue.nat||st.clue.pos))||st.hintUsed)?'playing':'unplayed';}
  function saveProgress(l){
    if(PREVIEW||replay)return;        // aperçu / archive : pas de sauvegarde (le MODE TEST persiste, mais sous clés isolées)
    l=l||level; var st=S[l], pl=DAILY[l]; if(!st||!pl)return;
    var status=statusOf(st), prev=readProg(TODAY,l);
    var end=(status==='win'||status==='fail')?((prev&&prev.endTime)||Date.now()):null;
    writeProg(TODAY,l,{qid:pl.id,attempts:st.attempts||0,guesses:(st.guesses||[]).slice(),
      clues:{nat:!!(st.clue&&st.clue.nat),pos:!!(st.clue&&st.clue.pos)},hintUsed:!!st.hintUsed,
      status:status,state:st,endTime:end,share:(status==='win'||status==='fail')?levelResultLine(l):null});
  }
  function restoreDay(ds){
    S={}; finished=false;
    ['amateur','pro','expert'].forEach(function(l){
      if(!DAILY[l])return;
      var rec=readProg(ds,l);
      if(rec&&rec.qid===DAILY[l].id&&rec.state){ S[l]=rec.state; }
    });
    finished=['amateur','pro','expert'].every(function(l){var st=S[l];return st&&(st.solved||st.answerRevealed);})&&!!DAILY.expert;
  }
  function migrateOld(){
    if(!Store.available())return;
    try{
      var ver=Store.get('jogadle-store-version');
      if(!ver){
        Store.keys().forEach(function(k){
          if(k&&k.indexOf('jogadle-progress-')===0){ try{JSON.parse(Store.get(k));}catch(e){ Store.remove(k); } }
        });
        Store.set('jogadle-store-version','2');
      }
    }catch(e){}
  }

  // =====================================================================
  //  STATISTIQUES & SÉRIES — calculées sur les 3 défis quotidiens.
  //  Les parties rejouées depuis les archives ne sont jamais enregistrées,
  //  donc jamais comptées ici.
  // =====================================================================
  function successDay(ds){return ['amateur','pro','expert'].some(function(l){var r=readProg(ds,l);return r&&r.status==='win';});}
  function currentStreak(){
    var s=0,d=TODAY,g=0;
    if(!successDay(TODAY)) d=addDays(TODAY,-1);
    while(dateToIndex(d)>=dateToIndex(LAUNCH_DATE)&&g<900){ if(successDay(d)){s++;d=addDays(d,-1);}else break; g++; }
    return s;
  }
  function bestStreak(){
    var best=0,run=0,d=LAUNCH_DATE,g=0;
    while(dateToIndex(d)<=dateToIndex(TODAY)&&g<900){ if(successDay(d)){run++;if(run>best)best=run;}else run=0; d=addDays(d,1); g++; }
    return best;
  }
  function computeStats(){
    var played=0,win=0,fail=0,notplayed=0,d=LAUNCH_DATE,g=0;
    while(dateToIndex(d)<=dateToIndex(TODAY)&&g<900){
      ['amateur','pro','expert'].forEach(function(l){var r=readProg(d,l);
        if(r&&r.status==='win'){played++;win++;} else if(r&&r.status==='fail'){played++;fail++;} else notplayed++;});
      d=addDays(d,1); g++;
    }
    return {played:played,win:win,fail:fail,notplayed:notplayed,rate:played?Math.round(win/played*100):0,streak:currentStreak(),best:bestStreak()};
  }

  // ===================== PARTAGE (sans jamais révéler les noms) =====================
  function frLongDate(ds){var p=String(ds).split('-'),d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));
    try{return new Intl.DateTimeFormat('fr-FR',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(d).toUpperCase();}catch(e){return ds;}}
  function levelResultLine(l){
    var name={amateur:'Amateur',pro:'Pro',expert:'Expert'}[l];
    var r=readProg(TODAY,l), st=r?r.status:'unplayed';
    var tries=r?((r.guesses&&r.guesses.length)||r.attempts||0):0;
    if(st==='win') return '🟢 '+name+' '+(tries||1)+'/6';
    if(st==='fail') return '🔴 '+name+' X/6';
    return '⚪ '+name+' –/6';
  }
  function buildShareText(){
    var L=['JOGADLE — '+frLongDate(TODAY)];
    ['amateur','pro','expert'].forEach(function(l){L.push(levelResultLine(l));});
    var s=currentStreak(); L.push('🔥 Série : '+s+' jour'+(s>1?'s':''));
    L.push('https://tomsofoot.fr/');
    return L.join(String.fromCharCode(10));
  }
  function showToast(m){var t=$('shareToast');if(!t)return;t.textContent=m;t.classList.add('show');setTimeout(function(){t.classList.remove('show');},2600);}
  function fallbackCopy(text,cb){try{var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}catch(e){}if(cb)cb();}
  function doShare(){
    var text=buildShareText();
    if(navigator.share){navigator.share({title:'Jogadle — Mode Carrière',text:text}).then(function(){},function(){});return;}
    var ok=function(){showToast('Résultat copié dans le presse-papiers');};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(ok,function(){fallbackCopy(text,ok);});}
    else fallbackCopy(text,ok);
  }

  // =====================================================================
  //  POP-UP DE PARTAGE DÉDIÉ + GÉNÉRATEUR D'IMAGE PNG (canvas)
  //  Aucune donnée du jour n'est révélée (pas de nom, portrait, club,
  //  nationalité, poste ni palmarès). Séparé de toute navigation.
  // =====================================================================
  var SR_FMT='post', srLastFocus=null, idLastFocus=null, rwLastFocus=null;
  var PREVIEW_NAME=null;   // PREVIEW_NAME : aperçu pendant la création d'identité
  // ===== REGISTRE DES CARTES : chaque archétype = 1 master PNG VERROUILLÉ + coordonnées des zones vides =====
  // MÊME architecture de remplissage pour toutes les cartes (pseudo compte + résultats réels).
  var CARDS={
    'entree-des-gladiateurs':{ title:"L'ENTRÉE DES GLADIATEURS", uri:'__SHARECARD_URI__', img:null, ready:false, w:1182, h:1330,
      howTo:"Trouve (devine) le niveau EXPERT lors d’un défi quotidien officiel — n’importe quel jour — pour débloquer cette carte de bienvenue.",
      name:{cx:591,cy:265,maxw:430,max:32,min:20},
      rows:{cy:[960,1021,1082], essais:605, statut:800, font:27} },
    'appel-des-etoiles':{ title:"L'APPEL DES ÉTOILES", uri:'__SHARECARD_URI_ETOILES__', img:null, ready:false, w:1178, h:1335,
      howTo:"Participe à Jogadle lors des DEUX journées consécutives d’une même semaine de Ligue des Champions (les deux jours de matchs). Les archives ne comptent pas. Obtenue une seule fois par compte.",
      name:{cx:589,cy:286,maxw:430,max:32,min:20},
      rows:{cy:[911,964,1018], essais:600, statut:785, font:27} },
    'le-rituel':{ title:"LE RITUEL", uri:'__SHARECARD_URI_RITUEL__', img:null, ready:false, w:1181, h:1332,
      howTo:"Joue à Jogadle 7 JOURS CONSÉCUTIFS (calendrier de Paris) en terminant au moins un niveau chaque jour. Un jour manqué remet la série à 1. Archives et rejeux ne comptent pas. Obtenue une seule fois par compte.",
      name:{cx:590,cy:290,maxw:400,max:32,min:20},
      rows:{cy:[953,1011,1068], essais:600, statut:790, font:27} }
  };
  var ACTIVE_CARD='entree-des-gladiateurs';    // carte actuellement rendue dans le partage
  function cardDef(id){ return CARDS[id||ACTIVE_CARD]||CARDS['entree-des-gladiateurs']; }
  (function(){ for(var k in CARDS){ (function(def){ try{ if(def.uri&&def.uri.indexOf('data:')===0){ def.img=new Image(); def.img.onload=function(){def.ready=true;}; def.img.src=def.uri; } }catch(e){} })(CARDS[k]); } })();
  // Nettoyage : retire balises/contrôles, n'autorise que lettres (accentuées), chiffres, espace, - . _ ; borne à 16
  function sanitizeShareName(raw){
    var s=String(raw==null?'':raw);
    s=s.replace(/[\x00-\x1F\x7F]/g,'');                  // caractères de contrôle
    try{ s=s.replace(/[^\p{L}\p{N} ._-]/gu,''); }         // liste blanche : lettres/chiffres/espace/._-
    catch(e){ s=s.replace(/[^A-Za-zÀ-ÿ0-9 ._-]/g,''); }
    s=s.replace(/\s+/g,' ');                               // espaces multiples -> un seul
    if(s.length>16)s=s.slice(0,16);
    return s;
  }
  function normalizeCollector(name){ try{ return String(name).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim(); }catch(e){ return String(name).toLowerCase().trim(); } }
  function nowISO(){ try{ return new Date().toISOString(); }catch(e){ return ''; } }

  // ============================================================================
  //  IDENTITÉ DE COLLECTIONNEUR — pseudo UNIQUE et DÉFINITIF au niveau du COMPTE.
  //  Couche ISOLÉE (localStorage temporaire) — À REMPLACER par l'API compte TomsoFoot :
  //  le serveur reste la seule autorité ; toute tentative de changement doit renvoyer
  //  PSEUDO_LOCKED. Le joueur ne peut jamais se modifier ; seul un admin corrige (journalisé).
  // ============================================================================
  var COLLECTOR_KEY='jogadle_collector_identity_v1', COLLECTOR_HISTORY_KEY='jogadle_collector_history_v1', USERID_KEY='jogadle_user_id_v1';
  var Account={
    userId:function(){ try{ var u=Store.get(USERID_KEY); if(!u){ u='local-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8); Store.set(USERID_KEY,u); } return u||'anon'; }catch(e){ return 'anon'; } },
    read:function(){ return Store.getJSON(COLLECTOR_KEY,null); },
    _write:function(rec){ Store.setJSON(COLLECTOR_KEY,rec); },
    isLocked:function(){ var d=this.read(); return !!(d&&d.collectorNameLocked); },
    // Nom officiel (autorité serveur simulée). null si aucun pseudo verrouillé.
    collectorName:function(){ var d=this.read(); return (d&&d.collectorNameLocked)?d.collectorName:null; },
    // Verrouillage DÉFINITIF par le joueur (une seule fois). Refuse si déjà verrouillé.
    lockCollectorName:function(raw){
      if(this.isLocked()) return {ok:false,error:'PSEUDO_LOCKED'};   // équivalent réponse serveur
      var name=sanitizeShareName(raw).trim();
      if(name.length<2||name.length>16) return {ok:false,error:'INVALID_NAME'};
      this._write({ userId:this.userId(), collectorName:name, collectorNameNormalized:normalizeCollector(name),
        collectorNameLocked:true, collectorNameLockedAt:nowISO(), lockedSource:'user' });
      return {ok:true,name:name};
    },
    // Toute demande joueur de remplacement est refusée (jamais d'écriture) -> PSEUDO_LOCKED.
    requestUserChange:function(){ return {ok:false,error:'PSEUDO_LOCKED'}; },
    // Correction ADMIN uniquement (hors interface joueur), journalisée.
    adminCorrect:function(newRaw,reason,adminId){
      var name=sanitizeShareName(newRaw).trim();
      if(name.length<2||name.length>16) return {ok:false,error:'INVALID_NAME'};
      var d=this.read()||{userId:this.userId()}, old=d.collectorName||null;
      d.collectorName=name; d.collectorNameNormalized=normalizeCollector(name);
      d.collectorNameLocked=true; if(!d.collectorNameLockedAt)d.collectorNameLockedAt=nowISO();
      d.lastAdminEditAt=nowISO(); this._write(d);
      var hist=Store.getJSON(COLLECTOR_HISTORY_KEY,[]); if(!Array.isArray(hist))hist=[];
      hist.push({ oldValue:old, newValue:name, date:nowISO(), reason:reason||'', adminId:adminId||'admin' });
      Store.setJSON(COLLECTOR_HISTORY_KEY,hist);
      return {ok:true,name:name};
    },
    history:function(){ var h=Store.getJSON(COLLECTOR_HISTORY_KEY,[]); return Array.isArray(h)?h:[]; }
  };
  // Valeur affichée sur les cartes : MAJUSCULES ; toujours issue du COMPTE (ou de l'aperçu en création).
  function cardDisplayName(rawOverride){
    var raw = (rawOverride!=null) ? rawOverride : ((PREVIEW_NAME!=null) ? PREVIEW_NAME : Account.collectorName());
    if(raw==null) return 'JOUEUR';
    var v=sanitizeShareName(raw).trim();
    if(v.length<2) return 'JOUEUR';
    return v.toUpperCase();
  }
  function challengeNumber(){var n=dateToIndex(TODAY)-dateToIndex(LAUNCH_DATE)+1;return n>0?n:0;}
  // Résultat réel par niveau — source fiable : état vivant, sinon état stocké
  function levelOutcome(l){
    var st=S[l];
    if(!st||(!st.solved&&!st.answerRevealed)){ var r=readProg(TODAY,l); if(r&&r.state) st=r.state; }
    var solved=!!(st&&st.solved), revealed=!!(st&&st.answerRevealed), lost=!!(st&&st.lost);
    var status=solved?'win':(revealed?'revealed':(lost?'fail':'unplayed'));
    var guesses=st?((st.guesses&&st.guesses.length)||st.attempts||0):0;
    var tries=solved?(guesses||1):(revealed?guesses:0);
    var clues=st?(((st.clue&&st.clue.nat)?1:0)+((st.clue&&st.clue.pos)?1:0)+(st.hintUsed?1:0)):0;
    return {status:status,tries:tries,clues:clues};
  }
  var SR_LABEL={win:'RÉUSSI',revealed:'RÉVÉLÉ',fail:'ÉCHOUÉ',unplayed:'NON JOUÉ'};
  var SR_COLOR={win:'#18c98a',revealed:'#e0a53a',fail:'#ff3b57',unplayed:'#5b647c'};
  function levelDetail(o){
    if(o.status==='win'){ var t='EN '+(o.tries||1)+' ESSAI'+((o.tries||1)>1?'S':''); if(o.clues>0)t+=' · '+o.clues+' INDICE'+(o.clues>1?'S':''); return t; }
    if(o.status==='revealed'){ return o.clues>0?(o.clues+' INDICE'+(o.clues>1?'S':'')+' UTILISÉ'+(o.clues>1?'S':'')):'RÉPONSE DÉVOILÉE'; }
    if(o.status==='fail'){ return 'NON TROUVÉ'; }
    return '—';
  }
  function buildResultText(){
    var L=['JOGADLE'];
    var cn=challengeNumber();
    L.push('DÉFI DU '+frLongDate(TODAY)+(cn?(' · N°'+cn):''));
    ['amateur','pro','expert'].forEach(function(l){
      var o=levelOutcome(l), name={amateur:'AMATEUR',pro:'PRO',expert:'EXPERT'}[l], extra='';
      if(o.status==='win'){ extra='EN '+(o.tries||1)+' ESSAI'+((o.tries||1)>1?'S':''); if(o.clues>0)extra+=' · '+o.clues+' INDICE'+(o.clues>1?'S':''); }
      else if(o.status==='revealed'){ if(o.clues>0)extra=o.clues+' INDICE'+(o.clues>1?'S':''); }
      L.push(name+' — '+SR_LABEL[o.status]+(extra?(' '+extra):''));
    });
    var s=currentStreak(); L.push('SÉRIE ACTUELLE : '+s+' JOUR'+(s>1?'S':''));
    L.push('JOUEZ SUR TOMSOFOOT.FR');
    return L.join(String.fromCharCode(10));
  }
  function srFileName(){return 'jogadle-resultat-'+TODAY+'.png';}

  // ---- (Ancien rendu canvas « fond bleu nuit » (drawShareCard) supprimé : il remplissait un fond opaque via
  //       ctx.fillRect. Il n'était plus appelé et n'existe plus, garantissant qu'AUCUN chemin d'export ne peut
  //       peindre de rectangle noir/opaque. L'export officiel passe uniquement par generateShareImage, qui
  //       fait clearRect puis drawImage du master ALPHA transparent -> fond réellement transparent.) ----
  // ---- Carte de partage = PNG maître verrouillé + données réelles + pseudo dessinés par-dessus ----
  // (les coordonnées des zones vides sont dans CARDS, par archétype ; dimensions natives via naturalWidth/Height)
  var STATUS_TEXT={reussi:'RÉUSSI',revele:'RÉVÉLÉ',echoue:'ÉCHOUÉ',non_joue:'NON JOUÉ'};
  var STATUS_COLOR={reussi:'#bfe325',revele:'#e8b64a',echoue:'#ff3b57',non_joue:'#93a0bd'};
  // ---- Résultat vérifié et FIGÉ : lu dans l'état réel du jeu (jamais depuis le DOM, jamais depuis un champ) ----
  function getVerifiedShareResult(){
    var map={win:'reussi',revealed:'revele',fail:'echoue',unplayed:'non_joue'};
    function lvl(l){
      var o=levelOutcome(l);                             // état interne réel (S[l] vivant, sinon progression stockée)
      var status=map[o.status]||'non_joue';
      var tries=(typeof o.tries==='number'&&isFinite(o.tries)&&o.tries>=0)?Math.floor(o.tries):0;
      if(status==='non_joue')tries=0;
      return Object.freeze({status:status,tries:tries});
    }
    var res={amateur:lvl('amateur'),pro:lvl('pro'),expert:lvl('expert'),
      challengeId:challengeNumber(),archetype:"L'ENTRÉE DES GLADIATEURS",firstObtention:true};
    // Validation stricte avant génération
    var VALID=['reussi','revele','echoue','non_joue'];
    ['amateur','pro','expert'].forEach(function(l){
      var v=res[l];
      if(!v||VALID.indexOf(v.status)<0) throw new Error('statut invalide');
      if(typeof v.tries!=='number'||v.tries<0||v.tries!==Math.floor(v.tries)) throw new Error('essais invalides');
    });
    return Object.freeze(res);
  }
  function essaisLabel(v){
    if(v.status==='non_joue') return '—';
    return v.tries+' ESSAI'+(v.tries>1?'S':'');          // accord : 1 ESSAI / 2 ESSAIS
  }

  // ============ COLLECTION DE CARTES — obtention unique par défi ============
  // Couche de stockage ISOLÉE (remplaçable plus tard par des appels serveur : userId+cardId).
  // NOTE : localStorage est temporaire pour les tests ; la référence finale doit être le compte TomsoFoot.
  var ARCHETYPE_ID='entree-des-gladiateurs';
  var CARDS_KEY='jogadle_cards_owned_v1', UNLOCK_SEEN_KEY='jogadle_cards_unlock_seen_v1';
  var CardStore={
    _read:function(){ var o=Store.getJSON(CARDS_KEY,{}); return (o&&typeof o==='object')?o:{}; },
    _write:function(o){ Store.setJSON(CARDS_KEY,o); },
    has:function(id){ return Object.prototype.hasOwnProperty.call(this._read(), id); },
    get:function(id){ return this._read()[id]||null; },
    put:function(id,rec){ var o=this._read(); if(o[id])return o[id]; o[id]=rec; this._write(o); return rec; },  // idempotent (garde applicatif ; l'unicité DURE sera imposée par le serveur)
    seenUnlock:function(id){ return Store.get(UNLOCK_SEEN_KEY+':'+id)==='1'; },
    markUnlockSeen:function(id){ Store.set(UNLOCK_SEEN_KEY+':'+id,'1'); }
  };
  // ===== « L'ENTRÉE DES GLADIATEURS » = CARTE DE BIENVENUE (première partie) =====
  // Identifiant FIXE (jamais basé sur la date). Unicité : userId + rewardId (une seule fois À VIE par compte).
  var WELCOME_REWARD_ID='welcome_entree_des_gladiateurs';
  function welcomeCardId(){ return WELCOME_REWARD_ID; }
  function dailyCardId(ds){ return (ds||TODAY)+'_'+ARCHETYPE_ID; }             // conservé pour référence/compat ; NON utilisé pour l'obtention welcome
  function dailyComplete(){ return ['amateur','pro','expert'].every(function(l){var st=S[l];return !!(st&&(st.solved||st.answerRevealed));}) && !!(DAILY&&DAILY.expert); }
  // La carte de bienvenue se MÉRITE : il faut TROUVER (deviner) le niveau EXPERT, pas le révéler.
  // Peu importe le jour : dès qu'un joueur trouve l'Expert (aujourd'hui, demain, dans 1 mois), il gagne sa carte.
  function expertSolved(){ return !!(S.expert && S.expert.solved) && !!(DAILY&&DAILY.expert); }
  function hasDailyCard(){ return CardStore.has(WELCOME_REWARD_ID); }          // possède-t-il déjà la carte de bienvenue ?
  // Attribution de la carte de BIENVENUE : dès que le compte TROUVE (devine) le niveau EXPERT.
  // Révéler l'Expert (même après avoir deviné Amateur+Pro) ne donne PAS la carte. N'importe quel
  // jour convient : il suffit de trouver l'Expert une fois. Jamais en archive/rejeu/aperçu.
  function awardDailyCardOnce(){
    if(replay||PREVIEW) return {firstTime:false,owned:hasDailyCard(),blocked:true};   // archives / rejeu : jamais de récompense
    if(CardStore.has(WELCOME_REWARD_ID)) return {firstTime:false,owned:true,id:WELCOME_REWARD_ID};   // 1 seule fois par compte, à vie
    if(!expertSolved()) return {firstTime:false,owned:false};                          // condition : Expert TROUVÉ (pas révélé)
    var R; try{ R=getVerifiedShareResult(); }catch(e){ return {firstTime:false,owned:false}; }
    CardStore.put(WELCOME_REWARD_ID, {
      rewardId:WELCOME_REWARD_ID, rewardType:'welcome', archetype:ARCHETYPE_ID,
      ownerName:Account.collectorName(),                          // pseudo propriétaire (backfill si créé juste après)
      result:{amateur:R.amateur,pro:R.pro,expert:R.expert},       // vrais résultats de la 1re partie (fige)
      firstPlayDate:TODAY, originalChallengeId:TODAY, originalChallengeNumber:challengeNumber(),  // MÉTADONNÉES (n'influencent jamais l'éligibilité)
      unlockedAt:nowISO()
    });
    return {firstTime:true,owned:true,id:WELCOME_REWARD_ID};
  }
  // Recopie le pseudo compte sur toutes les cartes possédées (propriété ownerName).
  function stampOwnerNameOnCards(name){
    try{ var o=CardStore._read(), ch=false;
      for(var k in o){ if(o.hasOwnProperty(k) && (!o[k].ownerName)){ o[k].ownerName=name; ch=true; } }
      if(ch)CardStore._write(o);
    }catch(e){}
  }

  // ===== « L'APPEL DES ÉTOILES » = récompense d'ASSIDUITÉ (2 journées consécutives d'une semaine de Ligue des Champions) =====
  // Unicité : userId + rewardId (une seule fois À VIE). Les ARCHIVES ne comptent jamais (participation = jeu officiel).
  var ETOILES_REWARD_ID='appel_des_etoiles';
  // Calendrier officiel des semaines de Ligue des Champions : chaque entrée = les 2 journées consécutives (ex. mardi + mercredi).
  // >>> À REMPLACER par le vrai calendrier UEFA. Surcharge possible sans rebuild via window.__JOGADLE_CL_WEEKS. <<<
  var CL_WEEKS = (typeof window!=='undefined' && window.__JOGADLE_CL_WEEKS && window.__JOGADLE_CL_WEEKS.length) ? window.__JOGADLE_CL_WEEKS : [
    { id:'2026-CL01', day1:'2026-08-18', day2:'2026-08-19' },
    { id:'2026-CL02', day1:'2026-08-25', day2:'2026-08-26' }
  ];
  // A participé au défi OFFICIEL ce jour-là (jamais via archives : readProg ne stocke que le jeu officiel).
  function participatedOn(ds){
    return ['amateur','pro','expert'].some(function(l){
      var r=readProg(ds,l); if(!r)return false;
      if(r.status==='win'||r.status==='fail')return true;                 // trouvé ou révélé
      if((r.attempts||0)>0)return true;                                    // au moins une proposition validée
      if(r.hintUsed)return true; if(r.clues&&(r.clues.nat||r.clues.pos))return true;
      if(r.state&&(r.state.solved||r.state.answerRevealed||(r.state.attempts||0)>0))return true;
      return false;
    });
  }
  function outcomeFromState(st){
    var solved=!!(st&&st.solved), revealed=!!(st&&st.answerRevealed);
    var status=solved?'reussi':(revealed?'revele':'non_joue');
    var guesses=st?((st.guesses&&st.guesses.length)||st.attempts||0):0;
    var tries=solved?(guesses||1):(revealed?guesses:0);
    return {status:status,tries:tries};
  }
  function resultForDate(ds){ var o={}; ['amateur','pro','expert'].forEach(function(l){var r=readProg(ds,l);o[l]=outcomeFromState(r&&r.state);}); return o; }
  function hasEtoilesCard(){ return CardStore.has(ETOILES_REWARD_ID); }
  // Renvoie la 1re semaine LDC dont les DEUX journées ont été jouées (officiellement), sinon null.
  function eligibleClWeek(){
    for(var i=0;i<CL_WEEKS.length;i++){ var w=CL_WEEKS[i];
      if(w&&w.day1&&w.day2&&participatedOn(w.day1)&&participatedOn(w.day2)) return w; }
    return null;
  }
  function awardEtoilesOnce(){
    if(replay||PREVIEW) return {firstTime:false,owned:hasEtoilesCard(),blocked:true};   // archives/rejeu : jamais
    if(CardStore.has(ETOILES_REWARD_ID)) return {firstTime:false,owned:true,id:ETOILES_REWARD_ID};   // 1 fois par compte, à vie
    var w=eligibleClWeek(); if(!w) return {firstTime:false,owned:false};
    CardStore.put(ETOILES_REWARD_ID, {
      rewardId:ETOILES_REWARD_ID, rewardType:'assiduite', archetype:'appel-des-etoiles',
      ownerName:Account.collectorName(),
      result:resultForDate(w.day2),                        // résultats de la 2e journée (fige) ; participation, pas performance
      clWeekId:w.id, clDay1:w.day1, clDay2:w.day2, unlockedAt:nowISO()
    });
    return {firstTime:true,owned:true,id:ETOILES_REWARD_ID};
  }

  // ===== « LE RITUEL » = récompense d'ASSIDUITÉ (7 JOURS CONSÉCUTIFS, calendrier Europe/Paris) =====
  // Une journée compte si AU MOINS UN niveau officiel a été TERMINÉ (trouvé/révélé) ce jour-là. Résultat sans importance.
  // Archives / rejeux / mode test / refresh ne comptent pas (readProg ne stocke que le jeu officiel). 1 fois par compte.
  var RITUAL_REWARD_ID='ritual-7-consecutive-days-v1';
  function completedDayOfficial(ds){ return ['amateur','pro','expert'].some(function(l){var r=readProg(ds,l);return !!(r&&(r.status==='win'||r.status==='fail'));}); }
  // 1re DATE CALENDAIRE (Paris) où une série de 7 jours consécutifs terminés se boucle, sinon null. Jamais glissant sur 24 h.
  function ritualUnlockDate(){
    var d=LAUNCH_DATE, run=0, g=0;
    while(dateToIndex(d)<=dateToIndex(TODAY) && g<4000){
      if(completedDayOfficial(d)){ run++; if(run>=7) return d; } else { run=0; }
      d=addDays(d,1); g++;
    }
    return null;
  }
  // Série consécutive actuelle (info/tests) : nb de jours terminés d'affilée jusqu'au dernier jour joué.
  function ritualStreak(){
    var d=TODAY, s=0, g=0;
    if(!completedDayOfficial(d)) d=addDays(d,-1);
    while(dateToIndex(d)>=dateToIndex(LAUNCH_DATE) && g<400){ if(completedDayOfficial(d)){ s++; d=addDays(d,-1); } else break; g++; }
    return s;
  }
  function hasRitualCard(){ return CardStore.has(RITUAL_REWARD_ID); }
  function awardRitualOnce(){
    if(replay||PREVIEW) return {firstTime:false,owned:hasRitualCard(),blocked:true};   // archives/rejeu/test : jamais
    if(CardStore.has(RITUAL_REWARD_ID)) return {firstTime:false,owned:true,id:RITUAL_REWARD_ID};   // 1 fois par compte, à vie
    var ud=ritualUnlockDate(); if(!ud) return {firstTime:false,owned:false};
    CardStore.put(RITUAL_REWARD_ID, {
      rewardId:RITUAL_REWARD_ID, rewardType:'assiduite', archetype:'le-rituel',
      ownerName:Account.collectorName(),
      resultDate:ud,                             // rendu LIVE : reflète les niveaux joués plus tard CE jour-là
      result:resultForDate(ud),                  // secours figé
      unlockDate:ud, unlockedAt:nowISO()
    });
    return {firstTime:true,owned:true,id:RITUAL_REWARD_ID};
  }
  // Écrit essais + statut réels dans chaque ligne, puis le pseudo.
  function drawCardData(ctx,def,opts){
    opts=opts||{};
    var rows=def.rows, R=opts.result;   // opts.result : carte figée (galerie) ; sinon état réel du jeu
    if(!R){ try{ R=getVerifiedShareResult(); }catch(e){ return; } }
    ['amateur','pro','expert'].forEach(function(l,i){
      var v=R[l], cy=rows.cy[i];
      ctx.save();
      ctx.textAlign='center';ctx.textBaseline='middle';
      // nombre d'essais — blanc argenté
      ctx.font='700 '+rows.font+'px "Barlow Condensed","Archivo Black",sans-serif';
      try{ctx.letterSpacing='0.5px';}catch(e){}
      ctx.shadowColor='rgba(0,0,0,.5)';ctx.shadowBlur=5;
      ctx.fillStyle='#eef1f7';
      ctx.fillText(essaisLabel(v),rows.essais,cy);
      // statut — couleur dédiée
      ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=6;
      ctx.fillStyle=STATUS_COLOR[v.status];
      ctx.fillText(STATUS_TEXT[v.status],rows.statut,cy);
      try{ctx.letterSpacing='0px';}catch(e){}
      ctx.restore();
    });
    drawPseudo(ctx,def,opts.ownerName);
  }
  // Pseudo : UNE seule ligne, centrée, MAJUSCULES ; réduction AUTO de la font-size selon la largeur RÉELLE mesurée.
  // Aucun retour à la ligne, aucune ellipse, aucun scaleX : fillText sur canvas = ligne unique par nature.
  function drawPseudo(ctx,def,nameOverride){
    var N=def.name, name=cardDisplayName(nameOverride);
    ctx.save();
    ctx.textAlign='center';ctx.textBaseline='middle';
    // réduction auto : taille max -> min puis, si besoin, on resserre l'interlettre, sans jamais dépasser la largeur autorisée
    var size=N.max, ls=4;
    function widthAt(sz,l){ ctx.font='700 '+sz+'px "Barlow Condensed","Archivo Black",sans-serif'; try{ctx.letterSpacing=l+'px';}catch(e){} return ctx.measureText(name).width; }
    while(size>N.min && widthAt(size,ls)>N.maxw){ size-=1; }
    if(widthAt(size,ls)>N.maxw){ while(ls>0 && widthAt(size,ls)>N.maxw){ ls-=0.5; } }
    ctx.font='700 '+size+'px "Barlow Condensed","Archivo Black",sans-serif';
    try{ctx.letterSpacing=ls+'px';}catch(e){}
    // couleur blanc argenté (léger dégradé vertical) + ombre discrète pour la lisibilité
    var gy=N.cy-size*0.5, gr=ctx.createLinearGradient(0,gy,0,gy+size);
    gr.addColorStop(0,'#ffffff');gr.addColorStop(.55,'#eef1f7');gr.addColorStop(1,'#c6cede');
    ctx.shadowColor='rgba(0,0,0,.55)';ctx.shadowBlur=6;ctx.shadowOffsetY=1;
    ctx.fillStyle=gr;
    ctx.fillText(name,N.cx,N.cy);
    try{ctx.letterSpacing='0px';}catch(e){}
    ctx.restore();
  }
  // Dessine le master INCHANGÉ (drawImage plein cadre, dimensions natives), puis les données réelles + le pseudo.
  function generateShareImage(target,archetypeId,opts){
    var def=cardDef(archetypeId), img=def.img;
    var cv=target||$('srCanvas')||document.createElement('canvas');
    var W=(img&&img.naturalWidth)||def.w;
    var H=(img&&img.naturalHeight)||def.h;
    cv.width=W;cv.height=H;
    var ctx=cv.getContext('2d');
    ctx.clearRect(0,0,W,H);
    if(img&&def.ready){ ctx.drawImage(img,0,0,W,H); }   // master 1:1, aucune transformation
    if(!(opts&&opts.locked)) drawCardData(ctx,def,opts);   // locked (galerie) : master seul, sans données
    return cv;
  }
  function srWithFonts(cb){
    try{
      if(document.fonts&&document.fonts.load){
        Promise.all([document.fonts.load('900 118px "Archivo Black"'),document.fonts.load('700 44px "Barlow Condensed"'),document.fonts.load('600 30px "Barlow Condensed"')]).then(function(){cb();},function(){cb();});
        return;
      }
    }catch(e){}
    cb();
  }
  function renderSharePreview(){
    srWithFonts(function(){
      generateShareImage();
      // si le master n'est pas encore décodé, on redessine à sa disponibilité
      var def=cardDef(); if(def.img && !def.ready){ def.img.addEventListener('load',function(){ generateShareImage(); }, {once:true}); }
    });
  }
  function srHint(msg,warn){var h=$('srHint');if(!h)return;h.textContent=msg||'';h.classList.toggle('is-warn',!!warn);}
  function srCopyText(text,cb){
    var ok=function(){cb&&cb(true);};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(ok,function(){fallbackCopy(text,function(){cb&&cb(true);});});}
    else fallbackCopy(text,function(){cb&&cb(true);});
  }
  function downloadBlobAs(blob, filename){
    if(!blob)return;
    try{
      var url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url;a.download=filename;a.rel='noopener';document.body.appendChild(a);a.click();
      setTimeout(function(){try{document.body.removeChild(a);}catch(e){}URL.revokeObjectURL(url);},1500);
    }catch(e){}
  }
  function canvasToBlob(cv,cb){ if(cv.toBlob){cv.toBlob(cb,'image/png');} else { try{var d=cv.toDataURL('image/png'),b=atob(d.split(',')[1]),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);cb(new Blob([u],{type:'image/png'}));}catch(e){cb(null);} } }
  // ===== MOTEUR D'EXPORT OFFICIEL — UNE SEULE fonction, partout (obtention, partage, « Mes cartes », re-téléchargement).
  // Jamais une capture d'écran / html2canvas du conteneur : on redessine le master (ALPHA transparent) sur un canvas
  // hors-DOM (clearRect -> drawImage -> pseudo -> résultats) et on exporte en PNG (toBlob), donc FOND TRANSPARENT préservé.
  function exportCardPNG(cardId, cardData, cb){
    srWithFonts(function(){
      var cv=generateShareImage(document.createElement('canvas'), cardId, cardData||{});  // fond transparent (aucun fillRect)
      canvasToBlob(cv, function(blob){ cb && cb(blob, cv); });                            // image/png -> conserve l'alpha
    });
  }
  function downloadShareImage(){
    exportCardPNG(ACTIVE_CARD, {}, function(blob,cv){ if(!blob){srHint('Impossible de générer le PNG.',true);return;} downloadBlobAs(blob, srFileName()); srHint('Carte PNG (fond transparent) téléchargée ('+cv.width+'×'+cv.height+').'); });
  }
  function shareResultImage(){
    var text=buildResultText();
    exportCardPNG(ACTIVE_CARD, {}, function(blob){
      if(!blob){srHint('Impossible de générer le PNG.',true);return;}
      var file=null; try{file=new File([blob],srFileName(),{type:'image/png'});}catch(e){file=null;}
      var canFiles=!!(file&&navigator.canShare&&navigator.canShare({files:[file]}));
      if(navigator.share&&canFiles){
        navigator.share({files:[file],title:'Jogadle — Mode Carrière',text:text}).then(function(){srHint('Partage ouvert.');},function(){srHint('Partage annulé.');});
        return;
      }
      // Secours (ordinateur / navigateur sans partage de fichier) : téléchargement + copie + message clair
      downloadBlobAs(blob, srFileName());
      srCopyText(text,function(){});
      srHint('Partage non pris en charge ici : PNG (fond transparent) téléchargé et score copié.',true);
    });
  }
  function copyResultText(){ srCopyText(buildResultText(),function(ok){ srHint(ok?'Score copié dans le presse-papiers.':'Impossible de copier automatiquement.',!ok); }); }
  function srTrapFocus(e){
    if(e.key!=='Tab')return;
    var m=$('shareResultModal'); if(!m)return;
    var f=[].slice.call(m.querySelectorAll('button:not([disabled]),input:not([disabled])')).filter(function(el){return el.offsetParent!==null;});
    if(!f.length)return;
    var first=f[0], last=f[f.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
  function openShareResultModal(){
    var o=$('shareResultOverlay'); if(!o)return;
    srLastFocus=document.activeElement;
    srHint('');
    // Le pseudo n'est JAMAIS saisi ici : il vient du compte (identité verrouillée). Affichage lecture seule.
    var idl=$('srIdentity'), name=Account.collectorName();
    if(idl){ idl.textContent = name ? ('Collectionneur : '+name.toUpperCase()+' · pseudo verrouillé') : 'Identité de collectionneur non encore créée.'; }
    o.classList.add('open');o.setAttribute('aria-hidden','false');
    document.body.classList.add('sr-lock');
    document.addEventListener('keydown',srTrapFocus,true);
    renderSharePreview();
    var c=o.querySelector('.sr-close'); if(c){try{c.focus();}catch(e){}}
  }

  // ---- Création de l'identité de collectionneur (UNE fois, double confirmation) ----
  function renderIdentityPreview(){ var cv=$('idCanvas'); if(cv){ srWithFonts(function(){ generateShareImage(cv); }); } }
  function idSyncName(){
    var inp=$('idName'), cnt=$('idCount'); if(!inp)return;
    var pos=inp.selectionStart, clean=sanitizeShareName(inp.value);
    if(clean!==inp.value){ inp.value=clean; try{inp.setSelectionRange(pos-1<0?0:pos-1,pos-1<0?0:pos-1);}catch(e){} }
    var len=clean.trim().length;
    if(cnt){ cnt.textContent=clean.length+' / 16'; cnt.classList.toggle('is-min', len>0&&len<2); }
    PREVIEW_NAME=inp.value;                    // aperçu instantané
    renderIdentityPreview();
    var b1=$('idConfirm1'); if(b1)b1.disabled=(len<2);
  }
  var _idOnLocked=null;
  function openIdentityCreation(onLocked){
    var o=$('identityOverlay'); if(!o){ if(onLocked)onLocked(); return; }
    if(Account.isLocked()){ if(onLocked)onLocked(); return; }   // sécurité : jamais de 2e création
    _idOnLocked=onLocked||null; idLastFocus=document.activeElement;
    idShowStep(1);
    var inp=$('idName'); if(inp){ inp.value=''; inp.disabled=false; }
    PREVIEW_NAME=''; idSyncName(); renderIdentityPreview();
    o.classList.add('open');o.setAttribute('aria-hidden','false');
    document.body.classList.add('sr-lock');
    document.addEventListener('keydown',idTrapFocus,true);
    if(inp){ try{inp.focus();}catch(e){} }
  }
  function closeIdentityCreation(){
    var o=$('identityOverlay'); if(!o)return;
    o.classList.remove('open');o.setAttribute('aria-hidden','true');
    PREVIEW_NAME=null;
    document.removeEventListener('keydown',idTrapFocus,true);
    if(!($('cardUnlockOverlay')&&$('cardUnlockOverlay').classList.contains('open')) && !($('shareResultOverlay')&&$('shareResultOverlay').classList.contains('open'))) document.body.classList.remove('sr-lock');
    if(idLastFocus&&idLastFocus.focus){try{idLastFocus.focus();}catch(e){}}
  }
  function idShowStep(n){
    var s1=$('idStep1'), s2=$('idStep2'); if(s1)s1.hidden=(n!==1); if(s2)s2.hidden=(n!==2);
    if(n===2){ var big=$('idBigName'), inp=$('idName'); if(big&&inp)big.textContent=(sanitizeShareName(inp.value).trim().toUpperCase()||'JOUEUR');
      var y=$('idConfirm2'); if(y){try{y.focus();}catch(e){}} }
  }
  function idTrapFocus(e){
    if(e.key!=='Tab')return; var m=$('identityModal'); if(!m)return;
    var f=[].slice.call(m.querySelectorAll('button:not([disabled]),input:not([disabled])')).filter(function(el){return el.offsetParent!==null;});
    if(!f.length)return; var first=f[0], last=f[f.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
  function idConfirmFinal(){
    var inp=$('idName'); if(!inp)return;
    var res=Account.lockCollectorName(inp.value);   // verrouillage définitif (autorité = compte/serveur)
    if(!res.ok){ var h=$('idHint2'); if(h){h.textContent=(res.error==='PSEUDO_LOCKED')?'Pseudo déjà verrouillé sur ce compte.':'Pseudo invalide (2 à 16 caractères).';} return; }
    stampOwnerNameOnCards(res.name);                // recopie ownerName sur les cartes déjà obtenues
    PREVIEW_NAME=null;
    var cb=_idOnLocked; _idOnLocked=null;
    closeIdentityCreation();
    if(cb) setTimeout(cb,150);
  }
  // ---- Déblocage de la carte du jour : animation « NOUVEL ARCHÉTYPE DÉBLOQUÉ » (une seule fois) ----
  var UNLOCK_ARCHETYPE='entree-des-gladiateurs';   // carte affichée dans l'animation de déblocage
  function renderUnlockPreview(){ var cu=$('cuCanvas'); if(!cu)return; srWithFonts(function(){
    var rec=ownedRecordForArchetype(UNLOCK_ARCHETYPE);
    if(rec) generateShareImage(cu, UNLOCK_ARCHETYPE, {result:cardResult(rec), ownerName:rec.ownerName});
    else generateShareImage(cu, UNLOCK_ARCHETYPE);
  }); }
  function showCardUnlock(archetypeId){
    if(archetypeId)UNLOCK_ARCHETYPE=archetypeId;
    var o=$('cardUnlockOverlay'); if(!o)return;
    var def=CARDS[UNLOCK_ARCHETYPE], tt=$('cuTitle'); if(tt&&def)tt.textContent=def.title;
    renderUnlockPreview();
    o.classList.add('open');o.setAttribute('aria-hidden','false');
    document.body.classList.add('sr-lock');
    var v=o.querySelector('[data-act="cu-view"]'); if(v){try{v.focus();}catch(e){}}
  }
  function hideCardUnlock(){
    var o=$('cardUnlockOverlay'); if(!o)return;
    o.classList.remove('open');o.setAttribute('aria-hidden','true');
    if(!($('shareResultOverlay')&&$('shareResultOverlay').classList.contains('open'))) document.body.classList.remove('sr-lock');
  }
  // Flux d'obtention générique : crée l'identité (double confirmation) si besoin, recopie le pseudo, puis animation.
  function unlockCardFlow(archetypeId, rewardId){
    function backfillAndShow(delay){
      var rec=CardStore.get(rewardId); if(rec && !rec.ownerName){ rec.ownerName=Account.collectorName(); var o=CardStore._read(); o[rewardId]=rec; CardStore._write(o); }
      setTimeout(function(){ showCardUnlock(archetypeId); }, delay);
    }
    if(!Account.isLocked()){
      setTimeout(function(){ openIdentityCreation(function(){ backfillAndShow(150); }); }, 500);
    } else { backfillAndShow(650); }
  }
  // Résultats à afficher pour une carte : LIVE si resultDate présent (reflète le jeu du jour), sinon snapshot figé.
  function cardResult(rec){ return (rec&&rec.resultDate) ? resultForDate(rec.resultDate) : (rec&&rec.result)||null; }
  // Récompense d'assiduité LDC — attribuée dès que 2 journées consécutives d'une semaine LDC ont été jouées.
  function checkEtoilesReward(){
    if(replay||PREVIEW) return;
    if(CardStore.has(ETOILES_REWARD_ID)) return;
    var res=awardEtoilesOnce(), id=ETOILES_REWARD_ID;
    if(res.firstTime && !CardStore.seenUnlock(id)){ CardStore.markUnlockSeen(id); unlockCardFlow('appel-des-etoiles', id); }
  }
  // Récompense « LE RITUEL » — 7 jours calendaires consécutifs terminés.
  function checkRitualReward(){
    if(replay||PREVIEW) return;
    if(CardStore.has(RITUAL_REWARD_ID)) return;
    var res=awardRitualOnce(), id=RITUAL_REWARD_ID;
    if(res.firstTime && !CardStore.seenUnlock(id)){ CardStore.markUnlockSeen(id); unlockCardFlow('le-rituel', id); }
  }
  // Appelé quand un niveau se termine : déclenche les obtentions (idempotentes) + l'animation la 1re fois.
  function maybeUnlockDailyCard(){
    if(replay||PREVIEW) return;
    // 1) Carte de BIENVENUE : Expert TROUVÉ.
    if(expertSolved()){
      var res=awardDailyCardOnce(), id=welcomeCardId();
      if(res.firstTime && !CardStore.seenUnlock(id)){
        CardStore.markUnlockSeen(id);
        unlockCardFlow('entree-des-gladiateurs', id);
        return;   // une animation à la fois ; l'éventuelle carte d'assiduité s'affichera au prochain passage
      }
    }
    // 2) Cartes d'ASSIDUITÉ : « L'Appel des Étoiles » (LDC) puis « Le Rituel » (7 jours consécutifs).
    checkEtoilesReward();
    checkRitualReward();
  }
  // ===== Galerie « Mes récompenses » : cartes obtenues (téléchargeables, non modifiables) + à débloquer (floutées) =====
  function ownedRecordForArchetype(id){ var col=CardStore._read(); for(var k in col){ if(col[k]&&col[k].archetype===id) return col[k]; } return null; }
  function cardFileName(id){ return 'jogadle-carte-'+id+'.png'; }
  function drawTile(cv,id,rec){
    srWithFonts(function(){
      var def=CARDS[id];
      function paint(){ rec ? generateShareImage(cv,id,{result:cardResult(rec),ownerName:rec.ownerName}) : generateShareImage(cv,id,{locked:true}); }
      paint();
      if(def.img && !def.ready){ def.img.addEventListener('load',paint,{once:true}); }
    });
  }
  function renderRewardsGallery(){
    var grid=$('rewardsGrid'); if(!grid)return; grid.innerHTML='';
    var owned=0, total=0;
    Object.keys(CARDS).forEach(function(id){
      total++;
      var def=CARDS[id], rec=ownedRecordForArchetype(id), isOwned=!!rec; if(isOwned)owned++;
      var tile=document.createElement('div'); tile.className='rw-tile '+(isOwned?'is-owned':'is-locked');
      var thumb=document.createElement('div'); thumb.className='rw-thumb';
      var cv=document.createElement('canvas'); thumb.appendChild(cv);
      if(!isOwned){ var lk=document.createElement('div'); lk.className='rw-lock'; lk.innerHTML='<div class="rw-lock-ic" aria-hidden="true">🔒</div><div class="rw-lock-txt">À débloquer</div>'; thumb.appendChild(lk); }
      tile.appendChild(thumb);
      // Nom : la carte obtenue montre son titre ; la carte verrouillée reste ANONYME (titre caché).
      var nm=document.createElement('div'); nm.className='rw-name';
      if(isOwned){ nm.textContent=def.title; }
      else {
        nm.appendChild(document.createTextNode('Nouvelle carte personnalisable disponible'));
        var help=document.createElement('button'); help.type='button'; help.className='rw-help'; help.setAttribute('data-act','rw-help');
        help.setAttribute('aria-label','Comment obtenir cette récompense ?'); help.setAttribute('aria-expanded','false'); help.textContent='?';
        nm.appendChild(help);
      }
      tile.appendChild(nm);
      var st=document.createElement('div'); st.className='rw-state'; st.textContent=isOwned?'Obtenue · à télécharger':'Verrouillée'; tile.appendChild(st);
      if(isOwned){ var btn=document.createElement('button'); btn.type='button'; btn.className='sr-btn sr-btn--primary'; btn.setAttribute('data-act','rw-download'); btn.setAttribute('data-card',id); btn.textContent='Télécharger ma carte'; tile.appendChild(btn); }
      else { var ht=document.createElement('div'); ht.className='rw-howto'; ht.hidden=true; ht.innerHTML='<span class="rw-howto-t">Comment l’obtenir&nbsp;?</span> '+esc(def.howTo||''); tile.appendChild(ht); }
      grid.appendChild(tile);
      drawTile(cv,id,rec);
    });
    var sub=$('rwSub'); if(sub)sub.textContent=owned+' carte'+(owned>1?'s':'')+' obtenue'+(owned>1?'s':'')+' sur '+total+' — les cartes obtenues ne sont plus modifiables.';
  }
  function openRewards(){
    var o=$('rewardsOverlay'); if(!o)return;
    rwLastFocus=document.activeElement;
    renderRewardsGallery();
    o.classList.add('open');o.setAttribute('aria-hidden','false');
    document.body.classList.add('sr-lock');
    var c=o.querySelector('.rw-close'); if(c){try{c.focus();}catch(e){}}
  }
  function closeRewards(){
    var o=$('rewardsOverlay'); if(!o)return;
    o.classList.remove('open');o.setAttribute('aria-hidden','true');
    document.body.classList.remove('sr-lock');
    if(rwLastFocus&&rwLastFocus.focus){try{rwLastFocus.focus();}catch(e){}}
  }
  // Une carte obtenue est téléchargeable autant de fois qu'on veut (jamais modifiable) — rendue depuis l'enregistrement figé.
  function downloadCard(id){
    var rec=ownedRecordForArchetype(id); if(!rec)return;
    // Même moteur d'export officiel que partout ailleurs -> PNG fond transparent (aucune capture d'écran).
    exportCardPNG(id, {result:cardResult(rec), ownerName:rec.ownerName}, function(blob){
      if(!blob)return; downloadBlobAs(blob, cardFileName(id));
    });
  }
  function closeShareResultModal(){
    var o=$('shareResultOverlay'); if(!o)return;
    o.classList.remove('open');o.setAttribute('aria-hidden','true');
    document.body.classList.remove('sr-lock');
    document.removeEventListener('keydown',srTrapFocus,true);
    if(srLastFocus&&srLastFocus.focus){try{srLastFocus.focus();}catch(e){}}
  }

  // ===================== MINUTEUR + BASCULE À MINUIT (Europe/Paris) =====================
  function parisOffsetMs(utcMs){
    try{var d=new Date(utcMs),o={};
      new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(d).forEach(function(p){o[p.type]=p.value;});
      var h=+o.hour; if(h===24)h=0;
      return Date.UTC(+o.year,+o.month-1,+o.day,h,+o.minute,+o.second)-utcMs;
    }catch(e){return 0;}
  }
  function parisMidnightEpoch(ds){var p=String(ds).split('-'),guess=Date.UTC(+p[0],+p[1]-1,+p[2],0,0,0),off=parisOffsetMs(guess),epoch=guess-off;off=parisOffsetMs(epoch);return guess-off;}
  function nextMidnightEpoch(){return parisMidnightEpoch(addDays(parisDateStr(),1));}
  var timerTarget=null, timerInt=null;
  function fmtHMS(ms){if(ms<0)ms=0;var s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;return pad2(h)+':'+pad2(m)+':'+pad2(ss);}
  function tick(){
    if(!timerTarget)timerTarget=nextMidnightEpoch();
    var rem=timerTarget-Date.now(), tv=$('timerValue'); if(tv)tv.textContent=fmtHMS(rem);
    if(rem<=0){ doRollover(); timerTarget=nextMidnightEpoch(); }
    else if(!DATE_OVERRIDE){ var real=currentParisDate(); if(real!==TODAY) doRollover(); }
  }
  function startTimer(){if(timerInt)clearInterval(timerInt);timerTarget=nextMidnightEpoch();tick();timerInt=setInterval(tick,1000);}
  function doRollover(){
    var nd=DATE_OVERRIDE?addDays(DATE_OVERRIDE,1):currentParisDate();
    if(DATE_OVERRIDE)DATE_OVERRIDE=nd;
    if(nd===TODAY)return;
    if(replay)exitReplay();
    TODAY=nd; DAILY=pickDaily(TODAY); restoreDay(TODAY); pruneOldRecent();
    token++; level='amateur'; input.value=''; setMsg(''); hideSug();
    loadLevel(); if($('yesterdayOverlay')&&$('yesterdayOverlay').classList.contains('open'))renderYdCards(); refreshCalendarIfOpen();
    timerTarget=nextMidnightEpoch();
  }

  // ===================== LES JOUEURS D'HIER =====================
  function personalResultLabel(ds,l){var r=readProg(ds,l);if(!r)return {t:'Non joué',c:'np'};if(r.status==='win')return{t:'Trouvé',c:'win'};if(r.status==='fail')return{t:'Manqué',c:'fail'};return{t:'Non joué',c:'np'};}
  function officialPicks(ds){
    var picks=pickDaily(ds),out={};
    ['amateur','pro','expert'].forEach(function(l){var r=readProg(ds,l),pl=(r&&r.qid)?findByQid(l,r.qid):null;out[l]=pl||picks[l];});
    return out;
  }
  function loadFreePhoto(img,pl){
    var src=[]; try{if(PHOTOS&&PHOTOS[pl.name])src.push(PHOTOS[pl.name]);if(PHOTOSURL&&PHOTOSURL[pl.id])src.push(PHOTOSURL[pl.id]);}catch(e){}
    var i=0; (function nx(){if(i>=src.length){img.hidden=true;return;}var u=src[i++];img.onload=function(){img.hidden=false;};img.onerror=nx;try{img.src=u;}catch(e){nx();}})();
  }
  // ---- Révélation volontaire (jamais automatique) : mémorisée par date + niveau ----
  function revKey(ds,l){return KEYNS+'revealed-'+ds+'-'+l;}
  function isRevealed(ds,l){return Store.get(revKey(ds,l))==='1';}
  function setRevealed(ds,l){Store.set(revKey(ds,l),'1');}
  function revClubs(pl){
    var c=(pl&&pl.career)||[]; if(!c.length)return '';
    return '<div class="rv-clubs">'+c.map(function(it){var club=it[0],years=it[1],logo=LOGOS[club]||'';
      return '<span class="rv-club">'+(logo?'<img src="'+logo+'" alt="">':'<i class="rv-fb">'+initials(club)+'</i>')+'<span class="rv-cn">'+esc(club)+'</span><em>'+esc(years)+'</em></span>';}).join('')+'</div>';
  }
  function loadRevPhotos(host,picks,ds){
    ['amateur','pro','expert'].forEach(function(l){ if(isRevealed(ds,l)){ var pl=picks[l], img=host.querySelector('.rv-photo[data-l="'+l+'"]'); if(img&&pl)loadFreePhoto(img,pl); } });
  }

  // ===================== PANNEAU « LES JOUEURS D'HIER » (à la demande, cartes masquées) =====================
  function ydDate(){return addDays(TODAY,-1);}
  function renderYdCards(){
    var host=$('ydCards'); if(!host)return;
    var yd=ydDate(), dl=$('ydDate'), ra=$('ydRevealAll');
    if(dateToIndex(yd)<dateToIndex(LAUNCH_DATE)){
      host.innerHTML='<div class="yd-empty">Aucune archive d’hier pour le moment — reviens demain.</div>';
      if(dl)dl.textContent=''; if(ra)ra.style.display='none'; return;
    }
    if(dl)dl.textContent=frLongDate(yd);
    var picks=officialPicks(yd);
    host.innerHTML=['amateur','pro','expert'].map(function(l){
      var lab={amateur:'AMATEUR',pro:'PRO',expert:'EXPERT'}[l];
      if(isRevealed(yd,l)){
        var pl=picks[l], res=personalResultLabel(yd,l);
        return '<div class="yd-card2 revealed"><div class="yd-c-top"><span class="yd-c-lvl">'+lab+'</span></div>'
          +'<div class="rv-in">'
            +'<img class="rv-photo rv-step yd-c-photo" data-l="'+l+'" alt="" hidden>'
            +'<div class="yd-c-name rv-step">'+(pl?esc(pl.name):'—')+'</div>'
            +'<div class="rv-step"><span class="yd-res yd-'+res.c+'">'+res.t+'</span></div>'
            +(revClubs(pl)?('<div class="rv-step">'+revClubs(pl)+'</div>'):'')
          +'</div></div>';
      }
      return '<div class="yd-card2 masked"><div class="yd-c-top"><span class="yd-c-lvl">'+lab+'</span><span class="yd-mask-badge">?</span></div>'
        +'<div class="yd-mask-actions">'
        +'<button type="button" class="yd-abtn play" data-act="yd-play" data-ds="'+yd+'" data-l="'+l+'">JOUER CETTE ARCHIVE</button>'
        +'<button type="button" class="yd-abtn reveal" data-act="yd-reveal" data-ds="'+yd+'" data-l="'+l+'">RÉVÉLER LE JOUEUR</button>'
        +'</div></div>';
    }).join('');
    loadRevPhotos(host,picks,yd);
    var allRev=['amateur','pro','expert'].every(function(l){return isRevealed(yd,l);});
    if(ra)ra.style.display=allRev?'none':'';
  }
  function openYesterday(){var o=$('yesterdayOverlay');if(!o)return;showYdConfirm(false);renderYdCards();o.classList.add('open');o.setAttribute('aria-hidden','false');document.body.classList.add('cal-open');}
  function closeYesterday(){var o=$('yesterdayOverlay');if(!o)return;o.classList.remove('open');o.setAttribute('aria-hidden','true');document.body.classList.remove('cal-open');}
  function showYdConfirm(on){var c=$('ydConfirm');if(c)c.hidden=!on;}
  function revealAllYesterday(){var yd=ydDate();['amateur','pro','expert'].forEach(function(l){setRevealed(yd,l);});showYdConfirm(false);renderYdCards();}

  // ===================== CALENDRIER DES ARCHIVES (écran séparé) =====================
  var calYM=null, calFilter='all', calDetailDate=null;
  var WD=['L','M','M','J','V','S','D'];
  function openCalendar(){var c=$('jogadleCalendar');if(!c)return;if(!calYM){var p=TODAY.split('-');calYM={y:+p[0],m:+p[1]};}renderCalendar();c.classList.add('open');c.setAttribute('aria-hidden','false');document.body.classList.add('cal-open');}
  function closeCalendar(){var c=$('jogadleCalendar');if(!c)return;c.classList.remove('open');c.setAttribute('aria-hidden','true');document.body.classList.remove('cal-open');}
  function refreshCalendarIfOpen(){var c=$('jogadleCalendar');if(c&&c.classList.contains('open'))renderCalendar();}
  function statusForCell(ds,l){if(dateToIndex(ds)>dateToIndex(TODAY))return 'future';var r=readProg(ds,l);if(r&&r.status==='win')return 'win';if(r&&r.status==='fail')return 'fail';return 'np';}
  function passesFilter(ds){
    if(calFilter==='all')return true;
    if(calFilter==='amateur'||calFilter==='pro'||calFilter==='expert')return true;
    var want={won:'win',lost:'fail',none:'np'}[calFilter];
    if(dateToIndex(ds)>dateToIndex(TODAY))return false;
    return ['amateur','pro','expert'].some(function(l){return statusForCell(ds,l)===want;});
  }
  function calShiftMonth(d){var m=calYM.m+d,y=calYM.y;while(m<1){m+=12;y--;}while(m>12){m-=12;y++;}calYM={y:y,m:m};calDetailDate=null;renderCalendar();}
  function renderCalendar(){
    var grid=$('calGrid'); if(!grid)return;
    var y=calYM.y,m=calYM.m,lab=$('calMonthLabel');
    if(lab){try{lab.textContent=new Intl.DateTimeFormat('fr-FR',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(Date.UTC(y,m-1,1))).toUpperCase();}catch(e){lab.textContent=y+'-'+pad2(m);}}
    [].forEach.call($('calFilters').children,function(b){b.classList.toggle('is-active',b.getAttribute('data-filter')===calFilter);});
    var first=new Date(Date.UTC(y,m-1,1)),fw=(first.getUTCDay()+6)%7,days=new Date(Date.UTC(y,m,0)).getUTCDate(),html='';
    WD.forEach(function(w){html+='<div class="cal-wd">'+w+'</div>';});
    for(var i=0;i<fw;i++)html+='<div class="cal-cell cal-empty"></div>';
    for(var dn=1;dn<=days;dn++){
      var ds=y+'-'+pad2(m)+'-'+pad2(dn);
      var future=dateToIndex(ds)>dateToIndex(TODAY), before=dateToIndex(ds)<dateToIndex(LAUNCH_DATE);
      var dim=(!passesFilter(ds))?' cal-dim':'';
      var cls='cal-cell'+(future?' cal-future':'')+(before?' cal-pre':'')+(ds===TODAY?' cal-today':'')+dim;
      var dots='';
      ['amateur','pro','expert'].forEach(function(l){
        if((calFilter==='amateur'||calFilter==='pro'||calFilter==='expert')&&calFilter!==l)return;
        var stt=before?'pre':(future?'future':statusForCell(ds,l));
        dots+='<span class="cal-dot cal-'+stt+'">'+l.charAt(0).toUpperCase()+'</span>';
      });
      var clickable=(!future&&!before);
      html+='<div class="'+cls+'"'+(clickable?(' data-day="'+ds+'"'):'')+'><span class="cal-num">'+dn+'</span><span class="cal-dots">'+dots+'</span></div>';
    }
    grid.innerHTML=html; renderStats();
    if(calDetailDate)openDetail(calDetailDate);
  }
  function stcell(l,v){return '<div class="cal-stat"><span class="cal-stat-v">'+v+'</span><span class="cal-stat-l">'+l+'</span></div>';}
  function renderStats(){var host=$('calStats');if(!host)return;var s=computeStats();
    host.innerHTML=stcell('Défis joués',s.played)+stcell('Réussites',s.win)+stcell('Échecs',s.fail)+stcell('Non joués',s.notplayed)+stcell('Réussite',s.rate+'%')+stcell('Série actuelle',s.streak)+stcell('Meilleure série',s.best);}
  // Choix par jour archivé : 'play' (jouer, réponses masquées) ou 'answers' (consulter les réponses -> non jouable).
  function archiveChoiceKey(ds){return KEYNS+'archive-choice-'+ds;}
  function getArchiveChoice(ds){var v=Store.get(archiveChoiceKey(ds));return (v==='play'||v==='answers')?v:null;}
  function setArchiveChoice(ds,v){ if(v!=='play'&&v!=='answers')return;
    Store.set(archiveChoiceKey(ds),v);
    if(v==='answers'){ ['amateur','pro','expert'].forEach(function(l){ setRevealed(ds,l); }); }  // consulter = révéler les 3 niveaux
  }
  function openDetail(ds){
    calDetailDate=ds; var host=$('calDetail'); if(!host)return;
    var isToday=(ds===TODAY), isPast=dateToIndex(ds)<dateToIndex(TODAY), picks=isPast?officialPicks(ds):null;
    var h='<div class="cal-detail-head"><span>'+frLongDate(ds)+'</span><span class="cal-detail-sub">'+(isToday?'Journée en cours':(isPast?'Journée archivée':'À venir'))+'</span></div>';

    if(isPast){
      var attempted3=['amateur','pro','expert'].some(function(l){var s=statusForCell(ds,l);return s==='win'||s==='fail';});
      var choice=getArchiveChoice(ds); if(!choice && attempted3) choice='play';   // déjà joué autrefois -> mode jeu
      if(!choice){
        // ---- PROPOSITION : jouer OU consulter les réponses (exclusif) ----
        h+='<div class="cal-choice">'
          +'<p class="cal-choice-q">Comment veux-tu aborder ce défi archivé&nbsp;?</p>'
          +'<div class="cal-choice-actions">'
          +'<button type="button" class="cal-choice-btn play" data-archmode="play|'+ds+'"><b>Jouer le défi</b><span>Réponses masquées</span></button>'
          +'<button type="button" class="cal-choice-btn answers" data-archmode="answers|'+ds+'"><b>Consulter les réponses</b><span>Défi alors non jouable</span></button>'
          +'</div>'
          +'<p class="cal-choice-note">Si tu consultes les réponses, tu ne pourras plus jouer ce défi.</p>'
          +'</div>';
        host.innerHTML=h; host.hidden=false; return;
      }
      var answersMode=(choice==='answers');
      ['amateur','pro','expert'].forEach(function(l){
        var lab={amateur:'AMATEUR',pro:'PRO',expert:'EXPERT'}[l], stt=statusForCell(ds,l), attempted=(stt==='win'||stt==='fail');
        var badge='<span class="cal-badge cal-'+stt+'">'+({win:'Réussi',fail:'Manqué',np:'Non joué',future:'À venir'}[stt])+'</span>';
        var main, actions;
        if(answersMode){
          var pl=picks[l], res=personalResultLabel(ds,l);
          main='<div class="rv-in cal-rv">'
            +'<img class="rv-photo rv-step cal-rv-photo" data-l="'+l+'" alt="" hidden>'
            +'<div class="cal-rv-name rv-step">'+(pl?esc(pl.name):'—')+'</div>'
            +'<div class="rv-step"><span class="cal-rv-res yd-'+res.c+'">'+res.t+'</span> <span class="cal-rv-note">Réponse consultée</span></div>'
            +(revClubs(pl)?('<div class="rv-step">'+revClubs(pl)+'</div>'):'')
            +'</div>';
          actions='<span class="cal-mini-note">Défi verrouillé (réponse consultée)</span>';
        } else {
          main='<span class="cal-detail-name cal-locked">Réponse masquée</span>';
          actions='<button type="button" class="cal-mini-btn" data-replay="'+ds+'|'+l+'">'+(attempted?'Rejouer':'Jouer')+'</button>';
        }
        h+='<div class="cal-detail-row"><span class="cal-detail-lvl">'+lab+'</span><div class="cal-detail-main">'+main+'</div>'+badge+'<div class="cal-detail-actions">'+actions+'</div></div>';
      });
      host.innerHTML=h; host.hidden=false;
      loadRevPhotos(host,picks,ds);
      return;
    }

    // ---- Journée en cours (aujourd'hui) : réponse cachée, on joue le niveau ----
    ['amateur','pro','expert'].forEach(function(l){
      var lab={amateur:'AMATEUR',pro:'PRO',expert:'EXPERT'}[l], stt=statusForCell(ds,l), attempted=(stt==='win'||stt==='fail');
      var badge='<span class="cal-badge cal-'+stt+'">'+({win:'Réussi',fail:'Manqué',np:'Non joué',future:'À venir'}[stt])+'</span>';
      var main='<span class="cal-detail-name cal-locked">Caché aujourd’hui</span>';
      var actions='<button type="button" class="cal-mini-btn" data-playtoday="'+l+'">'+(attempted?'Revoir':'Jouer')+'</button>';
      h+='<div class="cal-detail-row"><span class="cal-detail-lvl">'+lab+'</span><div class="cal-detail-main">'+main+'</div>'+badge+'<div class="cal-detail-actions">'+actions+'</div></div>';
    });
    host.innerHTML=h; host.hidden=false;
  }

  // ===================== REJOUER UNE ARCHIVE (n'affecte ni série ni stats) =====================
  var replay=false, replaySnap=null, replayInfo=null;
  function enterReplay(ds,l){
    var pl=officialPicks(ds)[l]; if(!pl)return;
    replaySnap={level:level,finished:finished,dailyPl:DAILY[l],state:S[l],lvl:l};
    replay=true; replayInfo={date:ds,level:l};
    DAILY[l]=pl; S[l]=newState(l); finished=false; level=l;
    closeCalendar(); closeYesterday();
    var note=isRevealed(ds,l)?' · Réponse déjà consultée — partie hors statistiques':'';
    var b=$('replayBanner'); if(b){b.hidden=false;var t=$('replayBannerText');if(t)t.textContent='Partie d’archive · '+frLongDate(ds)+' — n’affecte ni ta série ni tes statistiques'+note;}
    if(resultEl)resultEl.classList.add('is-replay');
    loadLevel(); try{window.scrollTo({top:0,behavior:'smooth'});}catch(e){}
  }
  function exitReplay(){
    var b=$('replayBanner'); if(b)b.hidden=true;
    if(resultEl)resultEl.classList.remove('is-replay');
    if(!replaySnap){replay=false;return;}
    DAILY[replaySnap.lvl]=replaySnap.dailyPl; S[replaySnap.lvl]=replaySnap.state;
    level=replaySnap.level; finished=replaySnap.finished;
    replay=false; replayInfo=null; replaySnap=null;
    loadLevel();
  }

  // ===================== MODE TEST — RÉINITIALISER LA PARTIE (jamais présent en PROD) =====================
  // Efface UNIQUEMENT la sauvegarde de la partie de test du jour (clés isolées « jogadle-test-… »),
  // ferme les fenêtres de résultat, puis recharge à zéro. Même date + joueurs TESTFIX => MÊME joueur mystère.
  // Ne supprime jamais tout le localStorage, ne touche pas aux stats réelles, au tirage ni au pool.
  function resetTestGame(){
    if(BUILD_MODE!=='test')return;   // garde-fou : inopérant hors build test
    try{
      // Ferme d'éventuelles fenêtres/superpositions (résultat, partage, calendrier, récompenses, etc.)
      ['shareResultOverlay','cardUnlockOverlay','rewardsOverlay','jogadleCalendar','yesterdayOverlay','identityOverlay','browseOverlay'].forEach(function(id){var o=$(id);if(o){o.classList.remove('open');o.setAttribute('aria-hidden','true');}});
      try{document.body.classList.remove('sr-lock','cal-open');}catch(e){}
      // Efface SEULEMENT la sauvegarde de cette partie de test (aujourd'hui) — jamais le reste du localStorage
      ['amateur','pro','expert'].forEach(function(l){ try{Store.remove(progKey(TODAY,l));}catch(e){} try{Store.remove(revKey(TODAY,l));}catch(e){} });
      try{Store.remove(archiveChoiceKey(TODAY));}catch(e){}
    }catch(e){}
    location.reload();   // rechargement immédiat à zéro ; le tirage du jour (TESTFIX) reste identique
  }

  // ===================== INITIALISATION DU SYSTÈME QUOTIDIEN =====================
  function initDaily(){
    migrateOld(); restoreDay(TODAY); pruneOldRecent();
    document.addEventListener('click',function(e){
      var t=e.target.closest('[data-act]'); if(!t)return; var a=t.getAttribute('data-act');
      if(a==='share'){e.preventDefault();openShareResultModal();}
      else if(a==='sr-close'){e.preventDefault();closeShareResultModal();}
      else if(a==='cu-close'){e.preventDefault();hideCardUnlock();}
      else if(a==='cu-view'){e.preventDefault();hideCardUnlock();openRewards();}
      else if(a==='open-rewards'){e.preventDefault();openRewards();}
      else if(a==='rw-close'){e.preventDefault();closeRewards();}
      else if(a==='rw-download'){e.preventDefault();downloadCard(t.getAttribute('data-card'));}
      else if(a==='rw-help'){e.preventDefault();var _tl=t.closest('.rw-tile'),_h=_tl&&_tl.querySelector('.rw-howto');if(_h){_h.hidden=!_h.hidden;t.setAttribute('aria-expanded',_h.hidden?'false':'true');t.classList.toggle('is-on',!_h.hidden);}}
      else if(a==='id-confirm1'){e.preventDefault();var _i=$('idName');if(_i&&sanitizeShareName(_i.value).trim().length>=2)idShowStep(2);}
      else if(a==='id-back'){e.preventDefault();idShowStep(1);var _i2=$('idName');if(_i2){try{_i2.focus();}catch(_e){}}}
      else if(a==='id-confirm2'){e.preventDefault();idConfirmFinal();}
      else if(a==='sr-share'){e.preventDefault();shareResultImage();}
      else if(a==='sr-download'){e.preventDefault();downloadShareImage();}
      else if(a==='sr-copy'){e.preventDefault();copyResultText();}
      else if(a==='next-level'){e.preventDefault();nextLevel();}
      else if(a==='open-cal'){e.preventDefault();openCalendar();}
      else if(a==='close-cal'){e.preventDefault();closeCalendar();}
      else if(a==='cal-prev'){e.preventDefault();calShiftMonth(-1);}
      else if(a==='cal-next'){e.preventDefault();calShiftMonth(1);}
      else if(a==='exit-replay'){e.preventDefault();exitReplay();}
      else if(a==='browse-open'){e.preventDefault();openBrowse();}
      else if(a==='browse-close'){e.preventDefault();closeBrowse();}
      else if(a==='open-yesterday'){e.preventDefault();openYesterday();}
      else if(a==='yd-close'){e.preventDefault();closeYesterday();}
      else if(a==='yd-reveal'){e.preventDefault();setRevealed(t.getAttribute('data-ds'),t.getAttribute('data-l'));renderYdCards();}
      else if(a==='yd-play'){e.preventDefault();enterReplay(t.getAttribute('data-ds'),t.getAttribute('data-l'));}
      else if(a==='yd-confirm'){e.preventDefault();showYdConfirm(true);}
      else if(a==='yd-cancel'){e.preventDefault();showYdConfirm(false);}
      else if(a==='yd-revealall'){e.preventDefault();revealAllYesterday();}
    });
    var cf=$('calFilters'); if(cf)cf.addEventListener('click',function(e){var b=e.target.closest('[data-filter]');if(!b)return;calFilter=b.getAttribute('data-filter');renderCalendar();});
    var cg=$('calGrid'); if(cg)cg.addEventListener('click',function(e){var d=e.target.closest('[data-day]');if(!d)return;openDetail(d.getAttribute('data-day'));});
    var cd=$('calDetail'); if(cd)cd.addEventListener('click',function(e){
      var am=e.target.closest('[data-archmode]'); if(am){var q=am.getAttribute('data-archmode').split('|');setArchiveChoice(q[1],q[0]);openDetail(q[1]);return;}
      var rv=e.target.closest('[data-reveal]'); if(rv){var w=rv.getAttribute('data-reveal').split('|');setRevealed(w[0],w[1]);openDetail(w[0]);return;}
      var r=e.target.closest('[data-replay]'); if(r){var v=r.getAttribute('data-replay').split('|');enterReplay(v[0],v[1]);return;}
      var pj=e.target.closest('[data-playtoday]'); if(pj){closeCalendar();setLevel(pj.getAttribute('data-playtoday'));}
    });
    document.addEventListener('keydown',function(e){if(e.key==='Escape'){var rw=$('rewardsOverlay');if(rw&&rw.classList.contains('open')){closeRewards();return;}var cu=$('cardUnlockOverlay');if(cu&&cu.classList.contains('open')){hideCardUnlock();return;}var sr=$('shareResultOverlay');if(sr&&sr.classList.contains('open')){closeShareResultModal();return;}var c=$('jogadleCalendar');if(c&&c.classList.contains('open'))closeCalendar();var o=$('browseOverlay');if(o&&o.classList.contains('open'))closeBrowse();var yo=$('yesterdayOverlay');if(yo&&yo.classList.contains('open'))closeYesterday();}});
    var _sro=$('shareResultOverlay'); if(_sro)_sro.addEventListener('click',function(e){ if(e.target===_sro)closeShareResultModal(); });
    var _cuo=$('cardUnlockOverlay'); if(_cuo)_cuo.addEventListener('click',function(e){ if(e.target===_cuo)hideCardUnlock(); });
    var _rwo=$('rewardsOverlay'); if(_rwo)_rwo.addEventListener('click',function(e){ if(e.target===_rwo)closeRewards(); });
    var _idn=$('idName'); if(_idn){ _idn.addEventListener('input',idSyncName); _idn.addEventListener('blur',function(){ if(_idn.value!==_idn.value.trim()){ _idn.value=_idn.value.trim(); idSyncName(); } }); }
    // MODE TEST uniquement : câblage du bouton « Réinitialiser la partie » (le bouton n'existe pas en PROD).
    if(BUILD_MODE==='test'){ try{document.body.classList.add('jog-testmode');}catch(e){} var _rtb=$('__resetTestBtn'); if(_rtb) _rtb.addEventListener('click',function(e){e.preventDefault();resetTestGame();}); window.__jogadleTestReset=resetTestGame; }
    startTimer();
  }
  // Débogage manuel (console) : forcer une date, provoquer un passage de minuit, lire stats.
  window.__jogadleDaily={pick:pickDaily,parisDate:parisDateStr,today:function(){return TODAY;},rollover:doRollover,stats:computeStats,share:buildShareText,streak:currentStreak,
    reveal:isRevealed,setReveal:setRevealed,enterReplay:enterReplay,exitReplay:exitReplay,isReplay:function(){return replay;},
    setDate:function(d){DATE_OVERRIDE=d;TODAY=currentParisDate();DAILY=pickDaily(TODAY);restoreDay(TODAY);token++;level='amateur';loadLevel();refreshCalendarIfOpen();return DAILY;}};
  // ============================================================================
  //  JOGADLE SERVER — INTERFACE CENTRALE (façade). Frontière unique COMPTE / DAILY /
  //  COLLECTION pour le reste du jeu. Aujourd'hui : délègue aux modules locaux via le
  //  Store adapter (localStorage). Demain : MÊMES signatures branchées sur l'API TomsoFoot
  //  (versions Promise + hydratation au login). Le jeu ignore l'origine des données.
  // ============================================================================
  var JogadleServer={
    backend:function(){ return Store.backend; },
    // --- ACCOUNT (identité utilisateur) ---
    getCurrentUser:function(){ return { userId:Account.userId() }; },
    getCollectorIdentity:function(){ return Account.read(); },
    lockCollectorIdentity:function(name){ return Account.lockCollectorName(name); },   // déjà verrouillé -> {ok:false,error:'PSEUDO_LOCKED'}
    // --- DAILY STATE (progression quotidienne) ---
    getDailyProgress:function(ds){ ds=ds||TODAY; return { date:ds, amateur:readProg(ds,'amateur'), pro:readProg(ds,'pro'), expert:readProg(ds,'expert') }; },
    saveDailyProgress:function(ds,level,obj){ writeProg(ds||TODAY,level,obj); return true; },
    hasCompletedDailyChallenge:function(ds){ ds=ds||TODAY; return ['amateur','pro','expert'].every(function(l){var r=readProg(ds,l);return !!(r&&(r.status==='win'||r.status==='fail'));}); },
    completeDailyChallenge:function(){ return getVerifiedShareResult(); },              // résultat officiel figé (Object.freeze)
    // --- COLLECTION (cartes possédées) ---
    getCollection:function(){ return CardStore._read(); },
    hasCard:function(id){ return CardStore.has(id||welcomeCardId()); },
    awardCardOnce:function(){ return awardDailyCardOnce(); },                            // carte de bienvenue, idempotent (garde applicative ; unicité DURE = serveur : userId+rewardId)
    getCard:function(id){ return CardStore.get(id||welcomeCardId()); },
    welcomeRewardId:function(){ return WELCOME_REWARD_ID; },
    hasWelcomeCard:function(){ return CardStore.has(WELCOME_REWARD_ID); },
    // --- Récompense d'assiduité LDC « L'Appel des Étoiles » ---
    clWeeks:function(){ return CL_WEEKS; },
    participatedOn:function(ds){ return participatedOn(ds); },
    checkEtoiles:function(){ return awardEtoilesOnce(); },
    hasEtoilesCard:function(){ return CardStore.has(ETOILES_REWARD_ID); },
    // --- Récompense « Le Rituel » (7 jours consécutifs) ---
    completedDayOfficial:function(ds){ return completedDayOfficial(ds); },
    ritualStreak:function(){ return ritualStreak(); },
    ritualUnlockDate:function(){ return ritualUnlockDate(); },
    checkRitual:function(){ return awardRitualOnce(); },
    hasRitualCard:function(){ return CardStore.has(RITUAL_REWARD_ID); }
  };
  window.__jogadleServer=JogadleServer;
  window.__jogadleBuild={mode:BUILD_MODE,storageBackend:Store.backend,testfix:TESTFIX};

  // Utilitaires de partage exposés (aperçu / débogage / tests) — ne révèlent aucune donnée du jour.
  window.__jogadleShare={open:openShareResultModal,close:closeShareResultModal,text:buildResultText,outcome:levelOutcome,challenge:challengeNumber,file:srFileName,
    attempts:function(){return (S[level]||{}).attempts||0;}, level:function(){return level;}, clueAvail:function(k){return clueAvailable(k);},
    sanitize:sanitizeShareName,cardName:cardDisplayName,verified:getVerifiedShareResult,
    award:awardDailyCardOnce,hasCard:hasDailyCard,cardId:welcomeCardId,welcomeId:welcomeCardId,complete:dailyComplete,expertSolved:expertSolved,store:CardStore,
    identity:{ locked:function(){return Account.isLocked();}, name:function(){return Account.collectorName();}, read:function(){return Account.read();},
      openCreate:openIdentityCreation, requestChange:function(){return Account.requestUserChange();} },
    dims:function(id){var d=cardDef(id);return {w:(d.img&&d.img.naturalWidth)||d.w,h:(d.img&&d.img.naturalHeight)||d.h,ready:d.ready};},
    cards:function(){return Object.keys(CARDS);}, active:function(){return ACTIVE_CARD;},
    setActive:function(id){ if(CARDS[id]){ACTIVE_CARD=id;renderSharePreview();} return ACTIVE_CARD; },
    preview:function(id,name,canvasEl){ PREVIEW_NAME=(name===undefined?PREVIEW_NAME:name); return generateShareImage(canvasEl||$('srCanvas'), id); },
    exportPNG:function(id,data,cb){ return exportCardPNG(id,data||{},cb); },  // moteur d'export officiel (fond transparent)
    downloadCard:function(id){ return downloadCard(id); },
    // Métriques réelles du pseudo (mesure de la vraie police) — pour vérifier largeur/ligne unique.
    pseudoMetrics:function(id,name){
      var N=cardDef(id).name, nm=sanitizeShareName(name).trim(); if(nm.length<2)nm='JOUEUR'; nm=nm.toUpperCase();
      var ctx=document.createElement('canvas').getContext('2d'); ctx.textAlign='center';ctx.textBaseline='middle';
      var size=N.max, ls=4;
      function w(sz,l){ ctx.font='700 '+sz+'px "Barlow Condensed","Archivo Black",sans-serif'; try{ctx.letterSpacing=l+'px';}catch(e){} return ctx.measureText(nm).width; }
      while(size>N.min && w(size,ls)>N.maxw){ size-=1; }
      if(w(size,ls)>N.maxw){ while(ls>0 && w(size,ls)>N.maxw){ ls-=0.5; } }
      return { name:nm, fontSize:size, letterSpacing:ls, width:Math.round(w(size,ls)), maxw:N.maxw, cx:N.cx, cy:N.cy, min:N.min, max:N.max };
    }};
  // Correction ADMIN uniquement (hors interface joueur) : historique complet.
  window.__jogadleAdmin={ correctCollectorName:function(name,reason,adminId){return Account.adminCorrect(name,reason,adminId);}, identityHistory:function(){return Account.history();} };

  initDaily();
  loadLevel();
  // Filet de sécurité : une carte possédée sans identité (ex. rechargement pendant la création) -> reproposer la création.
  try{ if(hasDailyCard() && !Account.isLocked()) setTimeout(function(){ openIdentityCreation(); },500); }catch(e){}
  // Récompenses d'assiduité : si les conditions sont déjà remplies (LDC 2 jours, ou 7 jours consécutifs), attribuer au chargement.
  try{ setTimeout(function(){ checkEtoilesReward(); checkRitualReward(); }, 900); }catch(e){}
})();
'''.replace("__DATA__",DATA).replace("__SHARECARD_URI__",SHARECARD_URI).replace("__SHARECARD_URI_ETOILES__",SHARECARD_URI_ETOILES).replace("__SHARECARD_URI_RITUEL__",SHARECARD_URI_RITUEL).replace("__TESTFIX__",TESTFIX_JS).replace("__BUILD_MODE__",BUILD_MODE)

levelbtns=""
for lid,lname,ldesc in [("amateur","AMATEUR","Tous les clubs visibles"),("pro","PRO","1er et dernier visibles"),("expert","EXPERT","Premier club visible")]:
    levelbtns+=f'<button type="button" class="level-button" data-level="{lid}"><span class="level-button-name">{lname}</span><span class="level-button-description">{ldesc}</span></button>'

daily_css='''
/* ================= SYSTÈME QUOTIDIEN — minuteur, partage, calendrier, hier ================= */
.daily-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  margin:14px auto 4px;max-width:760px;padding:12px 18px;border-radius:16px;
  background:linear-gradient(180deg,rgba(178,60,255,.10),rgba(255,255,255,.02));
  border:1px solid rgba(207,118,255,.30);box-shadow:0 0 22px rgba(178,60,255,.14),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(8px)}
.daily-timer{display:flex;flex-direction:column;gap:3px}
.dt-line{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.dt-label{font-size:.72rem;letter-spacing:.22em;color:rgba(255,255,255,.66);font-weight:600}
.dt-value{font-size:1.42rem;font-weight:700;letter-spacing:.06em;color:#fff;font-variant-numeric:tabular-nums;
  text-shadow:0 0 16px rgba(178,60,255,.55)}
.dt-sub{font-size:.66rem;letter-spacing:.14em;color:rgba(255,255,255,.42)}
.daily-cal-link{cursor:pointer;border:1px solid rgba(207,118,255,.42);background:rgba(178,60,255,.08);color:#eadcff;
  padding:9px 15px;border-radius:11px;font:inherit;font-size:.72rem;font-weight:600;letter-spacing:.14em;
  display:inline-flex;align-items:center;gap:8px;transition:all .18s ease}
.daily-cal-link:hover{background:rgba(178,60,255,.20);border-color:rgba(207,118,255,.8);transform:translateY(-1px)}
.dcl-ic{font-size:.9rem;opacity:.85}

/* ============ Écran final simple : photo agrandie (sans zoom/recadrage) + bloc remonté ============ */
.result-reveal{display:flex;flex-direction:column;align-items:center}
.result-reveal-message{margin:0 0 8px}
.result-player-name{margin:0 0 16px}
.result-player-photo-frame{width:clamp(200px,13vw,240px);height:clamp(290px,28vh,330px);display:flex;align-items:center;justify-content:center;
  overflow:hidden;border-radius:18px;margin:0 auto;position:relative;
  border:1px solid rgba(178,60,255,.5);background:linear-gradient(180deg,rgba(178,60,255,.10),rgba(16,11,24,.72));
  box-shadow:0 16px 40px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06)}
.result-player-photo{width:100%;height:100%;object-fit:contain;object-position:center bottom;transform:none;
  border:0!important;box-shadow:none!important;border-radius:0!important;max-width:none!important;max-height:none!important;margin:0!important;display:block}
.result-photo-fallback{width:58%;height:58%;color:rgba(207,150,255,.5);display:flex;align-items:center;justify-content:center}
.result-photo-fallback svg{width:100%;height:100%}
.result-player-photo:not([hidden]) ~ .result-photo-fallback{display:none}
/* Repère de dimensions sous le cadre photo — visible UNIQUEMENT en MODE TEST (aide à la création) */
.photo-dims-hint{display:none;margin:9px auto 0;max-width:280px;text-align:center;font:600 .72rem/1.35 Inter,Arial,sans-serif;
  color:rgba(207,150,255,.85);background:rgba(178,60,255,.10);border:1px dashed rgba(207,118,255,.4);border-radius:9px;padding:6px 10px;letter-spacing:.01em}
.photo-dims-hint b{color:#fff;font-weight:800}
body.jog-testmode .photo-dims-hint{display:block}
/* Remonte le bloc de félicitations dans la bande centrale libre (entre les indices latéraux) — bureau, hors Expert */
@media(min-width:721px){ .game-result:not(.is-expert){margin-top:-96px} }
@media(max-width:700px){ .result-player-photo-frame{width:min(190px,62vw);height:min(270px,36vh)} }
/* Actions de résultat (remplace la vidéo) */
.result-actions{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin:18px auto 4px;max-width:640px}
.game-result:not(.show) .result-actions{display:none}
.game-result.is-replay #resultActions{display:none}
.game-result.is-expert #resultActions{display:none}   /* Expert : actions intégrées dans le panneau droit EA */
.rds-action{cursor:pointer;font:inherit;font-weight:700;letter-spacing:.13em;font-size:.78rem;
  padding:14px 22px;border-radius:13px;display:inline-flex;align-items:center;gap:10px;transition:all .18s ease}
.ra-ic{font-size:1rem}
.rds-action--share{color:#fff;border:1px solid rgba(255,78,101,.6);
  background:linear-gradient(180deg,#ff5a70,#e0344b);box-shadow:0 10px 26px rgba(255,78,101,.34),inset 0 1px 0 rgba(255,255,255,.28)}
.rds-action--share:hover{transform:translateY(-2px);box-shadow:0 14px 32px rgba(255,78,101,.46)}
.rds-action--cal{color:#eadcff;border:1px solid rgba(207,118,255,.52);
  background:linear-gradient(180deg,rgba(178,60,255,.16),rgba(255,255,255,.03));box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.rds-action--cal:hover{transform:translateY(-2px);background:rgba(178,60,255,.26);border-color:rgba(207,118,255,.85)}

/* ===== Historique instantané : joueurs déjà proposés (mauvaises réponses) ===== */
.used-players{width:min(660px,100%);margin:14px auto 0;padding:12px 16px 14px;border-radius:14px;
  border:1px solid rgba(207,118,255,.24);background:linear-gradient(180deg,rgba(178,60,255,.07),rgba(255,255,255,.015));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05);animation:upIn .25s ease}
@keyframes upIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.used-players[hidden]{display:none}
.up-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:13px}
.up-title{font:800 .88rem/1.2 "Barlow Condensed",sans-serif;letter-spacing:.18em;text-transform:uppercase;color:var(--violet-light)}
.up-count{font-size:.68rem;font-weight:700;color:rgba(255,255,255,.42)}
.up-list{display:flex;flex-wrap:wrap;gap:10px}
.up-chip{display:inline-flex;align-items:center;gap:9px;padding:8px 16px;border-radius:999px;
  border:1px solid rgba(255,120,140,.34);background:linear-gradient(180deg,rgba(255,78,101,.14),rgba(255,78,101,.05));
  color:#ffd7dd;font-size:1.11rem;font-weight:600;letter-spacing:.01em}
.up-chip::before{content:"✕";font-size:.97rem;font-weight:800;color:#ff6b80;opacity:.9}

/* Bouton « Niveau suivant » — apparaît sur le résultat Amateur/Pro, volontairement distinct des pastilles de niveau (vert émeraude vs violet) */
.next-level-cta{margin:22px auto 2px;cursor:pointer;font:inherit;color:#04120c;font-weight:900;letter-spacing:.02em;
  display:inline-flex;align-items:center;gap:16px;padding:16px 30px 16px 34px;border-radius:16px;border:1px solid rgba(120,255,196,.75);
  background:linear-gradient(180deg,#4fffb0,#12d98a 52%,#06b877);
  box-shadow:0 14px 34px rgba(9,220,140,.42),0 0 0 4px rgba(18,217,138,.14),inset 0 1px 0 rgba(255,255,255,.5);
  transition:transform .16s ease,box-shadow .18s ease,filter .16s ease;animation:nlcPulse 2.4s ease-in-out infinite}
.next-level-cta[hidden]{display:none}
.next-level-cta .nlc-text{display:flex;flex-direction:column;align-items:flex-start;line-height:1.05}
.next-level-cta .nlc-kicker{font-size:.62rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase;opacity:.72}
.next-level-cta .nlc-target{font-family:"Archivo Black",sans-serif;font-size:1.12rem;letter-spacing:.02em}
.next-level-cta .nlc-arrow{font-size:1.5rem;font-weight:900;transition:transform .18s ease}
.next-level-cta:hover{transform:translateY(-2px);filter:brightness(1.05);box-shadow:0 18px 42px rgba(9,220,140,.52),0 0 0 5px rgba(18,217,138,.2),inset 0 1px 0 rgba(255,255,255,.55)}
.next-level-cta:hover .nlc-arrow{transform:translateX(4px)}
.next-level-cta:active{transform:translateY(0)}
@keyframes nlcPulse{0%,100%{box-shadow:0 14px 34px rgba(9,220,140,.42),0 0 0 4px rgba(18,217,138,.12),inset 0 1px 0 rgba(255,255,255,.5)}50%{box-shadow:0 16px 40px rgba(9,220,140,.5),0 0 0 7px rgba(18,217,138,.05),inset 0 1px 0 rgba(255,255,255,.5)}}
@media(prefers-reduced-motion:reduce){.next-level-cta{animation:none}}

/* Les joueurs d'hier */
.yesterday-panel{max-width:760px;margin:10px auto 0;padding:16px 18px;border-radius:16px;
  background:linear-gradient(180deg,rgba(13,9,19,.9),rgba(21,16,28,.72));border:1px solid rgba(207,118,255,.24);
  box-shadow:0 18px 44px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.05)}
.yd-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.yd-title{font-size:.82rem;font-weight:700;letter-spacing:.2em;color:#fff}
.yd-date{font-size:.68rem;letter-spacing:.12em;color:rgba(255,255,255,.44)}
.yd-body{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.yd-card{display:flex;gap:11px;align-items:center;padding:10px;border-radius:12px;
  background:rgba(255,255,255,.03);border:1px solid rgba(207,118,255,.18)}
.yd-photo{width:52px;height:52px;border-radius:10px;object-fit:cover;object-position:top center;
  background:rgba(178,60,255,.12);border:1px solid rgba(207,118,255,.28);flex:0 0 auto}
.yd-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
.yd-level{font-size:.6rem;letter-spacing:.16em;color:rgba(255,255,255,.5);font-weight:600}
.yd-name{font-size:.86rem;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.yd-res{font-size:.64rem;letter-spacing:.08em;font-weight:600}
.yd-win{color:#25d47a}.yd-fail{color:#ff4e65}.yd-np{color:#c88cff}

/* Overlay calendrier */
.cal-overlay{position:fixed;inset:0;z-index:120;display:flex;align-items:flex-start;justify-content:center;
  padding:38px 16px;background:rgba(2,1,6,.82);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity .22s ease;overflow:auto}
.cal-overlay.open{opacity:1;pointer-events:auto}
body.cal-open{overflow:hidden}
.cal-modal{width:100%;max-width:780px;border-radius:22px;padding:22px 22px 26px;
  background:linear-gradient(180deg,#0f0a17 0%,#140f1d 60%,#0d0912 100%);
  border:1px solid rgba(207,118,255,.34);box-shadow:0 40px 90px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.06);
  transform:translateY(10px);transition:transform .22s ease}
.cal-overlay.open .cal-modal{transform:none}
.cal-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.cal-title{font-size:1rem;font-weight:700;letter-spacing:.24em;color:#fff}
.cal-close{cursor:pointer;width:34px;height:34px;border-radius:9px;border:1px solid rgba(207,118,255,.34);
  background:rgba(178,60,255,.08);color:#eadcff;font-size:.9rem;transition:all .16s ease}
.cal-close:hover{background:rgba(255,78,101,.18);border-color:rgba(255,78,101,.55)}
.cal-nav{display:flex;align-items:center;justify-content:center;gap:18px;margin-bottom:14px}
.cal-arrow{cursor:pointer;width:36px;height:36px;border-radius:10px;border:1px solid rgba(207,118,255,.34);
  background:rgba(178,60,255,.08);color:#eadcff;font-size:1.2rem;line-height:1;transition:all .16s ease}
.cal-arrow:hover{background:rgba(178,60,255,.22);border-color:rgba(207,118,255,.8)}
.cal-month{font-size:.92rem;font-weight:700;letter-spacing:.16em;color:#fff;min-width:180px;text-align:center}
.cal-filters{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:16px}
.cal-filters button{cursor:pointer;font:inherit;font-size:.68rem;font-weight:600;letter-spacing:.08em;
  padding:7px 13px;border-radius:20px;border:1px solid rgba(207,118,255,.28);background:rgba(255,255,255,.03);color:rgba(255,255,255,.72);transition:all .16s ease}
.cal-filters button:hover{border-color:rgba(207,118,255,.7);color:#fff}
.cal-filters button.is-active{background:linear-gradient(180deg,rgba(178,60,255,.34),rgba(178,60,255,.16));color:#fff;border-color:rgba(207,118,255,.85)}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:7px}
.cal-wd{text-align:center;font-size:.64rem;letter-spacing:.1em;color:rgba(255,255,255,.4);font-weight:600;padding-bottom:4px}
.cal-cell{position:relative;min-height:58px;border-radius:10px;padding:6px 5px 5px;
  background:rgba(255,255,255,.028);border:1px solid rgba(207,118,255,.14);display:flex;flex-direction:column;justify-content:space-between}
.cal-cell[data-day]{cursor:pointer;transition:all .14s ease}
.cal-cell[data-day]:hover{border-color:rgba(207,118,255,.7);background:rgba(178,60,255,.12);transform:translateY(-1px)}
.cal-empty{background:transparent;border:0}
.cal-today{border-color:rgba(255,78,101,.6);box-shadow:0 0 0 1px rgba(255,78,101,.4),0 0 16px rgba(255,78,101,.22)}
.cal-future,.cal-pre{opacity:.4}
.cal-dim{opacity:.24}
.cal-num{font-size:.72rem;font-weight:600;color:rgba(255,255,255,.66)}
.cal-dots{display:flex;gap:3px}
.cal-dot{flex:1;text-align:center;font-size:.56rem;font-weight:700;color:rgba(255,255,255,.9);
  border-radius:5px;padding:2px 0;letter-spacing:.02em}
.cal-dot.cal-win{background:rgba(37,212,122,.9);color:#04160c}
.cal-dot.cal-fail{background:rgba(255,78,101,.9);color:#1c0206}
.cal-dot.cal-np{background:rgba(178,60,255,.55);color:#150422}
.cal-dot.cal-future,.cal-dot.cal-pre{background:rgba(255,255,255,.12);color:rgba(255,255,255,.5)}
.cal-legend{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin:16px 0 6px;font-size:.66rem;color:rgba(255,255,255,.6)}
.cal-legend span{display:inline-flex;align-items:center;gap:6px}
.cal-legend .lg{width:11px;height:11px;border-radius:3px;display:inline-block}
.cal-legend .lg.win{background:#25d47a}.cal-legend .lg.fail{background:#ff4e65}
.cal-legend .lg.np{background:#b23cff}.cal-legend .lg.future{background:rgba(255,255,255,.22)}
.cal-detail{margin-top:14px;padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.03);border:1px solid rgba(207,118,255,.24)}
.cal-detail-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px}
.cal-detail-head span:first-child{font-weight:700;letter-spacing:.1em;color:#fff;font-size:.86rem}
.cal-detail-sub{font-size:.64rem;letter-spacing:.1em;color:rgba(255,255,255,.44)}
.cal-detail-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.06)}
.cal-detail-lvl{font-size:.64rem;font-weight:700;letter-spacing:.14em;color:rgba(255,255,255,.6);width:64px;flex:0 0 auto}
.cal-detail-name{font-size:.86rem;font-weight:700;color:#fff;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cal-detail-name.cal-locked{color:rgba(255,255,255,.4);font-style:italic;font-weight:500}
.cal-badge{font-size:.6rem;font-weight:700;letter-spacing:.06em;padding:4px 9px;border-radius:20px;flex:0 0 auto}
.cal-badge.cal-win{background:rgba(37,212,122,.16);color:#4ff0a0;border:1px solid rgba(37,212,122,.4)}
.cal-badge.cal-fail{background:rgba(255,78,101,.16);color:#ff8a99;border:1px solid rgba(255,78,101,.4)}
.cal-badge.cal-np{background:rgba(178,60,255,.16);color:#d6a6ff;border:1px solid rgba(178,60,255,.4)}
.cal-badge.cal-future{background:rgba(255,255,255,.06);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.14)}
.cal-mini-btn{cursor:pointer;font:inherit;font-size:.64rem;font-weight:700;letter-spacing:.08em;padding:6px 12px;border-radius:9px;flex:0 0 auto;
  color:#eadcff;border:1px solid rgba(207,118,255,.5);background:rgba(178,60,255,.12);transition:all .16s ease}
.cal-mini-btn:hover{background:rgba(178,60,255,.28);border-color:rgba(207,118,255,.85)}
.cal-mini-note{font-size:.62rem;font-weight:700;letter-spacing:.06em;color:rgba(255,138,153,.9);flex:0 0 auto;
  padding:5px 10px;border-radius:8px;border:1px solid rgba(255,78,101,.3);background:rgba(255,78,101,.08)}
/* ---- Proposition défi archivé : Jouer OU Consulter les réponses ---- */
.cal-choice{padding:16px 4px 4px;text-align:center}
.cal-choice-q{margin:0 0 14px;font-size:.92rem;font-weight:700;color:#fff}
.cal-choice-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:520px){.cal-choice-actions{grid-template-columns:1fr}}
.cal-choice-btn{cursor:pointer;font:inherit;display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:16px 14px;border-radius:14px;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease,background .16s ease}
.cal-choice-btn b{font-family:"Archivo Black","Barlow Condensed",sans-serif;font-size:.92rem;letter-spacing:.01em}
.cal-choice-btn span{font-size:.64rem;letter-spacing:.04em;opacity:.72}
.cal-choice-btn.play{color:#04120c;border:1px solid rgba(120,255,196,.7);
  background:linear-gradient(180deg,#4fffb0,#12d98a 55%,#06b877);box-shadow:0 10px 26px rgba(9,220,140,.34),inset 0 1px 0 rgba(255,255,255,.45)}
.cal-choice-btn.play:hover{transform:translateY(-2px);box-shadow:0 14px 32px rgba(9,220,140,.46)}
.cal-choice-btn.answers{color:#eadcff;border:1px solid rgba(207,118,255,.55);
  background:linear-gradient(180deg,rgba(178,60,255,.18),rgba(255,255,255,.03));box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.cal-choice-btn.answers:hover{transform:translateY(-2px);background:rgba(178,60,255,.3);border-color:rgba(207,118,255,.9)}
.cal-choice-note{margin:14px 0 0;font-size:.68rem;color:rgba(255,138,153,.85);letter-spacing:.02em}
.cal-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}
.cal-stat{padding:12px 8px;border-radius:12px;text-align:center;background:rgba(255,255,255,.03);border:1px solid rgba(207,118,255,.2)}
.cal-stat-v{display:block;font-size:1.3rem;font-weight:700;color:#fff;line-height:1}
.cal-stat-l{display:block;font-size:.58rem;letter-spacing:.1em;color:rgba(255,255,255,.5);margin-top:5px}

/* Bandeau rejeu + toast */
.replay-banner{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:130;display:flex;align-items:center;gap:14px;
  padding:10px 16px;border-radius:12px;background:linear-gradient(180deg,rgba(178,60,255,.9),rgba(109,30,188,.92));
  border:1px solid rgba(207,118,255,.7);box-shadow:0 14px 34px rgba(0,0,0,.5);color:#fff;font-size:.72rem;letter-spacing:.04em;max-width:92vw}
.replay-exit{cursor:pointer;font:inherit;font-size:.68rem;font-weight:700;padding:6px 12px;border-radius:9px;
  color:#fff;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.4)}
.replay-exit:hover{background:rgba(0,0,0,.45)}
.share-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,20px);z-index:140;
  padding:12px 20px;border-radius:12px;background:rgba(13,9,19,.96);border:1px solid rgba(207,118,255,.5);
  color:#fff;font-size:.78rem;letter-spacing:.04em;box-shadow:0 14px 34px rgba(0,0,0,.55);opacity:0;pointer-events:none;transition:all .24s ease}
.share-toast.show{opacity:1;transform:translate(-50%,0)}

/* ================= RÉVÉLATION VOLONTAIRE — panneau « joueurs d'hier » + calendrier ================= */
.daily-links{display:flex;gap:10px;flex-wrap:wrap}
.rds-action--yd{color:#eadcff;border:1px solid rgba(207,118,255,.52);
  background:linear-gradient(180deg,rgba(178,60,255,.12),rgba(255,255,255,.03));box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.rds-action--yd:hover{transform:translateY(-2px);background:rgba(178,60,255,.24);border-color:rgba(207,118,255,.85)}
/* Overlay hier */
.yd-overlay{position:fixed;inset:0;z-index:126;display:flex;align-items:flex-start;justify-content:center;
  padding:40px 16px;background:rgba(2,1,6,.82);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity .22s ease;overflow:auto}
.yd-overlay.open{opacity:1;pointer-events:auto}
.yd-modal{position:relative;width:100%;max-width:820px;border-radius:22px;padding:22px 22px 24px;
  background:linear-gradient(180deg,#0f0a17,#140f1d 60%,#0d0912);border:1px solid rgba(207,118,255,.34);
  box-shadow:0 40px 90px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.06);transform:translateY(10px);transition:transform .22s ease}
.yd-overlay.open .yd-modal{transform:none}
.yd-top{display:flex;align-items:center;justify-content:space-between}
.yd-title-2{font-size:1rem;font-weight:700;letter-spacing:.22em;color:#fff}
.yd-date-2{margin-top:2px;font-size:.7rem;letter-spacing:.12em;color:rgba(255,255,255,.5)}
.yd-note-2{margin:8px 0 16px;font-size:.72rem;line-height:1.5;color:rgba(255,255,255,.5)}
.yd-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.yd-empty{grid-column:1/-1;text-align:center;padding:28px 10px;color:rgba(255,255,255,.5);font-size:.82rem}
.yd-card2{border-radius:16px;padding:14px;min-height:150px;display:flex;flex-direction:column;gap:10px;
  background:linear-gradient(180deg,rgba(178,60,255,.08),rgba(255,255,255,.02));border:1px solid rgba(207,118,255,.24)}
.yd-c-top{display:flex;align-items:center;justify-content:space-between}
.yd-c-lvl{font-size:.64rem;font-weight:700;letter-spacing:.16em;color:rgba(255,255,255,.62)}
.yd-mask-badge{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  font-weight:700;color:#d8b6ff;background:rgba(178,60,255,.16);border:1px solid rgba(207,118,255,.4)}
.yd-mask-actions{display:flex;flex-direction:column;gap:8px;margin-top:auto}
.yd-abtn{cursor:pointer;font:inherit;font-size:.68rem;font-weight:700;letter-spacing:.06em;min-height:44px;border-radius:11px;transition:all .16s ease}
.yd-abtn.play{color:#fff;border:1px solid rgba(255,78,101,.55);background:linear-gradient(180deg,#ff5a70,#e0344b);box-shadow:0 8px 18px rgba(255,78,101,.28)}
.yd-abtn.play:hover{transform:translateY(-1px)}
.yd-abtn.reveal{color:#eadcff;border:1px solid rgba(207,118,255,.5);background:rgba(178,60,255,.1)}
.yd-abtn.reveal:hover{background:rgba(178,60,255,.24)}
.yd-c-photo{width:100%;height:120px;border-radius:11px;object-fit:cover;object-position:top center;
  background:rgba(178,60,255,.1);border:1px solid rgba(207,118,255,.28)}
.yd-c-name{font-size:.98rem;font-weight:700;color:#fff;line-height:1.15}
.yd-foot{display:flex;justify-content:center;margin-top:16px}
.yd-revealall{cursor:pointer;font:inherit;font-size:.7rem;font-weight:700;letter-spacing:.12em;padding:10px 18px;border-radius:11px;
  color:rgba(255,255,255,.7);background:rgba(255,255,255,.03);border:1px solid rgba(207,118,255,.3);transition:all .16s ease}
.yd-revealall:hover{color:#fff;border-color:rgba(207,118,255,.75);background:rgba(178,60,255,.14)}
.yd-confirm{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;padding:20px;
  background:rgba(4,2,9,.8);backdrop-filter:blur(3px);border-radius:22px}
.yd-confirm-box{max-width:420px;text-align:center;padding:22px;border-radius:16px;
  background:linear-gradient(180deg,#140f1d,#0d0912);border:1px solid rgba(207,118,255,.4);box-shadow:0 30px 60px rgba(0,0,0,.6)}
.yd-confirm-box p{margin:0 0 18px;font-size:.86rem;line-height:1.55;color:rgba(255,255,255,.86)}
.yd-confirm-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.yd-cbtn{cursor:pointer;font:inherit;font-size:.72rem;font-weight:700;letter-spacing:.08em;padding:11px 18px;border-radius:11px}
.yd-cbtn.yd-cancel{color:rgba(255,255,255,.8);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.2)}
.yd-cbtn.yd-cancel:hover{background:rgba(255,255,255,.1)}
.yd-cbtn.yd-go{color:#fff;border:1px solid rgba(255,78,101,.6);background:linear-gradient(180deg,#ff5a70,#e0344b);box-shadow:0 8px 20px rgba(255,78,101,.3)}
.yd-cbtn.yd-go:hover{transform:translateY(-1px)}
/* Révélation progressive */
.rv-in{display:flex;flex-direction:column;gap:8px}
.rv-in .rv-step{opacity:0;animation:rvStep .5s ease forwards}
.rv-in .rv-step:nth-child(1){animation-delay:.04s}
.rv-in .rv-step:nth-child(2){animation-delay:.16s}
.rv-in .rv-step:nth-child(3){animation-delay:.28s}
.rv-in .rv-step:nth-child(4){animation-delay:.4s}
@keyframes rvStep{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
.rv-clubs{display:flex;flex-wrap:wrap;gap:6px}
.rv-club{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:8px;
  background:rgba(255,255,255,.04);border:1px solid rgba(207,118,255,.18);font-size:.64rem;color:rgba(255,255,255,.8)}
.rv-club img{width:16px;height:16px;object-fit:contain}
.rv-club .rv-fb{width:16px;height:16px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:.5rem;font-style:normal;background:rgba(178,60,255,.2)}
.rv-club .rv-cn{font-weight:600}
.rv-club em{font-style:normal;color:rgba(255,255,255,.45)}
/* Détail calendrier : actions séparées, réponse masquée */
.cal-detail-row{flex-wrap:wrap}
.cal-detail-main{flex:1;min-width:140px}
.cal-detail-actions{display:flex;gap:8px;flex-wrap:wrap}
.cal-mini-btn.ghost{color:#d8b6ff;background:transparent;border:1px solid rgba(207,118,255,.4)}
.cal-mini-btn.ghost:hover{background:rgba(178,60,255,.14)}
.cal-rv{gap:8px;width:100%}
.cal-rv-photo{width:64px;height:64px;border-radius:10px;object-fit:cover;object-position:top center;background:rgba(178,60,255,.1);border:1px solid rgba(207,118,255,.28)}
.cal-rv-name{font-size:.94rem;font-weight:700;color:#fff}
.cal-rv-res{font-size:.66rem;font-weight:700}
.cal-rv-note{font-size:.6rem;letter-spacing:.06em;color:rgba(255,255,255,.4)}
@media(max-width:640px){ .yd-cards{grid-template-columns:1fr} }
@media(max-width:640px){
  .yd-body{grid-template-columns:1fr}
  .cal-stats{grid-template-columns:repeat(2,1fr)}
  .cal-cell{min-height:50px}
  .dt-value{font-size:1.2rem}
}

/* ================= RECHERCHE INTELLIGENTE (liste légère, 48px, ouverture courte) ================= */
/* Pendant la saisie : jusqu'à 8 résultats affichés SANS barre de défilement interne. */
.suggestions{animation:sugIn .12s ease;overscroll-behavior:contain;touch-action:pan-y;-webkit-overflow-scrolling:touch;scroll-behavior:auto;max-height:min(72vh,440px)}
@keyframes sugIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.suggestions .suggestion-item{min-height:48px}
/* Lignes de suggestion légères : aucun flou / ombre animée / transformation 3D par ligne */
.suggestions .suggestion-item{backdrop-filter:none;filter:none;transform:none;box-shadow:none;transition:background-color .12s ease,color .12s ease;will-change:auto}
.sg-head{padding:9px 14px 6px;font-size:.6rem;letter-spacing:.16em;color:rgba(255,255,255,.42);font-weight:600;text-transform:uppercase}
.sg-browse{width:100%;min-height:46px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;
  border:0;border-top:1px solid rgba(255,255,255,.08);background:rgba(178,60,255,.06);color:#d8b6ff;
  font:inherit;font-size:.74rem;font-weight:600;letter-spacing:.08em;transition:background .16s ease}
.sg-browse:hover{background:rgba(178,60,255,.18);color:#fff}

/* ============ Modale « CHOISIR UN JOUEUR » — grand sélecteur central premium ============ */
.browse-overlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;
  background:rgba(2,1,6,.84);backdrop-filter:blur(7px);opacity:0;pointer-events:none;transition:opacity .2s ease}
.browse-overlay.open{opacity:1;pointer-events:auto}
.browse-modal{width:min(920px,calc(100vw - 48px));height:min(820px,calc(100dvh - 64px));display:flex;flex-direction:column;overflow:hidden;
  border-radius:22px;background:linear-gradient(180deg,rgba(16,11,24,.985),rgba(12,8,17,.985));border:1px solid rgba(207,118,255,.32);
  box-shadow:0 50px 120px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,255,255,.05);transform:translateY(8px);transition:transform .2s ease}
.browse-overlay.open .browse-modal{transform:none}
.browse-head{flex:none;padding:22px 26px 16px;border-bottom:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.015)}
.browse-head-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.browse-title{font-size:1.18rem;font-weight:700;letter-spacing:.24em;color:#fff}
.browse-sub{margin-top:5px;font-size:.72rem;letter-spacing:.1em;color:rgba(255,255,255,.5)}
.browse-close{cursor:pointer;flex:none;width:42px;height:42px;border-radius:11px;border:1px solid rgba(207,118,255,.34);
  background:rgba(178,60,255,.1);color:#eadcff;font-size:1.15rem;line-height:1;transition:all .16s ease}
.browse-close:hover{background:rgba(255,78,101,.2);border-color:rgba(255,78,101,.55)}
.browse-search{width:100%;height:54px;margin-top:18px;padding:0 18px;border-radius:13px;
  border:1px solid rgba(207,118,255,.34);background:rgba(255,255,255,.04);color:#fff;font:inherit;font-size:1.02rem}
.browse-search::placeholder{color:rgba(255,255,255,.4)}
.browse-search:focus{outline:none;border-color:rgba(207,118,255,.82);background:rgba(178,60,255,.08)}
.browse-az{display:flex;flex-wrap:wrap;gap:4px;margin-top:14px}
.browse-az button{cursor:pointer;min-width:27px;height:28px;padding:0 5px;border-radius:7px;font:inherit;font-size:.72rem;font-weight:600;
  color:rgba(255,255,255,.66);background:rgba(255,255,255,.03);border:1px solid rgba(207,118,255,.2);transition:all .14s ease}
.browse-az button:hover{color:#fff;background:rgba(178,60,255,.24);border-color:rgba(207,118,255,.7)}
.browse-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;scroll-behavior:auto;
  touch-action:pan-y;-webkit-overflow-scrolling:touch;padding:6px 8px 10px;scrollbar-width:auto;scrollbar-color:rgba(178,60,255,.6) rgba(255,255,255,.05)}
.browse-list::-webkit-scrollbar{width:12px}
.browse-list::-webkit-scrollbar-track{background:rgba(255,255,255,.05);border-radius:8px}
.browse-list::-webkit-scrollbar-thumb{background:rgba(178,60,255,.6);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
.browse-list::-webkit-scrollbar-thumb:hover{background:rgba(178,60,255,.85);background-clip:padding-box}
.browse-inner{position:static}
.browse-row{position:static;min-height:48px;display:flex;align-items:center;gap:8px;padding:0 16px;
  font-size:.96rem;color:rgba(255,255,255,.84);border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;
  transition:background-color 60ms ease,color 60ms ease}
.browse-row[data-bid]:hover{background:linear-gradient(90deg,rgba(145,45,255,.82),rgba(102,24,190,.62));color:#fff}
.browse-row.is-used{color:rgba(255,255,255,.34);cursor:default}
.br-used{margin-left:auto;font-size:.66rem;letter-spacing:.06em;color:rgba(255,255,255,.3)}
@media(max-width:700px){
  .browse-overlay{padding:0}
  .browse-modal{width:100vw;height:100dvh;max-width:none;max-height:none;border-radius:0}
}
@media(max-width:640px){
  .yd-body{grid-template-columns:1fr}
  .cal-stats{grid-template-columns:repeat(2,1fr)}
  .cal-cell{min-height:50px}
  .dt-value{font-size:1.2rem}
  .suggestions .suggestion-item{min-height:52px}
}
'''

# ===== Fond de page : la photo choisie (comme le jeu 1), sous un voile violet/navy conservé =====
_pagebg = open("/tmp/pagebg.txt").read().strip() if os.path.exists("/tmp/pagebg.txt") else ""
_pagebg = _to_webp(_pagebg, "bg", False)   # Phase 2 : fond de page externalisé en WebP
page_bg_css = ""
if _pagebg:
    page_bg_css = '''
/* Image de fond en transparence (voile violet/navy conservé) — aspect uniquement, rien d'autre ne change.
   L'image est la couche du BAS du fond de page ; les dégradés violet/navy semi-transparents la voilent. */
body{
  background:
    radial-gradient(circle at 50% 36%, rgba(178,60,255,.20), transparent 46rem),
    linear-gradient(180deg, rgba(6,3,14,.52) 0%, rgba(9,4,20,.58) 46%, rgba(3,1,9,.82) 100%),
    url("__BG__") center 20%/cover no-repeat fixed !important;
}
'''.replace("__BG__", _pagebg)

# ===== Écran de résultat EXPERT « EA-straight » (démonstrateur adapté, CSS scopé à #eaExpert) =====
# Variables et couleurs du démonstrateur placées sur #eaExpert (n'affectent QUE cet écran).
# Tous les sélecteurs préfixés par #eaExpert -> aucune collision avec le reste du jeu (ex. .club-logo).
ea_css='''
#eaExpert{--bg:#020611;--surface:rgba(6,16,31,.94);--surface-2:rgba(8,19,37,.88);--surface-3:rgba(12,25,48,.86);--text:#f6f7fb;--muted:#c4cad7;--soft:#8f99ad;--line:rgba(173,191,226,.38);--line-strong:rgba(205,217,241,.72);--violet:#7657ff;--blue:#5d8dff;--red:#ff2747;--gold:#dca843;--club-card-width:130px;--club-gap:12px;--cut:16px;--ease:cubic-bezier(.2,.75,.2,1);
  width:100vw;margin-left:calc(50% - 50vw);color:var(--text);font-family:Inter,Arial,sans-serif;text-align:left}
#eaExpert *{box-sizing:border-box}
#eaExpert button{font:inherit;color:inherit}
#eaExpert .expert-screen{position:relative;height:min(100svh,1015px);min-height:600px;isolation:isolate;overflow:hidden;
  background:
    radial-gradient(120% 62% at 50% -12%, rgba(120,150,255,.12), transparent 60%),
    radial-gradient(circle at 7% 3%, rgba(127,153,255,.17), transparent 21%),
    radial-gradient(circle at 93% 5%, rgba(120,150,255,.15), transparent 21%),
    radial-gradient(circle at 50% 120%, rgba(93,67,255,.22), transparent 36%),
    linear-gradient(180deg,#04070f 0%,#060d1c 46%,#081327 100%)}
#eaExpert .expert-screen::before{content:"";position:absolute;inset:0;z-index:-3;opacity:.5;
  background:radial-gradient(circle at 2.5% 4%,#f8fbff 0 5px,transparent 6px),radial-gradient(circle at 5% 4%,#f8fbff 0 5px,transparent 6px),radial-gradient(circle at 7.5% 4%,#f8fbff 0 5px,transparent 6px),radial-gradient(circle at 10% 4%,#f8fbff 0 5px,transparent 6px),radial-gradient(circle at 97% 5%,#f8fbff 0 4px,transparent 5px);filter:drop-shadow(0 0 10px rgba(173,205,255,.6))}
#eaExpert .expert-screen::after{content:"";position:absolute;inset:0;z-index:-2;pointer-events:none;opacity:.23;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.012) 1px,transparent 1px);background-size:5px 5px;mix-blend-mode:screen}
#eaExpert .expert-shell{width:min(1920px,100%);height:100%;min-height:0;margin:0 auto;padding:20px 42px 22px;display:grid;grid-template-rows:98px minmax(0,1fr)}
#eaExpert .expert-header{position:relative;display:grid;place-items:start center;text-align:center}
#eaExpert .expert-title{margin:0;font:700 clamp(44px,3.4vw,66px)/.94 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.08em;text-transform:uppercase;text-shadow:0 4px 22px rgba(0,0,0,.75)}
#eaExpert .expert-subtitle{margin:8px 0 0;font:500 clamp(17px,1.15vw,23px)/1 "Barlow Condensed",sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#e4e7ee}
#eaExpert .expert-subtitle::after{content:"";display:block;width:66px;height:4px;margin:13px auto 0;background:var(--red);box-shadow:0 0 16px rgba(255,39,71,.28)}
#eaExpert .level-chip{position:absolute;top:4px;right:2px;min-width:152px;height:50px;padding:0 20px;display:flex;align-items:center;justify-content:center;gap:10px;border:1px solid rgba(148,165,212,.7);clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);background:linear-gradient(135deg,rgba(20,34,63,.94),rgba(5,11,25,.96));box-shadow:inset 0 0 22px rgba(79,80,221,.17),0 8px 26px rgba(0,0,0,.3);font:600 20px/1 "Barlow Condensed",sans-serif;letter-spacing:.08em;text-transform:uppercase}
#eaExpert .level-chip::before{content:"★";width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:linear-gradient(145deg,var(--blue),#4b2cd5);box-shadow:0 0 14px rgba(105,104,255,.75);font-size:13px}
#eaExpert .expert-layout{min-height:0;display:grid;grid-template-columns:minmax(0,1.03fr) minmax(0,.97fr);gap:clamp(34px,2.4vw,50px)}
#eaExpert .left-column,#eaExpert .right-panel{min-width:0;min-height:0}
#eaExpert .left-column{display:grid;grid-template-rows:minmax(0,1fr) 272px;gap:16px}
#eaExpert .cut-panel{clip-path:polygon(var(--cut) 0,calc(100% - var(--cut)) 0,100% var(--cut),100% calc(100% - var(--cut)),calc(100% - var(--cut)) 100%,var(--cut) 100%,0 calc(100% - var(--cut)),0 var(--cut))}
#eaExpert .portrait-stage{position:relative;min-height:0;overflow:hidden;border:1px solid var(--line-strong);background:rgba(4,12,28,.88);box-shadow:inset 0 0 0 1px rgba(111,131,181,.1),inset 0 -80px 110px rgba(2,7,18,.66),0 20px 45px rgba(0,0,0,.34)}
#eaExpert .portrait-stage::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(125% 95% at 50% 30%, transparent 56%, rgba(2,6,17,.55));box-shadow:inset 0 0 70px rgba(20,34,74,.32)}
#eaExpert .portrait-glow{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 26%;filter:blur(22px) saturate(.6) brightness(.5);transform:scale(1.12);opacity:.8}
#eaExpert .portrait-veil{position:absolute;inset:0;background:radial-gradient(120% 100% at 30% 40%, transparent 60%, rgba(8,22,58,.4));mix-blend-mode:normal}
#eaExpert .portrait-frame{position:absolute;top:0;right:0;width:50%;height:100%;z-index:2;overflow:hidden;border-left:1px solid rgba(224,232,255,.72);background:rgba(2,8,18,.62);box-shadow:-16px 0 40px rgba(0,0,0,.28),0 0 0 1px rgba(126,145,255,.66),0 0 20px rgba(83,100,255,.42)}
#eaExpert .portrait-frame::after{content:"";position:absolute;inset:0;border:2px solid transparent;border-right-color:rgba(255,44,73,.8);pointer-events:none}
#eaExpert .portrait-image{width:100%;height:100%;display:block;object-fit:contain;object-position:center bottom}
#eaExpert.ea-no-photo .portrait-image{display:none}
#eaExpert.ea-no-photo .portrait-frame{background:radial-gradient(circle at 50% 34%,rgba(43,62,120,.6),rgba(5,12,28,.95) 70%)}
#eaExpert.ea-no-photo .portrait-frame::before{content:"";position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);width:60%;height:70%;background:radial-gradient(circle at 50% 30%,rgba(198,210,245,.5) 0 18%,transparent 19%),radial-gradient(ellipse at 50% 100%,rgba(198,210,245,.5) 0 40%,transparent 41%);background-repeat:no-repeat;background-size:100% 42%,100% 62%;background-position:center top,center bottom}
#eaExpert .portrait-label{position:absolute;z-index:4;top:24px;left:29px;font:600 19px/1 "Barlow Condensed",sans-serif;letter-spacing:.08em;text-transform:uppercase}
#eaExpert .portrait-label::after{content:"";display:block;width:42px;height:3px;margin-top:11px;background:var(--red)}
#eaExpert .career-block{min-height:0;display:grid;grid-template-rows:36px minmax(0,1fr)}
#eaExpert .section-title{display:grid;grid-template-columns:1fr auto 1fr;gap:20px;align-items:center;margin:0;color:#eef1f7;font:600 22px/1 "Barlow Condensed",sans-serif;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
#eaExpert .section-title::before,#eaExpert .section-title::after{content:"";height:1px;background:linear-gradient(90deg,transparent,rgba(185,199,227,.55),var(--red))}
#eaExpert .section-title::after{transform:scaleX(-1)}
#eaExpert .carousel-shell{position:relative;min-width:0;padding:0 28px}
#eaExpert .club-viewport,#eaExpert .honour-viewport{width:100%;height:100%;overflow-x:auto;overflow-y:hidden;scroll-behavior:smooth;overscroll-behavior:contain;touch-action:pan-x;scrollbar-width:none}
#eaExpert .club-viewport::-webkit-scrollbar,#eaExpert .honour-viewport::-webkit-scrollbar{display:none}
#eaExpert .club-track{width:max-content;min-width:100%;height:100%;display:flex;align-items:center;justify-content:center;gap:var(--club-gap);padding:6px 0}
#eaExpert .club-viewport.ea-scroll .club-track{justify-content:flex-start}
#eaExpert .club-card{position:relative;flex:0 0 var(--club-card-width);height:208px;padding:16px 9px 14px;display:grid;grid-template-rows:22px 92px minmax(34px,1fr) 16px;align-items:center;text-align:center;border:1px solid rgba(165,184,222,.58);background:linear-gradient(145deg,rgba(23,37,66,.94),rgba(5,12,25,.97)),var(--surface-2);box-shadow:inset 0 0 22px rgba(76,92,156,.1),0 14px 26px rgba(0,0,0,.32),0 26px 30px -18px rgba(0,0,0,.55);transition:transform .28s var(--ease),border-color .28s ease,box-shadow .28s ease}
#eaExpert .club-card:hover{transform:translateY(-6px);border-color:rgba(126,113,255,.9);box-shadow:inset 0 0 28px rgba(85,76,225,.16),0 18px 30px rgba(0,0,0,.34),0 0 18px rgba(98,80,255,.15)}
#eaExpert .club-card:not(:last-child)::after{content:"›";position:absolute;z-index:5;top:45%;right:calc(var(--club-gap) * -.72);color:var(--red);font:600 31px/1 "Barlow Condensed",sans-serif;text-shadow:0 0 8px rgba(255,39,71,.5)}
#eaExpert .club-period{font:600 15px/1 "Barlow Condensed",sans-serif;color:#eef1f7}
#eaExpert .club-logo-wrap{width:88px;height:88px;margin:auto;display:grid;place-items:center}
#eaExpert .club-logo{max-width:82px;max-height:82px;object-fit:contain;filter:drop-shadow(0 5px 8px rgba(0,0,0,.36))}
#eaExpert .club-fallback{width:76px;height:76px;display:grid;place-items:center;border:2px solid rgba(236,240,250,.86);border-radius:50%;background:linear-gradient(145deg,#18367c,#091837);color:#fff;font:700 23px/1 "Barlow Condensed",sans-serif;letter-spacing:.04em;box-shadow:0 0 0 3px rgba(36,54,96,.72),0 8px 18px rgba(0,0,0,.35)}
#eaExpert .club-name{min-height:36px;display:grid;place-items:center;font:600 16px/1.08 "Barlow Condensed",sans-serif;color:#fff}
#eaExpert .club-country{font-size:11px;letter-spacing:.05em;color:var(--muted);text-transform:uppercase}
#eaExpert .carousel-button{position:absolute;z-index:8;top:50%;width:39px;height:57px;display:grid;place-items:center;border:1px solid rgba(157,177,221,.65);background:linear-gradient(160deg,rgba(17,31,57,.94),rgba(4,10,21,.98));box-shadow:inset 0 0 16px rgba(100,95,255,.12),0 9px 22px rgba(0,0,0,.3);cursor:pointer;transform:translateY(-50%);transition:border-color .2s ease,box-shadow .2s ease,filter .2s ease}
#eaExpert .carousel-button:hover{border-color:rgba(126,102,255,.95);box-shadow:inset 0 0 19px rgba(105,83,255,.22),0 0 17px rgba(100,76,255,.22);filter:brightness(1.12)}
#eaExpert .carousel-button.prev{left:0}
#eaExpert .carousel-button.next{right:0}
#eaExpert .carousel-button::before{content:"";width:12px;height:12px;border-top:3px solid #fff;border-right:3px solid #fff}
#eaExpert .carousel-button.prev::before{transform:rotate(-135deg);margin-left:5px}
#eaExpert .carousel-button.next::before{transform:rotate(45deg);margin-right:5px}
#eaExpert .right-panel{position:relative;overflow:hidden;display:flex;flex-direction:column;text-align:left;padding:clamp(22px,2vw,38px) clamp(28px,2.5vw,46px) 22px;border:1px solid var(--line-strong);background:radial-gradient(circle at 86% 8%,rgba(48,77,138,.18),transparent 26%),radial-gradient(circle at 20% 96%,rgba(93,67,255,.12),transparent 32%),linear-gradient(142deg,rgba(11,27,50,.96),rgba(3,11,23,.96));box-shadow:inset 0 0 48px rgba(79,96,171,.1),0 24px 54px rgba(0,0,0,.34),0 0 70px rgba(93,67,255,.10)}
#eaExpert .right-panel::before{content:"";position:absolute;inset:0;opacity:.13;pointer-events:none;background:linear-gradient(90deg,transparent 72%,rgba(118,87,255,.12)),repeating-linear-gradient(0deg,transparent 0 18px,rgba(255,255,255,.025) 18px 19px)}
#eaExpert .right-panel>*{position:relative;z-index:1}
#eaExpert .player-name{margin:0;font:700 clamp(42px,3vw,61px)/.95 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.035em;text-transform:uppercase;text-shadow:0 4px 22px rgba(0,0,0,.55)}
#eaExpert .player-summary{max-width:680px;margin:12px 0 0;color:#ecedf1;font-size:clamp(15px,1.02vw,19px);line-height:1.42}
#eaExpert .red-mark{width:42px;height:3px;margin:18px 0 18px;background:var(--red);box-shadow:0 0 14px rgba(255,39,71,.25)}
#eaExpert .panel-heading{margin:0 0 12px;font:600 clamp(21px,1.45vw,28px)/1 "Barlow Condensed",sans-serif;letter-spacing:.09em;text-transform:uppercase}
#eaExpert .facts{display:grid;gap:8px}
#eaExpert .fact-row{position:relative;min-height:58px;display:grid;grid-template-columns:76px 1fr;align-items:stretch;overflow:hidden;border:1px solid rgba(161,181,221,.55);background:linear-gradient(90deg,rgba(15,31,56,.94),rgba(5,12,25,.76));box-shadow:inset 0 0 18px rgba(89,95,178,.08)}
#eaExpert .fact-row::after{content:"";position:absolute;right:0;bottom:0;width:48%;height:2px;background:linear-gradient(90deg,transparent,var(--violet),#c3b9ff,var(--violet));box-shadow:0 0 9px rgba(111,78,255,.85)}
#eaExpert .fact-index{display:grid;place-items:center;border-right:1px solid rgba(181,198,232,.34);background:linear-gradient(145deg,rgba(30,45,76,.98),rgba(9,17,31,.98));font:700 32px/1 "Barlow Condensed",sans-serif;text-shadow:0 2px 9px rgba(0,0,0,.5)}
#eaExpert .fact-copy{padding:0 18px;display:flex;align-items:center;font-size:clamp(13px,.88vw,17px);color:#f2f3f7}
#eaExpert .honours-section{margin-top:16px}
#eaExpert .honours-topline{display:block;margin-bottom:10px}
#eaExpert .honours-topline .panel-heading{margin:0 0 4px}
#eaExpert .honours-count{margin-top:2px;color:#dde1ea;font-size:16px;text-align:left}
#eaExpert .honours-carousel{height:248px}
#eaExpert .honour-track{width:100%;min-width:100%;height:100%;display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - 28px) / 3);gap:14px;align-items:stretch;padding:0 0 4px}
#eaExpert .honour-card{width:auto;min-width:0;padding:22px 18px 20px;display:flex;flex-direction:column;justify-content:center;gap:16px;border:1px solid rgba(164,184,222,.58);background:radial-gradient(circle at 28% 20%,rgba(118,87,255,.14),transparent 40%),linear-gradient(145deg,rgba(17,33,60,.97),rgba(4,11,24,.98));box-shadow:inset 0 0 24px rgba(71,85,155,.1),0 16px 30px rgba(0,0,0,.3)}
#eaExpert .trophy-line{display:grid;grid-template-columns:78px 1fr;align-items:center;gap:12px}
#eaExpert .trophy-icon{width:78px;height:96px;background:url("__TROPHY_URI__") center/contain no-repeat;filter:drop-shadow(0 9px 11px rgba(0,0,0,.45))}
#eaExpert .honour-name{font:600 20px/1.16 "Barlow Condensed",sans-serif;color:#fff}
#eaExpert .honour-multiplier{display:inline-grid;place-items:center;min-width:34px;height:26px;margin-left:6px;padding:0 7px;border:1px solid rgba(133,148,206,.52);border-radius:13px;color:#e8ebff;background:rgba(52,64,116,.5);font-size:12px}
#eaExpert .years{display:flex;flex-wrap:wrap;gap:6px}
#eaExpert .year-pill{min-width:48px;height:30px;padding:0 9px;display:grid;place-items:center;border:1px solid rgba(119,139,193,.55);background:rgba(25,40,72,.82);color:#f2f4fa;font-size:12px}
/* Barre d'actions dans le panneau droit (remplit l'espace vide, tient dans l'écran) */
#eaExpert .ea-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:auto;padding-top:20px}
#eaExpert .ea-btn{flex:1 1 30%;min-height:52px;padding:0 16px;cursor:pointer;border:1px solid rgba(157,177,221,.6);background:linear-gradient(160deg,rgba(18,32,58,.95),rgba(6,13,26,.98));color:#eef1f7;font:600 15px/1.05 "Barlow Condensed",sans-serif;letter-spacing:.06em;text-transform:uppercase;clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px);box-shadow:inset 0 0 18px rgba(90,95,255,.1),0 10px 22px rgba(0,0,0,.3);transition:border-color .18s ease,box-shadow .18s ease,filter .18s ease}
#eaExpert .ea-btn:hover{border-color:rgba(126,102,255,.95);filter:brightness(1.1)}
#eaExpert .ea-btn--red{border-color:rgba(255,44,73,.7);background:linear-gradient(160deg,#ff2747,#c11330);color:#fff;box-shadow:0 10px 26px rgba(255,39,71,.3)}
@media(max-width:1450px){#eaExpert{--club-card-width:126px;--club-gap:10px}#eaExpert .expert-shell{padding-inline:28px}#eaExpert .expert-layout{gap:28px}#eaExpert .right-panel{padding-inline:30px}}
@media(max-width:1200px){#eaExpert .honour-track{grid-auto-columns:calc((100% - 14px) / 2)}}
@media(max-width:1100px){#eaExpert .expert-screen{height:auto;min-height:100svh}#eaExpert .expert-shell{display:block;height:auto;padding:22px 18px 35px}#eaExpert .expert-header{height:112px}#eaExpert .level-chip{top:63px;right:0;min-width:112px;height:39px;font-size:16px}#eaExpert .expert-layout{grid-template-columns:1fr}#eaExpert .left-column{display:grid;grid-template-rows:470px 300px}#eaExpert .right-panel{min-height:auto;margin-top:24px}#eaExpert .honour-track{grid-auto-columns:calc((100% - 14px)/2)}}
@media(max-width:720px){#eaExpert{--club-card-width:132px}#eaExpert .expert-title{font-size:36px}#eaExpert .expert-subtitle{font-size:15px}#eaExpert .portrait-frame{width:70%}#eaExpert .portrait-label{top:17px;left:19px;font-size:16px}#eaExpert .left-column{grid-template-rows:390px 300px}#eaExpert .right-panel{padding:26px 19px}#eaExpert .fact-row{grid-template-columns:57px 1fr}#eaExpert .fact-copy{padding:10px 12px}#eaExpert .honour-track{grid-auto-columns:minmax(214px,82vw)}#eaExpert .ea-btn{flex:1 1 100%}}
'''

# ===================== POP-UP DE PARTAGE (dédié) — esthétique bleu nuit / violet / métal =====================
share_css=r'''
.sr-overlay{position:fixed;inset:0;z-index:1400;display:none;align-items:center;justify-content:center;padding:24px;
  background:radial-gradient(circle at 50% 30%,rgba(30,22,74,.55),rgba(2,5,17,.86) 70%);backdrop-filter:blur(6px)}
.sr-overlay.open{display:flex}
body.sr-lock{overflow:hidden}
.sr-modal{position:relative;width:min(940px,100%);max-height:calc(100dvh - 40px);overflow:auto;
  display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:26px;padding:30px 30px 28px;
  color:#f3f5fb;border:1px solid rgba(184,199,232,.42);border-radius:20px;
  clip-path:polygon(20px 0,100% 0,100% calc(100% - 20px),calc(100% - 20px) 100%,0 100%,0 20px);
  background:radial-gradient(circle at 26% 12%,rgba(118,87,255,.20),transparent 42%),radial-gradient(circle at 88% 90%,rgba(255,39,71,.12),transparent 46%),linear-gradient(150deg,rgba(9,18,40,.98),rgba(6,12,28,.99) 55%,rgba(14,12,34,.98));
  box-shadow:0 40px 110px rgba(0,0,14,.66),inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 70px rgba(52,74,150,.10)}
.sr-close{position:absolute;top:14px;right:14px;width:38px;height:38px;border-radius:11px;cursor:pointer;
  border:1px solid rgba(190,201,230,.4);background:linear-gradient(180deg,rgba(28,38,66,.9),rgba(12,20,40,.9));
  color:#dfe5f4;font-size:18px;line-height:1;display:grid;place-items:center;transition:all .16s ease;z-index:3}
.sr-close:hover{border-color:#ff6478;color:#fff;box-shadow:0 0 18px rgba(255,39,71,.4)}
.sr-close:focus-visible{outline:2px solid #7b93ff;outline-offset:2px}
.sr-preview{grid-column:1;display:flex;align-items:center;justify-content:center;min-width:0;
  padding:16px;border-radius:14px;border:1px solid rgba(150,166,205,.26);
  clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px);
  background:linear-gradient(160deg,rgba(3,8,20,.6),rgba(8,14,32,.6));box-shadow:inset 0 0 40px rgba(0,0,0,.45)}
.sr-canvas{display:block;max-width:100%;max-height:min(62dvh,560px);height:auto;border-radius:6px;
  box-shadow:0 18px 40px rgba(0,0,10,.5)}
.sr-side{grid-column:2;display:flex;flex-direction:column;gap:18px;min-width:0}
.sr-head h2{margin:0;font-family:"Archivo Black","Barlow Condensed",sans-serif;font-size:24px;letter-spacing:.02em;color:#fff}
.sr-head p{margin:6px 0 0;font-size:12.5px;line-height:1.4;color:#aab3c8}
.sr-formats{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sr-fmt{cursor:pointer;padding:12px 8px;border-radius:12px;text-align:center;font:700 13px/1.1 "Barlow Condensed",sans-serif;letter-spacing:.06em;text-transform:uppercase;
  color:#c7cfe2;border:1px solid rgba(150,166,205,.32);background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.008));transition:all .16s ease}
.sr-fmt span{display:block;margin-top:4px;font-size:10.5px;font-weight:600;letter-spacing:.04em;color:#8b93a8}
.sr-fmt:hover{border-color:rgba(150,140,255,.6);color:#fff}
.sr-fmt.is-active{color:#fff;border-color:rgba(150,140,255,.9);background:linear-gradient(180deg,rgba(118,87,255,.28),rgba(118,87,255,.08));box-shadow:0 0 20px rgba(118,87,255,.28),inset 0 1px 0 rgba(255,255,255,.14)}
.sr-fmt.is-active span{color:#d8d0ff}
.sr-fmt:focus-visible{outline:2px solid #7b93ff;outline-offset:2px}
.sr-field{display:flex;flex-direction:column;gap:7px}
.sr-label{font:700 12px/1.2 "Barlow Condensed",sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#c3cbe0}
.sr-input{width:100%;padding:12px 14px;border-radius:11px;color:#fff;font:600 15px/1.2 Inter,Arial,sans-serif;letter-spacing:.02em;
  border:1px solid rgba(160,175,212,.42);background:linear-gradient(180deg,rgba(6,12,28,.9),rgba(10,18,38,.9));transition:border-color .16s ease,box-shadow .16s ease}
.sr-input::placeholder{color:#697291}
.sr-input:focus{outline:none;border-color:rgba(150,140,255,.9);box-shadow:0 0 0 3px rgba(118,87,255,.22)}
.sr-count{align-self:flex-end;font:700 11.5px/1 "Barlow Condensed",sans-serif;letter-spacing:.06em;color:#8b93a8}
.sr-count.is-min{color:#ffcf7a}
.sr-actions{display:flex;flex-direction:column;gap:10px;margin-top:2px}
.sr-btn{cursor:pointer;font:800 13px/1 "Barlow Condensed",sans-serif;letter-spacing:.09em;text-transform:uppercase;
  padding:15px 16px;border-radius:12px;color:#eef1f8;border:1px solid rgba(160,175,212,.4);
  background:linear-gradient(180deg,rgba(28,40,70,.92),rgba(11,19,40,.92));transition:all .16s ease;text-align:center}
.sr-btn:hover{transform:translateY(-1px);border-color:rgba(160,175,255,.7);box-shadow:0 8px 22px rgba(0,0,20,.4)}
.sr-btn:focus-visible{outline:2px solid #7b93ff;outline-offset:2px}
.sr-btn--primary{color:#0a0416;border:1px solid rgba(255,150,170,.6);
  background:linear-gradient(180deg,#ff5a70,#e0344b);box-shadow:0 12px 28px rgba(255,60,90,.36),inset 0 1px 0 rgba(255,255,255,.32)}
.sr-btn--primary:hover{filter:brightness(1.05);box-shadow:0 16px 34px rgba(255,60,90,.46)}
.sr-hint{margin:2px 0 0;min-height:16px;font-size:12px;line-height:1.45;color:#8ff0c0;text-align:center}
.sr-hint.is-warn{color:#ffcf7a}
.sr-identity{font:700 12.5px/1.4 "Barlow Condensed",sans-serif;letter-spacing:.05em;color:#9ff0c6;text-align:center;padding:8px 10px;border-radius:10px;border:1px dashed rgba(120,255,196,.35);background:rgba(18,217,138,.06)}
/* ===== Overlay identité de collectionneur ===== */
.id-overlay{position:fixed;inset:0;z-index:1600;display:none;align-items:center;justify-content:center;padding:24px;
  background:radial-gradient(circle at 50% 30%,rgba(40,26,96,.62),rgba(2,4,14,.94) 72%);backdrop-filter:blur(7px)}
.id-overlay.open{display:flex;animation:cuFade .3s ease}
.id-modal{width:min(880px,100%);grid-template-columns:none;display:block}
.id-head{text-align:center;margin-bottom:16px}
.id-desc{margin:8px auto 0;max-width:560px;font-size:13px;line-height:1.5;color:#b7c0d6}
.id-body{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:24px;align-items:center}
.id-preview{padding:14px}
.id-side{display:flex;flex-direction:column;gap:16px}
.id-confirm2{text-align:center;padding:8px 6px 4px}
.id-bigname{margin:14px auto 10px;font-family:"Archivo Black","Barlow Condensed",sans-serif;font-size:52px;line-height:1.05;letter-spacing:.03em;color:#fff;text-shadow:0 0 26px rgba(118,87,255,.5);word-break:break-word}
.id-actions2{display:flex;gap:12px;justify-content:center;margin-top:16px;flex-wrap:wrap}
.id-actions2 .sr-btn{min-width:210px}
@media(max-width:760px){ .id-body{grid-template-columns:1fr} .id-bigname{font-size:40px} }
/* ===== Overlay de déblocage de carte ===== */
.cu-overlay{position:fixed;inset:0;z-index:1500;display:none;align-items:center;justify-content:center;padding:24px;
  background:radial-gradient(circle at 50% 35%,rgba(40,26,96,.6),rgba(2,4,14,.92) 72%);backdrop-filter:blur(7px)}
.cu-overlay.open{display:flex;animation:cuFade .35s ease}
@keyframes cuFade{from{opacity:0}to{opacity:1}}
.cu-modal{position:relative;width:min(460px,100%);max-height:calc(100dvh - 40px);overflow:auto;text-align:center;
  padding:26px 26px 24px;border:1px solid rgba(150,140,255,.5);border-radius:20px;
  clip-path:polygon(20px 0,100% 0,100% calc(100% - 20px),calc(100% - 20px) 100%,0 100%,0 20px);
  background:radial-gradient(circle at 50% 0,rgba(118,87,255,.28),transparent 60%),linear-gradient(160deg,rgba(10,20,44,.98),rgba(8,12,30,.99));
  box-shadow:0 40px 120px rgba(0,0,16,.7),inset 0 1px 0 rgba(255,255,255,.1)}
.cu-rays{position:absolute;top:-40%;left:-40%;width:180%;height:180%;pointer-events:none;z-index:0;
  background:conic-gradient(from 0deg,transparent 0 8deg,rgba(150,140,255,.10) 9deg 12deg,transparent 13deg 24deg);
  animation:cuSpin 18s linear infinite;opacity:.5}
@keyframes cuSpin{to{transform:rotate(360deg)}}
.cu-modal>*{position:relative;z-index:1}
.cu-kicker{font:800 13px/1.1 "Barlow Condensed",sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#bfe325;
  text-shadow:0 0 18px rgba(191,227,37,.5);animation:cuPulse 2s ease-in-out infinite}
@keyframes cuPulse{0%,100%{opacity:.85}50%{opacity:1}}
.cu-title{margin:5px 0 12px;font-family:"Archivo Black","Barlow Condensed",sans-serif;font-size:22px;letter-spacing:.02em;color:#fff}
.cu-cardwrap{display:flex;justify-content:center;margin:0 0 14px}
.cu-card{display:block;width:auto;max-width:100%;max-height:min(52vh,360px);height:auto;border-radius:8px;
  box-shadow:0 20px 60px rgba(0,0,18,.6);animation:cuRise .55s cubic-bezier(.2,.8,.25,1)}
@keyframes cuRise{from{transform:translateY(14px) scale(.97);opacity:0}to{transform:none;opacity:1}}
.cu-actions{display:flex;justify-content:center}
.cu-actions .sr-btn{min-width:200px}
@media(max-width:520px){.cu-title{font-size:19px}.cu-card{max-height:44vh}}
/* ===== Bouton + galerie « Mes récompenses » ===== */
.daily-cal-link--rewards{border-color:rgba(220,168,67,.6);background:rgba(220,168,67,.10);color:#ffe6ac}
.daily-cal-link--rewards:hover{background:rgba(220,168,67,.2);border-color:rgba(232,182,74,.9)}
.rw-overlay{position:fixed;inset:0;z-index:1550;display:none;align-items:flex-start;justify-content:center;padding:26px 20px;overflow:auto;
  background:radial-gradient(circle at 50% 12%,rgba(30,26,74,.55),rgba(2,4,14,.93) 70%);backdrop-filter:blur(6px)}
.rw-overlay.open{display:flex;animation:cuFade .3s ease}
.rw-modal{position:relative;width:min(960px,100%);margin:auto;padding:28px 26px 22px;color:#f3f5fb;
  border:1px solid rgba(184,199,232,.4);border-radius:20px;
  clip-path:polygon(20px 0,100% 0,100% calc(100% - 20px),calc(100% - 20px) 100%,0 100%,0 20px);
  background:radial-gradient(circle at 26% 8%,rgba(118,87,255,.18),transparent 46%),linear-gradient(160deg,rgba(9,18,40,.98),rgba(6,12,28,.99));
  box-shadow:0 40px 110px rgba(0,0,14,.66),inset 0 1px 0 rgba(255,255,255,.07)}
.rw-head{text-align:center;margin-bottom:20px}
.rw-title{margin:0;font-family:"Archivo Black","Barlow Condensed",sans-serif;font-size:26px;letter-spacing:.02em;color:#fff}
.rw-sub{margin:6px 0 0;font-size:12.5px;color:#aab3c8}
.rw-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}
@media(max-width:640px){.rw-grid{grid-template-columns:1fr}}
.rw-tile{display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px 14px 14px;border-radius:16px;
  border:1px solid rgba(150,166,205,.24);background:linear-gradient(160deg,rgba(12,22,44,.7),rgba(6,12,28,.7));
  clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}
.rw-tile.is-owned{border-color:rgba(191,227,37,.5);box-shadow:0 0 24px rgba(191,227,37,.10),inset 0 1px 0 rgba(255,255,255,.06)}
.rw-thumb{position:relative;width:100%;display:flex;justify-content:center;border-radius:10px;overflow:hidden}
.rw-thumb canvas{display:block;width:auto;max-width:100%;max-height:min(46vh,420px);height:auto;border-radius:8px}
.rw-tile.is-locked .rw-thumb canvas{filter:blur(11px) grayscale(.6) brightness(.55);transform:scale(1.04)}
.rw-lock{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  background:radial-gradient(circle at 50% 45%,rgba(4,7,20,.35),rgba(4,7,20,.62));color:#eef1f8}
.rw-lock-ic{font-size:40px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.6))}
.rw-lock-txt{font:800 12px/1.2 "Barlow Condensed",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#c9d2e6}
.rw-name{font:800 15px/1.25 "Barlow Condensed",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#fff;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}
.rw-tile.is-locked .rw-name{color:#c9d2e6}
.rw-help{flex:0 0 auto;width:24px;height:24px;border-radius:50%;cursor:pointer;font:800 13px/1 "Barlow Condensed",sans-serif;
  color:#dbe2f2;border:1px solid rgba(160,175,212,.6);background:rgba(28,40,70,.85);display:inline-flex;align-items:center;justify-content:center;transition:all .15s ease}
.rw-help:hover,.rw-help.is-on{color:#fff;border-color:rgba(150,140,255,.9);background:rgba(118,87,255,.28);box-shadow:0 0 14px rgba(118,87,255,.4)}
.rw-help:focus-visible{outline:2px solid #7b93ff;outline-offset:2px}
.rw-howto{margin-top:2px;font:600 12px/1.5 Inter,Arial,sans-serif;letter-spacing:0;text-transform:none;color:#c4cde2;text-align:center;
  padding:11px 13px;border-radius:11px;border:1px solid rgba(150,140,255,.3);background:rgba(118,87,255,.10)}
.rw-howto[hidden]{display:none}
.rw-howto-t{display:block;font-weight:800;color:#cdb3ff;letter-spacing:.04em;margin-bottom:3px;text-transform:uppercase;font-size:11px}
.rw-state{font:700 11.5px/1.2 "Barlow Condensed",sans-serif;letter-spacing:.09em;text-transform:uppercase}
.rw-tile.is-owned .rw-state{color:#bfe325}
.rw-tile.is-locked .rw-state{color:#8f9ab4}
.rw-tile .sr-btn{width:100%;margin-top:2px}
.rw-soon{margin:22px auto 2px;text-align:center;font:700 13px/1.4 "Barlow Condensed",sans-serif;letter-spacing:.12em;text-transform:uppercase;
  color:#c8b06a;padding:12px 14px;border-top:1px dashed rgba(220,168,67,.35)}
@media(max-width:720px){
  .sr-modal{grid-template-columns:1fr;gap:18px;padding:26px 18px 22px;max-height:calc(100dvh - 24px)}
  .sr-preview{grid-column:1}.sr-side{grid-column:1}
  .sr-canvas{max-height:46dvh}
  .sr-head h2{font-size:21px}
}
'''

ea_css=ea_css.replace("__TROPHY_URI__",TROPHY_URI)

# ===== Bouton « Réinitialiser la partie » — COMPILÉ UNIQUEMENT EN MODE TEST =====
# En PROD, cette variable est vide : le bouton n'existe pas dans le fichier public -> impossible à utiliser.
if BUILD_MODE=="test":
    testreset_html = '''<style>
#__testModeBar{position:fixed;left:16px;bottom:16px;z-index:100000;display:flex;align-items:center;gap:10px;font-family:Inter,Arial,sans-serif}
#__testModeBar .__tm-badge{font:800 11px/1 "Barlow Condensed",Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#0b0f1e;background:linear-gradient(180deg,#ffd23f,#f0a500);padding:6px 10px;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.4)}
#__resetTestBtn{cursor:pointer;font:800 12px/1 "Barlow Condensed",Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#fff;padding:11px 16px;border-radius:11px;border:1px solid rgba(255,120,140,.8);background:linear-gradient(180deg,#ff5a70,#e0344b);box-shadow:0 10px 26px rgba(255,78,101,.4),inset 0 1px 0 rgba(255,255,255,.25);transition:transform .14s ease,box-shadow .16s ease,filter .14s ease}
#__resetTestBtn:hover{transform:translateY(-1px);filter:brightness(1.06);box-shadow:0 14px 30px rgba(255,78,101,.52)}
#__resetTestBtn:active{transform:translateY(0) scale(.97)}
</style>
<div id="__testModeBar" role="region" aria-label="Outils de test">
  <span class="__tm-badge">Mode test</span>
  <button id="__resetTestBtn" type="button" title="Efface la partie en cours et recharge le même joueur mystère">&#8635; Réinitialiser la partie</button>
</div>'''
else:
    testreset_html = ""

html=f'''<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jogadle 2 — Mode Carrière</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
{css}
{anim_css}
{jdj_css}
{daily_css}
{page_bg_css}
{ea_css}
{share_css}
</style></head>
<body>
<div class="jogadle-app" id="jogadle" data-level="amateur">
  <header class="game-header">
    <div class="concept-heading">
      <div class="concept-number" id="conceptNumber">4</div>
      <div class="concept-copy"><h1>IMPULSION &amp; ÉLÉVATION</h1><p>La carte sort de la ligne et se révèle avec impact</p></div>
    </div>
    <div class="game-heading">
      <div class="game-name">JOGADLE 2 · MODE CARRIÈRE</div>
      <div class="game-tagline">RETROUVE LE JOUEUR GRÂCE À SON PARCOURS</div>
    </div>
    <div class="current-level-badge" id="levelLabel">NIVEAU AMATEUR</div>
  </header>

  <div class="level-selector" id="levelSelector">{levelbtns}</div>

  <div class="daily-bar">
    <div class="daily-timer">
      <div class="dt-line"><span class="dt-label">NOUVEAUX JOUEURS DANS</span> <span class="dt-value" id="timerValue">--:--:--</span></div>
      <div class="dt-sub">Réinitialisation à minuit · Heure de Paris</div>
    </div>
    <div class="daily-links">
      <button type="button" class="daily-cal-link daily-cal-link--rewards" data-act="open-rewards"><span class="dcl-ic">★</span> CONSULTER MES RÉCOMPENSES</button>
      <button type="button" class="daily-cal-link" data-act="open-cal"><span class="dcl-ic">▦</span> JOUER LES DÉFIS PRÉCÉDENTS</button>
      <button type="button" class="daily-cal-link" data-act="open-yesterday"><span class="dcl-ic">◐</span> JOUEURS D’HIER</button>
    </div>
  </div>

  <section class="career-section">
    <div class="career-viewport">
      <div class="career-track" id="cards">
        <div class="career-line"><span class="career-line-fill" id="progress"></span></div>
        <div class="career-steps" id="careerSteps"></div>
      </div>
    </div>
  </section>

  <p class="career-caption">Une impulsion. Une élévation. Une révélation mémorable.</p>

  <section class="answer-section">
    <form class="answer-form" id="guessForm" autocomplete="off">
      <div class="autocomplete">
        <input class="guess-input" id="guessInput" type="text" name="guess" placeholder="Rechercher un joueur…" aria-label="Rechercher un joueur" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
        <div class="suggestions" id="suggestions" hidden></div>
      </div>
      <button class="validate-button" id="validateButton" type="submit">VALIDER</button>
    </form>
    <p class="game-message" id="message"></p>
    <section class="used-players" id="usedPlayers" hidden aria-live="polite">
      <div class="up-head"><span class="up-title">JOUEURS DÉJÀ UTILISÉS</span><span class="up-count" id="usedPlayersCount"></span></div>
      <div class="up-list" id="usedPlayersList"></div>
    </section>
  </section>

  <div class="game-controls">
    <button type="button" class="game-action-button hint-button" id="hintButton"><span class="button-icon diamond-icon">{diamond}</span> <span id="hintButtonText">INDICE ULTIME</span></button>
    <button type="button" class="game-action-button reveal-button" id="revealAnswerButton"><span class="button-icon">{eye}</span> RÉVÉLER LA RÉPONSE</button>
    <div class="player-clues" id="playerClues" hidden>
      <div class="clue-card clue-nat" id="clueCardNat"><span class="clue-label">INDICE 1 · NATIONALITÉ</span><span class="clue-value" id="clueNat">—</span></div>
      <div class="clue-card clue-pos" id="clueCardPos"><span class="clue-label">INDICE 2 · POSTE</span><span class="clue-value" id="cluePos">—</span></div>
    </div>
  </div>

  <div class="game-result" id="gameResult">
    <div id="simpleResult" class="result-reveal">
      <div class="result-kicker result-reveal-message" id="resultKicker">BRAVO !</div>
      <div class="result-name result-player-name" id="resultName"></div>
      <div class="result-player-photo-frame">
        <img class="result-photo result-player-photo" id="resultPhoto" alt="" hidden>
        <div class="result-photo-fallback" id="resultPhotoFallback" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="7.4" r="4.3" fill="currentColor"/><path d="M3.4 21.5c0-4.75 3.85-8.6 8.6-8.6s8.6 3.85 8.6 8.6z" fill="currentColor"/></svg></div>
      </div>
      <div class="photo-dims-hint" aria-hidden="true">Format idéal : <b>720 × 990 px</b> · portrait 8:11 · non recadrée</div>
      <button type="button" class="next-level-cta" id="nextLevelCta" data-act="next-level" hidden>
        <span class="nlc-text"><span class="nlc-kicker">Passe au</span><span class="nlc-target" id="nextLevelTarget">Niveau suivant</span></span>
        <span class="nlc-arrow" aria-hidden="true">→</span>
      </button>
    </div>
    <div id="eaExpert" hidden>
      <main class="expert-screen">
        <div class="expert-shell">
          <header class="expert-header">
            <div>
              <h1 class="expert-title">Le joueur du jour</h1>
              <p class="expert-subtitle">Pour aller plus loin</p>
            </div>
            <div class="level-chip">Expert</div>
          </header>
          <div class="expert-layout">
            <section class="left-column">
              <div class="portrait-stage cut-panel">
                <img class="portrait-glow" id="portrait-glow" alt="" aria-hidden="true">
                <div class="portrait-veil" aria-hidden="true"></div>
                <div class="portrait-label">Portrait</div>
                <div class="portrait-frame cut-panel">
                  <img class="portrait-image" id="portrait-image" alt="Portrait du joueur du jour">
                </div>
              </div>
              <section class="career-block">
                <h2 class="section-title">Son parcours en club</h2>
                <div class="carousel-shell">
                  <button class="carousel-button prev" type="button" data-scroll="clubs" data-direction="-1" aria-label="Clubs précédents"></button>
                  <div class="club-viewport" id="club-viewport" tabindex="0"><div class="club-track" id="club-track"></div></div>
                  <button class="carousel-button next" type="button" data-scroll="clubs" data-direction="1" aria-label="Clubs suivants"></button>
                </div>
              </section>
            </section>
            <section class="right-panel cut-panel">
              <h2 class="player-name" id="player-name"></h2>
              <p class="player-summary" id="player-summary"></p>
              <div class="red-mark" aria-hidden="true"></div>
              <h3 class="panel-heading">3 choses à retenir</h3>
              <div class="facts" id="facts"></div>
              <section class="honours-section">
                <div class="honours-topline"><div><h3 class="panel-heading">Palmarès principal</h3><div class="honours-count" id="honours-count"></div></div></div>
                <div class="carousel-shell honours-carousel">
                  <button class="carousel-button prev" type="button" data-scroll="honours" data-direction="-1" aria-label="Trophées précédents"></button>
                  <div class="honour-viewport" id="honour-viewport" tabindex="0"><div class="honour-track" id="honour-track"></div></div>
                  <button class="carousel-button next" type="button" data-scroll="honours" data-direction="1" aria-label="Trophées suivants"></button>
                </div>
              </section>
              <div class="ea-actions">
                <button type="button" class="ea-btn ea-btn--red" data-act="share">Partager mon résultat</button>
                <button type="button" class="ea-btn" data-act="open-cal">Jouer les défis précédents</button>
                <button type="button" class="ea-btn" data-act="open-yesterday">Voir les joueurs d’hier</button>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
    <div id="jdjPanel" hidden>
      <div id="rdsWrap"><div class="rds-stage" id="rdsStage">
        <div class="rds-bg"></div>
        <div class="rds-panel">
          <header class="rds-hero"><h1>LE JOUEUR DU JOUR</h1><p>POUR ALLER PLUS LOIN</p></header>
          <div class="rds-grid">
            <section class="rds-left">
              <div class="player-visual-stage" id="rdsStageVisual">
                <div class="stage-atmosphere" aria-hidden="true"></div>
                <div class="stage-halo" aria-hidden="true"></div>
                <div class="glass-aura glass-aura--left" aria-hidden="true"></div>
                <article class="career-glass career-glass--left">
                  <div class="glass-inner-fade" aria-hidden="true"></div>
                  <div class="career-glass__title">PARCOURS</div>
                  <div class="career-feed" id="rdsFeedL"></div>
                </article>
                <div class="glass-aura glass-aura--right" aria-hidden="true"></div>
                <article class="career-glass career-glass--right">
                  <div class="glass-inner-fade" aria-hidden="true"></div>
                  <div class="career-glass__title"><span id="rdsPanelRTitle">REPÈRES</span></div>
                  <div class="stats-feed" id="rdsFeedR"></div>
                </article>
                <figure class="player-cutout"><img class="player-cutout__image" id="rdsCutoutImg" alt=""></figure>
                <div class="player-ground-light" aria-hidden="true"></div>
                <figure class="classic-portrait" id="rdsClassic"><span class="rds-portrait-label">IMAGE WIKIDATA</span><img id="rdsPortrait" alt=""></figure>
              </div>
              <div class="rds-journey"><div class="rds-rule">SON PARCOURS EN CLUB</div>
                <div class="rds-clubs-nav" id="rdsClubsNav"><div class="rds-clubs-vp"><div class="rds-clubs" id="rdsClubs"></div></div></div>
              </div>
            </section>
            <div class="rds-sep"></div>
            <section class="rds-right">
              <h2 id="rdsTitle" class="rds-name-title"></h2>
              <p class="rds-intro" id="rdsIntro"></p>
              <div class="rds-redrule"><i></i></div><h3>3 CHOSES À RETENIR</h3>
              <div id="rdsPoints"></div>
              <div class="rds-redrule"><i></i></div><h3>PALMARÈS PRINCIPAL</h3>
              <div class="rds-stats" id="rdsStats"></div>
              <div class="rds-palm-extra" id="rdsPalmExtra"></div>
            </section>
          </div>
        </div>
      </div></div>
    </div>
    <div id="resultActions" class="result-actions">
      <button type="button" class="rds-action rds-action--share" data-act="share"><span class="ra-ic">⤴</span> PARTAGER MON RÉSULTAT</button>
      <button type="button" class="rds-action rds-action--cal" data-act="open-cal"><span class="ra-ic">▦</span> JOUER LES DÉFIS PRÉCÉDENTS</button>
      <button type="button" class="rds-action rds-action--yd" data-act="open-yesterday"><span class="ra-ic">◐</span> VOIR LES JOUEURS D’HIER</button>
    </div>
  </div>

  <footer class="game-footer">TOMSOFOOT.FR — @TOMSO-FOOT</footer>

  <div class="cal-overlay" id="jogadleCalendar" aria-hidden="true">
    <div class="cal-modal">
      <div class="cal-top">
        <div class="cal-title">ARCHIVES JOGADLE</div>
        <button type="button" class="cal-close" data-act="close-cal" aria-label="Fermer">✕</button>
      </div>
      <div class="cal-nav">
        <button type="button" class="cal-arrow" data-act="cal-prev" aria-label="Mois précédent">‹</button>
        <div class="cal-month" id="calMonthLabel"></div>
        <button type="button" class="cal-arrow" data-act="cal-next" aria-label="Mois suivant">›</button>
      </div>
      <div class="cal-filters" id="calFilters">
        <button type="button" data-filter="all">Toutes</button>
        <button type="button" data-filter="amateur">Amateur</button>
        <button type="button" data-filter="pro">Pro</button>
        <button type="button" data-filter="expert">Expert</button>
        <button type="button" data-filter="won">Réussies</button>
        <button type="button" data-filter="lost">Manquées</button>
        <button type="button" data-filter="none">Non jouées</button>
      </div>
      <div class="cal-grid" id="calGrid"></div>
      <div class="cal-legend"><span><i class="lg win"></i>Réussi</span><span><i class="lg fail"></i>Échoué</span><span><i class="lg np"></i>Non joué</span><span><i class="lg future"></i>À venir</span></div>
      <div class="cal-detail" id="calDetail" hidden></div>
      <div class="cal-stats" id="calStats"></div>
    </div>
  </div>
  <div class="browse-overlay" id="browseOverlay" aria-hidden="true">
    <div class="browse-modal">
      <div class="browse-head">
        <div class="browse-head-row">
          <div><div class="browse-title">CHOISIR UN JOUEUR</div><div class="browse-sub" id="browseCount"></div></div>
          <button type="button" class="browse-close" data-act="browse-close" aria-label="Fermer">✕</button>
        </div>
        <input class="browse-search" id="browseInput" type="text" placeholder="Rechercher parmi les joueurs…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <div class="browse-az" id="browseAZ"></div>
      </div>
      <div class="browse-list" id="browseList"><div class="browse-inner" id="browseInner"></div></div>
    </div>
  </div>
  <div class="yd-overlay" id="yesterdayOverlay" aria-hidden="true">
    <div class="yd-modal">
      <div class="yd-top">
        <div class="yd-title-2">LES JOUEURS D’HIER</div>
        <button type="button" class="cal-close" data-act="yd-close" aria-label="Fermer">✕</button>
      </div>
      <div class="yd-date-2" id="ydDate"></div>
      <div class="yd-note-2">Les réponses restent cachées : choisis niveau par niveau de jouer l’archive ou de révéler le joueur.</div>
      <div class="yd-cards" id="ydCards"></div>
      <div class="yd-foot"><button type="button" class="yd-revealall" id="ydRevealAll" data-act="yd-confirm">TOUT RÉVÉLER</button></div>
      <div class="yd-confirm" id="ydConfirm" hidden>
        <div class="yd-confirm-box">
          <p>Les trois joueurs d’hier vont être révélés. Vous ne pourrez plus les découvrir sans connaître les réponses. Continuer ?</p>
          <div class="yd-confirm-actions">
            <button type="button" class="yd-cbtn yd-cancel" data-act="yd-cancel">ANNULER</button>
            <button type="button" class="yd-cbtn yd-go" data-act="yd-revealall">RÉVÉLER LES JOUEURS</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="replay-banner" id="replayBanner" hidden><span id="replayBannerText"></span><button type="button" class="replay-exit" data-act="exit-replay">Revenir au jour ↩</button></div>
  <!-- ===== POP-UP DE PARTAGE (dédié, séparé de toute navigation entre jeux) ===== -->
  <div class="sr-overlay" id="shareResultOverlay" aria-hidden="true">
    <div class="sr-modal" role="dialog" aria-modal="true" aria-labelledby="srTitle" id="shareResultModal">
      <button type="button" class="sr-close" data-act="sr-close" aria-label="Fermer la fenêtre de partage">✕</button>
      <div class="sr-preview">
        <canvas id="srCanvas" class="sr-canvas" width="1182" height="1330" role="img" aria-label="Aperçu de la carte de partage Jogadle"></canvas>
      </div>
      <div class="sr-side">
        <div class="sr-head">
          <h2 id="srTitle">Partager mon résultat</h2>
          <p>Personnalise le nom affiché sur ta carte.</p>
        </div>
        <div class="sr-identity" id="srIdentity"></div>
        <div class="sr-actions">
          <button type="button" class="sr-btn sr-btn--primary" data-act="sr-share">Partager l’image</button>
          <button type="button" class="sr-btn" data-act="sr-download">Télécharger le PNG</button>
          <button type="button" class="sr-btn" data-act="sr-copy">Copier mon score</button>
        </div>
        <p class="sr-hint" id="srHint" role="status" aria-live="polite"></p>
      </div>
    </div>
  </div>

  <!-- ===== Galerie « Mes récompenses » : cartes obtenues (téléchargeables) + à débloquer (floutées) ===== -->
  <div class="rw-overlay" id="rewardsOverlay" aria-hidden="true">
    <div class="rw-modal" role="dialog" aria-modal="true" aria-labelledby="rwTitle" id="rewardsModal">
      <button type="button" class="sr-close rw-close" data-act="rw-close" aria-label="Fermer">✕</button>
      <div class="rw-head">
        <h2 class="rw-title" id="rwTitle">Mes récompenses</h2>
        <p class="rw-sub" id="rwSub"></p>
      </div>
      <div class="rw-grid" id="rewardsGrid"></div>
      <div class="rw-soon">D’autres cartes à collectionner arrivent bientôt.</div>
    </div>
  </div>

  <!-- ===== Création de l'identité de collectionneur (une seule fois, double confirmation) ===== -->
  <div class="id-overlay" id="identityOverlay" aria-hidden="true">
    <div class="sr-modal id-modal" role="dialog" aria-modal="true" aria-labelledby="idKicker" id="identityModal">
      <div id="idStep1">
        <div class="id-head">
          <div class="cu-kicker" id="idKicker">Créez votre identité de collectionneur</div>
          <p class="id-desc">Ce nom apparaîtra sur toutes vos cartes Jogadle. Vérifiez-le attentivement : vous ne pourrez plus le modifier après confirmation.</p>
        </div>
        <div class="id-body">
          <div class="sr-preview id-preview"><canvas id="idCanvas" class="sr-canvas" width="1182" height="1330" role="img" aria-label="Aperçu de la carte"></canvas></div>
          <div class="id-side">
            <div class="sr-field">
              <label class="sr-label" for="idName">Nom ou pseudo</label>
              <input type="text" id="idName" class="sr-input" maxlength="16" autocomplete="off" spellcheck="false" inputmode="text" placeholder="JOUEUR" aria-describedby="idCount">
              <div class="sr-count" id="idCount" aria-live="polite">0 / 16</div>
            </div>
            <button type="button" class="sr-btn sr-btn--primary" id="idConfirm1" data-act="id-confirm1" disabled>Confirmer définitivement</button>
          </div>
        </div>
      </div>
      <div id="idStep2" hidden>
        <div class="id-confirm2">
          <div class="cu-kicker">Confirmer ce pseudo ?</div>
          <div class="id-bigname" id="idBigName">JOUEUR</div>
          <p class="id-desc">Ce pseudo deviendra votre identité officielle de collectionneur et apparaîtra sur toutes vos cartes. Vous ne pourrez plus le modifier vous-même.</p>
          <p class="sr-hint is-warn" id="idHint2" role="status" aria-live="polite"></p>
          <div class="id-actions2">
            <button type="button" class="sr-btn" data-act="id-back">Revenir et corriger</button>
            <button type="button" class="sr-btn sr-btn--primary" id="idConfirm2" data-act="id-confirm2">Oui, confirmer définitivement</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== Déblocage de la carte du jour (animation premium, une seule fois) ===== -->
  <div class="cu-overlay" id="cardUnlockOverlay" aria-hidden="true">
    <div class="cu-modal" role="dialog" aria-modal="true" aria-labelledby="cuTitle">
      <button type="button" class="sr-close cu-close" data-act="cu-close" aria-label="Fermer">✕</button>
      <div class="cu-rays" aria-hidden="true"></div>
      <div class="cu-kicker">Nouvel archétype débloqué</div>
      <h2 class="cu-title" id="cuTitle">L’Entrée des Gladiateurs</h2>
      <div class="cu-cardwrap"><canvas id="cuCanvas" class="cu-card" width="1182" height="1330" role="img" aria-label="Ta carte Jogadle"></canvas></div>
      <div class="cu-actions">
        <button type="button" class="sr-btn sr-btn--primary" data-act="cu-view">Voir ma carte</button>
      </div>
    </div>
  </div>

  <div class="share-toast" id="shareToast"></div>
</div>
{testreset_html}
<script defer src="game.js"></script>
</body></html>'''
_out={"test":"/tmp/Jogadle2-Mode-Carriere-TEST.html","prod":"/tmp/Jogadle2-Mode-Carriere-PROD.html"}[BUILD_MODE]
open("/tmp/jogadle-complet.html","w",encoding="utf-8").write(html)   # copie de travail (dernier build)
open(_out,"w",encoding="utf-8").write(html)
# Phase 1 : le gros script est émis en fichier EXTERNE (chargé en `defer`) pour que la coquille
# (barre du jour, minuteur, recherche) s'affiche immédiatement au lieu d'un écran figé.
open(os.path.join(os.path.dirname(_out),"game.js"),"w",encoding="utf-8").write(js)
print("MODE=",BUILD_MODE,"| TESTFIX=",TESTFIX_JS,"| written",len(html),"chars ->",round(len(html)/1048576,2),"Mo ->",_out)
