# A26_5A6_01-Serveur-API — Chatvardage C2

API Gateway HTTP/WebSocket de Chatvardage. Le Frontend Electron et le Dashboard parlent à ce dépôt sur le port `3000`; le Gateway relaie ensuite vers Auth-Service, Room-Service, Message-Service et User-Config-Service.

## Responsabilité

Le Serveur-API :

- fournit un point d'entrée unique;
- relaie les routes HTTP sans changer leur contrat;
- transmet `Authorization: Bearer <JWT>` tel quel aux services;
- pour User-Config, valide le Bearer auprès d’Auth puis injecte un `x-user-id` fiable;
- applique CORS au point d'entrée;
- limite `POST /api/auth/login` et `/api/auth/register` avant Argon2;
- transforme les pannes de transport en `503/504` et signale en `502` un contrat Auth invalide lors de l'accès à User-Config;
- relaie Socket.IO (`/socket.io`) vers Message-Service;
- fournit son liveness et un diagnostic des services internes.

Il **ne possède aucune base de données**, ne décode pas le JWT et ne communique pas directement avec Redis. Pour User-Config seulement, l'identité provient de `Auth-Service /api/auth/me`; un `x-user-id` fourni par le client est supprimé.

## Routage

```text
Frontend Electron / Dashboard
              |
              | HTTP + Socket.IO
              v
       Serveur-API :3000
       /      |       |       \
      v       v       v        v
 Auth :3001 Room :3003 Message :3004 Config :3005
                         |
                         +--> PostgreSQL
                         +--> Redis Pub/Sub
                         +--> Socket.IO /messages
```

| Préfixe reçu | Destination |
|---|---|
| `/api/auth/*` | Auth-Service |
| `/api/users/*` | Auth-Service |
| `/api/rooms/*` | Room-Service |
| `/api/admin/rooms/*` | Room-Service |
| `/api/messages/*` | Message-Service |
| `/socket.io/*` | Message-Service |
| `/api/config-utilisateur/*` | User-Config-Service (après validation Auth) |

Le chemin et la query string restent inchangés.

## Installation locale

Prérequis : Node.js 22 ou plus récent. Le projet reste volontairement compilé en CommonJS (`module: commonjs`) pour rester cohérent avec NestJS, Jest/ts-jest et les fichiers de configuration CommonJS du dépôt.

```bash
cp .env.example .env
npm ci
npm run start:dev
```

Par défaut :

```env
PORT=3000
AUTH_SERVICE_URL=http://localhost:3001
ROOM_SERVICE_URL=http://localhost:3003
MESSAGE_SERVICE_URL=http://localhost:3004
USER_CONFIG_SERVICE_URL=http://localhost:3005
```

Le Gateway peut démarrer même si les services ne le sont pas encore. `GET /api/health` restera `200`; `GET /api/health/upstreams` indiquera les dépendances indisponibles.

## Exemple Auth via Gateway

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifiant":"monpseudo","mot_de_passe":"motdepasse123"}'
```

La réponse vient directement d'Auth-Service.

## Exemple Room via Gateway

```bash
curl http://localhost:3000/api/rooms \
  -H "Authorization: Bearer <JWT>"
```

Room-Service conserve sa propre règle : les routes optionnellement/protégées valident le JWT auprès d'Auth-Service.

## Exemple User-Config via Gateway

```bash
curl http://localhost:3000/api/config-utilisateur \
  -H "Authorization: Bearer <JWT>"
```

Le Gateway appelle d’abord `Auth-Service /api/auth/me`. Si le jeton est valide, il récupère l’`id` retourné, supprime tout `x-user-id`/`x-user-role` fourni par le client, puis transmet un `x-user-id` fiable à User-Config-Service.

## Exemple Message REST

```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"recipientId":"uuid-destinataire","content":"Salut!"}'
```

## Exemple Socket.IO

```js
const socket = io('http://localhost:3000/messages', {
  auth: { token: jwt },
});

socket.emit('private-message.send', {
  recipientId: 'uuid-destinataire',
  content: 'Salut!',
});
```

Le Gateway ne lit pas `auth.token`; il relaie le protocole Socket.IO. Message-Service valide ensuite ce token auprès d'Auth-Service. Le Gateway supprime aussi les en-têtes entrants `x-user-id` et `x-user-role` du handshake/passage WebSocket afin qu'un client ne puisse pas usurper une identité. Il reconstruit également les métadonnées `x-forwarded-*` à partir de la connexion; la chaîne `x-forwarded-for` et le protocole transmis par un proxy amont ne sont honorés que si `TRUST_PROXY=true`. Aucun `x-user-id` de confiance n'est injecté pour Socket.IO : Message-Service établit lui-même l'identité à partir du token du handshake.

## Rate limit Auth

Valeurs de développement :

```env
AUTH_RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=10
```

La limite est appliquée **par IP et par route** à :

- `POST /api/auth/login`
- `POST /api/auth/register`

Une requête refusée reçoit `429` et `Retry-After`. Le store est en mémoire et les buckets expirés sont purgés périodiquement pour éviter une croissance permanente avec des IP one-shot. Cette approche reste adaptée au Compose C2 à une instance. Si plusieurs instances du Gateway sont déployées plus tard, ce compteur devra être partagé (par exemple Redis).

## CORS

```env
CORS_ORIGINS=http://localhost:5173
```

Plusieurs origines :

```env
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

Aucune origine n'est réfléchie automatiquement. Les en-têtes `Access-Control-Allow-*` et `Access-Control-Max-Age` ne sont émis que si l'origine appartient exactement à `CORS_ORIGINS`. Lorsqu'un service amont fournit `Vary`, le Gateway le conserve et, lorsqu’une requête contient `Origin`, le fusionne avec `Origin` au lieu de le remplacer. Une application Electron qui n'envoie pas d'en-tête `Origin` n'est pas bloquée par CORS HTTP; côté Socket.IO, Message-Service conserve aussi sa validation actuelle.

## Timeouts et erreurs

```env
PROXY_TIMEOUT_MS=5000
MAX_PROXY_BODY_BYTES=1048576
```

Le Gateway préserve les codes renvoyés par les services (`400`, `401`, `403`, `404`, `409`, etc.). Il crée seulement :

- `413` si le corps dépasse la limite Gateway;
- `429` si le rate limit Auth est dépassé;
- `502` si Auth répond en 2xx avec une identité invalide pendant la validation User-Config;
- `503` si une destination interne est injoignable;
- `504` si une destination dépasse le timeout.

## Healthchecks

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/health/upstreams
```

Le premier est un liveness du Gateway. Le second appelle réellement les healthchecks Auth, Room, Message et User-Config.

## Docker / Infra

Le Dockerfile expose `3000` et contient un healthcheck sur `/api/health`.

Dans `A26_5A6_01-Infra/docker-compose.yml`, l'intégration attendue est :

```yaml
serveur-api:
  build:
    context: ../A26_5A6_01-Serveur-API
  environment:
    PORT: 3000
    AUTH_SERVICE_URL: http://auth-service:3001
    ROOM_SERVICE_URL: http://room-service:3003
    MESSAGE_SERVICE_URL: http://message-service:3004
    USER_CONFIG_SERVICE_URL: http://user-config-service:3005
    CORS_ORIGINS: ${CORS_ORIGINS:-http://localhost:5173}
  ports:
    - "3000:3000"
  depends_on:
    auth-service:
      condition: service_healthy
    room-service:
      condition: service_healthy
    message-service:
      condition: service_healthy
    user-config-service:
      condition: service_healthy
  networks:
    - chatvardage
```

Le Compose global d’Infra contient maintenant cette intégration.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---:|---|
| `PORT` | `3000` | port TCP du Gateway, validé entre `1` et `65535` |
| `AUTH_SERVICE_URL` | `http://localhost:3001` | Auth-Service |
| `ROOM_SERVICE_URL` | `http://localhost:3003` | Room-Service |
| `MESSAGE_SERVICE_URL` | `http://localhost:3004` | Message-Service |
| `USER_CONFIG_SERVICE_URL` | `http://localhost:3005` | User-Config-Service |
| `PROXY_TIMEOUT_MS` | `5000` | délai HTTP/WS interne |
| `MAX_PROXY_BODY_BYTES` | `1048576` | corps max bufferisé |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `60000` | fenêtre rate-limit Auth |
| `AUTH_RATE_LIMIT_MAX` | `10` | requêtes max par IP/route/fenêtre |
| `CORS_ORIGINS` | `http://localhost:5173` | liste blanche CORS |
| `TRUST_PROXY` | `false` | accepte les `X-Forwarded-*` entrants seulement derrière un proxy de confiance |

## Vérifications avant PR

```bash
npm ci
npm run lint
npm test
npm run test:cov
npm run test:e2e
npm run build
npx prettier --check "src/**/*.ts" "test/**/*.ts"
```

La couverture Jest est bloquante à 100 % pour Statements, Branches, Functions et Lines.
`src/main.ts` est la seule exclusion explicite : il orchestre l'ouverture du port et le branchement WebSocket, comportements exercés par les tests e2e plutôt que par les tests unitaires. `src/app.module.ts` reste inclus dans la couverture.

## Overrides npm

L'override `multer` force une version corrigée de cette dépendance transitive utilisée par `@nestjs/platform-express`; il est conservé pour éviter de réintroduire une version vulnérable lors d'une résolution de dépendances. L'ancien override `deepmerge-ts` a été retiré puisqu'aucune dépendance du lockfile actuel ne l'utilise.

Voir aussi [`docs/API.md`](docs/API.md) et [`AGENTS.md`](AGENTS.md).
