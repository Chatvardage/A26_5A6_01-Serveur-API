# Chatvardage — Gateway HTTP et WebSocket

Point d’entrée du client Electron. Il relaie HTTP et Socket.IO aux services, applique CORS et la limitation des routes Auth, et valide l’identité avant les appels User-Config. Aucune base métier ni connexion Redis. Le Dashboard appelle directement les services sur le réseau interne.

## Lancer le service complet

Le [README Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/README.md) est le point de départ : clonage des huit dépôts, secrets, Docker Compose, administration et client desktop.

Depuis le dépôt Infra :

```bash
docker compose up --build -d
./scripts/healthcheck.sh
```

Préparer auparavant `.env` selon Infra. Le healthcheck vérifie PostgreSQL, les quatre bases, Redis, les six services dont Dashboard, puis les dépendances du Gateway. `--infra` limite le diagnostic à PostgreSQL et Redis.

## Développer ce dépôt seul

Prérequis : Docker Compose v2; hors Docker, Node 22.9+ et services métier disponibles; Docker Engine 25+.

```bash
git clone https://github.com/Chatvardage/A26_5A6_01-Serveur-API.git
cd A26_5A6_01-Serveur-API
cp .env.example .env
docker compose -f compose.local.yml up --build
```

Service local : `http://localhost:3000`. Santé : `GET /api/health`. Les Compose individuels utilisent des ports communs à Infra : choisir un seul environnement à la fois.

La configuration complète, les routes, les exemples et les procédures Node/Rust sont dans le [guide du service dans Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/services/Serveur-API.md). Les valeurs de `.env.example` sont réservées au développement.

## Vérifications

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm test -- --runInBand
npm run test:cov -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

Les migrations appartiennent à ce dépôt (`prisma/` lorsqu’applicable); Infra crée uniquement les bases et les comptes SQL. Consulter [AGENTS.md](AGENTS.md) pour les règles et vérifications supplémentaires.

## Documentation

- [Architecture complète](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/architecture.md)
- [API et événements](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/api/README.md)
- [Scénario de validation](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/validation.md)
- [Versions et publication](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/versions.md)

## Sessions mobiles

`POST /api/auth/refresh` et `POST /api/auth/logout` sont relayés vers Auth-Service
avec le corps JSON intact, sans Bearer obligatoire. Ils utilisent le quota Auth
par IP et route comme login/register. Aucun changement de variable d'environnement
n'est nécessaire. Le Gateway ne gère ni tokens ni sessions dans une base.
Voir le [contrat central](../A26_5A6_01-Infra/docs/api/authentification.md#sessions-renouvelables--register-login-refresh-et-logout).

## Renforcement sécurité — 9 octobre 2026

La limitation des connexions conserve au maximum 10 000 adresses. Après nettoyage des fenêtres expirées, une nouvelle adresse reçoit HTTP 429 si la capacité reste pleine; les fenêtres actives ne sont pas évincées pour contourner la limite. Avec plusieurs instances, prévoir une limitation partagée au reverse proxy.

Les dépendances compatibles sont mises à jour; l'override YAML concerne seulement `@istanbuljs/load-nyc-config`. npm/npx sont retirés de l'image finale après installation. Infra publie désormais ce service sur `127.0.0.1` par défaut; `API_BIND_ADDRESS` permet une ouverture explicite en développement. Voir le rapport global dans `../A26_5A6_01-Infra/docs/audit-securite-2026-10-09.md`.
