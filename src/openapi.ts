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
  };

  for (const agent of agents) {
    const requestSchema = zodToJsonSchema(inputPayloadSchema(agent.input), {
      target: "openApi3",
    });

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
