# RoomReport

Property inspection platform for coliving operators.

## Tech Stack

- **Frontend:** React + Vite
- **Backend:** Node.js + Express.js
- **Database:** PostgreSQL (Neon)
- **ORM:** Prisma
- **Auth:** Lucia Auth
- **Hosting:** DigitalOcean droplet with PM2 + Nginx

## Prerequisites

- Node.js 20+
- PostgreSQL database (or a [Neon](https://neon.tech) account)

## Getting Started

1. **Clone the repo and install dependencies:**

   ```bash
   git clone <repo-url>
   cd roomreport
   npm install
   ```

2. **Set up environment variables:**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your database URL and other settings.

3. **Generate Prisma client:**

   ```bash
   npm run db:generate
   ```

4. **Run database migrations** (once you have models):

   ```bash
   npm run db:migrate
   ```

5. **Start development servers:**

   ```bash
   npm run dev
   ```

   This starts both the Vite dev server (http://localhost:5173) and the Express API server (http://localhost:3000) concurrently. The Vite dev server proxies `/api` requests to Express.

## Project Structure

```
/client          — React + Vite frontend
/server          — Express.js backend
/prisma          — Prisma schema and migrations
/shared          — Shared types/constants
```

## Scripts

| Command            | Description                          |
| ------------------ | ------------------------------------ |
| `npm run dev`      | Start client and server concurrently |
| `npm run build`    | Build the client for production      |
| `npm start`        | Start the production server          |
| `npm run lint`     | Run ESLint                           |
| `npm run format`   | Format code with Prettier            |
| `npm run db:generate` | Generate Prisma client            |
| `npm run db:migrate`  | Run Prisma migrations             |
| `npm run db:studio`   | Open Prisma Studio                |
