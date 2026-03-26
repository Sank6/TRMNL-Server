import type { FastifyInstance } from "fastify";
import type { Config } from "../src/config.js";
import type { AppDB } from "../src/db/index.js";
/** In-memory database for each test suite */
export declare function createTestDB(): AppDB;
export declare const TEST_CONFIG: Config;
export declare function buildTestApp(db?: AppDB): Promise<FastifyInstance>;
export declare const DEVICE_MAC = "AA:BB:CC:DD:EE:FF";
export declare const DEVICE_MAC_2 = "11:22:33:44:55:66";
/** Registers a device and returns its api_key */
export declare function registerDevice(app: FastifyInstance, mac?: string): Promise<string>;
//# sourceMappingURL=helpers.d.ts.map