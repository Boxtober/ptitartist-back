## 🧠 Objectif

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

---

# 🛠️ 8. Ajouter ou modifier une table (workflow détaillé)

Cette section explique les étapes et commandes concrètes pour :

- modifier le schéma (`prisma/schema.prisma`),
- créer et appliquer une migration en développement,
- régénérer le client Prisma,
- et déployer les migrations en production.

Remarque importante :

- En développement local, utilisez `migrate dev` (création de migration + application).
- En production, générez les migrations en local puis utilisez `migrate deploy` sur le serveur/CI.

1. Modifier le schéma

- Ouvre `prisma/schema.prisma` et ajoute/modifie le modèle ou le champ souhaité.
- Exemple (ajout d'un champ `imageDescription` sur `Image`) :

```prisma
model Image {
  id String @id @default(uuid())
  url String
  description String?
  imageDescription String?
  // ...
}
```

2. Créer et appliquer la migration en local (dev)

- Cette commande génère une migration SQL et l'applique à ta base locale.

```bash
npx prisma migrate dev --name add_image_imageDescription
```

- Que fait-elle ?
  - crée un dossier `prisma/migrations/<timestamp>_add_image_imageDescription/` contenant `migration.sql`
  - applique la migration sur la base de données pointée par `DATABASE_URL`
  - régénère automatiquement le client Prisma (si nécessaire)

3. Régénérer manuellement le client Prisma (optionnel)

```bash
npx prisma generate
```

4. Vérifier la migration et le SQL généré

- Inspecte le SQL que Prisma va exécuter (ou a exécuté) :

```bash
cat prisma/migrations/*_add_image_imageDescription/migration.sql
```

- Si tu veux tester rapidement sans créer de migration (prototype), tu peux utiliser `db push` (attention : peut causer une perte de données si `--accept-data-loss` utilisé) :

```bash
npx prisma db push
```

5. Déployer en production / CI

- En production, ne lance pas `migrate dev`. Au lieu de cela :
  - crée la migration en local (comme en 2)
  - pousse ton code + dossier `prisma/migrations` dans ton dépôt
  - sur le serveur/CI, exécute :

```bash
npx prisma migrate deploy
```

- Pour vérifier l'état des migrations :

```bash
npx prisma migrate status
```

6. Réinitialiser la base (dev uniquement)

- Si ta base de dev est corrompue ou que tu veux repartir propre :

```bash
npx prisma migrate reset
```

- Attention : cette commande supprime les données locales.

7. Récupérer le schéma depuis une base distante

- Si la base a été modifiée (ex : autre service), récupère le schéma actuel :

```bash
npx prisma db pull
```

8. Gérer les conflits / renommages / opérations manuelles

- Certaines opérations (rename d'une colonne, split d'une table) nécessitent une migration SQL manuelle.
- Tu peux éditer `prisma/migrations/<xxx>/migration.sql` avant d'appliquer la migration, ou créer une migration vide et y écrire du SQL.

9. Outils utiles

- Lancer Prisma Studio pour inspecter les données :

```bash
npx prisma studio
```

- Si la DB est dans Docker, assure-toi que le container PostgreSQL est lancé :

```bash
docker-compose up -d postgres
```

10. Bonnes pratiques

- Toujours créer une nouvelle migration pour les changements de schéma en dev.
- Relire le SQL généré avant de le déployer en production.
- Pour changements risqués (renames, suppressions), prévoir une migration en deux étapes (nouveau champ + copy data puis suppression) pour éviter la perte.

---

Fin de la documentation mise à jour.
