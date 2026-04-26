require("dotenv").config();
const prisma = require("../config/prisma");

// ID -> { newName, unit: "dona" }
const RENAMES = {
  // COLA
  "cf66be72deea5a95b34471db": { name: "COLA 1.5L" },
  "23e4302f1558a7bb30502683": { name: "COLA 1L" },
  "fbb7815edd8eb6a2c75cb9c1": { name: "COLA 0.5L" },
  "5b93c4f59a4299f6397bca41": { name: "COLA BANIJNI KATTA" },
  // FANTA
  "50bd2b8d96e3dc6aa7b3e986": { name: "FANTA 1.5L" },
  "e40c59abfc158b35b74a9454": { name: "FANTA 0.5L" },
  "8163112543d678abcfc36a75": { name: "FANTA BANIJNI KATTA" },
  // SPRITE
  "46ff66f72164ce255a81b4b0": { name: "SPRITE 0.5L" },
  "928807ceaf8d4cbc3f9279cf": { name: "SPRITE 1L" },
  // PEPSI
  "b43599b4ad2f8ec3d1658da1": { name: "PEPSI 1L" },
  "f332fd07035826364e94d6cf": { name: "PEPSI 0.5L" },
  "1d6e4e58eb1a633fa96b644a": { name: "PEPSI 1.5L" },
  "fe100a8314b0fcadab48e352": { name: "PEPSI BANIJNI KATTA" },
  "6b0035b7de44a845aa91b438": { name: "PEPSI BANIJNI KICHIK" },
  // MIRINDA
  "0f5e3fb66ff5b808e97d0c02": { name: "MIRINDA 1L" },
  "15578aa4eab4561a2f7f5faf": { name: "MIRINDA 1.5L" },
  "5839fbe1e13ba018beb6fce2": { name: "MIRINDA 0.5L" },
  // LIPTON
  "82437c439747e5bca5bd3997": { name: "LIPTON 1.5L" },
  "66df050d6b6e386be9b159aa": { name: "LIPTON 1L" },
  "b7c806fb2a91f728d387ed97": { name: "LIPTON 0.5L" },
  // MILLIY COLA
  "4c939b9b587503d7c37bd5da": { name: "MILLIY COLA 1L" },
  // FLAVIS
  "56820f8cac86111a1c93b502": { name: "FLAVIS 0.5L" },
  // DINAY
  "2273950325f81f509c70bf23": { name: "DINAY 1L" },
  "2e5376496439e4b0a618e80a": { name: "DINAY 0.5L" },
  // BONAQUA
  "21e9fcd05000d2ba1c127aef": { name: "BONAQUA 0.5L" },
  "a8e4a0dc1cb904f5c463f983": { name: "BONAQUA 1L" },
};

async function main() {
  console.log("=== Ichimlik nomlarini yangilash ===\n");

  // 1. Rename products with size + set unit to dona
  for (const [id, data] of Object.entries(RENAMES)) {
    const old = await prisma.product.findUnique({ where: { id }, select: { name: true, unit: true } });
    if (!old) { console.log(`  ! ${id} topilmadi`); continue; }

    await prisma.product.update({
      where: { id },
      data: { name: data.name, unit: "dona" }
    });
    console.log(`  ${old.name} (${old.unit}) -> ${data.name} (dona)`);
  }

  // 2. Also update any remaining suv category products that still have "litr" unit
  const remaining = await prisma.product.findMany({
    where: { categoryKey: "suv", unit: "litr" },
    select: { id: true, name: true }
  });
  for (const p of remaining) {
    await prisma.product.update({ where: { id: p.id }, data: { unit: "dona" } });
    console.log(`  ${p.name}: litr -> dona`);
  }

  console.log("\nTayyor!");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
