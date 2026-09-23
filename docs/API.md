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
| GET | `/api/users` | admin |
| POST | `/api/users` | admin |
| GET | `/api/users/:id` | admin |
| PATCH | `/api/users/:id` | admin |
| DELETE | `/api/users/:id` | admin |
| PATCH | `/api/users/:id/role` | admin |

## Salons -> Room-Service

| Méthode | Route Gateway |
|---|---|
| GET | `/api/rooms` |
| GET | `/api/rooms/:id` |
| POST | `/api/rooms` |
| PATCH | `/api/rooms/:id` |
| DELETE | `/api/rooms/:id` |
| GET | `/api/rooms/invitations/me` |
| POST | `/api/rooms/:id/invitations` |
| POST | `/api/rooms/:id/invitations/accept` |
| POST | `/api/rooms/:id/invitations/refuse` |
| POST | `/api/rooms/:id/join` |
| POST | `/api/rooms/:id/leave` |
| GET | `/api/admin/rooms` |

Les routes publiques/optionnelles/protégées restent déterminées par Room-Service. Le Gateway ne remplace pas sa validation auprès d'Auth-Service.

## Messages privés -> Message-Service

| Méthode | Route Gateway |
|---|---|
| POST | `/api/messages` |
| GET | `/api/messages/history/:otherUserId?limit=50&cursor=<messageId>` |
| GET | `/api/messages/:id` |
| PATCH | `/api/messages/:id` |
| DELETE | `/api/messages/:id` |

Toutes les routes de messages privés requièrent le JWT selon le contrat de Message-Service.

## Configuration utilisateur -> User-Config-Service

| Méthode | Route Gateway | Protection |
|---|---|---|
| GET | `/api/config-utilisateur` | Bearer JWT validé auprès d’Auth |
| PATCH | `/api/config-utilisateur` | Bearer JWT validé auprès d’Auth |
| PUT | `/api/config-utilisateur/presence` | Bearer JWT validé auprès d’Auth |

Le client n’envoie jamais une identité de confiance. Le Gateway supprime les en-têtes entrants `x-user-id` et `x-user-role`, appelle `GET /api/auth/me` avec le Bearer reçu, puis transmet à User-Config un `x-user-id` dérivé de l’utilisateur Auth validé. Une erreur Auth est relayée avec son code d’origine.

## Socket.IO

Le client se connecte au Gateway :

```js
const socket = io('http://localhost:3000/messages', {
  auth: { token: jwt },
});
```

Le handshake HTTP/polling et l'upgrade WebSocket utilisent le chemin Socket.IO `/socket.io`. Le Gateway le relaie vers Message-Service (`3004`) en supprimant les en-têtes entrants `x-user-id` et `x-user-role`. Le Gateway reconstruit les métadonnées `x-forwarded-*`; la chaîne `x-forwarded-for` et le protocole fournis par un proxy amont ne sont honorés que lorsque `TRUST_PROXY=true`. Aucun identifiant de confiance n'est injecté par le Gateway pour Socket.IO : le namespace reste `/messages` et Message-Service établit l'identité à partir de `auth.token`, validé auprès d'Auth-Service.

Émission client : `private-message.send`.

Événements serveur :

- `private-message.created`
- `private-message.updated`
- `private-message.deleted`

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

Toutes les réponses du Gateway portent `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` et `Referrer-Policy: strict-origin-when-cross-origin`, sauf si le service interne fournit lui-même ces en-têtes.

Toutes les erreurs fonctionnelles renvoyées par Auth/Room/Message/User-Config sont transmises avec leur code d'origine. Lors de l'accès à User-Config, une réponse de refus d'Auth est également relayée telle quelle.
