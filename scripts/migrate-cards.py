#!/usr/bin/env python3
import psycopg2
from psycopg2.extras import execute_batch

# Source database (pokegraph)
source_conn = psycopg2.connect(
    host="localhost",
    port=5432,
    database="pokedex",
    user="postgres",
    password="password"
)

# Destination database (pokevendor)
dest_conn = psycopg2.connect(
    host="localhost",
    port=5433,
    database="pokevendor",
    user="pokevendor",
    password="pokevendor"
)

source_cur = source_conn.cursor()
dest_cur = dest_conn.cursor()

try:
    # Get all cards from source
    print("Fetching cards from pokegraph...")
    source_cur.execute('SELECT id, data, "tcgPlayerId" FROM "Card"')
    cards = source_cur.fetchall()
    print(f"✓ Found {len(cards)} cards")

    # Insert into destination
    print("\nInserting cards into pokevendor...")
    batch_size = 100
    for i in range(0, len(cards), batch_size):
        batch = cards[i:i+batch_size]
        execute_batch(
            dest_cur,
            'INSERT INTO "Card" (id, data, "tcgPlayerId") VALUES (%s, %s, %s) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, "tcgPlayerId" = EXCLUDED."tcgPlayerId"',
            batch
        )
        dest_conn.commit()
        if i % 1000 == 0:
            print(f"  Progress: {i+len(batch)}/{len(cards)}")

    print(f"\n✓ Successfully migrated {len(cards)} cards")
    
finally:
    source_cur.close()
    dest_cur.close()
    source_conn.close()
    dest_conn.close()
