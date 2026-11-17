import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ListGroupsRequestSchema, GetGroupRequestSchema, Group, GroupPrimitives } from './types.js';

/**
 * Minimal structural view of the MCP `Server` surface `setupGroups` relies on.
 * Typed structurally (rather than importing the concrete `Server` class) so
 * that consumers linking their own copy of `@modelcontextprotocol/sdk` don't
 * hit cross-package nominal-type clashes on the class's private fields.
 */
export interface GroupsCapableServer {
    setRequestHandler(requestSchema: unknown, handler: (request: { params: { name: string } & Record<string, unknown> }) => unknown): void;
}

export interface ServerGroup {
    group: Group;
    /**
     * Optional. A group MAY omit instructions — e.g. a primitives-only toolset
     * that only needs to reveal its scoped tools when fetched.
     */
    instructions?: (params: { name: string }) => string | Promise<string>;
    /**
     * Optional. The group's scoped primitives. They are returned directly on
     * the `groups/get` result, next to `instructions`.
     */
    primitives?: (params: { name: string }) => GroupPrimitives | Promise<GroupPrimitives>;
}

/**
 * A helper to register handlers for the `io.modelcontextprotocol/groups`
 * extension on a standard Server.
 */
export function setupGroups(server: GroupsCapableServer, groups: ServerGroup[]) {
    server.setRequestHandler(ListGroupsRequestSchema, async () => {
        return {
            groups: groups.map(g => g.group)
        };
    });

    server.setRequestHandler(GetGroupRequestSchema, async request => {
        const name = request.params.name;
        const g = groups.find(gr => gr.group.name === name);

        if (!g) {
            // Mirror `resources/read`'s unknown-URI code so unknown-group handling
            // matches existing precedent (see SEP "groups/get").
            throw new McpError(-32002, `Group not found: ${name}`);
        }

        const instructions = g.instructions ? await g.instructions({ name }) : undefined;
        const primitives = g.primitives ? await g.primitives({ name }) : {};

        // Flat result: scoped primitives sit next to `instructions`, with no
        // wrapper. Only include the arrays the group actually provides.
        const result: Record<string, unknown> = {};
        if (instructions !== undefined) result.instructions = instructions;
        for (const key of ['tools', 'prompts', 'resources', 'groups'] as const) {
            if (primitives[key] !== undefined) result[key] = primitives[key];
        }

        // A response carries no meaning without at least one field.
        if (Object.keys(result).length === 0) {
            throw new Error(`Group '${name}' returned neither instructions nor primitives`);
        }

        return result;
    });
}
