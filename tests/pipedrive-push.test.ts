import { describe, it, expect } from "vitest";
import { shouldAdvance, stageForEvent, configIsReady, buildEntityFields } from "../supabase/functions/_shared/pipedrive.ts";

describe("Pipedrive: negócio só avança", () => {
  it("resposta não volta negócio que já tem reunião", () => {
    expect(shouldAdvance(3, "stage_replied")).toBe(false);
  });
  it("reunião avança negócio em conversa", () => {
    expect(shouldAdvance(2, "stage_meeting")).toBe(true);
  });
  it("atendimento humano avança a partir da reunião", () => {
    expect(shouldAdvance(3, "move_stage")).toBe(true);
  });
});

describe("Pipedrive: configuração", () => {
  it("envio desligado nunca está pronto", () => {
    expect(configIsReady({ push_enabled: false, pipeline_id: 1, stage_created: 2 })).toBe(false);
  });
  it("etapa não escolhida é ignorada", () => {
    expect(stageForEvent({ stage_meeting: null }, "stage_meeting")).toBeNull();
  });
  it("de/para envia só campos da entidade e ignora vazios", () => {
    const map = { title: { entity: "person" as const, field: "job" }, website: { entity: "deal" as const, field: "abc" } };
    expect(buildEntityFields({ title: "CEO", website: "" }, map, "person")).toEqual({ job: "CEO" });
    expect(buildEntityFields({ title: "CEO", website: "" }, map, "deal")).toEqual({});
  });
});
