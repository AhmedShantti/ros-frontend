import { describe, expect, it } from "vitest";
import { mockServices } from "./mock";

describe("mock.ts smoke — Kitchen Display Setup demo mode", () => {
  it("getKitchenSetup composes stations/routing/fallback/settings for a real demo branch without throwing", async () => {
    const branches = await mockServices.organisation.branches.list();
    const branchId = branches.rows[0]!.id;

    const setup = await mockServices.organisation.getKitchenSetup(branchId);
    expect(setup.branchId).toBe(branchId);
    expect(Array.isArray(setup.stations)).toBe(true);
    expect(Array.isArray(setup.routingRules)).toBe(true);
    expect(setup.recallWindowSeconds).toBe(1800);
    expect(setup.cancelledLineVisibilitySeconds).toBeNull();
    expect(setup.fallbackStationId).toBeNull();
    expect(setup.capabilities.fallback).toBe(true);
  });

  it("updateKitchenConfig is a true partial update and round-trips exactly", async () => {
    const branches = await mockServices.organisation.branches.list();
    const branchId = branches.rows[0]!.id;
    const setup = await mockServices.organisation.getKitchenSetup(branchId);
    const stationId = setup.stations[0]?.id;
    expect(stationId).toBeTruthy();

    await mockServices.organisation.updateKitchenConfig(branchId, { fallbackStationId: stationId! });
    const afterFallback = await mockServices.organisation.getKitchenSetup(branchId);
    expect(afterFallback.fallbackStationId).toBe(stationId);
    expect(afterFallback.recallWindowSeconds).toBe(1800);

    await mockServices.organisation.updateKitchenConfig(branchId, {
      recallWindowSeconds: 900,
      cancelledLineVisibilitySeconds: 60,
    });
    const afterSettings = await mockServices.organisation.getKitchenSetup(branchId);
    expect(afterSettings.fallbackStationId).toBe(stationId);
    expect(afterSettings.recallWindowSeconds).toBe(900);
    expect(afterSettings.cancelledLineVisibilitySeconds).toBe(60);
  });

  it("create/update/remove routing rule round-trip through the mock", async () => {
    const branches = await mockServices.organisation.branches.list();
    const branchId = branches.rows[0]!.id;
    const setup = await mockServices.organisation.getKitchenSetup(branchId);
    const [stationA, stationB] = setup.stations;
    expect(stationA).toBeTruthy();
    expect(stationB ?? stationA).toBeTruthy();

    const created = await mockServices.organisation.addStationRoutingRule(branchId, {
      stationId: stationA!.id,
      categoryId: "smoke-category",
    });
    expect(created.stationId).toBe(stationA!.id);

    const destination = (stationB ?? stationA)!.id;
    const updated = await mockServices.organisation.updateStationRoutingRule(
      branchId,
      created.id,
      destination,
    );
    expect(updated.stationId).toBe(destination);
    expect(updated.categoryId).toBe("smoke-category");

    await mockServices.organisation.removeStationRoutingRule(branchId, created.id);
    const after = await mockServices.organisation.getKitchenSetup(branchId);
    expect(after.routingRules.find((r) => r.id === created.id)).toBeUndefined();

    await expect(
      mockServices.organisation.removeStationRoutingRule(branchId, created.id),
    ).rejects.toThrow();
  });
});
