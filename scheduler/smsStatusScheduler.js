// SMS Status Auto-Refresh Scheduler
// Refreshes "pending" SMS statuses every 60 minutes

const {
  getEskizMessageStatus,
  isEskizConfigured,
} = require("../utils/eskizSmsService");
const prisma = require("../config/prisma");

// Map Eskiz status to internal status
const mapEskizStatus = (rawStatus) => {
  if (!rawStatus) return "pending";
  const status = rawStatus.toLowerCase();
  if (["accepted", "acceptd"].includes(status)) return "pending";
  if (["delivered", "delivrd"].includes(status)) return "delivered";
  if (["rejected", "rejectd"].includes(status)) return "rejected";
  if (["undelivered", "undeliv"].includes(status)) return "undelivered";
  if (["expired"].includes(status)) return "expired";
  if (["failed"].includes(status)) return "failed";
  return "pending";
};

async function refreshPendingSmsStatuses() {
  const now = new Date();
  console.log(`[SMS Scheduler] Starting auto-refresh at ${now.toISOString()}`);

  if (!isEskizConfigured()) {
    console.log("[SMS Scheduler] Eskiz not configured, skipping...");
    return;
  }

  try {
    // Find all pending SMS messages with Eskiz ID
    const pendingMessages = await prisma.smsMessage.findMany({
      where: {
        status: "pending",
        eskizMessageId: { not: null },
      },
      include: { template: true, recipientCustomer: true },
    });

    console.log(
      `[SMS Scheduler] Found ${pendingMessages.length} pending SMS to refresh`
    );

    let updated = 0;
    let errors = 0;

    for (const message of pendingMessages) {
      try {
        const statusResult = await getEskizMessageStatus(message.eskizMessageId);
        const newStatus = mapEskizStatus(statusResult.status);

        // Only update if status changed
        if (
          newStatus !== message.status ||
          statusResult.status !== message.eskizStatusRaw ||
          !message.eskizStatusData
        ) {
          const data = {
            eskizStatusRaw: statusResult.status,
            eskizStatusData: statusResult.raw || null,
            status: newStatus,
            statusCheckedAt: new Date(),
            updatedAt: new Date(),
          };

          if (statusResult.partsCount != null) {
            data.partsCount = statusResult.partsCount;
          }
          if (statusResult.totalPrice != null) {
            data.cost = statusResult.totalPrice;
          }
          if (statusResult.sentAt) {
            data.sentAt = statusResult.sentAt;
          }
          if (newStatus === "delivered" && !message.deliveredAt) {
            data.deliveredAt = statusResult.deliveryAt || new Date();
          }
          if (
            ["rejected", "undelivered", "expired", "failed"].includes(newStatus) &&
            !message.errorMessage
          ) {
            data.errorMessage = statusResult.status;
          }

          await prisma.smsMessage.update({
            where: { id: message.id },
            data,
          });

          updated++;
          console.log(
            `[SMS Scheduler] Updated SMS ${message.id}: ${message.status} -> ${newStatus}`
          );
        }
      } catch (err) {
        errors++;
        console.error(
          `[SMS Scheduler] Error refreshing SMS ${message.id}:`,
          err.message
        );
      }
    }

    console.log(
      `[SMS Scheduler] Completed: ${updated} updated, ${errors} errors, ${pendingMessages.length - updated - errors} unchanged`
    );
  } catch (error) {
    console.error("[SMS Scheduler] Fatal error:", error.message);
  }
}

// Start the scheduler - run every 60 minutes
function startSmsStatusScheduler() {
  console.log("[SMS Scheduler] Starting auto-refresh scheduler (every 60 minutes)");

  // Run immediately on startup
  refreshPendingSmsStatuses();

  // Then run every 60 minutes (60 * 60 * 1000 = 3600000 ms)
  setInterval(refreshPendingSmsStatuses, 60 * 60 * 1000);
}

module.exports = { startSmsStatusScheduler, refreshPendingSmsStatuses };
