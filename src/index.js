#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { tools, callTool } from "./tools/registry.js";
import { logger } from "./utils/logger.js";
import { acquireServerLock } from "./queue/server-lock.js";
acquireServerLock();
const server = new Server(
  { name: "google-flow-browser-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.schema, { $refStrategy: "none" }),
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await callTool(
      request.params.name,
      request.params.arguments,
    );
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (e) {
    logger.error("Tool failed", {
      tool: request.params.name,
      error: e.message,
    });
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: e.message }) }],
    };
  }
});
await server.connect(new StdioServerTransport());
