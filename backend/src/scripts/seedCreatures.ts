/**
 * seedCreatures.ts
 * CLI script to seed SRD creatures. Can also be triggered via API.
 * Run with: npx ts-node src/scripts/seedCreatures.ts
 */

// Loads backend/.env, which the database client does not read itself.
import 'dotenv/config';
import { createPrismaClient } from '../config/prismaClient';
import { seedSrdCreatures } from '../services/creatureSeed';

const prisma = createPrismaClient();

async function main() {
  console.log('CozyVTT Creature Library Seeder');
  console.log('Storing the monsters of the System Reference Document 5.2.1...\n');

  const result = await seedSrdCreatures(prisma);

  console.log(`In the document: ${result.fetched}`);
  console.log(`Created: ${result.created}`);
  console.log(`Updated (stat block replaced): ${result.updated}`);
  console.log(`Removed (not in the 2024 document): ${result.removed}`);
  console.log(`Skipped (already up to date): ${result.skipped}`);
  console.log(`Left out (stat block not valid): ${result.rejected}`);
  console.log(`Previously in DB: ${result.alreadyExisted}`);
  console.log('\nDone. SRD creatures are available to all campaigns.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
