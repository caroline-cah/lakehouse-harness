import { describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { AgentSkills } from "@strands-agents/sdk/vended-plugins/skills";
import { buildAgent } from "../src/agent.js";

const skillsDir = fileURLToPath(new URL("../skills", import.meta.url));

describe("skills", () => {
  test("the AWS skill loads from the vendored folder", async () => {
    const agent = buildAgent({ modelId: "m", region: "eu-central-1", tools: [], skillsDir });
    const plugin = new AgentSkills({ skills: [`${skillsDir}/aws`] });
    await plugin.initAgent(agent as never);
    const names = (await plugin.getAvailableSkills(agent as never)).map((s) => s.name);
    expect(names).toContain("querying-data-lake");
  });
  test("skills add knowledge, not capability: the only extra tool is the skill loader", () => {
    const plugin = new AgentSkills({ skills: [`${skillsDir}/aws`] });
    expect(plugin.getTools().map((t) => t.name)).toEqual(["skills"]);
  });
});
