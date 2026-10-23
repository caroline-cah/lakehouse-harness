import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import type { Question, QuestionStore } from "./types.js";

const PK = "Q";
const TTL_DAYS = 30;

/** Doubles as the AgentCore runtime session id, which must be at least 33 characters. */
export function newQuestionId(): string {
  return `q-${randomUUID()}-lakehouse`;
}

export function createDynamoStore(tableName: string, client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } })): QuestionStore {
  const key = (q: Pick<Question, "createdAt" | "id">) => ({ pk: PK, sk: `${q.createdAt}#${q.id}` });
  async function find(id: string): Promise<Question | undefined> {
    const r = await client.send(new QueryCommand({ TableName: tableName, IndexName: "byId", KeyConditionExpression: "id = :id", ExpressionAttributeValues: { ":id": id }, Limit: 1 }));
    const item = r.Items?.[0];
    if (!item) return undefined;
    const { pk: _pk, sk: _sk, expiresAt: _ttl, ...q } = item as Record<string, unknown>;
    return q as unknown as Question;
  }
  return {
    async putQuestion(q) {
      await client.send(new PutCommand({ TableName: tableName, Item: { ...key(q), expiresAt: Math.floor(Date.now() / 1000) + TTL_DAYS * 86400, ...q } }));
    },
    async getQuestion(id) {
      return find(id);
    },
    async listQuestions(limit = 60) {
      const r = await client.send(new QueryCommand({ TableName: tableName, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": PK }, ScanIndexForward: false, Limit: limit }));
      return (r.Items ?? []).map((item) => {
        const { pk: _pk, sk: _sk, expiresAt: _ttl, ...q } = item as Record<string, unknown>;
        return q as unknown as Question;
      });
    },
    async updateQuestion(id, patch) {
      const current = await find(id);
      if (!current) throw new Error(`question ${id} not found`);
      const next: Question = { ...current, ...patch, updatedAt: new Date().toISOString() };
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets: string[] = [];
      for (const [k, v] of Object.entries({ ...patch, updatedAt: next.updatedAt })) {
        if (v === undefined) continue;
        names[`#${k}`] = k;
        values[`:${k}`] = v;
        sets.push(`#${k} = :${k}`);
      }
      await client.send(new UpdateCommand({ TableName: tableName, Key: key(current), UpdateExpression: `SET ${sets.join(", ")}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values }));
      return next;
    },
  };
}

export { GetCommand };
