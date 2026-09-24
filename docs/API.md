# Contrat HTTP/WebSocket du Serveur-API

Le Serveur-API conserve les contrats des microservices. Il ne renomme pas les champs et ne convertit pas leurs codes HTTP.

## Authentification -> Auth-Service

| Méthode | Route Gateway | Protection |
|---|---|---|
| POST | `/api/auth/register` | publique, rate-limit Gateway |
| POST | `/api/auth/login` | publique, rate-limit Gateway |
| GET | `/api/auth/me` | Bearer JWT |
| PATCH | `/api/auth/me` | Bearer JWT |
| DELETE | `/api/auth/me` | Bearer JWT |
| GET | `/api/users/lookup?ids=<id>,<id>` | Bearer JWT (tout utilisateur) ; `{id, pseudo}` seulement, 100 ids max |
| GET | `/api/users/search?q=<début de pseudo>&limit=<1-50>` | Bearer JWT (tout utilisateur) ; `{id, pseudo}` seulement |
| GET | `/api/users` | admin |
| POST | `/api/users` | admin |
| GET | `/api/users/:id` | admin |
| PATCH | `/api/users/:id` | admin |
| DELETE | `/api/users/:id` | admin |
| PATCH | `/api/users/:id/role` | admin |

## Serveurs et salons -> Room-Service

Toutes ces routes exigent un Bearer JWT, validé par Room-Service auprès d'Auth-Service. Les droits (membre, modérateur, propriétaire du serveur, admin global) sont vérifiés par Room-Service ; un serveur privé inaccessible répond `404`, comme un serveur inexistant.

| Méthode | Route Gateway | Droits |
|---|---|---|
| GET | `/api/servers` | mes serveurs (ajoute l'appelant au serveur par défaut) |
| GET | `/api/servers/decouvrir?q=<nom>` | serveurs publics dont je ne suis pas membre |
| GET | `/api/servers/invitations/me` | mes invitations |
| POST | `/api/servers` | tout utilisateur (devient propriétaire) |
| GET | `/api/servers/:id` | membre ; aperçu si public et non-membre (sans liste des membres) |
| GET | `/api/servers/:id/members?decalage=&limite=&ids=` | membre ; membres par pages (`{ membres, total, suivant }`, 100 au plus) |
| PATCH | `/api/servers/:id` | propriétaire ou admin |
| DELETE | `/api/servers/:id` | propriétaire ou admin (pas le serveur par défaut) |
| POST | `/api/servers/:id/join` | serveur public, ou privé sur invitation |
| POST | `/api/servers/:id/leave` | membre (ni le propriétaire, ni le serveur par défaut) |
| DELETE | `/api/servers/:id/members/:userId` | modérateur minimum, au-dessus de la cible |
| PATCH | `/api/servers/:id/members/:userId` | propriétaire ou admin (nommer/retirer un modérateur) |
| POST | `/api/servers/:id/invitations` | modérateur minimum (pas le serveur par défaut) |
| POST | `/api/servers/:id/invitations/accept` | invité |
| POST | `/api/servers/:id/invitations/refuse` | invité |
| POST | `/api/servers/:id/channels` | modérateur minimum |
| PATCH | `/api/channels/:id` | modérateur minimum |
| DELETE | `/api/channels/:id` | modérateur minimum (un serveur garde au moins un salon) |
| GET | `/api/admin/servers?decalage=&limite=` | admin ; par pages (`{ serveurs, total, suivant }`, 100 au plus) |

Routes de transition, conservées pour le Dashboard et à retirer une fois celui-ci migré :

| Méthode | Route Gateway | Droits |
|---|---|---|
| GET | `/api/admin/rooms` | admin |
| DELETE | `/api/rooms/:id` | admin |

L'ancien `GET /api/rooms/:id` (authentification optionnelle) a été retiré de Room-Service : il exposait le nom et les membres de serveurs privés. Les routes `/api/internal/*` (entre microservices, jeton `INTERNAL_SERVICE_TOKEN`) ne sont **jamais** relayées par le Gateway.

## Messages -> Message-Service

Toutes les routes exigent un Bearer JWT, validé par Message-Service auprès d'Auth-Service.

Messages privés :

| Méthode | Route Gateway |
|---|---|
| POST | `/api/messages` |
| GET | `/api/messages/conversations` |
| GET | `/api/messages/history/:otherUserId?limit=50&cursor=<messageId>` |
| GET | `/api/messages/:id` |
| PATCH | `/api/messages/:id` |
| DELETE | `/api/messages/:id` |

Messages de salon (droits de lecture/écriture vérifiés auprès de Room-Service à chaque appel) :

| Méthode | Route Gateway |
|---|---|
| POST | `/api/messages/rooms/:roomId` |
| GET | `/api/messages/rooms/:roomId/history?limit=50&cursor=<messageId>` |
| GET | `/api/messages/rooms/:roomId/:id` |
| PATCH | `/api/messages/rooms/:roomId/:id` |
| DELETE | `/api/messages/rooms/:roomId/:id` |

## Configuration utilisateur -> User-Config-Service

| Méthode | Route Gateway | Protection |
|---|---|---|
| GET | `/api/config-utilisateur` | Bearer JWT validé auprès d’Auth |
| PATCH | `/api/config-utilisateur` | Bearer JWT validé auprès d’Auth |
| PUT | `/api/config-utilisateur/presence` | Bearer JWT validé auprès d’Auth |
| GET | `/api/config-utilisateur/publiques?ids=<id>,<id>&inclureAvatar=false` | Bearer JWT validé auprès d’Auth ; alias, avatar et présence d'autres utilisateurs, 100 ids max |

Le client n’envoie jamais une identité de confiance. Le Gateway supprime les en-têtes entrants `x-user-id` et `x-user-role`, appelle `GET /api/auth/me` avec le Bearer reçu, puis transmet à User-Config un `x-user-id` dérivé de l’utilisateur Auth validé. Une erreur Auth est relayée avec son code d’origine.

La validation préalable des routes User-Config transmet à Auth-Service les métadonnées `x-forwarded-for`, `x-forwarded-proto` et `x-forwarded-host` reconstruites par le Gateway. Les valeurs entrantes ne sont honorées que lorsque `TRUST_PROXY=true`. Une identité validée est mémorisée `AUTH_CACHE_TTL_MS` (10 s par défaut) ; un refus d'Auth n'est jamais mémorisé et est renvoyé tel quel.

## Socket.IO

Le client se connecte au Gateway :

```js
const socket = io('http://localhost:3000/messages', {
  auth: { token: jwt },
});
```

Le handshake HTTP/polling et l'upgrade WebSocket utilisent le chemin Socket.IO `/socket.io`. Le Gateway le relaie vers Message-Service (`3004`) en supprimant les en-têtes entrants `x-user-id` et `x-user-role`. Le Gateway reconstruit les métadonnées `x-forwarded-*`; la chaîne `x-forwarded-for` et le protocole fournis par un proxy amont ne sont honorés que lorsque `TRUST_PROXY=true`. Aucun identifiant de confiance n'est injecté par le Gateway pour Socket.IO : le namespace reste `/messages` et Message-Service établit l'identité à partir de `auth.token`, validé auprès d'Auth-Service.

Le Gateway relaie les événements tels quels ; leur contrat détaillé est dans Message-Service (`README.md`, `docs/TEMPS_REEL_DM.md`, `docs/TEMPS_REEL_SALONS.md`).

Émissions client :

- `private-message.send`
- `room-message.join`, `room-message.leave`, `room-message.send`
- `typing` (éphémère, salon ou DM)
- `presence.update`, `profil.update`

Événements serveur :

- `private-message.created`, `private-message.updated`, `private-message.deleted`
- `room-message.created`, `room-message.updated`, `room-message.deleted`
- `room-message.revoked` (socket retiré d'un salon dont l'accès est perdu)
- `typing`
- `connexion.prete` (socket authentifié : le client peut annoncer sa présence et rejoindre ses salons)
- `session.revoquee` (jeton refusé à la connexion ou à la revalidation périodique : le socket est ensuite déconnecté)
- `presence.snapshot`, `presence.changed`, `profil.changed`
- `serveur.change` (changement dans un serveur, signalé par Room-Service)

## CORS et en-têtes de cache

Le Gateway applique une liste blanche exacte via `CORS_ORIGINS`. Les en-têtes `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers` et `Access-Control-Max-Age` sont ajoutés uniquement lorsque l’en-tête `Origin` reçu est autorisé.

`Access-Control-Allow-Methods` vaut `GET,POST,PUT,PATCH,DELETE,OPTIONS`. Il doit couvrir toutes les méthodes listées dans ce document : toute route utilisant une nouvelle méthode HTTP doit l’y ajouter (`applyCors` dans `http-proxy.service.ts`), sinon le navigateur bloque la requête dès le preflight.

Les en-têtes CORS fournis par un microservice amont sont supprimés afin que le Gateway reste l’unique autorité CORS. En revanche, un en-tête amont `Vary` est préservé et fusionné avec `Origin` lorsqu’une requête contient cet en-tête, afin de conserver les dimensions de cache telles que `Cookie` ou `Accept-Encoding`.

## Health

### GET `/api/health`

Liveness du Gateway. Ne dépend pas des bases ni des autres services.

### GET `/api/health/upstreams`

Teste :

- Auth -> `/health`
- Room -> `/api/health`
- Message -> `/api/health`
- User-Config -> `/api/health`

Retourne `200` si tous répondent avec un statut HTTP 2xx, sinon `503` et `status: "degraded"`.

## Erreurs produites par le Gateway

- `413 Payload Too Large` : corps au-dessus de `MAX_PROXY_BODY_BYTES`.
- `429 Too Many Requests` : limite de login/register atteinte.
- `502 Bad Gateway` : réponse Auth 2xx dont le contrat d'identité est invalide lors d'un accès User-Config (`id` absent, vide, de plus de 255 caractères ou contenant un caractère de contrôle comme CR/LF).
- `503 Service Unavailable` : service interne injoignable.
- `504 Gateway Timeout` : délai `PROXY_TIMEOUT_MS` dépassé.

Un client qui n'a pas fini d'envoyer son corps de requête après `PROXY_TIMEOUT_MS` voit sa connexion fermée sans réponse HTTP (voir `docs/DECISIONS.md`, D3).

`PROXY_TIMEOUT_MS` est un délai par phase, pas une échéance globale. Une requête avec corps peut cumuler la phase de réception et l’appel au service interne. Pour User-Config, un appel avec corps peut en cumuler trois : réception, validation Auth, puis appel User-Config (voir `docs/DECISIONS.md`, D12).

Toutes les réponses du Gateway portent `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` et `Referrer-Policy: strict-origin-when-cross-origin`, sauf si le service interne fournit lui-même ces en-têtes.

Toutes les erreurs fonctionnelles renvoyées par Auth/Room/Message/User-Config sont transmises avec leur code d'origine. Lors de l'accès à User-Config, une réponse de refus d'Auth est également relayée telle quelle.
