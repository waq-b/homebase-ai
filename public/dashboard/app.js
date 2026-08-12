// Homebase Dashboard — vanilla JS, no build step, no framework. Implements
// the "Homebase Dashboard.dc.html" Claude Design prototype's visual system
// (styles.css, copied verbatim) wired to Homebase's real API.
//
// Two sections from the original design don't map onto anything the real API
// exposes and were adapted rather than faked:
//  - "Agents" is read-only (name/description/input type only — GET /agents
//    doesn't expose system prompt/model/hooks, and there's no create/edit/
//    delete-agent API; agent configs are hand-edited YAML files).
//  - The original "Logs & Errors" section was entirely client-side mock data
//    with no backing endpoint anywhere in Homebase. Replaced with a real
//    "Memory" section (GET /memory, added alongside this dashboard) since
//    that's an actual, working feature with nothing else exercising it yet.

const BASE_URL = "";

const state = {
  section: "agents",
  agents: [],
  selectedAgentName: null,

  kbs: [],
  selectedKbName: null,
  kbDocuments: [],
  kbSearchQuery: "",
  kbSearchResults: null,
  kbDocDraft: "",
  kbDialogOpen: false,

  conversations: [],
  selectedConversationId: null,
  conversationTurns: [],

  tryItMethod: "GET",
  tryItPath: "/health",
  tryItBody: "",
  tryItResponse: null,

  deleteConfirm: null,
};

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) if (child) node.appendChild(child);
  return node;
};

const api = async (method, path, body) => {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const err = new Error((json && json.error) || `${method} ${path} failed with ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
};

const timeAgo = (iso) => {
  const ms = Date.now() - new Date(iso + "Z").getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
};

// ── layout / nav ────────────────────────────────────────────────────────

const NAV = [
  { key: "agents", label: "Agents" },
  { key: "endpoints", label: "Endpoints" },
  { key: "kbs", label: "Knowledge Bases" },
  { key: "memory", label: "Memory" },
];

const renderNav = () => {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  for (const item of NAV) {
    const count =
      item.key === "agents" ? state.agents.length :
      item.key === "kbs" ? state.kbs.length :
      item.key === "memory" ? state.conversations.length : "";
    nav.appendChild(
      el("button", {
        class: `hb-navbtn ${state.section === item.key ? "active" : ""}`,
        onClick: () => goTo(item.key),
      }, [
        el("span", { text: item.label }),
        el("span", { class: "hb-mono", style: "margin-left:auto;font-size:11px;color:var(--color-neutral-600)", text: String(count) }),
      ]),
    );
  }
};

const goTo = (section) => {
  state.section = section;
  render();
  if (section === "agents") loadAgents();
  if (section === "kbs") loadKbs();
  if (section === "memory") loadConversations();
};

// ── data loading ────────────────────────────────────────────────────────

const loadHealth = async () => {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  try {
    await api("GET", "/health");
    dot.style.background = "var(--color-accent)";
    text.textContent = `listening on ${location.host}`;
  } catch {
    dot.style.background = "var(--color-neutral-500)";
    text.textContent = "unreachable";
  }
};

const loadAgents = async () => {
  state.agents = await api("GET", "/agents");
  if (!state.selectedAgentName && state.agents.length > 0) state.selectedAgentName = state.agents[0].name;
  render();
};

const loadKbs = async () => {
  const { kbs } = await api("GET", "/kb");
  state.kbs = kbs;
  if (state.selectedKbName && !kbs.some((k) => k.name === state.selectedKbName)) state.selectedKbName = null;
  if (!state.selectedKbName && kbs.length > 0) state.selectedKbName = kbs[0].name;
  if (state.selectedKbName) await loadKbDocuments(state.selectedKbName);
  render();
};

const loadKbDocuments = async (name) => {
  const { documents } = await api("GET", `/kb/${encodeURIComponent(name)}/documents`);
  state.kbDocuments = documents;
};

const loadConversations = async () => {
  const { conversations } = await api("GET", "/memory");
  state.conversations = conversations;
  render();
};

const loadConversationDetail = async (id) => {
  const { turns } = await api("GET", `/memory/${encodeURIComponent(id)}`);
  state.conversationTurns = turns;
  render();
};

// ── section: agents (read-only) ─────────────────────────────────────────

const renderAgents = (body) => {
  const layout = el("div", { style: "display:grid;grid-template-columns:1.1fr 1.4fr;gap:0;border:2px solid var(--color-divider)" });
  const listCol = el("div", { style: "border-right:2px solid var(--color-divider)" });
  const table = el("table", { class: "table", style: "width:100%" });
  table.appendChild(el("thead", {}, el("tr", {}, [el("th", { text: "Name" }), el("th", { text: "Input" })])));
  const tbody = el("tbody");
  for (const a of state.agents) {
    tbody.appendChild(
      el("tr", { class: `hb-row ${a.name === state.selectedAgentName ? "active" : ""}`, onClick: () => { state.selectedAgentName = a.name; state.tryItResponse = null; render(); } }, [
        el("td", {}, [
          el("div", { style: "font-weight:700", text: a.name }),
          el("div", { style: "font-size:11px;color:var(--color-neutral-700);max-width:220px", text: a.description }),
        ]),
        el("td", {}, el("span", { class: "tag tag-outline", text: a.input })),
      ]),
    );
  }
  table.appendChild(tbody);
  listCol.appendChild(table);
  if (state.agents.length === 0) listCol.appendChild(el("div", { class: "hb-empty", text: "No agents registered — check agents/*.yaml." }));

  const detailCol = el("div", { class: "hb-scroll", style: "padding:20px" });
  const agent = state.agents.find((a) => a.name === state.selectedAgentName);
  if (agent) {
    detailCol.appendChild(el("div", { style: "font-family:var(--font-heading);font-weight:800;font-size:18px", text: agent.name }));
    detailCol.appendChild(el("div", { style: "font-size:12px;color:var(--color-neutral-700);margin-top:2px", text: agent.description }));
    detailCol.appendChild(el("div", { class: "hr" }));
    detailCol.appendChild(el("div", { class: "text-muted", style: "font-size:12px", text: `Input type: ${agent.input}. Full config (model, system prompt, hooks) lives in agents/${agent.name}.yaml — not exposed by the API.` }));

    detailCol.appendChild(el("div", { class: "hb-kicker", style: "margin-top:20px", text: `Try it — POST /agents/${agent.name}/invoke` }));
    const bodyBox = el("textarea", {
      class: "input hb-mono",
      style: "width:100%;min-height:100px;font-size:12px",
      onChange: (e) => (state.tryItBody = e.target.value),
    });
    bodyBox.value = state.tryItBody || (agent.input === "string" ? '{"input":"Hello there"}' : agent.input === "messages" ? '{"input":[{"role":"user","content":"Hello there"}]}' : '{"input":{}}');
    detailCol.appendChild(bodyBox);
    detailCol.appendChild(
      el("button", {
        class: "btn btn-primary",
        style: "margin-top:10px",
        onClick: async () => {
          try {
            const parsed = JSON.parse(bodyBox.value);
            const result = await api("POST", `/agents/${encodeURIComponent(agent.name)}/invoke`, parsed);
            state.tryItResponse = JSON.stringify(result, null, 2);
          } catch (err) {
            state.tryItResponse = `Error: ${err.message}`;
          }
          render();
        },
        text: "Send",
      }),
    );
    if (state.tryItResponse) {
      detailCol.appendChild(el("div", { class: "hb-kicker", style: "margin-top:16px", text: "Response" }));
      detailCol.appendChild(el("pre", { class: "hb-mono", style: "background:var(--color-neutral-200);border:2px solid var(--color-divider);padding:14px;font-size:12px;line-height:1.6;overflow-x:auto;white-space:pre-wrap", text: state.tryItResponse }));
    }
  }

  layout.appendChild(listCol);
  layout.appendChild(detailCol);
  body.appendChild(layout);
};

// ── section: endpoints (real generic "try it" console) ─────────────────

const ENDPOINTS = [
  { method: "GET", path: "/health", description: "Liveness check" },
  { method: "GET", path: "/agents", description: "List all registered agents" },
  { method: "POST", path: "/agents/summarizer/invoke", description: "Invoke an agent (edit the path for a different agent; add ?stream=true for SSE)" },
  { method: "POST", path: "/embed", description: "Compute an embedding vector for text" },
  { method: "GET", path: "/kb", description: "List all knowledge bases" },
  { method: "POST", path: "/kb/example-kb/documents", description: "Add + embed a document into a knowledge base" },
  { method: "GET", path: "/kb/example-kb/documents", description: "List documents in a knowledge base" },
  { method: "PUT", path: "/kb/example-kb/documents/1", description: "Update a document's text or metadata" },
  { method: "DELETE", path: "/kb/example-kb/documents/1", description: "Delete a document from a knowledge base" },
  { method: "POST", path: "/kb/example-kb/search", description: "Similarity search within a knowledge base" },
  { method: "DELETE", path: "/kb/example-kb", description: "Delete a whole knowledge base" },
  { method: "GET", path: "/memory", description: "List conversations with stored turns" },
  { method: "GET", path: "/memory/example-conversation", description: "Read stored conversation turns" },
  { method: "DELETE", path: "/memory/example-conversation", description: "Clear stored conversation turns" },
];

const renderEndpoints = (body) => {
  const layout = el("div", { style: "display:grid;grid-template-columns:1.3fr 1fr;gap:0;border:2px solid var(--color-divider)" });
  const listCol = el("div", { style: "border-right:2px solid var(--color-divider)" });
  const table = el("table", { class: "table", style: "width:100%" });
  table.appendChild(el("thead", {}, el("tr", {}, [el("th", { text: "Method" }), el("th", { text: "Path" }), el("th", { text: "Description" })])));
  const tbody = el("tbody");
  for (const ep of ENDPOINTS) {
    tbody.appendChild(
      el("tr", { class: "hb-row", onClick: () => { state.tryItMethod = ep.method; state.tryItPath = ep.path; state.tryItResponse = null; render(); } }, [
        el("td", {}, el("span", { class: `tag ${ep.method === "GET" ? "tag-neutral" : ep.method === "DELETE" ? "tag-outline" : "tag-accent"}`, text: ep.method })),
        el("td", { class: "hb-mono", style: "font-size:12.5px", text: ep.path }),
        el("td", { style: "font-size:12px;color:var(--color-neutral-700)", text: ep.description }),
      ]),
    );
  }
  table.appendChild(tbody);
  listCol.appendChild(table);

  const detailCol = el("div", { style: "padding:20px" });
  detailCol.appendChild(el("div", { class: "hb-kicker", text: "Try it — hits the real API" }));
  const methodSelect = el("select", { class: "input", style: "width:auto;margin-bottom:8px", onChange: (e) => (state.tryItMethod = e.target.value) });
  for (const m of ["GET", "POST", "PUT", "DELETE"]) {
    const opt = el("option", { value: m, text: m });
    if (m === state.tryItMethod) opt.setAttribute("selected", "selected");
    methodSelect.appendChild(opt);
  }
  detailCol.appendChild(methodSelect);
  const pathInput = el("input", { class: "input hb-mono", style: "margin-bottom:8px" });
  pathInput.value = state.tryItPath;
  pathInput.addEventListener("change", (e) => (state.tryItPath = e.target.value));
  detailCol.appendChild(pathInput);
  const bodyBox = el("textarea", { class: "input hb-mono", style: "width:100%;min-height:100px;font-size:12px", placeholder: "Request body (JSON), if any" });
  bodyBox.value = state.tryItBody;
  bodyBox.addEventListener("change", (e) => (state.tryItBody = e.target.value));
  detailCol.appendChild(bodyBox);
  detailCol.appendChild(
    el("button", {
      class: "btn btn-primary",
      style: "margin-top:10px",
      onClick: async () => {
        try {
          const body = bodyBox.value.trim() ? JSON.parse(bodyBox.value) : undefined;
          const result = await api(methodSelect.value, pathInput.value, body);
          state.tryItResponse = JSON.stringify(result, null, 2);
        } catch (err) {
          state.tryItResponse = `Error: ${err.message}`;
        }
        render();
      },
      text: "Send request",
    }),
  );
  if (state.tryItResponse) {
    detailCol.appendChild(el("div", { class: "hb-kicker", style: "margin-top:16px", text: "Response" }));
    detailCol.appendChild(el("pre", { class: "hb-mono", style: "background:var(--color-neutral-200);border:2px solid var(--color-divider);padding:14px;font-size:12px;line-height:1.6;overflow-x:auto;white-space:pre-wrap", text: state.tryItResponse }));
  }

  layout.appendChild(listCol);
  layout.appendChild(detailCol);
  body.appendChild(layout);
};

// ── section: knowledge bases (full real CRUD) ───────────────────────────

const renderKbs = (body) => {
  const layout = el("div", { style: "display:grid;grid-template-columns:0.9fr 1.6fr;gap:0;border:2px solid var(--color-divider)" });
  const listCol = el("div", { style: "border-right:2px solid var(--color-divider)" });
  for (const kb of state.kbs) {
    listCol.appendChild(
      el("div", { class: `hb-row ${kb.name === state.selectedKbName ? "active" : ""}`, style: "padding:14px 16px;border-bottom:2px solid var(--color-divider)", onClick: async () => { state.selectedKbName = kb.name; state.kbSearchResults = null; await loadKbDocuments(kb.name); render(); } }, [
        el("div", { style: "display:flex;justify-content:space-between;align-items:baseline" }, [
          el("div", { style: "font-weight:700", text: kb.name }),
          el("button", { class: "btn btn-icon", title: "Delete KB", text: "✕", onClick: (e) => { e.stopPropagation(); state.deleteConfirm = { kind: "kb", name: kb.name }; render(); } }),
        ]),
        el("div", { style: "font-size:11px;color:var(--color-neutral-700);margin-top:4px", text: `${kb.documentCount} documents, ${kb.chunkCount} chunks` }),
        el("div", { class: "hb-mono", style: "font-size:10px;color:var(--color-neutral-600);margin-top:2px", text: kb.embeddingModel }),
      ]),
    );
  }
  listCol.appendChild(el("button", { class: "btn btn-secondary", style: "margin:12px 16px;width:calc(100% - 32px)", onClick: () => { state.kbDialogOpen = true; render(); }, text: "+ New knowledge base" }));
  if (state.kbs.length === 0) listCol.appendChild(el("div", { class: "hb-empty", text: "No knowledge bases yet." }));

  const detailCol = el("div", { class: "hb-scroll", style: "padding:20px" });
  const kb = state.kbs.find((k) => k.name === state.selectedKbName);
  if (kb) {
    detailCol.appendChild(el("div", { style: "font-family:var(--font-heading);font-weight:800;font-size:17px", text: kb.name }));
    detailCol.appendChild(el("div", { style: "font-size:12px;color:var(--color-neutral-700);margin-top:2px" }, [
      document.createTextNode(`${kb.documentCount} documents · embedding model `),
      el("span", { class: "hb-mono", text: kb.embeddingModel }),
    ]));
    detailCol.appendChild(el("div", { class: "hr" }));

    detailCol.appendChild(el("div", { class: "hb-kicker", text: "Test search" }));
    const searchRow = el("div", { style: "display:flex;gap:8px" });
    const searchInput = el("input", { class: "input", style: "flex:1", placeholder: "Search query…" });
    searchInput.value = state.kbSearchQuery;
    searchInput.addEventListener("change", (e) => (state.kbSearchQuery = e.target.value));
    searchRow.appendChild(searchInput);
    searchRow.appendChild(
      el("button", {
        class: "btn btn-secondary",
        text: "Search",
        onClick: async () => {
          try {
            const { results } = await api("POST", `/kb/${encodeURIComponent(kb.name)}/search`, { query: searchInput.value });
            state.kbSearchResults = results;
          } catch (err) {
            state.kbSearchResults = [{ content: `Error: ${err.message}`, score: null, documentId: null }];
          }
          render();
        },
      }),
    );
    detailCol.appendChild(searchRow);
    if (state.kbSearchResults) {
      const resultsBox = el("div", { style: "margin-top:12px;display:flex;flex-direction:column;gap:8px" });
      for (const r of state.kbSearchResults) {
        resultsBox.appendChild(
          el("div", { style: "border:2px solid var(--color-divider);padding:10px 12px" }, [
            el("div", { style: "display:flex;justify-content:space-between;align-items:baseline" }, [
              el("span", { class: "hb-mono", style: "font-size:11px;color:var(--color-neutral-700)", text: r.documentId != null ? `doc #${r.documentId}` : "" }),
              r.score != null ? el("span", { class: "tag tag-accent", text: r.score.toFixed(3) }) : null,
            ]),
            el("div", { style: "font-size:12.5px;margin-top:4px", text: r.content }),
          ]),
        );
      }
      detailCol.appendChild(resultsBox);
    }

    detailCol.appendChild(el("div", { class: "hb-kicker", style: "margin-top:20px", text: "Add document" }));
    const docBox = el("textarea", { class: "input", style: "width:100%;min-height:80px;font-size:13px", placeholder: "Paste text to embed and store…" });
    docBox.value = state.kbDocDraft;
    docBox.addEventListener("change", (e) => (state.kbDocDraft = e.target.value));
    detailCol.appendChild(docBox);
    detailCol.appendChild(
      el("button", {
        class: "btn btn-primary",
        style: "margin-top:8px",
        onClick: async () => {
          if (!docBox.value.trim()) return;
          await api("POST", `/kb/${encodeURIComponent(kb.name)}/documents`, { text: docBox.value });
          state.kbDocDraft = "";
          await loadKbs();
        },
        text: "Add document",
      }),
    );

    detailCol.appendChild(el("div", { class: "hb-kicker", style: "margin-top:20px", text: "Documents" }));
    const docTable = el("table", { class: "table", style: "width:100%" });
    docTable.appendChild(el("thead", {}, el("tr", {}, [el("th", { text: "ID" }), el("th", { text: "Chunks" }), el("th", { text: "Added" }), el("th", { text: "" })])));
    const docTbody = el("tbody");
    for (const doc of state.kbDocuments) {
      docTbody.appendChild(
        el("tr", {}, [
          el("td", { class: "hb-mono", style: "font-size:12px", text: String(doc.id) }),
          el("td", { style: "font-size:12.5px", text: String(doc.chunkCount) }),
          el("td", { style: "font-size:11px;color:var(--color-neutral-700)", text: timeAgo(doc.createdAt) }),
          el("td", { style: "text-align:right" }, el("button", { class: "btn btn-icon", text: "✕", onClick: async () => { await api("DELETE", `/kb/${encodeURIComponent(kb.name)}/documents/${doc.id}`); await loadKbs(); } })),
        ]),
      );
    }
    docTable.appendChild(docTbody);
    detailCol.appendChild(docTable);
    if (state.kbDocuments.length === 0) detailCol.appendChild(el("div", { class: "hb-empty", text: "No documents yet." }));
  } else {
    detailCol.appendChild(el("div", { class: "hb-empty", text: "Select or create a knowledge base." }));
  }

  layout.appendChild(listCol);
  layout.appendChild(detailCol);
  body.appendChild(layout);
};

// ── section: memory (real — replaces the original mock "Logs" section) ──

const renderMemory = (body) => {
  const layout = el("div", { style: "display:grid;grid-template-columns:1fr 1.2fr;gap:0;border:2px solid var(--color-divider)" });
  const listCol = el("div", { style: "border-right:2px solid var(--color-divider)" });
  const table = el("table", { class: "table", style: "width:100%" });
  table.appendChild(el("thead", {}, el("tr", {}, [el("th", { text: "Conversation" }), el("th", { text: "Turns" }), el("th", { text: "Last active" })])));
  const tbody = el("tbody");
  for (const c of state.conversations) {
    tbody.appendChild(
      el("tr", { class: `hb-row ${c.conversationId === state.selectedConversationId ? "active" : ""}`, onClick: async () => { state.selectedConversationId = c.conversationId; await loadConversationDetail(c.conversationId); } }, [
        el("td", { class: "hb-mono", style: "font-size:12px", text: c.conversationId }),
        el("td", { text: String(c.turnCount) }),
        el("td", { style: "font-size:11px;color:var(--color-neutral-700)", text: timeAgo(c.lastActive) }),
      ]),
    );
  }
  table.appendChild(tbody);
  listCol.appendChild(table);
  if (state.conversations.length === 0) listCol.appendChild(el("div", { class: "hb-empty", text: "No conversations stored yet — invoke an agent with a conversationId in the request body." }));

  const detailCol = el("div", { class: "hb-scroll", style: "padding:20px" });
  if (state.selectedConversationId) {
    detailCol.appendChild(el("div", { style: "display:flex;align-items:baseline;justify-content:space-between" }, [
      el("div", { class: "hb-mono", style: "font-weight:700", text: state.selectedConversationId }),
      el("button", {
        class: "btn btn-secondary",
        text: "Clear",
        onClick: async () => {
          await api("DELETE", `/memory/${encodeURIComponent(state.selectedConversationId)}`);
          state.selectedConversationId = null;
          state.conversationTurns = [];
          await loadConversations();
        },
      }),
    ]));
    detailCol.appendChild(el("div", { class: "hr" }));
    for (const turn of state.conversationTurns) {
      detailCol.appendChild(
        el("div", { style: "border:2px solid var(--color-divider);padding:10px 12px;margin-bottom:8px" }, [
          el("div", { style: "display:flex;justify-content:space-between;align-items:baseline" }, [
            el("span", { class: "tag tag-outline", text: turn.role }),
            el("span", { class: "hb-mono", style: "font-size:11px;color:var(--color-neutral-700)", text: timeAgo(turn.createdAt) }),
          ]),
          el("div", { style: "font-size:12.5px;margin-top:6px;white-space:pre-wrap", text: turn.content }),
        ]),
      );
    }
  } else {
    detailCol.appendChild(el("div", { class: "hb-empty", text: "Select a conversation to view its stored turns." }));
  }

  layout.appendChild(listCol);
  layout.appendChild(detailCol);
  body.appendChild(layout);
};

// ── dialogs ──────────────────────────────────────────────────────────────

const renderDialogs = () => {
  const root = document.getElementById("dialog-root");
  root.innerHTML = "";

  if (state.kbDialogOpen) {
    const nameInput = el("input", { class: "input hb-mono" });
    const modelSelect = el("select", { class: "input" }, [
      el("option", { value: "nomic-embed-text", text: "nomic-embed-text" }),
      el("option", { value: "mxbai-embed-large", text: "mxbai-embed-large" }),
    ]);
    const docInput = el("textarea", { class: "input", style: "min-height:80px", placeholder: "First document's text — a KB is created on its first document" });
    root.appendChild(
      el("div", { class: "dialog-backdrop" }, el("div", { class: "dialog", style: "width:420px" }, [
        el("div", { class: "dialog-title", text: "New knowledge base" }),
        el("div", { class: "dialog-body" }, [
          el("div", { class: "field" }, [el("label", { text: "Name" }), nameInput]),
          el("div", { class: "field" }, [el("label", { text: "Embedding model" }), modelSelect]),
          el("div", { class: "field" }, [el("label", { text: "First document" }), docInput]),
        ]),
        el("div", { class: "dialog-actions" }, [
          el("button", { class: "btn btn-ghost", text: "Cancel", onClick: () => { state.kbDialogOpen = false; render(); } }),
          el("button", {
            class: "btn btn-primary",
            text: "Create",
            onClick: async () => {
              if (!nameInput.value.trim() || !docInput.value.trim()) return;
              await api("POST", `/kb/${encodeURIComponent(nameInput.value.trim())}/documents`, { text: docInput.value, model: modelSelect.value });
              state.kbDialogOpen = false;
              state.selectedKbName = nameInput.value.trim();
              await loadKbs();
            },
          }),
        ]),
      ])),
    );
  }

  if (state.deleteConfirm) {
    const d = state.deleteConfirm;
    root.appendChild(
      el("div", { class: "dialog-backdrop" }, el("div", { class: "dialog", style: "width:380px" }, [
        el("div", { class: "dialog-title", text: "Delete knowledge base?" }),
        el("div", { class: "dialog-body" }, el("p", { style: "font-size:13px;margin:0", text: `This deletes "${d.name}" and all its documents. This can't be undone.` })),
        el("div", { class: "dialog-actions" }, [
          el("button", { class: "btn btn-ghost", text: "Cancel", onClick: () => { state.deleteConfirm = null; render(); } }),
          el("button", {
            class: "btn btn-primary",
            text: "Delete",
            onClick: async () => {
              await api("DELETE", `/kb/${encodeURIComponent(d.name)}`);
              state.deleteConfirm = null;
              state.selectedKbName = null;
              await loadKbs();
            },
          }),
        ]),
      ])),
    );
  }
};

// ── top-level render ────────────────────────────────────────────────────

const TITLES = {
  agents: ["Agents", () => `${state.agents.length} registered`],
  endpoints: ["Endpoints", () => "Registered HTTP routes — try any of them against the real API"],
  kbs: ["Knowledge Bases", () => "RAG document stores"],
  memory: ["Memory", () => "Stored conversations"],
};

const render = () => {
  document.getElementById("base-url").textContent = location.host;
  renderNav();

  const [title, subtitle] = TITLES[state.section];
  document.getElementById("section-title").textContent = title;
  document.getElementById("section-subtitle").textContent = subtitle();

  const body = document.getElementById("section-body");
  body.innerHTML = "";
  if (state.section === "agents") renderAgents(body);
  if (state.section === "endpoints") renderEndpoints(body);
  if (state.section === "kbs") renderKbs(body);
  if (state.section === "memory") renderMemory(body);

  renderDialogs();
};

(async () => {
  render();
  await loadHealth();
  await loadAgents();
  setInterval(loadHealth, 15000);
})();
