import type { FixtureManifest, PackData } from "../contracts.js";
import { deepFreeze } from "../freeze.js";
import * as core from "./core-1.generated.js";
import * as edge from "./edge-1.generated.js";

export interface FixturePack {
  manifest: FixtureManifest;
  data: PackData;
}

// every engine shares these records, so none of them may change
export const corePack: FixturePack = deepFreeze({ manifest: core.manifest, data: core.data });
export const edgePack: FixturePack = deepFreeze({ manifest: edge.manifest, data: edge.data });

export const defaultFixture = corePack.manifest.id;

// every published pack, by id; _mock.fixture and the fixture option pick from these
export const fixturePacks: Readonly<Record<string, FixturePack>> = Object.freeze({
  [corePack.manifest.id]: corePack,
  [edgePack.manifest.id]: edgePack,
});
