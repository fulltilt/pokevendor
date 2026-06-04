#!/bin/bash
# Seeds the database with example data (run after migrations)

cd apps/api

echo "Seeding database..."
npx ts-node --loader tsx prisma/seed.ts

echo "✅ Database seeded!"
