# AGENTS.md — Chatvardage Serveur-API

## Mission

Ce dépôt est le **Serveur-API / API Gateway** de Chatvardage pour le Contrôle 2 du cours `420-5A6-ST – A26`.

Il constitue le point d'entrée unique du Frontend Electron et du Dashboard. Il ne possède aucune donnée métier et ne doit pas dupliquer la logique des microservices.

## Architecture d'équipe

- `Frontend` : Electron + ChatGateway réel.
- `Serveur-API` : proxy HTTP/Socket.IO, CORS, rate limiting et healthcheck.
- `Authentification` : utilisateurs, authentification et rôles.
- `Room-Service` : salons, membres et invitations.
- `Message-Service` : messages privés, historique, Redis et Socket.IO.
- `User-Config-Service` : alias, thème, langue, présence et préférences.
- `Dashboard` : panneau d'administration.
- `Infra` : PostgreSQL, Redis, Docker Compose et orchestration.

## Règles impératives

1. Ne pas créer de base de données, de schéma Prisma ou de table dans ce dépôt.
2. Ne pas valider/décoder localement le JWT : transmettre `Authorization: Bearer <JWT>` tel quel. Auth reste la source de vérité.
3. Ne jamais faire confiance à `x-user-id`/`x-user-role` reçus du client. Les proxies HTTP et WebSocket doivent les supprimer. Pour User-Config uniquement, le Gateway valide le Bearer auprès de `Auth-Service /api/auth/me` puis crée `x-user-id` à partir de l’identité Auth validée. Pour Socket.IO, le Gateway n'injecte aucune identité : Message-Service valide `auth.token` auprès d'Auth-Service.
4. Préserver les méthodes, chemins, query strings, corps, codes HTTP et réponses des services internes.
5. Le Gateway peut produire ses propres erreurs uniquement avant/pendant le transport : `413`, `429`, `502` (contrat amont invalide), `503`, `504`.
6. Appliquer le rate limit à `POST /api/auth/login` et `POST /api/auth/register` avant Auth-Service. Toute nouvelle route **publique** d'Auth-Service (sans Bearer, ex. réinitialisation de mot de passe) doit être ajoutée à `isRateLimitedAuthRoute` (voir `docs/DECISIONS.md`, D7).
7. Le temps réel Message-Service reste dans Message-Service. Le Gateway ne fait que relayer `/socket.io` vers le port `3004`.
8. Ne jamais brancher directement le Gateway à Redis pour recréer la logique de messages privés.

## Routage actuel

- `/api/auth/*` -> Auth-Service (`3001`)
- `/api/users/*` -> Auth-Service (`3001`)
- `/api/servers/*`, `/api/channels/*`, `/api/admin/servers` -> Room-Service (`3003`)
- `/api/rooms/*`, `/api/admin/rooms/*` -> Room-Service (`3003`), transition vers les serveurs (à retirer)
- `/api/internal/*` -> **jamais relayé** (échanges entre microservices uniquement)
- `/api/messages/*` -> Message-Service (`3004`)
- `/api/config-utilisateur/*` -> User-Config-Service (`3005`), après validation du Bearer auprès d’Auth
- `/socket.io/*` -> Message-Service (`3004`, HTTP polling + WebSocket upgrade)
- `/api/health` -> liveness du Gateway
- `/api/health/upstreams` -> état des quatre services intégrés

Toute nouvelle famille de routes doit être ajoutée explicitement; ne jamais transformer ce Gateway en proxy ouvert.

## Sécurité

- `TRUST_PROXY=false` par défaut. Ne l'activer que derrière un reverse proxy contrôlé. Les proxies HTTP et WebSocket, ainsi que la validation Auth préalable à User-Config, reconstruisent `x-forwarded-for` et n'honorent la chaîne entrante que lorsque cette option est activée. Le rate limit utilise alors la dernière adresse de `X-Forwarded-For` (ajoutée par le reverse proxy), jamais la première (forgeable).
- `CORS_ORIGINS` est une liste blanche exacte.
- `MAX_PROXY_BODY_BYTES` borne ce que le Gateway bufferise avant transfert; `PROXY_TIMEOUT_MS` borne chaque phase réseau séparément, dont la lecture du corps (client lent = connexion fermée).
- `AUTH_RATE_LIMIT_*` limite les calculs Argon2 déclenchés par les routes publiques d'Auth.
- Une erreur réseau interne ne doit pas exposer l'URL, la stack ou les détails du réseau au client.

## Limites connues

Les recommandations de revue volontairement non appliquées et leur justification sont consignées dans `docs/DECISIONS.md`. Le consulter avant de rouvrir un de ces sujets.

- Les corps de requête et de réponse sont entièrement bufferisés en mémoire. Le Gateway n'est pas prévu pour transférer de gros fichiers : toute route d'upload/export devra passer en streaming.
- Seul le corps entrant est borné (`MAX_PROXY_BODY_BYTES`). Les réponses des services internes ne le sont pas : ils sont considérés comme de confiance.
- Le rate limit est en mémoire, par instance. Avec plusieurs instances du Gateway, chacune a ses propres compteurs; un rate limit distribué exigerait un store partagé (Redis), hors du périmètre de ce dépôt (règle 8).
- `PROXY_TIMEOUT_MS` n'est pas un budget global : une requête avec corps peut cumuler réception et appel amont; User-Config peut aussi cumuler la validation Auth (voir `docs/DECISIONS.md`, D12).

## Tests obligatoires avant PR

```bash
npm ci
npm run lint
npm test
npm run test:cov
npm run test:e2e
npm run build
npx prettier --check "src/**/*.ts" "test/**/*.ts"
```

Le seuil Jest global est de **100 % Statements, Branches, Functions et Lines** pour le code suivi par la couverture.

Ne jamais annoncer la PR prête si une commande requise échoue.

## Docker / Infra

Dans le Compose global, utiliser :

```env
AUTH_SERVICE_URL=http://auth-service:3001
ROOM_SERVICE_URL=http://room-service:3003
MESSAGE_SERVICE_URL=http://message-service:3004
USER_CONFIG_SERVICE_URL=http://user-config-service:3005
```

Le Gateway écoute sur `3000`. Les services internes peuvent rester liés à `127.0.0.1` côté hôte puisque la communication inter-conteneurs passe par `chatvardage-network`.

## Documentation

Tout changement de route, variable d'environnement, timeout, CORS, rate limit ou comportement de proxy doit mettre à jour `README.md`, `.env.example`, `docs/API.md` et ce fichier si la règle de travail change. Toute recommandation de revue écartée doit être ajoutée à `docs/DECISIONS.md` avec sa justification.
