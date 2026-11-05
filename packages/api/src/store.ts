import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import type { Question, QuestionStore } from "./types.js";

/**
 * One partition holds every question, sorted by `createdAt#id`, so the board's list is one Query, newest first.
 * The `byId` index (infra/api.tf) finds a single question. Items expire after TTL_DAYS: it is a demo.
 */
const PARTITION = "Q";
const TTL_DAYS = 30;

type Item = Record<string, unknown>;

/** Doubles as the AgentCore runtime session id, which must be at least 33 characters. */
export function newQuestionId(): string {
  return `q-${randomUUID()}-lakehouse`;
}

const defaultClient = () =>
  DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

export function createDynamoStore(tableName: string, client = defaultClient()): QuestionStore {
  const key = (q: Pick<Question, "createdAt" | "id">) => ({ pk: PARTITION, sk: `${q.createdAt}#${q.id}` });

  async function find(id: string): Promise<Question | undefined> {
    const r = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "byId",
        KeyConditionExpression: "id = :id",
        ExpressionAttributeValues: { ":id": id },
        Limit: 1,
      }),
    );
    const item = r.Items?.[0];
    return item ? toQuestion(item) : undefined;
  }

  return {
    async putQuestion(q) {
      const expiresAt = Math.floor(Date.now() / 1000) + TTL_DAYS * 86_400;
      await client.send(new PutCommand({ TableName: tableName, Item: { ...key(q), expiresAt, ...q } }));
    },

    async getQuestion(id) {
      return find(id);
    },

    async listQuestions(limit = 60) {
      const r = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": PARTITION },
          ScanIndexForward: false,
          Limit: limit,
        }),
      );
      return (r.Items ?? []).map(toQuestion);
    },

    async updateQuestion(id, patch) {
      const current = await find(id);
      if (!current) throw new Error(`question ${id} not found`);
      const next: Question = { ...current, ...patch, updatedAt: new Date().toISOString() };
      const update = updateExpression({ ...patch, updatedAt: next.updatedAt });
      await client.send(new UpdateCommand({ TableName: tableName, Key: key(current), ...update }));
      return next;
    },
  };
}

/** Strips the storage-only attributes (keys, TTL) from an item. */
function toQuestion(item: Item): Question {
  const { pk: _pk, sk: _sk, expiresAt: _ttl, ...question } = item;
  return question as unknown as Question;
}

/** `SET #a = :a, #b = :b` for every defined field of the patch, with names and values escaped for DynamoDB. */
function updateExpression(patch: Item) {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  }
  return {
    UpdateExpression: `SET ${sets.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}
