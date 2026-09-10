# A26_5A6_01-Backend

Desktop : Electron + TypeScript
API Gateway : NestJS + TypeScript
Auth/User Service : Rust + Axum + SQLx
- Authentification
- Utilisateurs
- Rôles et permissions
- JWT
- Argon2
Messaging Service : NestJS + Prisma + Socket.IO
- Messages privés
- Historique
- Modification / suppression
- Temps réel
Rooms Service : NestJS + Prisma
- Création des salons
- Modification
- Suppression
- Gestion des salons
Temps réel : WebSocket / Socket.IO
Event Bus : Redis Pub/Sub
Base de données : PostgreSQL
ORM :
- Prisma pour les services NestJS
- SQLx pour le service Rust
- 
Admin : AdminJS

Conteneurisation : Docker + Docker Compose
Documentation API : Swagger / OpenAPI
