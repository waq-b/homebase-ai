import { zodToJsonSchema } from "zod-to-json-schema";
import { inputPayloadSchema, type AgentConfig } from "./config.js";

/** Builds an OpenAPI 3.1 document from the live agent registry. Regenerated per request. */
export const buildOpenApiSpec = (agents: AgentConfig[]) => {
  const paths: Record<string, unknown> = {
    "/health": {
      get: {
        summary: "Health check",
        tags: ["Homebase"],
        responses: { "200": { description: "OK" } },
      },
    },
    "/agents": {
      get: {
        summary: "List registered agents",
        tags: ["Homebase"],
        responses: { "200": { description: "List of agents" } },
      },
    },
    "/embed": {
      post: {
        summary: "Turn text into a vector",
        tags: ["Embeddings"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["text"],
                properties: {
                  text: { type: "string" },
                  model: { type: "string", description: "Overrides the default embedding model" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "{ vector: number[], model: string }" },
          "400": { description: "Invalid input" },
          "502": { description: "Provider failure" },
        },
      },
    },
    "/kb/{name}/documents": {
      post: {
        summary: "Add a document to a knowledge base (chunked + embedded automatically)",
        tags: ["RAG"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
            },
          },
        },
        responses: {
          "200": { description: "{ chunksAdded: number }" },
          "400": { description: "Invalid input" },
          "502": { description: "Provider failure" },
        },
      },
    },
    "/kb/{name}/search": {
      post: {
        summary: "Similarity search within a knowledge base",
        tags: ["RAG"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["query"],
                properties: {
                  query: { type: "string" },
                  topK: { type: "integer", description: "Defaults to 5" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "{ results: { content, score, chunkIndex }[] }" },
          "400": { description: "Invalid input" },
          "502": { description: "Provider failure" },
        },
      },
    },
    "/memory/{conversationId}": {
      get: {
        summary: "Fetch a conversation's raw stored turns",
        tags: ["Memory"],
        parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "{ conversationId, turns: StoredTurn[] }" } },
      },
      delete: {
        summary: "Clear a conversation's stored turns",
        tags: ["Memory"],
        parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "{ cleared: number }" } },
      },
    },
  };

  for (const agent of agents) {
    const requestSchema = zodToJsonSchema(inputPayloadSchema(agent.input), {
      target: "openApi3",
    }) as {
      properties?: Record<string, unknown>;
      [key: string]: unknown;
    };

    // v2.3 — conversationId isn't part of inputPayloadSchema (it's read straight
    // off the raw body in invoke.ts), so it's spliced into the generated schema
    // here purely for documentation.
    if (requestSchema.properties) {
      requestSchema.properties.conversationId = {
        type: "string",
        description: "Opt into conversation memory — prior turns for this id are loaded as context",
      };
    }

    paths[`/agents/${agent.name}/invoke`] = {
      post: {
        summary: agent.description,
        tags: [agent.name],
        parameters: [
          {
            name: "stream",
            in: "query",
            required: false,
            schema: { type: "boolean" },
            description: "Stream tokens via SSE",
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: requestSchema } },
        },
        responses: {
          "200": { description: "Agent output (JSON, or SSE if stream=true)" },
          "400": { description: "Invalid input" },
          "404": { description: "Unknown agent" },
          "500": { description: "Hook failure" },
          "502": { description: "Provider/model failure" },
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Homebase",
      description: "Local AI gateway — hosts and serves agents as HTTP endpoints.",
      version: "0.1.0",
    },
    paths,
  };
};
