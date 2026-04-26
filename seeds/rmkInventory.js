require("dotenv").config();
const prisma = require("../config/prisma");
const crypto = require("crypto");

function genId() {
  return crypto.randomBytes(12).toString("hex");
}

const RMK_BRANCH_ID = "81f788414d22887941536adb";

// Exact mapping: item name -> existing product ID
const EXISTING_MAP = {
  "Toʻrt mini":        "c85a0cad4e4b96a670661a29", // MINI TORT
  "Bento":             "1e35fedd7047275c7a18b4b7", // BENTO
  "Napalyon":          "f72c65e8f58d92f845e37884", // NAPOLEON
  "Avganski":          "e2182d84731871b638b450b9", // AFG'ONCHA
  "Mini medovik":      "ee0a9c1ceaa19a25b097b91d", // MINI MEDOVIK
  "Piramida":          "9532c3265b60af3435e5d077", // PIRAMIDA
  "Rulet oq":          "0a3430c4cc222a0840c0abdc", // RULET OQ QORA
  "Snikisli perojni":  "0b44424921fe9c05d84d915a", // SNIKERSLI
  "Sansebastiyan":     "9304a73f9fbfb7155c97e01c", // SANSEBASTYAN
  "Milka oq":          "10cf2006cc6f58cfdf96856f", // MILKA OQ
  "Milka qora":        "72225b3165abfe009fbaf8e3", // MILKA QORA
  "Dollar oq":         "726ac1ce143232b5caf71e86", // DOLLAR OQ IRISKA
  "Hadya mini":        "af85ba66cf7795bbd78e02cc", // HADYA MINI
  "Chokko mini":       "b2cde33d91565c1e6489dfa7", // SHOKO MINI
  "Mini milka oq":     "e8687fe48b3d2fc2647479ef", // MILKA MINI OQ
  "Chokko":            "0aad20356f850a1af8e401ae", // SHOKO
  "Mandarin":          "cfe0cc44b7d422eaa0408e0d", // MANDARIN
  "Nok":               "278734eb85f1b03c9640302f", // NOK
  "Malina":            "31b43002c4d0c8b2e8a0dafc", // MALINA
  "Gilos":             "a2af6a27689ca7d7564e3919", // GILOS
  "Snikis karamel":    "583d6efe93b14ba2ed99438f", // KARAMEL SNIKERS
  "Trafell":           "1e4dbc7bf7acde476a55b9ee", // TRAFEL
  "Transfer":          "ecf750759c223b99cc6a3930", // TRAFERS
  "Disert":            "d35abd308286cfd211e99a07", // DISSER
  "Ekler":             "d607cea476aacc183a462205", // EKLER
  "Pechony":           "1286410708ddbfc877dd7144", // PECHONIY
  "Pisochniy":         "37925b8ed3c6e69c2a9880d8", // PESOCHNIY
  "Paxlava":           "d9380ad3b932c0a8fe3db00e", // PAHLAVA
  "Dena":              "80ba95239cc5e34d326b771d", // DENA
  // Drinks with multiple entries - assign by size
  "Cola 1.5":              "cf66be72deea5a95b34471db", // COLA litr
  "Cola 1l":               "23e4302f1558a7bb30502683", // COLA litr
  "Cola 0.5l":             "fbb7815edd8eb6a2c75cb9c1", // COLA litr
  "Cola banijni katta":    "5b93c4f59a4299f6397bca41", // COLA dona
  "Fanta 1.5":             "50bd2b8d96e3dc6aa7b3e986", // FANTA litr
  "Fanta 0.5l":            "e40c59abfc158b35b74a9454", // FANTA litr
  "Fanta banijni katta":   "8163112543d678abcfc36a75", // FANTA litr
  "Sprite 0.5l":           "46ff66f72164ce255a81b4b0", // SPRITE litr
  "Pepsi 1l":              "b43599b4ad2f8ec3d1658da1", // PEPSI litr
  "Pepsi 0.5l":            "f332fd07035826364e94d6cf", // PEPSI litr
  "Pepsi 1.5l":            "1d6e4e58eb1a633fa96b644a", // PEPSI litr
  "Pepsi banijni katta":   "fe100a8314b0fcadab48e352", // PEPSI dona
  "Pepsi banijni kichik":  "6b0035b7de44a845aa91b438", // PEPSI dona
  "Mirinda 1l":            "0f5e3fb66ff5b808e97d0c02", // MIRINDA litr
  "Mirinda 1.5l":          "15578aa4eab4561a2f7f5faf", // MIRINDA litr
  "Mirinda 0.5l":          "5839fbe1e13ba018beb6fce2", // MIRINDA litr
  "Liptin 1.5l":           "82437c439747e5bca5bd3997", // LIPTON litr
  "Liptin 1l":             "66df050d6b6e386be9b159aa", // LIPTON litr
  "Liptin 0.5l":           "b7c806fb2a91f728d387ed97", // LIPTON litr
  "Milliy Cola 1l":        "4c939b9b587503d7c37bd5da", // MILLIY COLA litr
  "Flaus 0.5l":            "56820f8cac86111a1c93b502", // FLAVIS litr
  "Dinay 1l":              "2273950325f81f509c70bf23", // DINAY dona
  "Dinay 0.5l":            "2e5376496439e4b0a618e80a", // DINAY dona
  "Banaqua 0.5l":          "21e9fcd05000d2ba1c127aef", // BONAQUA litr
  "Banaqua 1l":            "a8e4a0dc1cb904f5c463f983", // BONAQUA litr
};

// New products to create
const NEW_PRODUCTS = [
  { name: "TURBIRCHAK TORT",      unit: "dona", category: "tortlar" },
  { name: "TORT PRO",             unit: "dona", category: "tortlar" },
  { name: "SNIKISLI TORT MINI",   unit: "dona", category: "tortlar" },
  { name: "TORT 200",             unit: "dona", category: "tortlar" },
  { name: "HADYA",                unit: "dona", category: "pirojniylar" },
  { name: "TIVAROJNIY",           unit: "dona", category: "pirojniylar" },
  { name: "NOK MINI",             unit: "dona", category: "mevalar" },
  { name: "MALINA MINI",          unit: "dona", category: "mevalar" },
  { name: "GILOS MINI",           unit: "dona", category: "mevalar" },
  { name: "DINAY BANIJNI",        unit: "dona", category: "suv" },
];

// Map user item name -> new product name
const NEW_MAP = {
  "Turbirchak toʻrt":  "TURBIRCHAK TORT",
  "Toʻrt Pro":         "TORT PRO",
  "Snikisli toʻrt mini":"SNIKISLI TORT MINI",
  "Toʻrt 200":         "TORT 200",
  "Hadya":             "HADYA",
  "Tivarojniy":        "TIVAROJNIY",
  "Nok mini":          "NOK MINI",
  "Malina mini":       "MALINA MINI",
  "Gilos mini":        "GILOS MINI",
  "Dinay banijni":     "DINAY BANIJNI",
};

async function main() {
  console.log("=== RMK Inventory Seed ===\n");

  // All items from user
  const items = [
    { name: "Turbirchak toʻrt", qty: 3, unit: "dona" },
    { name: "Toʻrt Pro", qty: 20, unit: "dona" },
    { name: "Snikisli toʻrt mini", qty: 1, unit: "dona" },
    { name: "Toʻrt mini", qty: 4, unit: "dona" },
    { name: "Bento", qty: 1, unit: "dona" },
    { name: "Toʻrt 200", qty: 2, unit: "dona" },
    { name: "Napalyon", qty: 14, unit: "dona" },
    { name: "Avganski", qty: 1, unit: "dona" },
    { name: "Mini medovik", qty: 4, unit: "dona" },
    { name: "Piramida", qty: 18, unit: "dona" },
    { name: "Rulet oq", qty: 9, unit: "dona" },
    { name: "Hadya", qty: 8, unit: "dona" },
    { name: "Snikisli perojni", qty: 25, unit: "dona" },
    { name: "Sansebastiyan", qty: 5, unit: "dona" },
    { name: "Milka oq", qty: 6, unit: "dona" },
    { name: "Milka qora", qty: 13, unit: "dona" },
    { name: "Dollar oq", qty: 8, unit: "dona" },
    { name: "Hadya mini", qty: 28, unit: "dona" },
    { name: "Chokko mini", qty: 24, unit: "dona" },
    { name: "Mini milka oq", qty: 19, unit: "dona" },
    { name: "Tivarojniy", qty: 104, unit: "dona" },
    { name: "Chokko", qty: 10, unit: "dona" },
    { name: "Mandarin", qty: 9, unit: "dona" },
    { name: "Nok", qty: 2, unit: "dona" },
    { name: "Malina", qty: 11, unit: "dona" },
    { name: "Gilos", qty: 5, unit: "dona" },
    { name: "Nok mini", qty: 14, unit: "dona" },
    { name: "Malina mini", qty: 8, unit: "dona" },
    { name: "Gilos mini", qty: 9, unit: "dona" },
    { name: "Snikis karamel", qty: 6, unit: "dona" },
    { name: "Trafell", qty: 6, unit: "dona" },
    { name: "Transfer", qty: 27, unit: "dona" },
    { name: "Disert", qty: 12, unit: "dona" },
    { name: "Ekler", qty: 1.857, unit: "kg" },
    { name: "Pechony", qty: 39.5, unit: "kg" },
    { name: "Pisochniy", qty: 5, unit: "kg" },
    { name: "Paxlava", qty: 6.9, unit: "kg" },
    { name: "Cola 1.5", qty: 30, unit: "dona" },
    { name: "Fanta 1.5", qty: 12, unit: "dona" },
    { name: "Cola 1l", qty: 38, unit: "dona" },
    { name: "Cola 0.5l", qty: 39, unit: "dona" },
    { name: "Fanta 0.5l", qty: 53, unit: "dona" },
    { name: "Sprite 0.5l", qty: 35, unit: "dona" },
    { name: "Cola banijni katta", qty: 12, unit: "dona" },
    { name: "Fanta banijni katta", qty: 10, unit: "dona" },
    { name: "Pepsi 1l", qty: 27, unit: "dona" },
    { name: "Pepsi 0.5l", qty: 62, unit: "dona" },
    { name: "Pepsi 1.5l", qty: 9, unit: "dona" },
    { name: "Mirinda 1l", qty: 2, unit: "dona" },
    { name: "Mirinda 1.5l", qty: 3, unit: "dona" },
    { name: "Mirinda 0.5l", qty: 7, unit: "dona" },
    { name: "Liptin 1.5l", qty: 2, unit: "dona" },
    { name: "Liptin 1l", qty: 28, unit: "dona" },
    { name: "Liptin 0.5l", qty: 46, unit: "dona" },
    { name: "Milliy Cola 1l", qty: 4, unit: "dona" },
    { name: "Flaus 0.5l", qty: 5, unit: "dona" },
    { name: "Dinay 1l", qty: 21, unit: "dona" },
    { name: "Dinay 0.5l", qty: 48, unit: "dona" },
    { name: "Dinay banijni", qty: 8, unit: "dona" },
    { name: "Dena", qty: 30, unit: "dona" },
    { name: "Pepsi banijni katta", qty: 34, unit: "dona" },
    { name: "Pepsi banijni kichik", qty: 32, unit: "dona" },
    { name: "Banaqua 0.5l", qty: 36, unit: "dona" },
    { name: "Banaqua 1l", qty: 32, unit: "dona" },
  ];

  // 1. Create new products
  const newProductIds = {};
  console.log("--- Yangi mahsulotlar yaratilmoqda ---");
  for (const np of NEW_PRODUCTS) {
    const id = genId();
    await prisma.product.create({
      data: {
        id,
        name: np.name,
        type: "ready",
        categoryKey: np.category,
        unit: np.unit,
        salePrice: 0,
      }
    });
    newProductIds[np.name] = id;
    console.log(`  + ${np.name} (${id})`);
  }

  // 2. Get or create inventory for RMK
  let inventory = await prisma.inventory.findFirst({
    where: { branchId: RMK_BRANCH_ID },
    orderBy: { createdAt: "desc" }
  });
  if (!inventory) {
    inventory = await prisma.inventory.create({
      data: { id: genId(), branchId: RMK_BRANCH_ID }
    });
    console.log(`\nYangi inventory yaratildi: ${inventory.id}`);
  } else {
    console.log(`\nMavjud inventory: ${inventory.id}`);
  }

  // 3. Upsert inventory items
  let addedCount = 0, updatedCount = 0;
  console.log("\n--- Inventory items ---");

  for (const item of items) {
    let productId;

    if (EXISTING_MAP[item.name]) {
      productId = EXISTING_MAP[item.name];
    } else if (NEW_MAP[item.name]) {
      productId = newProductIds[NEW_MAP[item.name]];
    } else {
      console.error(`  XATO: ${item.name} uchun mapping topilmadi!`);
      continue;
    }

    const existing = await prisma.inventoryItem.findFirst({
      where: { inventoryId: inventory.id, productId }
    });

    if (existing) {
      await prisma.inventoryItem.update({
        where: { id: existing.id },
        data: { quantity: item.qty }
      });
      updatedCount++;
      console.log(`  ~ ${item.name}: ${item.qty} ${item.unit} (yangilandi)`);
    } else {
      await prisma.inventoryItem.create({
        data: {
          inventoryId: inventory.id,
          productId,
          quantity: item.qty,
        }
      });
      addedCount++;
      console.log(`  + ${item.name}: ${item.qty} ${item.unit}`);
    }
  }

  console.log(`\n=== NATIJA ===`);
  console.log(`Yangi mahsulotlar: ${NEW_PRODUCTS.length}`);
  console.log(`Inventory qo'shildi: ${addedCount}`);
  console.log(`Inventory yangilandi: ${updatedCount}`);
  console.log(`Jami: ${items.length} ta mahsulot RMK inventoryga kiritildi`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
