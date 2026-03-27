#!/usr/bin/env node

import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { CrushAgent } from "./agent.js";

// Create bidirectional stream from stdio
// ndJsonStream expects: (writable to send responses, readable to receive requests)
const writable = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
const readable = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;

// Create the ACP stream
const stream = acp.ndJsonStream(writable, readable);

// Start the agent connection
new acp.AgentSideConnection((conn) => new CrushAgent(conn), stream);
