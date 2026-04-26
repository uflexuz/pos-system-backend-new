const { fork } = require("child_process");
const path = require("path");

const serverPath = path.join(__dirname, "server.js");
const restartDelayMs = Number(process.env.SERVER_RESTART_DELAY_MS || 2000);
const NON_RESTARTABLE_EXIT_CODE = 78;

let child = null;
let stopping = false;

function spawnServer() {
  child = fork(serverPath, {
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (stopping) {
      process.exit(code ?? 0);
      return;
    }

    if (code === NON_RESTARTABLE_EXIT_CODE) {
      console.error("Backend process stopped with a non-restartable startup error.");
      process.exit(code);
      return;
    }

    console.error(
      `Backend process stopped (code=${code ?? "null"}, signal=${signal ?? "none"}). ${restartDelayMs}ms dan keyin qayta ishga tushadi.`,
    );

    setTimeout(spawnServer, restartDelayMs);
  });
}

function stopSupervisor(signal) {
  stopping = true;

  if (child && !child.killed) {
    child.kill(signal);
    return;
  }

  process.exit(0);
}

process.on("SIGINT", () => stopSupervisor("SIGINT"));
process.on("SIGTERM", () => stopSupervisor("SIGTERM"));

spawnServer();