import { describe, it, expect } from "vitest";
import { getSimpleFeatures } from "../simple_features.js";
describe("getSimpleFeatures", () => {
  it("full => all flags false", () => {
    expect(getSimpleFeatures("full")).toEqual({ simpleAssembler:false, disableRAG:false, disableFactsExtraction:false, disableChapterSummary:false });
  });
  it("simple => all flags true", () => {
    expect(getSimpleFeatures("simple")).toEqual({ simpleAssembler:true, disableRAG:true, disableFactsExtraction:true, disableChapterSummary:true });
  });
});
