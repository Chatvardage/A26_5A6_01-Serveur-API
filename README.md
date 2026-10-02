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
