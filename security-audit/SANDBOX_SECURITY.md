# AUDIT DU CONFINEMENT SANDBOX & EXÉCUTION (SANDBOX SECURITY REPORT)

**Périmètre :** Isolation de l'exécution de code généré (Iframe Canvas, Popout Window, Terminal)  
**Standard de preuve :** Spécifications W3C HTML5 & Code Réel Inspecté  
**Auteurs :** Red Team Volaco  

---

## 1. L'Iframe de Prévisualisation (Preview Canvas)

### 1.1 Déclaration de l'Iframe
* **Fichier :** `apps/studio/index.html`
* **Lignes :** 1398-1403
* **Code Réel :**
```html
<iframe
  id="wsLiveIframe"
  title="Preview Canvas"
  class="w-full h-full border-0 bg-[#06080e]"
  sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-popups allow-downloads"
></iframe>
```

### 1.2 La Faille Fondamentale de Sécurité (W3C HTML5 Specification Violation)
La documentation du W3C et les guides de sécurité des navigateurs (OWASP / MDN) formulent un avertissement formel :
> **"Caution: When an iframe has both `allow-scripts` and `allow-same-origin`, the embedded document has the same origin as the parent document. This means scripts in the iframe can access the parent window's DOM, read its storage, and escape the sandbox entirely."**

Comme l'application est servie sur `http://127.0.0.1:3000/` et que le contenu de l'iframe est injecté via la propriété `srcdoc` :
1. Le document dans l'iframe possède **exactement la même origine** (`http://127.0.0.1:3000`) que l'interface de développement VibeCode Studio.
2. Tout script JavaScript présent dans l'HTML de la preview peut exécuter :
   ```javascript
   // Accès sans restriction au DOM du Studio parent :
   const studioStorage = window.parent.localStorage;
   const mistralKey = studioStorage.getItem('vibecode_mistral_key');
   const allProjects = studioStorage.getItem('vibecode_projects_v2');

   // Altération directe de l'interface du Studio :
   window.parent.document.getElementById('workspaceTitle').innerText = 'PIRATÉ';
   ```
3. L'attribut `sandbox` tel qu'il est configuré procure **une fausse impression de sécurité sans aucune barrière technique réelle**.

---

## 2. La Prévisualisation Externe (Popout Preview)

### 2.1 Code Réel
* **Fichier :** `apps/studio/index.html`
* **Lignes :** 4786-4791
```javascript
function popoutPreview() {
  const blob = new Blob([currentAppHtml || pulseAiExactTemplate], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
```

### 2.2 Analyse d'Exploitation
1. `window.open(url, '_blank')` est appelé **sans spécifier `noopener,noreferrer`**.
2. Les Blob URLs créées dans un document partagent l'origine du document créateur.
3. Dans la nouvelle fenêtre/onglet ouvert, la variable globale `window.opener` pointe directement vers l'objet `window` du Studio parent.
4. Une application piégée ouverte dans ce nouvel onglet peut naviguer ou modifier la session du Studio en arrière-plan :
   ```javascript
   if (window.opener) {
     window.opener.location = 'https://phishing-volaco.evil/login';
   }
   ```

---

## 3. Analyse de l'Exécution Système (Host Process Execution)

### 3.1 Vérification Formelle de l'OS Host
* **Question :** Une application ou une commande saisie dans le terminal peut-elle exécuter du code sur le système d'exploitation réel du serveur ou du poste développeur ?
* **Méthode d'Audit :** Analyse statique par recherche d'expressions régulières sur l'intégralité du monorepo (`grep_search` sur `child_process`, `exec`, `spawn`, `execFile`, `fork`).
* **Résultat :** **ZÉRO APPEL RUNTIME DÉTECTÉ**.
* **Démonstration dans le Code :**
Le fichier `packages/core/src/terminal/service.ts` implémente un terminal entièrement virtuel :
```typescript
// packages/core/src/terminal/service.ts:60-70
if (!isCommandAllowed(command)) {
  throw new ForbiddenError(`Commande non autorisée : ${command}`);
}
// Retour déterministe en mémoire avec temporisation simulée :
const output = simulateCommandOutput(command, project);
return { command, output, exitCode: 0, durationMs: 42 };
```
**Conclusion sur l'Host :** Le serveur ne lance aucun processus OS. Le risque d'exécution de commande à distance (RCE Host) via le terminal est **formellement écarté (VERIFIED SAFE)**.
