import { MockHealthMateClient } from "./mock-client";

describe("MockHealthMateClient", () => {
  const now = () => new Date("2026-09-27T09:00:00Z");

  it("labels everything as sample data", async () => {
    const client = new MockHealthMateClient(now);
    const s = await client.getHomeSummary();
    expect(client.isSampleData).toBe(true);
    for (const item of [...s.metrics, ...s.tasks, ...s.recentActivity]) expect(item.source).toBe("sample");
    expect(s.insight?.source).toBe("sample");
  });

  it("never invents medication names or doses in sample tasks", async () => {
    const s = await new MockHealthMateClient(now).getHomeSummary();
    for (const t of s.tasks.filter((t) => t.category === "medication")) {
      expect(`${t.title} ${t.detail ?? ""}`).not.toMatch(/\d+\s?(mg|mcg|iu|ml)\b/i);
    }
  });

  it("persists task completion and returns copies", async () => {
    const client = new MockHealthMateClient(now);
    const before = await client.getHomeSummary();
    before.tasks[0]!.title = "mutated";
    await client.setTaskCompleted("t2", true);
    const after = await client.getHomeSummary();
    expect(after.tasks.find((t) => t.id === "t2")?.completed).toBe(true);
    expect(after.tasks[0]!.title).not.toBe("mutated");
  });

  it("rejects unknown tasks", async () => {
    await expect(new MockHealthMateClient(now).setTaskCompleted("nope", true)).rejects.toThrow(/not found/);
  });

  it("records mood", async () => {
    const client = new MockHealthMateClient(now);
    await client.recordMood("good");
    expect((await client.getHomeSummary()).todayMood?.mood).toBe("good");
  });
});
