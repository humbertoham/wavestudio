import { PrismaClient, PackHighlight } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const envName = process.env.SEED_ENV_NAME?.trim().toLowerCase();
const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

function requireSeedEnv() {
  if (envName !== "dev" && envName !== "uat") {
    throw new Error('SEED_ENV_NAME must be "dev" or "uat". Refusing to seed.');
  }

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required.");
  }

  if (!adminEmail || !adminPassword) {
    throw new Error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required.");
  }
}

function futureDate(daysFromNow, hourUtc) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date;
}

async function seed() {
  requireSeedEnv();

  const label = envName.toUpperCase();
  const adminPasswordHash = await bcrypt.hash(adminPassword, 12);

  const instructorId = `seed_${envName}_instructor`;
  const packIds = [
    `seed_${envName}_single_class`,
    `seed_${envName}_five_pack`,
  ];

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: `${label} Admin`,
      passwordHash: adminPasswordHash,
      role: "ADMIN",
    },
    create: {
      name: `${label} Admin`,
      email: adminEmail,
      passwordHash: adminPasswordHash,
      role: "ADMIN",
    },
  });

  await prisma.instructor.upsert({
    where: { id: instructorId },
    update: {
      name: `${label} Instructor`,
      bio: `Seed instructor for ${label}.`,
      isVisible: true,
    },
    create: {
      id: instructorId,
      name: `${label} Instructor`,
      bio: `Seed instructor for ${label}.`,
      isVisible: true,
    },
  });

  await prisma.pack.upsert({
    where: { id: packIds[0] },
    update: {
      name: `${label} Clase suelta`,
      classes: 1,
      price: 250,
      validityDays: 14,
      isActive: true,
      isVisible: true,
      oncePerUser: false,
      classesLabel: "1 clase",
      highlight: null,
      description: [`Seed ${label}: clase suelta para pruebas.`],
    },
    create: {
      id: packIds[0],
      name: `${label} Clase suelta`,
      classes: 1,
      price: 250,
      validityDays: 14,
      isActive: true,
      isVisible: true,
      oncePerUser: false,
      classesLabel: "1 clase",
      highlight: null,
      description: [`Seed ${label}: clase suelta para pruebas.`],
    },
  });

  await prisma.pack.upsert({
    where: { id: packIds[1] },
    update: {
      name: `${label} Paquete 5 clases`,
      classes: 5,
      price: 1000,
      validityDays: 45,
      isActive: true,
      isVisible: true,
      oncePerUser: false,
      classesLabel: "5 clases",
      highlight: PackHighlight.POPULAR,
      description: [`Seed ${label}: paquete visible para pruebas.`],
    },
    create: {
      id: packIds[1],
      name: `${label} Paquete 5 clases`,
      classes: 5,
      price: 1000,
      validityDays: 45,
      isActive: true,
      isVisible: true,
      oncePerUser: false,
      classesLabel: "5 clases",
      highlight: PackHighlight.POPULAR,
      description: [`Seed ${label}: paquete visible para pruebas.`],
    },
  });

  const classes = [
    {
      id: `seed_${envName}_class_1`,
      title: `${label} Flow`,
      focus: "Seed data",
      date: futureDate(2, 16),
      durationMin: 50,
      capacity: 10,
      creditCost: 1,
      instructorId,
    },
    {
      id: `seed_${envName}_class_2`,
      title: `${label} Strength`,
      focus: "Seed data",
      date: futureDate(4, 17),
      durationMin: 50,
      capacity: 10,
      creditCost: 1,
      instructorId,
    },
  ];

  for (const item of classes) {
    await prisma.class.upsert({
      where: { id: item.id },
      update: item,
      create: item,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        seeded: envName,
        adminEmail,
        packs: packIds.length,
        instructors: 1,
        classes: classes.length,
      },
      null,
      2
    )
  );
}

seed()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
