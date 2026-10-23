import type { Question, QuestionStore } from "../src/types.js";

export class MemoryStore implements QuestionStore {
  items: Question[] = [];
  async putQuestion(q: Question) {
    this.items.push(q);
  }
  async getQuestion(id: string) {
    return this.items.find((q) => q.id === id);
  }
  async listQuestions(limit = 60) {
    return [...this.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async updateQuestion(id: string, patch: Partial<Question>) {
    const i = this.items.findIndex((q) => q.id === id);
    if (i < 0) throw new Error("not found");
    this.items[i] = { ...this.items[i]!, ...patch, updatedAt: new Date().toISOString() };
    return this.items[i]!;
  }
}
