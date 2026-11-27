# Confidences

Application web pour créer des messages privés sous forme de diaporama (texte, image ou les deux), page par page, et les partager via un simple lien ou un QR code.

Site statique en JavaScript natif (pas de framework, pas de build) + Firebase (Auth, Firestore uniquement — pas de Storage).

## Fonctionnement

- **Authentification** : connexion avec Google (Firebase Auth). Seul le créateur peut créer/modifier/supprimer ses confidences.
- **Création** : chaque confidence est un diaporama composé de pages ("diapos"). Pour chaque page on choisit :
  - l'orientation (portrait ou paysage) — elle est commune à toute la confidence : toutes les pages suivent l'orientation de la première
  - l'arrière-plan : une couleur ou une image
  - le texte, écrit en **Markdown** (titres, gras, italique, barré, surligné, listes, citations, liens, séparateurs, code), avec sa police, sa couleur, sa taille et sa position. Une barre d'outils et des raccourcis (Ctrl/⌘+B, I, K) aident à la mise en forme, et l'aperçu interprète le Markdown en direct. Le HTML saisi n'est jamais interprété et seuls les liens `http(s)`, `mailto` et `tel` sont acceptés
  - une image à afficher, son format (remplir / ajuster) et sa position

  Les images sont compressées dans le navigateur puis stockées directement dans Firestore (en base64), il n'y a pas de Firebase Storage à activer ni à payer.
- **Partage** : un lien (`view.html?id=...`) est généré automatiquement. Un nom donné à la confidence ne sert qu'à la retrouver dans son propre tableau de bord. Un QR code est aussi généré pour chaque confidence (bouton "QR code"), avec téléchargement en PNG.
- **Lecture** : quiconque possède le lien peut lire le diaporama, sans se connecter. On tape à droite/gauche de l'écran (ou on glisse le doigt) pour passer à la page suivante/précédente.
- **Statistiques** : le créateur voit, dans l'éditeur, le nombre de vues et la date de chaque consultation.
- **Mobile first** : toute l'interface est pensée d'abord pour mobile, puis adaptée aux écrans plus larges.

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
│   ├── slide-render.js  # rendu d'une page, partagé éditeur + lecteur
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

- `presentations/{id}` : `ownerId`, `ownerEmail`, `title`, `slides` (tableau de pages — les images y sont stockées en base64), `viewCount`, `createdAt`, `updatedAt`.
- `presentations/{id}/views/{viewId}` : `viewedAt` — un document par consultation, utilisé pour l'historique des dates.

### Règles de sécurité

- Une confidence ne peut être **lue par son identifiant exact** que par son propriétaire (gestion) ou par le lecteur public (`get`, sans possibilité de lister toutes les confidences). C'est le même principe qu'un lien de partage "privé mais non listé" (comme un Google Doc "toute personne disposant du lien").
- Seul le propriétaire peut créer, modifier ou supprimer ses confidences ; n'importe qui disposant du lien peut uniquement faire avancer le compteur de vues (`viewCount`).

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

- Les polices additionnelles sont chargées depuis Google Fonts (CDN).
- Le QR code est généré via la librairie `qrcodejs` (CDN cdnjs).
- Les images sont compressées et réencodées côté navigateur (WebP, ou JPEG sur Safari ; 1280 px de côté max) et stockées en base64 directement dans le document Firestore. **Firestore limite un document à 1 Mio : c'est une limite technique**, pas un réglage. L'application vise 1 000 000 d'octets (marge pour les autres champs). Chaque image est plafonnée à ~240 Ko ; quand la place restante est plus faible, l'image est automatiquement recompressée (qualité puis définition) pour tenir dans l'espace disponible. Ce n'est que lorsque la confidence est vraiment pleine qu'un message invite à retirer ou remplacer une image. C'est le compromis nécessaire pour ne pas dépendre de Firebase Storage.
