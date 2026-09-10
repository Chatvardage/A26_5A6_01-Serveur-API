🏗️ Architecture du projet
Application de messagerie distribuée basée sur une architecture multiservice, avec Electron + TypeScript pour le client desktop et plusieurs services backend spécialisés.
Le projet est conçu pour faire évoluer l’application du contrôle 1 vers une architecture utilisant de vrais services backend, une base de données persistante, Redis et des communications temps réel.

🧩 Architecture globale
```text
                        ┌─────────────────────────┐
                        │     Desktop Client      │
                        │    Electron + TS        │
                        └───────────┬─────────────┘
                                    │
                     ┌──────────────┴──────────────┐
                     │                             │
                   HTTP                        Socket.IO
                     │                             │
                     ▼                             ▼
           ┌─────────────────────┐      ┌─────────────────────┐
           │     API Gateway     │      │ Messaging Service   │
           │     NestJS + TS     │      │ NestJS + Prisma     │
           └──────────┬──────────┘      │ + Socket.IO         │
                      │                 └──────────┬──────────┘
             ┌────────┴────────┐                   │
             │                 │                   │
             ▼                 ▼                   │
   ┌──────────────────┐ ┌──────────────────┐       │
   │ Auth/User Service│ │  Rooms Service   │       │
   │ Rust + Axum      │ │ NestJS + Prisma  │       │
   │ + SQLx           │ │                  │       │
   └────────┬─────────┘ └────────┬─────────┘       │
            │                    │                 │
            └────────────┬───────┴─────────────────┘
                         ▼
                ┌─────────────────────┐
                │     PostgreSQL      │
                │   Source de vérité  │
                └─────────────────────┘
Messaging Service
       │
       │ Après une écriture réussie en BD
       ▼
┌─────────────────────┐
│    Redis Pub/Sub    │
│      Event Bus      │
└──────────┬──────────┘
          │
          ▼
Clients connectés via Socket.IO
┌─────────────────────┐
│       AdminJS       │
│   Administration    │
└─────────────────────┘
```

🖥️ Desktop
Electron + TypeScript
Application cliente permettant aux utilisateurs d’interagir avec les services backend.
Responsabilités
● Interface utilisateur desktop
● Connexion et déconnexion
● Gestion des conversations privées
● Gestion des salons
● Gestion du thème clair/sombre
● Réception des messages privés en temps réel
● Communication HTTP avec l’API Gateway
● Communication Socket.IO avec le Messaging Service
● Récupération de l’état et de l’historique après reconnexion
À l’ouverture, l’application affiche directement l’interface de clavardage.
Le MockGateway du contrôle 1 peut être conservé pour les tests ou le développement hors ligne, mais le scénario de démonstration utilise la vraie API.

🚪 API Gateway
NestJS + TypeScript
L’API Gateway constitue le point d’entrée principal pour les requêtes HTTP du client desktop.
Responsabilités
● Routage des requêtes
● Communication avec les microservices
● Validation des requêtes
● Gestion des erreurs
● Contrôle des accès
● Vérification des JWT
● Centralisation des routes HTTP exposées au client
```text
Desktop
  │
  ▼
API Gateway
  ├──► Auth / User Service
  ├──► Messaging Service
  └──► Rooms Service
```
Le temps réel des messages privés est géré directement par le Messaging Service avec Socket.IO.

🔐 Auth / User Service
Rust + Axum + SQLx
Service responsable de l’authentification, de la gestion des utilisateurs et de leurs configurations.
Fonctionnalités
● Authentification
● Création d’utilisateur
● Connexion / déconnexion
● Gestion des utilisateurs
● Rôles et permissions
● Génération et validation des JWT
● Hashage des mots de passe avec Argon2
● Gestion de l’alias utilisateur
● Gestion des configurations utilisateur
● Gestion du thème clair/sombre
● Accès PostgreSQL avec SQLx
Technologies
|Technologie|Utilisation              |
|-----------|-------------------------|
|Rust       |Langage backend          |
|Axum       |Framework HTTP           |
|SQLx       |Accès à PostgreSQL       |
|JWT        |Authentification         |
|Argon2     |Hashage des mots de passe|
|PostgreSQL |Persistance              |

💬 Messaging Service
NestJS + Prisma + Socket.IO
Service responsable de la messagerie privée et des communications en temps réel.
Fonctionnalités
● Création de messages privés
● Sauvegarde des messages privés
● Récupération de l’historique
● Modification des messages
● Suppression des messages
● Gestion des conversations privées
● Communication temps réel avec Socket.IO
● Publication d’événements avec Redis Pub/Sub
● Gestion de la reconnexion
Fonctionnement
La base de données est toujours la source de vérité.
Lorsqu’un message privé est envoyé :
1. Le message est validé.
2. Le message est sauvegardé dans PostgreSQL.
3. Après une écriture réussie, un événement est publié dans Redis.
4. Le Messaging Service diffuse l’événement aux clients connectés via Socket.IO.
```text
Client A
  │
  ▼
Messaging Service
  │
  ├──► 1. PostgreSQL
  │        Sauvegarde du message
  │
  └──► 2. Redis Pub/Sub
            │
            ▼
       Socket.IO
            │
            ▼
         Client B
```
Après une reconnexion, l’historique est récupéré à partir de PostgreSQL via l’API REST.
Redis Pub/Sub ne remplace pas la persistance.

🏠 Rooms Service
NestJS + Prisma
Service responsable de la gestion persistante des salons.
Fonctionnalités
● Création de salons
● Récupération de la liste des salons
● Modification des salons
● Suppression des salons
● Gestion des membres
● Gestion des invitations
● Contrôle des permissions liées aux salons
● Persistance dans PostgreSQL
Technologies
|Technologie|Utilisation      |
|-----------|-----------------|
|NestJS     |Framework backend|
|Prisma     |ORM              |
|PostgreSQL |Persistance      |
Les messages de groupe ne sont pas persistés ni synchronisés dans ce contrôle. Leur affichage peut demeurer simulé dans l’application desktop.

⚡ Temps réel
WebSocket / Socket.IO
La communication temps réel est assurée avec Socket.IO, basé sur WebSocket lorsque disponible.
Elle est utilisée principalement pour les messages privés 1 à 1.
Fonctionnalités
● Réception instantanée des messages privés
● Synchronisation entre clients connectés
● Diffusion des créations de messages
● Diffusion des modifications
● Diffusion des suppressions
● Gestion de la reconnexion
```text
Client A
  │
  │ Socket.IO
  ▼
Messaging Service
  │
  │ Sauvegarde PostgreSQL
  ▼
PostgreSQL
  │
  │ Écriture réussie
  ▼
Messaging Service
  │
  │ Publish
  ▼
Redis Pub/Sub
  │
  │ Event
  ▼
Messaging Service
  │
  │ Socket.IO
  ▼
Client B
```

📨 Event Bus
Redis Pub/Sub
Redis est utilisé pour diffuser les événements temps réel entre les instances ou services concernés.
Utilisation
```text
Service
  │
  │ Publish Event
  ▼
Redis Pub/Sub
  │
  │ Subscribe
  ▼
Service / Instance
```
Redis permet notamment de :
● Propager les événements
● Découpler certaines communications
● Synchroniser les instances
● Faciliter la communication temps réel
Redis n’est pas utilisé comme base de données principale et ne remplace pas PostgreSQL.

🗄️ Base de données
PostgreSQL
PostgreSQL constitue la source de vérité de l’application.
Elle contient notamment les données relatives :
● Aux utilisateurs
● Aux rôles et permissions
● Aux configurations utilisateur
● Aux thèmes
● Aux salons
● Aux membres des salons
● Aux invitations
● Aux conversations privées
● Aux messages privés
● À l’historique des conversations
Exemples de tables prévues
```text
users
roles
user_settings
rooms
room_members
room_invitations
private_conversations
private_conversation_members
private_messages
```
Les données persistent même après le redémarrage des conteneurs grâce à un volume Docker.

🔄 ORM et accès aux données
Le projet utilise différents outils d’accès à PostgreSQL selon le service.
|Service            |Technologie|Accès aux données|
|-------------------|-----------|-----------------|
|Auth / User Service|Rust       |SQLx             |
|Messaging Service  |NestJS     |Prisma           |
|Rooms Service      |NestJS     |Prisma           |
Prisma
Prisma est utilisé dans les services NestJS afin de simplifier :
● Les requêtes vers PostgreSQL
● La gestion des relations
● Les migrations
● Le schéma de données
● Le typage TypeScript
SQLx
SQLx est utilisé dans le service Rust pour fournir un accès asynchrone et typé à PostgreSQL.

👨‍💼 Administration
AdminJS
AdminJS fournit le panneau d’administration de l’application.
Le panneau est accessible uniquement aux utilisateurs possédant le rôle admin.
Fonctionnalités
● Authentification administrateur
● Voir la liste des utilisateurs
● Supprimer un utilisateur
● Voir les rôles et permissions
● Voir la liste des salons
● Supprimer un salon
● Voir la liste des messages
● Supprimer un message
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
Les permissions doivent être vérifiées côté serveur et non seulement dans l’interface.

🐳 Conteneurisation
Docker + Docker Compose
L’ensemble du backend est conteneurisé avec Docker.
Docker Compose permet de démarrer l’environnement avec une seule commande.
Services prévus
```text
Docker Compose
│
├── api-gateway
├── auth-user-service
├── messaging-service
├── rooms-service
├── adminjs
├── redis
└── postgresql
```
Le client Electron est lancé séparément sur la machine locale et n’a pas besoin d’être inclus dans Docker Compose.
Démarrage
```bash
docker compose up --build
```
Avantages
● Environnement reproductible
● Isolation des services
● Déploiement simplifié
● Gestion centralisée des dépendances
● Aucun PostgreSQL ou Redis à installer directement sur la machine
● Démarrage simple pour l’évaluation

❤️ Healthchecks
Des vérifications de santé seront ajoutées afin de confirmer le bon fonctionnement de l’environnement.
Services à vérifier
● API Gateway
● PostgreSQL
● Redis
● Services backend
Les résultats et les commandes de vérification seront documentés dans le README.

📚 Documentation API
Swagger / OpenAPI
Les API REST sont documentées avec Swagger / OpenAPI.
La documentation doit permettre de :
● Consulter les endpoints disponibles
● Voir les méthodes HTTP
● Voir les paramètres des requêtes
● Voir les réponses
● Voir les codes d’erreur
● Comprendre les modèles de données
● Tester les endpoints

🔒 Authentification et permissions
L’authentification utilise des JWT.
Les mots de passe sont hashés avec Argon2 avant leur sauvegarde dans PostgreSQL.
Rôles prévus
```text
user
moderator
admin
```
Les routes sensibles vérifient le rôle et les permissions de l’utilisateur avant d’autoriser une opération.

🛠️ Stack technique
|Domaine           |Technologie            |
|------------------|-----------------------|
|🖥️ Desktop         |Electron + TypeScript  |
|🚪 API Gateway     |NestJS + TypeScript    |
|🔐 Auth / Users    |Rust + Axum            |
|🗄️ Accès BD Rust   |SQLx                   |
|💬 Messaging       |NestJS + Prisma        |
|🏠 Rooms           |NestJS + Prisma        |
|⚡ Temps réel      |Socket.IO / WebSocket  |
|📨 Event Bus       |Redis Pub/Sub          |
|🗃️ Base de données |PostgreSQL             |
|👨‍💼 Administration  |AdminJS                |
|🐳 Conteneurisation|Docker + Docker Compose|
|📚 Documentation   |Swagger / OpenAPI      |
|🔒 Authentification|JWT + Argon2           |

🔄 Flux général
Authentification
```text
Electron
  │
  │ HTTP
  ▼
API Gateway
  │
  ▼
Auth / User Service
  │
  ├──► Vérification de l'utilisateur dans PostgreSQL
  ├──► Vérification du mot de passe avec Argon2
  └──► Génération du JWT
             │
             ▼
        API Gateway
             │
             ▼
          Electron
```

Envoi d’un message privé
```text
Electron
  │
  ▼
Messaging Service
  │
  ├──► Validation
  │
  ├──► PostgreSQL
  │       Sauvegarde
  │
  └──► Après succès
          │
          ▼
     Redis Pub/Sub
          │
          ▼
      Socket.IO
          │
          ▼
     Destinataire
```

Reconnexion
```text
Electron
  │
  │ Reconnexion
  ▼
API Gateway
  │
  ▼
Messaging Service
  │
  ▼
PostgreSQL
  │
  ├──► Conversations
  └──► Historique des messages
         │
         ▼
      Electron
```
L’historique est donc toujours récupéré depuis PostgreSQL et non depuis Redis.

🎯 Objectifs de l’architecture
L’architecture est conçue autour de plusieurs objectifs :
● Modularité — chaque service possède une responsabilité précise.
● Sécurité — JWT, Argon2 et contrôle des permissions.
● Persistance — PostgreSQL conserve les données durables.
● Temps réel — Socket.IO permet les communications instantanées.
● Découplage — Redis Pub/Sub diffuse les événements sans remplacer la BD.
● Maintenabilité — séparation claire des responsabilités.
● Reproductibilité — Docker Compose permet de reconstruire l’environnement.
● Évolutivité — les messages de groupe pourront être intégrés à un contrôle futur.

✅ Scénario de démonstration visé
1. Lancer l’environnement avec :
```bash
docker compose up --build
```
2. Ouvrir deux instances du client Electron.
3. Créer ou utiliser deux comptes.
4. Se connecter sur les deux clients.
5. Envoyer un message privé du client A au client B.
6. Vérifier que le message est sauvegardé dans PostgreSQL.
7. Vérifier que le client B reçoit immédiatement le message.
8. Fermer le client B.
9. Envoyer un nouveau message avec le client A.
10. Rouvrir et reconnecter le client B.
11. Vérifier que le message manqué est récupéré depuis PostgreSQL.
12. Modifier l’alias ou le thème.
13. Redémarrer l’application.
14. Vérifier que la configuration est restaurée.
15. Se connecter au panneau AdminJS en tant qu’administrateur.
16. Consulter les utilisateurs, salons et messages.
17. Tester une suppression autorisée.
18. Vérifier l’état de PostgreSQL et Redis.

📦 Livrables
● Dépôt desktop du contrôle 1 conservé
● Dépôt backend/API distinct
● Tags Git de remise
● README complet
● Dockerfiles
● docker-compose.yml
● Documentation Swagger / OpenAPI
● Schéma d’architecture
● Instructions d’installation et de démarrage
● Vérifications de santé de PostgreSQL et Redis
● Scénario de démonstration
