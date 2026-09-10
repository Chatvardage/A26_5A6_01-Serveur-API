# 🏗️ Architecture du projet

Application de messagerie distribuée basée sur une architecture **microservices**, avec **Electron + TypeScript** pour le client desktop et plusieurs services backend spécialisés.

---

## 🧩 Architecture globale

```text
                         ┌─────────────────────────┐
                         │     Desktop Client      │
                         │    Electron + TS        │
                         └────────────┬────────────┘
                                      │
                                      │ HTTP / WebSocket
                                      ▼
                         ┌─────────────────────────┐
                         │      API Gateway        │
                         │       NestJS + TS       │
                         └───────┬─────────┬────────┘
                                 │         │
                  ┌──────────────┘         └──────────────┐
                  ▼                                       ▼
       ┌─────────────────────┐                 ┌─────────────────────┐
       │  Auth / User        │                 │ Messaging Service   │
       │  Rust + Axum        │                 │ NestJS + Prisma     │
       │                     │                 │                     │
       │ • Authentification  │                 │ • Messages privés   │
       │ • Utilisateurs      │                 │ • Historique        │
       │ • Rôles / droits    │                 │ • Modification      │
       │ • JWT               │                 │ • Suppression       │
       │ • Argon2            │                 │ • Temps réel        │
       └──────────┬──────────┘                 └──────────┬──────────┘
                  │                                       │
                  │                                       │
                  │                             ┌─────────▼──────────┐
                  │                             │    Rooms Service   │
                  │                             │    NestJS + Prisma │
                  │                             │                    │
                  │                             │ • Création salons  │
                  │                             │ • Modification     │
                  │                             │ • Suppression      │
                  │                             │ • Gestion salons   │
                  │                             └─────────┬──────────┘
                  │                                       │
                  └───────────────────┬───────────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │       Event Bus         │
                         │      Redis Pub/Sub      │
                         └────────────┬────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │      PostgreSQL         │
                         │       Database          │
                         └─────────────────────────┘


                         ┌─────────────────────────┐
                         │        AdminJS          │
                         │ Administration / Admin  │
                         └─────────────────────────┘
```

---

# 🖥️ Desktop

### Electron + TypeScript

Application cliente permettant aux utilisateurs d'interagir avec l'ensemble des services backend.

**Responsabilités :**

* Interface utilisateur desktop
* Authentification
* Gestion des conversations
* Gestion des salons
* Communication temps réel
* Réception des notifications
* Communication avec l'API Gateway

---

# 🚪 API Gateway

### NestJS + TypeScript

Point d'entrée principal de l'application backend.

La Gateway centralise les communications entre le client desktop et les différents microservices.

**Responsabilités :**

* Routage des requêtes
* Communication avec les microservices
* Validation des requêtes
* Gestion des WebSockets
* Gestion des erreurs
* Contrôle des accès

```text
Desktop
   │
   ▼
API Gateway
   ├──► Auth / User Service
   ├──► Messaging Service
   └──► Rooms Service
```

---

# 🔐 Auth / User Service

### Rust + Axum + SQLx

Service responsable de toute la gestion des utilisateurs et de la sécurité.

### Fonctionnalités

* 🔑 Authentification
* 👤 Gestion des utilisateurs
* 🛡️ Rôles et permissions
* 🎟️ JWT
* 🔒 Hashage des mots de passe avec Argon2
* 🗄️ Accès PostgreSQL avec SQLx

### Technologies

| Technologie | Utilisation               |
| ----------- | ------------------------- |
| Rust        | Langage                   |
| Axum        | Framework HTTP            |
| SQLx        | Accès à PostgreSQL        |
| JWT         | Authentification          |
| Argon2      | Hashage des mots de passe |

---

# 💬 Messaging Service

### NestJS + Prisma + Socket.IO

Service responsable de la messagerie et des communications en temps réel.

### Fonctionnalités

* 💬 Messages privés
* 📜 Historique des messages
* ✏️ Modification des messages
* 🗑️ Suppression des messages
* ⚡ Communication en temps réel
* 🔔 Événements Socket.IO

### Technologies

| Technologie | Utilisation       |
| ----------- | ----------------- |
| NestJS      | Framework backend |
| Prisma      | ORM               |
| Socket.IO   | Temps réel        |
| PostgreSQL  | Persistance       |

---

# 🏠 Rooms Service

### NestJS + Prisma

Service responsable de la gestion des salons de discussion.

### Fonctionnalités

* ➕ Création de salons
* ✏️ Modification des salons
* 🗑️ Suppression des salons
* 👥 Gestion des salons
* 🔐 Contrôle des permissions liées aux salons

### Technologies

| Technologie | Utilisation       |
| ----------- | ----------------- |
| NestJS      | Framework backend |
| Prisma      | ORM               |
| PostgreSQL  | Persistance       |

---

# ⚡ Temps réel

### WebSocket / Socket.IO

La communication temps réel est assurée par **WebSocket**, avec **Socket.IO** pour simplifier la gestion des connexions et des événements.

Elle permet notamment :

* Réception instantanée des messages
* Mise à jour des conversations
* Notifications
* Événements liés aux salons
* Synchronisation entre utilisateurs

```text
Client A
   │
   │ Socket.IO
   ▼
Messaging Service
   │
   │ Redis Pub/Sub
   ▼
Event Bus
   │
   ▼
Messaging Service
   │
   │ Socket.IO
   ▼
Client B
```

---

# 📨 Event Bus

### Redis Pub/Sub

Redis est utilisé comme **Event Bus** afin de permettre la communication asynchrone entre les différents microservices.

### Utilisation

```text
Service A
   │
   │ Publish Event
   ▼
Redis Pub/Sub
   │
   │ Subscribe
   ▼
Service B
```

Cela permet notamment de :

* Découpler les microservices
* Propager les événements
* Synchroniser les services
* Faciliter la communication temps réel
* Éviter une dépendance directe entre les services

---

# 🗄️ Base de données

### PostgreSQL

PostgreSQL constitue la base de données principale de l'application.

Elle contient notamment les données relatives :

* Aux utilisateurs
* Aux rôles et permissions
* Aux salons
* Aux messages
* À l'historique des conversations

---

# 🔄 ORM et accès aux données

Le projet utilise différents outils d'accès à PostgreSQL selon le service.

| Service             | Technologie | Accès aux données |
| ------------------- | ----------- | ----------------- |
| Auth / User Service | Rust        | SQLx              |
| Messaging Service   | NestJS      | Prisma            |
| Rooms Service       | NestJS      | Prisma            |

### Prisma

Utilisé dans les services développés avec NestJS afin de simplifier :

* Les requêtes SQL
* Les migrations
* La gestion du schéma
* Le typage des données

### SQLx

Utilisé dans le service Rust pour fournir un accès typé et performant à PostgreSQL.

---

# 👨‍💼 Administration

### AdminJS

**AdminJS** fournit une interface d'administration permettant de gérer les données et les ressources de l'application.

```text
Admin
  │
  ▼
AdminJS
  │
  ├──► Utilisateurs
  ├──► Rôles / Permissions
  ├──► Salons
  └──► Messages
```

---

# 🐳 Conteneurisation

### Docker + Docker Compose

L'ensemble de l'infrastructure est conteneurisé avec Docker.

Docker Compose permet de gérer facilement les différents composants du projet.

### Services prévus

```text
Docker Compose
│
├── desktop
├── api-gateway
├── auth-user-service
├── messaging-service
├── rooms-service
├── redis
└── postgresql
```

### Avantages

* Environnement de développement reproductible
* Isolation des services
* Déploiement simplifié
* Gestion centralisée de l'infrastructure
* Démarrage de l'ensemble de l'application avec une seule commande

```bash
docker compose up -d
```

---

# 📚 Documentation API

### Swagger / OpenAPI

Les API REST sont documentées avec **Swagger / OpenAPI**.

La documentation permet notamment de :

* Consulter les endpoints disponibles
* Voir les paramètres des requêtes
* Consulter les réponses
* Tester les endpoints
* Comprendre les modèles de données
* Faciliter l'intégration entre les services

---

# 🛠️ Stack technique

| Domaine              | Technologie             |
| -------------------- | ----------------------- |
| 🖥️ Desktop          | Electron                |
| 💻 Langages          | TypeScript / Rust       |
| 🚪 API Gateway       | NestJS                  |
| 🔐 Auth / Users      | Rust + Axum             |
| 🗄️ ORM Rust         | SQLx                    |
| 💬 Messaging         | NestJS + Prisma         |
| 🏠 Rooms             | NestJS + Prisma         |
| ⚡ Temps réel         | WebSocket / Socket.IO   |
| 📨 Event Bus         | Redis Pub/Sub           |
| 🗃️ Base de données  | PostgreSQL              |
| 👨‍💼 Administration | AdminJS                 |
| 🐳 Conteneurisation  | Docker + Docker Compose |
| 📚 Documentation     | Swagger / OpenAPI       |
| 🔒 Authentification  | JWT + Argon2            |

---

# 🔄 Flux général

### Authentification

```text
Electron
   │
   ▼
API Gateway
   │
   ▼
Auth / User Service
   │
   ├──► Vérification utilisateur
   ├──► Vérification du mot de passe
   └──► Génération JWT
          │
          ▼
       Electron
```

### Envoi d'un message

```text
Electron
   │
   │ Socket.IO
   ▼
API Gateway
   │
   ▼
Messaging Service
   │
   ├──► PostgreSQL
   │
   └──► Redis Pub/Sub
            │
            ▼
       Autres instances
            │
            ▼
        Socket.IO
            │
            ▼
        Destinataires
```

---

# 🎯 Objectifs de l'architecture

L'architecture est conçue autour de plusieurs objectifs :

* **Modularité** — chaque service possède une responsabilité précise.
* **Scalabilité** — les services peuvent être mis à l'échelle indépendamment.
* **Sécurité** — authentification JWT, hashage Argon2 et gestion des permissions.
* **Temps réel** — Socket.IO pour les communications instantanées.
* **Découplage** — Redis Pub/Sub permet la communication entre les services.
* **Maintenabilité** — séparation claire des responsabilités.
* **Déploiement simplifié** — Docker Compose permet de reproduire facilement l'environnement.

---

## 📐 Résumé de l'architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                     ELECTRON DESKTOP                        │
│                     TypeScript                              │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                       API GATEWAY                            │
│                     NestJS + TypeScript                     │
└───────────────┬─────────────────────┬───────────────────────┘
                │                     │
                ▼                     ▼
┌───────────────────────┐   ┌───────────────────────┐
│  AUTH / USER SERVICE  │   │  MESSAGING SERVICE    │
│      Rust + Axum      │   │   NestJS + Prisma     │
│                       │   │   + Socket.IO         │
│ • JWT                 │   │                       │
│ • Argon2              │   │ • Messages            │
│ • Users               │   │ • Historique          │
│ • Roles / Permissions │   │ • Temps réel          │
└───────────┬───────────┘   └───────────┬───────────┘
            │                           │
            │                           ▼
            │                 ┌───────────────────────┐
            │                 │    ROOMS SERVICE      │
            │                 │    NestJS + Prisma    │
            │                 └───────────┬───────────┘
            │                             │
            └──────────────┬──────────────┘
                           ▼
                 ┌─────────────────────┐
                 │    REDIS PUB/SUB    │
                 │      Event Bus      │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │     POSTGRESQL      │
                 │      Database       │
                 └─────────────────────┘

                 ┌─────────────────────┐
                 │       ADMINJS       │
                 │    Administration   │
                 └─────────────────────┘

                 ┌─────────────────────┐
                 │       DOCKER        │
                 │   Docker Compose    │
                 └─────────────────────┘
```
