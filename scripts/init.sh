#!/bin/bash
# Initialize the project: install deps, set up DB, run migrations

echo "Installing dependencies..."
npm install

echo "Setting up environment files..."
cp apps/api/.env.example apps/api/.env

echo "Generating Prisma client..."
npm run prisma:generate -w apps/api

echo "✅ Project initialized! Run 'docker-compose up' to start."
