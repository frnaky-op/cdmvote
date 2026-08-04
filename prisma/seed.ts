import bcrypt from "bcryptjs";
import { prisma } from "../lib/db";

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env to seed the admin user",
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });

  console.log(`Seeded admin user: ${email}`);

  const existingTournament = await prisma.tournament.findFirst();
  if (!existingTournament) {
    const tournament = await prisma.tournament.create({
      data: { name: "Tournament", status: "draft" },
    });
    console.log(`Seeded tournament: ${tournament.name} (${tournament.id})`);
  } else {
    console.log(`Tournament already exists: ${existingTournament.name}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
