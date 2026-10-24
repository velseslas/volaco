# AUDIT CHAÎNE CONVERSATION → IA → PREVIEW (14/10/2026, preuves en base)

## 1. Footer en haut : cause trouvée, corrigée (`67ec4e3`)
- **Fait :** révision #54 (dernière, "fleuriste") : `header > footer > hero > menu > reservation` **dans le fichier sauvegardé**.
- **Cause :** le modèle a émis le footer en 2e, le serveur a assemblé **dans l'ordre d'émission sans normalisation**. Aucune garde d'ordre n'existait.
- **Piste écartée honnêtement :** l'insertion par ancre (`after=`) — testée en isolé, le moteur regex se rattrape via son ancre de fin. Pas le coupable ici.
- **Fix :** ordre canonique stable au chemin création (header 0, hero 10, contenu 20, fermeture 30, footer 100 ; inconnus stables ; ancres explicites respectées). Chemin modification inchangé (l'ordre établi est préservé).
- Les autres inversions en base (`hero` en fin sur de vieux projets) datent d'avant et restent des fossiles, pas des régressions.

## 2. Panneau ≠ onglet : double génération + onglet vieux
- **Prouvé :** même prompt dans 2 sessions, fichiers écrits à 2 s d'intervalle, révisions par paires (#45+#46, #47+#48, #49+#50) — le chat ET le Builder lançaient chacun leur génération (paire non-conforme systématique : l'une suit les nouvelles règles, l'autre non — aléa du modèle).
- **Corrigé :** `80c5670` (relai unique) + `dc10523`/`f312928` (projet suivi). **Non vérifié côté client :** requiert onglet rechargé (Ctrl+F5) + serveur redémarré.
- **Résiduel connu :** vieilles révisions pairées non-conformes en base (fossiles).

## 3. Images hors sujet : mécanisme identifié
- L'ID Unsplash `photo-1511920170033` (café !) resservi pour pâtisserie ET tapis : l'IA récite une photo par cœur.
- **Corrigé en amont :** `c9a09b5` (source à mots-clés imposée, IDs de mémoire interdits) — déjà visible en prod (#45 tapis→`clean,carpet`, #51→`medical,clinic`, #52→`veterinary,clinic`).
- **Résiduel :** observance stochastique (runs #46/#48 non conformes au même prompt) + repli picsum générique. Prochaine étape si besoin : vérification vision (coûteuse), sinon statu quo documenté.

## 4. Carte de la chaîne (qui écrit quoi)
- **Chat** : assemble `assembledHtml` (ordre d'arrivée → désormais canonique), `currentAppHtml`, sauvegarde FileStore, poste standalone pour l'onglet.
- **Builder** : moteur à composants depuis les frames relayées (plus de flux propre), recharge serveur sur `sync-project`.
- **Serveur** : `serverSections` → assemblage → `dedupe` → shell → `addImageFallbacks` → FileStore + révision + gate.
- **Règle d'or :** UNE génération par message (relai), UN projet suivi (pont+handshake), UN ordre (canonique), UNE source fichier (FileStore).

## 5. À valider côté utilisateur (serveur redémarré + Ctrl+F5)
1. Une génération → UNE seule révision (fini les paires).
2. Panneau = onglet (même projet, même contenu).
3. Footer toujours dernier, même si le modèle l'émet en vrac.
4. Photos à mots-clés la plupart du temps (aléa résiduel accepté).
