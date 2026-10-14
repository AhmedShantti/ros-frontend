import { describe, expect, it } from "vitest";
import { mockServices } from "./mock";
import { countSessions } from "../mock/inventory";

describe("FR-INV-046 mock interface", () => {
  it("retains history, creates a new head, permits explanation replacement and blocks historical actions", async () => {
    const session = countSessions.find((s) => s.status === "counting")!;
    const root = session.lines[0];
    const originalCount = root.counted;
    await mockServices.inventory.recordRecount(root.id, "9.125");
    const fetched = await mockServices.inventory.counts.get(session.id);
    const head = fetched!.lines.find((l) => l.recountOfLineId === root.id)!;
    expect(root.counted).toEqual(originalCount);
    expect(root.isCurrentHead).toBe(false); expect(head.isCurrentHead).toBe(true);
    expect(head.counted?.value).toBe("9.125");
    await expect(mockServices.inventory.recordRecount(root.id, "10")).rejects.toThrow();
    await expect(mockServices.inventory.recordVarianceExplanation(root.id, "Reason")).rejects.toThrow();
    await mockServices.inventory.recordVarianceExplanation(head.id, "  Reason  ");
    expect(head.varianceExplanation).toBe("Reason");
    await mockServices.inventory.recordVarianceExplanation(head.id, "Replacement");
    expect(head.varianceExplanation).toBe("Replacement");
    expect(head.varianceExplainedBy).toBeTruthy(); expect(head.varianceExplainedAt).toBeTruthy();
    await expect(mockServices.inventory.recordCount(head.id, "11")).rejects.toThrow();
  });
});
