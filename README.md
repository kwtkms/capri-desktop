# Capri, compagnon de bureau (version modifiée)

Version modifiée de [mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop), une appli
Electron où un personnage vit sur l'écran et commente ce que fait Claude Code. Le code d'origine est
sous licence MIT (voir `LICENSE`) ; les modifications de ce dépôt sont les miennes.

Les dessins du personnage, les icônes et les captures ne sont pas inclus : le personnage ne
m'appartient pas (voir `assets/capri/LISEZ-MOI.md`).

## Ce que j'ai ajouté

- **Une personnalité de pote** : elle répond aux questions, donne l'heure et la batterie, lance des
  applis, propose des pauses ; elle comprend les messages tapés vite, sans accents ni orthographe.
- **Ranger le bureau** : disposition des icônes par thème avec un plan, une validation et une
  annulation ; disposition d'origine sauvegardée et vérifiée avant chaque déplacement. Elle range aussi
  les fenêtres, et peut dessiner avec les icônes (cercle, spirale, damier…).
- **Plusieurs écrans** : elle ne se perd plus sur un deuxième écran, y compris entre deux écrans
  d'échelles différentes (passage par une position sûre, garde-fou toutes les 3 s).
- **Animations** : marche avec élan et demi-tour, inertie des cheveux, poses assises, danses,
  sommeil allongée sur une fenêtre, réactions aux fenêtres qu'on secoue.
- **Décor** : une ville néon en fond (métro aérien, koi holographique, brouillard, éclairs), une planche
  de lumière quand tout est en plein écran.
- **Mémoire et rappels locaux** (Ctrl+Alt+R), mode concentration, bonne nuit.
- **Son propre petit modèle** pour comprendre et répondre en local ; Claude n'est appelé que sans
  accès au web ni aux outils.

## Lancer

```bash
npm install
npm start
```

Il faut d'abord ajouter les images du personnage dans `assets/capri/` et `assets/icons/`.

## Stack

Electron, JavaScript, HTML / CSS / Canvas, PowerShell, Python (outils d'images).
