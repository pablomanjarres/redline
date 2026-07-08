/**
 * @redline/engine/server - the server-only compute seam. Kept out of the package
 * index so the node-touching RemoteTarget (child_process / fetch) never enters a
 * client bundle. Import this from server code only: API route handlers and the
 * Node runtime, never a client component.
 */
export type { ComputeTarget, ComputeInput } from './compute-target.js';
export { getComputeTarget } from './compute-target.js';
export { FixtureTarget, fixtureTarget } from './targets/fixture.js';
export { RemoteTarget, createRemoteTarget } from './targets/remote.js';
export type { RemoteKind } from './targets/remote.js';
