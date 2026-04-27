# 🧪 Guide de Test Complet : Sodalis Backend

Ce tutoriel te guide à travers un scénario complet pour tester toutes les fonctionnalités : Authentification JWT, Mutations GraphQL, gRPC, Cache Redis et Notifications persistées.

---

## 🚀 Étape 1 : Préparation

1. **Vider les bases** (Déjà fait par mes soins) : Les bases PostgreSQL, MongoDB et Redis sont propres.
2. **Lancer les services** : Assure-toi que les 4 services tournent (`npm run dev`) :
   - Domus (3001)
   - Labor (3002)
   - Concordia (3003)
   - Gateway (4000)

---

## 🔐 Étape 2 : Authentification (REST - Domus)

On commence par créer un compte et récupérer un jeton de sécurité (**JWT**).

```bash
# 1. Inscription
curl -X POST http://localhost:3001/auth/register \
-H "Content-Type: application/json" \
-d '{"name": "Leo", "email": "leo@test.com", "password": "password123"}'

# 2. Connexion pour récupérer le Token
curl -X POST http://localhost:3001/auth/login \
-H "Content-Type: application/json" \
-d '{"email": "leo@test.com", "password": "password123"}'
```
> [!IMPORTANT]
> Copie le `token` reçu dans la réponse de login. Tu devras l'utiliser dans toutes les étapes suivantes via le header `Authorization: Bearer <TON_TOKEN>`.

---

## 🏗️ Étape 3 : Création de données via GraphQL (Gateway)

Rends-toi sur [http://localhost:4000/graphql](http://localhost:4000/graphql).
Ajoute ton token dans l'onglet **HTTP HEADERS** en bas :
```json
{
  "Authorization": "Bearer <TON_TOKEN_ICI>"
}
```

### 1. Créer une Colocation (Mutation)
Exécute cette mutation :
```graphql
mutation CreateColoc($name: String!) {
  createColoc(name: $name) {
    id
    name
    invite_code
  }
}
```
*(Variables: `{"name": "Appartement Lyon"}`)*. Note l'ID de la coloc retourné.

### 2. Créer une Tâche (Mutation)
Cela va tester **GraphQL -> Labor -> Domus (gRPC)** :
```graphql
mutation CreateTask($title: String!, $assignee_id: ID!, $coloc_id: ID!) {
  createTask(title: $title, assignee_id: $assignee_id, coloc_id: $coloc_id) {
    id
    title
  }
}
```
*(Variables: utilise ton `user_id` de l'étape 2 et l'ID de coloc de l'étape 3.1)*.

---

## 📊 Étape 4 : Consultations et Vérifications

### 1. Dashboard (Query + Cache)
```graphql
query GetDashboard($colocId: ID!) {
  getColocDashboard(colocId: $colocId) {
    users { name }
    tasks { title }
  }
}
```
- **1er passage** : `Cache miss` (lent).
- **2ème passage** : `Cache hit` (rapide).

### 2. Historique des Notifications (REST - Concordia)
Vérifie que la tâche créée a bien été persistée dans MongoDB :
```bash
curl -H "Authorization: Bearer <TON_TOKEN>" \
http://localhost:3003/notifications/coloc/<ID_COLOC>
```

### 3. Temps Réel (WebSockets)
Connecte-toi à `ws://localhost:3003` (via un outil Socket.io).
- Écoute l'événement : `coloc_<ID_COLOC>_notifications`.
- Crée une tâche (Étape 3.2).
- Tu reçois la notification en direct !

---

## 🛡️ Étape 5 : Test de Sécurité (Optionnel)
Essaie de faire une requête GraphQL **sans le header Authorization** ou avec un **ID de coloc différent** de celui de ton profil : tu devrais recevoir une erreur `Non autorisé`.
