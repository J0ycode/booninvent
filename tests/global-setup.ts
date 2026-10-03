import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/** One in-memory replica set for the whole run (transactions need a replica set). */
let rs: MongoMemoryReplSet;

export async function setup(project: TestProject) {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  process.env.MONGODB_URI = rs.getUri("boonbaby_test");
  project.provide("mongoUri", process.env.MONGODB_URI);
}

export async function teardown() {
  await rs?.stop();
}
