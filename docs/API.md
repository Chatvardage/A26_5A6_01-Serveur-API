# Documentation du contrat

La référence est maintenue dans [Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/api/gateway.md). Mettre cette référence à jour avec le code du service.

`GET /api/messages/search/summary?q=<texte>` est relayé vers Message-Service par la famille `/api/messages/*` existante. Il exige un Bearer et renvoie les comptes complets par interlocuteur et par serveur / salon lisible, sans contenu de message. Les groupes à zéro sont omis. Le contrat additif et le parcours mobile sont décrits dans [Infra : résumé de recherche](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/api/recherche-resume.md). Aucun changement du proxy ni de la recherche paginée existante.

Les routes de session `POST /api/auth/refresh` et `POST /api/auth/logout` sont
relayées telles quelles et soumises au quota Auth. Leur corps contient un
`refresh_token` opaque; aucun token ne passe dans l'URL.

### Recherche : pagination directe depuis un message

Les historiques DM (`GET /api/messages/history/:otherUserId`) et salons (`GET /api/messages/rooms/:roomId/history`) acceptent `around=<messageId>` : une page de 50 messages par défaut commence au message inclus, vers les messages plus anciens. Les pages intermédiaires ne sont pas chargées. `cursor=<messageId>&direction=after` charge ensuite les messages plus récents; `cursor` seul garde la pagination ancienne. Les réponses restent des tableaux chronologiques, avec un ordre stable `(createdAt, id)`. La limite reste bornée de 1 à 100.

`around` et `cursor` sont exclusifs. `direction=after` exige `cursor` et exclut `around`. Le message de départ est recherché dans la conversation autorisée : une cible absente ou étrangère répond 400; l’accès aux salons reste validé par Room-Service. Le Gateway transmet les paramètres sans changer le contrat.

Les clients affichent un indicateur de chargement puis positionnent le message instantanément. Une nouvelle recherche ou une navigation invalide les réponses précédentes. L’historique repart de cette page; les messages plus anciens et plus récents sont chargés à la demande.
