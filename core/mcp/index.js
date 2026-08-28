#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { noteService } from '../services/noteService.js';
import { searchService } from '../services/searchService.js';
import { slugify } from '../services/parser.js';

const server = new Server(
  {
    name: 'secondbrain-mcp',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'secondbrain_search',
        description: 'Search SecondBrain notes using fast MySQL full-text and tag matching.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query or keywords to look for'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10)'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'secondbrain_read_note',
        description: 'Read the full content, backlinks, tags, and properties of a note by title, slug, or ID.',
        inputSchema: {
          type: 'object',
          properties: {
            idOrTitle: {
              type: 'string',
              description: 'The note ID, title, or slug'
            }
          },
          required: ['idOrTitle']
        }
      },
      {
        name: 'secondbrain_create_note',
        description: 'Create a new note in SecondBrain with automatic wikilink and hashtag parsing.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'The title of the note'
            },
            content: {
              type: 'string',
              description: 'The markdown content of the note (can contain [[links]] and #tags)'
            },
            status: {
              type: 'string',
              enum: ['active', 'archived', 'trash'],
              description: 'Note status (default: active)'
            },
            dueDate: {
              type: 'string',
              description: 'Optional due date in YYYY-MM-DD format'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional additional tags'
            },
            properties: {
              type: 'object',
              description: 'Optional Notion-style key/value properties'
            }
          },
          required: ['title', 'content']
        }
      },
      {
        name: 'secondbrain_update_note',
        description: 'Update or append content to an existing note in SecondBrain.',
        inputSchema: {
          type: 'object',
          properties: {
            idOrTitle: {
              type: 'string',
              description: 'The note ID, title, or slug to update'
            },
            content: {
              type: 'string',
              description: 'New markdown content, or content to append'
            },
            append: {
              type: 'boolean',
              description: 'If true, append content to existing content instead of overwriting'
            }
          },
          required: ['idOrTitle', 'content']
        }
      },
      {
        name: 'secondbrain_get_backlinks',
        description: 'Discover all notes in SecondBrain that link to a specific note or topic.',
        inputSchema: {
          type: 'object',
          properties: {
            idOrTitle: {
              type: 'string',
              description: 'The note title, slug, or ID'
            }
          },
          required: ['idOrTitle']
        }
      },
      {
        name: 'secondbrain_list_recent',
        description: 'List the most recently updated notes in SecondBrain.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of notes to return (default: 15)'
            },
            tag: {
              type: 'string',
              description: 'Optional filter by hashtag'
            }
          }
        }
      },
      {
        name: 'secondbrain_list_tasks',
        description: 'List action items (- [ ] / - [x]) across all SecondBrain notes.',
        inputSchema: {
          type: 'object',
          properties: {
            completed: {
              type: 'boolean',
              description: 'Filter by completed (true) or pending (false), or omit for all'
            }
          }
        }
      }
    ]
  };
});

// Tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'secondbrain_search': {
        const results = await searchService.search(args.query, {
          limit: args.limit || 10
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2)
            }
          ]
        };
      }

      case 'secondbrain_read_note': {
        const identifier = String(args.idOrTitle).trim();
        let note = await noteService.getNoteById(identifier);
        if (!note) {
          const slug = slugify(identifier);
          note = await noteService.getNoteBySlug(slug);
        }
        if (!note) {
          return {
            content: [{ type: 'text', text: `Note not found for identifier: "${identifier}"` }],
            isError: true
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(note, null, 2) }]
        };
      }

      case 'secondbrain_create_note': {
        const newNote = await noteService.createNote({
          title: args.title,
          content: args.content,
          status: args.status || 'active',
          dueDate: args.dueDate || null,
          customTags: args.tags || [],
          properties: args.properties || {}
        });
        return {
          content: [
            {
              type: 'text',
              text: `Note created successfully! ID: ${newNote.id} (slug: ${newNote.slug})\n\n` + JSON.stringify(newNote, null, 2)
            }
          ]
        };
      }

      case 'secondbrain_update_note': {
        const identifier = String(args.idOrTitle).trim();
        let note = await noteService.getNoteById(identifier);
        if (!note) {
          note = await noteService.getNoteBySlug(slugify(identifier));
        }
        if (!note) {
          return {
            content: [{ type: 'text', text: `Note not found for identifier: "${identifier}"` }],
            isError: true
          };
        }

        let newContent = args.content;
        if (args.append) {
          newContent = `${note.content}\n\n${args.content}`;
        }

        const updated = await noteService.updateNote(note.id, { content: newContent });
        return {
          content: [
            {
              type: 'text',
              text: `Note updated successfully!\n\n` + JSON.stringify(updated, null, 2)
            }
          ]
        };
      }

      case 'secondbrain_get_backlinks': {
        const identifier = String(args.idOrTitle).trim();
        let note = await noteService.getNoteById(identifier);
        if (!note) {
          note = await noteService.getNoteBySlug(slugify(identifier));
        }
        if (!note) {
          return {
            content: [{ type: 'text', text: `Note not found: "${identifier}"` }],
            isError: true
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                note: { id: note.id, title: note.title, slug: note.slug },
                backlinksCount: note.backlinks.length,
                backlinks: note.backlinks
              }, null, 2)
            }
          ]
        };
      }

      case 'secondbrain_list_recent': {
        const notes = await noteService.listNotes({
          limit: args.limit || 15,
          tag: args.tag || null
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(notes, null, 2) }]
        };
      }

      case 'secondbrain_list_tasks': {
        const tasks = await noteService.getTasks({
          completed: args.completed !== undefined ? args.completed : null
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true
    };
  }
});

// Run server on stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('SecondBrain MCP Server running on stdio');
}

main().catch((err) => {
  console.error('MCP Server error:', err);
  process.exit(1);
});
