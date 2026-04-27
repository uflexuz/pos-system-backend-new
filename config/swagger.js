const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "UFLEX POS API",
      version: "1.0.0",
      description: "UFLEX POS inventory and sales management API",
      contact: {
        name: "UFLEX Team",
      },
    },
    servers: [
      {
        url: "http://localhost:8080",
        description: "Development server",
      },
      {
        url:
          process.env.PUBLIC_BASE_URL ||
          "https://pos-system-uflex.up.railway.app",
        description: "Production server",
      },
    ],
    tags: [
      {
        name: "Inventory",
        description: "Inventory management operations",
      },
      {
        name: "Categories",
        description: "Mahsulot kategoriyalarini boshqarish",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        Category: {
          type: "object",
          properties: {
            _id: {
              type: "string",
              example: "67f4e01e2b8bff9a9f77fa11",
            },
            key: {
              type: "string",
              example: "cake",
            },
            name: {
              type: "string",
              example: "Tort",
            },
            emoji: {
              type: "string",
              example: "🍰",
            },
            order: {
              type: "number",
              example: 1,
            },
            isActive: {
              type: "boolean",
              example: true,
            },
            isSystem: {
              type: "boolean",
              example: false,
            },
            createdAt: {
              type: "string",
              format: "date-time",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
        CategoryCreateRequest: {
          type: "object",
          required: ["name"],
          properties: {
            name: {
              type: "string",
              example: "Shirinlik",
            },
            key: {
              type: "string",
              example: "shirinlik",
            },
            emoji: {
              type: "string",
              example: "🍰",
            },
            order: {
              type: "number",
              example: 10,
            },
            isActive: {
              type: "boolean",
              example: true,
            },
          },
        },
        CategoryUpdateRequest: {
          type: "object",
          properties: {
            name: {
              type: "string",
              example: "Shirinliklar",
            },
            key: {
              type: "string",
              example: "shirinliklar",
            },
            emoji: {
              type: "string",
              example: "🍰",
            },
            order: {
              type: "number",
              example: 11,
            },
            isActive: {
              type: "boolean",
              example: true,
            },
          },
        },
        InventoryItem: {
          type: "object",
          required: ["name", "quantity", "unit"],
          properties: {
            name: {
              type: "string",
              description: "Mahsulot nomi",
              example: "Pechoniy",
            },
            quantity: {
              type: "number",
              minimum: 0,
              description: "Miqdor",
              example: 3.23,
            },
            unit: {
              type: "string",
              enum: ["kg", "dona", "litr"],
              description: "O'lchov birligi",
              example: "kg",
            },
            totalPrice: {
              type: "number",
              minimum: 0,
              description: "Umumiy narx (ixtiyoriy)",
              example: 120400,
            },
          },
        },
        InventorySnapshot: {
          type: "object",
          required: ["branchName", "items"],
          properties: {
            _id: {
              type: "string",
              description: "Inventory ID",
              example: "67912ab8123812390asd21",
            },
            isGenerated: {
              type: "boolean",
              description: "Avtomatik yaratilganmi",
              example: true,
            },
            branchName: {
              type: "string",
              description: "Filial nomi",
              example: "UFLEX 1",
            },
            items: {
              type: "array",
              items: {
                $ref: "#/components/schemas/InventoryItem",
              },
              description: "Mahsulotlar ro'yxati",
            },
            sourceMessageId: {
              type: "number",
              description: "Tashqi xabar ID",
              example: 12345,
            },
            sourceChatId: {
              type: "string",
              description: "Tashqi kanal ID",
              example: "-1002631455210",
            },
            createdBy: {
              type: "string",
              description: "Yaratuvchi username yoki ismi",
              example: "admin",
            },
            createdAt: {
              type: "string",
              format: "date-time",
              description: "Yaratilgan vaqt",
            },
            updatedAt: {
              type: "string",
              format: "date-time",
              description: "Yangilangan vaqt",
            },
          },
        },
        CreateInventoryRequest: {
          type: "object",
          required: ["branch", "items"],
          properties: {
            branch: {
              type: "string",
              description: "Filial nomi",
              example: "UFLEX 1",
            },
            items: {
              type: "array",
              items: {
                $ref: "#/components/schemas/InventoryItem",
              },
              minItems: 1,
              description: "Mahsulotlar ro'yxati (kamida 1 ta)",
            },
            sourceMessageId: {
              type: "number",
              description: "Tashqi xabar ID (ixtiyoriy)",
            },
            sourceChatId: {
              type: "string",
              description: "Tashqi kanal ID (ixtiyoriy)",
            },
            createdBy: {
              type: "string",
              description: "Yaratuvchi username yoki ismi (ixtiyoriy)",
            },
          },
        },
        SuccessResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: true,
            },
            inventory_id: {
              type: "string",
              example: "67912ab8123812390asd21",
            },
            data: {
              $ref: "#/components/schemas/InventorySnapshot",
            },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              example: false,
            },
            message: {
              type: "string",
              example: "Validatsiya xatosi",
            },
            errors: {
              type: "array",
              items: {
                type: "string",
              },
              example: ["Filial nomi kiritilishi shart", "Miqdor to'g'ri kiritilishi shart"],
            },
          },
        },
      },
    },
  },
  apis: ["./routes/categoryRoutes.js", "./routes/inventoryRoutes.js"],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
