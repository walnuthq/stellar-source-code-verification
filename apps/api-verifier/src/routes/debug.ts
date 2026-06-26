import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { Router } from "express";
import { DOCKER_READY_FILE, DOCKERD_LOG } from "../lib/constants.js";

const router = Router();

/** Run a shell snippet, resolving with combined stdout+stderr (never rejects). */
function sh(command: string): Promise<string> {
  return new Promise((resolve) => {
    exec(
      command,
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = `${stdout ?? ""}${stderr ?? ""}`.trim();
        resolve(out || (err ? `<error: ${err.message}>` : "<no output>"));
      },
    );
  });
}

function readLog(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : "<missing>";
  } catch (err) {
    return `<unreadable: ${err instanceof Error ? err.message : String(err)}>`;
  }
}

/**
 * GET /debug — diagnostics for the in-container rootless Docker daemon. Surfaces
 * why `dockerReady` may be stuck false (the dind boot output, the live `docker
 * info` error, processes, and the userns/cgroup capabilities rootless dind needs)
 * over HTTP, since `wrangler containers ssh` can't attach to this DO-bound
 * container. Remove once the dind boot issue is resolved.
 */
router.get("/debug", async (_req, res) => {
  const [
    dockerInfo,
    processes,
    unprivUserns,
    idmapTools,
    subid,
    cgroup,
    tun,
    dmesg,
  ] = await Promise.all([
    sh("docker info 2>&1; echo '--- DOCKER_HOST='\"$DOCKER_HOST\""),
    sh("ps -o pid,user,args 2>/dev/null || ps -ef"),
    sh(
      "cat /proc/sys/kernel/unprivileged_userns_clone 2>&1; " +
        "cat /proc/sys/user/max_user_namespaces 2>&1",
    ),
    sh(
      "command -v newuidmap newgidmap 2>&1; ls -l $(command -v newuidmap newgidmap) 2>&1",
    ),
    sh(
      "cat /etc/subuid /etc/subgid 2>&1; echo '--- whoami='$(whoami)' id='$(id)",
    ),
    sh(
      "cat /sys/fs/cgroup/cgroup.controllers 2>&1; " +
        "stat -fc '%T' /sys/fs/cgroup 2>&1; ls /sys/fs/cgroup 2>&1 | head",
    ),
    // Can the rootless user actually open /dev/net/tun (what slirp4netns needs)?
    // After the entrypoint's root-stage chmod, this distinguishes a DAC-permission
    // block (now openable) from a device-cgroup block (still EPERM).
    sh(
      "ls -l /dev/net/tun 2>&1; " +
        "(exec 9<>/dev/net/tun) 2>&1 && echo TUN_OPENABLE || echo TUN_EPERM; " +
        "grep -E 'Cap(Eff|Bnd)' /proc/self/status 2>&1; " +
        "cat /sys/fs/cgroup/devices.allow 2>&1 | head -5",
    ),
    sh("dmesg 2>&1 | tail -30"),
  ]);

  res.json({
    dockerReady: existsSync(DOCKER_READY_FILE),
    dockerdLog: readLog(DOCKERD_LOG),
    dockerInfo,
    processes,
    unprivUserns,
    idmapTools,
    subid,
    cgroup,
    tun,
    dmesg,
  });
});

export default router;
