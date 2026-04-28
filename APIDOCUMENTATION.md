# Sodalis — Documentation API Frontend

Ce document est la référence complète pour tout développeur frontend qui consomme le backend Sodalis. Il couvre chaque requête, chaque réponse, chaque type de donnée, chaque enum et chaque comportement métier à connaître.

**Point d'entrée unique : `http://localhost:4000/graphql`**

Tout passe par le gateway GraphQL. Le frontend ne doit jamais appeler directement les services sur les ports 3001, 3002 ou 3003.

---

## Table des matières

1. [Authentification](#1-authentification)
2. [Enums et valeurs possibles](#2-enums-et-valeurs-possibles)
3. [Types de données](#3-types-de-données)
4. [Format des erreurs](#4-format-des-erreurs)
5. [API GraphQL — Auth](#5-api-graphql--auth)
6. [API GraphQL — Colocations](#6-api-graphql--colocations)
7. [API GraphQL — Utilisateurs](#7-api-graphql--utilisateurs)
8. [API GraphQL — Tâches](#8-api-graphql--tâches)
9. [API GraphQL — Maintenance](#9-api-graphql--maintenance)
10. [API GraphQL — Plaintes](#10-api-graphql--plaintes)
11. [API GraphQL — Sondages](#11-api-graphql--sondages)
12. [API GraphQL — Karma](#12-api-graphql--karma)
13. [API GraphQL — Notifications](#13-api-graphql--notifications)
14. [API GraphQL — Dashboard](#14-api-graphql--dashboard)
15. [Temps réel — Socket.io](#15-temps-réel--socketio)
16. [Règles métier importantes](#16-règles-métier-importantes)

---

## 1. Authentification

### Format du header

Toutes les opérations GraphQL (sauf `register` et `login`) exigent ce header HTTP :

```
Authorization: Bearer <jwt_token>
```

### Contenu du token JWT

Le token est un JWT signé, valable **24 heures**. Son payload décodé contient :

```json
{
  "id": "uuid",
  "email": "alice@test.com",
  "coloc_id": "uuid-ou-null",
  "role": "ADMIN | MEMBER",
  "iat": 1714000000,
  "exp": 1714086400
}
```

### Quand le token change

Le token est **régénéré** (et doit être remplacé dans le stockage local) après :
- `createColoc` — le nouveau token contient `coloc_id` et `role: "ADMIN"`
- `joinColoc` — le nouveau token contient `coloc_id`

> **Important :** ne pas remplacer le token, c'est continuer à envoyer un token sans `coloc_id`, ce qui bloquera toutes les requêtes protégées suivantes.

### Rate limiting sur l'authentification

Les endpoints `register` et `login` sont limités à **10 requêtes par 15 minutes** par IP. Au-delà :

```json
{ "errors": [{ "message": "Trop de tentatives — réessayez dans 15 minutes" }] }
```

---

## 2. Enums et valeurs possibles

### UserRole

```
ADMIN    — créateur de la coloc, peut assigner des tickets
MEMBER   — colocataire standard
```

### TaskStatus

```
TODO         — état initial
IN_PROGRESS  — en cours
DONE         — terminée (déclenche une mise à jour du Harmony Score)
```

### MaintenanceCategory

```
PLUMBING      — Plomberie
ELECTRICITY   — Électricité
APPLIANCE     — Électroménager
FURNITURE     — Mobilier
INTERNET      — Réseau / box
OTHER         — Autre
```

### MaintenancePriority

```
LOW      — faible
MEDIUM   — moyen
HIGH     — élevé
URGENT   — urgent (déclenche la création automatique d'une tâche dans Labor)
```

### MaintenanceStatus

```
OPEN         — état initial
IN_PROGRESS  — pris en charge
RESOLVED     — résolu
CANCELLED    — annulé
```

### ComplaintStatus

```
OPEN      — état initial
RESOLVED  — résolue (+5 karma au résolveur)
```

### PollStatus

```
OPEN    — sondage actif, votes acceptés
CLOSED  — sondage fermé, votes refusés
```

---

## 3. Types de données

Voici la shape exacte de chaque objet retourné par l'API.

### User

```ts
{
  id: string           // UUID (ex: "a1b2c3d4-...")
  name: string         // 1–100 caractères
  email: string
  role: "ADMIN" | "MEMBER"
  coloc_id: string | null  // null tant que l'user n'a pas rejoint de coloc
  harmony_score: number    // score de fiabilité (PostgreSQL), commence à 0
  karma_score: number      // score social (MongoDB/Concordia), commence à 0
                           // ⚠️ karma_score est absent du token JWT,
                           // il est enrichi à la volée par le gateway
  created_at: string       // ISO 8601 (ex: "2026-04-28T12:00:00.000Z")
}
```

> `harmony_score` et `karma_score` sont deux métriques distinctes. Voir [Règles métier](#16-règles-métier-importantes).

### RegisterPayload

Retourné uniquement par `register`. Pas de token — il faut appeler `login` ensuite.

```ts
{
  id: string
  name: string
  email: string
  role: "MEMBER"   // toujours MEMBER à l'inscription
}
```

### AuthPayload

Retourné par `login`.

```ts
{
  token: string   // JWT à stocker (coloc_id peut être null si pas encore dans une coloc)
  user: {
    id: string
    name: string
    email: string
    role: "ADMIN" | "MEMBER"
    // ⚠️ coloc_id absent ici — il est dans le payload du token
  }
}
```

### Coloc

```ts
{
  id: string          // UUID
  name: string        // 1–100 caractères
  invite_code: string // 4–20 caractères, généré automatiquement depuis le nom
                      // ex: "appart-lyon-3f9a"
  created_at: string  // ISO 8601
}
```

### ColocWithToken

Retourné par `createColoc` et `joinColoc`. **Stocker le nouveau token.**

```ts
{
  coloc: Coloc
  token: string  // nouveau JWT contenant coloc_id — remplace l'ancien
}
```

### Task

```ts
{
  id: string              // UUID
  title: string           // 1–150 caractères
  status: "TODO" | "IN_PROGRESS" | "DONE"
  assignee_id: string     // UUID du colocataire assigné
  coloc_id: string        // UUID de la colocation
  created_at: string      // ISO 8601
  due_at: string | null   // ISO 8601, null si pas de date limite
}
```

### MaintenanceTicket

```ts
{
  id: number              // ⚠️ ENTIER (pas un UUID) — c'est un SERIAL PostgreSQL
  title: string           // 1–200 caractères
  description: string | null
  category: MaintenanceCategory
  priority: MaintenancePriority
  status: MaintenanceStatus
  created_by: string | null  // UUID de l'auteur (null si compte supprimé)
  assigned_to: string | null // UUID de l'assigné (null si non assigné)
  coloc_id: string           // UUID de la colocation
  created_at: string         // ISO 8601
  updated_at: string         // ISO 8601, mis à jour à chaque PATCH
}
```

> **Point critique :** `id` est un entier (`1`, `2`, `3`...), pas un UUID. Utiliser `String(ticket.id)` si le système attend un string.

### Notification

```ts
{
  id: string        // MongoDB ObjectId sous forme de string
  coloc_id: string
  type: string      // voir la liste des types d'événements section 15
  message: string   // message lisible par un humain
  created_at: string // ISO 8601
}
```

### NotificationsResult

Retourné par la query `notifications`.

```ts
{
  data: Notification[]
  pagination: {
    page: number    // page courante
    limit: number   // nombre d'éléments par page
    total: number   // total d'éléments (pour calculer le nombre de pages)
  }
}
```

### Complaint

```ts
{
  id: string               // MongoDB ObjectId
  coloc_id: string
  creator_id: string | null // null si la plainte est anonyme
  target_id: string | null  // UUID du colocataire ciblé, null si absent
  message: string
  is_anonymous: boolean
  status: "OPEN" | "RESOLVED"
  createdAt: string         // ISO 8601 (mongoose timestamp)
  updatedAt: string         // ISO 8601
}
```

> Quand `is_anonymous: true`, `creator_id` est systématiquement `null` dans la réponse, même pour l'ADMIN. L'identité de l'auteur est définitivement masquée côté API.

### PollOption

```ts
{
  option_id: string  // UUID généré à la création
  text: string       // texte de l'option
  voters: string[]   // liste des UUID des votants
}
```

### Poll

```ts
{
  id: string           // MongoDB ObjectId
  coloc_id: string
  creator_id: string
  question: string
  options: PollOption[]
  status: "OPEN" | "CLOSED"
  createdAt: string    // ISO 8601
  updatedAt: string    // ISO 8601
}
```

> Un utilisateur ne peut voter que pour **une seule option** à la fois. Revoter retire l'ancien vote et enregistre le nouveau. `voters` contient les UUIDs — la taille de chaque tableau `voters` est le nombre de votes de l'option.

### KarmaProfile

```ts
{
  user_id: string   // UUID du colocataire
  coloc_id: string  // UUID de la colocation
  score: number     // nombre entier, commence à 0
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
}
```

### Dashboard

```ts
{
  users: User[]           // membres de la coloc (avec karma_score enrichi)
  tasks: Task[]           // toutes les tâches de la coloc
  open_complaints: number // nombre de plaintes au statut OPEN
}
```

> Le Dashboard est **mis en cache Redis 30 secondes**. Toute mutation (tâche, ticket, plainte, vote) invalide le cache.

---

## 4. Format des erreurs

### Erreur standard

Toutes les erreurs applicatives ont cette forme :

```json
{
  "errors": [
    {
      "message": "Description de l'erreur",
      "locations": [...],
      "path": [...]
    }
  ]
}
```

La propriété utile est `errors[0].message`. Exemples de messages :

| Message | Cause |
|---|---|
| `"Non autorisé — Token manquant"` | Header Authorization absent |
| `"Token invalide ou expiré"` | JWT corrompu ou expiré |
| `"Non autorisé — Vous n'appartenez pas à cette colocation"` | coloc_id du token ≠ coloc demandée (sauf ADMIN) |
| `"Non autorisé — Réservé aux ADMINs"` | Action réservée aux ADMIN tentée par un MEMBER |
| `"Cet email est déjà utilisé"` | Register avec un email existant (409) |
| `"Vous êtes déjà dans une colocation"` | joinColoc alors que coloc_id est déjà défini (409) |
| `"Code d'invitation invalide"` | invite_code inconnu (404) |
| `"Ticket introuvable"` | Ticket id inexistant (404) |
| `"Tâche introuvable"` | Task id inexistant (404) |
| `"Sondage introuvable"` | Poll id inexistant (404) |
| `"Ce sondage est fermé"` | Vote sur un poll CLOSED (400) |
| `"Vous ne pouvez pas vous remercier vous-même"` | thankUser(target_id = propre id) (400) |
| `"L'utilisateur assigné n'appartient pas à cette colocation"` | assignTicket avec UUID hors coloc (400) |

### Erreur de validation

Quand les champs envoyés ne passent pas la validation (type incorrect, valeur hors enum, champ manquant) :

```json
{
  "errors": [
    {
      "message": "Validation error: category doit être : PLUMBING, ELECTRICITY, APPLIANCE, FURNITURE, INTERNET, OTHER"
    }
  ]
}
```

---

## 5. API GraphQL — Auth

### `register`

Crée un compte. **Ne retourne pas de token.** Appeler `login` ensuite.

```graphql
mutation {
  register(
    name: "Alice"
    email: "alice@test.com"
    password: "motdepasse123"
  ) {
    id
    name
    email
    role
  }
}
```

**Réponse :**
```json
{
  "data": {
    "register": {
      "id": "a1b2c3d4-e5f6-...",
      "name": "Alice",
      "email": "alice@test.com",
      "role": "MEMBER"
    }
  }
}
```

**Validations :**
- `name` : 1–100 caractères
- `email` : format email valide
- `password` : 8 caractères minimum

**Erreurs possibles :**
- `"Cet email est déjà utilisé"` (409)

---

### `login`

```graphql
mutation {
  login(email: "alice@test.com", password: "motdepasse123") {
    token
    user {
      id
      name
      email
      role
    }
  }
}
```

**Réponse :**
```json
{
  "data": {
    "login": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": "a1b2c3d4-e5f6-...",
        "name": "Alice",
        "email": "alice@test.com",
        "role": "MEMBER"
      }
    }
  }
}
```

**Erreurs possibles :**
- `"Email ou mot de passe incorrect"` (401)

---

## 6. API GraphQL — Colocations

### `myColoc`

Retourne la colocation de l'utilisateur authentifié (dont le `invite_code`), sans avoir à connaître son `coloc_id`.

```graphql
query {
  myColoc {
    id
    name
    invite_code
  }
}
```

**Réponse :**

```json
{
  "data": {
    "myColoc": {
      "id": "b2c3d4e5-...",
      "name": "Appart Lyon",
      "invite_code": "appart-lyon-3f9a"
    }
  }
}
```

**Erreurs possibles :**
- `"Non autorisé — Aucune colocation associée"` si le token ne contient pas de `coloc_id`

---

### `createColoc`

Crée une colocation. L'utilisateur devient automatiquement **ADMIN**. Retourne un **nouveau token** à stocker.

```graphql
mutation {
  createColoc(name: "Appart Lyon") {
    coloc {
      id
      name
      invite_code
    }
    token
  }
}
```

**Réponse :**
```json
{
  "data": {
    "createColoc": {
      "coloc": {
        "id": "b2c3d4e5-...",
        "name": "Appart Lyon",
        "invite_code": "appart-lyon-3f9a"
      },
      "token": "eyJ..."
    }
  }
}
```

**Validations :**
- `name` : 1–100 caractères

**Format du `invite_code` :**
Généré automatiquement depuis le nom : normalisé en minuscules, sans accents, avec 4 caractères hex aléatoires. Ex: `"Appartement #3 Lyon"` → `"appartement-3-lyon-4e2a"`.

---

### `joinColoc`

Rejoindre une colocation existante via son code d'invitation. Retourne un **nouveau token** à stocker.

```graphql
mutation {
  joinColoc(invite_code: "appart-lyon-3f9a") {
    coloc {
      id
      name
    }
    token
  }
}
```

**Réponse :**
```json
{
  "data": {
    "joinColoc": {
      "coloc": {
        "id": "b2c3d4e5-...",
        "name": "Appart Lyon"
      },
      "token": "eyJ..."
    }
  }
}
```

**Erreurs possibles :**
- `"Vous êtes déjà dans une colocation"` (409)
- `"Code d'invitation invalide"` (404)

---

## 7. API GraphQL — Utilisateurs

### `usersByColoc`

Liste tous les membres d'une colocation avec leur score karma enrichi.

```graphql
query {
  usersByColoc(colocId: "b2c3d4e5-...") {
    id
    name
    email
    role
    coloc_id
    harmony_score
    karma_score
  }
}
```

**Réponse :**
```json
{
  "data": {
    "usersByColoc": [
      {
        "id": "a1b2c3d4-...",
        "name": "Alice",
        "email": "alice@test.com",
        "role": "ADMIN",
        "coloc_id": "b2c3d4e5-...",
        "harmony_score": 10,
        "karma_score": 8
      },
      {
        "id": "c3d4e5f6-...",
        "name": "Bob",
        "email": "bob@test.com",
        "role": "MEMBER",
        "coloc_id": "b2c3d4e5-...",
        "harmony_score": 2,
        "karma_score": 15
      }
    ]
  }
}
```

---

## 8. API GraphQL — Tâches

### `createTask`

Crée une tâche et l'assigne à un membre. Vérifie via gRPC que l'assignee appartient bien à la coloc.

```graphql
mutation {
  createTask(
    title: "Passer l'aspirateur"
    assignee_id: "c3d4e5f6-..."
    coloc_id: "b2c3d4e5-..."
    due_at: "2026-05-01T18:00:00.000Z"  # optionnel
  ) {
    id
    title
    status
    assignee_id
    coloc_id
    created_at
    due_at
  }
}
```

**Réponse :**
```json
{
  "data": {
    "createTask": {
      "id": "d4e5f6a7-...",
      "title": "Passer l'aspirateur",
      "status": "TODO",
      "assignee_id": "c3d4e5f6-...",
      "coloc_id": "b2c3d4e5-...",
      "created_at": "2026-04-28T14:00:00.000Z",
      "due_at": "2026-05-01T18:00:00.000Z"
    }
  }
}
```

**Validations :**
- `title` : 1–150 caractères
- `assignee_id` : UUID valide et appartenant à la coloc
- `coloc_id` : UUID valide correspondant à la coloc du token
- `due_at` : format ISO 8601 (optionnel)

**Erreurs possibles :**
- `"Non autorisé — Vous n'appartenez pas à cette colocation"` si `assignee_id` hors coloc (vérifié via gRPC)

---

### `updateTaskStatus`

```graphql
mutation {
  updateTaskStatus(id: "d4e5f6a7-...", status: "IN_PROGRESS") {
    id
    status
  }
}
```

**Réponse :**
```json
{
  "data": {
    "updateTaskStatus": {
      "id": "d4e5f6a7-...",
      "status": "IN_PROGRESS"
    }
  }
}
```

> Passer une tâche à `DONE` déclenche un événement `TASK_COMPLETED_SCORE_UPDATE` sur Redis. Le `harmony_score` de l'assignee est mis à jour par Concordia : **+10 si avant la `due_at`**, **+2 si après** (ou si pas de `due_at`).

---

### `tasksByColoc`

```graphql
query {
  tasksByColoc(colocId: "b2c3d4e5-...") {
    id
    title
    status
    assignee_id
    coloc_id
    created_at
    due_at
  }
}
```

**Réponse :** tableau de `Task`, trié par `created_at` décroissant.

---

## 9. API GraphQL — Maintenance

### `createMaintenanceTicket`

```graphql
mutation {
  createMaintenanceTicket(
    title: "Robinet qui fuit"
    description: "Cuisine, sous l'évier"  # optionnel
    category: "PLUMBING"
    priority: "LOW"
    coloc_id: "b2c3d4e5-..."
  ) {
    id
    title
    description
    category
    priority
    status
    created_by
    assigned_to
    coloc_id
    created_at
    updated_at
  }
}
```

**Réponse :**
```json
{
  "data": {
    "createMaintenanceTicket": {
      "id": 1,
      "title": "Robinet qui fuit",
      "description": "Cuisine, sous l'évier",
      "category": "PLUMBING",
      "priority": "LOW",
      "status": "OPEN",
      "created_by": "a1b2c3d4-...",
      "assigned_to": null,
      "coloc_id": "b2c3d4e5-...",
      "created_at": "2026-04-28T14:05:00.000Z",
      "updated_at": "2026-04-28T14:05:00.000Z"
    }
  }
}
```

> **Comportement spécial `URGENT` :** une tâche portant le titre `"Urgence : <title>"` est automatiquement créée dans Labor et assignée au créateur du ticket.

---

### `updateTicketStatus`

```graphql
mutation {
  updateTicketStatus(id: "1", status: "IN_PROGRESS") {
    id
    status
    updated_at
  }
}
```

**Réponse :**
```json
{
  "data": {
    "updateTicketStatus": {
      "id": 1,
      "status": "IN_PROGRESS",
      "updated_at": "2026-04-28T14:10:00.000Z"
    }
  }
}
```

---

### `assignTicket`

Réservé au rôle **ADMIN**.

```graphql
mutation {
  assignTicket(id: "1", assigned_to: "c3d4e5f6-...") {
    id
    assigned_to
    updated_at
  }
}
```

**Réponse :**
```json
{
  "data": {
    "assignTicket": {
      "id": 1,
      "assigned_to": "c3d4e5f6-...",
      "updated_at": "2026-04-28T14:12:00.000Z"
    }
  }
}
```

**Erreurs possibles :**
- `"Non autorisé — Réservé aux ADMINs"` si rôle MEMBER
- `"L'utilisateur assigné n'appartient pas à cette colocation"` si UUID hors coloc

---

### `maintenanceTickets`

```graphql
query {
  maintenanceTickets(colocId: "b2c3d4e5-...") {
    id
    title
    description
    category
    priority
    status
    created_by
    assigned_to
    coloc_id
    created_at
    updated_at
  }
}
```

**Réponse :** tableau de `MaintenanceTicket`, trié par `created_at` décroissant.

---

## 10. API GraphQL — Plaintes

### `createComplaint`

```graphql
mutation {
  createComplaint(
    coloc_id: "b2c3d4e5-..."
    message: "Quelqu'un laisse la vaisselle sale pendant des jours"
    target_id: "c3d4e5f6-..."  # optionnel
    is_anonymous: true           # optionnel, défaut: false
  ) {
    id
    coloc_id
    creator_id
    target_id
    message
    is_anonymous
    status
    createdAt
  }
}
```

**Réponse :**
```json
{
  "data": {
    "createComplaint": {
      "id": "507f1f77bcf86cd799439011",
      "coloc_id": "b2c3d4e5-...",
      "creator_id": null,
      "target_id": "c3d4e5f6-...",
      "message": "Quelqu'un laisse la vaisselle sale pendant des jours",
      "is_anonymous": true,
      "status": "OPEN",
      "createdAt": "2026-04-28T14:15:00.000Z"
    }
  }
}
```

> `creator_id` est `null` dans la réponse quand `is_anonymous: true`. Si `target_id` est fourni, un événement `COMPLAINT_TARGETED` est envoyé en plus, pour notifier spécifiquement la personne ciblée.

---

### `resolveComplaint`

Accessible au créateur ou à un ADMIN. Donne **+5 karma** à l'utilisateur qui résout.

```graphql
mutation {
  resolveComplaint(id: "507f1f77bcf86cd799439011") {
    id
    status
    updatedAt
  }
}
```

**Réponse :**
```json
{
  "data": {
    "resolveComplaint": {
      "id": "507f1f77bcf86cd799439011",
      "status": "RESOLVED",
      "updatedAt": "2026-04-28T14:20:00.000Z"
    }
  }
}
```

---

### `deleteComplaint`

Accessible au créateur ou à un ADMIN. Retourne `true` si supprimée.

```graphql
mutation {
  deleteComplaint(id: "507f1f77bcf86cd799439011")
}
```

**Réponse :**
```json
{ "data": { "deleteComplaint": true } }
```

---

### `complaints`

```graphql
query {
  complaints(colocId: "b2c3d4e5-...") {
    id
    creator_id
    target_id
    message
    is_anonymous
    status
    createdAt
  }
}
```

**Réponse :** tableau de `Complaint`, trié par `createdAt` décroissant.

---

## 11. API GraphQL — Sondages

### `createPoll`

Minimum **2 options** requises.

```graphql
mutation {
  createPoll(
    coloc_id: "b2c3d4e5-..."
    question: "Quel jour pour le grand ménage ?"
    options: ["Samedi matin", "Dimanche soir", "Vendredi après-midi"]
  ) {
    id
    question
    options {
      option_id
      text
      voters
    }
    status
    createdAt
  }
}
```

**Réponse :**
```json
{
  "data": {
    "createPoll": {
      "id": "507f191e810c19729de860ea",
      "question": "Quel jour pour le grand ménage ?",
      "options": [
        { "option_id": "e1f2a3b4-...", "text": "Samedi matin", "voters": [] },
        { "option_id": "f2a3b4c5-...", "text": "Dimanche soir", "voters": [] },
        { "option_id": "a3b4c5d6-...", "text": "Vendredi après-midi", "voters": [] }
      ],
      "status": "OPEN",
      "createdAt": "2026-04-28T14:25:00.000Z"
    }
  }
}
```

---

### `votePoll`

Vote pour une option. Remplace le vote précédent si l'utilisateur avait déjà voté. Donne **+2 karma** au votant.

```graphql
mutation {
  votePoll(poll_id: "507f191e810c19729de860ea", option_id: "e1f2a3b4-...") {
    id
    options {
      option_id
      text
      voters
    }
  }
}
```

**Réponse :** le `Poll` mis à jour avec `voters` actualisés.

```json
{
  "data": {
    "votePoll": {
      "id": "507f191e810c19729de860ea",
      "options": [
        { "option_id": "e1f2a3b4-...", "text": "Samedi matin", "voters": ["a1b2c3d4-..."] },
        { "option_id": "f2a3b4c5-...", "text": "Dimanche soir", "voters": [] },
        { "option_id": "a3b4c5d6-...", "text": "Vendredi après-midi", "voters": [] }
      ]
    }
  }
}
```

**Erreurs possibles :**
- `"Ce sondage est fermé"` si `status: "CLOSED"`
- `"Option invalide"` si `option_id` inconnu

---

### `polls`

```graphql
query {
  polls(colocId: "b2c3d4e5-...") {
    id
    creator_id
    question
    options {
      option_id
      text
      voters
    }
    status
    createdAt
  }
}
```

**Réponse :** tableau de `Poll`, trié par `createdAt` décroissant.

---

## 12. API GraphQL — Karma

### `thankUser`

Donne **+3 karma** au colocataire ciblé. Impossible de se remercier soi-même.

```graphql
mutation {
  thankUser(target_id: "c3d4e5f6-...") {
    user_id
    coloc_id
    score
  }
}
```

**Réponse :**
```json
{
  "data": {
    "thankUser": {
      "user_id": "c3d4e5f6-...",
      "coloc_id": "b2c3d4e5-...",
      "score": 18
    }
  }
}
```

**Erreurs possibles :**
- `"Vous ne pouvez pas vous remercier vous-même"` (400)

---

## 13. API GraphQL — Notifications

### `notifications`

Historique paginé des notifications de la colocation.

```graphql
query {
  notifications(
    colocId: "b2c3d4e5-..."
    page: 1    # optionnel, défaut: 1
    limit: 20  # optionnel, défaut: 20
  ) {
    data {
      id
      coloc_id
      type
      message
      created_at
    }
    pagination {
      page
      limit
      total
    }
  }
}
```

**Réponse :**
```json
{
  "data": {
    "notifications": {
      "data": [
        {
          "id": "507f1f77bcf86cd799439022",
          "coloc_id": "b2c3d4e5-...",
          "type": "NEW_TASK",
          "message": "Nouvelle tâche assignée : Passer l'aspirateur",
          "created_at": "2026-04-28T14:00:00.000Z"
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 20,
        "total": 47
      }
    }
  }
}
```

---

## 14. API GraphQL — Dashboard

### `getColocDashboard`

Vue d'ensemble de la colocation. **Mis en cache 30 secondes côté serveur.**

```graphql
query {
  getColocDashboard(colocId: "b2c3d4e5-...") {
    users {
      id
      name
      role
      harmony_score
      karma_score
    }
    tasks {
      id
      title
      status
      assignee_id
      due_at
    }
    open_complaints
  }
}
```

**Réponse :**
```json
{
  "data": {
    "getColocDashboard": {
      "users": [
        { "id": "a1b2c3d4-...", "name": "Alice", "role": "ADMIN", "harmony_score": 10, "karma_score": 8 },
        { "id": "c3d4e5f6-...", "name": "Bob", "role": "MEMBER", "harmony_score": 2, "karma_score": 15 }
      ],
      "tasks": [
        { "id": "d4e5f6a7-...", "title": "Passer l'aspirateur", "status": "TODO", "assignee_id": "c3d4e5f6-...", "due_at": null }
      ],
      "open_complaints": 2
    }
  }
}
```

---

## 15. Temps réel — Socket.io

### Connexion

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3003");

socket.on("connect", () => {
  console.log("Connecté au service Concordia");
});
```

### Écouter les notifications d'une coloc

```javascript
const colocId = "b2c3d4e5-...";
socket.on(`coloc_${colocId}_notifications`, (event) => {
  console.log(event.type, event.message);
});
```

### Structure des événements par type

Chaque événement a au minimum `type`, `coloc_id` et `message`. Les champs supplémentaires varient selon le type.

---

#### `NEW_TASK`

```json
{
  "type": "NEW_TASK",
  "coloc_id": "b2c3d4e5-...",
  "message": "Nouvelle tâche assignée : Passer l'aspirateur"
}
```

---

#### `TASK_UPDATED`

```json
{
  "type": "TASK_UPDATED",
  "coloc_id": "b2c3d4e5-...",
  "task_id": "d4e5f6a7-...",
  "status": "IN_PROGRESS",
  "message": "Tâche \"Passer l'aspirateur\" mise à jour : IN_PROGRESS"
}
```

---

#### `TASK_COMPLETED_SCORE_UPDATE`

Émis quand une tâche passe à `DONE`. Indique si c'est dans les temps.

```json
{
  "type": "TASK_COMPLETED_SCORE_UPDATE",
  "coloc_id": "b2c3d4e5-...",
  "user_id": "c3d4e5f6-...",
  "is_on_time": true,
  "points": 10,
  "message": "Score harmony mis à jour"
}
```

> `points` vaut `10` si `is_on_time: true`, `2` sinon (ou si pas de `due_at`).

---

#### `NEW_MAINTENANCE_TICKET`

```json
{
  "type": "NEW_MAINTENANCE_TICKET",
  "coloc_id": "b2c3d4e5-...",
  "ticket_id": 1,
  "title": "Robinet qui fuit",
  "priority": "LOW",
  "creator_name": "Bob",
  "message": "Nouveau ticket [LOW] signalé par Bob : Robinet qui fuit"
}
```

---

#### `MAINTENANCE_TICKET_UPDATED`

```json
{
  "type": "MAINTENANCE_TICKET_UPDATED",
  "coloc_id": "b2c3d4e5-...",
  "ticket_id": 1,
  "status": "IN_PROGRESS",
  "message": "Ticket \"Robinet qui fuit\" mis à jour : IN_PROGRESS"
}
```

---

#### `MAINTENANCE_TICKET_ASSIGNED`

```json
{
  "type": "MAINTENANCE_TICKET_ASSIGNED",
  "coloc_id": "b2c3d4e5-...",
  "ticket_id": 1,
  "assigned_to": "c3d4e5f6-...",
  "message": "Ticket \"Robinet qui fuit\" assigné à un membre de la colocation"
}
```

---

#### `NEW_COMPLAINT`

```json
{
  "type": "NEW_COMPLAINT",
  "coloc_id": "b2c3d4e5-...",
  "complaint_id": "507f1f77bcf86cd799439011",
  "message": "Nouvelle plainte signalée dans la colocation"
}
```

---

#### `COMPLAINT_TARGETED`

Envoyé **en plus** de `NEW_COMPLAINT` quand une plainte a un `target_id`.

```json
{
  "type": "COMPLAINT_TARGETED",
  "coloc_id": "b2c3d4e5-...",
  "target_id": "c3d4e5f6-...",
  "complaint_id": "507f1f77bcf86cd799439011",
  "message": "Vous avez été mentionné dans une plainte"
}
```

> Utiliser `target_id` pour notifier uniquement la personne concernée dans l'UI.

---

#### `COMPLAINT_RESOLVED`

```json
{
  "type": "COMPLAINT_RESOLVED",
  "coloc_id": "b2c3d4e5-...",
  "complaint_id": "507f1f77bcf86cd799439011",
  "message": "Une plainte a été résolue"
}
```

---

#### `COMPLAINT_DELETED`

```json
{
  "type": "COMPLAINT_DELETED",
  "coloc_id": "b2c3d4e5-...",
  "complaint_id": "507f1f77bcf86cd799439011",
  "message": "Une plainte a été supprimée"
}
```

---

#### `NEW_POLL`

```json
{
  "type": "NEW_POLL",
  "coloc_id": "b2c3d4e5-...",
  "poll_id": "507f191e810c19729de860ea",
  "question": "Quel jour pour le grand ménage ?",
  "message": "Nouveau sondage : Quel jour pour le grand ménage ?"
}
```

---

#### `POLL_UPDATED`

```json
{
  "type": "POLL_UPDATED",
  "coloc_id": "b2c3d4e5-...",
  "poll_id": "507f191e810c19729de860ea",
  "question": "Quel jour pour le grand ménage ?",
  "message": "Un vote a été enregistré sur le sondage : Quel jour pour le grand ménage ?"
}
```

---

## 16. Règles métier importantes

### Harmony Score vs Karma Score

Ce sont deux métriques indépendantes affichées sur le profil utilisateur.

| | Harmony Score | Karma Score |
|---|---|---|
| **Stockage** | PostgreSQL (domus) | MongoDB (concordia) |
| **Nature** | Fiabilité, sérieux | Social, entraide |
| **Quand ça monte** | Tâche terminée à temps (+10), tâche terminée en retard (+2) | Remerciement reçu (+3), plainte résolue (+5), vote dans sondage (+2) |
| **Champ GraphQL** | `harmony_score` sur `User` | `karma_score` sur `User` (enrichi par le gateway) |

### Gestion du token

Le token JWT est **immutable une fois émis**. Si `coloc_id` ou `role` changent, le backend génère un nouveau token. Le frontend doit remplacer le token stocké après :
- `createColoc` → `data.createColoc.token`
- `joinColoc` → `data.joinColoc.token`

### `MaintenanceTicket.id` est un entier

Contrairement à tous les autres IDs (UUID strings), l'ID d'un ticket de maintenance est un **entier auto-incrémenté** (`1`, `2`, `3`...). Dans les mutations GraphQL, passer cet id sous forme de string (`"1"`) — GraphQL l'accepte dans les deux cas.

### Anonymat des plaintes

Quand `is_anonymous: true` : `creator_id` est `null` **dans toutes les réponses**, y compris pour l'ADMIN. Il n'existe aucun endpoint pour révéler l'auteur. À afficher côté UI comme "Auteur anonyme".

### Vote de sondage

Un utilisateur ne peut voter que pour **une seule option à la fois**. Revoter déplace simplement le vote. Pour savoir si l'utilisateur courant a déjà voté, chercher son UUID dans les tableaux `voters` de chaque option.

### Escalade automatique URGENT

Créer un ticket de maintenance avec `priority: "URGENT"` déclenche automatiquement la création d'une tâche dans Labor :
- Titre : `"Urgence : <titre du ticket>"`
- Assignée au créateur du ticket
- Statut initial : `TODO`

L'escalade est **best-effort** : si le service Labor est indisponible, le ticket est quand même créé. Ne pas attendre de confirmation de la tâche dans la réponse du `createMaintenanceTicket`.

### Cache du dashboard

Le `getColocDashboard` est mis en cache Redis côté serveur pendant **30 secondes**. Toute mutation (tâche, ticket, plainte, poll, karma) invalide le cache. Le frontend n'a pas besoin de gérer ce cache — il reçoit toujours des données fraîches après une mutation.

### Pagination des notifications

Par défaut : `page: 1`, `limit: 20`. Pour paginer :
```
totalPages = Math.ceil(pagination.total / pagination.limit)
```

### Accès des ADMIN

Un utilisateur ADMIN peut accéder aux données de **sa propre colocation** uniquement — l'ADMIN n'est pas un super-administrateur global de l'application.
