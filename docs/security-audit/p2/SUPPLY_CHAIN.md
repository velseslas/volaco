# AUDIT DE LA CHAÎNE D'APPROVISIONNEMENT (SUPPLY CHAIN)
## VOLACO-CORE — INTÉGRITÉ SRI ET DÉPENDANCES TIERCES

### 1. Intégrité des Sous-Ressources (SRI)
Toutes les dépendances chargées depuis des CDN externes comportent un hachage cryptographique Subresource Integrity SHA-512 valide :
- `html2canvas 1.4.1` : `sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA==`
- `jszip 3.10.1` : `sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==`
- `FontAwesome 6.4.0` : `sha512-iecdLmaskl7CVkqkXNQ/ZH/XLlvWZOJyj7Yy7tcenmpD1ypASozpmT/E0iPtmFIB46ZmdtAc9eNBvH0H/ZpiBw==`

### 2. Élimination du CDN Tailwind Dynamique
- Le script tiers `https://cdn.tailwindcss.com` qui compilait dynamiquement sans condensat SRI a été complètement éliminé du `<head>` de Studio.
- Utilisation prioritaire du fichier local embarqué `tailwindcss.min.js` doublé d'un miroir statique sécurisé sur `gstatic.com`.

### 3. Parité Binaire Studio
- La parité binaire byte-for-byte entre `apps/studio/index.html` et `volaco_studio.html` est vérifiée à 100% (Quality Gate 2 Check 7).
