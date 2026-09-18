# Note-taking

When a task calls for saving a note, memory, or piece of knowledge for later (not a code comment, not a doc the user asked to publish) — use the **ai-cortex** MCP server's tools (`ai_cortex_create_note`, `ai_cortex_update_note`, `ai_cortex_search`, etc.) as the default destination. This is a shared-memory store, self-hosted, MCP-native, meant to be the single place any AI reads/writes long-term notes.

Do not write standalone note/markdown files to the filesystem (e.g. into an Obsidian vault via a filesystem MCP server, or scratch `.md` files in a project) as a substitute for this — ai-cortex is the canonical note store, not the filesystem. This applies regardless of which project or repo the session is in.

If `ai-cortex`'s MCP tools aren't available in a given session, say so explicitly rather than silently falling back to writing a file.
