# Agent skills

Loaded into both runtime agents with the Strands `AgentSkills` plugin: only each skill's name and description sit
in the system prompt, and the agent pulls in the full instructions with the `skills` tool when it needs them.

| Skill | Source |
|---|---|
| `aws/querying-data-lake` | [aws/agent-toolkit-for-aws](https://github.com/aws/agent-toolkit-for-aws) `skills/specialized-skills/analytics-skills/querying-data-lake` at `e8c630949189f03b3dd77388c86b06a7f2f911a9`, unmodified, Apache-2.0 (`aws/LICENSE`, `aws/NOTICE`) |

Skills are knowledge, tools are capability, the harness is enforcement. The AWS skill is written for an interactive
coding agent (AWS CLI, `SELECT *`, asking the user); here the agent still has only the lakehouse tools, and the
system prompt and the SQL guard win wherever the skill disagrees.

To update: copy the skill folder from a newer commit, bump the commit above, run the golden set.
