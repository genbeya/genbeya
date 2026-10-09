import { promises as fs } from "node:fs";
import { describeMachine } from "../../testing/machine-contract";
import { temporaryFolder } from "../../testing/temp";
import { nodeMachine } from "./node-machine";

describeMachine("Node", () => ({
  machine: nodeMachine(),
  folder: () => temporaryFolder("machine-"),
  echo: { command: process.execPath, args: ["-e", "process.stdin.pipe(process.stdout)"] },
  async link(target, path) {
    try {
      await fs.symlink(target, path, "junction");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
      throw error;
    }
  },
}));
