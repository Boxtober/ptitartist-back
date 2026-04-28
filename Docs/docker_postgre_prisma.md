# 🚀 Guide complet : Docker + PostgreSQL + Prisma (setup backend moderne)

## 🧠 Objectif du guide

Ce document explique pas à pas comment installer et comprendre un environnement backend basé sur :

- Docker
- PostgreSQL
- Prisma ORM
- Node.js (Fastify)

L’objectif est d’avoir un environnement de développement propre et isolé.

---

# 🐳 1. Docker : le conteneur de base

## 🔹 C’est quoi Docker ?

Docker permet de lancer des applications dans des environnements isolés appelés **conteneurs**.

👉 Avantages :

- pas d’installation directe sur la machine
- pas de conflits de versions
- environnement reproductible

Ici, on utilise Docker pour lancer PostgreSQL.

---

# 🐘 2. PostgreSQL dans Docker

## 🔹 C’est quoi PostgreSQL ?

PostgreSQL est une base de données relationnelle.

Elle permet de stocker :

- utilisateurs
- données applicatives
- relations entre tables

## 🔹 Lancer PostgreSQL

```bash
docker run --name postgres-db \
  -e POSTGRES_USER=dev \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=ptitartist \
  -p 5432:5432 \
  -d postgres
```

## 🔹 Vérifier le container

```bash
docker ps
```

## 🔹 Connexion à la base

```bash
docker exec -it postgres-db psql -U dev -d ptitartist
```

---

# ⚙️ 3. Prisma ORM

## 🔹 C’est quoi Prisma ?

Prisma est un ORM (Object Relational Mapper).

Il permet de :

- créer des tables via du code
- faire des requêtes sans SQL brut
- gérer les migrations

---

## 🔹 Installation

```bash
npm install prisma --save-dev
npx prisma init
```

---

# 📁 4. Structure Prisma

## 🔹 schema.prisma

C’est le fichier principal qui définit la base de données.

```prisma
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  createdAt DateTime @default(now())
}
```

---

## 🔹 .env

```env
DATABASE_URL="postgresql://dev:devpass@localhost:5432/ptitartist"
```

---

# 🧱 5. Migrations Prisma

## 🔹 C’est quoi une migration ?

Une migration transforme le schema Prisma en tables PostgreSQL.

## 🔹 Commande

```bash
npx prisma migrate dev --name init
```

Cela crée :

- les tables en base
- le dossier migrations
- le client Prisma

---

# 📊 6. Prisma Studio

## 🔹 C’est quoi ?

Interface graphique pour voir la base de données.

## 🔹 Lancer

```bash
npx prisma studio
```

Permet :

- ajouter des users
- modifier des données
- visualiser les tables

---

# 🧠 7. Architecture complète

```text
Node.js (Fastify)
        ↓
Prisma ORM
        ↓
PostgreSQL (Docker)
```

---

# 💡 Résumé

👉 Docker = environnement
👉 PostgreSQL = base de données
👉 Prisma = gestion de la base
👉 Studio = interface visuelle
👉 Migrations = création des tables
