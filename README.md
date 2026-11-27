# Confidences

Application web pour créer des messages privés sous forme de diaporama (texte, image ou les deux), page par page, et les partager via un simple lien ou un QR code.

Site statique en JavaScript natif (pas de framework, pas de build) + Firebase (Auth, Firestore uniquement — pas de Storage).

## Fonctionnement

- **Authentification** : connexion avec Google (Firebase Auth). Seul le créateur peut créer/modifier/supprimer ses confidences.
- **Création** : chaque confidence est un diaporama composé de pages ("diapos"). Pour chaque page on choisit :
  - l'orientation (portrait ou paysage) — elle est commune à toute la confidence : toutes les pages suivent l'orientation de la première
  - l'arrière-plan : une couleur ou une image
  - le texte, écrit en **Markdown** (titres, gras, italique, barré, surligné, listes, citations, liens, séparateurs, code), avec sa police, sa couleur, sa taille et sa position. Une barre d'outils et des raccourcis (Ctrl/⌘+B, I, K) aident à la mise en forme, et l'aperçu interprète le Markdown en direct. Le HTML saisi n'est jamais interprété et seuls les liens `http(s)`, `mailto` et `tel` sont acceptés
  - une image à afficher, son format (remplir / ajuster), sa **position** (boutons Haut / Centre / Bas et deux curseurs horizontal / vertical, centrés par défaut ; les boutons déplacent aussi les curseurs, un double-clic sur un curseur le recentre ; en mode « Remplir » pleine taille, les curseurs choisissent la partie de la photo affichée), sa **taille** (curseur de 10 à 100 % de la page) et un **contour** optionnel (épaisseur réglable au curseur et couleur au choix). Avec « Ajuster », le contour épouse l'image entière ; avec « Remplir », il entoure le cadre. Taille et épaisseur sont proportionnelles à la page : le rendu est identique en miniature, dans l'aperçu et en plein écran
  - une **transition** jouée à l'arrivée sur la page (aucune, fondu, glissement, montée, zoom, pivot, flou) et sa vitesse (rapide, normale, lente). Le bouton « Tester dans l'aperçu » la rejoue depuis la page précédente, et « Appliquer à toutes les pages » l'étend à toute la confidence. En revenant en arrière, l'effet est joué à l'envers. Les nouvelles pages utilisent un fondu par défaut ; les pages existantes n'ont pas de transition. Si le système demande de réduire les animations, un fondu bref est utilisé

  **Couleurs** : chaque champ couleur combine le sélecteur du système, une saisie en **HEX** (`#E91E63`, `e91e63` ou la forme courte `#FC0` ; l'aperçu se met à jour dès que le code est complet, une saisie invalide revient à la couleur précédente) et un bouton ▾ qui affiche les **couleurs récentes** (les 12 dernières validées, mémorisées dans le navigateur pour chaque compte) ainsi que les couleurs déjà utilisées dans la confidence.

  **Nouvelle page** : le bouton « + » insère la page juste après celle affichée, et elle reprend ses couleurs : fond (couleur, ou image de fond — qui est alors dupliquée ; s'il n'y a plus la place, seule la couleur est reprise), couleur du texte et fond du texte.

  **Transparence** : les images sans fond (PNG, WebP… avec canal alpha) restent transparentes. Elles sont réencodées en WebP transparent, ou en PNG sur Safari, qui ne sait pas produire de WebP (le JPEG, sans transparence, n'est utilisé que pour les images opaques). Une image de fond transparente laisse voir la couleur de fond choisie. Les miniatures d'import affichent un damier pour rendre la transparence visible.

  **Dupliquer une page** : chaque miniature porte, en haut à droite, un bouton de duplication. La copie (texte, mise en forme, images, transition) est insérée juste après l'original et devient la page active. Comme les images sont stockées dans le document, la copie les duplique ; si la confidence dépassait alors la limite de taille, l'application propose de dupliquer la page sans ses images.

  L'ordre des pages se modifie avec les flèches ↑ / ↓ sous l'aperçu, ou par **glisser-déposer** dans la bande de miniatures : à la souris, on attrape une miniature et on la fait glisser ; sur mobile, on maintient le doigt appuyé sur une miniature (~0,35 s) puis on la fait glisser. La bande défile automatiquement près des bords et Échap annule le déplacement.

  Chaque photo (image affichée ou image de fond) peut venir :
  - d'un **fichier** de l'appareil ;
  - de la **caméra** : sur téléphone et tablette, l'appareil photo natif s'ouvre ; sur ordinateur, une fenêtre montre l'aperçu de la webcam (avec changement de caméra s'il y en a plusieurs). La caméra demande une connexion HTTPS (ou `localhost`) et l'autorisation du navigateur ;
  - d'un **lien** : l'image est téléchargée puis copiée dans la confidence, comme un fichier. Elle reste donc visible si le lien disparaît, et le site d'origine ne voit jamais les lecteurs. Le site doit autoriser cette récupération (CORS) — c'est le cas de nombreux hébergeurs d'images, pas de tous ; sinon un message invite à enregistrer l'image puis à l'importer comme fichier.

  Les images sont compressées dans le navigateur puis stockées directement dans Firestore (en base64), il n'y a pas de Firebase Storage à activer ni à payer.
- **Catégories** : le bouton « pile » du tableau de bord ouvre une fenêtre pour créer, renommer (clic sur le nom) et supprimer des catégories — par personne, par thème… Le tableau de bord affiche une ligne par catégorie, avec ses confidences côte à côte (la ligne défile horizontalement), puis une ligne « Sans catégorie ». Pour ranger une confidence :
  - dans l'éditeur, avec le sélecteur « Catégorie » (qui permet aussi d'en créer une à la volée) ;
  - par **glisser-déposer** d'une carte vers une autre ligne (souris, ou appui long puis glisser sur mobile ; la page défile près des bords, Échap annule) ;
  - en créant directement la confidence depuis une ligne, avec son bouton « + Nouvelle ».

  Supprimer une catégorie ne supprime aucune confidence : elles repassent « Sans catégorie ». Sans aucune catégorie, le tableau de bord garde sa grille simple. Ranger une confidence ne change pas sa date de modification.
- **Partage** : un lien (`view.html?id=...`) est généré automatiquement. Un nom donné à la confidence ne sert qu'à la retrouver dans son propre tableau de bord. Un QR code est aussi généré pour chaque confidence (bouton "QR code"), avec téléchargement en PNG.
- **Lecture** : quiconque possède le lien peut lire le diaporama, sans se connecter. On tape à droite/gauche de l'écran (ou on glisse le doigt) pour passer à la page suivante/précédente. Sur téléphone ou tablette, si l'écran n'est pas dans le sens des pages (téléphone vertical pour une confidence en paysage, ou l'inverse), un pictogramme animé propose de pivoter l'appareil. Il disparaît de lui-même au bout de 2 secondes, dès que l'écran est dans le bon sens, ou dès qu'on passe à la page suivante, et ne réapparaît plus ensuite ; il ne bloque jamais la navigation.
- **Statistiques** : le créateur voit, dans l'éditeur, le nombre de vues et, pour chaque consultation : la date et l'heure, la **progression** (page la plus loin atteinte, ou « Lue en entier »), la **durée de lecture** (temps passé avec l'onglet visible) et le **type d'appareil** (mobile, tablette ou ordinateur, déduit de l'écran). Un résumé indique combien de lectures sont allées jusqu'au bout, la durée médiane et la répartition des appareils (sur les 50 dernières consultations). Aucune donnée permettant d'identifier le lecteur n'est collectée (ni adresse IP, ni identifiant). La progression et la durée sont envoyées au fil de la lecture (changement de page, toutes les 15 s, et quand l'onglet est masqué) ; une fermeture brutale peut donc faire perdre les toutes dernières secondes. Les consultations enregistrées avant cette version n'affichent que leur date.
- **Aperçu du créateur** : quand le créateur (connecté avec le même compte, dans le même navigateur) ouvre sa confidence, la lecture **n'est pas comptée**. Une barre « Créateur · non compté » apparaît en bas du lecteur avec un sélecteur pour aller directement à n'importe quelle page. Le bouton « ▶ Aperçu » de l'éditeur ouvre la lecture à la page en cours d'édition (`view.html?id=...&slide=3`) ; ce paramètre `slide` n'est appliqué que pour le créateur, les lecteurs commencent toujours à la première page.
- **Mobile first** : toute l'interface est pensée d'abord pour mobile, puis adaptée aux écrans plus larges. L'application installée (PWA) n'impose aucune orientation (`"orientation": "any"` dans le manifest) : on peut tourner l'appareil, ce qui est indispensable pour lire une confidence en paysage.

## Structure du projet

```
Confidences/
├── index.html          # application (connexion, tableau de bord, éditeur)
├── view.html           # lecteur public (aucune authentification requise)
├── manifest.webmanifest
├── firebase.json
├── .firebaserc
├── firestore.rules
├── firestore.indexes.json
├── css/
│   ├── style.css       # styles partagés (app + rendu des diapos)
│   └── reader.css       # styles du lecteur plein écran
├── js/
│   ├── firebase-config.js
│   ├── auth.js
│   ├── presentations.js # CRUD Firestore (confidences, vues)
│   ├── image-utils.js   # compression d'image côté navigateur (vers base64)
│   ├── categories.js    # catégories de confidences (Firestore)
│   ├── category-dnd.js  # glisser-déposer des cartes vers une catégorie
│   ├── color-field.js   # champ couleur : saisie HEX + couleurs récentes
│   ├── image-sources.js # sources d'image : caméra (aperçu webcam) et import depuis un lien
│   ├── slide-render.js  # rendu d'une page, partagé éditeur + lecteur
│   ├── slide-reorder.js # glisser-déposer des miniatures (souris + appui long tactile)
│   ├── transitions.js   # transitions entre pages (Web Animations API), éditeur + lecteur
│   ├── markdown.js      # moteur Markdown sans dépendance (HTML échappé)
│   ├── app.js            # logique de index.html
│   └── reader.js         # logique de view.html
└── icons/
```

## Mise en place Firebase

Le projet est déjà relié au projet Firebase `confidences-2dd1d` (voir `js/firebase-config.js` et `.firebaserc`). Dans la [console Firebase](https://console.firebase.google.com/project/confidences-2dd1d) :

1. **Authentication** → Sign-in method → activer **Google**.
2. **Authentication** → Settings → Authorized domains → ajouter votre domaine d'hébergement (et `localhost` pour les tests).
3. **Firestore Database** → créer la base (mode production), puis déployer les règles fournies :
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

### Modèle de données

- `users/{uid}` : `categories` (liste ordonnée de `{ id, name }`, 50 au maximum), `updatedAt`.
- `presentations/{id}` : `ownerId`, `ownerEmail`, `title`, `categoryId` (ou `null`), `slides` (tableau de pages — les images y sont stockées en base64 ; chaque page porte notamment `image.posX` / `image.posY` (0–100 %), `image.scale`, `image.borderWidth`, `image.borderColor` et `transition: { type, speed }`), `viewCount`, `createdAt`, `updatedAt`.
- `presentations/{id}/views/{viewId}` : `viewedAt`, `lastActiveAt`, `device` (`mobile` / `tablette` / `ordinateur`), `slideCount`, `maxSlide`, `completed`, `durationMs` — un document par consultation.

### Règles de sécurité

- Une confidence ne peut être **lue par son identifiant exact** que par son propriétaire (gestion) ou par le lecteur public (`get`, sans possibilité de lister toutes les confidences). C'est le même principe qu'un lien de partage "privé mais non listé" (comme un Google Doc "toute personne disposant du lien").
- Le document `users/{uid}` (catégories) n'est lisible et modifiable que par ce compte.
- Seul le propriétaire peut créer, modifier ou supprimer ses confidences ; n'importe qui disposant du lien peut uniquement faire avancer le compteur de vues (`viewCount`).
- Une consultation est créée avec des champs strictement contrôlés ; ensuite, le lecteur ne peut que faire **avancer** sa progression et sa durée (jamais les diminuer, ni dépasser le nombre de pages ou 24 h). Seul le propriétaire peut lire l'historique, et le supprimer avec la confidence.

## Lancer en local

Aucun build n'est nécessaire, mais les imports `type="module"` et Firebase exigent de servir les fichiers via HTTP (pas `file://`). Par exemple :

```bash
npx serve .
# ou
firebase emulators:start --only hosting
```

Puis ouvrir `http://localhost:<port>/index.html`.

## Déploiement

```bash
firebase deploy --only hosting,firestore
```

## Limites connues

- La taille et le contour des images utilisent les unités de conteneur CSS (`cqw`, `cqh`, `cqmin`) : Chrome/Edge 105+, Safari 16+, Firefox 110+.
- Le créateur n'est reconnu que s'il est connecté dans le navigateur où il ouvre le lien : depuis un autre appareil non connecté, sa lecture est comptée comme celle de n'importe quel lecteur.
- Les polices additionnelles sont chargées depuis Google Fonts (CDN).
- Le QR code est généré via la librairie `qrcodejs` (CDN cdnjs).
- Les images sont compressées et réencodées côté navigateur (WebP, ou JPEG sur Safari ; 1280 px de côté max) et stockées en base64 directement dans le document Firestore. **Firestore limite un document à 1 Mio : c'est une limite technique**, pas un réglage. L'application vise 1 000 000 d'octets (marge pour les autres champs). Chaque image est plafonnée à ~240 Ko ; quand la place restante est plus faible, l'image est automatiquement recompressée (qualité puis définition) pour tenir dans l'espace disponible. Ce n'est que lorsque la confidence est vraiment pleine qu'un message invite à retirer ou remplacer une image. C'est le compromis nécessaire pour ne pas dépendre de Firebase Storage.
