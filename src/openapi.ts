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
        summary: "Turn text into a vector (or a batch of texts into vectors, in one call)",
        tags: ["Embeddings"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: "Provide exactly one of text or texts",
                properties: {
                  text: { type: "string", description: "Single-text mode -> { vector, model }" },
                  texts: {
                    type: "array",
                    items: { type: "string" },
                    description: "Batch mode (one real HTTP call, not a loop) -> { vectors, model }",
                  },
                  model: { type: "string", description: "Overrides the default embedding model" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "{ vector, model } for text, or { vectors, model } for texts" },
          "400": { description: "Invalid input" },
          "502": { description: "Provider failure" },
        },
      },
    },
    "/kb": {
      get: {
        summary: "List all knowledge bases",
        tags: ["RAG"],
        responses: {
          "200": {
            description: "{ kbs: { name, embeddingModel, dimension, documentCount, chunkCount }[] }",
          },
        },
      },
    },
    "/kb/{name}": {
      delete: {
        summary: "Delete a knowledge base entirely — its vector table, all documents/chunks, and its config",
        tags: ["RAG"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "{ deleted: true }" },
          "404": { description: "KB not found" },
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
              schema: {
                type: "object",
                required: ["text"],
                properties: {
                  text: { type: "string" },
                  metadata: {
                    description: "Arbitrary JSON, e.g. { genre: \"action\" } — filterable via search's `filter`",
                  },
                  model: {
                    type: "string",
                    description:
                      "Only meaningful the first time this KB name is used — fixes that KB's embedding model/dimension from then on",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "{ documentId: number, chunksAdded: number, embeddingModel: string }" },
          "400": { description: "Invalid input, or KB already uses a different embedding model" },
          "502": { description: "Provider failure" },
        },
      },
      get: {
        summary: "List documents in a knowledge base (paginated)",
        tags: ["RAG"],
        parameters: [
          { name: "name", in: "path", required: true, schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description: "Defaults to 100, max 500",
          },
          {
            name: "offset",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description: "Defaults to 0",
          },
        ],
        responses: {
          "200": {
            description:
              "{ documents: { id, metadata, createdAt, updatedAt, chunkCount }[], total, limit, offset }",
          },
          "400": { description: "Invalid input" },
        },
      },
    },
    "/kb/{name}/documents/{documentId}": {
      put: {
        summary: "Re-sync a document — replace its text (re-chunked + re-embedded) and/or its metadata",
        tags: ["RAG"],
        parameters: [
          { name: "name", in: "path", required: true, schema: { type: "string" } },
          { name: "documentId", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: "At least one of text or metadata is required",
                properties: { text: { type: "string" }, metadata: {} },
              },
            },
          },
        },
        responses: {
          "200": { description: "{ documentId: number, chunksAdded: number }" },
          "400": { description: "Invalid input" },
          "404": { description: "KB or document not found" },
          "502": { description: "Provider failure" },
        },
      },
      delete: {
        summary: "Delete a document (and its chunks/embeddings) from a knowledge base",
        tags: ["RAG"],
        parameters: [
          { name: "name", in: "path", required: true, schema: { type: "string" } },
          { name: "documentId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "{ deleted: true }" },
          "404": { description: "KB or document not found" },
        },
      },
    },
    "/kb/{name}/search": {
      post: {
        summary:
          "Similarity search within a knowledge base — always deduplicated to one result per document, optionally narrowed by metadata filter and/or a distance cutoff",
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
                  topK: { type: "integer", description: "Defaults to 5, max 500" },
                  filter: {
                    type: "object",
                    description: "Exact-match metadata filter, e.g. { genre: \"action\" }",
                  },
                  maxDistance: {
                    type: "number",
                    description:
                      "Drop results beyond this distance (lower = closer/more relevant). No default — calibrate empirically per KB/embedding model.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "{ results: { content, score, chunkIndex, documentId, metadata }[] } — one per document, best chunk only",
          },
          "400": { description: "Invalid input" },
          "404": { description: "KB not found" },
          "502": { description: "Provider failure" },
        },
      },
    },
    "/memory": {
      get: {
        summary: "List every conversation with stored turns",
        tags: ["Memory"],
        responses: {
          "200": { description: "{ conversations: { conversationId, turnCount, lastActive }[] }" },
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
