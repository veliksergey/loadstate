import type { FixtureManifest, PackData } from "../contracts.js";
import { deepFreeze } from "../freeze.js";
import { data, manifest } from "./core-1.generated.js";

export interface FixturePack {
  manifest: FixtureManifest;
  data: PackData;
}

// every engine shares these records, so none of them may change
export const corePack: FixturePack = deepFreeze({ manifest, data });
